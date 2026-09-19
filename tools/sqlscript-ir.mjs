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
/** a relation the seam already knows by name (a barrier materialised it) */
export const ref = (handle) => ({rel: "ref", handle});
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
