import {runtimeRootFixture} from "./helpers/runtime-root.mjs";
import {createServer as portProbe} from "node:net";
const runtimeFixture = runtimeRootFixture();
import {expect} from "chai";
import {diff, normalise, readLog} from "../tools/osd-replay.mjs";
import {lockResultDocument} from "../tools/adt-documents.mjs";

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
  const lockAnswer = (handle, options) => ({
    ...answer("/sap/bc/adt/programs/programs/zosd_replay_lock?_action=LOCK",
      lockResultDocument(handle, options)),
    contentType: "application/vnd.sap.as+xml; charset=utf-8; dataname=com.sap.adt.lock.Result",
  });
  const handles = ["00112233445566778899aabbccddeeff01020304", "ffeeddccbbaa99887766554433221100a1b2c3d4"];

  it("compares fresh LOCK handles as opaque tokens, including the old UUID format", () => {
    for (const [left, right] of [handles,
      ["3c2b1a09-1111-4222-8333-444455556666", "aaaaaaaa-2222-4333-8444-555566667777"],
      ["opaque-first&amp;token", "opaque-second/token"]]) {
      expect(diff([lockAnswer(left)], [lockAnswer(right)])).to.have.length(0);
    }
  });

  it("still detects other LOCK changes and an empty handle", () => {
    expect(diff([lockAnswer(handles[0])], [lockAnswer(handles[1], {local: false})])).to.have.length(1);
    expect(diff([lockAnswer(handles[0])], [lockAnswer("")])).to.have.length(1);
  });

  it("masks lockHandle query values in answers without hiding adjacent parameters or hashes", () => {
    for (const prefix of ["?", "?x=1&", "?x=1&amp;"]) {
      const uri = handle => `<uri>/source/main${prefix}lockHandle=${handle}&amp;hash=${handles[0]}</uri>`;
      expect(diff([answer("/x", uri("opaque%2Ffirst"))], [answer("/x", uri("second-token"))])).to.have.length(0);
      expect(diff([answer("/x", uri(handles[0]))],
        [answer("/x", uri(handles[1]).replace(`hash=${handles[0]}`, `hash=${handles[1]}`))])).to.have.length(1);
    }
    expect(diff([answer("/x", `<HASH>${handles[0]}</HASH>`)],
      [answer("/x", `<HASH>${handles[1]}</HASH>`)])).to.have.length(1);
  });

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
  const PORTS = [];
  const servers = [];
  const logs = [];

  before(async () => {
    const {spawn} = await import("node:child_process");
    for (let i = 0; i < 2; i++) {
      const port = await new Promise((resolve, reject) => {
        const probe = portProbe().listen(0, "127.0.0.1", () => {
          const port = probe.address().port;
          probe.close(() => resolve(port));
        }).once("error", reject);
      });
      PORTS.push(port);
      const index = servers.length;
      logs.push("");
      const child = spawn(process.execPath, ["--input-type=module", "-e",
        'const {startServer} = await import("./test/start.mjs"); startServer(true); setInterval(() => {}, 1e9);'],
        {cwd: runtimeFixture.root, stdio: ["ignore", "pipe", "pipe"], env: {...process.env, STG_PORT: String(port), STG_TLS: "0", STG_PROTOCOLS: "0", STG_DB: "sqlite", STG_DB_PATH: ""}});
      child.stdout.on("data", data => { logs[index] += data; });
      child.stderr.on("data", data => { logs[index] += data; });
      servers.push(child);
      // Each source host prepares its generation before listening. Start
      // them in order so they do not contend for the private build lock.
      let ready = false;
      for (let i = 0; i < 120; i += 1) {
        if (servers[index].exitCode !== null || servers[index].signalCode !== null) throw new Error(logs[index]);
        try {
          await fetch(`http://localhost:${port}/sap/bc/adt/core/http/build`);
          ready = true;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      expect(ready, logs[index]).to.equal(true);
    }
  });

  after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => {
      if (server.exitCode !== null || server.signalCode !== null) return resolve();
      server.once("exit", resolve);
      server.kill();
    })));
  });

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

// The tool's own third value, caught in it minutes after it was written to
// stop exactly this elsewhere: `record` printed "13 calls, 13 could not be
// asked" against a port with no server on it and exited 0. "Asked nothing"
// is not "recorded a run" — and the cheapest thing a missing third value can
// do is look like one of the two that exist.
describe("asking nothing is not a recording", () => {
  it("record exits 2 when no call could be asked at all", async () => {
    const {execFileSync} = await import("node:child_process");
    const port = await new Promise((resolve, reject) => {
      const probe = portProbe().listen(0, "127.0.0.1", () => {
        const port = probe.address().port;
        probe.close(() => resolve(port));
      }).once("error", reject);
    });
    let code = 0;
    try {
      execFileSync(process.execPath, ["tools/osd-replay.mjs", "record", `http://localhost:${port}`],
        {stdio: "pipe"});
    } catch (error) {
      code = error.status;
    }
    expect(code, "a port with nothing on it must not read as a successful recording").to.equal(2);
  });
});
