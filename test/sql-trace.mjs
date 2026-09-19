// The second sieve, calibrated the way the first one had to be.
//
// An instrument that cannot be silent is not used after its first week, and
// the calibration target for this one is a system compared WITH ITSELF: if
// that is not empty, the canonical form is wrong and nothing further can be
// believed. The first sieve learnt that the hard way -- calibrated in ONE
// process it reported zero differences and proved nothing, because the same
// clock, the same pid and the same counters hide exactly what two runs
// differ by.
//
// So the rules here were put in by a run rather than predicted, and each one
// is asserted to be NECESSARY as well as correct: a rule that masks nothing
// real is a rule that will one day mask something real.
import {expect} from "chai";
import {canonical, compareTraces, installSqlTrace, RULES} from "../tools/osd-sql-trace.mjs";

describe("the SQL sieve is silent where there can be no difference", () => {
  const run = (statements) => statements.map((sql, n) => ({n, op: "select", sql}));

  it("a trace compared with itself is empty, and says nothing was masked", () => {
    const trace = run(['SELECT * FROM "T" WHERE "K" = \'a\'', 'SELECT "A" FROM "U"']);
    const verdict = compareTraces(trace, trace);
    expect(verdict.same).to.equal(true);
    expect(verdict.masked, "nothing structural fired, so nothing should be claimed").to.deep.equal([]);
  });

  it("and it is NOT silent where the statement differs, naming the position", () => {
    const a = run(["SELECT * FROM t ORDER BY k", "SELECT * FROM u"]);
    const b = run(["SELECT * FROM t ORDER BY k DESC", "SELECT * FROM u"]);
    const verdict = compareTraces(a, b);
    expect(verdict.same).to.equal(false);
    expect(verdict.at, "the first difference is the one worth naming").to.equal(0);
    expect(verdict.kind).to.equal("different statement");
  });

  // The two differences the response sieve cannot see at all.
  it("an N+1 is a difference in COUNT, and is found", () => {
    const one = run(["SELECT * FROM t WHERE k IN ('a','b','c')"]);
    const many = run(["SELECT * FROM t WHERE k = 'a'", "SELECT * FROM t WHERE k = 'b'", "SELECT * FROM t WHERE k = 'c'"]);
    const verdict = compareTraces(one, many);
    expect(verdict.same).to.equal(false);
    expect(verdict.counts).to.deep.equal([1, 3]);
  });

  it("a missing MANDT is found, because the column survives the masking", () => {
    const withIt = run(["SELECT * FROM t WHERE mandt = '123' AND k = 'a'"]);
    const without = run(["SELECT * FROM t WHERE k = 'a'"]);
    expect(compareTraces(withIt, without, {rules: ["literals"]}).same,
      "masking the VALUES must not mask the column").to.equal(false);
  });

  // Order is part of the answer and is deliberately not sorted away.
  it("the same statements in another order are a difference, not a match", () => {
    const a = run(["SELECT * FROM t", "SELECT * FROM u"]);
    const b = run(["SELECT * FROM u", "SELECT * FROM t"]);
    expect(compareTraces(a, b).same).to.equal(false);
  });
});

describe("each rule is necessary, and says why it is allowed to mask", () => {
  it("every rule carries a reason", () => {
    for (const [name, rule] of Object.entries(RULES)) {
      expect(rule.why, `${name} must justify itself`).to.be.a("string").and.have.length.greaterThan(20);
    }
  });

  // The rule that was NOT predicted: the splitter names each materialised
  // relation with a process counter, so two runs of one program differ by
  // the name and not by the statement.
  it("generated-names is necessary: two runs of one program differ without it", () => {
    const a = run(['SELECT * FROM "OSD_STEP_12345_1"']);
    const b = run(['SELECT * FROM "OSD_STEP_98765_1"']);
    expect(compareTraces(a, b).same, "the counter is the process, not the program").to.equal(true);
    // and it is doing the work, rather than the whitespace rule doing it
    expect(canonical('SELECT * FROM "OSD_STEP_1_2"').fired).to.contain("generated-names");
  });

  // The rule the calibration put there, and the only one that was not
  // predictable from reading the code.
  it("session-clock is necessary: two runs of one system differ by it and nothing else", () => {
    const a = run(["INSERT INTO \"zosd_tses\" (sessid,created) VALUES ('20260919085218101985288474434957',20260919085218)"]);
    const b = run(["INSERT INTO \"zosd_tses\" (sessid,created) VALUES ('20260919085221167287980912483118',20260919085221)"]);
    expect(compareTraces(a, b).same, "a session identity is the process, not the program").to.equal(true);
  });

  // And the half that matters more, because a rule that cries wolf gets
  // turned off: it must NOT eat the numbers this sieve exists to compare.
  it("and it is not wider than that: a row count, a limit and an ordinary key survive", () => {
    for (const sql of ["SELECT * FROM t LIMIT 100", "SELECT * FROM t WHERE id = 12345678",
                       "SELECT * FROM t WHERE n = 2026", "UPDATE t SET n = 5 WHERE k = 1"]) {
      expect(canonical(sql).fired, sql).to.not.contain("session-clock");
    }
    // one statement each way, so the difference the rule would hide is a real one
    expect(compareTraces(run(["SELECT * FROM t LIMIT 100"]), run(["SELECT * FROM t LIMIT 10"])).same,
      "a limit is exactly the kind of difference this sieve is for").to.equal(false);
  });

  it("literals are NOT masked by default, because both sides are usually ours", () => {
    expect(RULES.literals.always).to.equal(false);
    const a = run(["SELECT * FROM t WHERE k = 'a'"]);
    const b = run(["SELECT * FROM t WHERE k = 'b'"]);
    expect(compareTraces(a, b).same, "a different value is a difference until somebody says it is not")
      .to.equal(false);
    expect(compareTraces(a, b, {rules: ["literals"]}).same).to.equal(true);
  });

  it("and what was masked travels with the verdict", () => {
    const a = run(["SELECT * FROM t WHERE k = 'a'"]);
    const b = run(["SELECT * FROM t WHERE k = 'b'"]);
    expect(compareTraces(a, b, {rules: ["literals"]}).masked,
      "'identical' and 'identical after masking every value' are different claims").to.contain("literals");
  });

  function run(statements) {
    return statements.map((sql, n) => ({n, op: "select", sql}));
  }
});

describe("the tracer records the seam and does not change it", () => {
  it("records every member that issues SQL, in order, with the LUW markers", async () => {
    const seen = [];
    const client = {
      name: "fake",
      async execute() { return undefined; },
      async select() { return {rows: [{K: 1}]}; },
      async insert() { return {subrc: 0, dbcnt: 1}; },
      async update() { return {subrc: 0, dbcnt: 1}; },
      async delete() { return {subrc: 0, dbcnt: 1}; },
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
    };
    installSqlTrace(client, (entry) => seen.push(entry));
    await client.beginTransaction();
    await client.insert({table: "T", columns: ["K"], values: ["'a'"]});
    const answer = await client.select({select: "SELECT * FROM T"});
    await client.commit();

    expect(seen.map((e) => e.op)).to.deep.equal(["beginTransaction", "insert", "select", "commit"]);
    expect(seen[1].sql).to.contain("INSERT INTO T");
    expect(answer.rows, "the tracer must return what the client returned").to.deep.equal([{K: 1}]);
    expect(seen.map((e) => e.n), "numbered in order, so a reordering is visible").to.deep.equal([0, 1, 2, 3]);
  });

  it("a sink that throws does not break the statement it was tracing", async () => {
    const client = {async select() { return {rows: []}; }};
    installSqlTrace(client, () => { throw new Error("the sink is broken"); });
    const answer = await client.select({select: "SELECT 1"});
    expect(answer, "a tracer that can break what it traces is worse than no tracer").to.deep.equal({rows: []});
  });

  it("installing twice does not record twice", async () => {
    const seen = [];
    const client = {async select() { return {rows: []}; }};
    installSqlTrace(client, (e) => seen.push(e));
    installSqlTrace(client, (e) => seen.push(e));
    await client.select({select: "SELECT 1"});
    expect(seen).to.have.lengthOf(1);
  });
});

// What a trace is opened for, which is not the same as what it records.
//
// Written before the screen on purpose: the backlog's own warning about G.10
// is that a page built first is "a handsome page with no consumer and no
// normaliser behind it". The normaliser is above, the analysis is here, and
// the page is then a rendering job.
describe("the summary answers where the request went, and what it did twice", () => {
  const trace = [
    {n: 0, op: "beginTransaction", sql: ""},
    {n: 1, op: "select", sql: "SELECT * FROM t WHERE k = 'a'", ms: 2, table: "T", rows: 1},
    {n: 2, op: "select", sql: "SELECT * FROM t WHERE k = 'b'", ms: 3, table: "T", rows: 1},
    {n: 3, op: "select", sql: "SELECT * FROM t WHERE k = 'c'", ms: 1, table: "T", rows: 1},
    {n: 4, op: "select", sql: "SELECT * FROM u ORDER BY k", ms: 40, table: "U", rows: 9},
    {n: 5, op: "commit", sql: ""},
  ];

  it("counts per table, and the markers of the LUW are not statements", async () => {
    const {summarise} = await import("../tools/osd-sql-trace.mjs");
    const report = summarise(trace);
    expect(report.statements, "beginTransaction and commit are not statements").to.equal(4);
    expect(report.luw).to.deep.equal({commits: 1, rollbacks: 0});
    expect(report.tables[0]).to.include({table: "T", count: 3, rows: 3});
  });

  // The one the response sieve cannot see at all: the answer is right and
  // the system did the work n times.
  it("finds the N+1 -- one statement run three times with only the values differing", async () => {
    const {summarise} = await import("../tools/osd-sql-trace.mjs");
    const report = summarise(trace);
    expect(report.repeated).to.have.lengthOf(1);
    expect(report.repeated[0].count).to.equal(3);
    expect(report.repeated[0].shape, "the values are masked HERE, which is the point rather than a concession")
      .to.contain("'?'");
  });

  it("and a statement run once is not in it, so the list is a finding and not a listing", async () => {
    const {summarise} = await import("../tools/osd-sql-trace.mjs");
    expect(summarise(trace).repeated.some((r) => r.shape.includes("FROM u"))).to.equal(false);
  });

  it("names the slowest by time, not by position", async () => {
    const {summarise} = await import("../tools/osd-sql-trace.mjs");
    expect(summarise(trace).slowest[0]).to.include({ms: 40, table: "U"});
  });
});

describe("the tracer times the call rather than the bookkeeping", () => {
  it("records a duration, and the table from the seam rather than from a regex", async () => {
    const {installSqlTrace, tableOf} = await import("../tools/osd-sql-trace.mjs");
    const seen = [];
    const client = {
      async select() { return {rows: [{K: 1}, {K: 2}]}; },
      async insert() { return {subrc: 0, dbcnt: 1}; },
    };
    installSqlTrace(client, (e) => seen.push(e));
    await client.select({select: "SELECT * FROM zosd_svc"});
    await client.insert({table: "ZOSD_SYS", columns: ["A"], values: ["1"]});

    expect(seen[0].ms, "a trace without a duration cannot answer what a trace is opened for").to.be.a("number");
    expect(seen[0].rows).to.equal(2);
    expect(seen[0].table, "read from the text, because select() gives no table").to.equal("ZOSD_SVC");
    expect(seen[1].table, "read from the OPTIONS, because insert() does").to.equal("ZOSD_SYS");
    // the seam is not a guess and the text is
    expect(tableOf("insert", [{table: "ZOSD_SYS"}], "nonsense")).to.equal("ZOSD_SYS");
  });

  // **`(none)` has to mean "no table", not "I could not tell".**
  //
  // 105 CREATE TABLE statements -- the whole schema, 78 ms of a 441 ms run
  // -- were landing in a bucket labelled `(none)`, which was the largest row
  // on the summary. A bucket that means "unreadable" wearing a table's
  // clothes is the third value again, and this time it was in my own
  // instrument (2026-09-19).
  it("DDL names its table too, so the schema is not filed under nothing", async () => {
    const {tableOf} = await import("../tools/osd-sql-trace.mjs");
    // SQLite writes 'x' where the others write "x", so all three quotes count
    expect(tableOf("execute", ["CREATE TABLE 'zstg_demo' (a INT)"], "CREATE TABLE 'zstg_demo' (a INT)"))
      .to.equal("ZSTG_DEMO");
    expect(tableOf("execute", [`DROP TABLE "T"`], `DROP TABLE "T"`)).to.equal("T");
    expect(tableOf("execute", ["CREATE TABLE IF NOT EXISTS x (a INT)"], "CREATE TABLE IF NOT EXISTS x (a INT)"))
      .to.equal("X");
  });

  it("and a statement that really has no table still says so", async () => {
    const {tableOf} = await import("../tools/osd-sql-trace.mjs");
    expect(tableOf("execute", ["SELECT 1"], "SELECT 1")).to.equal(undefined);
    expect(tableOf("commit", [], "")).to.equal(undefined);
  });

  it("still records when the statement raises, or the slow ones would all be missing", async () => {
    const {installSqlTrace} = await import("../tools/osd-sql-trace.mjs");
    const seen = [];
    const client = {async select() { throw new Error("no such table"); }};
    installSqlTrace(client, (e) => seen.push(e));
    let raised;
    try {
      await client.select({select: "SELECT * FROM nope"});
    } catch (error) {
      raised = error;
    }
    expect(raised.message).to.contain("no such table");
    expect(seen, "a statement that failed is exactly the one somebody opens a trace for").to.have.lengthOf(1);
    expect(seen[0].ms).to.be.a("number");
  });
});
