// Stage 3 of the SQLScript front end: the syntax tree into the IR.
//
// Two jobs, kept apart on purpose (docs/sqlscript-parser-style.md):
//
//   the binder   turns `FROM :lt1` into the plan `lt1` names. An assignment
//                to a table variable is **not an observable barrier** on HANA
//                (docs/sqlscript-hana-observed.md), so a chain of three
//                assignments is one plan with two of them spliced in, not
//                three statements. Where a barrier did materialise the
//                variable, the binder substitutes `ref(handle)` instead.
//   the typer    puts a `type` on every expression, because the lowering
//                chooses the **form** by it -- a division has no correct
//                rendering in any dialect until the result type is known.
//
// The catalogue is an argument, not an import. The typer needs the type of a
// column, which only a dictionary knows, but taking that from the runtime
// would make this stage depend on a running system; a plain
// `{TABLE: {COLUMN: type}}` keeps it a pure function of its inputs and lets a
// test state the schema it is talking about.
//
// What it refuses, it refuses by name. A construct this stage does not
// understand must not come out as something close to the truth: the whole
// point of the IR is that the lowering can trust the node names.

import {tableFunctionCall, T, col, lit, param, sessionValue, bin, call, cast, not, like, inList, caseWhen,
  subquery, scan, alias, refTo, filter, project, join, union, except, order, limit, aggregate,
  varRef, schemaOf} from "../sqlscript-ir.mjs";
import {isTableParameter, signatureScalars, isUnresolved} from "./scalar-types.mjs";

/** Functions that compute over a group. A window function with an `OVER`
 *  clause is **not** one of these even when it is spelt the same -- it
 *  computes per row over a frame, and putting it in the aggregate half of a
 *  GROUP BY would be a different statement. */
const AGGREGATE_FUNCTIONS = new Set([
  "COUNT", "SUM", "MIN", "MAX", "AVG", "STRING_AGG", "GROUP_CONCAT",
]);
const SESSION_VALUE_NAMES = new Set([
  "CURRENT_USER", "CURRENT_SCHEMA", "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP",
]);

export class BindError extends Error {
  constructor(message, node) {
    const where = node?.line === undefined ? "" : `: line ${node.line} col ${node.col}`;
    super(`${message}${where}`);
    this.line = node?.line;
    this.col = node?.col;
  }
}

/** the children of a syntax node, by node name */
const kids = (node, name) => (node.children ?? []).filter((c) => c.node === name);
const kid = (node, name) => kids(node, name)[0];
const words = (node) => (node.children ?? []).filter((c) => c.node === "word").map((w) => String(w.value).toUpperCase());
/** every descendant word, for the keywords a construct is made of */
const hasWord = (node, word) => {
  if (node.node === "word" && String(node.value).toUpperCase() === word) return true;
  return (node.children ?? []).some((c) => hasWord(c, word));
};
/** the first token-ish leaf of a node, which is what a Name or Value is */
const leaf = (node) => {
  if (node.value !== undefined) return node;
  for (const c of node.children ?? []) {
    const found = leaf(c);
    if (found !== undefined) return found;
  }
  return undefined;
};

const nameOf = (node) => String(leaf(node)?.value ?? "").toUpperCase();

/** a literal's ABAP type, from what it is written as */
function literalType(token) {
  if (token.node === "number") {
    return String(token.value).includes(".") ? T.dec(15, 2) : T.int;
  }
  return T.char(String(token.value).length);
}

const measuredTextType = (type) => {
  if (type?.abap === "STRING") return Object.keys(type).length === 1;
  // a declared NVARCHAR(n) variable is C of n marked `variable` (never padded)
  const keys = Object.keys(type ?? {}).filter((key) => !(key === "variable" && type.variable === true));
  return type?.abap === "C" && keys.length === 2
    && Number.isSafeInteger(type.len) && type.len >= 0;
};

const mergedTextType = (left, right) => {
  if (!measuredTextType(left) || !measuredTextType(right)) return undefined;
  if (left.abap === "STRING" || right.abap === "STRING") return T.str;
  const merged = T.char(Math.max(Number(left.len), Number(right.len)));
  return left.variable === true || right.variable === true ? {...merged, variable: true} : merged;
};

export function toIr(tree, options = {}) {
  const catalogue = options.catalogue ?? {};
  const relationSchemas = options.relationSchemas ?? {};
  // the rows a FOR loop is over: loop variable -> the cursor's schema
  const rowVariables = options.rowVariables ?? {};
  // The method signature, which is where fifteen refusals turned out to come
  // from (docs/sqlscript-corpus.md). An AMDP procedure answers through its
  // OUT table parameter -- it assigns and never selects at the end -- and
  // its IN table parameters are unassigned in the body because they arrive
  // from the caller. Without the signature both look like defects in the
  // body, and neither is.
  const signature = options.signature ?? {parameters: []};
  const tableParams = (signature.parameters ?? []).filter(isTableParameter);
  // The scalar IN parameters come from the same signature. A caller that
  // already typed them (the procedure compiler) passes `scalarTypes`; the
  // others get them derived here, so that "unknown scalar :p_clnt" means the
  // body and not the instrument (docs/sqlscript-corpus.md). One that the
  // dictionary at hand cannot type is refused **when referenced**, by name.
  const derived = options.scalarTypes === undefined ? signatureScalars(signature, options.resolveType) : {types: {}, unresolved: {}};
  const scalarTypes = options.scalarTypes ?? derived.types;
  const unresolvedScalars = derived.unresolved;
  const outParam = tableParams.find((p) => p.direction === "OUT" || p.direction === "RETURNING");
  /** table variables assigned so far: name -> {rel} or {handle} */
  const bound = new Map();
  /** the table a bare column belongs to, while a SELECT is being read */
  let columns = {};
  let ambiguousColumns = new Set();
  let qualifiedColumns = Object.create(null);

  const terminalLeaves = (n, found = []) => {
    if (n?.value !== undefined) found.push(n);
    else for (const one of n?.children ?? []) terminalLeaves(one, found);
    return found;
  };
  /** the projection that decides a relation's columns, through the wrappers
   *  that keep them (order, limit); hints and DISTINCT ride on the project node itself */
  const projectionOf = (rel) => {
    let r = rel;
    while (r !== undefined && (r.rel === "order" || r.rel === "limit")) r = r.input;
    return r?.rel === "project" ? r : undefined;
  };
  const withItems = (rel, items) => {
    if (rel.rel === "project") return {...rel, items};
    return {...rel, input: withItems(rel.input, items)};
  };
  const giveType = (expr, type) => (expr?.untyped === true && type !== undefined && !isUnresolved(type)
    ? {...expr, type, untyped: undefined} : expr);
  /** `SELECT 'k' AS key, NULL AS context FROM dummy UNION ALL SELECT key, ctx
   *  FROM t`: the columns of a UNION are positional, and a bare NULL in one
   *  branch takes the type of the first branch that types that column --
   *  which is how HANA types it (the corpus bodies, 2026-09-23). A column that
   *  is NULL in every branch stays untyped and is refused at the end. */
  const typeNullsAcross = (branches) => {
    const projections = branches.map(projectionOf);
    if (projections.some((one) => one === undefined)) return branches;
    const width = projections[0].items.length;
    if (projections.some((one) => one.items.length !== width)) return branches;
    const types = [];
    for (let i = 0; i < width; i += 1) {
      types.push(projections.map((one) => one.items[i].expr).find((e) => e?.untyped !== true && e?.type !== undefined)?.type);
    }
    return branches.map((branch, b) => {
      const items = projections[b].items;
      if (!items.some((item) => item.expr?.untyped === true)) return branch;
      return withItems(branch, items.map((item, i) => ({...item, expr: giveType(item.expr, types[i])})));
    });
  };
  /** an assignment to a declared output (an OUT table parameter, a RETURNING
   *  table): its schema types a bare NULL by column name */
  const typeNullsFrom = (rel, schema) => {
    if (schema === undefined || rel === undefined) return rel;
    if (rel.rel === "union") return {...rel, inputs: rel.inputs.map((one) => typeNullsFrom(one, schema))};
    const projection = projectionOf(rel);
    if (projection === undefined || !projection.items.some((item) => item.expr?.untyped === true)) return rel;
    return withItems(rel, projection.items.map((item) => ({...item, expr: giveType(item.expr, schema[String(item.as).toUpperCase()])})));
  };
  const outSchema = outParam === undefined ? undefined
    : (outParam.schema ?? relationSchemas[String(outParam.name).toUpperCase()] ?? options.outputSchema);

  // **No untyped NULL leaves the binder.** A CAST, a CASE branch and a
  // comparison give a NULL literal its type; every other path -- a function
  // argument, arithmetic, an IN list, a window argument -- would pass
  // `type: undefined` on to whatever reads it next, and a default there is
  // the quiet kind of wrong. Checked once, by construction, rather than at
  // each site somebody remembers (foreman-dell, 2026-09-22).
  const noUntyped = (out) => {
    const walk = (node, where) => {
      if (node === null || typeof node !== "object") return;
      if (node.untyped === true) throw new BindError(`NULL ${where} has no type here: CAST(NULL AS <type>) says which`);
      for (const [key, value] of Object.entries(node)) {
        if (key === "type") continue;
        const place = node.node === "call" ? `in ${String(node.name ?? node.fn ?? "a call").toUpperCase()}`
          : (node.as !== undefined && key === "expr" ? `AS ${String(node.as).toLowerCase()}` : where);
        if (Array.isArray(value)) value.forEach((one) => walk(one, place));
        else walk(value, place);
      }
    };
    walk(out, "in an expression");
    return out;
  };

  /** an untyped NULL beside a typed operand takes that type */
  const adopt = (left, right) => {
    if (left?.untyped === true && right?.untyped !== true && right?.type !== undefined) return [{...left, type: right.type, untyped: undefined}, right];
    if (right?.untyped === true && left?.untyped !== true && left?.type !== undefined) return [left, {...right, type: left.type, untyped: undefined}];
    return [left, right];
  };
  /** CASE / MAP branches: an untyped NULL branch takes the type of the first typed one; all-NULL is refused */
  const typedBranches = (whens, otherwise) => {
    const typed = [...whens.map((w) => w.then), otherwise].find((e) => e !== undefined && e.untyped !== true);
    if (typed === undefined) throw new BindError("a CASE whose every branch is NULL has no type");
    const give = (e) => (e?.untyped === true ? {...e, type: typed.type, untyped: undefined} : e);
    return [whens.map((w) => ({...w, then: give(w.then)})), give(otherwise), typed.type];
  };

  const typeOfColumn = (name, sourceName) => {
    if (sourceName !== undefined) {
      if (ambiguousSources.has(sourceName)) {
        throw new BindError(`source ${sourceName} appears more than once without an alias, so ${sourceName}.${name} is ambiguous`);
      }
      const type = qualifiedColumns[sourceName]?.[name];
      if (type === undefined && options.strictColumns === true) {
        throw new BindError(`column ${sourceName}.${name} is not present in the typed query scope`);
      }
      if (isUnresolved(type)) throw new BindError(`column ${sourceName}.${name} has no resolved type (${type.reason})`);
      return type ?? T.str;
    }
    if (ambiguousColumns.has(name)) throw new BindError(`column ${name} is ambiguous without a source qualifier`);
    if (columns[name] === undefined && options.strictColumns === true) {
      throw new BindError(`column ${name} is not present in the typed query scope`);
    }
    // a column the dictionary could not type is refused when it is read,
    // by name, the way an unresolved scalar parameter is
    if (isUnresolved(columns[name])) throw new BindError(`column ${name} has no resolved type (${columns[name].reason})`);
    return columns[name] ?? T.str;
  };

  const sourceAlias = (node) => {
    const children = node.children ?? [];
    const at = children.findIndex((one) => one.node === "word" && String(one.value).toUpperCase() === "AS");
    if (at >= 0) return nameOf(children.slice(at + 1).find((one) => one.node === "identifier" || one.node === "Name"));
    // `FROM :it_guid a` -- the AS is optional, and the corpus leaves it out
    // (`FROM :it_x a INNER JOIN t b`, a shape the corpus uses, 2026-09-22):
    // an identifier after the source term, on its own, is the alias
    const last = children[children.length - 1];
    if (children.length >= 2 && last?.node === "identifier") return nameOf(last);
    return undefined;
  };
  /** the common table expressions in scope, by name */
  let ctes = new Map();
  /** names of this WITH's CTEs not bound yet: a reference to one is a forward reference */
  let laterCtes = new Set();
  /** Select nodes whose TOP the enclosing statement applies after its ORDER BY */
  const deferredTop = new Set();
  const directWord = (node, word) => (node.children ?? []).some((c) => c.node === "word" && String(c.value).toUpperCase() === word);
  /** the TOP count of a Select, or undefined; refused unless it is an INTEGER literal or parameter */
  const topOf = (sel) => {
    const children = sel.children ?? [];
    const at = children.findIndex((c) => c.node === "word" && String(c.value).toUpperCase() === "TOP");
    if (at < 0) return undefined;
    const count = children[at + 1]?.node === "Expr" ? expression(children[at + 1]) : undefined;
    if (count?.type?.abap !== "I" || !["lit", "param"].includes(count?.node)) {
      throw new BindError("TOP requires a literal or scalar INTEGER count", sel);
    }
    return count;
  };
  /** table names used as qualifiers without an alias, per SELECT; a name used twice in one FROM is ambiguous and stays so */
  let implicitSources = new Set();
  let ambiguousSources = new Set();

  const registerSource = (schema, sourceName) => {
    for (const [name, type] of Object.entries(schema ?? {})) {
      if (columns[name] !== undefined || ambiguousColumns.has(name)) {
        delete columns[name];
        ambiguousColumns.add(name);
      } else {
        columns[name] = type;
      }
    }
    if (sourceName !== undefined) qualifiedColumns[sourceName] = schema ?? {};
  };

  function expression(node) {
    if (node === undefined) {
      // a named refusal rather than a crash: an internal `undefined` reaching
      // here means the tree had a shape this stage did not expect, and
      // "cannot read properties of undefined" tells a reader nothing
      throw new BindError("an expression this stage does not recognise");
    }
    switch (node.node) {
      case "Expr":
      case "Term": {
        const parts = (node.children ?? []).filter((c) => c.node !== "word");
        const ops = (node.children ?? []).filter((c) => c.node === "word").map((w) => w.value);
        let left = expression(parts[0]);
        for (let i = 1; i < parts.length; i += 1) {
          const op = ops[i - 1] ?? "+";
          const right = expression(parts[i]);
          // the result type of arithmetic is the wider of the two, and a
          // division is decimal because that is what HANA answers -- measured
          // (docs/sqlscript-hana-observed.md), not assumed from SQL folklore
          // INT2 arithmetic is INTEGER's: 32767 + 32767 is 65534 on A4H, no
          // SMALLINT overflow, so the INT2 range does not travel into a result
          const widened = (t) => (t?.abap === "I" && t.bits !== undefined ? T.int : t);
          // a concatenation is as long as both sides together; a STRING or
          // a number on either side makes it a STRING
          const concatenated = () => {
            const [a, b] = [left.type, right.type];
            if (a?.abap !== "C" || b?.abap !== "C" || !Number.isInteger(a.len) || !Number.isInteger(b.len)) return T.str;
            const joined = T.char(a.len + b.len);
            return a.variable === true || b.variable === true ? {...joined, variable: true} : joined;
          };
          const type = op === "||" ? concatenated() : op === "/" ? T.dec(15, 2)
            : (left.type?.abap === "P" || right.type?.abap === "P" ? T.dec(15, 2) : widened(left.type));
          left = bin(op, left, right, type);
        }
        return left;
      }
      case "Factor": {
        const first = (node.children ?? [])[0];
        if (first?.node === "word" && first.value === "-") {
          const operand = expression((node.children ?? []).find((c) => c.node !== "word"));
          if (operand.node === "lit" && typeof operand.value === "number") return lit(-operand.value, operand.type);
          const type = operand.type?.abap === "I" && operand.type.bits !== undefined ? T.int : operand.type;
          if (!["I", "INT8", "P"].includes(type?.abap)) throw new BindError(`a leading minus before a ${type?.abap ?? "value"} of no number type`, node);
          return bin("-", lit(0, T.int), operand, type);
        }
        const inner = (node.children ?? []).filter((c) => c.node !== "word");
        if (inner.length === 1) return expression(inner[0]);
        break;
      }
      case "Value":
      case "SelectItem":
      case "OrderKey":
      case "Predicate": {
        const inner = (node.children ?? []).filter((c) => c.node !== "word");
        if (inner.length === 1) return expression(inner[0]);
        break;
      }
      case "Cast": {
        const inner = (node.children ?? []).filter((c) => c.node === "Expr");
        const named = (node.children ?? []).find((c) => c.node === "TypeName");
        const source = expression(inner[0]);
        const target = typeFromName(named);
        if (source.untyped === true) return cast({...source, type: target, untyped: undefined}, target);
        // The first measured decimal conversion only widens precision while
        // preserving scale.  Parsing strings and changing scale introduce
        // backend-specific error/rounding rules, so keep them named gaps
        // until differential oracle rows define their semantics.
        if (target.abap === "P"
            && (source.type?.abap !== "P" || source.type.dec !== target.dec)) {
          throw new BindError("decimal CAST currently requires a packed-decimal source with unchanged scale", node);
        }
        return cast(source, target);
      }
      case "Case": {
        // The parser keeps the two CASE forms apart; the IR has one, the
        // searched form, because one shape downstream is one shape to lower.
        // The simple form is rewritten here: `CASE x WHEN v` becomes
        // `WHEN x = v`, which is what it means.
        const parts = (node.children ?? []).filter((c) => c.node !== "word");
        const words = (node.children ?? []).filter((c) => c.node === "word")
          .map((w) => String(w.value).toUpperCase());
        // **Which form this is, read from the ordered children and not from
        // the word list.** The word list was the first attempt and it is
        // wrong in a way that always answers "searched": the subject of a
        // simple CASE is an expression, so it is not a word, so `words[1]`
        // is "WHEN" in both forms. Every `CASE x WHEN v` in the corpus then
        // went down the searched path and came out as "a comparison without
        // an operator" -- ten bodies, and the message pointed at the
        // predicate rather than at the CASE that built it.
        const ordered = node.children ?? [];
        const afterCase = ordered[ordered.findIndex((c) => c.node === "word"
          && String(c.value).toUpperCase() === "CASE") + 1];
        const searched = afterCase === undefined || afterCase.node === "word";
        const subject = searched ? undefined : expression(parts[0]);
        const rest = searched ? parts : parts.slice(1);
        // WHEN/THEN come in pairs; an odd tail is the ELSE
        const hasElse = words.includes("ELSE");
        const pairs = hasElse ? rest.slice(0, -1) : rest;
        const otherwise = hasElse ? expression(rest[rest.length - 1]) : undefined;
        const whens = [];
        for (let i = 0; i + 1 < pairs.length; i += 2) {
          const left = subject === undefined ? condition(pairs[i]) : bin("=", subject, expression(pairs[i]), T.bool);
          whens.push({when: left, then: expression(pairs[i + 1])});
        }
        if (whens.length === 0) throw new BindError("a CASE with no WHEN", node);
        return caseWhen(...typedBranches(whens, otherwise));
      }
      case "FunctionCall": {
        const fn = String(leaf(node).value).toUpperCase();
        const args = (node.children ?? []).filter((c) => c.node === "Expr").map(expression);
        // `COUNT(*)` -- the star is a word, not an Expr, so an arg list read
        // only from Expr children turned it into `COUNT()`, which every
        // engine rejects and which says nothing about why
        const starArg = (node.children ?? []).some((c) =>
          (c.node === "word" || c.node === "operator") && c.value === "*");
        // an ordering inside the call belongs to the call, in the shape the
        // lowering already reads elsewhere: {col, desc}
        const inner = kids(node, "OrderKey").map((k) => {
          const e = expression(k);
          if (e.node !== "col") throw new BindError("ORDER BY over an expression inside a call is not lowered yet", k);
          return {col: e.name, desc: hasWord(k, "DESC")};
        });
        // CAST is its own node in the IR, because the lowering has to decide
        // per engine whether a failing cast can even raise
        // **`MAP(x, a, b, c, d, …, default)` is a CASE and nothing else.**
        // Measured on HANA: a hit answers its value, a miss answers the
        // default, **no default answers NULL**, and `MAP(NULL, …)` answers
        // the default -- which is exactly what `CASE WHEN x = a …` does,
        // because `NULL = a` is NULL and NULL is not true. So it is rewritten
        // here rather than rendered per dialect: one shape downstream, and
        // no engine needs a function it does not have.
        if (fn === "MAP") {
          if (args.length < 3) throw new BindError("MAP needs a value and at least one pair", node);
          const whens = [];
          let i = 1;
          for (; i + 1 < args.length; i += 2) {
            whens.push({when: bin("=", args[0], args[i], T.bool), then: args[i + 1]});
          }
          // an odd argument left over is the default; none means NULL
          const otherwise = i < args.length ? args[i] : undefined;
          return caseWhen(...typedBranches(whens, otherwise));
        }
        if (fn === "CAST" || fn === "TO_INTEGER") {
          return cast(args[0] ?? lit(null, T.str), fn === "TO_INTEGER" ? T.int : T.str);
        }
        const over = kid(node, "Window");
        const window = over === undefined ? undefined : {
          partitionBy: kids(over, "Expr").map(expression),
          orderBy: kids(over, "OrderKey").map((k) => {
            const e = expression(k);
            if (e.node !== "col") throw new BindError("ORDER BY over an expression inside OVER is not lowered yet", k);
            return {col: e.name, desc: hasWord(k, "DESC")};
          }),
        };
        // Types that have been measured rather than guessed. Ranking calls
        // return BIGINT values on HANA and DuckDB; carrying STRING
        // here made an otherwise valid UNION fail schema proof and would
        // expose the wrong AMDP boundary type even when the SQL itself ran.
        let resultType = T.str;
        if (["ROW_NUMBER", "RANK", "DENSE_RANK"].includes(fn)) resultType = T.int8;
        // measured on A4H (docs/sqlscript-hana-observed.md): COUNT is wider
        // than INTEGER (BIGINT), and MIN / MAX keep their argument's type --
        // doubling 2147483647 overflows for MAX(int) and not for COUNT(*).
        // SUM(int) overflowed too on HANA, where DuckDB widens: not typed yet.
        if (fn === "COUNT") resultType = T.int8;
        // LENGTH of a text is an INTEGER (A4H: LENGTH('x  ') is 3)
        if (fn === "LENGTH" && args.length === 1 && ["C", "STRING"].includes(args[0].type?.abap)) resultType = T.int;
        if (["MIN", "MAX"].includes(fn) && args.length === 1 && args[0].type !== undefined && !isUnresolved(args[0].type)) resultType = args[0].type;
        if (fn === "LOWER") {
          if (args.length !== 1 || !measuredTextType(args[0]?.type)) {
            throw new BindError("LOWER requires exactly one measured text argument", node);
          }
          if (over !== undefined || inner.length > 0 || starArg) {
            throw new BindError("scalar LOWER does not accept window, ordering, or star decorations", node);
          }
          // Measured for the current HANA/DuckDB text surface: case folding
          // does not turn a fixed-width ABAP field into an unbounded STRING.
          resultType = args[0].type;
        }
        if (fn === "LOCATE") {
          if (args.length !== 2 || args.some((arg) => !measuredTextType(arg?.type))) {
            throw new BindError("LOCATE requires exactly two measured text arguments", node);
          }
          if (over !== undefined || inner.length > 0 || starArg) {
            throw new BindError("scalar LOCATE does not accept window, ordering, or star decorations", node);
          }
          resultType = T.int;
        }
        if (fn === "BITXOR") {
          if (args.length !== 2 || args.some((arg) => !["X", "XSTRING"].includes(arg?.type?.abap))) {
            throw new BindError("BITXOR requires exactly two measured binary arguments", node);
          }
          if (args[0].type.abap === "X" && args[1].type.abap === "X"
              && args[0].type.len !== args[1].type.len) {
            throw new BindError("BITXOR fixed binary arguments must have the same length", node);
          }
          if (over !== undefined || inner.length > 0 || starArg) {
            throw new BindError("BITXOR does not accept window, ordering, or star decorations", node);
          }
          resultType = args[0].type.abap === "XSTRING" || args[1].type.abap === "XSTRING"
            ? T.bytes() : args[0].type;
        }
        if (fn === "BITCOUNT") {
          if (args.length !== 1 || !["X", "XSTRING"].includes(args[0]?.type?.abap)) {
            throw new BindError("BITCOUNT requires exactly one measured binary argument", node);
          }
          if (over !== undefined || inner.length > 0 || starArg) {
            throw new BindError("BITCOUNT does not accept window, ordering, or star decorations", node);
          }
          resultType = T.int;
        }
        if (fn === "SESSION_CONTEXT") {
          if (args.length !== 1 || args[0]?.node !== "lit" || typeof args[0].value !== "string") {
            throw new BindError("SESSION_CONTEXT requires one literal string key", node);
          }
          if (over !== undefined || inner.length > 0 || starArg) {
            throw new BindError("SESSION_CONTEXT does not accept window, ordering, or star decorations", node);
          }
          return sessionValue("context", args[0].value, T.str);
        }
        if (fn === "COALESCE") {
          if (over !== undefined || inner.length > 0 || starArg) {
            throw new BindError("scalar COALESCE does not accept window, ordering, or star decorations", node);
          }
          if (args.length !== 2) throw new BindError("COALESCE currently requires exactly two arguments", node);
          const mentionsText = [args[0]?.type, args[1]?.type]
            .some((type) => type?.abap === "C" || type?.abap === "STRING");
          const merged = JSON.stringify(args[0]?.type) === JSON.stringify(args[1]?.type) && !mentionsText
            ? args[0].type : mergedTextType(args[0]?.type, args[1]?.type);
          if (merged === undefined) {
            throw new BindError("COALESCE arguments require identical measured types", node);
          }
          resultType = merged;
        }
        const built = call(fn, args, resultType);
        if (starArg) built.star = true;
        if (inner.length > 0) built.orderBy = inner;
        if (window !== undefined) built.window = window;
        return built;
      }
      case "ReplaceRegexpr": {
        const parts = kids(node, "Expr").map(expression);
        if (parts.length !== 3 || !hasWord(node, "OCCURRENCE") || !hasWord(node, "ALL")) {
          throw new BindError("only REPLACE_REGEXPR ... OCCURRENCE ALL is in the measured subset", node);
        }
        if (parts[0]?.node !== "lit" || parts[0].value !== "x"
            || parts[2]?.node !== "lit" || parts[2].value !== ""
            || parts[1]?.node !== "col") {
          throw new BindError("portable REPLACE_REGEXPR is currently measured only for literal 'x', empty replacement, and a column subject", node);
        }
        // Normalise the keyword spelling to semantic argument order. The
        // lowering restores each backend's grammar while preserving bound
        // parameter order: subject, pattern, replacement.
        return call("REGEXP_REPLACE_ALL", [parts[1], parts[0], parts[2]], T.str);
      }
      case "ColumnRef": {
        // **`s.k` is the column K, qualified by S -- and `nameOf` took the
        // FIRST name.** So every qualified reference lowered to the
        // qualifier: `SELECT s.k FROM src AS s` became `SELECT "S" AS "S"`,
        // and `SELECT s.k, s.a` became the same wrong column twice. Bodies
        // written that way -- which is most bodies with a join in them --
        // counted as lowered and could not run.
        //
        // The column is the LAST name. The qualifier is dropped rather than
        // emitted, because our joins are lowered into a subquery with
        // generated aliases and the writer's alias does not exist in the SQL
        // we produce: emitting `"S"."K"` would be invalid where dropping it
        // is correct for one source and AMBIGUOUS for several -- and an
        // ambiguous column is an error the engine states out loud, which the
        // instruments read as our SQL being refused. A loud wrong is worth
        // having; a quiet wrong is what this was.
        const names = kids(node, "Name");
        const name = names.length > 1 ? nameOf(names[names.length - 1]) : nameOf(node);
        const sourceName = names.length > 1 ? nameOf(names[0]) : undefined;
        // Only the exact, unqualified, unquoted keyword spelling is a
        // session value. `s.CURRENT_USER` and `"CURRENT_USER"` are ordinary
        // columns; treating them as identity silently replaces row data.
        const sessionKeyword = names.length === 1 && leaf(names[0])?.node === "identifier";
        if (sessionKeyword && SESSION_VALUE_NAMES.has(name)) {
          if (name === "CURRENT_USER") return sessionValue("user", name, T.str);
          if (name === "CURRENT_SCHEMA") return sessionValue("schema", name, T.str);
          throw new BindError(`${name} is a session value, not a column; its portable clock semantics are not implemented`, node);
        }
        // the same three words arrive here as a Name when they stand in an
        // expression position; the identifier case below has the reasons
        if (sessionKeyword && name === "NULL") return {...lit(null, undefined), untyped: true};
        if (sessionKeyword && (name === "TRUE" || name === "FALSE")) {
          throw new BindError(`the BOOLEAN literal ${name} is not portable yet: HANA has BOOLEAN and SQLite has not`, node);
        }
        // a scalar written without its colon in a scalar statement --
        // `v = :v || i`, `IF i > 3` -- outside any query: HANA reads the
        // variable (measured on HXE, a numeric FOR's loop variable)
        if (sourceName === undefined && ["expression", "condition"].includes(options.fragment)
            && Object.keys(columns).length === 0 && columns[name] === undefined
            && scalarTypes[name] !== undefined) {
          return param(name, scalarTypes[name]);
        }
        // `r.col` inside `FOR r AS c DO`: a column of the loop's current row,
        // a scalar of the procedure (R.COL), unless the query in hand has a
        // source of that name
        const row = sourceName !== undefined && qualifiedColumns[sourceName] === undefined
          ? rowVariables[sourceName] : undefined;
        if (row !== undefined) {
          if (row[name] === undefined) throw new BindError(`${sourceName}.${name} is not a column of the loop's cursor`, node);
          return param(`${sourceName}.${name}`, row[name]);
        }
        return col(name, typeOfColumn(name, sourceName), sourceName);
      }
      case "identifier":
      case "quoted": {
        const name = String(node.value).toUpperCase();
        if (node.node === "identifier" && SESSION_VALUE_NAMES.has(name)) {
          if (name === "CURRENT_USER") return sessionValue("user", name, T.str);
          if (name === "CURRENT_SCHEMA") return sessionValue("schema", name, T.str);
          throw new BindError(`${name} is a session value, not a column; its portable clock semantics are not implemented`, node);
        }
        if (node.node === "identifier" && name === "NULL") {
          // `NULL AS context`, `map(x, '', null, ...)`: a literal, not a column
          // called NULL (six corpus bodies read it as one, 2026-09-22). It has
          // no type of its own; a CAST, a CASE branch or a comparison gives it
          // one, and a bare projection of it is refused rather than typed STRING.
          return {...lit(null, undefined), untyped: true};
        }
        if (node.node === "identifier" && (name === "TRUE" || name === "FALSE")) {
          throw new BindError(`the BOOLEAN literal ${name} is not portable yet: HANA has BOOLEAN and SQLite has not`, node);
        }
        return col(name, typeOfColumn(name));
      }
      case "string":
        return lit(String(node.value), T.char(String(node.value).length));
      case "number":
        return lit(Number(node.value), literalType(node));
      case "host":
        // a host variable is a **bound parameter**, never text: that is the
        // guarantee the native channel exists for
        {
          const name = String(node.value).slice(1).toUpperCase();
          if (scalarTypes[name] === undefined) {
            if (unresolvedScalars[name] !== undefined) {
              throw new BindError(`scalar :${name.toLowerCase()} has a type this run cannot resolve (${unresolvedScalars[name]})`, node);
            }
            throw new BindError(`unknown scalar :${name.toLowerCase()}`, node);
          }
          return param(name, scalarTypes[name]);
        }
      case "operator":
        if (node.value === "?") return param("p", T.str);
        break;
      default:
        break;
    }
    const only = (node.children ?? []).filter((c) => c.node !== "word");
    if (only.length === 1) return expression(only[0]);
    throw new BindError(`cannot type ${node.node}`, node);
  }

  /** the type a `CAST(x AS <here>)` names, as the IR spells types */
  function typeFromName(node) {
    if (node === undefined) throw new BindError("a CAST without a type");
    const words = (node.children ?? []);
    const name = String(words.find((c) => c.node === "identifier" || c.node === "quoted")?.value ?? "").toUpperCase();
    const sizes = words.filter((c) => c.node === "number").map((c) => Number(c.value));
    // SMALLINT and TINYINT carry a range the portable engines do not enforce
    // on a CAST (DuckDB kept 40000); refused until measured, like INT1
    if (/^(SMALLINT|TINYINT)$/.test(name)) throw new BindError(`the SQL type ${name} is not measured yet`, node);
    if (/^(INT|INTEGER|BIGINT)$/.test(name)) return T.int;
    if (/^(N?VARCHAR|N?CHAR|ALPHANUM|SHORTTEXT)$/.test(name)) {
      if (sizes[0] === undefined) throw new BindError(`CAST to ${name} without a length`, node);
      return T.char(sizes[0]);
    }
    if (/^(DECIMAL|DEC|SMALLDECIMAL)$/.test(name)) return T.dec(sizes[0] ?? 15, sizes[1] ?? 2);
    // `"$ABAP.type( ... )"` and the rest: named, not guessed. A cast whose
    // target we cannot name is exactly the node the three engines disagree
    // on, so inventing one here would be the worst possible place to guess.
    throw new BindError(`CAST to ${name || "an unnamed type"} has no measured rendering`, node);
  }

  /** One side of an AND/OR. The brackets are a `ConditionTerm` and the thing
   *  inside them is a whole Condition again, so this recurses rather than
   *  looking for Predicate children -- which is what it used to do, and what
   *  made every parenthesised WHERE stop lowering the moment the grammar
   *  learned to read one. */
  function conditionTerm(node) {
    if (node.node === "Condition") return condition(node);
    if (node.node === "ConditionTerm") {
      const inner = (node.children ?? []).filter((c) => c.node !== "word");
      if (inner.length !== 1) throw new BindError("a bracketed condition this stage does not recognise", node);
      return conditionTerm(inner[0]);
    }
    return predicate(node);
  }

  function condition(node) {
    if (node === undefined) throw new BindError("a condition was expected here and the tree has none");
    // The grammar retains an unparenthesised chain as one Condition. Folding
    // it left-to-right would change SQL's AND-before-OR precedence and can
    // select the wrong host-side IF branch. Parenthesised groups recurse as
    // separate Condition nodes, so refusing only a level that mixes both is
    // precise and still permits an explicit spelling of either meaning.
    const joiners = new Set((node.children ?? [])
      .filter((child) => child.node === "word" && ["AND", "OR"].includes(String(child.value).toUpperCase()))
      .map((child) => String(child.value).toUpperCase()));
    if (joiners.has("AND") && joiners.has("OR")) {
      throw new BindError("an unparenthesized condition mixing AND and OR is refused until precedence is represented", node);
    }
    // Read in order, because NOT binds to the term that FOLLOWS it and a
    // filtered list of children loses which one that was.
    let left;
    let joiner = "AND";
    let negate = false;
    for (const child of node.children ?? []) {
      if (child.node === "word") {
        const word = String(child.value).toUpperCase();
        if (word === "AND" || word === "OR") joiner = word;
        else if (word === "NOT") negate = true;
        continue;
      }
      let next = conditionTerm(child);
      if (negate) {
        next = not(next);
        negate = false;
      }
      left = left === undefined ? next : bin(joiner, left, next, T.bool);
    }
    if (left === undefined) throw new BindError("a condition with nothing in it", node);
    return left;
  }

  const COMPARISONS = new Set(["=", "<>", "!=", "<", ">", "<=", ">="]);

  function predicate(node) {
    if (node === undefined) throw new BindError("a predicate was expected here and the tree has none");
    const words = (node.children ?? []).filter((c) => c.node === "word")
      .map((w) => String(w.value).toUpperCase());
    const negated = words.includes("NOT");
    const inner = kid(node, "SetOperation");
    if (inner !== undefined) {
      // A subquery is a relation standing where an expression is expected.
      // It gets its own node rather than a hole in the wall between the two
      // halves of the IR: everything that walks relations reaches inside it
      // by walking `rel`, and nothing learns a second shape.
      const rel = relation(inner);
      if (words.includes("EXISTS")) return subquery("exists", rel, undefined, negated);
      const left = kid(node, "Expr");
      if (left === undefined) throw new BindError("a subquery compared against nothing", node);
      if (words.includes("IN")) return subquery("in", rel, expression(left), negated);
      const op = (node.children ?? []).filter((c) => c.node === "operator" || c.node === "word")
        .map((o) => String(o.value)).find((v) => COMPARISONS.has(v));
      if (op === undefined) throw new BindError("a subquery compared without an operator", node);
      return bin(op, expression(left), subquery("scalar", rel, undefined), T.bool);
    }
    const sides = (node.children ?? []).filter((c) => c.node === "Expr");
    if (words.includes("LIKE")) {
      const escape = words.includes("ESCAPE") ? expression(sides[2]) : undefined;
      return like(expression(sides[0]), expression(sides[1]), escape, negated);
    }
    if (words.includes("IN")) {
      return inList(expression(sides[0]), sides.slice(1).map(expression), negated);
    }
    if (words.includes("BETWEEN")) {
      // two comparisons, which is what it means and what all three engines do
      const value = expression(sides[0]);
      const both = bin("AND",
        bin(">=", value, expression(sides[1]), T.bool),
        bin("<=", value, expression(sides[2]), T.bool), T.bool);
      return negated ? not(both) : both;
    }
    if (words.includes("IS") && words.includes("NULL")) {
      const test = {node: "isnull", expr: expression(sides[0]), type: T.bool};
      return negated ? not(test) : test;
    }
    // The comparison arrives as a `word`, not as an `operator`: the grammar
    // matches it with str(), which produces a word node whatever the token
    // was. Reading only `operator` children left every comparison defaulting
    // to `=` -- a wrong operator, silently, which is the worst shape a defect
    // in this stage can take. Both are read, and there is a test for `>`.
    const ops = (node.children ?? [])
      .filter((c) => c.node === "operator" || c.node === "word")
      .map((o) => String(o.value))
      .filter((v) => COMPARISONS.has(v));
    if (sides.length === 1) return expression(sides[0]);
    if (ops.length === 0) {
      throw new BindError("a comparison without an operator", node);
    }
    return bin(ops[0], ...adopt(expression(sides[0]), expression(sides[1])), T.bool);
  }

  /** `FROM "CL_X=>GET_ROWS"(:it_rows, 1)`: the callee is looked up in the
   *  registry this run was given, its arguments bound against the declared
   *  parameters, and its declared RETURNS is the schema. Nothing is guessed:
   *  a callee not in the registry, an argument count that differs, or a
   *  table argument that is not a table variable of this body is a refusal
   *  by name. The name is kept as the source spells it, because on HANA
   *  `"CL=>M"` and the DDLS entity are different objects. */
  function tableFunction(call) {
    const method = kid(call, "MethodName");
    const ref = kid(call, "ColumnRef");
    const names = method !== undefined ? kids(method, "Name") : ref === undefined ? [] : kids(ref, "Name");
    // an unquoted `CL=>M` is one name, spelled as the source spells it
    const parts = method !== undefined ? [names.map(nameOf).join("=>")] : names.map(nameOf);
    const spelled = method !== undefined ? [names.map((one) => String(leaf(one)?.value ?? "")).join("=>")] : names.map((one) => String(leaf(one)?.value ?? ""));
    if (parts.length >= 2) {
      const schema = parts[0];
      if (schema === "SYS" || schema === "PUBLIC" || schema.startsWith("_SYS_")) {
        throw new BindError(`${parts.join(".")} is a HANA system function, not portable`, call);
      }
      throw new BindError(`a schema-qualified table function call ${parts.join(".")} is not lowered: the registry knows callees by name only`, call);
    }
    const name = parts[0] ?? "";
    const fn = (options.tableFunctions ?? {})[name];
    if (fn === undefined) {
      throw new BindError(`table function call ${name} is not in the registry of this run`, call);
    }
    // positional or named, never both: a mix has no single reading
    const named = kids(call, "NamedArgument");
    const positional = kids(call, "Expr");
    if (named.length > 0 && positional.length > 0) {
      throw new BindError(`table function ${name} is called with positional and named arguments together`, call);
    }
    let argNodes = positional;
    if (named.length > 0) {
      const byName = new Map();
      for (const one of named) {
        const argName = nameOf(kid(one, "Name"));
        if (byName.has(argName)) throw new BindError(`argument ${argName.toLowerCase()} of ${name} is given twice`, one);
        if (!fn.parameters.some((p) => p.name === argName)) {
          throw new BindError(`table function ${name} has no parameter ${argName.toLowerCase()}`, one);
        }
        byName.set(argName, kid(one, "Expr"));
      }
      // named arguments in the declared order; an omitted one must be
      // OPTIONAL or DEFAULT, and only a trailing run may be left out
      const upto = fn.parameters.reduce((last, p, i) => (byName.has(p.name) ? i : last), -1);
      const gap = fn.parameters.find((p) => !byName.has(p.name) && p.optional !== true);
      if (gap !== undefined) throw new BindError(`argument ${gap.name.toLowerCase()} of ${name} is missing`, call);
      if (fn.parameters.slice(0, upto + 1).some((p) => !byName.has(p.name))) {
        throw new BindError(`${name}: leaving out an optional argument before a named one is not lowered`, call);
      }
      argNodes = fn.parameters.slice(0, upto + 1).map((p) => byName.get(p.name));
    }
    // a trailing OPTIONAL / DEFAULT parameter may be left out, as the corpus
    // does (a table function called with its table argument only, the
    // DEFAULT 0); the callee's own default then applies on the engine
    const required = fn.parameters.filter((p) => p.optional !== true).length;
    if (argNodes.length < required || argNodes.length > fn.parameters.length) {
      const spelled = fn.parameters.map((p) => p.name.toLowerCase() + (p.optional === true ? "?" : "")).join(", ");
      throw new BindError(`table function ${name} takes ${required === fn.parameters.length ? required : `${required} to ${fn.parameters.length}`} argument(s) (${spelled}) and is called with ${argNodes.length}`, call);
    }
    const args = fn.parameters.slice(0, argNodes.length).map((p, i) => {
      const argNode = argNodes[i];
      if (p.kind === "table") {
        // a table argument is a table variable of this body or one of its IN
        // table parameters, and nothing else: an expression here is not a table
        const host = terminalLeaves(argNode).find((l) => l.node === "host");
        const only = terminalLeaves(argNode).length === 1;
        if (host === undefined || !only) {
          throw new BindError(`argument ${p.name.toLowerCase()} of ${name} is a table and must be a table variable`, argNode);
        }
        const varName = String(host.value).slice(1).toUpperCase();
        const known = bound.get(varName);
        if (known !== undefined) return {kind: "relation", name: varName, rel: known.handle === undefined ? known.rel : refTo(known.handle, schemaOf(known.rel, catalogue))};
        if (tableParams.some((one) => String(one.name).toUpperCase() === varName)) return {kind: "relation", name: varName, rel: scan(varName)};
        throw new BindError(`unknown table variable :${varName.toLowerCase()} passed to ${name}`, host);
      }
      if (p.type === undefined || isUnresolved(p.type)) {
        throw new BindError(`argument ${p.name.toLowerCase()} of ${name} has no resolved type${p.type?.reason === undefined ? "" : ` (${p.type.reason})`}`, argNode);
      }
      let e = expression(argNode);
      if (e.untyped === true) e = {...e, type: p.type, untyped: undefined};
      // the argument's type must be the parameter's: 'abc' into an INTEGER,
      // or a STRING scalar into a CHAR, is refused rather than handed on
      const same = (a, b) => a?.abap === b?.abap || (["C", "STRING"].includes(a?.abap) && ["C", "STRING"].includes(b?.abap));
      if (!same(e.type, p.type)) {
        throw new BindError(`argument ${p.name.toLowerCase()} of ${name} is ${e.type?.abap ?? "untyped"} and the parameter is ${p.type.abap}`, argNode);
      }
      return {kind: "scalar", name: p.name, expr: e};
    });
    const schema = fn.returns ?? {};
    return [tableFunctionCall(spelled[0], args, schema), schema];
  }

  function source(node) {
    if (node === undefined) throw new BindError("a FROM source was expected here and the tree has none");
    const sourceName = sourceAlias(node);
    const finish = (rel, schema, tableName) => {
      registerSource(schema, sourceName);
      if (sourceName === undefined && tableName !== undefined) {
        // `SELECT src.k FROM src` -- a table without an alias is qualified
        // by its own name, but only while that name is one source: a
        // self-join without aliases stays ambiguous and says so
        // own properties only: a subquery reading the same table shadows the
        // outer scope (Object.create chain) rather than colliding with it
        if (implicitSources.has(tableName) || Object.hasOwn(qualifiedColumns, tableName)) {
          ambiguousSources.add(tableName);
          delete qualifiedColumns[tableName];
        } else {
          implicitSources.add(tableName);
          qualifiedColumns[tableName] = schema ?? {};
        }
      }
      return sourceName === undefined ? rel : alias(rel, sourceName);
    };
    // **A table function call is not a table.** The grammar parses
    // `FROM my_func(:p)` into a `TableFunctionCall`, and nothing here
    // mentioned that name, so it fell through to the wrapper-unwrapping
    // fallback at the end of `expression`: the call vanished, its arguments
    // with it, and the body lowered to `FROM "MY_FUNC"` -- a read of a table
    // that may well exist. No refusal, no warning, and an answer that is
    // plausible. Found 2026-09-20 by comparing the grammar's node names
    // against the ones this stage mentions, which is what
    // `tools/sqlscript/grammar-cover.mjs` does now.
    const call = (node.children ?? []).find((c) => c.node === "TableFunctionCall");
    if (call !== undefined) return finish(...tableFunction(call));
    const host = (node.children ?? []).find((c) => c.node === "host");
    if (host !== undefined) {
      const name = String(host.value).slice(1).toUpperCase();
      if (options.deferTableVariables === true) {
        const schema = relationSchemas[name] ?? {};
        return finish(varRef(name, relationSchemas[name]), schema);
      }
      const known = bound.get(name);
      if (known === undefined && tableParams.some((p) => String(p.name).toUpperCase() === name)) {
        // an IN table parameter: a relation the caller supplies. It is
        // scanned by its own name, which is what the bridge binds it to.
        const schema = relationSchemas[name] ?? catalogue[name] ?? {};
        return finish(scan(name), schema);
      }
      if (known === undefined) {
        // named, not guessed: a table called like a variable is ordinary, so
        // reading one silently would be plausible and wrong
        throw new BindError(`unknown table variable :${name.toLowerCase()}`, host);
      }
      if (known.handle === undefined) {
        // the ordinary case: an assignment is not an observable barrier on
        // HANA, so the plan goes in where the FROM stands
        return finish(known.rel, schemaOf(known.rel, catalogue));
      }
      // a barrier materialised it. `ref` is the one node whose columns cannot
      // be derived from what is under it, because nothing is; the schema has
      // to be carried, and the moment it is known is the moment the barrier
      // was made. refTo() puts it there -- a bare ref is refused by
      // schemaOf, so the right path is also the shorter one (fable-osd).
      const schema = schemaOf(known.rel, catalogue);
      return finish(refTo(known.handle, schema), schema);
    }
    const sub = kid(node, "SetOperation");
    if (sub !== undefined) {
      const rel = relation(sub);
      return finish(rel, schemaOf(rel, catalogue));
    }
    const temp = (node.children ?? []).find((c) => c.node === "temp");
    if (temp !== undefined) {
      const table = String(temp.value).toUpperCase();
      return finish(scan(table), catalogue[table] ?? {});
    }
    // a schema-qualified source: `sys.m_host_information`, `"PUBLIC"."TABLES"`
    const ref = kid(node, "ColumnRef");
    const parts = ref === undefined ? [] : kids(ref, "Name").map(nameOf);
    if (parts.length >= 2) {
      const schema = parts[0];
      const table = parts[parts.length - 1];
      // `sys.dummy` is DUMMY, the one-row source every dialect renders
      if (schema === "SYS" && table === "DUMMY") return finish(scan("DUMMY"), {});
      if (schema === "SYS" || schema === "PUBLIC" || schema.startsWith("_SYS_")) {
        // HANA's own views: not a dictionary table anywhere, not portable in
        // principle, and refused by name so a catalogue miss on them does not
        // read as a table an export could bring
        throw new BindError(`${schema}.${table} is a HANA system view, not portable`, node);
      }
      throw new BindError(`a schema-qualified source ${schema}.${table} is not lowered: the catalogue knows tables by name only`, node);
    }
    const table = nameOf(node);
    // a CTE defined later is not in scope yet, so the name is a table's, as
    // in plain SQL; with no such table it is a forward reference, said so
    if (laterCtes.has(table) && !ctes.has(table) && catalogue[table] === undefined) {
      throw new BindError(`CTE ${table.toLowerCase()} used before it is defined`, node);
    }
    if (ctes.has(table)) {
      // a common table expression of the enclosing WITH, by its name
      const cte = ctes.get(table);
      return finish(cte, schemaOf(cte, catalogue), table);
    }
    if (table.startsWith("M_") && catalogue[table] === undefined) {
      // an unqualified M_* the dictionary knows is an ordinary object (old
      // matchcode views are named so); one it does not is HANA's monitoring
      throw new BindError(`${table} is a HANA monitoring view (M_*), not portable`, node);
    }
    return finish(scan(table), catalogue[table] ?? {}, table);
  }

  /** Hints, which are a request to one engine rather than part of the meaning.
   *
   *  Two of them are not: `INLINE` and `NO_INLINE` change what is observable,
   *  measured on HANA, so they are kept as a fact about the node and the
   *  lowering expresses the barrier structurally instead of emitting the
   *  text. The rest are plan-only and are dropped -- but only by name, from
   *  this list. A hint nobody has looked at is refused, because silently
   *  dropping an unknown one is exactly how a hint that mattered would
   *  disappear. */
  const PLAN_ONLY_HINTS = new Set([
    "NO_USE_HEX_PLAN", "USE_HEX_PLAN", "NO_USE_OLAP_PLAN", "USE_OLAP_PLAN",
    "IGNORE_PLAN_CACHE", "NO_CS_JOIN", "OPTIMIZE_METAMODEL", "ROUTE_TO",
  ]);

  function hintsOf(node) {
    const hint = kid(node, "Hint");
    if (hint === undefined) return undefined;
    const names = kids(hint, "HintName").map((h) => String(leaf(h).value).toUpperCase());
    const kept = [];
    for (const name of names) {
      if (name === "INLINE" || name === "NO_INLINE") kept.push(name);
      else if (!PLAN_ONLY_HINTS.has(name)) {
        throw new BindError(`the hint ${name} has not been looked at; it is dropped or it matters, and nobody has said which`, hint);
      }
    }
    return kept.length === 0 ? undefined : kept;
  }

  /** the GROUP BY columns, or undefined when there is no GROUP BY.
   *
   *  Grouping by an expression is refused rather than approximated: the
   *  lowering renders keys as quoted names, and rendering an expression
   *  there would need the same expression in the select list to line up,
   *  which nothing checks. */
  function groupKeys(node) {
    if (!hasWord(node, "GROUP")) return undefined;
    // the GROUP BY expressions are the Expr children that follow the word
    const children = node.children ?? [];
    const at = children.findIndex((c) => c.node === "word" && String(c.value).toUpperCase() === "GROUP");
    const out = [];
    for (const child of children.slice(at + 1)) {
      if (child.node === "word" && !["BY", ","].includes(String(child.value).toUpperCase())) break;
      if (child.node !== "Expr") continue;
      const e = expression(child);
      if (e.node !== "col") throw new BindError("GROUP BY over an expression is not lowered yet", child);
      out.push(e.name);
    }
    if (out.length === 0) throw new BindError("a GROUP BY with nothing in it", node);
    return out;
  }

  /** does this expression compute over the group rather than over a row */
  function isAggregate(e) {
    if (e === undefined || e === null || typeof e !== "object") return false;
    if (e.node === "call" && AGGREGATE_FUNCTIONS.has(e.fn) && e.window === undefined) return true;
    for (const key of ["left", "right", "expr", "otherwise"]) {
      if (isAggregate(e[key])) return true;
    }
    for (const one of e.args ?? []) if (isAggregate(one)) return true;
    for (const one of e.whens ?? []) if (isAggregate(one.when) || isAggregate(one.then)) return true;
    return false;
  }

  /** Columns a window expression reads after grouping.
   *
   * SQL evaluates windows after GROUP BY/HAVING. Therefore a window in a
   * grouped SELECT may read group keys (or aggregates, once that surface is
   * added), but it may not smuggle an arbitrary row column past grouping.
   * The current corpus uses ranking over group keys only, so that exact rule
   * is enforced instead of widening it speculatively. */
  function windowColumns(e, out = new Set()) {
    if (e === undefined || e === null || typeof e !== "object") return out;
    if (e.node === "col") out.add(String(e.name).toUpperCase());
    for (const one of e.args ?? []) windowColumns(one, out);
    for (const one of e.window?.partitionBy ?? []) windowColumns(one, out);
    for (const one of e.window?.orderBy ?? []) out.add(String(one.col).toUpperCase());
    return out;
  }

  function containsWindow(e) {
    if (e === undefined || e === null || typeof e !== "object") return false;
    if (e.window !== undefined) return true;
    for (const key of ["left", "right", "expr", "pattern", "escape", "otherwise"]) {
      if (containsWindow(e[key])) return true;
    }
    for (const key of ["args", "values"]) {
      for (const one of e[key] ?? []) if (containsWindow(one)) return true;
    }
    for (const one of e.whens ?? []) {
      if (containsWindow(one.when) || containsWindow(one.then)) return true;
    }
    return false;
  }

  function select(node) {
    // `SELECT ... INTO v` fills scalars; it is a statement, and the procedural
    // compiler takes the IntoClause off before binding what is left as a
    // relation. One that reaches here stands where rows were expected.
    if (kid(node, "IntoClause") !== undefined) {
      throw new BindError("SELECT ... INTO fills scalars; it is a statement, not a relation", node);
    }
    const outerColumns = columns;
    const outerAmbiguous = ambiguousColumns;
    const outerQualified = qualifiedColumns;
    const outerImplicit = implicitSources;
    const outerAmbiguousSources = ambiguousSources;
    columns = {};
    ambiguousColumns = new Set();
    qualifiedColumns = Object.create(outerQualified);
    // the two SELECTs of a UNION may both read one table without an alias:
    // ambiguity is a property of one FROM, not of the body
    implicitSources = new Set();
    ambiguousSources = new Set();
    try {
      return selectInScope(node);
    } finally {
      columns = outerColumns;
      ambiguousColumns = outerAmbiguous;
      qualifiedColumns = outerQualified;
      implicitSources = outerImplicit;
      ambiguousSources = outerAmbiguousSources;
    }
  }

  function selectInScope(node) {
    if (node === undefined) throw new BindError("a SELECT was expected here and the tree has none");
    let rel;
    const from = kid(node, "Source");
    if (from !== undefined) rel = source(from);
    else rel = scan("DUMMY");
    // `FROM a, b` -- a cross join written with a comma
    for (const extra of kids(node, "Source").slice(1)) {
      rel = join(rel, source(extra), undefined, "cross");
    }
    for (const j of kids(node, "Join")) {
      const right = source(kid(j, "Source"));
      const on = kid(j, "Condition");
      rel = join(rel, right, on === undefined ? undefined : condition(on),
        hasWord(j, "CROSS") ? "cross" : (hasWord(j, "LEFT") ? "left" : "inner"));
    }
    // **A clause the parser can read and the binder cannot is worse than one
    // neither of them has** -- written one function below, about ORDER BY,
    // and three more clauses were in exactly that state until a HANA ran the
    // body's own SQLScript beside our lowering of it and the two answers
    // parted (fable-osd, 2026-09-19):
    //
    //   SELECT DISTINCT k  ->  SELECT "DISTINCT" AS "K"   (a COLUMN called DISTINCT)
    //   ... GROUP BY n     ->  the grouping silently gone
    //   ... HAVING c > 1   ->  the condition moved into the WHERE
    //
    // Each of the three parsed, each lowered, and each was therefore counted
    // as a body that works while computing a different program. They are
    // carried now; what is still refused below is refused by name.
    // **Only when there IS a WHERE.** `kid(node, "Condition")` takes the
    // first Condition child, and with `... GROUP BY k HAVING c > 1` the first
    // one is the HAVING -- so the having condition was applied as a WHERE as
    // well, filtering rows by an aggregate before the aggregate existed. Two
    // clauses, one of them invented.
    const where = hasWord(node, "WHERE") ? kid(node, "Condition") : undefined;
    if (where !== undefined) {
      const predicate = condition(where);
      if (containsWindow(predicate)) throw new BindError("a window function is not legal in WHERE", where);
      rel = filter(rel, predicate);
    }
    const items = kids(node, "SelectItem").map((item) => {
      // `*` arrives as a **word**, because the grammar matches it with
      // str(): the third time this trap has been paid for in this front end
      // (the comparison operators and the `?` placeholder were the others).
      // Looking only for an `operator` child made `SELECT *` fall through to
      // expression(undefined) and crash -- and every test used a column
      // list, so nothing covered it.
      const star = (item.children ?? []).some((c) =>
        (c.node === "operator" || c.node === "word") && c.value === "*");
      // A bare `NULL AS x` is kept untyped here: the other branch of a UNION
      // or the declared output it is assigned to may type it (typeNulls), and
      // one that nothing types is refused by name when the binder finishes.
      const projected = (expr) => expr;
      if (star) {
        // `SELECT *` reads every column of the scope, the marked ones included
        const dark = Object.entries(columns).find(([, type]) => isUnresolved(type));
        if (dark !== undefined) {
          throw new BindError(`SELECT * would carry column ${dark[0]}, which has no resolved type (${dark[1].reason})`, item);
        }
        return {as: "*", expr: {node: "star"}};
      }
      const alias = kids(item, "Name")[0];
      const expr = expression((item.children ?? []).find((c) => c.node !== "word" && c !== alias));
      const as = alias === undefined ? (expr.name ?? "V") : nameOf(alias);
      return {as, expr: projected(expr, as, item)};
    });
    // two items under one name collapse into one key of the schema and of an
    // answer's row: a column silently lost. Refused once, here, for every
    // relation (foreman-dell's critic on #36)
    const named = items.filter((one) => one.as !== "*").map((one) => one.as);
    if (new Set(named).size !== named.length) {
      const twice = named.find((one, i) => named.indexOf(one) !== i);
      throw new BindError(`${named.length} items under ${new Set(named).size} distinct names (${twice} twice${twice === "V" ? ", an unnamed expression" : ""}); give each its own`, node);
    }
    // **`SELECT *` is not a projection, it is the absence of one.**
    //
    // A `project` whose only item is a star was reaching the lowering as
    // `{node:"star"}` and being refused there, which was right but late: the
    // node says "every column of the input", and the relation that already
    // means that is the input. So it collapses.
    //
    // A star **mixed with names** does not collapse and is refused by name.
    // The schema is at hand and expanding it would be easy, which is exactly
    // the trap (fable-osd): an expansion freezes the set and the order of
    // the columns at the moment of compiling, so adding a column to the
    // table later changes what the body means. That is a quiet dependency on
    // the state of the dictionary dressed up as a convenience.
    // `SELECT DISTINCT k` parses TWO ways under this grammar -- DISTINCT as
    // the optional keyword, or DISTINCT as a column with `k` for an alias --
    // and the second one wins. So the keyword never reaches `hasWord` and the
    // statement lowers to `SELECT "DISTINCT" AS "K"`, which is a different
    // program that an engine will happily refuse for the wrong reason. The
    // ambiguity belongs in the grammar; until it is resolved there, the shape
    // it produces is refused HERE, by name, rather than lowered.
    if (items.some((i) => i.expr?.node === "col" && String(i.expr.name).toUpperCase() === "DISTINCT")) {
      throw new BindError("DISTINCT was read as a column name: the grammar admits two parses of " +
        "`SELECT DISTINCT x` and takes the wrong one. Refused rather than lowered, because the " +
        "lowering would select a column called DISTINCT", node);
    }
    const stars = items.filter((i) => i.expr?.node === "star");
    if (stars.length > 0 && items.length > stars.length) {
      throw new BindError("`*` together with named columns is not lowered: expanding it would fix the set and the order of the columns at compile time, and a column added to the table later would change what this body means", node);
    }
    if (stars.length > 0) {
      const hinted = hintsOf(node);
      return orderAndLimit(node, hinted === undefined ? rel : {...rel, hints: hinted});
    }
    // **GROUP BY, and the split the IR already wanted.**
    //
    // `aggregate(input, groupBy, aggs)` has been in the IR since it was
    // written and the lowering has rendered it all along; nothing read a
    // GROUP BY into it. The split is by shape rather than by a list of
    // function names: an item that mentions no column outside an aggregate
    // call is an aggregate, the rest are keys, and a key that is not also in
    // the GROUP BY is refused rather than guessed at -- every engine rejects
    // that anyway, and rejecting it here says which column.
    const grouped = groupKeys(node);
    if (grouped !== undefined) {
      const keyNames = new Set(grouped.map((k) => k.toUpperCase()));
      const keys = [];
      const aggs = [];
      for (const item of items) {
        if (item.expr?.node === "star") {
          throw new BindError("`*` with a GROUP BY is not lowered: which columns it stands for is a question about the dictionary, not about this body", node);
        }
        if (containsWindow(item.expr)) {
          if (item.expr?.node !== "call" || item.expr.window === undefined
              || !["ROW_NUMBER", "RANK", "DENSE_RANK"].includes(item.expr.fn)) {
            throw new BindError("a grouped window must be a top-level ROW_NUMBER, RANK or DENSE_RANK call", node);
          }
          if ((item.expr.args ?? []).length > 0) {
            throw new BindError(`${item.expr.fn} with arguments is not a measured grouped window`, node);
          }
          if ((item.expr.window.partitionBy ?? []).some((one) => one.node !== "col")) {
            throw new BindError(`${item.expr.fn} PARTITION BY expressions are outside the measured grouped ranking subset`, node);
          }
          const outside = [...windowColumns(item.expr)].filter((name) => !keyNames.has(name));
          if (outside.length > 0) {
            throw new BindError(`${item.as} window reads ${outside.join(", ")} outside the GROUP BY`, node);
          }
          // The relation calls these `aggs`, but they are more precisely the
          // computed outputs of the grouped SELECT. Keeping the window in
          // this query block preserves SQL's group -> having -> window order.
          aggs.push(item);
        }
        else if (isAggregate(item.expr)) aggs.push(item);
        else if (item.expr?.node === "col" && keyNames.has(String(item.expr.name).toUpperCase())) keys.push(item);
        else {
          throw new BindError(`${item.as} is neither an aggregate nor one of the GROUP BY columns`, node);
        }
      }
      rel = aggregate(rel, keys.map((k) => k.expr.name), aggs);
      const having = kids(node, "Condition")[hasWord(node, "WHERE") ? 1 : 0];
      if (hasWord(node, "HAVING")) {
        if (having === undefined) throw new BindError("a HAVING with no condition in it", node);
        const predicate = condition(having);
        if (containsWindow(predicate)) throw new BindError("a window function is not legal in HAVING", having);
        // above the aggregate, which is what HAVING means and where the
        // lowering already puts a filter
        rel = filter(rel, predicate);
      }
      const hinted = hintsOf(node);
      return orderAndLimit(node, hinted === undefined ? rel : {...rel, hints: hinted});
    }
    if (hasWord(node, "HAVING")) {
      throw new BindError("a HAVING without a GROUP BY is not lowered", node);
    }
    rel = project(rel, items);
    // DISTINCT rides on the projection rather than becoming a relation of its
    // own: it is a property of how the rows come out, which is what the
    // lowering renders.
    if (hasWord(node, "DISTINCT")) rel = {...rel, distinct: true};
    const hints = hintsOf(node);
    if (hints !== undefined) rel = {...rel, hints};
    return orderAndLimit(node, rel);
  }

  /** the ORDER BY and LIMIT that sit at the end of a SELECT -- and at the end
   *  of a whole UNION, which is where they belong to the set and not to its
   *  last branch.
   *
   *  Pulled out of select() the moment the grammar learned the second place:
   *  a trailing ORDER BY that only ONE of the two readers knew about was
   *  silently dropped, and the statement came out sorted by nothing. The
   *  end-to-end test caught it, which is the only reason this paragraph is
   *  not a bug report. A clause the parser can read and the binder cannot is
   *  worse than one neither of them has. */
  function orderAndLimit(node, input) {
    if (node === undefined) throw new BindError("an ORDER BY / LIMIT was read off a tree that is not there");
    let rel = input;
    const keys = kids(node, "OrderKey");
    if (keys.length > 0) {
      // the shape the lowering reads is {col, desc}, not {expr, dir}: the IR
      // is the contract and the parser conforms to it. Producing a
      // near-miss here would have created exactly the translation layer we
      // agreed not to build -- and it would have been found at run time, on
      // an engine, rather than here.
      // a key may name a column of the projection rather than of the
      // sources: `... row_number() OVER (...) AS row_nr ... ORDER BY row_nr`
      // (two corpus bodies, 2026-09-22). The projection's aliases are in
      // scope for ORDER BY, and only there.
      const projection = input.rel === "project" ? input : undefined;
      const aliasOf = (k) => {
        // the key is a bare name when the whole key is one ColumnRef of one Name
        const leaves = terminalLeaves(k);
        const single = leaves.length === 1 && leaves[0].node === "identifier" ? String(leaves[0].value).toUpperCase() : undefined;
        return projection?.items.some((item) => item.as === single) ? single : undefined;
      };
      rel = order(rel, keys.map((k) => {
        const projected = aliasOf(k);
        if (projected !== undefined) return {col: projected, desc: hasWord(k, "DESC")};
        // the statement's ORDER BY sees the projected columns only, so a
        // source qualifier (`ORDER BY a.id`) has nothing to resolve against;
        // said by name rather than as a column that "is not present"
        if (node.node !== "Select" && terminalLeaves(k).some((leaf) => leaf.value === ".")) {
          throw new BindError("ORDER BY a qualified source column is not lowered yet", k);
        }
        const e = expression(k);
        if (e.node !== "col") {
          throw new BindError("ORDER BY over an expression is not lowered yet", k);
        }
        return {col: e.name, desc: hasWord(k, "DESC")};
      }));
    }
    // TOP is a word of the Select itself (direct child), and it applies after
    // the ORDER BY: when the ORDER BY sits on the enclosing statement, the
    // statement applies the TOP (topOf, relationBody) and the select skips it
    // (LIMIT belongs to the enclosing statement, which refuses it beside a TOP)
    const top = node.node === "Select" && !deferredTop.has(node) ? topOf(node) : undefined;
    if (top !== undefined) rel = limit(rel, top);
    if (hasWord(node, "LIMIT")) {
      const after = (node.children ?? []);
      const at = after.findIndex((c) => c.node === "word" && String(c.value).toUpperCase() === "LIMIT");
      const count = after.slice(at + 1).find((c) => c.node === "Expr");
      const value = count === undefined ? undefined : expression(count);
      if (value?.type?.abap !== "I" || !["lit", "param"].includes(value?.node)) {
        throw new BindError("LIMIT requires a literal or scalar INTEGER count", node);
      }
      if (hasWord(node, "OFFSET")) {
        const offsetAt = after.findIndex((c) => c.node === "word" && String(c.value).toUpperCase() === "OFFSET");
        const offsetNode = after.slice(offsetAt + 1).find((c) => c.node === "Expr");
        const offset = offsetNode === undefined ? undefined : expression(offsetNode);
        if (offset?.node !== "lit" || offset.value !== 0) {
          throw new BindError("LIMIT supports only the semantics-neutral literal OFFSET 0", node);
        }
      }
      rel = limit(rel, value);
    }
    return rel;
  }

  function relation(node) {
    if (node === undefined) {
      throw new BindError("a relation was expected here and the tree has none");
    }
    // `WITH a AS (...), b AS (...)`: each definition is bound in order (a
    // later one may read an earlier one) and inlined where its name stands,
    // like a table variable -- a CTE is not a barrier either. The names are
    // scoped to this statement: the map is restored when it is done.
    const cteDefs = kids(node, "CteDef");
    if (directWord(node, "RECURSIVE")) throw new BindError("WITH RECURSIVE is not lowered", node);
    if (cteDefs.length > 0) {
      const outerCtes = ctes;
      const outerLater = laterCtes;
      ctes = new Map(outerCtes);
      try {
        for (const [at, def] of cteDefs.entries()) {
          const cteName = nameOf(kid(def, "Name"));
          laterCtes = new Set(cteDefs.slice(at + 1).map((one) => nameOf(kid(one, "Name"))));
          if (ctes.has(cteName) && !outerCtes.has(cteName)) throw new BindError(`WITH names ${cteName.toLowerCase()} twice`, def);
          let body = relation(kid(def, "SetOperation"));
          const renames = kids(def, "Name").slice(1).map(nameOf);
          if (renames.length > 0) {
            const shape = Object.entries(schemaOf(body, catalogue));
            if (shape.length !== renames.length) {
              throw new BindError(`WITH ${cteName.toLowerCase()} names ${renames.length} column(s) for a select of ${shape.length}`, def);
            }
            if (new Set(renames).size !== renames.length) throw new BindError(`WITH ${cteName.toLowerCase()} names a column twice`, def);
            body = project(body, shape.map(([from, type], i) => ({as: renames[i], expr: col(from, type)})));
          }
          ctes.set(cteName, body);
        }
        laterCtes = outerLater;
        return relationBody(node);
      } finally {
        ctes = outerCtes;
        laterCtes = outerLater;
      }
    }
    return relationBody(node);
  }

  function relationBody(node) {
    const selects = kids(node, "Select");
    // `SELECT TOP n ... ORDER BY ...` reads the ORDER BY onto the statement:
    // sort first, then take n, as HANA does
    const selectTop = selects.length === 1 ? topOf(selects[0]) : undefined;
    if (selectTop !== undefined && directWord(node, "LIMIT")) {
      throw new BindError("a select with both TOP and LIMIT has no single reading", node);
    }
    const top = kids(node, "OrderKey").length > 0 ? selectTop : undefined;
    if (top !== undefined) deferredTop.add(selects[0]);
    const finishSet = (rel) => {
      const outerWords = new Set((node.children ?? []).filter((one) => one.node === "word")
        .map((one) => String(one.value).toUpperCase()));
      if (kids(node, "OrderKey").length === 0 && !outerWords.has("LIMIT")) return rel;
      const outerColumns = columns;
      const outerAmbiguous = ambiguousColumns;
      columns = schemaOf(rel, catalogue);
      ambiguousColumns = new Set();
      try { return orderAndLimit(node, rel); }
      finally {
        columns = outerColumns;
        ambiguousColumns = outerAmbiguous;
      }
    };
    // the trailing ORDER BY / LIMIT belong to the set operation, not to its
    // last branch, so they are applied here and over the whole thing
    if (selects.length === 1) {
      const rel = finishSet(select(selects[0]));
      return top === undefined ? rel : limit(rel, top);
    }
    if (selects.some((one) => topOf(one) !== undefined)) {
      throw new BindError("TOP inside a branch of a set operation is not lowered", node);
    }
    // **Which set operation it was is a word, and the word was never read.**
    //
    // `EXCEPT` and `INTERSECT` parse into the same node as `UNION` and were
    // lowered as a union -- so a body asking for the rows of A that are NOT
    // in B got the rows of A *plus* B. That is not a dropped clause, it is
    // the opposite answer, returned plausibly, with nothing to notice. Found
    // by asking every clause of the grammar what it lowers to, one day after
    // the same sweep found GROUP BY, HAVING and DISTINCT in the same state
    // (2026-09-19).
    //
    // The IR carries one set operation. Until it carries three, the other two
    // are refused by name.
    if (hasWord(node, "INTERSECT")) {
      throw new BindError("INTERSECT is parsed but has no measured portable IR/lowering", node);
    }
    if (hasWord(node, "EXCEPT")) {
      if (hasWord(node, "UNION") || selects.length !== 2) {
        throw new BindError("mixed or multi-branch EXCEPT is outside the measured portable subset", node);
      }
      return finishSet(except(select(selects[0]), select(selects[1])));
    }
    const all = hasWord(node, "ALL");
    return finishSet(union(typeNullsAcross(selects.map(select)), all));
  }

  // The procedural compiler owns statement order and control flow, but it
  // must use this exact binder for the expressions and relations inside
  // those statements. Fragment entry points avoid both a second binder and
  // reparsing source substrings with regular expressions.
  // an expression or condition fragment (IF, WHILE, a scalar assignment)
  // may hold a subquery with a bare NULL; it is checked like a relation
  if (options.fragment === "expression") return noUntyped({expr: expression(tree)}).expr;
  if (options.fragment === "condition") return noUntyped({cond: condition(tree)}).cond;
  // the procedural compiler binds relations one assignment at a time; a bare
  // NULL there is typed by the target's schema when it passes one, and a
  // NULL nothing typed is refused here exactly as at the end of a body
  if (options.fragment === "relation") return noUntyped({rel: typeNullsFrom(relation(tree), options.targetSchema)}).rel;
  if (options.fragment === "type") return typeFromName(tree);

  // The body, statement by statement and **in order**, because an assignment
  // binds a name the statements after it may use. The grammar wraps each one
  // in a `Statement`, so the list is flattened one level -- and not deeper:
  // an assignment inside a subquery is not a statement of this body.
  // A BEGIN..END block contributes its statements to the body: the block
  // introduces no scope the lowering can see, because a table variable
  // declared inside one is still a name the statements after it use. So the
  // list is flattened through blocks as well as through Statement wrappers
  // -- and still not into a subquery, which is not a statement of this body.
  const flat = [];
  const collect = (node) => {
    for (const child of node.children ?? []) {
      if (child.node === "Statement") collect(child);
      else if (child.node === "Block") collect(child);
      else flat.push(child);
    }
  };
  collect(tree);

  const statements = [];
  let last;
  let returnedRel;
  for (const node of flat) {
    switch (node.node) {
      case "Assignment": {
        const name = nameOf(kid(node, "Name"));
        const set = kid(node, "SetOperation");
        if (set === undefined) {
          // `c_is_active := 'X';` -- an assignment to a **scalar**, which
          // this IR does not carry: it holds relations and the expressions
          // inside them. Refused by name rather than crashing three frames
          // down in `kids`, where the message named the line that fell over
          // and not the thing that was wrong.
          throw new BindError(`the assignment to ${name.toLowerCase()} is of a scalar, and this IR carries relations`, node);
        }
        // an assignment to the declared output, or to a variable whose schema
        // was declared, types a bare NULL by that schema's column
        const targetSchema = outParam !== undefined && String(outParam.name).toUpperCase() === name ? outSchema : relationSchemas[name];
        const rel = typeNullsFrom(relation(set), targetSchema);
        bound.set(name, {rel});
        statements.push({stmt: "assign", name, rel});
        break;
      }
      case "SetOperation":
        last = node;
        break;
      case "Return": {
        // `RETURN :lt;` or `RETURN SELECT ...;` -- what the body answers
        // with. Blocked 17 of the 34 bodies that parsed, which is why it is
        // the first thing lowered rather than the next thing parsed.
        const returned = kid(node, "SetOperation");
        if (returned !== undefined) {
          last = returned;
          break;
        }
        const expr = kid(node, "Expr");
        const host = expr === undefined ? undefined : (function find(n) {
          if (n.node === "host") return n;
          for (const c of n.children ?? []) {
            const got = find(c);
            if (got !== undefined) return got;
          }
          return undefined;
        })(expr);
        if (host === undefined) {
          throw new BindError("RETURN of something that is not a table variable or a select", node);
        }
        const name = String(host.value).slice(1).toUpperCase();
        const known = bound.get(name);
        if (known === undefined) {
          throw new BindError(`RETURN of an unassigned table variable :${name.toLowerCase()}`, host);
        }
        returnedRel = known.handle === undefined ? known.rel : refTo(known.handle, schemaOf(known.rel, catalogue));
        break;
      }
      case "While":
        // The relational binder deliberately does not flatten a loop. The
        // procedural compiler consumes this node and invokes this binder for
        // each relational assignment with the current immutable bindings.
        throw new BindError("While is parsed but belongs to the procedural IR, not the relational IR", node);
      case "ForRange":
      case "For":
        // the same: a loop over a cursor's rows or a range is the procedural compiler's
        throw new BindError("For is parsed but belongs to the procedural IR, not the relational IR", node);
      case "word":
      case "operator":
        break;
      default:
        // Declare, Return, Block and the rest of the imperative shell are
        // parsed but not yet lowered. Refused by name: a body whose
        // declarations were silently dropped would run and answer something
        // plausible, which is the one outcome worse than a refusal.
        throw new BindError(`${node.node} is parsed but not lowered yet`, node);
    }
  }
  if (returnedRel !== undefined) return noUntyped({statements, rel: typeNullsFrom(returnedRel, outSchema)});
  if (last === undefined && outParam !== undefined) {
    // the body answers through its OUT table parameter: the last thing
    // assigned to it is the plan, and there is no final select because the
    // procedure does not need one
    const assigned = bound.get(String(outParam.name).toUpperCase());
    if (assigned !== undefined) return noUntyped({statements, rel: typeNullsFrom(assigned.rel, outSchema)});
  }
  if (last === undefined && options.allowNoResult === true) return noUntyped({statements});
  if (last === undefined) throw new BindError("a body has to end in a statement that produces rows", tree);
  return noUntyped({statements, rel: typeNullsFrom(relation(last), outSchema)});
}
