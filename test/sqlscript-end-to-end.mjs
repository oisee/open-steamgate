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
