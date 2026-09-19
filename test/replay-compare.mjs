import {expect} from "chai";
import {diff, normalise, readLog} from "../tools/osd-replay.mjs";

// The first of W.1's three sieves: two branches of a system, the same calls
// into both, and whether they answered the same.
//
// The discipline the backlog sets is the opposite of the intuition: **begin
// where there must be no difference** and get the instrument silent, because
// where tools like this die is noise. So the suite asserts both halves of
// that — silent on what is knowingly identical, and loud on a real change.
// A comparison that cannot go red is not a comparison, which is the same
// lesson the leak scan and the naming scan each cost once.
const answer = (path, body, status = 200) => ({call: {path}, status, contentType: "application/json", body});

describe("the first sieve: two answers, and whether they are the same one", () => {
  it("is silent about a clock, which is what two runs differ in and not behaviour", () => {
    const left = [answer("/x", '{"started":"2026-09-19T05:00:00.000Z","rows":3}')];
    const right = [answer("/x", '{"started":"2026-09-19T06:11:22.500Z","rows":3}')];
    expect(diff(left, right)).to.have.length(0);
  });

  it("is silent about a process id, a uuid, a port and a batch boundary", () => {
    const pairs = [
      ["OSG (1469006) 123 DEVELOPER", "OSG (1469141) 123 DEVELOPER"],
      ["id=3c2b1a09-1111-4222-8333-444455556666", "id=aaaaaaaa-2222-4333-8444-555566667777"],
      ["http://localhost:3141/x", "http://localhost:3142/x"],
      ["--batch_2a4f-8c1d-9e3b", "--batch_77aa-11bb-22cc"],
      ["served in 31 ms", "served in 44 ms"],
      ['"when":"/Date(1758240000000)/"', '"when":"/Date(1758326400000)/"'],
    ];
    for (const [l, r] of pairs) {
      expect(diff([answer("/x", l)], [answer("/x", r)]), l).to.have.length(0);
    }
  });

  it("but says so when an answer really changed, and says where", () => {
    const left = [answer("/x", '{"started":"2026-09-19T05:00:00Z","rows":3}')];
    const right = [answer("/x", '{"started":"2026-09-19T06:00:00Z","rows":4}')];
    const found = diff(left, right);
    expect(found).to.have.length(1);
    expect(found[0].why).to.equal("the answers differ");
    // where they part, with enough either side to see it: a diff that says
    // only "they differ" makes a person re-run it by hand
    expect(found[0].first.left).to.contain("3");
    expect(found[0].first.right).to.contain("4");
  });

  it("a different status is a difference before the bodies are even read", () => {
    const found = diff([answer("/x", "", 200)], [answer("/x", "", 500)]);
    expect(found[0].why).to.equal("status 200 against 500");
  });

  it("one side not answering at all is never agreement", () => {
    const found = diff([answer("/x", "ok")], []);
    expect(found).to.have.length(1);
    expect(found[0].why).to.contain("no answer at all");
  });

  it("an approved difference needs a reason, or it is not an approval", () => {
    const left = [answer("/x", "one")];
    const right = [answer("/x", "two")];
    expect(diff(left, right, [{path: "/x"}]), "no reason, so not approved").to.have.length(1);
    expect(diff(left, right, [{path: "/x", reason: "the column was renamed on purpose"}])).to.have.length(0);
  });

  it("the normaliser leaves alone what it was not told about", () => {
    // the failure mode of a normaliser is generosity: a rule wide enough to
    // hide a row count. Numbers that are not in one of the named shapes stay
    expect(normalise("rows: 41")).to.equal("rows: 41");
    expect(normalise("(12345)")).to.equal("(12345)");
  });

  it("the tracked request log covers more than one kind of answer", () => {
    // one call per kind, so a normaliser that starts hiding differences is
    // caught by some other kind rather than by nothing
    const calls = readLog();
    expect(calls.length).to.be.greaterThan(8);
    const kinds = new Set(calls.map((c) => c.path.split("/")[3] ?? c.path));
    expect(kinds.size, [...kinds].join(", ")).to.be.greaterThan(2);
  });
});

// And the calibration the backlog asks for by name: **one system, served
// twice, must produce nothing**. Every rule in the normaliser was put there
// by running exactly this and reading what came out — the process id in
// `zcl_osd_webgui`'s identity line was the one it found, and it was found
// rather than predicted.
//
// Two processes rather than one, because a single process hides most of what
// two branches differ in: same clock second, same pid, same counters. A
// calibration that cannot see those is a calibration that proves nothing.
describe("one system served twice answers the same thing", function () {
  this.timeout(180000);
  const PORTS = [3151, 3152];
  const servers = [];

  before(async () => {
    const {spawn} = await import("node:child_process");
    for (const port of PORTS) {
      servers.push(spawn(process.execPath, ["-e",
        'const {startServer} = await import("./test/start.mjs"); startServer(true); setInterval(() => {}, 1e9);'],
        {stdio: "ignore", env: {...process.env, STG_PORT: String(port)}}));
    }
    // waiting for the port rather than for a number of seconds: a fixed sleep
    // is a flake on a loaded machine and a waste on an idle one
    for (const port of PORTS) {
      for (let i = 0; i < 120; i += 1) {
        try {
          await fetch(`http://localhost:${port}/sap/bc/adt/core/http/build`);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
  });

  after(() => servers.forEach((s) => s.kill()));

  it("every call answers, and the two answers are one answer", async () => {
    const {replay} = await import("../tools/osd-replay.mjs");
    const calls = readLog();
    const [left, right] = [await replay(`http://localhost:${PORTS[0]}`, calls),
                           await replay(`http://localhost:${PORTS[1]}`, calls)];
    // a replay where nothing was asked would compare two empty lists and
    // call it agreement, which is the shape of false green this project has
    // paid for three times
    expect(left.filter((a) => a.failed), JSON.stringify(left.filter((a) => a.failed).slice(0, 2))).to.have.length(0);
    expect(left.every((a) => a.status === 200), left.map((a) => `${a.call.path} ${a.status}`).join("\n")).to.equal(true);
    const found = diff(left, right);
    expect(found, found.map((d) => `${d.path}: ${d.why}\n  L ${d.first?.left}\n  R ${d.first?.right}`).join("\n")).to.have.length(0);
  });
});
