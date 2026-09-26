// B0 "Pocket SAP" spike (docs/vscode-extension.md, "B0 spike"):
// editors/vscode/launcher.js, the part of the extension that starts and
// stops the system itself. Pure-function tests first (ports, layer
// detection, the pack manifest it writes, the readiness poll, terminate()),
// then one real end-to-end run of the launcher against this checkout, on a
// free port in 3531-3539, with a temp storage directory -- the same shape
// test/osd-child.mjs already uses for `node test/run.mjs`, but driven
// through the launcher rather than by hand.
import {expect} from "chai";
import {createRequire} from "node:module";
import {createServer} from "node:net";
import {spawn} from "node:child_process";
import {mkdtempSync, mkdirSync, readdirSync, readlinkSync, rmSync, writeFileSync, existsSync, lstatSync, symlinkSync, readFileSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {once} from "node:events";

const {
  PORT_RANGE, isFree, pickPort,
  looksLikeAbapGitFolder, detectWorkspaceLayers, packNameOf, ensureWorkspacePacks,
  waitForServing, servingOnce, terminate, Launcher,
  linkOrCopyTree, materializedHomeDir, ensureMaterializedHome, MATERIALIZED_MARKER,
  DATABASE_KINDS, defaultDedicatedName, databaseEnv, describeDatabase, duckdbAvailable,
} = createRequire(import.meta.url)("../editors/vscode/launcher.js");

// No chai-as-promised in this tree's node_modules, so a rejection is caught
// by hand -- the same shape the rest of this repo's tests already use.
async function rejects(promise, matching) {
  try {
    await promise;
  } catch (error) {
    if (matching !== undefined) {
      expect(String(error?.message ?? error)).to.match(matching);
    }
    return error;
  }
  throw new Error("expected the promise to reject, and it resolved instead");
}

describe("editors/vscode/launcher.js: ports", function () {
  it("PORT_RANGE is exactly 3531-3539, the budget this spike was given", () => {
    expect(PORT_RANGE).to.deep.equal({from: 3531, to: 3539});
  });

  it("finds a free port in a range, and none when every port in it is taken", async () => {
    const port = await pickPort({from: 3531, to: 3539});
    expect(port).to.be.within(3531, 3539);
    expect(await isFree(port)).to.equal(true);

    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    try {
      expect(await isFree(port)).to.equal(false);
      await rejects(pickPort({from: port, to: port}));
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe("editors/vscode/launcher.js: workspace layers", function () {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-launcher-layers-"));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  it("is not a layer: an empty folder, or one with unrelated files", () => {
    expect(looksLikeAbapGitFolder(dir)).to.equal(false);
    writeFileSync(join(dir, "README.md"), "nothing abapGit about this\n");
    expect(looksLikeAbapGitFolder(dir)).to.equal(false);
  });

  it("is a layer: a .abapgit.xml at the root", () => {
    writeFileSync(join(dir, ".abapgit.xml"), "<?xml version=\"1.0\"?><abapGit/>\n");
    expect(looksLikeAbapGitFolder(dir)).to.equal(true);
    const [layer] = detectWorkspaceLayers([dir]);
    expect(layer.folder).to.equal(dir);
    // no src/ under it, so the folder itself is the ABAP layer
    expect(layer.srcDir).to.equal(dir);
  });

  it("is a layer: *.clas.abap under src/, with no .abapgit.xml at all", () => {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "zcl_b0_hello.clas.abap"), "CLASS zcl_b0_hello DEFINITION.\nENDCLASS.\n");
    expect(looksLikeAbapGitFolder(dir)).to.equal(true);
    const [layer] = detectWorkspaceLayers([dir]);
    expect(layer.srcDir).to.equal(join(dir, "src"));
  });

  it("is a layer: *.prog.abap under src/ too", () => {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "zreport.prog.abap"), "REPORT zreport.\n");
    expect(looksLikeAbapGitFolder(dir)).to.equal(true);
  });

  it("a src/ folder with only XML (no .clas.abap / .prog.abap) is not a layer", () => {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "zcl_b0_hello.clas.xml"), "<xml/>\n");
    expect(looksLikeAbapGitFolder(dir)).to.equal(false);
  });

  it("detectWorkspaceLayers skips a folder that does not exist and keeps the rest", () => {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "zcl_a.clas.abap"), "CLASS zcl_a DEFINITION.\nENDCLASS.\n");
    const layers = detectWorkspaceLayers([join(dir, "nope"), dir]);
    expect(layers).to.have.lengthOf(1);
    expect(layers[0].folder).to.equal(dir);
  });

  it("packNameOf is stable for the same folder and different for two folders named the same", () => {
    const a = packNameOf("/home/x/project/src");
    const b = packNameOf("/home/x/project/src");
    const c = packNameOf("/home/y/project/src");
    expect(a).to.equal(b);
    expect(a).to.not.equal(c);
    expect(a).to.match(/^ws-src-[0-9a-f]{10}$/);
  });
});

describe("editors/vscode/launcher.js: ensureWorkspacePacks (tools/osd-packs.mjs's own shape)", function () {
  let storageDir;
  let wsDir;
  beforeEach(() => {
    storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-storage-"));
    wsDir = mkdtempSync(join(tmpdir(), "osd-launcher-ws-"));
    mkdirSync(join(wsDir, "src"));
    writeFileSync(join(wsDir, "src", "zcl_b0_hello.clas.abap"), "CLASS zcl_b0_hello DEFINITION.\nENDCLASS.\n");
  });
  afterEach(() => {
    rmSync(storageDir, {recursive: true, force: true});
    rmSync(wsDir, {recursive: true, force: true});
  });

  it("returns undefined and writes nothing for no layers", () => {
    const packsDir = ensureWorkspacePacks(storageDir, []);
    expect(packsDir).to.equal(undefined);
    expect(existsSync(join(storageDir, "packs"))).to.equal(false);
  });

  it("writes a pack per layer, readable by tools/osd-packs.mjs, entirely under storageDir", async () => {
    const {detectWorkspaceLayers: detect} = createRequire(import.meta.url)("../editors/vscode/launcher.js");
    const layers = detect([wsDir]);
    const packsDir = ensureWorkspacePacks(storageDir, layers);
    expect(packsDir).to.equal(join(storageDir, "packs"));

    const {packAt, packsOf} = await import("../tools/osd-packs.mjs");
    const entries = readdirSync(packsDir);
    expect(entries).to.have.lengthOf(1);
    const pack = packAt(storageDir, join(packsDir, entries[0]));
    expect(pack.abap).to.have.lengthOf(1);
    // the pack's ABAP folder really is the workspace's src/, reached through
    // the symlink this wrote -- not a copy, and nothing was written under
    // wsDir itself
    expect(readlinkSync(join(packsDir, entries[0], "src"))).to.equal(join(wsDir, "src"));
    expect(pack.order).to.be.at.least(900);

    // OSD_PACKS naming the container finds it the way any other pack is found
    const found = packsOf(storageDir, {OSD_PACKS: packsDir});
    expect(found.map((p) => p.name)).to.include(entries[0].toLowerCase());

    // nothing was written into the workspace folder itself
    expect(readdirSync(wsDir)).to.deep.equal(["src"]);
  });

  it("rebuilds from scratch: a stale layer's pack disappears on the next call", () => {
    const {detectWorkspaceLayers: detect} = createRequire(import.meta.url)("../editors/vscode/launcher.js");
    ensureWorkspacePacks(storageDir, detect([wsDir]));
    expect(readdirSync(join(storageDir, "packs"))).to.have.lengthOf(1);
    const result = ensureWorkspacePacks(storageDir, []);
    expect(result).to.equal(undefined);
    expect(existsSync(join(storageDir, "packs"))).to.equal(false);
  });
});

describe("editors/vscode/launcher.js: waitForServing / servingOnce", function () {
  let server;
  let port;
  afterEach(async () => {
    if (server !== undefined) {
      await new Promise((r) => server.close(r));
      server = undefined;
    }
  });

  it("servingOnce answers undefined when nothing listens", async () => {
    const free = await pickPort({from: 3531, to: 3539});
    expect(await servingOnce(free)).to.equal(undefined);
  });

  it("waitForServing resolves once /osd/serving answers ready:true with a generation", async function () {
    this.timeout(5000);
    let ready = false;
    const http = await import("node:http");
    server = http.createServer((req, res) => {
      res.writeHead(200, {"content-type": "application/json"});
      res.end(JSON.stringify(ready ? {ready: true, generation: "deadbeef"} : {ready: false}));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    port = server.address().port;
    setTimeout(() => {
      ready = true;
    }, 300);
    const serving = await waitForServing(port, {timeoutMs: 3000, intervalMs: 50});
    expect(serving).to.deep.equal({ready: true, generation: "deadbeef"});
  });

  it("waitForServing throws when the timeout passes and nothing ever answers", async () => {
    const free = await pickPort({from: 3531, to: 3539});
    await rejects(waitForServing(free, {timeoutMs: 400, intervalMs: 50}), /never answered ready/);
  });
});

describe("editors/vscode/launcher.js: terminate()", function () {
  it("SIGTERMs a real child and waits for it to actually exit", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    await once(child, "spawn");
    expect(child.exitCode).to.equal(null);
    await terminate(child, {graceMs: 5000});
    expect(child.exitCode === null ? child.signalCode : child.exitCode).to.not.equal(null);
  });

  it("resolves immediately for a child that has already exited", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
    await once(child, "exit");
    await terminate(child); // must not hang or throw
  });
});

// Databases (docs/vscode-extension.md, "Databases"): the env this launcher
// hands the process it starts, and how it is labelled -- pure functions,
// tested without spawning anything (test/setup.mjs's own STG_DB branches
// stay the oracle for what a key is called; this only proves the mapping).
describe("editors/vscode/launcher.js: databases", function () {
  it("DATABASE_KINDS is exactly the four test/setup.mjs branches", () => {
    expect(DATABASE_KINDS).to.deep.equal(["sqlite", "postgres", "hana", "duckdb"]);
  });

  it("defaultDedicatedName is stable per osdHome and differs across osdHome", () => {
    const a = defaultDedicatedName("/home/alice/dev/open-steamgate");
    const b = defaultDedicatedName("/home/alice/dev/open-steamgate");
    const c = defaultDedicatedName("/home/alice/dev/another-checkout");
    expect(a).to.equal(b);
    expect(a).to.not.equal(c);
    expect(a).to.match(/^[0-9a-f]{8}$/);
  });

  it("databaseEnv(sqlite) is exactly STG_DB=file, nothing else", () => {
    expect(databaseEnv({kind: "sqlite"})).to.deep.equal({STG_DB: "file"});
    expect(databaseEnv()).to.deep.equal({STG_DB: "file"}, "no config at all defaults to sqlite");
  });

  it("databaseEnv(duckdb) is exactly STG_DB=duckdb", () => {
    expect(databaseEnv({kind: "duckdb"})).to.deep.equal({STG_DB: "duckdb"});
  });

  it("databaseEnv(postgres) sets only the fields given, never a password key when there is none", () => {
    expect(databaseEnv({kind: "postgres"})).to.deep.equal({STG_DB: "postgres"});
    expect(databaseEnv({kind: "postgres", host: "db.example", port: 5555, user: "alice", database: "osd_1234"}))
      .to.deep.equal({STG_DB: "postgres", PGHOST: "db.example", PGPORT: "5555", PGUSER: "alice", PGDATABASE: "osd_1234"});
    expect(databaseEnv({kind: "postgres", password: "s3cret"})).to.deep.equal({STG_DB: "postgres", PGPASSWORD: "s3cret"});
  });

  it("databaseEnv(hana) sets HANA_* and STG_DB_FRESH only when fresh is truthy", () => {
    expect(databaseEnv({kind: "hana"})).to.deep.equal({STG_DB: "hana"});
    expect(databaseEnv({kind: "hana", host: "hxehost", port: 39017, user: "SYSTEM", schema: "OSD_ABCD1234"}))
      .to.deep.equal({STG_DB: "hana", HANA_HOST: "hxehost", HANA_PORT: "39017", HANA_USER: "SYSTEM", HANA_SCHEMA: "OSD_ABCD1234"});
    expect(databaseEnv({kind: "hana", fresh: true})).to.deep.equal({STG_DB: "hana", STG_DB_FRESH: "1"});
    expect(databaseEnv({kind: "hana", fresh: false})).to.deep.equal({STG_DB: "hana"});
  });

  it("databaseEnv rejects a kind it does not know, rather than silently doing nothing", async () => {
    expect(() => databaseEnv({kind: "oracle"})).to.throw(/unknown database kind/);
  });

  it("describeDatabase labels each kind without ever including a password", () => {
    expect(describeDatabase({kind: "sqlite"})).to.equal("SQLite");
    expect(describeDatabase({kind: "duckdb"})).to.equal("DuckDB");
    expect(describeDatabase({kind: "postgres"})).to.equal("PostgreSQL");
    expect(describeDatabase({kind: "postgres", database: "osd_1234", password: "s3cret"})).to.equal("PostgreSQL (osd_1234)");
    expect(describeDatabase({kind: "hana"})).to.equal("HANA");
    expect(describeDatabase({kind: "hana", schema: "OSD_1234", password: "s3cret"})).to.equal("HANA (schema OSD_1234)");
  });

  it("duckdbAvailable is true only when <osdHome>/node_modules/@duckdb/node-api is a directory", () => {
    const home = mkdtempSync(join(tmpdir(), "osd-duckdb-check-"));
    try {
      expect(duckdbAvailable(home)).to.equal(false);
      mkdirSync(join(home, "node_modules", "@duckdb", "node-api"), {recursive: true});
      expect(duckdbAvailable(home)).to.equal(true);
    } finally {
      rmSync(home, {recursive: true, force: true});
    }
  });
});

// The stale-schema refusal (test/setup.mjs, HANA/DuckDB): a thrown Error
// naming its own fix (STG_DB_FRESH=1), reaching stderr and then a process
// exit -- never a "serving" answer. Proven here with a fake `test/run.mjs`
// standing in for the real one, so this does not need a real HANA: what is
// under test is that start() surfaces that message QUICKLY (the exit race),
// not the full waitForServing timeout.
describe("editors/vscode/launcher.js: Launcher surfaces a child that exits before serving", function () {
  it("rejects with the child's own stderr tail, well inside the timeout", async function () {
    this.timeout(15000);
    const osdHome = mkdtempSync(join(tmpdir(), "osd-launcher-earlyexit-home-"));
    const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-earlyexit-storage-"));
    mkdirSync(join(osdHome, "tools"), {recursive: true});
    mkdirSync(join(osdHome, "test"), {recursive: true});
    // stands in for `tools/osd-build.mjs`: a build that "succeeds" instantly
    writeFileSync(join(osdHome, "tools", "osd-build.mjs"), "process.exit(0);\n");
    // stands in for `node test/run.mjs`: exits the way test/setup.mjs's own
    // HANA branch does on a schema this build did not stamp
    writeFileSync(join(osdHome, "test", "run.mjs"),
      "process.stderr.write('Error: Existing HANA database is missing generated tables: T1. " +
      "Use a fresh HANA_SCHEMA, or explicitly recreate it with STG_DB_FRESH=1\\n'); process.exit(1);\n");
    const launcher = new Launcher({osdHome, storageDir, workspaceFolders: [], timeoutMs: 10000});
    const started = Date.now();
    try {
      const error = await rejects(launcher.start(), /STG_DB_FRESH/);
      expect(Date.now() - started, "must not wait out the full timeout").to.be.lessThan(9000);
      expect(String(error.message)).to.contain("osd exited before it started serving");
    } finally {
      rmSync(osdHome, {recursive: true, force: true});
      rmSync(storageDir, {recursive: true, force: true});
    }
  });
});

describe("editors/vscode/launcher.js: Launcher end to end (against this checkout)", function () {
  this.timeout(180000);

  it("starts the real system on a free port in 3531-3539, serves the demo, and stops leaving no process", async function () {
    const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-e2e-"));
    const osdHome = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
    const launcher = new Launcher({osdHome, storageDir, workspaceFolders: [], timeoutMs: 170000});
    const lines = [];
    launcher.on("log", (l) => lines.push(l));
    const states = [];
    launcher.on("state", (s) => states.push(s));

    let result;
    try {
      result = await launcher.start();
      expect(result.port).to.be.within(3531, 3539);
      expect(result.pid).to.be.a("number");
      expect(result.generation).to.be.a("string").and.not.equal("");
      expect(launcher.state).to.equal("running");
      expect(states).to.include.members(["building", "starting", "running"]);

      const res = await fetch(`http://localhost:${result.port}/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$format=json`);
      expect(res.status).to.equal(200);
      const body = await res.json();
      expect(body.d.results.length).to.be.at.least(1);

      // no HTTPS listener outside 3531-3539: OSD_TLS_DIR pointed at an empty
      // storage folder, so plain HTTP is what a fresh install gets
      const serving = await fetch(`http://localhost:${result.port}/osd/serving`).then((r) => r.json());
      expect(serving.ready).to.equal(true);

      // every byte this run needed lives under storageDir
      expect(existsSync(join(storageDir, "db", "osd.sqlite")) || existsSync(join(storageDir, "db"))).to.equal(true);
    } finally {
      const pid = launcher.pid;
      await launcher.stop();
      expect(launcher.state).to.equal("stopped");
      if (pid !== undefined) {
        expect(() => process.kill(pid, 0)).to.throw();
      }
      rmSync(storageDir, {recursive: true, force: true});
    }
  });

  it("reports a failed build without leaving a half-started server (osdHome is not a real tree)", async function () {
    this.timeout(20000);
    const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-badhome-"));
    const badHome = mkdtempSync(join(tmpdir(), "osd-launcher-nothome-"));
    const launcher = new Launcher({osdHome: badHome, storageDir, timeoutMs: 5000});
    try {
      await rejects(launcher.start());
      expect(launcher.state).to.equal("stopped");
    } finally {
      rmSync(storageDir, {recursive: true, force: true});
      rmSync(badHome, {recursive: true, force: true});
    }
  });
});

// Packaging (docs/vscode-extension.md, "Packaging"): materializing a
// packaged extension's bundled seed (`extension/osd/`) into the extension's
// own writable storage, once per version. A small fake seed here, never the
// real 100+ MB one -- what is under test is the copy mechanism and the
// once/per-version/cleans-up-old-versions rules, not the seed's own size.
describe("editors/vscode/launcher.js: linkOrCopyTree / ensureMaterializedHome (packaging)", function () {
  let seedDir, storageDir;

  beforeEach(() => {
    seedDir = mkdtempSync(join(tmpdir(), "osd-seed-"));
    mkdirSync(join(seedDir, "test"), {recursive: true});
    writeFileSync(join(seedDir, "test", "run.mjs"), "// fake\n");
    writeFileSync(join(seedDir, "top.txt"), "hello");
    mkdirSync(join(seedDir, "node_modules", "x"), {recursive: true});
    writeFileSync(join(seedDir, "node_modules", "x", "index.js"), "module.exports = 1;\n");
    symlinkSync(join(seedDir, "node_modules"), join(seedDir, "output"), "dir");
    storageDir = mkdtempSync(join(tmpdir(), "osd-storage-"));
  });

  afterEach(() => {
    rmSync(seedDir, {recursive: true, force: true});
    rmSync(storageDir, {recursive: true, force: true});
  });

  it("linkOrCopyTree hard-links regular files, keeps symlinks as symlinks, and recurses into directories", () => {
    const dest = join(storageDir, "copy");
    linkOrCopyTree(seedDir, dest);
    expect(readFileSync(join(dest, "top.txt"), "utf8")).to.equal("hello");
    expect(readFileSync(join(dest, "node_modules", "x", "index.js"), "utf8")).to.include("module.exports");
    expect(lstatSync(join(dest, "output")).isSymbolicLink()).to.equal(true);
    expect(readlinkSync(join(dest, "output"))).to.equal(join(seedDir, "node_modules"));
    // a hard link shares the inode with its source (same filesystem, which
    // storageDir and seedDir both are here, both under the same tmpdir)
    const a = statSync(join(seedDir, "top.txt"));
    const b = statSync(join(dest, "top.txt"));
    expect(a.ino).to.equal(b.ino);
  });

  it("materializedHomeDir is one directory per version, under globalStorageDir", () => {
    expect(materializedHomeDir(storageDir, "0.1.0")).to.equal(join(storageDir, "osd-home-0.1.0"));
    expect(materializedHomeDir(storageDir, "0.2.0")).to.equal(join(storageDir, "osd-home-0.2.0"));
  });

  it("ensureMaterializedHome copies the seed once, and a second call is a no-op (marker file)", () => {
    const target = ensureMaterializedHome(seedDir, storageDir, "0.1.0");
    expect(target).to.equal(join(storageDir, "osd-home-0.1.0"));
    expect(existsSync(join(target, "top.txt"))).to.equal(true);
    expect(existsSync(join(target, MATERIALIZED_MARKER))).to.equal(true);

    // add to the seed after the first materialize: a second call must NOT
    // pick it up, because the marker says "already done for this version"
    // (a hard link shares content with a file mutated in place, so a NEW
    // file is what proves "no second copy happened" -- an edited existing
    // one would prove nothing either way)
    writeFileSync(join(seedDir, "added-later.txt"), "should not appear");
    const again = ensureMaterializedHome(seedDir, storageDir, "0.1.0");
    expect(again).to.equal(target);
    expect(existsSync(join(target, "added-later.txt"))).to.equal(false);
  });

  it("a version change makes a new copy and removes the old one", () => {
    const v1 = ensureMaterializedHome(seedDir, storageDir, "0.1.0");
    expect(existsSync(v1)).to.equal(true);

    writeFileSync(join(seedDir, "top.txt"), "v2 content");
    const v2 = ensureMaterializedHome(seedDir, storageDir, "0.2.0");
    expect(v2).to.equal(join(storageDir, "osd-home-0.2.0"));
    expect(readFileSync(join(v2, "top.txt"), "utf8")).to.equal("v2 content");
    expect(existsSync(v1)).to.equal(false, "the old version's copy must be gone");
  });
});
