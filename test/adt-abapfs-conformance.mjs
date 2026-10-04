import {expect} from "chai";
import {readFileSync} from "node:fs";
import {Fatal, PIN, SCENARIOS, STATUSES, ensureGone, parseArgs, requireHandle, snapshotDiff, writeRoundTrip} from "../tools/abapfs-conformance.mjs";
import {compare, nextExpectations, treeSnapshot} from "../tools/abapfs-conformance.mjs";
import {spawnSync} from "node:child_process";
import {chmodSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

// The conformance run itself is on demand (npm run conformance:abapfs); this
// suite only keeps its expectations file and its command line honest, and
// needs neither the ADT client nor a server.
const expected = JSON.parse(readFileSync(new URL("./fixtures/abapfs-conformance/expected.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("../tools/abapfs-conformance/package-lock.json", import.meta.url), "utf8"));

describe("tools/abapfs-conformance: expectations and arguments", () => {
  it("expects every scenario exactly once, with a known status", () => {
    const ids = SCENARIOS.map(s => s.id);
    expect(new Set(ids).size).to.equal(ids.length);
    expect(Object.keys(expected.scenarios).sort()).to.deep.equal([...ids].sort());
    for (const [id, e] of Object.entries(expected.scenarios)) {
      expect(STATUSES, id).to.include(e.status);
      expect(e.feature, id).to.be.a("string").and.not.empty;
    }
  });

  it("pins the client ABAP-FS ships, in the file and in the lock", () => {
    expect(expected.client).to.deep.equal({name: PIN.name, version: PIN.version, integrity: PIN.integrity});
    const entry = lock.packages[`node_modules/${PIN.name}`];
    expect(entry.version).to.equal(PIN.version);
    expect(entry.integrity).to.equal(PIN.integrity);
    expect(entry.license).to.equal("MIT");
  });

  it("gives every scenario a group and an impact from 1 to 5", () => {
    for (const s of SCENARIOS) {
      expect(s.group, s.id).to.be.a("string").and.not.empty;
      expect(s.impact, s.id).to.be.within(1, 5);
    }
  });

  it("defaults to a running system on 3030", () => {
    const o = parseArgs([]);
    expect(o.url).to.equal("http://localhost:3030");
    expect(o.start).to.equal(false);
  });

  it("starts its own system on --port", () => {
    const o = parseArgs(["--start", "--port", "4123"]);
    expect(o.start).to.equal(true);
    expect(o.url).to.equal("http://localhost:4123");
  });

  it("takes --url, --only and --update-expected", () => {
    const o = parseArgs(["--url", "http://127.0.0.1:9000/", "--only", "tree,write", "--update-expected"]);
    expect(o.url).to.equal("http://127.0.0.1:9000");
    expect(o.only).to.deep.equal(["tree", "write"]);
    expect(o.updateExpected).to.equal(true);
  });

  it("refuses what it cannot mean", () => {
    expect(() => parseArgs(["--start", "--url", "http://x:1"])).to.throw(/exclude/);
    expect(() => parseArgs(["--port", "99999", "--start"])).to.throw(/not a port/);
    expect(() => parseArgs(["--only", "nosuchgroup"])).to.throw(/unknown group/);
    expect(() => parseArgs(["--url"])).to.throw(/needs a value/);
    expect(() => parseArgs(["--url", "localhost:3030"])).to.throw(/scheme/);
    expect(() => parseArgs(["--frobnicate"])).to.throw(/unknown argument/);
  });
});

// Fakes of the two abap-adt-api objects the safety paths touch: enough to
// prove what happens when the server misbehaves, with no server at all.
const URL0 = "/sap/bc/adt/oo/classes/zcl_x";
const ADT = {mainInclude: () => `${URL0}/source/main`};
const notFound = () => Object.assign(new Error("not found"), {err: 404});

function fakeEditor(opts = {}) {
  const {putFails = () => false, readBack = (src) => src} = opts;
  const lockHandle = "lockHandle" in opts ? opts.lockHandle : "H".repeat(40);
  const log = [];
  let source = "ORIGINAL\n";
  return {log, get source() { return source; }, c: {
    objectStructure: async () => ({}),
    getObjectSource: async (_u, o) => (o?.version === "inactive" ? readBack(source) : source),
    lock: async () => { log.push("lock"); return {LOCK_HANDLE: lockHandle}; },
    unLock: async () => { log.push("unlock"); },
    setObjectSource: async (_u, src) => {
      const n = log.filter(x => x.startsWith("put")).length;
      log.push(`put${n}`);
      if (putFails(n)) throw new Error(`put ${n} refused`);
      source = src;
    }
  }};
}

describe("tools/abapfs-conformance: safety paths, offline", () => {
  it("round-trips an opaque 40-character handle and rejects the wrong length before writing", async () => {
    const handle = "opaque:" + "X".repeat(33);
    const f = fakeEditor({lockHandle: handle});
    const put = f.c.setObjectSource;
    const unlock = f.c.unLock;
    f.c.setObjectSource = async (url, source, given) => {
      expect(given).to.equal(handle);
      return put(url, source, given);
    };
    f.c.unLock = async (url, given) => {
      expect(given).to.equal(handle);
      return unlock(url, given);
    };
    expect(await writeRoundTrip(f.c, ADT, URL0)).to.contain("40 chars");
    expect(f.log).to.deep.equal(["lock", "put0", "put1", "unlock"]);
    for (const length of [36, 39, 41]) {
      const bad = fakeEditor({lockHandle: "X".repeat(length)});
      let err;
      await writeRoundTrip(bad.c, ADT, URL0).catch(e => { err = e; });
      expect(err.message).to.equal(`LOCK_HANDLE has ${length} characters, expected 40`);
      expect(bad.log).to.deep.equal(["lock", "unlock"]);
    }
  });

  it("restores and verifies when the marker write is refused", async () => {
    const f = fakeEditor({putFails: n => n === 0});
    let err;
    await writeRoundTrip(f.c, ADT, URL0).catch(e => { err = e; });
    expect(err.message).to.match(/put 0 refused/);
    expect(err).not.to.be.instanceOf(Fatal);
    expect(f.log).to.deep.equal(["lock", "put0", "put1", "unlock"]);
    expect(f.source).to.equal("ORIGINAL\n");
  });

  it("makes a failed restore fatal, and still unlocks", async () => {
    const f = fakeEditor({putFails: n => n === 1});
    let err;
    await writeRoundTrip(f.c, ADT, URL0).catch(e => { err = e; });
    expect(err).to.be.instanceOf(Fatal);
    expect(err.message).to.match(/restore .* failed/);
    expect(f.log.at(-1)).to.equal("unlock");
  });

  it("makes a restore that does not round-trip fatal", async () => {
    let reads = 0;
    const f = fakeEditor({readBack: (src) => (++reads === 2 ? "DRIFTED\n" : src)});
    let err;
    await writeRoundTrip(f.c, ADT, URL0).catch(e => { err = e; });
    expect(err).to.be.instanceOf(Fatal);
    expect(err.message).to.match(/round-trip/);
  });

  it("writes nothing without a lock handle", async () => {
    for (const h of [undefined, "", "  "]) {
      const f = fakeEditor({lockHandle: h});
      let err;
      await writeRoundTrip(f.c, ADT, URL0).catch(e => { err = e; });
      expect(err.message).to.match(/no lock handle/);
      expect(f.log.filter(x => x.startsWith("put"))).to.deep.equal([]);
    }
    expect(requireHandle({LOCK_HANDLE: "H"}, URL0)).to.equal("H");
  });

  it("counts only a confirmed 404 as gone", async () => {
    const deleted = [];
    const c = {lock: async () => ({LOCK_HANDLE: "H"}), deleteObject: async (u) => { deleted.push(u); }, unLock: async () => {}};
    // a 500 or a timeout is not absence: reported, nothing deleted blind
    const broken = {objectStructure: async () => { throw Object.assign(new Error("timeout"), {err: 500}); }};
    expect(await ensureGone(c, broken, URL0)).to.match(/existence unknown/);
    expect(deleted).to.deep.equal([]);
    // present, then deleted, then a 404: gone
    let n = 0;
    const present = {objectStructure: async () => { if (n++ > 0) throw notFound(); return {}; }};
    expect(await ensureGone(c, present, URL0)).to.equal(undefined);
    expect(deleted).to.deep.equal([URL0]);
    // present and still present after the delete: reported
    const stuck = {objectStructure: async () => ({})};
    expect(await ensureGone(c, stuck, URL0)).to.match(/still answers/);
    // a lock without a handle never reaches the delete
    const noHandle = {...c, lock: async () => ({LOCK_HANDLE: ""})};
    expect(await ensureGone(noHandle, stuck, URL0)).to.match(/no lock handle/);
    expect(deleted).to.have.length(2);
  });

  it("treats a MISSING that turns FAIL as a regression", () => {
    const exp = {scenarios: {a: {status: "MISSING"}, b: {status: "PASS"}, c: {status: "FAIL"}, d: {status: "MISSING"}}};
    const d = compare([{id: "a", status: "FAIL"}, {id: "b", status: "MISSING"}, {id: "c", status: "MISSING"}, {id: "d", status: "PASS"}], exp);
    expect(d.regressions).to.deep.equal(["a: MISSING -> FAIL", "b: PASS -> MISSING"]);
    expect(d.improvements).to.deep.equal(["d: MISSING -> PASS"]);
    expect(d.changed).to.deep.equal(["c: FAIL -> MISSING"]);
  });

  it("sees a second change to an already dirty file", () => {
    const before = new Map([["a", "1"], ["b", "2"]]);
    expect(snapshotDiff(before, new Map([["a", "1"], ["b", "3"], ["c", "4"]]))).to.deep.equal(["changed b", "added c"]);
    expect(snapshotDiff(before, new Map([["a", "1"]]))).to.deep.equal(["removed b"]);
  });

  it("refuses to update the expectations after an abort or a cleanup problem", () => {
    const all = SCENARIOS.map(x => ({id: x.id, status: "PASS"}));
    expect(() => nextExpectations(all, expected, ["run aborted: write.lockWriteUnlock failed fatally"])).to.throw(/not clean/);
    expect(() => nextExpectations(all, expected, ["system: x: existence unknown"])).to.throw(/not clean/);
  });

  it("keeps the previous expectation of a scenario that did not run", () => {
    const id = SCENARIOS.at(-1).id;
    const results = SCENARIOS.map(x => x.id === id ? {id, status: "FAIL", error: "not run: aborted"} : {id: x.id, status: "PASS"});
    const next = nextExpectations(results, expected, []);
    expect(next.scenarios[id].status).to.equal(expected.scenarios[id].status);
    expect(next.scenarios[SCENARIOS[0].id].status).to.equal("PASS");
    expect(() => nextExpectations(results, {scenarios: {}}, [])).to.throw(/no previous expectation/);
  });

  it("sees a mode change with the same content", () => {
    const root = mkdtempSync(join(tmpdir(), "osd-afs-snap-"));
    try {
      spawnSync("git", ["init", "-q"], {cwd: root});
      writeFileSync(join(root, "run.sh"), "echo hi\n");
      const before = treeSnapshot(root);
      chmodSync(join(root, "run.sh"), 0o755);
      expect(snapshotDiff(before, treeSnapshot(root))).to.deep.equal(["changed run.sh"]);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});
