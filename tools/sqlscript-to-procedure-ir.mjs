// Bind the imperative SQLScript syntax tree to the portable procedure IR.
//
// Statement ownership lives here; expressions and relations deliberately go
// through the established relational binder in to-ir.mjs. That keeps one
// implementation of SQLScript typing and one list of explicit refusals.
import {T, lit, scan, project, union, schemaOf, varRef} from "./sqlscript-ir.mjs";
import {toIr, BindError} from "./sqlscript/to-ir.mjs";
import {scalarTypeOf, irTypeOfDdic, UnresolvedScalarType} from "./sqlscript/scalar-types.mjs";
import {resolveType} from "./osd-type-graph.mjs";
import {lex} from "./sqlscript/lexer.mjs";
import {parse} from "./sqlscript/combi.mjs";
import {Body} from "./sqlscript/expressions/index.mjs";
import {procedure, declareScalar, assignScalar, assignRelation, whileLoop, selectInto,
  ifElse, callProcedure, forCursor, forRange, UnsupportedSqlScript, assignable, writeTable} from "./sqlscript-procedure-ir.mjs";
import {childBodies, containsRelationStatement, readsRelations} from "./sqlscript-blocks.mjs";

const upper = (value) => String(value).toUpperCase();

/** a subquery or a window anywhere in an expression */
function hasSubOrWindow(e) {
  if (e === null || typeof e !== "object") return false;
  if (e.node === "sub" || (e.node === "call" && e.window !== undefined)) return true;
  return Object.values(e).some((v) => (Array.isArray(v) ? v.some(hasSubOrWindow) : hasSubOrWindow(v)));
}

/** where an order's claim comes from, for the trace */
export const ORDER_OBSERVED = "observed:docs/sqlscript-hana-observed.md#the-order-a-cursors-rows-come-in";

/**
 * The order a relation's rows come in, as far as HANA shows it. Only what
 * was measured or what SQL guarantees counts:
 *   - `defined`, guaranteed: the cursor query's own ORDER BY (top level);
 *   - `defined`, observed: the caller's rows of a table parameter, and one
 *     row (DUMMY);
 *   - `inherited`: through a scan, a filter without a subquery, and a
 *     projection without a window or a subquery -- what was measured on HXE
 *     and A4H (docs/sqlscript-hana-observed.md, "The order a cursor's rows
 *     come in");
 *   - `unknown`: everything else -- an ORDER BY inside (HANA may drop it
 *     when it inlines a table variable), DISTINCT, a join, a union, grouping,
 *     LIMIT, a filter with a subquery (a semi-join), a window, a database
 *     table read without ORDER BY.
 * `ties`: the output columns an ORDER BY sorted by (rows equal in those
 * come in any order, measured); null when there are no ties.
 * `orders` holds what each table variable was given.
 */
export function orderOf(rel, orders = new Map(), top = true) {
  const unknown = (why) => ({kind: "unknown", why});
  if (rel === undefined || rel === null) return unknown("no relation");
  switch (rel.rel) {
    case "order":
      return top ? {kind: "defined", why: "the cursor's own ORDER BY", basis: "guaranteed", ties: new Set(rel.keys.map((k) => upper(k.col)))}
        : unknown("an ORDER BY inside the relation, which HANA may drop");
    case "var": return orders.get(upper(rel.name)) ?? unknown(`:${String(rel.name).toLowerCase()} has no known order`);
    case "alias": {
      const inner = orderOf(rel.input, orders, false);
      return inner.kind === "unknown" ? inner : {...inner, kind: "inherited"};
    }
    case "filter": {
      if (hasSubOrWindow(rel.pred)) return unknown("a filter with a subquery (a semi-join)");
      const inner = orderOf(rel.input, orders, false);
      return inner.kind === "unknown" ? inner : {...inner, kind: "inherited"};
    }
    case "project": {
      if (rel.distinct) return unknown("DISTINCT");
      if (rel.items.some((item) => hasSubOrWindow(item.expr))) return unknown("a window function or a subquery in the projection");
      const inner = orderOf(rel.input, orders, false);
      if (inner.kind === "unknown") return inner;
      const ties = inner.ties === null || inner.ties === undefined ? null
        : new Set(rel.items.filter((item) => item.expr?.node === "col" && inner.ties.has(upper(item.expr.name))).map((item) => upper(item.as)));
      return {...inner, kind: "inherited", ties};
    }
    case "scan": return upper(rel.table) === "DUMMY" ? {kind: "defined", why: "one row", basis: "guaranteed", ties: null}
      : unknown(`the table ${upper(rel.table)} read without ORDER BY`);
    default: return unknown(rel.rel === "join" ? "a join" : rel.rel === "union" ? "a union" : rel.rel === "aggregate" ? "grouping" : rel.rel === "limit" ? "LIMIT" : rel.rel);
  }
}
const children = (node, kind) => (node.children ?? []).filter((one) => one.node === kind);
const child = (node, kind) => children(node, kind)[0];
const leaf = (node) => {
  if (node?.value !== undefined) return node;
  for (const one of node?.children ?? []) {
    const found = leaf(one);
    if (found !== undefined) return found;
  }
};
const nameOf = (node) => upper(leaf(node)?.value ?? "");
const exactWrapped = (node, kind) => {
  let current = node;
  while (current !== undefined && current.node !== kind) {
    if (!["Expr", "Term", "Factor"].includes(current.node)) return undefined;
    const semantic = (current.children ?? []).filter((one) => one.node !== "word");
    if (semantic.length !== 1) return undefined;
    current = semantic[0];
  }
  return current;
};
/** every node of a kind, anywhere under `node` */
const findAll = (node, kind, found = []) => {
  if (node?.node === kind) found.push(node);
  for (const one of node?.children ?? []) findAll(one, kind, found);
  return found;
};
const terminalLeaves = (node, found = []) => {
  if (node?.value !== undefined) found.push(node);
  else for (const one of node?.children ?? []) terminalLeaves(one, found);
  return found;
};
const isBareNull = (node) => {
  const leaves = terminalLeaves(node);
  return leaves.length === 1 && leaves[0].node === "identifier" && upper(leaves[0].value) === "NULL";
};

/**
 * The ABAP type text of a procedure's signature into an IR type -- the
 * **measured** set only. scalar-types.mjs reads more (NUMC, RAW, INT8, the
 * CDS built-ins) for the corpus instruments, where a type that binds is a
 * type that can be counted; here a type that compiles is a type that runs,
 * and NUMC's leading zeros or bytes on SQLite have not been measured. So the
 * literal forms admitted are the ones this function admitted before the
 * shared reader existed, and a data element -- only when a caller hands in
 * a dictionary -- is admitted when it resolves to one of the same datatypes.
 * Everything else is the refusal it always was.
 */
// exactly the datatypes the literal forms above map to, nothing wider: CLNT,
// CUKY, CURR and the rest wait for the CHAR-input conformance case (trailing
// blanks on HXE against DuckDB) before a data element of theirs is admitted
// CLNT joined the set on 2026-09-23, measured on A4H: a client input
// arrives as its three characters, right-trimmed like CHAR
// (docs/sqlscript-hana-observed.md)
// RAW joined the same day: a fixed RAW input is its n bytes, initial as n
// zero bytes, compared byte-wise (docs/sqlscript-hana-observed.md)
// INT2 joined the same day: in and out exactly across its range, arithmetic
// promoted to INTEGER, a value outside it raised at the output boundary
// (CX_AMDP_EXECUTION_FAILED), never wrapped (docs/sqlscript-hana-observed.md)
const MEASURED_DATATYPES = new Set(["CHAR", "CLNT", "DATS", "TIMS", "INT4", "INT2", "STRG", "DEC", "RAW"]);
export function irTypeFromAbap(type, resolve) {
  const text = upper(type).trim();
  if (["I", "INT4", "INTEGER"].includes(text)) return T.int;
  if (text === "INT2") return T.int2;
  if (["STRING", "SSTRING"].includes(text)) return T.str;
  if (["D", "DATS"].includes(text)) return T.char(8);
  if (["T", "TIMS"].includes(text)) return T.char(6);
  const length = /^(?:C\s+LENGTH\s+|CHAR)(\d+)$/.exec(text)?.[1];
  if (length !== undefined) return T.char(Number(length));
  // the type pool ABAP's `abap_bool TYPE c LENGTH 1`: a CHAR 1, bound as CHAR is
  if (text === "ABAP_BOOL") return T.char(1);
  const raw = /^X\s+LENGTH\s+(\d+)$/.exec(text)?.[1];
  if (raw !== undefined) return T.bytes(Number(raw));
  const packed = /^P(?:\s+LENGTH\s+(\d+))?(?:\s+DECIMALS\s+(\d+))?$/.exec(text);
  if (packed !== null) return T.dec(Number(packed[1] ?? 16), Number(packed[2] ?? 2));
  // a CDS built-in, as a DDLS RETURNS list spells it: admitted when its
  // datatype is one of the measured ones (abap.int4, abap.char(n),
  // abap.dats, abap.tims, abap.string, abap.dec(n,m)); abap.clnt and the
  // rest stay refused until their conformance case exists
  const cds = /^ABAP\.(\w+)/.exec(text);
  if (cds !== null && MEASURED_DATATYPES.has(cds[1] === "STRING" ? "STRG" : cds[1])) {
    try {
      return scalarTypeOf(text);
    } catch (error) {
      if (!(error instanceof UnresolvedScalarType)) throw error;
    }
  }
  if (resolve !== undefined && /^[A-Z_\/][\w\/]*$/.test(text)) {
    const found = resolve(text);
    if (found !== undefined && MEASURED_DATATYPES.has(upper(found.DATATYPE))) {
      try {
        return scalarTypeOf(text, resolve);
      } catch (error) {
        if (!(error instanceof UnresolvedScalarType)) throw error;
      }
    }
  }
  throw new UnsupportedSqlScript(`ABAP type ${type || "<empty>"} has no portable SQLScript mapping`);
}

/** A table type of the DICTIONARY (TTYP -> structure TABL): its components,
 *  admitted only when every field's DDIC datatype is one of the measured
 *  ones. An include that did not resolve, a field of another datatype, a
 *  row that is not a structure: a named refusal of the whole parameter --
 *  a procedure signature is not a place for a column refused on reference. */
function dictionaryTable(abapType, store) {
  if (store === undefined) return undefined;
  const found = resolveType(store, upper(abapType));
  if (found.KIND !== "TABLE") return undefined;
  if (found.ROW?.KIND !== "STRUCTURE") {
    throw new UnsupportedSqlScript(`table type ${abapType}: row type ${found.ROWTYPE} is ${found.ROW?.KIND ?? "missing"}, not a structure`);
  }
  const schema = {};
  for (const field of found.ROW.FIELDS) {
    if (field.INCLUDE !== undefined) {
      throw new UnsupportedSqlScript(`table type ${abapType}: include ${field.INCLUDE} did not resolve`);
    }
    const type = field.TYPE ?? field;
    const datatype = upper(type.DATATYPE ?? "");
    if (!MEASURED_DATATYPES.has(datatype)) {
      throw new UnsupportedSqlScript(`table type ${abapType}: ${field.NAME} is ${datatype || "unresolved"}, outside the measured portable datatypes`);
    }
    schema[upper(field.NAME)] = irTypeOfDdic(type, `${abapType}.${field.NAME}`);
  }
  return schema;
}

function structuredTable(abapType, types, resolve, store) {
  const local = structuredLocal(abapType, types, resolve);
  return local ?? dictionaryTable(abapType, store);
}

function structuredLocal(abapType, types, resolve) {
  const table = types.get(upper(abapType));
  const row = table?.kind === "table" ? types.get(table.of) : undefined;
  if (row?.kind !== "structure") return undefined;
  return Object.fromEntries(row.components.map((one) => [upper(one.name), irTypeFromAbap(one.abapType, resolve)]));
}

function outputFrom(method, types, resolve, store) {
  // a CDS table function declares its output in the DDLS RETURNS list, not
  // in the class; the caller hands it over as `returns` (ABAP type texts),
  // typed here under the same measured gate as every other column
  if (method.tableFunction !== undefined && Array.isArray(method.returns)
      && method.parameters.every((one) => one.direction === "IN")) {
    const schema = {};
    for (const column of method.returns) {
      const type = irTypeFromAbap(column.abapType, resolve);
      schema[upper(column.name)] = type;
    }
    return {name: "RESULT", kind: "relation", schema};
  }
  const outputs = method.parameters.filter((one) => one.direction !== "IN");
  // several OUT tables (measured on A4H: each is what the path taken
  // assigned, an empty table where it assigned none); every one of them must
  // be a resolved table -- a scalar OUT beside them is not carried yet
  if (outputs.length > 1 && outputs.every((one) => one.direction === "OUT")) {
    // a scalar OUT beside them is typed like a scalar input (INTEGER, a
    // fixed-length character such as abap_bool, STRING -- measured on A4H)
    const all = outputs.map((one) => {
      const schema = structuredTable(one.abapType, types, resolve, store);
      if (schema !== undefined) return {name: upper(one.name), schema};
      let scalar;
      try { scalar = irTypeFromAbap(one.abapType, resolve); } catch { scalar = undefined; }
      if (scalar === undefined || !["I", "C", "STRING"].includes(scalar.abap) || (scalar.abap === "I" && scalar.bits !== undefined)) {
        throw new UnsupportedSqlScript(`output ${one.name} is neither a resolved structured table type nor a measured scalar`);
      }
      return {name: upper(one.name), scalar};
    });
    const tables = all.filter((one) => one.schema !== undefined);
    if (tables.length === 0) throw new UnsupportedSqlScript("several scalar OUTs and no table OUT are not carried yet");
    return {name: tables[0].name, kind: "relation", schema: tables[0].schema, outputs: all};
  }
  if (outputs.length !== 1 || !["OUT", "RETURNING"].includes(outputs[0]?.direction)) {
    throw new UnsupportedSqlScript("initial portable procedures require exactly one OUT or RETURNING output parameter");
  }
  const parameter = outputs[0];
  const schema = structuredTable(parameter.abapType, types, resolve, store);
  if (schema !== undefined) return {name: upper(parameter.name), kind: "relation", schema};
  if (parameter.direction === "RETURNING" || parameter.direction === "OUT") {
    let type;
    try { type = irTypeFromAbap(parameter.abapType, resolve); } catch (error) {
      if (parameter.direction === "OUT") throw new UnsupportedSqlScript(`output ${parameter.name} is not a resolved structured table type`);
      throw error;
    }
    if (!["I", "C", "STRING"].includes(type.abap) || (type.abap === "I" && type.bits !== undefined)) {
      throw new UnsupportedSqlScript("scalar outputs are limited to ABAP INTEGER, fixed-length character and STRING");
    }
    // an OUT scalar left alone is its initial value (measured on A4H); a
    // RETURNING one is not measured and stays refused when unassigned
    return {name: upper(parameter.name), kind: "scalar", type, initialWhenUnassigned: parameter.direction === "OUT"};
  }
  throw new UnsupportedSqlScript(`output ${parameter.name} is not a resolved structured table type`);
}

/**
 * The type a scalar DECLARE names, as SQLScript variables behave on A4H
 * (docs/sqlscript-hana-observed.md, string scalars): INTEGER; BIGINT;
 * NVARCHAR / VARCHAR / CHAR / NCHAR of a length -- a value kept as it is,
 * trailing blanks and all, never padded (a CHAR(5) of 'a' has length 1),
 * one longer than the length raised; NCLOB / CLOB / NVARCHAR without a
 * length as STRING; BOOLEAN. A declared variable without a value is NULL.
 */
function declaredScalarType(typeNode, node) {
  const words = typeNode?.children ?? [];
  const name = upper(words.find((c) => c.node === "identifier" || c.node === "quoted")?.value ?? "");
  const sizes = words.filter((c) => c.node === "number").map((c) => Number(c.value));
  if (["INT", "INTEGER"].includes(name)) return T.int;
  if (name === "BIGINT") return T.int8;
  if (["NVARCHAR", "VARCHAR", "CHAR", "NCHAR"].includes(name) && sizes.length === 1 && sizes[0] > 0) return {abap: "C", len: sizes[0], variable: true};
  if (["NCLOB", "CLOB"].includes(name) && sizes.length === 0) return T.str;
  if (name === "BOOLEAN") return T.bool;
  throw new UnsupportedSqlScript(`a scalar DECLARE of ${name || "an unnamed type"}${sizes.length ? `(${sizes.join(",")})` : ""} is not measured yet`, node);
}

/** Compile one extracted AMDP method without changing its source body. */
export function compileProcedure(method, types, options = {}) {
  const catalogue = options.catalogue ?? {};
  const resolve = options.resolveType;
  const store = options.store;
  const tree = parse(new Body(), lex(method.body));
  const output = outputFrom(method, types, resolve, store);
  const outputNames = new Set((output.outputs ?? [output]).map((one) => one.name));
  const outputSchemaOf = (name) => (output.kind !== "relation" ? undefined
    : (output.outputs ?? [output]).find((one) => one.name === name)?.schema);
  const inputParameters = method.parameters.filter((one) => one.direction === "IN");
  const relationCandidates = inputParameters
    .map((one) => ({one, schema: structuredTable(one.abapType, types, resolve, store)}))
    .filter(({schema}) => schema !== undefined);
  // OPTIONAL, as the kernel reads it on an AMDP method (measured on A4H,
  // 2026-09-23): on a scalar input it does not compile -- only DEFAULT makes
  // a scalar optional -- and on a table input it does, an omitted table
  // arriving as an empty one. The first is refused in the kernel's words;
  // the second is measured and not carried yet.
  const methodName = upper(method.name ?? "");
  for (const one of inputParameters) {
    if (one.optional !== true || one.default !== undefined) continue;
    if (relationCandidates.some((candidate) => candidate.one === one)) {
      throw new UnsupportedSqlScript(`OPTIONAL table input ${one.name}: omitted it is an empty table (measured on A4H); not carried yet`);
    }
    throw new UnsupportedSqlScript(`Use DEFAULT instead of OPTIONAL for the optional parameter "${upper(one.name)}" of the AMDP method "${methodName}"`);
  }
  const relationParameters = relationCandidates.map(({one, schema}) => ({name: upper(one.name), schema}));
  const relationNames = new Set(relationParameters.map((one) => one.name));
  const relationSchemas = Object.fromEntries(relationParameters.map((one) => [one.name, one.schema]));
  const parameterOrders = relationParameters.map((one) => [one.name, {kind: "defined", why: `the caller's rows of :${one.name.toLowerCase()}`, basis: ORDER_OBSERVED, ties: null}]);
  // a DEFAULT is carried as its literal, never as the initial value: an
  // omitted `DEFAULT 10` filled with 0 answers a different question
  const defaultOf = (one, type) => {
    if (one.default === undefined) return {};
    const text = String(one.default);
    if (type.abap === "I" && /^-?\d+$/.test(text)) return {optional: true, default: Number(text)};
    if (type.abap === "C" && /^'(?:[^']|'')*'$/.test(text)) {
      // a text literal into a CHAR parameter: ABAP holds it right-trimmed, which
      // is what the kernel binds (measured); longer than the field is refused
      const value = text.slice(1, -1).replaceAll("''", "'").replace(/ +$/, "");
      if (value.length > type.len) throw new UnsupportedSqlScript(`DEFAULT ${text} for ${one.name} is longer than its ${type.len} characters`);
      return {optional: true, default: value};
    }
    if (type.abap === "STRING" && /^'(?:[^']|'')*'$/.test(text)) {
      const value = text.slice(1, -1).replaceAll("''", "'");
      // 'ab  ' is a text-field literal, and ABAP drops its trailing blanks on
      // the way into a STRING; whether that is what reaches the procedure
      // has not been measured, so a default with trailing blanks is refused
      // rather than trimmed or kept by guess (foreman-dell, 2026-09-23)
      if (/\s$/.test(value)) throw new UnsupportedSqlScript(`DEFAULT ${text} for ${one.name} ends in blanks; a text-field literal into STRING is not measured yet`);
      return {optional: true, default: value};
    }
    throw new UnsupportedSqlScript(`DEFAULT ${text} for ${one.name} is not a literal of its type this compiler carries`);
  };
  // a date or time input is C(8) / C(6) in the IR, but its initial value is
  // its zero digits, not '' (measured on A4H): an OPTIONAL one without a
  // DEFAULT is given that initial value here, so the runtime binds it
  const zeroDigits = (one) => {
    const text = upper(one.abapType).trim();
    const datatype = ["D", "DATS"].includes(text) ? "DATS" : ["T", "TIMS"].includes(text) ? "TIMS"
      : /^ABAP\.(DATS|TIMS)$/.exec(text)?.[1] ?? upper(resolve?.(text)?.DATATYPE ?? "");
    return datatype === "DATS" ? "00000000" : datatype === "TIMS" ? "000000" : undefined;
  };
  const parameters = inputParameters
    .filter((one) => !relationNames.has(upper(one.name)))
    .map((one) => {
      const type = irTypeFromAbap(one.abapType, resolve);
      const given = defaultOf(one, type);
      const zeros = zeroDigits(one);
      // a date/time DEFAULT is checked here, not when a call first omits it:
      // blank is the initial value, anything else must be the digits
      if (zeros !== undefined && given.default !== undefined) {
        if (given.default.trim() === "") given.default = zeros;
        else if (!new RegExp(`^\\d{${zeros.length}}$`).test(given.default)) {
          throw new UnsupportedSqlScript(`DEFAULT '${given.default}' for ${one.name} is not ${zeros.length} digits, so not a ${zeros.length === 8 ? "date" : "time"}`);
        }
      }
      // the kind travels with the parameter, not in the IR type (which the
      // lowering reads as plain C(n)): the runtime binds an explicit initial
      // date/time as its zero digits and refuses a value that is not digits
      const kind = zeros === undefined ? {} : {kind: zeros.length === 8 ? "DATS" : "TIMS"};
      return {name: upper(one.name), type, ...(one.optional === true ? {optional: true} : {}), ...given, ...kind};
    });
  // INTEGER, STRING, and fixed-length character (CHAR, CLNT, DATS, TIMS all
  // arrive as C(n)): what the kernel binds for C was measured on A4H --
  // right-trimmed, '' when initial -- and runProcedure binds the same
  if (parameters.some((one) => !["I", "STRING", "C", "X"].includes(one.type.abap)
      || (["C", "X"].includes(one.type.abap) && !(Number.isInteger(one.type.len) && one.type.len > 0)))) {
    throw new UnsupportedSqlScript("portable procedure inputs support INTEGER, STRING, fixed-length character and fixed-length RAW scalars only");
  }
  const scalarTypes = Object.fromEntries(parameters.map((one) => [one.name, one.type]));
  const arrayValues = Object.create(null);
  const cursorNames = new Set();
  if (output.kind === "scalar") scalarTypes[output.name] = output.type;
  for (const one of output.outputs ?? []) if (one.scalar !== undefined) scalarTypes[one.name] = one.scalar;
  // the order each table variable's rows were given: a table parameter's
  // rows come in the caller's order; an assignment's, in its relation's
  const relationOrders = new Map(parameterOrders);
  const snapshotEnvironment = () => ({
    relations: structuredClone(relationSchemas),
    scalars: structuredClone(scalarTypes),
    orders: structuredClone(relationOrders),
  });
  const restoreObject = (target, source) => {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, structuredClone(source));
  };
  const restoreEnvironment = (snapshot) => {
    restoreObject(relationSchemas, snapshot.relations);
    restoreObject(scalarTypes, snapshot.scalars);
    relationOrders.clear();
    for (const [k, v] of structuredClone(snapshot.orders)) relationOrders.set(k, v);
  };
  const mergeEnvironment = (paths) => {
    const common = (key) => {
      const first = paths[0][key];
      return Object.fromEntries(Object.entries(first).filter(([name, value]) =>
        paths.every((path) => JSON.stringify(path[key][name]) === JSON.stringify(value))));
    };
    restoreObject(relationSchemas, common("relations"));
    restoreObject(scalarTypes, common("scalars"));
    // an order survives the paths meeting only when every path gave the same
    const names = new Set(paths.flatMap((path) => [...path.orders.keys()]));
    relationOrders.clear();
    for (const name of names) {
      const seen = paths.map((path) => path.orders.get(name));
      const same = seen.every((one) => one !== undefined && one.kind === seen[0].kind && one.why === seen[0].why
        && JSON.stringify([...(one.ties ?? [])]) === JSON.stringify([...(seen[0].ties ?? [])]) && (one.ties === null) === (seen[0].ties === null));
      relationOrders.set(name, same ? seen[0] : {kind: "unknown", why: `:${name.toLowerCase()} comes in different orders on different paths`});
    }
  };
  const rowVariables = {};
  const cursors = new Map();
  const openCursors = new Set();
  // scalars declared CONSTANT: an assignment to one does not compile on HANA,
  // whoever writes it -- `=`, a numeric FOR, SELECT ... INTO (each measured on
  // HXE, each in HANA's words); one rule for every writer (the #62 critic)
  const constants = new Set();
  // the scalars this body's DECLAREs introduced (not the parameters)
  const declaredHere = new Set();
  const assertAssignable = (name, node, how) => {
    if (constants.has(name)) {
      throw new UnsupportedSqlScript(`${name} is a CONSTANT, which HANA refuses ${how} ("cannot modify constant variable")`, node);
    }
  };
  // a table variable assigned inside a loop -- WHILE or a numeric FOR -- has,
  // on the next turn, whatever order the last turn gave it, or the one
  // before the loop: unknown throughout, rather than a first turn's order
  // claimed for all (the numeric FOR was missed: the #56 critic)
  const assignedInLoop = (node) => {
    for (const assignment of findAll(node, "Assignment")) {
      const assigned = nameOf(child(assignment, "Name"));
      if (relationOrders.has(assigned) || relationSchemas[assigned] !== undefined) {
        relationOrders.set(assigned, {kind: "unknown", why: `:${assigned.toLowerCase()} is assigned inside a loop`});
      }
    }
  };
  // the variables of the numeric FOR loops being compiled: one inside
  // another over the same variable is not measured, and is refused
  const openRanges = new Set();
  // a table variable is read as a relation, so an ORDER BY at its top is an
  // ORDER BY inside whatever reads it; paths meeting are merged above
  const noteOrder = (name, rel) => relationOrders.set(upper(name), orderOf(rel, relationOrders, false));
  const bind = (node, fragment, targetSchema) => toIr(node, {
    fragment, scalarTypes, relationSchemas, rowVariables, deferTableVariables: true, strictColumns: true,
    signature: method, arrayValues, catalogue, keys: options.keys ?? {}, ...(targetSchema === undefined ? {} : {targetSchema}),
    // the table functions a body may call (tools/sqlscript/table-function-registry.mjs);
    // without it every `FROM "CL=>M"(...)` is refused as not in the registry
    tableFunctions: options.tableFunctions ?? {},
  });

  // HANA refuses a bare BOOLEAN as a condition (`IF :g THEN` is a syntax
  // error, measured on A4H): it wants `IF :g = TRUE`
  const condition = (node) => {
    const bound = bind(node, "condition");
    if (bound?.node === "param") {
      throw new UnsupportedSqlScript(
        `a bare :${String(bound.name).toLowerCase()} is not a condition on HANA (a syntax error there); write :${String(bound.name).toLowerCase()} = TRUE`, node);
    }
    return bound;
  };
  const compileStatements = (container, allowArrayDeclarations = false, returnAllowed = false) => {
    const result = [];
    const directStatements = new Set(["Declare", "Assignment", "While", "If", "Block", "ProcedureCall", "Return", "SetOperation",
      "Delete", "Update", "Insert", "Upsert"]);
    for (const wrapper of container.children ?? []) {
      const node = wrapper.node === "Statement"
        ? (wrapper.children ?? []).find((one) => one.node !== "word")
        : (directStatements.has(wrapper.node) ? wrapper : undefined);
      if (node === undefined) continue;
      if (node.node === "Declare") {
        if ((node.children ?? []).some((one) => one.node === "word" && upper(one.value) === "CURSOR")) {
          if (!allowArrayDeclarations) {
            throw new UnsupportedSqlScript("initial CURSOR declarations must be top-level and unconditional", node);
          }
          const name = nameOf(child(node, "Name"));
          if (scalarTypes[name] !== undefined || relationSchemas[name] !== undefined || cursorNames.has(name)) {
            throw new UnsupportedSqlScript(`duplicate declaration ${name}`, node);
          }
          const occurrences = terminalLeaves(tree).filter((one) =>
            one.node === "identifier" && upper(one.value) === name).length;
          const query = child(node, "SetOperation");
          // a cursor a FOR loop reads is kept as the relation it selects; it
          // is bound where the loop stands, with the variables as they are then
          const usedByFor = findAll(tree, "For").some((loop) => nameOf(children(loop, "Name")[1]) === name);
          if (usedByFor) {
            if (query === undefined) throw new UnsupportedSqlScript("CURSOR declaration requires a query", node);
            cursors.set(name, query);
            cursorNames.add(name);
            continue;
          }
          if (occurrences !== 1) {
            throw new UnsupportedSqlScript("initial CURSOR support is limited to a declared but unused cursor", node);
          }
          if (query === undefined) throw new UnsupportedSqlScript("CURSOR declaration requires a query", node);
          const selects = children(query, "Select");
          const select = selects.length === 1 ? selects[0] : undefined;
          const items = select === undefined ? [] : children(select, "SelectItem");
          const sources = select === undefined ? [] : children(select, "Source");
          const sourceLeaves = sources.length === 1 ? terminalLeaves(sources[0]) : [];
          const directColumns = items.length > 0 && items.every((item) =>
            exactWrapped(child(item, "Expr"), "ColumnRef") !== undefined
            && (item.children ?? []).every((one) => ["Expr", "word"].includes(one.node)));
          const directSource = sourceLeaves.length === 1 && sourceLeaves[0].node === "host"
            && relationNames.has(upper(String(sourceLeaves[0].value).slice(1)));
          const plainSelect = select !== undefined && (select.children ?? []).every((one) =>
            ["word", "SelectItem", "Source"].includes(one.node));
          if (!directColumns || !directSource || !plainSelect) {
            throw new UnsupportedSqlScript(
              "initial unused CURSOR query requires a direct column projection from one table input", node);
          }
          // Binding is still required even though the unopened resource is
          // erased: every projected column must exist and retain its type.
          bind(query, "relation");
          cursorNames.add(name);
          continue;
        }
        if ((node.children ?? []).some((one) => one.node === "word" && upper(one.value) === "ARRAY")) {
          if (!allowArrayDeclarations) {
            throw new UnsupportedSqlScript("initial ARRAY declarations must be top-level and unconditional", node);
          }
          const name = nameOf(child(node, "Name"));
          if (cursorNames.has(name)) throw new UnsupportedSqlScript(`duplicate declaration ${name}`, node);
          if (Object.keys(arrayValues).length > 0) {
            throw new UnsupportedSqlScript("initial portable subset supports one ARRAY declaration exactly", node);
          }
          if (arrayValues[name] !== undefined) throw new UnsupportedSqlScript(`duplicate ARRAY declaration ${name}`, node);
          const typeNode = child(node, "TypeName");
          const typeLeaves = terminalLeaves(typeNode);
          const typeName = nameOf(typeNode);
          if (typeLeaves.length !== 1 || typeLeaves[0].node !== "identifier"
              || !["INT", "INTEGER"].includes(typeName)) {
            throw new UnsupportedSqlScript("initial ARRAY support is limited to INTEGER elements exactly", node);
          }
          const constructor = exactWrapped(child(node, "Expr"), "FunctionCall");
          if (constructor === undefined || nameOf(constructor) !== "ARRAY") {
            throw new UnsupportedSqlScript("ARRAY declaration requires an ARRAY(...) constructor", node);
          }
          if ((constructor.children ?? []).some((one) => !["identifier", "word", "Expr"].includes(one.node))
              || children(constructor, "identifier").length !== 1) {
            throw new UnsupportedSqlScript("ARRAY constructor decorations are outside the fixed portable subset", constructor);
          }
          const values = children(constructor, "Expr").map((one) =>
            isBareNull(one) ? lit(null, T.int) : bind(one, "expression"));
          if (values.length === 0) throw new UnsupportedSqlScript("empty ARRAY constructor is not supported yet", node);
          if (values.some((one) => one.node !== "lit" || JSON.stringify(one.type) !== JSON.stringify(T.int))) {
            throw new UnsupportedSqlScript("initial ARRAY constructor values must be INTEGER literals or NULL exactly", node);
          }
          if (values.some((one) => one.value != null
              && (!Number.isInteger(one.value) || one.value < -2147483648 || one.value > 2147483647))) {
            throw new UnsupportedSqlScript("ARRAY constructor literal is outside SQLScript INTEGER", node);
          }
          arrayValues[name] = values;
          continue;
        }
        if (child(node, "ColumnDef") !== undefined || (node.children ?? []).some((one) =>
          one.node === "word" && upper(one.value) === "TABLE")) {
          throw new UnsupportedSqlScript("only scalar DECLARE belongs to the initial portable subset", node);
        }
        const name = nameOf(child(node, "Name"));
        if (cursorNames.has(name)) throw new UnsupportedSqlScript(`duplicate declaration ${name}`, node);
        // measured on HXE: "at most one declaration is permitted in the
        // declaration section"
        if (scalarTypes[name] !== undefined && declaredHere.has(name)) {
          throw new UnsupportedSqlScript(`${name} is declared twice, which HANA refuses ("at most one declaration is permitted")`, node);
        }
        declaredHere.add(name);
        const type = declaredScalarType(child(node, "TypeName"), node);
        scalarTypes[name] = type;
        if ((node.children ?? []).some((one) => one.node === "word" && upper(one.value) === "CONSTANT")) constants.add(name);
        const initialNode = child(node, "Expr");
        result.push(declareScalar(name, type,
          initialNode === undefined ? undefined : bind(initialNode, "expression"), node));
      } else if (["Delete", "Update", "Insert", "Upsert"].includes(node.node)) {
        // a write to a database table: the method must not be READ-ONLY (HANA
        // creates such a procedure READS SQL DATA, which cannot modify)
        // measured on HXE: "INSERT/UPDATE/DELETE is/are not supported in
        // read-only procedure" and "... in table function"
        if (method?.readOnly === true) {
          throw new UnsupportedSqlScript(`${node.node.toUpperCase()} in a READ-ONLY method, which HANA refuses ("not supported in read-only procedure")`, node);
        }
        if (upper(method?.dbKind ?? "") === "FUNCTION" || method?.tableFunction !== undefined) {
          throw new UnsupportedSqlScript(`${node.node.toUpperCase()} in a FUNCTION, which HANA refuses ("not supported in table function")`, node);
        }
        result.push(writeTable(bind(node, "write"), node));
      } else if (node.node === "Assignment") {
        const name = nameOf(child(node, "Name"));
        assertAssignable(name, node, "to assign");
        const unnest = child(node, "UnnestCall");
        if (unnest !== undefined) {
          const host = (unnest.children ?? []).find((one) => one.node === "host");
          const arrayName = upper(String(host?.value ?? "").slice(1));
          const values = arrayValues[arrayName];
          if (!Array.isArray(values)) {
            throw new UnsupportedSqlScript(`UNNEST refers to unknown array :${arrayName.toLowerCase()}`, unnest);
          }
          const names = children(unnest, "Name").map(nameOf);
          if (names.length !== 2) {
            throw new UnsupportedSqlScript("UNNEST WITH ORDINALITY requires value and position column names", unnest);
          }
          if (names[0] === names[1]) {
            throw new UnsupportedSqlScript("UNNEST WITH ORDINALITY column names must be distinct", unnest);
          }
          const rows = values.map((value, index) => project(scan("DUMMY"), [
            {as: names[0], expr: value}, {as: names[1], expr: lit(index + 1, T.int)},
          ]));
          const rel = rows.length === 1 ? rows[0] : union(rows, true);
          relationSchemas[name] = {[names[0]]: T.int, [names[1]]: T.int};
          noteOrder(name, rel);
          result.push(assignRelation(name, rel, node));
          continue;
        }
        const set = child(node, "SetOperation");
        if (set !== undefined) {
          // the output's declared schema types a bare NULL assigned to it
          const rel = bind(set, "relation", outputSchemaOf(name));
          try { relationSchemas[name] = schemaOf(rel, catalogue); }
          catch (error) { throw new UnsupportedSqlScript(`cannot prove schema assigned to ${name}: ${error.message}`, node); }
          noteOrder(name, rel);
          result.push(assignRelation(name, rel, node));
        }
        else {
          if (scalarTypes[name] === undefined) {
            throw new UnsupportedSqlScript(`assignment to undeclared scalar ${name}`, node);
          }
          result.push(assignScalar(name, bind(child(node, "Expr"), "expression"), node));
        }
      } else if (node.node === "ProcedureCall") {
        if (output.kind !== "relation") {
          throw new UnsupportedSqlScript("initial nested CALL requires a table output", node);
        }
        if (Array.isArray(output.outputs)) {
          throw new UnsupportedSqlScript("a nested CALL inside a procedure of several outputs is not carried yet", node);
        }
        const procedureNode = child(node, "ColumnRef");
        const procedureLeaves = terminalLeaves(procedureNode);
        const hosts = children(node, "host");
        const expressions = children(node, "Expr");
        if (procedureLeaves.length !== 1 || !["quoted", "identifier"].includes(procedureLeaves[0]?.node)
            || hosts.length !== 1 || expressions.length !== 1) {
          throw new UnsupportedSqlScript(
            "initial nested CALL requires one unqualified procedure, one table input and one table output", node);
        }
        const input = upper(String(hosts[0].value).slice(1));
        const outputExpr = exactWrapped(expressions[0], "ColumnRef");
        const outputLeaves = terminalLeaves(outputExpr);
        const calledOutput = outputLeaves.length === 1 ? upper(outputLeaves[0].value) : "";
        if (relationSchemas[input] === undefined) {
          throw new UnsupportedSqlScript(`nested CALL input :${input.toLowerCase()} is not a typed relation`, node);
        }
        if (calledOutput !== output.name) {
          throw new UnsupportedSqlScript(
            "initial nested CALL must write directly to the enclosing procedure output", node);
        }
        relationSchemas[calledOutput] = structuredClone(output.schema);
        result.push(callProcedure(procedureLeaves[0].value, input, calledOutput, node));
      } else if (node.node === "For" && child(node, "ForRange") !== undefined) {
        // measured on HXE: the variable must be declared (else "identifier
        // must be declared"), and a bound must be an integer (a DECIMAL or a
        // NULL does not compile)
        const name = nameOf(children(node, "Name")[0]);
        const type = scalarTypes[name];
        assertAssignable(name, node, "as a FOR variable");
        if (type === undefined) throw new UnsupportedSqlScript(`FOR ${name} IN ...: ${name} is not declared, which HANA refuses`, node);
        if (!((type.abap === "I" && type.bits === undefined) || type.abap === "INT8")) {
          throw new UnsupportedSqlScript(`FOR ${name} IN ...: the loop variable is ${type.abap}, not INTEGER or BIGINT`, node);
        }
        const range = child(node, "ForRange");
        const [fromNode, toNode] = children(range, "Expr");
        const bound = (one) => {
          const e = bind(one, "expression");
          if (!["I", "INT8"].includes(e?.type?.abap)) throw new UnsupportedSqlScript(`FOR ${name}: a bound of type ${e?.type?.abap ?? "NULL"} is not an integer, which HANA refuses`, node);
          return e;
        };
        const reverse = (range.children ?? []).some((one) => one.node === "word" && upper(one.value) === "REVERSE");
        if (openRanges.has(name)) throw new UnsupportedSqlScript(`a FOR over ${name} inside a FOR over ${name} is not measured`, node);
        assignedInLoop(node);
        const from = bound(fromNode);
        const to = bound(toNode);
        openRanges.add(name);
        let body;
        try { body = compileStatements({children: children(node, "Statement")}); } finally { openRanges.delete(name); }
        result.push(forRange(name, from, to, reverse, body, node));
      } else if (node.node === "For") {
        const [rowName, cursorName] = children(node, "Name").map(nameOf);
        const query = cursors.get(cursorName);
        if (query === undefined) throw new UnsupportedSqlScript(`FOR over ${cursorName}, which is not a cursor declared here`, node);
        if (children(node, "Expr").length > 0) throw new UnsupportedSqlScript("a cursor with arguments is not carried yet", node);
        if (rowVariables[rowName] !== undefined) throw new UnsupportedSqlScript(`a FOR loop inside another over the same row name ${rowName}`, node);
        // HANA opens a cursor once; a loop over it inside a loop over it is
        // not measured, and is refused
        if (openCursors.has(cursorName)) throw new UnsupportedSqlScript(`a FOR loop over cursor ${cursorName} inside a loop over it`, node);
        const cursor = bind(query, "relation");
        let schema;
        try { schema = schemaOf(cursor, catalogue); }
        catch (error) { throw new UnsupportedSqlScript(`cannot prove the schema of cursor ${cursorName}: ${error.message}`, node); }
        const order = orderOf(cursor, relationOrders);
        if (order.kind === "unknown") {
          const refusal = new UnsupportedSqlScript(`FOR over cursor ${cursorName}: its rows come in no order HANA guarantees (${order.why})`, node);
          refusal.reason = "order";
          throw refusal;
        }
        const unsorted = order.ties === null || order.ties === undefined ? []
          : Object.keys(schema).filter((column) => !order.ties.has(upper(column)));
        if (unsorted.length > 0) {
          const refusal = new UnsupportedSqlScript(`FOR over cursor ${cursorName}: its rows are sorted by ${[...order.ties].join(", ") || "nothing it reads"}, and rows equal in those come in any order, while its row carries ${unsorted.join(", ")} too (every column of the row counts as read)`, node);
          refusal.reason = "order";
          throw refusal;
        }
        // a table assigned inside the loop is unknown to every cursor inside
        // it, as in a WHILE (the #59 critic: only WHILE and a numeric FOR did)
        assignedInLoop(node);
        rowVariables[rowName] = schema;
        for (const [column, type] of Object.entries(schema)) scalarTypes[`${rowName}.${column}`] = type;
        openCursors.add(cursorName);
        const body = compileStatements({children: children(node, "Statement")});
        openCursors.delete(cursorName);
        delete rowVariables[rowName];
        for (const column of Object.keys(schema)) delete scalarTypes[`${rowName}.${column}`];
        // a table the cursor reads, assigned while the loop runs over it: which
        // rows the loop then sees is not measured, and is refused
        const readByCursor = new Set();
        const collectVars = (r) => {
          if (r === null || typeof r !== "object") return;
          if (r.rel === "var") readByCursor.add(upper(r.name));
          for (const v of Object.values(r)) (Array.isArray(v) ? v : [v]).forEach(collectVars);
        };
        collectVars(cursor);
        // an assignment or a CALL's output, in any block of the body
        const assigns = (statements) => statements.some((one) => (one.stmt === "assign-relation" && readByCursor.has(upper(one.name)))
          || (one.stmt === "call-procedure" && readByCursor.has(upper(one.output)))
          || childBodies(one).some(assigns));
        if (assigns(body)) throw new UnsupportedSqlScript(`FOR over cursor ${cursorName}: a table it reads is assigned inside the loop`, node);
        result.push(forCursor(rowName, cursorName, cursor, schema, body, order, node));
      } else if (node.node === "While") {
        assignedInLoop(node);
        result.push(whileLoop(condition(child(node, "Condition")), compileStatements(node), node));
      } else if (node.node === "Block") {
        const mode = (node.children ?? []).filter((one) => one.node === "word")
          .map((one) => upper(one.value)).filter((one) => !["BEGIN", "END", ";"].includes(one));
        // A nested BEGIN ... END (plain, or SEQUENTIAL EXECUTION, which only
        // forbids parallelism) that declares nothing is no scope at all: its
        // statements are the enclosing body's. One that declares opens a
        // scope -- shadowing, a variable gone at END, an EXIT HANDLER -- and
        // that is not measured yet, so it is refused by name.
        const statements = children(node, "Statement");
        if (mode.length !== 0 && JSON.stringify(mode) !== JSON.stringify(["SEQUENTIAL", "EXECUTION"])) {
          throw new UnsupportedSqlScript(`a nested BEGIN ${mode.join(" ")} block is not carried yet`, node);
        }
        // every DECLARE the grammar reads (a scalar, a table, a cursor)
        // arrives as a Declare node; a handler or a label does not parse
        if (statements.some((one) => (one.children ?? []).some((part) => part.node === "Declare"))) {
          throw new UnsupportedSqlScript("a nested block with its own DECLARE opens a scope, which is not carried yet", node);
        }
        result.push(...compileStatements({children: statements}));
      } else if (node.node === "If") {
        const before = snapshotEnvironment();
        const branches = [];
        const paths = [];
        let current;
        let otherwise = [];
        const finish = () => {
          if (current === undefined) return;
          // Each arm begins from the same pre-IF environment. Compiling an
          // earlier arm must not leak its table/scalar types into a later
          // arm. Only identical facts on every reachable path survive.
          restoreEnvironment(before);
          const body = compileStatements({children: current.statements});
          paths.push(snapshotEnvironment());
          if (current.condition === undefined) otherwise = body;
          else branches.push({condition: current.condition, body});
        };
        for (const part of node.children ?? []) {
          const word = part.node === "word" ? upper(part.value) : undefined;
          if (word === "IF" || word === "ELSEIF") {
            finish();
            current = {condition: null, statements: []};
          } else if (word === "ELSE") {
            finish();
            current = {condition: undefined, statements: []};
          } else if (word === "END") {
            finish();
            current = undefined;
            break;
          } else if (part.node === "Condition" && current?.condition === null) {
            restoreEnvironment(before);
            current.condition = condition(part);
          } else if (part.node === "Statement" && current !== undefined) {
            current.statements.push(part);
          }
        }
        if (branches.length === 0 || branches.some((branch) => branch.condition == null)) {
          throw new UnsupportedSqlScript("IF has no complete conditional branch", node);
        }
        if (otherwise.length === 0) paths.push(before);
        mergeEnvironment(paths);
        result.push(ifElse(branches, otherwise, node));
      } else if (node.node === "SetOperation" && children(node, "Select").some((one) => child(one, "IntoClause") !== undefined)) {
        // `SELECT ... INTO a, b [DEFAULT x, y] FROM ...;` -- one select, its
        // columns into declared scalars of the same measured type
        const selects = children(node, "Select");
        if (selects.length !== 1) throw new UnsupportedSqlScript("SELECT ... INTO inside a set operation", node);
        const into = child(selects[0], "IntoClause");
        const targets = children(into, "Name").map(nameOf);
        const defaultNodes = children(into, "Expr");
        // the same tree without its INTO, bound as the relation it reads
        const bare = {...node, children: (node.children ?? []).map((one) => one === selects[0]
          ? {...one, children: (one.children ?? []).filter((kid) => kid !== into)} : one)};
        const rel = bind(bare, "relation");
        let shape;
        try { shape = Object.entries(schemaOf(rel, catalogue)); }
        catch (error) { throw new UnsupportedSqlScript(`cannot prove the columns of SELECT ... INTO: ${error.message}`, node); }
        if (shape.length !== targets.length) {
          throw new UnsupportedSqlScript(`SELECT ... INTO names ${targets.length} target(s) for ${shape.length} column(s)`, node);
        }
        if (defaultNodes.length > 0 && defaultNodes.length !== targets.length) {
          throw new UnsupportedSqlScript(`SELECT ... INTO has ${defaultNodes.length} DEFAULT value(s) for ${targets.length} target(s)`, node);
        }
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        targets.forEach((target, i) => {
          if (scalarTypes[target] === undefined) throw new UnsupportedSqlScript(`SELECT ... INTO undeclared scalar ${target}`, node);
          assertAssignable(target, node, "as an INTO target");
          // BIGINT into an INTEGER scalar: `SELECT COUNT(*) INTO lv` with
          // lv INTEGER compiles and assigns on A4H; the value is range-checked
          const narrowing = shape[i][1]?.abap === "INT8" && same(scalarTypes[target], T.int);
          if (!narrowing && !assignable(shape[i][1], scalarTypes[target])) {
            throw new UnsupportedSqlScript(`SELECT ... INTO ${target}: column ${i + 1} (${shape[i][0]}) is ${shape[i][1]?.abap ?? "untyped"}, the scalar ${scalarTypes[target].abap}; not an identical measured type`, node);
          }
        });
        const defaults = defaultNodes.length === 0 ? undefined : defaultNodes.map((one, i) => {
          const e = bind(one, "expression");
          if (!same(e.type, scalarTypes[targets[i]])) {
            throw new UnsupportedSqlScript(`SELECT ... INTO DEFAULT for ${targets[i]} is not of the scalar's type`, one);
          }
          return e;
        });
        result.push(selectInto(rel, targets, defaults, node));
      } else if (node.node === "Return" && returnAllowed && output.kind === "relation"
          && wrapper === (container.children ?? []).filter((one) => one.node === "Statement" || directStatements.has(one.node)).at(-1)) {
        // `RETURN SELECT ...` / `RETURN :lt` as the LAST statement of the body
        // is how a table function answers: an assignment to its output. A
        // RETURN anywhere else would end the procedure early, which the
        // procedural IR has no statement for, so it stays refused.
        const set = child(node, "SetOperation");
        let rel;
        if (set !== undefined) {
          rel = bind(set, "relation", output.schema);
        } else {
          const host = terminalLeaves(node).find((one) => one.node === "host");
          const only = terminalLeaves(node).filter((one) => one.node !== "word" && upper(one.value) !== "RETURN");
          if (host === undefined || only.length !== 1) {
            throw new UnsupportedSqlScript("RETURN of something that is not a table variable or a select", node);
          }
          const name = upper(String(host.value).slice(1));
          if (relationSchemas[name] === undefined) throw new UnsupportedSqlScript(`RETURN of an unassigned table variable :${name.toLowerCase()}`, node);
          rel = varRef(name, relationSchemas[name]);
        }
        result.push(assignRelation(output.name, rel, node));
      } else {
        throw new UnsupportedSqlScript(`${node.node} is outside the initial portable procedural subset`, node);
      }
    }
    return result;
  };

  try {
    // A body wrapped whole in `BEGIN ... END` (plain, or SEQUENTIAL
    // EXECUTION) is the procedure's own scope, as table functions write it:
    // its statements are the body. A nested block is inlined by the rule in
    // compileStatements (measured on A4H: it shares the procedure's variables).
    const topStatements = (tree.children ?? []).filter((one) => one.node === "Statement");
    const onlyNode = topStatements.length === 1 ? (topStatements[0].children ?? []).find((one) => one.node !== "word") : undefined;
    const wrapperMode = onlyNode?.node === "Block"
      ? (onlyNode.children ?? []).filter((one) => one.node === "word").map((one) => upper(one.value)).filter((one) => !["BEGIN", "END", ";"].includes(one))
      : undefined;
    const outer = wrapperMode !== undefined && (wrapperMode.length === 0 || JSON.stringify(wrapperMode) === JSON.stringify(["SEQUENTIAL", "EXECUTION"]))
      ? {children: children(onlyNode, "Statement")} : tree;
    const body = compileStatements(outer, true, true);
    if (output.kind === "scalar" && (relationParameters.length > 0 || containsRelationStatement(body)) && !readsRelations(body)) {
      throw new UnsupportedSqlScript("scalar-only portable functions cannot contain relational inputs or statements");
    }
    // every OUT table must be assigned somewhere in the body, or HANA does not
    // compile the procedure (measured on A4H, in its words) -- one OUT as much
    // as several; a CALL whose output is the OUT assigns it
    if (output.kind === "relation") {
      const assigned = new Set();
      const walk = (statements) => {
        for (const one of statements) {
          if (one.stmt === "assign-relation") assigned.add(one.name);
          if (one.stmt === "call-procedure") assigned.add(one.output);
          childBodies(one).forEach(walk);
        }
      };
      walk(body);
      const missing = (output.outputs ?? [output]).filter((one) => one.scalar === undefined).find((one) => !assigned.has(one.name));
      if (missing !== undefined) throw new UnsupportedSqlScript(`some out table variable is not assigned: ${missing.name}`);
    }
    return procedure({parameters, relationParameters, body, output: output.name,
      ...(output.initialWhenUnassigned === true ? {outputInitialWhenUnassigned: true} : {}),
      ...(Array.isArray(output.outputs) ? {outputs: output.outputs} : {}),
      outputSchema: output.kind === "relation" ? output.schema : undefined,
      outputType: output.kind === "scalar" ? output.type : undefined,
      catalogue});
  } catch (error) {
    if (error instanceof UnsupportedSqlScript) throw error;
    if (error instanceof BindError) throw new UnsupportedSqlScript(error.message, error);
    throw error;
  }
}
