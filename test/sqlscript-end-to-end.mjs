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
