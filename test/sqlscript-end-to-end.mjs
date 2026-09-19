import {expect} from "chai";
import {run, compile, BODY, CATALOGUE} from "../tools/sqlscript/end-to-end.mjs";

// The whole chain on one body: text -> lex -> parse -> bind & type -> lower
// -> native() -> rows, on every engine that can carry it. Until this existed
// each stage was tested against the next one's fixtures, which proves the
// seams and not the pipe.
//
// The comparison is of **values**, because the conformance work established
// that an exception is a property of the plan rather than of the program
// (docs/sqlscript-hana-observed.md), so exceptions cannot be compared even
// between two runs of HANA.
const hasHana = process.env.HANA_HOST !== undefined || process.env.STG_AMDP_HANA === "1";

describe("a SQLScript body, all the way to rows", function () {
  this.timeout(120000);

  it("compiles to one statement per engine, with the chain spliced", () => {
    for (const dialect of ["hana", "duckdb", "sqlite"]) {
      const {sql, ir} = compile(BODY, dialect);
      expect(sql, `${dialect} got a statement`).to.be.a("string").and.to.contain("SELECT");
      expect(sql, `${dialect}: one statement, not a script`).to.not.contain(";");
      expect(JSON.stringify(ir.rel), `${dialect}: the variable was spliced`).to.not.contain('"var"');
    }
  });

  it("answers the same values on every engine that can run it", async () => {
    const results = await run({hana: hasHana});
    const answered = results.filter((r) => r.rows !== undefined);
    expect(answered.length, "at least the two local engines answered").to.be.greaterThan(1);
    for (const r of results) {
      expect(r.error, `${r.engine} ran it`).to.equal(undefined);
    }
    const shapes = new Set(answered.map((r) => JSON.stringify(r.rows.map((row) => Object.values(row)))));
    expect(shapes.size, `the engines disagree: ${[...shapes].join(" vs ")}`).to.equal(1);
    // and the values are the ones the body asks for: n > 1, ordered by k
    expect(answered[0].rows.map((row) => row.K ?? row.k)).to.deep.equal(["b", "c"]);
  });

  it("keeps the ORDER BY that belongs to a whole UNION, rather than dropping it", () => {
    // The grammar learned to read a trailing ORDER BY on a set operation
    // before the binder did, and for one commit the clause parsed and then
    // vanished: the statement came out unordered and nothing raised. A clause
    // one half can read and the other cannot is worse than one neither has.
    const {sql} = compile("SELECT k FROM src UNION ALL SELECT k FROM src ORDER BY k;", "duckdb", CATALOGUE);
    expect(sql).to.contain("ORDER BY");
    expect(sql).to.match(/UNION ALL/);
  });

  it("refuses what it cannot lower rather than lowering something close", () => {
    // ORDER BY over an expression is not lowered yet, and says so by name
    expect(() => compile("SELECT k FROM src ORDER BY n + 1;", "duckdb", CATALOGUE))
      .to.throw(/not lowered yet/);
  });
});

describe("the two constructs a hint and a comma bring", () => {
  it("a comma in the FROM is a cross join, and the join carries no ON", () => {
    const {sql} = compile("SELECT k FROM src, src2 WHERE k <> 'x';", "duckdb",
      {SRC: {K: {abap: "C", len: 1}}, SRC2: {N: {abap: "I"}}});
    expect(sql).to.contain("CROSS JOIN");
    expect(sql).to.not.match(/CROSS JOIN [^)]*ON /);
  });

  it("a plan-only hint is dropped by name, and the statement carries no trace of it", () => {
    const {sql} = compile("SELECT k FROM src WITH HINT ( NO_USE_HEX_PLAN );", "duckdb",
      {SRC: {K: {abap: "C", len: 1}}});
    expect(sql).to.not.match(/HINT/i);
    expect(sql).to.contain('FROM "SRC"');
  });

  it("but a hint nobody has looked at is refused, rather than dropped with the rest", () => {
    // dropping an unknown hint silently is how a hint that mattered would
    // disappear; INLINE and NO_INLINE are the two that change behaviour
    expect(() => compile("SELECT k FROM src WITH HINT ( SOME_FUTURE_HINT );", "duckdb",
      {SRC: {K: {abap: "C", len: 1}}})).to.throw(/SOME_FUTURE_HINT has not been looked at/);
  });

  it("and NO_INLINE is kept on the node, because it changes what is observable", () => {
    const {ir} = compile("SELECT k FROM src WITH HINT ( NO_INLINE );", "duckdb",
      {SRC: {K: {abap: "C", len: 1}}});
    expect(ir.rel.hints).to.deep.equal(["NO_INLINE"]);
  });
});

// A subquery is a relation standing where an expression is expected, and it
// was the single largest reason a body parsed and then would not lower: 18 of
// them in the working corpus. Run rather than read, on both local engines,
// because the shape that matters is not the text -- it is whether the bound
// values still line up with their placeholders once a whole second statement
// has been rendered in the middle of a condition.
describe("a subquery inside a condition, run on both engines", function () {
  this.timeout(120000);

  const CAT = {SRC: {K: {abap: "C", len: 1}, N: {abap: "I"}}};

  const both = async (body) => {
    const results = await run({body, catalogue: CAT, hana: false});
    const answered = results.filter((r) => r.rows !== undefined);
    expect(answered.length, JSON.stringify(results.map((r) => [r.engine, r.error]))).to.be.greaterThan(1);
    const shapes = new Set(answered.map((r) => JSON.stringify(r.rows.map((row) => Object.values(row)))));
    expect(shapes.size, `the engines disagree: ${[...shapes].join(" vs ")}`).to.equal(1);
    return answered[0].rows.map((row) => row.K ?? row.k);
  };

  it("IN over a subquery picks the rows the inner select names", async () => {
    expect(await both("SELECT k FROM src WHERE k IN ( SELECT k FROM src WHERE n > 1 );"))
      .to.deep.equal(["b", "c"]);
  });

  it("EXISTS answers over the whole set, and NOT EXISTS is its complement", async () => {
    expect(await both("SELECT k FROM src WHERE EXISTS ( SELECT k FROM src WHERE n > 2 );"))
      .to.have.length(3);
    expect(await both("SELECT k FROM src WHERE NOT EXISTS ( SELECT k FROM src WHERE n > 99 );"))
      .to.have.length(3);
  });

  it("a scalar subquery compares against one value", async () => {
    expect(await both("SELECT k FROM src WHERE n = ( SELECT max(n) FROM src );"))
      .to.deep.equal(["c"]);
  });

  it("the values of an inner select land in the order the text has them", async () => {
    // the placeholder order is the one thing no engine and no text assertion
    // would catch: a subquery rendered anywhere but where it appears puts
    // the params out of step with the `?`s
    const {sql, params} = compile(
      "SELECT k FROM src WHERE k <> 'z' AND n IN ( SELECT n FROM src WHERE k <> 'y' ) AND k <> 'x';",
      "duckdb", CAT);
    expect(params.map((p) => p.value)).to.deep.equal(["z", "y", "x"]);
    expect(sql.split("?")).to.have.length(4);
  });
});

describe("SELECT * is the absence of a projection, not a projection of a star", () => {
  const CAT = {SRC: {K: {abap: "C", len: 1}, N: {abap: "I"}}};

  it("collapses into its input, and answers every column", async () => {
    const {ir, sql} = compile("SELECT * FROM src;", "duckdb", CAT);
    expect(ir.rel.rel, "no projection was built at all").to.equal("scan");
    expect(sql).to.equal('SELECT * FROM "SRC"');
    const results = await run({body: "SELECT * FROM src;", catalogue: CAT, hana: false});
    const answered = results.filter((r) => r.rows !== undefined);
    expect(answered.length).to.be.greaterThan(1);
    for (const r of answered) expect(Object.keys(r.rows[0]).length, r.engine).to.equal(2);
  });

  it("still collapses under a filter, and the filter survives", () => {
    const {sql} = compile("SELECT * FROM src WHERE n > 1;", "duckdb", CAT);
    expect(sql).to.contain("WHERE");
    expect(sql).to.not.contain(" AS ");
  });

  it("refuses a star mixed with names, rather than expanding it from the schema", () => {
    // expanding would be easy and is the trap: it fixes the set and the
    // order of the columns at compile time, so a column added to the table
    // later changes what the body means
    expect(() => compile("SELECT *, k FROM src;", "duckdb", CAT))
      .to.throw(/would change what this body means/);
  });
});

describe("both forms of CASE, and the simple one becoming the searched one", () => {
  const CAT = {SRC: {K: {abap: "C", len: 1}, N: {abap: "I"}}};

  it("CASE x WHEN v is rewritten into WHEN x = v, which is what it means", () => {
    // it was going down the searched path and coming out as "a comparison
    // without an operator" -- ten bodies, because the subject of a simple
    // CASE is an expression and therefore not a word, so a check on the word
    // list always answered "searched"
    const {sql} = compile("SELECT CASE n WHEN 1 THEN 'one' WHEN 2 THEN 'two' ELSE 'many' END AS V FROM src;",
      "duckdb", CAT);
    expect(sql).to.contain('WHEN ("N" = 1)');
    expect(sql).to.contain('WHEN ("N" = 2)');
    expect(sql).to.contain("ELSE");
  });

  it("the searched form goes through as it is", () => {
    const {sql} = compile("SELECT CASE WHEN n > 1 THEN 1 ELSE 2 END AS V FROM src;", "duckdb", CAT);
    expect(sql).to.contain('WHEN ("N" > 1)');
  });

  it("with no ELSE, nothing is invented for the missing branch", () => {
    const {sql} = compile("SELECT CASE n WHEN 1 THEN 'one' END AS V FROM src;", "duckdb", CAT);
    expect(sql).to.not.contain("ELSE");
  });

  it("and both forms answer on both engines", async () => {
    const body = "SELECT k, CASE n WHEN 1 THEN 'one' ELSE 'other' END AS LABEL FROM src ORDER BY k;";
    const results = await run({body, catalogue: CAT, hana: false});
    const answered = results.filter((r) => r.rows !== undefined);
    expect(answered.length, JSON.stringify(results.map((r) => [r.engine, r.error]))).to.be.greaterThan(1);
    const shapes = new Set(answered.map((r) => JSON.stringify(r.rows.map((row) => Object.values(row)))));
    expect(shapes.size, [...shapes].join(" vs ")).to.equal(1);
    expect(answered[0].rows.map((r) => r.LABEL ?? r.label)).to.deep.equal(["one", "other", "other"]);
  });
});

// HANA's own string functions, and the one rule that made them renderable:
// every edge was measured on HANA Express first, and every rendering was
// measured back against those answers before it was written down. Sixteen
// probes, all sixteen agreeing on both local engines.
describe("HANA's own functions, rendered where they were measured", () => {
  const CAT = {SRC: {K: {abap: "C", len: 8}, N: {abap: "I"}}};
  const rows = async (body) => {
    const results = await run({body, catalogue: CAT, hana: false});
    const answered = results.filter((r) => r.rows !== undefined);
    expect(answered.length, JSON.stringify(results.map((r) => [r.engine, r.error]))).to.be.greaterThan(1);
    const shapes = new Set(answered.map((r) => JSON.stringify(r.rows.map((x) => Object.values(x)))));
    expect(shapes.size, [...shapes].join(" vs ")).to.equal(1);
    return answered[0].rows.map((r) => r.V ?? r.v);
  };

  // the fixture rows are the single letters a, b, c, so the interesting
  // strings are built from them — an assertion that is all empty strings
  // would pass against a rendering that answered nothing at all
  it("SUBSTR_BEFORE takes what is before the first separator", async () => {
    expect(await rows("SELECT SUBSTR_BEFORE(CONCAT(k, '-z'), '-') AS V FROM src ORDER BY k;"))
      .to.deep.equal(["a", "b", "c"]);
  });

  it("and answers the empty string on a miss, as HANA does rather than NULL", async () => {
    expect(await rows("SELECT SUBSTR_BEFORE(k, '-') AS V FROM src ORDER BY k;"))
      .to.deep.equal(["", "", ""]);
  });

  it("SUBSTR_AFTER takes what is after it, and '' when the separator ends the string", async () => {
    expect(await rows("SELECT SUBSTR_AFTER(CONCAT('z-', k), '-') AS V FROM src ORDER BY k;"))
      .to.deep.equal(["a", "b", "c"]);
    expect(await rows("SELECT SUBSTR_AFTER(CONCAT(k, '-'), '-') AS V FROM src ORDER BY k;"))
      .to.deep.equal(["", "", ""]);
  });

  it("LOCATE is one-based and answers zero on a miss", async () => {
    expect(await rows("SELECT LOCATE(CONCAT('x', k), k) AS V FROM src ORDER BY k;"))
      .to.deep.equal([2, 2, 2]);
    expect(await rows("SELECT LOCATE(k, 'zz') AS V FROM src ORDER BY k;"))
      .to.deep.equal([0, 0, 0]);
  });

  it("MAP is a CASE and nothing else, and a missing default is NULL", () => {
    // measured on HANA: a hit answers its value, a miss the default, no
    // default NULL, and MAP(NULL, …) the default — which is what
    // `CASE WHEN x = a` already does, because NULL = a is NULL
    const {sql} = compile("SELECT MAP(n, 1, 'one', 2, 'two', 'many') AS V FROM src;", "duckdb", CAT);
    expect(sql).to.contain('CASE WHEN ("N" = 1)');
    expect(sql).to.contain("ELSE");
    expect(compile("SELECT MAP(n, 1, 'one') AS V FROM src;", "duckdb", CAT).sql).to.not.contain("ELSE");
  });

  it("an argument used twice in a rendering carries two values, not one", () => {
    // the subtle one: rendering an argument pushes its bound values, so a
    // rendering that repeats an argument must render it again. Re-using the
    // string would leave two `?` behind one value, which no engine catches
    for (const dialect of ["hana", "duckdb", "sqlite"]) {
      const {sql, params} = compile("SELECT SUBSTR_AFTER(k, '-') AS V FROM src;", dialect, CAT);
      expect((sql.match(/\?/g) ?? []).length, `${dialect}: placeholders against values`)
        .to.equal(params.length);
    }
  });
});

describe("ORDER BY is a clause of its SELECT, not a wrapper around it", () => {
  const CAT = {SRC: {K: {abap: "C", len: 8}, N: {abap: "I"}}};

  it("orders by a column the projection does not carry", async () => {
    // `SELECT f(k) AS v FROM t ORDER BY k` is ordinary SQL: the ordering is
    // evaluated over the INPUT of the select. Wrapped, it became
    // `SELECT * FROM (SELECT f(k) AS v FROM t) ORDER BY k`, where k is not a
    // column of the subquery and the engine refuses the statement — a body
    // that "lowered" and could never run
    const {sql} = compile("SELECT LOCATE(k, 'b') AS V FROM src ORDER BY k;", "duckdb", CAT);
    expect(sql).to.not.contain("SELECT * FROM (");
    const results = await run({body: "SELECT LOCATE(k, 'b') AS V FROM src ORDER BY k;", catalogue: CAT, hana: false});
    for (const r of results) expect(r.error, `${r.engine} ran it`).to.equal(undefined);
  });

  it("and LIMIT belongs to the select it limits, ordering included", () => {
    const {sql} = compile("SELECT k FROM src ORDER BY k LIMIT 2;", "duckdb", CAT);
    expect(sql).to.match(/ORDER BY .* LIMIT 2$/);
    expect(sql).to.not.contain("SELECT * FROM (");
  });
});

describe("a concatenating aggregate, and the ordering that makes it a value", () => {
  const CAT = {SRC: {K: {abap: "C", len: 1}, N: {abap: "I"}}};

  it("is spelt per engine and ordered identically on all three", () => {
    const body = "SELECT STRING_AGG(k, ',' ORDER BY k DESC) AS V FROM src;";
    expect(compile(body, "hana", CAT).sql).to.contain('STRING_AGG("K", ? ORDER BY "K" DESC)');
    expect(compile(body, "duckdb", CAT).sql).to.contain('string_agg("K", ? ORDER BY "K" DESC)');
    expect(compile(body, "sqlite", CAT).sql).to.contain('group_concat("K", ? ORDER BY "K" DESC)');
  });

  it("answers the same string on both engines that ship", async () => {
    const body = "SELECT STRING_AGG(k, ',' ORDER BY k DESC) AS V FROM src;";
    const results = await run({body, catalogue: CAT, hana: false});
    const answered = results.filter((r) => r.rows !== undefined);
    expect(answered.length, JSON.stringify(results.map((r) => [r.engine, r.error]))).to.be.greaterThan(1);
    for (const r of answered) expect(r.rows[0].V ?? r.rows[0].v, r.engine).to.equal("c,b,a");
  });

  it("without an ordering it is marked non-deterministic, because it is", async () => {
    // all three happen to answer 'a,b,c' on three rows, and none of them
    // promises to: agreement here is a property of the fixture. The divergence
    // instrument has to know that before it reports a difference as a finding
    const {effects} = await import("../tools/sqlscript-ir.mjs");
    const ordered = compile("SELECT STRING_AGG(k, ',' ORDER BY k) AS V FROM src;", "duckdb", CAT);
    const loose = compile("SELECT STRING_AGG(k, ',') AS V FROM src;", "duckdb", CAT);
    expect(effects(loose.ir.rel).nonDeterministic, "no ordering").to.equal(true);
    expect(effects(ordered.ir.rel).nonDeterministic, "ordered").to.equal(false);
  });
});
