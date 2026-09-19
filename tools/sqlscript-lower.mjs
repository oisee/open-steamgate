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
// Three more, measured 2026-09-19 against HANA Express when CAST and LIKE
// were added, and every one of them a silent wrong answer rather than an
// error:
//
//   'ABC' LIKE 'abc'          HANA no, DuckDB no, sql.js MATCH
//   CAST('abcdef' AS NVARCHAR(3))   HANA 'abc', DuckDB 'abcdef', sql.js 'abcdef'
//   CAST(1.7 AS INTEGER)      HANA 1, DuckDB 2, sql.js 1
//
// The last one is the uncomfortable one: DuckDB was the engine this file
// trusted to pass casts through, and it ROUNDS where HANA truncates. It had
// been passing casts through since the day the dialect was written. The
// renderings below were then measured back against HANA before being
// written, not reasoned about -- `SUBSTR(CAST(x AS VARCHAR), 1, n)` and
// `CAST(TRUNC(CAST(x AS DOUBLE)) AS INTEGER)` agree with HANA on all six
// probes, including raising on a value that will not convert.
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
    castChar: (e, n) => `CAST(${e} AS NVARCHAR(${n}))`,
    // HANA's own, so they pass through -- they are the reference the two
    // renderings below were measured against
    substrBefore: (s, x) => `SUBSTR_BEFORE(${s()}, ${x()})`,
    substrAfter: (s, x) => `SUBSTR_AFTER(${s()}, ${x()})`,
    toChar: (x) => `TO_NVARCHAR(${x()})`,
    locate: (s, x) => `LOCATE(${s()}, ${x()})`,
    // case-sensitive, which is the reference the other two are measured against
    like: (e, p, esc, neg) => `(${e}${neg ? " NOT" : ""} LIKE ${p}${esc === undefined ? "" : ` ESCAPE ${esc}`})`,
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
    // It raises like HANA on a value that will not convert -- and ROUNDS
    // where HANA truncates, which is the divergence this dialect shipped
    // with. TRUNC through DOUBLE truncates toward zero and still raises.
    castInt: (e) => `CAST(TRUNC(CAST(${e} AS DOUBLE)) AS INTEGER)`,
    // CAST to a character type does not truncate here and does on HANA
    castChar: (e, n) => `SUBSTR(CAST(${e} AS VARCHAR), 1, ${n})`,
    // `SUBSTR_BEFORE` / `SUBSTR_AFTER` are HANA's and exist nowhere else, so
    // they are built out of `instr` and `substr`, which both engines have.
    // The edges were measured rather than assumed: on HANA a miss answers
    // the **empty string** and not NULL, and so does a separator at the very
    // start or the very end. All six probes agree.
    //
    // Note the thunks. Each argument appears three or four times in the text
    // and a rendered argument may be a `?`, so re-using one rendered string
    // would put N placeholders in the statement against one bound value --
    // a statement whose values are out of step with its `?`s, which no
    // engine catches. Calling the thunk once per occurrence pushes one value
    // per placeholder, in the order the text has them.
    substrBefore: (s, x) =>
      `CASE WHEN instr(${s()}, ${x()}) > 0 THEN substr(${s()}, 1, instr(${s()}, ${x()}) - 1) ELSE '' END`,
    substrAfter: (s, x) =>
      `CASE WHEN instr(${s()}, ${x()}) > 0 THEN substr(${s()}, instr(${s()}, ${x()}) + length(${x()})) ELSE '' END`,
    toChar: (x) => `CAST(${x()} AS VARCHAR)`,
    locate: (s, x) => `instr(${s()}, ${x()})`,
    like: (e, p, esc, neg) => `(${e}${neg ? " NOT" : ""} LIKE ${p}${esc === undefined ? "" : ` ESCAPE ${esc}`})`,
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
    // no truncation here either, and SQLite has no TRUNC to borrow
    castChar: (e, n) => `SUBSTR(CAST(${e} AS VARCHAR), 1, ${n})`,
    // SQLite's LIKE is case-INSENSITIVE for ASCII unless the connection says
    // otherwise, and HANA's is not. `PRAGMA case_sensitive_like = ON` fixes
    // it, is connection-scoped and survives transactions (measured), so the
    // two SQLite native channels set it when they open rather than every
    // statement carrying a workaround. A dialect cannot check a pragma from
    // here, which is why this reads as a pass-through and the guarantee lives
    // at the connection: tools/sqljs-native.mjs and tools/sqlite-file-client.mjs.
    // `SUBSTR_BEFORE` / `SUBSTR_AFTER` are HANA's and exist nowhere else, so
    // they are built out of `instr` and `substr`, which both engines have.
    // The edges were measured rather than assumed: on HANA a miss answers
    // the **empty string** and not NULL, and so does a separator at the very
    // start or the very end. All six probes agree.
    //
    // Note the thunks. Each argument appears three or four times in the text
    // and a rendered argument may be a `?`, so re-using one rendered string
    // would put N placeholders in the statement against one bound value --
    // a statement whose values are out of step with its `?`s, which no
    // engine catches. Calling the thunk once per occurrence pushes one value
    // per placeholder, in the order the text has them.
    substrBefore: (s, x) =>
      `CASE WHEN instr(${s()}, ${x()}) > 0 THEN substr(${s()}, 1, instr(${s()}, ${x()}) - 1) ELSE '' END`,
    substrAfter: (s, x) =>
      `CASE WHEN instr(${s()}, ${x()}) > 0 THEN substr(${s()}, instr(${s()}, ${x()}) + length(${x()})) ELSE '' END`,
    toChar: (x) => `CAST(${x()} AS VARCHAR)`,
    locate: (s, x) => `instr(${s()}, ${x()})`,
    like: (e, p, esc, neg) => `(${e}${neg ? " NOT" : ""} LIKE ${p}${esc === undefined ? "" : ` ESCAPE ${esc}`})`,
    dummy: "(SELECT 1) AS dummy",
  },
};

import {seamType} from "./sqlscript-ir.mjs";

/** Functions that mean the same thing on HANA, DuckDB and SQLite.
 *
 *  Short on purpose. Membership is a claim, and the claim is "the same
 *  arguments give the same answer on all three" -- not "all three have a
 *  function with this name", which is how a portability hole gets written by
 *  somebody being helpful. `ROUND` and `LOCATE` are deliberately absent:
 *  they exist everywhere and their tie rule and argument order have not been
 *  measured here. */
const PORTABLE = new Set([
  "LOWER", "UPPER", "LENGTH", "ABS", "COALESCE", "TRIM", "LTRIM", "RTRIM",
  "SUM", "MIN", "MAX", "COUNT", "AVG",
  // measured 2026-09-19: ROUND(2.5) is 3 and ROUND(-2.5) is -3 on all three,
  // and the two-argument form agrees too. It was kept out of this list until
  // it had been asked, which is the rule the list exists for.
  "ROUND",
]);

export class Refused extends Error {}

export function lower(rel, dialectName, options = {}) {
  const d = DIALECTS[dialectName];
  if (d === undefined) throw new Refused(`no dialect ${dialectName}`);
  const params = [];
  const refOf = options.relationRef ?? ((handle) => handle);

  const expr = (e) => {
    // A missing or shapeless node is refused by name, not dereferenced. A
    // TypeError here says "Cannot read properties of undefined (reading
    // 'node')", which names the line that fell over rather than the thing
    // that was wrong, and a histogram of such messages is a histogram of
    // where walkers stand - measured across both halves of this project on
    // 2026-09-19 and fixed in both.
    if (e === undefined || e === null || e.node === undefined) {
      throw new Refused(`an expression arrived without a node kind: ${JSON.stringify(e)?.slice(0, 60)}`);
    }
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
        if (e.type?.abap === "C" && e.type.len !== undefined) return d.castChar(expr(e.expr), Number(e.type.len));
        throw new Refused(`cast to ${JSON.stringify(e.type)} not lowered yet`);
      case "isnull": return `(${expr(e.expr)} IS NULL)`;
      case "not": return `(NOT ${expr(e.expr)})`;
      case "like":
        return d.like(expr(e.expr), expr(e.pattern), e.escape === undefined ? undefined : expr(e.escape), e.negated);
      case "in":
        return `(${expr(e.expr)}${e.negated ? " NOT" : ""} IN (${e.values.map(expr).join(", ")}))`;
      case "sub": {
        // The subquery is rendered **where it appears**, so its own bound
        // values land in `params` in the order the text has them. Building it
        // anywhere else would be the one way to get a statement whose
        // placeholders and values are out of step, which no engine catches
        // and no test that checks the text would either.
        const inner = select(e.rel);
        if (e.kind === "exists") return `(${e.negated ? "NOT " : ""}EXISTS (${inner}))`;
        if (e.kind === "in") return `(${expr(e.expr)}${e.negated ? " NOT" : ""} IN (${inner}))`;
        return `(${inner})`;
      }
      case "case": {
        const whens = e.whens.map((w) => `WHEN ${expr(w.when)} THEN ${expr(w.then)}`).join(" ");
        const other = e.otherwise === undefined ? "" : ` ELSE ${expr(e.otherwise)}`;
        return `(CASE ${whens}${other} END)`;
      }
      case "call": {
        // **Rendering an argument is not free: it pushes that argument's
        // bound values.** So the arguments are rendered exactly as many
        // times as they appear in the text, and never before it is known how
        // many that will be. Mapping them up front (which is what this did)
        // put two values behind one `?` the moment a rendering used an
        // argument twice -- a statement whose values are out of step with
        // its placeholders, which no engine catches and no assertion about
        // the text would either.
        const arg = (i) => () => expr(e.args[i]);
        // the ones whose rendering repeats an argument take thunks
        if (e.fn === "SUBSTR_BEFORE") return d.substrBefore(arg(0), arg(1));
        if (e.fn === "SUBSTR_AFTER") return d.substrAfter(arg(0), arg(1));
        if (e.fn === "TO_NVARCHAR" || e.fn === "TO_VARCHAR") return d.toChar(arg(0));
        if (e.fn === "LOCATE") return d.locate(arg(0), arg(1));
        // and the rest use each argument once, so one rendering is right
        const args = e.args.map(expr);
        if (e.fn === "CONCAT") return `(${d.concat(args)})`;
        if (e.fn === "IFNULL") return d.ifnull(args[0], args[1]);
        if (e.fn === "SUBSTR" || e.fn === "SUBSTRING") return d.substr(args[0], args[1], args[2]);
        if (e.fn === "TO_INTEGER" || e.fn === "TO_INT") return d.castInt(args[0]);
        if (PORTABLE.has(e.fn)) return `${e.fn}(${args.join(", ")})`;
        // **An unknown function is refused, not rendered.**
        //
        // This used to pass any name straight through, which is the same
        // mistake as passing a cast through to DuckDB and for once the
        // corpus made it visible: `SUBSTR_BEFORE`, `SUBSTR_AFTER`, `MAP`,
        // `TO_NVARCHAR`, `SESSION_CONTEXT` are HANA's, and on DuckDB they
        // raise "Scalar Function ... does not exist". Raising is the LUCKY
        // half. The other half is a name that exists on both engines and
        // means something slightly different -- `LOCATE`'s argument order,
        // `ROUND`'s tie rule, `TO_DATE`'s format string -- and that one
        // answers a number instead of an error.
        //
        // `PORTABLE` is therefore a list of functions whose meaning is the
        // same on all three, not a list of functions that exist. A name is
        // added to it by measuring, the way division and casts were.
        throw new Refused(`the function ${e.fn} has no measured rendering on ${dialectName}: ` +
          "it is either HANA's own, or it exists on both engines and may not mean the same thing");
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
    if (r.rel === "var") return select(r); // refuses, with the right message
    if (r.rel === "scan") return d.quote(r.table);
    if (r.rel === "ref") return refOf(r.handle);
    return `(${select(r)}) AS ${d.quote(`t${alias++}`)}`;
  };

  const select = (r) => {
    if (r === undefined || r === null || r.rel === undefined) {
      throw new Refused(`a relation arrived without a rel kind: ${JSON.stringify(r)?.slice(0, 60)}`);
    }
    // the parts each kind cannot do without, checked before they are read
    // A CROSS JOIN has no predicate by definition, so demanding `on` of
    // every join refused the very idiom the corpus uses most (60 bodies) -
    // caught by its own test, which is what that test is for.
    const needs = {filter: ["pred"], project: ["items"],
                   join: r.kind === "cross" ? ["left", "right"] : ["left", "right", "on"],
                   union: ["inputs"], aggregate: ["groupBy", "aggs"], order: ["keys"], limit: ["n"]};
    for (const key of needs[r.rel] ?? []) {
      if (r[key] === undefined) throw new Refused(`a ${r.rel} arrived without its ${key}`);
    }
    switch (r.rel) {
      case "var":
        // deliberately not lowered: see varRef() in sqlscript-ir.mjs. Getting
        // here means the binder did not run, and quietly treating the name as
        // a table would read a database table with the same name - which is
        // an ordinary thing to exist.
        throw new Refused(`the table variable :${r.name} reached the lowering unresolved - the binder must inline it or point it at a materialised relation`);
      case "scan":
      case "ref":
        return `SELECT * FROM ${from(r)}`;
      case "filter":
        return `SELECT * FROM ${from(r.input)} WHERE ${expr(r.pred)}`;
      case "project":
        return `SELECT ${r.items.map((i) => `${expr(i.expr)} AS ${d.quote(i.as)}`).join(", ")} FROM ${from(r.input)}`;
      case "join": {
        // A cross join has no ON, and asking for one crashed rather than
        // refused: `FROM a, b` binds to exactly this node, and every engine
        // spells it `CROSS JOIN`.
        const kind = r.kind.toUpperCase();
        const on = r.on === undefined ? "" : ` ON ${expr(r.on)}`;
        if (kind === "CROSS" && r.on !== undefined) {
          throw new Refused("a CROSS JOIN carries no ON condition");
        }
        if (kind !== "CROSS" && r.on === undefined) {
          throw new Refused(`a ${kind} JOIN without an ON condition is a cross join written by accident, not a join`);
        }
        return `SELECT * FROM ${from(r.left)} ${kind} JOIN ${from(r.right)}${on}`;
      }
      case "union":
        return r.inputs.map(select).join(r.all ? " UNION ALL " : " UNION ");
      case "aggregate": {
        const keys = r.groupBy.map((c) => d.quote(c));
        const aggs = r.aggs.map((a) => `${expr(a.expr)} AS ${d.quote(a.as)}`);
        const group = keys.length === 0 ? "" : ` GROUP BY ${keys.join(", ")}`;
        return `SELECT ${[...keys, ...aggs].join(", ")} FROM ${from(r.input)}${group}`;
      }
      case "order": {
        // **ORDER BY is a clause of the SELECT, not a wrapper around it.**
        //
        // Wrapping produced `SELECT * FROM (SELECT f(k) AS v FROM t) ORDER BY
        // k` -- and `k` is not a column of that subquery, so the engine
        // refuses it. In SQL the ordering is evaluated over the **input** of
        // the select, which is why `SELECT f(k) AS v FROM t ORDER BY k` is
        // ordinary and legal. So a projection underneath is folded in rather
        // than nested, which is what the source said in the first place.
        //
        // The alternative -- ordering first and projecting after -- would
        // rest on row order surviving a projection, which no standard
        // promises and which is exactly the kind of assumption this file
        // exists to avoid.
        const keys = r.keys.map((k) => `${d.quote(k.col)} ${k.desc ? "DESC" : "ASC"}`).join(", ");
        const inner = r.input;
        if (inner?.rel === "project") {
          const items = inner.items.map((i) => `${expr(i.expr)} AS ${d.quote(i.as)}`).join(", ");
          return `SELECT ${items} FROM ${from(inner.input)} ORDER BY ${keys}`;
        }
        return `SELECT * FROM ${from(inner)} ORDER BY ${keys}`;
      }
      case "limit":
        // the same reason: LIMIT belongs to the select it limits, and
        // wrapping an ordered select in an unordered one is a second defect
        // of the same family waiting to be found
        if (r.input?.rel === "order" || r.input?.rel === "project") {
          return `${select(r.input)} LIMIT ${Number(r.n)}`;
        }
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
