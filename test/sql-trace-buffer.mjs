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

const answer = async (d, command, extra = {}) =>
  JSON.parse((await d.call("ZOSD_SQL_TRACE", {IMPORTING: {IV_COMMAND: command, ...extra}})).EXPORTING.EV_JSON);

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

describe("the destination is the one ABAP already knows how to call", () => {
  let ring;
  let destination;

  beforeEach(() => {
    ring = new TraceRing({size: 10});
    destination = new TraceDestination(ring);
    ring.start();
    for (const [n, k] of [[0, "a"], [1, "b"], [2, "c"]]) {
      ring.record({n, op: "select", sql: `SELECT * FROM t WHERE k = '${k}'`, ms: n, table: "T", rows: 1});
    }
    ring.record({n: 3, op: "select", sql: "SELECT * FROM u", ms: 9, table: "U", rows: 7});
  });

  it("LIST gives the statements in canonical form, so two reads of one screen agree", async () => {
    const listed = await answer(destination, "LIST");
    expect(listed.entries).to.have.lengthOf(4);
    expect(listed.entries[0]).to.include({op: "select", table: "T"});
  });

  it("SUMMARY is the analysis, not the rows -- including the N+1", async () => {
    const report = await answer(destination, "SUMMARY");
    expect(report.statements).to.equal(4);
    expect(report.repeated[0].count, "three reads of T differing only in the value").to.equal(3);
    expect(report.tables[0]).to.include({table: "T", count: 3});
  });

  it("START, STOP and CLEAR are commands rather than a flag somebody has to remember", async () => {
    expect((await answer(destination, "STOP")).on).to.equal(false);
    expect((await answer(destination, "START")).on).to.equal(true);
    expect((await answer(destination, "CLEAR")).held).to.equal(0);
  });

  it("and a command nobody implemented is NAMED, not answered with the summary", async () => {
    // a screen showing the wrong panel in silence is the third value again
    expect((await answer(destination, "NOPE")).error).to.contain("unknown trace command");
  });

  it("takes its command through the ABAP value, not only a plain string", async () => {
    const typed = {IMPORTING: {IV_COMMAND: {get: () => "SUMMARY"}}};
    const report = JSON.parse((await destination.call("X", typed)).EXPORTING.EV_JSON);
    expect(report.statements).to.equal(4);
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
