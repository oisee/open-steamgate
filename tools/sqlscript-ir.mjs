// The relational half of a SQLScript body, as data.
//
// This is the IR the splitter lowers (docs/sqlscript-splitter.md). It is
// deliberately written and tested BEFORE any parser exists: twenty fixtures
// built by hand answer "can this model express the semantics" for the cost
// of an afternoon, where finding the same answer after a front end exists
// costs a front end. If the model cannot carry it, nothing downstream can.
//
// Two rules the shape follows, both of them measured rather than preferred:
//
//   1. **An assignment to a table variable is not a barrier.** Measured on
//      HANA Express: a projection that would fail does not fail when a later
//      filter removes the offending row, and the same body does fail under
//      NO_INLINE (docs/sqlscript-hana-observed.md). So a chain of assignments
//      is ONE plan here, not three, and `lower()` must produce one statement.
//
//   2. **Every expression carries the type HANA would give it.** Not for
//      documentation: the lowering cannot choose a form without it. `1/2` is
//      0.5 in DuckDB and 0 in SQLite, so a division node that does not know
//      it is integer division has no correct rendering in either.
//
// Nothing here talks to a database. Lowering is in sqlscript-lower.mjs.

/** ABAP-ish type letters, because that is what the caller and the seam speak */
export const T = {
  int: {abap: "I"},
  dec: (len, dec) => ({abap: "P", len, dec}),
  char: (len) => ({abap: "C", len}),
  str: {abap: "STRING"},
  date: {abap: "D"},
  bool: {abap: "BOOL"},
};

// ---------------------------------------------------------------- expressions

export const col = (name, type) => ({node: "col", name, type});
export const lit = (value, type) => ({node: "lit", value, type});
/** a host value: bound by the driver, never rendered into the text */
export const param = (name, type, isNull = false) => ({node: "param", name, type, isNull});

/**
 * An arithmetic or comparison node. `type` is the type HANA gives the RESULT,
 * and it is required: integer division and decimal division are different
 * operations that look identical in the source.
 */
export const bin = (op, left, right, type) => ({node: "bin", op, left, right, type});
export const call = (fn, args, type) => ({node: "call", fn, args, type});
export const cast = (expr, type) => ({node: "cast", expr, type});
export const isNull = (expr) => ({node: "isnull", expr, type: T.bool});

// ------------------------------------------------------------------ relations

export const scan = (table) => ({rel: "scan", table});
/**
 * `FROM :lt` - a reference to a table variable, as the PARSER sees it.
 *
 * This is the one node the lowering never accepts. A table variable is not a
 * barrier (measured on HANA), so `lt2 = SELECT ... FROM :lt1` is not a
 * sequence of two statements: it is one plan in which lt1's plan sits where
 * the FROM is. Performing that substitution is the binder's job, and it has
 * two possible outcomes - inline the referenced plan (the usual case, and
 * what makes a chain one statement), or, if a barrier materialised the
 * variable, replace it with `ref(handle)`.
 *
 * Keeping it a distinct node rather than letting the parser emit `scan("lt")`
 * matters for a reason the lexer already had to solve one level down: `FROM
 * :lt` and `FROM lt` are different objects - the second is a database table,
 * and shadowing a real table name is ordinary. Losing the colon here would
 * read one and mean the other.
 */
export const varRef = (name) => ({rel: "var", name});
/** a relation the seam already knows by name (a barrier materialised it) */
export const ref = (handle) => ({rel: "ref", handle});

/**
 * The same, with the schema of the plan that was materialised.
 *
 * Use this one in the binder. A `ref` is the only node whose columns cannot
 * be derived from anything below it - there is nothing below it - so the
 * schema has to be carried, and the moment it is known is the moment the
 * barrier is created. `schemaOf` refuses a bare `ref` rather than guessing,
 * which is correct and also easy to hit; this exists so it is easier to do
 * the right thing than the wrong one.
 */
export const refTo = (handle, schema) => ({rel: "ref", handle, schema});
export const filter = (input, pred) => ({rel: "filter", input, pred});
export const project = (input, items) => ({rel: "project", input, items});
export const join = (left, right, on, kind = "inner") => ({rel: "join", left, right, on, kind});
export const union = (inputs, all = true) => ({rel: "union", inputs, all});
export const aggregate = (input, groupBy, aggs) => ({rel: "aggregate", input, groupBy, aggs});
export const order = (input, keys) => ({rel: "order", input, keys});
export const limit = (input, n) => ({rel: "limit", input, n});

/**
 * The effects of a relational subtree, which is what decides whether a chain
 * may stay one plan. `mayThrow` is the interesting one: fusing a chain whose
 * projection can raise moves the error - measured, both on HANA and on our
 * own engines - so a caller that cares must materialise deliberately and say
 * why (the seam's `materialise` reason).
 */
export function effects(rel) {
  const out = {mayThrow: false, nonDeterministic: false, reads: []};
  const walkExpr = (e) => {
    if (e === undefined || e === null) return;
    if (e.node === "cast") out.mayThrow = true;
    if (e.node === "bin" && e.op === "/") out.mayThrow = true;
    if (e.node === "call" && ["TO_INTEGER", "TO_DECIMAL", "TO_TIMESTAMP", "TO_DATE"].includes(e.fn)) out.mayThrow = true;
    if (e.node === "call" && ["RAND", "CURRENT_TIMESTAMP", "CURRENT_DATE"].includes(e.fn)) out.nonDeterministic = true;
    for (const key of ["left", "right", "expr"]) walkExpr(e[key]);
    for (const one of e.args ?? []) walkExpr(one);
  };
  const walk = (r) => {
    if (r === undefined) return;
    if (r.rel === "scan") out.reads.push(r.table);
    walkExpr(r.pred);
    for (const item of r.items ?? []) walkExpr(item.expr);
    for (const agg of r.aggs ?? []) walkExpr(agg.expr);
    walkExpr(r.on);
    for (const key of ["input", "left", "right"]) walk(r[key]);
    for (const one of r.inputs ?? []) walk(one);
  };
  walk(rel);
  return out;
}

/**
 * The seam speaks a different type language, and this is the translation.
 *
 * Inside the IR a type is an object, because the lowering has to ask it
 * questions - is this division integer, how wide is this character field.
 * The native channel's contract (docs/db-seam-native.md) says `type` is "an
 * ABAP type letter with length and decimals", which is a string. Both halves
 * were written against the same document and still disagreed here, and
 * nothing said so until a plan was actually executed: the text-level tests
 * were green throughout. That is the argument for running the fixtures and
 * not only spelling them.
 */
export function seamType(type) {
  if (type === undefined || type === null) return "STRING";
  if (typeof type === "string") return type;
  const {abap, len, dec} = type;
  if (abap === "P" && len !== undefined) return `P(${len},${dec ?? 0})`;
  if (len !== undefined) return `${abap}(${len})`;
  return abap;
}

/**
 * The output schema of a plan: {COLUMN: type}.
 *
 * The typer needs the type of a COLUMN, not only of a literal, and a column's
 * type has two different sources depending on what it hangs off:
 *
 *   - a `scan` reads it from the **catalogue**, which is passed in rather
 *     than imported. A pure function with a catalogue argument can be tested
 *     with four lines of fixture; one that reaches into the runtime registry
 *     drags the whole system into every test of the type rules.
 *   - a **table variable has no catalogue entry at all**. Its columns are
 *     whatever the plan that defined it produces, so the schema is computed
 *     bottom-up through the tree - which is also why `var` must be resolved
 *     before this is asked: an unresolved variable has no schema anywhere.
 *
 * The catalogue is the smallest thing that answers the question:
 *
 *   {"SRC": {"K": {abap: "C", len: 3}, "N": {abap: "I"}}}
 *
 * so the runtime's own registry is adapted into it by a caller, outside this
 * file, and nothing here knows that a registry exists.
 */
export function schemaOf(rel, catalogue = {}) {
  const need = (r) => schemaOf(r, catalogue);
  switch (rel.rel) {
    case "scan": {
      const table = catalogue[rel.table] ?? catalogue[rel.table?.toUpperCase?.()];
      if (table === undefined) throw new Error(`schemaOf: the catalogue does not describe ${rel.table}`);
      return {...table};
    }
    case "var":
      throw new Error(`schemaOf: :${rel.name} has no schema until the binder resolves it`);
    case "ref":
      // a materialised relation: its schema is the plan's that made it, and
      // the binder knows which that was - it must carry it on the node
      if (rel.schema === undefined) throw new Error("schemaOf: a ref must carry the schema of the relation it points at");
      return {...rel.schema};
    case "filter":
    case "order":
    case "limit":
      return need(rel.input);
    case "project":
      return Object.fromEntries(rel.items.map((item) => [item.as, typeOfExpr(item.expr, need(rel.input))]));
    case "join": {
      const left = need(rel.left);
      const right = need(rel.right);
      return {...left, ...right};
    }
    case "union": {
      const all = rel.inputs.map(need);
      const first = Object.keys(all[0]);
      for (const one of all.slice(1)) {
        // SQLScript lets a UNION of mismatched shapes through only by
        // position; refusing here is cheaper than a wrong column later
        if (JSON.stringify(Object.keys(one)) !== JSON.stringify(first)) {
          throw new Error("schemaOf: the branches of a UNION do not have the same columns");
        }
      }
      return {...all[0]};
    }
    case "aggregate": {
      const input = need(rel.input);
      const out = {};
      for (const key of rel.groupBy) out[key] = input[key];
      for (const agg of rel.aggs) out[agg.as] = typeOfExpr(agg.expr, input);
      return out;
    }
    default:
      throw new Error(`schemaOf: no schema rule for ${rel.rel}`);
  }
}

/** the type an expression produces, given the schema it reads from */
export function typeOfExpr(expr, schema = {}) {
  switch (expr.node) {
    case "col": {
      const type = schema[expr.name] ?? schema[expr.name?.toUpperCase?.()];
      if (type === undefined) throw new Error(`typeOfExpr: ${expr.name} is not in the input schema`);
      return type;
    }
    case "lit":
    case "param":
      return expr.type;
    case "isnull":
      return T.bool;
    case "cast":
      return expr.type;
    case "bin":
    case "call":
      // Only the nodes the LOWERING renders differently actually need a
      // computed type - division and casts - so a typer that knows those two
      // and copies the rest through unblocks the first bodies long before
      // full inference exists. Where the type is already on the node, it wins:
      // the parser may know better than a rule we have not measured.
      if (expr.type !== undefined) return expr.type;
      throw new Error(`typeOfExpr: ${expr.node} ${expr.op ?? expr.fn} carries no type and no rule has been measured for it`);
    default:
      throw new Error(`typeOfExpr: no type rule for ${expr.node}`);
  }
}

/**
 * Rows chosen to make a plan misbehave, derived from the plan itself.
 *
 * The fused-against-forced comparison only says something when the data can
 * reach the expression that behaves differently. Representative data almost
 * never does: a cast diverges on the one row that is not a number, a division
 * on the one row that is zero, arithmetic on the one row that is NULL, and a
 * fixture invented to look plausible contains none of them. So the rows are
 * derived from the expressions in the plan rather than from imagination -
 * which is also the only way to do it automatically for a corpus nobody has
 * read.
 *
 * Returns {column: value} suggestions, one per hazard found, plus the reason,
 * so a caller can build its fixture and a reader can see why each row is
 * there. It does not invent a schema: a column it cannot see in `schema` is
 * reported and left to the caller.
 */
export function adversarialRows(rel, schema = {}) {
  const out = [];
  const note = (column, value, why) => {
    if (column === undefined) return;
    out.push({column, value, why, known: Object.prototype.hasOwnProperty.call(schema, column)});
  };
  const colOf = (e) => (e?.node === "col" ? e.name : undefined);

  const walkExpr = (e) => {
    if (e === undefined || e === null) return;
    if (e.node === "cast" || (e.node === "call" && /^TO_(INTEGER|DECIMAL|DATE|TIMESTAMP)$/.test(e.fn ?? ""))) {
      note(colOf(e.expr ?? e.args?.[0]), "not-a-number", "a cast raises on a value that will not convert, and only on that row");
    }
    if (e.node === "bin" && e.op === "/") {
      note(colOf(e.right), 0, "division by zero raises on HANA, is Infinity in DuckDB and NULL in sql.js");
    }
    if (e.node === "bin" && ["+", "-", "*"].includes(e.op)) {
      note(colOf(e.right) ?? colOf(e.left), null, "NULL in arithmetic propagates, and a filter may remove the row before or after");
    }
    for (const key of ["left", "right", "expr"]) walkExpr(e[key]);
    for (const one of e.args ?? []) walkExpr(one);
  };
  const walk = (r) => {
    if (r === undefined) return;
    walkExpr(r.pred);
    for (const item of r.items ?? []) walkExpr(item.expr);
    for (const agg of r.aggs ?? []) walkExpr(agg.expr);
    walkExpr(r.on);
    for (const key of ["input", "left", "right"]) walk(r[key]);
    for (const one of r.inputs ?? []) walk(one);
  };
  walk(rel);
  return out;
}
