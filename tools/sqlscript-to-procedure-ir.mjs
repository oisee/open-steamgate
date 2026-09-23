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
import {procedure, declareScalar, assignScalar, assignRelation, whileLoop,
  ifElse, callProcedure, UnsupportedSqlScript} from "./sqlscript-procedure-ir.mjs";

const upper = (value) => String(value).toUpperCase();
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
const MEASURED_DATATYPES = new Set(["CHAR", "CLNT", "DATS", "TIMS", "INT4", "STRG", "DEC", "RAW"]);
export function irTypeFromAbap(type, resolve) {
  const text = upper(type).trim();
  if (["I", "INT4", "INTEGER"].includes(text)) return T.int;
  if (["STRING", "SSTRING"].includes(text)) return T.str;
  if (["D", "DATS"].includes(text)) return T.char(8);
  if (["T", "TIMS"].includes(text)) return T.char(6);
  const length = /^(?:C\s+LENGTH\s+|CHAR)(\d+)$/.exec(text)?.[1];
  if (length !== undefined) return T.char(Number(length));
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
  if (outputs.length !== 1 || !["OUT", "RETURNING"].includes(outputs[0]?.direction)) {
    throw new UnsupportedSqlScript("initial portable procedures require exactly one OUT or RETURNING output parameter");
  }
  const parameter = outputs[0];
  const schema = structuredTable(parameter.abapType, types, resolve, store);
  if (schema !== undefined) return {name: upper(parameter.name), kind: "relation", schema};
  if (parameter.direction === "RETURNING") {
    const type = irTypeFromAbap(parameter.abapType, resolve);
    if (type.abap !== "I") {
      throw new UnsupportedSqlScript("initial scalar RETURNING support is limited to ABAP INTEGER exactly");
    }
    return {name: upper(parameter.name), kind: "scalar", type};
  }
  throw new UnsupportedSqlScript(`output ${parameter.name} is not a resolved structured table type`);
}

/** Compile one extracted AMDP method without changing its source body. */
export function compileProcedure(method, types, options = {}) {
  const catalogue = options.catalogue ?? {};
  const resolve = options.resolveType;
  const store = options.store;
  const tree = parse(new Body(), lex(method.body));
  const output = outputFrom(method, types, resolve, store);
  const inputParameters = method.parameters.filter((one) => one.direction === "IN");
  const relationCandidates = inputParameters
    .map((one) => ({one, schema: structuredTable(one.abapType, types, resolve, store)}))
    .filter(({schema}) => schema !== undefined);
  if (relationCandidates.some(({one}) => one.optional === true)) {
    throw new UnsupportedSqlScript("initial OPTIONAL support is limited to ABAP INTEGER or STRING scalars");
  }
  const relationParameters = relationCandidates.map(({one, schema}) => ({name: upper(one.name), schema}));
  const relationNames = new Set(relationParameters.map((one) => one.name));
  const relationSchemas = Object.fromEntries(relationParameters.map((one) => [one.name, one.schema]));
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
      const initial = one.optional === true && given.default === undefined && zeros !== undefined ? {default: zeros} : {};
      // the kind travels with the parameter, not in the IR type (which the
      // lowering reads as plain C(n)): the runtime binds an explicit initial
      // date/time as its zero digits and refuses a value that is not digits
      const kind = zeros === undefined ? {} : {kind: zeros.length === 8 ? "DATS" : "TIMS"};
      return {name: upper(one.name), type, ...(one.optional === true ? {optional: true} : {}), ...given, ...initial, ...kind};
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
  const snapshotEnvironment = () => ({
    relations: structuredClone(relationSchemas),
    scalars: structuredClone(scalarTypes),
  });
  const restoreObject = (target, source) => {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, structuredClone(source));
  };
  const restoreEnvironment = (snapshot) => {
    restoreObject(relationSchemas, snapshot.relations);
    restoreObject(scalarTypes, snapshot.scalars);
  };
  const mergeEnvironment = (paths) => {
    const common = (key) => {
      const first = paths[0][key];
      return Object.fromEntries(Object.entries(first).filter(([name, value]) =>
        paths.every((path) => JSON.stringify(path[key][name]) === JSON.stringify(value))));
    };
    restoreObject(relationSchemas, common("relations"));
    restoreObject(scalarTypes, common("scalars"));
  };
  const bind = (node, fragment, targetSchema) => toIr(node, {
    fragment, scalarTypes, relationSchemas, deferTableVariables: true, strictColumns: true,
    signature: method, arrayValues, catalogue, ...(targetSchema === undefined ? {} : {targetSchema}),
  });

  const compileStatements = (container, allowArrayDeclarations = false, returnAllowed = false) => {
    const result = [];
    const directStatements = new Set(["Declare", "Assignment", "While", "If", "Block", "ProcedureCall", "Return", "SetOperation"]);
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
          if (occurrences !== 1) {
            throw new UnsupportedSqlScript("initial CURSOR support is limited to a declared but unused cursor", node);
          }
          const query = child(node, "SetOperation");
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
        const type = bind(child(node, "TypeName"), "type");
        if (type.abap !== "I" || !["INT", "INTEGER"].includes(nameOf(child(node, "TypeName")))) {
          throw new UnsupportedSqlScript("initial portable DECLARE supports only INTEGER exactly", node);
        }
        scalarTypes[name] = type;
        const initialNode = child(node, "Expr");
        result.push(declareScalar(name, type,
          initialNode === undefined ? undefined : bind(initialNode, "expression"), node));
      } else if (node.node === "Assignment") {
        const name = nameOf(child(node, "Name"));
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
          result.push(assignRelation(name, rel, node));
          continue;
        }
        const set = child(node, "SetOperation");
        if (set !== undefined) {
          // the output's declared schema types a bare NULL assigned to it
          const rel = bind(set, "relation", name === output.name && output.kind === "relation" ? output.schema : undefined);
          try { relationSchemas[name] = schemaOf(rel, catalogue); }
          catch (error) { throw new UnsupportedSqlScript(`cannot prove schema assigned to ${name}: ${error.message}`, node); }
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
      } else if (node.node === "While") {
        result.push(whileLoop(bind(child(node, "Condition"), "condition"), compileStatements(node), node));
      } else if (node.node === "Block") {
        const mode = (node.children ?? []).filter((one) => one.node === "word")
          .map((one) => upper(one.value)).filter((one) => !["BEGIN", "END", ";"].includes(one));
        const statements = children(node, "Statement");
        const statement = statements.length === 1
          ? (statements[0].children ?? []).find((one) => one.node !== "word")
          : undefined;
        const assignsOutput = statement?.node === "Assignment"
          && nameOf(child(statement, "Name")) === output.name;
        if (JSON.stringify(mode) !== JSON.stringify(["SEQUENTIAL", "EXECUTION"]) || !assignsOutput) {
          throw new UnsupportedSqlScript(
            "initial block support requires BEGIN SEQUENTIAL EXECUTION with exactly one assignment to the procedure output", node);
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
            current.condition = bind(part, "condition");
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
    // its statements are the body. A nested block keeps the narrow rule.
    const topStatements = (tree.children ?? []).filter((one) => one.node === "Statement");
    const onlyNode = topStatements.length === 1 ? (topStatements[0].children ?? []).find((one) => one.node !== "word") : undefined;
    const wrapperMode = onlyNode?.node === "Block"
      ? (onlyNode.children ?? []).filter((one) => one.node === "word").map((one) => upper(one.value)).filter((one) => !["BEGIN", "END", ";"].includes(one))
      : undefined;
    const outer = wrapperMode !== undefined && (wrapperMode.length === 0 || JSON.stringify(wrapperMode) === JSON.stringify(["SEQUENTIAL", "EXECUTION"]))
      ? {children: children(onlyNode, "Statement")} : tree;
    const body = compileStatements(outer, true, true);
    const containsRelationStatement = (statements) => statements.some((statement) =>
      statement.stmt === "assign-relation"
        || statement.stmt === "call-procedure"
        || (statement.stmt === "while" && containsRelationStatement(statement.body ?? []))
        || (statement.stmt === "if" && (statement.branches ?? []).some((branch) =>
          containsRelationStatement(branch.body ?? []))
          || (statement.stmt === "if" && containsRelationStatement(statement.otherwise ?? []))));
    if (output.kind === "scalar" && (relationParameters.length > 0 || containsRelationStatement(body))) {
      throw new UnsupportedSqlScript("scalar-only portable functions cannot contain relational inputs or statements");
    }
    return procedure({parameters, relationParameters, body, output: output.name,
      outputSchema: output.kind === "relation" ? output.schema : undefined,
      outputType: output.kind === "scalar" ? output.type : undefined,
      catalogue});
  } catch (error) {
    if (error instanceof UnsupportedSqlScript) throw error;
    if (error instanceof BindError) throw new UnsupportedSqlScript(error.message, error);
    throw error;
  }
}
