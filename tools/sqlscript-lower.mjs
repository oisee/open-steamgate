// Lowering the relational IR into one engine's dialect.
//
// The whole point of the splitter is that this is the ONLY place a dialect
// is known (docs/sqlscript-splitter.md). The host half - control flow,
// scalars, loops - is JavaScript and never comes here; what arrives is a
// relational subtree, and what leaves is one statement plus its bound
// values, ready for the seam's `native()` (docs/db-seam-native.md).
//
// Values are bound, identifiers are generated: a param becomes a placeholder
// and travels in `params`, and a relation already known to the seam becomes
// whatever `relationRef()` gave us. Nothing is interpolated.
//
// The divergences below are measured, not assumed:
//
//   1 / 2         HANA 0.500000, DuckDB 0.5, sql.js 0
//   -7 / 2        HANA -3.500000, DuckDB -3.5, sql.js -3
//   CAST('x' AS INTEGER)  HANA raises, DuckDB raises, sql.js returns 0
//
// The first line was written the other way round here until the oracle
// answered: this file assumed HANA truncated integer division, and it does
// not - `/` over two INTEGERs yields a decimal. So DuckDB was the engine
// that already matched and the browser engine is the outlier, which is the
// opposite of what the code did. Fixed below, and left on the record,
// because the assumption was plausible, uncontested and wrong.
//
// So division and casts have a per-dialect rendering rather than a
// pass-through, and a dialect that cannot express one refuses instead of
// approximating. Refusing is a feature: an engine that quietly returns a
// different number is the failure this project has already paid for twice.

const DIALECTS = {
  hana: {
    quote: (id) => `"${id.replace(/"/g, '""')}"`,
    placeholder: () => "?",
    // `/` yields a decimal even over two INTEGERs - measured, not assumed
    divide: (a, b) => `(${a} / ${b})`,
    // and when the source asked for integer division, it says so
    intDiv: (a, b) => `DIV(${a}, ${b})`,
    concat: (args) => args.join(" || "),
    ifnull: (a, b) => `IFNULL(${a}, ${b})`,
    substr: (s, from, len) => `SUBSTRING(${s}, ${from}, ${len})`,
    castInt: (e) => `CAST(${e} AS INTEGER)`,
    dummy: "DUMMY",
  },
  duckdb: {
    quote: (id) => `"${id.replace(/"/g, '""')}"`,
    placeholder: () => "?",
    // `/` is floating point here, which is what HANA does too
    divide: (a, b) => `(${a} / ${b})`,
    // `//` is the integer one, for when the source asked for it
    intDiv: (a, b) => `(${a} // ${b})`,
    concat: (args) => args.join(" || "),
    ifnull: (a, b) => `COALESCE(${a}, ${b})`,
    substr: (s, from, len) => `SUBSTRING(${s}, ${from}, ${len})`,
    // raises like HANA, so it passes through
    castInt: (e) => `CAST(${e} AS INTEGER)`,
    dummy: "(SELECT 1) AS dummy",
  },
  sqlite: {
    quote: (id) => `"${id.replace(/"/g, '""')}"`,
    placeholder: () => "?",
    // `/` over two integers truncates here and does NOT on HANA, so a
    // decimal division has to be forced. This is the typed rewrite the
    // conformance table found, and it exists only for this engine.
    divide: (a, b) => `((${a}) * 1.0 / (${b}))`,
    intDiv: (a, b) => `(${a} / ${b})`,
    concat: (args) => args.join(" || "),
    ifnull: (a, b) => `IFNULL(${a}, ${b})`,
    substr: (s, from, len) => `SUBSTR(${s}, ${from}, ${len})`,
    // SQLite's CAST never raises: 'x' becomes 0, which is a DIFFERENT
    // program. There is no expression that makes it raise, so this dialect
    // declines the node rather than returning a wrong number quietly.
    castInt: () => {
      throw new Refused("CAST to INTEGER cannot raise in SQLite: it returns 0 where HANA and DuckDB raise");
    },
    dummy: "(SELECT 1) AS dummy",
  },
};

import {seamType} from "./sqlscript-ir.mjs";

export class Refused extends Error {}

export function lower(rel, dialectName, options = {}) {
  const d = DIALECTS[dialectName];
  if (d === undefined) throw new Refused(`no dialect ${dialectName}`);
  const params = [];
  const refOf = options.relationRef ?? ((handle) => handle);

  const expr = (e) => {
    switch (e.node) {
      case "col": return d.quote(e.name);
      case "lit":
        if (typeof e.value === "number") return String(e.value);
        // a string literal still goes through a parameter: a literal in the
        // text is the class of defect this contract exists to remove
        params.push({name: `p${params.length}`, value: e.value, type: seamType(e.type)});
        return d.placeholder(params.length);
      case "param":
        params.push({name: e.name, value: e.value, type: seamType(e.type), isNull: e.isNull});
        return d.placeholder(params.length);
      case "bin": {
        const left = expr(e.left);
        const right = expr(e.right);
        if (e.op === "/") {
          // The result type decides which of the two divisions this is, and
          // it is the reason every node carries one: plain `/` in SQLScript
          // yields a decimal, and only an explicitly integer result means
          // the truncating operator.
          return e.type?.abap === "I" ? d.intDiv(left, right) : d.divide(left, right);
        }
        return `(${left} ${e.op} ${right})`;
      }
      case "cast":
        if (e.type?.abap === "I") return d.castInt(expr(e.expr));
        throw new Refused(`cast to ${JSON.stringify(e.type)} not lowered yet`);
      case "isnull": return `(${expr(e.expr)} IS NULL)`;
      case "call": {
        const args = e.args.map(expr);
        if (e.fn === "CONCAT") return `(${d.concat(args)})`;
        if (e.fn === "IFNULL") return d.ifnull(args[0], args[1]);
        if (e.fn === "SUBSTR") return d.substr(args[0], args[1], args[2]);
        if (e.fn === "TO_INTEGER") return d.castInt(args[0]);
        return `${e.fn}(${args.join(", ")})`;
      }
      default: throw new Refused(`expression ${e.node} not lowered`);
    }
  };

  // A relation becomes a SELECT; an input that is itself a relation becomes a
  // subquery. That is how a chain of assignments ends up as ONE statement:
  // the chain is nesting, not sequence, because HANA says an assignment is
  // not a barrier.
  let alias = 0;
  const from = (r) => {
    if (r.rel === "scan") return d.quote(r.table);
    if (r.rel === "ref") return refOf(r.handle);
    return `(${select(r)}) AS ${d.quote(`t${alias++}`)}`;
  };

  const select = (r) => {
    switch (r.rel) {
      case "scan":
      case "ref":
        return `SELECT * FROM ${from(r)}`;
      case "filter":
        return `SELECT * FROM ${from(r.input)} WHERE ${expr(r.pred)}`;
      case "project":
        return `SELECT ${r.items.map((i) => `${expr(i.expr)} AS ${d.quote(i.as)}`).join(", ")} FROM ${from(r.input)}`;
      case "join":
        return `SELECT * FROM ${from(r.left)} ${r.kind.toUpperCase()} JOIN ${from(r.right)} ON ${expr(r.on)}`;
      case "union":
        return r.inputs.map(select).join(r.all ? " UNION ALL " : " UNION ");
      case "aggregate": {
        const keys = r.groupBy.map((c) => d.quote(c));
        const aggs = r.aggs.map((a) => `${expr(a.expr)} AS ${d.quote(a.as)}`);
        const group = keys.length === 0 ? "" : ` GROUP BY ${keys.join(", ")}`;
        return `SELECT ${[...keys, ...aggs].join(", ")} FROM ${from(r.input)}${group}`;
      }
      case "order":
        return `SELECT * FROM ${from(r.input)} ORDER BY ${r.keys.map((k) => `${d.quote(k.col)} ${k.desc ? "DESC" : "ASC"}`).join(", ")}`;
      case "limit":
        return `SELECT * FROM ${from(r.input)} LIMIT ${Number(r.n)}`;
      default: throw new Refused(`relation ${r.rel} not lowered`);
    }
  };

  return {sql: select(rel), params};
}

/** how many statements this plan will cost - one, unless a barrier says otherwise */
export function statementCount(rel) {
  let n = 1;
  const walk = (r) => {
    if (r === undefined) return;
    if (r.rel === "ref") n += 0; // already materialised, costs nothing here
    for (const key of ["input", "left", "right"]) walk(r[key]);
    for (const one of r.inputs ?? []) walk(one);
  };
  walk(rel);
  return n;
}
