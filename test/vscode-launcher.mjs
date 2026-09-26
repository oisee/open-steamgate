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
import {mkdtempSync, mkdirSync, readdirSync, readlinkSync, rmSync, writeFileSync, existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {once} from "node:events";

const {
  PORT_RANGE, isFree, pickPort,
  looksLikeAbapGitFolder, detectWorkspaceLayers, packNameOf, ensureWorkspacePacks,
  waitForServing, servingOnce, terminate, Launcher,
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
