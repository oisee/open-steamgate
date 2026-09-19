// The trace a running system holds, for a screen to read (backlog G.10).
//
// The design decision this file guards is where the buffer LIVES. A DDIC
// table is the obvious answer -- then the screen is ordinary ABAP with an
// ordinary SELECT -- and it is wrong here for two reasons that are not
// taste: the tracer sits on the one connection every statement goes through,
// so a trace row would trace itself; and a trace row written inside an open
// LUW is lost when that LUW rolls back and changes the commit shape when it
// does not, which is the exact thing the trace measures. A measurement that
// takes part in what it measures is not one.
import {expect} from "chai";
import {TraceRing, TraceDestination} from "../tools/osd-sql-trace-buffer.mjs";
import {box, rows} from "./helpers/destination.mjs";

// The fixtures -- a box, a structure, an internal table -- moved to
// test/helpers/destination.mjs when the store destination's tests needed the
// same ones. What they encode is the runtime's shape and the lesson that
// paid for it, and that belongs in one file rather than beside whichever
// destination was written first.
async function callFunction(destination, command, {limit} = {}) {
  const signature = {
    exporting: {iv_command: box(command), IV_LIMIT: box(String(limit ?? 200))},
    importing: {ev_on: box(""), EV_HELD: box(""), ev_dropped: box(""), EV_MS: box(""), ev_error: box("")},
    tables: {et_statement: rows(["SEQ", "OPERATION", "TABNAME", "MS", "ROWCOUNT", "STATEMENT"])},
  };
  await destination.call("ZOSD_SQL_TRACE", signature);
  return signature;
}

describe("the ring is bounded, and says what it dropped", () => {
  it("records nothing until it is turned on", () => {
    const ring = new TraceRing();
    ring.record({n: 0, op: "select", sql: "SELECT 1"});
    expect(ring.read().held, "a server that traces before anybody asked is a server that pays for it")
      .to.equal(0);
  });

  it("keeps the newest and COUNTS the rest, rather than growing without end", () => {
    const ring = new TraceRing({size: 3});
    ring.start();
    for (let i = 0; i < 5; i++) ring.record({n: i, op: "select", sql: `SELECT ${i}`, ms: 1});
    const held = ring.read();
    expect(held.held).to.equal(3);
    expect(held.dropped, "a screen that shows three of five without saying so is lying quietly").to.equal(2);
    expect(held.entries[0].n, "the newest are kept").to.equal(2);
  });

  it("clear empties it and forgets what it dropped, since both are about the last question", () => {
    const ring = new TraceRing({size: 2});
    ring.start();
    for (let i = 0; i < 5; i++) ring.record({n: i, op: "select", sql: "SELECT 1", ms: 1});
    expect(ring.clear()).to.include({held: 0, dropped: 0, on: true});
  });

  it("stop keeps what is held, because stopping is not discarding", () => {
    const ring = new TraceRing();
    ring.start();
    ring.record({n: 0, op: "select", sql: "SELECT 1", ms: 1});
    expect(ring.stop()).to.include({held: 1, on: false});
  });
});

describe("the destination fills the caller's signature, which is the contract", () => {
  let ring;
  let destination;

  beforeEach(() => {
    ring = new TraceRing({size: 10});
    destination = new TraceDestination(ring);
    ring.start();
    for (const k of ["a", "b", "c"]) {
      ring.record({n: 0, op: "select", sql: `SELECT * FROM t WHERE k = '${k}'`, ms: 2, table: "T", rows: 1});
    }
    ring.record({n: 3, op: "select", sql: "SELECT * FROM u", ms: 9, table: "U", rows: 7});
  });

  it("returns nothing and assigns everything, the way rfc-replay does", async () => {
    const signature = await callFunction(destination, "LIST");
    expect(signature.importing.EV_HELD.get()).to.equal("4");
    expect(signature.tables.et_statement.array()).to.have.lengthOf(4);
  });

  it("matches the parameter name WITHOUT case, or every command is the default", async () => {
    // `iv_command` here, `IV_LIMIT` there -- both are the runtime's choice
    // and neither is the contract's. Asking for one spelling exactly is what
    // made START, STOP and CLEAR all render the summary and say "off".
    const started = await callFunction(destination, "START");
    expect(started.importing.ev_on.get(), "START must turn it on").to.equal("X");
    expect(ring.on).to.equal(true);
  });

  it("LIST gives one row per statement, canonical, so two reads of a screen agree", async () => {
    const listed = await callFunction(destination, "LIST");
    const first = listed.tables.et_statement.plain()[0];
    expect(first).to.include({OPERATION: "select", TABNAME: "T"});
    expect(first.STATEMENT).to.contain("FROM t");
  });

  it("SUMMARY is the analysis in the same row shape, including the N+1", async () => {
    const report = await callFunction(destination, "SUMMARY");
    const kinds = report.tables.et_statement.plain();
    expect(report.importing.EV_MS.get(), "the total is a scalar, not a row").to.not.equal("");
    expect(kinds.filter((r) => r.OPERATION === "table").map((r) => r.TABNAME)).to.contain("T");
    const repeated = kinds.filter((r) => r.OPERATION === "repeated");
    expect(Number(repeated[0].SEQ), "three reads of T differing only in the value").to.equal(3);
  });

  it("START, STOP and CLEAR are commands rather than a flag somebody has to remember", async () => {
    expect((await callFunction(destination, "STOP")).importing.ev_on.get()).to.equal("");
    expect((await callFunction(destination, "START")).importing.ev_on.get()).to.equal("X");
    expect((await callFunction(destination, "CLEAR")).importing.EV_HELD.get()).to.equal("0");
  });

  it("and a command nobody implemented is NAMED, not answered with the summary", async () => {
    const answer = await callFunction(destination, "NOPE");
    expect(answer.importing.ev_error.get()).to.contain("unknown trace command");
    expect(answer.tables.et_statement.plain(), "and it shows no rows, so the page cannot look like an answer")
      .to.have.lengthOf(0);
  });
});

describe("the wrapper costs nothing while nothing is listening", () => {
  it("goes straight through when `enabled` says so", async () => {
    const {installSqlTrace} = await import("../tools/osd-sql-trace.mjs");
    const seen = [];
    const client = {async select() { return {rows: []}; }};
    let listening = false;
    installSqlTrace(client, (e) => seen.push(e), {enabled: () => listening});
    await client.select({select: "SELECT 1"});
    expect(seen, "installed always, because the screen turns it on at runtime").to.have.lengthOf(0);
    listening = true;
    await client.select({select: "SELECT 1"});
    expect(seen).to.have.lengthOf(1);
  });
});
