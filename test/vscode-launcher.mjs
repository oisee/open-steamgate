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
import {delimiter, join} from "node:path";
import {once} from "node:events";
import {brotliCompressSync} from "node:zlib";
import {ObjectStore} from "../tools/osd-store.mjs";
import {hashOf} from "../tools/osd-build.mjs";
// A lock name carries a random UUID; tests build fixed ones instead of spelling them out.
const lockId = (n) => ["0".repeat(8), "0000", "4000", "8000", String(n).padStart(12, "0")].join("-");

const {
  PORT_RANGE, isFree, pickPort, classify,
  pickInspectorPort, debugSystemEnv,
  looksLikeAbapGitFolder, isOpenSteamgateCheckout, decideStartTarget,
  detectWorkspaceLayers, packNameOf, ensureWorkspacePacks,
  waitForServing, servingOnce, terminate, Launcher,
  linkOrCopyTree, materializedHomeDir, ensureMaterializedHome, selectOldHomes, listOldHomes, keptHomeNotice, MATERIALIZED_MARKER,
  cleanupOldHomes, hasLiveServingLock, setServingChildPid, SERVING_LOCK_PREFIX,
  DATABASE_KINDS, defaultDedicatedName, databaseEnv, describeDatabase, duckdbAvailable,
  WARM_MEMORY_FLOOR_BYTES, shouldWarm, warmEnvironment,
  SEED_ID_FILE, seedContentId, writeSeedId,
  writeTar,
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

  it("chooses a free ephemeral inspector port and only enables OSD_INSPECT when requested", async () => {
    const port = await pickInspectorPort();
    expect(port).to.be.within(1, 65535);
    expect(await isFree(port)).to.equal(true);
    expect(debugSystemEnv({OSD_INSPECT: "9229", OSD_WORKERS: "4"}, false))
      .to.deep.equal({OSD_WORKERS: "4"});
    expect(debugSystemEnv({OSD_INSPECT: "9229", OSD_WORKERS: "4"}, true, port))
      .to.deep.equal({OSD_INSPECT: String(port), OSD_WORKERS: "1"});
    expect(() => debugSystemEnv({}, true, 0)).to.throw(/invalid inspector port/);
  });

  it("classifies an empty-log no-free-port launcher error", async () => {
    const port = await pickPort({from: PORT_RANGE.from, to: PORT_RANGE.to});
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-no-port-"));
    const launcher = new Launcher({osdHome: process.cwd(), storageDir, portRange: {from: port, to: port}});
    try {
      const error = await rejects(launcher.start());
      expect(error.logText).to.equal("");
      expect(launcher.state).to.equal("stopped");
      expect(classify(error.logText, error).actions).to.deep.equal(["Pick another port"]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(storageDir, {recursive: true, force: true});
    }
  });

  it("classifies an empty-log selected-port EADDRINUSE launcher error", async () => {
    const port = await pickPort({from: PORT_RANGE.from, to: PORT_RANGE.to});
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-busy-port-"));
    const launcher = new Launcher({osdHome: process.cwd(), storageDir});
    try {
      const error = await rejects(launcher.start({port}));
      expect(error.code).to.equal("EADDRINUSE");
      expect(error.logText).to.equal("");
      expect(launcher.state).to.equal("stopped");
      expect(classify(error.logText, error).actions).to.deep.equal(["Pick another port"]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(storageDir, {recursive: true, force: true});
    }
  });
});

describe("editors/vscode/launcher.js: classify build and launcher logs", function () {
  it("maps the real UNFETCHED refusal to fetching packs", () => {
    const line = "osd-build: UNFETCHED: the build refuses: pack theirs fetches upstream from https://github.com/example/theirs at 0123456789ab and it is not there — run: node tools/osd-fetch.mjs";
    expect(classify(line)).to.deep.equal({
      kind: "unfetched",
      message: "Some packs have not been fetched.",
      actions: ["Fetch packs"],
    });
  });

  it("maps a build's transpile failure to the log and full-rebuild actions", () => {
    const line = "osd-build: FAILED: Syntax error in ZCL_BROKEN, zcl_broken.clas.abap:7";
    expect(classify(line)).to.deep.equal({
      kind: "build-failed",
      message: "The build failed.",
      actions: ["Open log", "Full rebuild"],
    });
  });

  it("maps Node's EADDRINUSE startup line to choosing a different port", () => {
    const line = "Error: listen EADDRINUSE: address already in use :::3531";
    expect(classify(line)).to.deep.equal({
      kind: "port-in-use",
      message: "The osd port is already in use.",
      actions: ["Pick another port"],
    });
  });
});

// T7 (docs/vscode-extension.md "Warm"): osd.warm's own "auto" rule -- on
// when this machine has at least WARM_MEMORY_FLOOR_BYTES of RAM (the prime
// costs about 0.7 GB, docs/warm-compile.md), always/never for "on"/"off".
// Pure: a number stands in for os.totalmem() rather than depending on the
// runner's own memory.
describe("editors/vscode/launcher.js: shouldWarm (osd.warm's auto rule)", function () {
  it("WARM_MEMORY_FLOOR_BYTES is 4 GB", () => {
    expect(WARM_MEMORY_FLOOR_BYTES).to.equal(4 * 1024 * 1024 * 1024);
  });

  it("\"on\" and \"off\" ignore the machine's memory", () => {
    expect(shouldWarm("on", 0)).to.equal(true);
    expect(shouldWarm("on", 1)).to.equal(true);
    expect(shouldWarm("off", Number.MAX_SAFE_INTEGER)).to.equal(false);
  });

  it("\"auto\" is the memory floor: on at or above it, off below it", () => {
    expect(shouldWarm("auto", WARM_MEMORY_FLOOR_BYTES)).to.equal(true);
    expect(shouldWarm("auto", WARM_MEMORY_FLOOR_BYTES + 1)).to.equal(true);
    expect(shouldWarm("auto", WARM_MEMORY_FLOOR_BYTES - 1)).to.equal(false);
  });

  it("defaults to the real machine's os.totalmem() when none is given", () => {
    // whatever this runner has, the call must not throw and must answer a
    // boolean -- the point is that the default argument works, not a
    // specific verdict for this machine
    expect(shouldWarm("auto")).to.be.a("boolean");
  });
});

describe("editors/vscode/launcher.js: warm activation defaults", function () {
  it("enables auto mode at 4 GB, while explicit off and on take precedence", () => {
    const fourGb = 4 * 1024 ** 3;
    expect(warmEnvironment("auto", fourGb)).to.deep.equal({OSD_WARM: "1"});
    expect(warmEnvironment("auto", fourGb - 1)).to.deep.equal({OSD_WARM: "0"});
    expect(warmEnvironment("off", fourGb)).to.deep.equal({OSD_WARM: "0"});
    expect(warmEnvironment("on", 1)).to.deep.equal({OSD_WARM: "1"});
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

describe("editors/vscode/launcher.js: Start home choice", function () {
  const checkout = "/work/open-steamgate";
  const bundled = "/extension/osd-home-0.1.0";
  const specialCase = {configuredHome: "", workspaceFolder: checkout,
    workspaceIsOpenSteamgate: true, bundledHome: bundled};

  it("prompts only for one open-steamgate folder with no configured home and a bundled system", () => {
    expect(decideStartTarget(specialCase)).to.deep.equal({
      kind: "prompt", workspaceHome: checkout, bundledHome: bundled,
    });
    expect(decideStartTarget({...specialCase, configuredHome: "/work/other"})).to.deep.equal({
      kind: "ready", osdHome: "/work/other", source: "configured",
    });
    expect(decideStartTarget({...specialCase, workspaceIsOpenSteamgate: false})).to.deep.equal({
      kind: "ready", osdHome: bundled, source: "bundled",
    });
    expect(decideStartTarget({...specialCase, workspaceFolder: undefined})).to.deep.equal({
      kind: "ready", osdHome: bundled, source: "bundled",
    });
    expect(decideStartTarget({...specialCase, bundledHome: undefined})).to.deep.equal({
      kind: "ready", osdHome: checkout, source: "workspace",
    });
  });

  it("Yes selects the workspace, No remembers the bundle, and Always ask leaves prompting enabled", () => {
    expect(decideStartTarget({...specialCase, configuredHome: checkout})).to.deep.equal({
      kind: "ready", osdHome: checkout, source: "workspace",
    });
    expect(decideStartTarget({...specialCase, rememberedChoice: "bundled"})).to.deep.equal({
      kind: "ready", osdHome: bundled, source: "bundled",
    });
    // Always ask clears the remembered answer, so a subsequent Start asks.
    expect(decideStartTarget({...specialCase, rememberedChoice: undefined}).kind).to.equal("prompt");
  });

  it("recognizes a checkout only when both marker files exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-open-steamgate-home-"));
    try {
      mkdirSync(join(dir, "tools"));
      writeFileSync(join(dir, "abap_transpile.json"), "{}\n");
      expect(isOpenSteamgateCheckout(dir)).to.equal(false);
      writeFileSync(join(dir, "tools", "osd-build.mjs"), "// build\n");
      expect(isOpenSteamgateCheckout(dir)).to.equal(true);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
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

  it("keeps the permanent notebook scratch pack even with no workspace layers", async () => {
    const packsDir = ensureWorkspacePacks(storageDir, []);
    expect(packsDir).to.equal(join(storageDir, "packs"));
    expect(readdirSync(packsDir)).to.deep.equal(["notebook-scratch"]);
    const {packAt, packsOf} = await import("../tools/osd-packs.mjs");
    const scratch = packAt(storageDir, join(packsDir, "notebook-scratch"));
    expect(scratch.name).to.equal("notebook-scratch");
    expect(scratch.abap).to.deep.equal([join(packsDir, "notebook-scratch", "src")]);
    expect(packsOf(storageDir, {OSD_PACKS: packsDir}).map((p) => p.name)).to.deep.equal(["notebook-scratch"]);
  });

  it("writes a pack per layer, readable by tools/osd-packs.mjs, entirely under storageDir", async () => {
    const {detectWorkspaceLayers: detect} = createRequire(import.meta.url)("../editors/vscode/launcher.js");
    const layers = detect([wsDir]);
    const packsDir = ensureWorkspacePacks(storageDir, layers);
    expect(packsDir).to.equal(join(storageDir, "packs"));

    const {packAt, packsOf} = await import("../tools/osd-packs.mjs");
    const entries = readdirSync(packsDir);
    expect(entries).to.have.lengthOf(2);
    const workspacePackName = entries.find((name) => name.startsWith("ws-"));
    const pack = packAt(storageDir, join(packsDir, workspacePackName));
    expect(pack.abap).to.have.lengthOf(1);
    // the pack's ABAP folder really is the workspace's src/, reached through
    // the symlink this wrote -- not a copy, and nothing was written under
    // wsDir itself
    expect(readlinkSync(join(packsDir, workspacePackName, "src"))).to.equal(join(wsDir, "src"));
    expect(pack.order).to.be.at.least(900);

    // OSD_PACKS naming the container finds it the way any other pack is found
    const found = packsOf(storageDir, {OSD_PACKS: packsDir});
    expect(found.map((p) => p.name)).to.include(workspacePackName.toLowerCase());
    expect(found.map((p) => p.name)).to.include("notebook-scratch");

    // nothing was written into the workspace folder itself
    expect(readdirSync(wsDir)).to.deep.equal(["src"]);
  });

  it("removes stale workspace packs while preserving the notebook scratch files", () => {
    const {detectWorkspaceLayers: detect} = createRequire(import.meta.url)("../editors/vscode/launcher.js");
    ensureWorkspacePacks(storageDir, detect([wsDir]));
    const scratchFile = join(storageDir, "packs", "notebook-scratch", "src", "cell.abap");
    writeFileSync(scratchFile, "kept between starts");
    expect(readdirSync(join(storageDir, "packs"))).to.have.lengthOf(2);
    const result = ensureWorkspacePacks(storageDir, []);
    expect(result).to.equal(join(storageDir, "packs"));
    expect(readdirSync(result)).to.deep.equal(["notebook-scratch"]);
    expect(readFileSync(scratchFile, "utf8")).to.equal("kept between starts");
  });

  it("projects the workspace's own manifest and every declared part", async () => {
    mkdirSync(join(wsDir, "rows"));
    mkdirSync(join(wsDir, "pages"));
    mkdirSync(join(wsDir, "defs"));
    writeFileSync(join(wsDir, "rows", "ztest.tabu.json"), "[]");
    writeFileSync(join(wsDir, "defs", "ztest.tabl.xml"), "<abapGit/>");
    writeFileSync(join(wsDir, "pages", "index.html"), "hello");
    const manifest = {name: "own-name", order: 42, abap: ["src"], data: "rows", ddic: "defs",
      webapp: "pages", tiles: [{id: "own-tile", title: "Own tile"}]};
    writeFileSync(join(wsDir, "osd-pack.json"), JSON.stringify(manifest));
    const [layer] = detectWorkspaceLayers([wsDir]);
    const packsDir = ensureWorkspacePacks(storageDir, [layer]);
    const projected = join(packsDir, packNameOf(wsDir));
    expect(JSON.parse(readFileSync(join(projected, "osd-pack.json"), "utf8"))).to.deep.equal(manifest);
    const {packAt} = await import("../tools/osd-packs.mjs");
    const pack = packAt(storageDir, projected);
    expect(pack).to.include({name: "own-name", order: 42});
    expect(pack.data).to.equal(join(projected, "rows"));
    expect(pack.ddic).to.equal(join(projected, "defs"));
    expect(pack.webapp).to.equal(join(projected, "pages"));
    expect(pack.tiles[0].id).to.equal("own-tile");
  });

  it("projects ./ paths and hashes edits to data, DDIC, and webapp content", async () => {
    for (const folder of ["rows", "ddic2", "web"]) mkdirSync(join(wsDir, folder));
    const files = [
      ["rows", "ztest.tabu.json", "[]"],
      ["ddic2", "ztest.tabl.xml", "<abapGit/>"],
      ["web", "index.html", "hello"],
    ];
    for (const [folder, name, content] of files) writeFileSync(join(wsDir, folder, name), content);
    writeFileSync(join(wsDir, "osd-pack.json"), JSON.stringify({
      name: "dot-paths", abap: "./src", data: "./rows", ddic: "./ddic2", webapp: "./web",
    }));
    const dir = join(ensureWorkspacePacks(storageDir, detectWorkspaceLayers([wsDir])), packNameOf(wsDir));
    const {packAt} = await import("../tools/osd-packs.mjs");
    const pack = packAt(storageDir, dir);
    expect(pack.abap).to.deep.equal([join(dir, "src")]);
    expect([pack.data, pack.ddic, pack.webapp]).to.deep.equal(["rows", "ddic2", "web"].map((f) => join(dir, f)));
    const config = join(storageDir, "abap_transpile.json");
    writeFileSync(config, "{}");
    const inputs = {folders: pack.abap, libs: [], bspFolders: [pack.webapp],
      packFolders: [pack.data, pack.ddic], packFiles: [join(dir, "osd-pack.json")], config};
    const generation = () => hashOf(storageDir, inputs, {transpiler: "test"});
    for (const [folder, name, original] of files) {
      const projected = join(dir, folder, name);
      expect(readFileSync(projected, "utf8")).to.equal(original);
      const before = generation();
      const changed = `${original} changed`;
      writeFileSync(join(wsDir, folder, name), changed);
      expect(readFileSync(projected, "utf8")).to.equal(changed);
      expect(generation(), `${folder} edit changes the generation`).to.not.equal(before);
    }
  });

  for (const field of ["abap", "data", "ddic", "webapp"]) {
    it(`refuses empty, absolute, or escaping ${field} paths`, () => {
      for (const [invalid, message] of [["", /nonempty relative path/], ["/tmp/outside", /nonempty relative path/],
        ["../outside", /must not contain '\.\.'/], ["src/../rows", /must not contain '\.\.'/]]) {
        writeFileSync(join(wsDir, "osd-pack.json"), JSON.stringify({[field]: invalid}));
        expect(() => ensureWorkspacePacks(storageDir, detectWorkspaceLayers([wsDir]))).to.throw(message);
      }
    });
  }

  it("keeps the workspace folder's implicit name for its app and default tile", async () => {
    mkdirSync(join(wsDir, "webapp"));
    writeFileSync(join(wsDir, "webapp", "index.html"), "hello");
    writeFileSync(join(wsDir, "osd-pack.json"), JSON.stringify({tiles: [{}]}));
    const packsDir = ensureWorkspacePacks(storageDir, detectWorkspaceLayers([wsDir]));
    const {packsOf, tilesOf, webappsOf} = await import("../tools/osd-packs.mjs");
    const env = {OSD_PACKS: packsDir};
    const name = wsDir.split("/").at(-1).toLowerCase();
    const pack = packsOf(storageDir, env).find((item) => item.name === name);
    expect(pack).to.exist;
    expect(pack.name).to.not.equal(packNameOf(wsDir));
    expect(tilesOf(storageDir, env)[0]).to.include({url: `/app/${name}/`, title: name});
    expect(webappsOf(storageDir, env).find((app) => app.name === name)).to.exist;
  });

  for (const abap of [undefined, "."]) {
    it(`projects root-level ABAP and hashes edits when abap is ${abap ?? "omitted"} and src is absent`, async () => {
      rmSync(join(wsDir, "src"), {recursive: true});
      const source = join(wsDir, "zcl_root.clas.abap");
      writeFileSync(source, "CLASS zcl_root DEFINITION. ENDCLASS.");
      writeFileSync(join(wsDir, "osd-pack.json"), JSON.stringify({name: "root-abap", ...(abap && {abap})}));
      const [layer] = detectWorkspaceLayers([wsDir]);
      const packsDir = ensureWorkspacePacks(storageDir, [layer]);
      const dir = join(packsDir, packNameOf(wsDir));
      const {packAt} = await import("../tools/osd-packs.mjs");
      expect(packAt(storageDir, dir).abap).to.deep.equal([dir]);
      expect(readFileSync(join(dir, "zcl_root.clas.abap"), "utf8")).to.contain("zcl_root");
      const config = join(storageDir, "abap_transpile.json");
      writeFileSync(config, "{}");
      const inputs = {folders: [dir], libs: [], bspFolders: [], packFolders: [],
        packFiles: [join(dir, "osd-pack.json")], config};
      const generation = () => hashOf(storageDir, inputs, {transpiler: "test"});
      const before = generation();
      writeFileSync(source, "CLASS zcl_root DEFINITION. PUBLIC SECTION. ENDCLASS.");
      expect(generation(), "editing root-level ABAP through the projected file link changes the generation")
        .to.not.equal(before);
    });
  }
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

  it("waitForServing waits past its timeout while the system answers 'starting' (a slow HANA boot)", async function () {
    this.timeout(10000);
    let ready = false;
    const http = await import("node:http");
    server = http.createServer((req, res) => {
      res.writeHead(200, {"content-type": "application/json"});
      res.end(JSON.stringify(ready ? {ready: true, generation: "cafe"} : {ready: false, starting: true, phase: "seeding"}));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    port = server.address().port;
    setTimeout(() => {
      ready = true;
    }, 2500);
    const phases = [];
    const serving = await waitForServing(port, {timeoutMs: 1000, intervalMs: 100, bootMs: 8000, onStarting: (s) => phases.push(s.phase)});
    expect(serving).to.include({ready: true, generation: "cafe"});
    expect(phases).to.include("seeding");
  });

  it("waitForServing gives up at the boot limit even while 'starting'", async function () {
    this.timeout(10000);
    const http = await import("node:http");
    server = http.createServer((req, res) => {
      res.writeHead(200, {"content-type": "application/json"});
      res.end(JSON.stringify({ready: false, starting: true, phase: "seeding"}));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    port = server.address().port;
    const started = Date.now();
    await rejects(waitForServing(port, {timeoutMs: 500, intervalMs: 100, bootMs: 1500}), /never answered ready/);
    expect(Date.now() - started).to.be.within(1400, 4000);
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

describe("editors/vscode/launcher.js: stop while building", function () {
  it("terminates its own build child and does not start the server afterward", async function () {
    const osdHome = mkdtempSync(join(tmpdir(), "osd-launcher-cancel-home-"));
    const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-cancel-storage-"));
    const serverMarker = join(storageDir, "server-started");
    mkdirSync(join(osdHome, "tools"), {recursive: true});
    mkdirSync(join(osdHome, "test"), {recursive: true});
    writeFileSync(join(osdHome, "tools", "osd-build.mjs"), "setInterval(() => {}, 1000);\n");
    writeFileSync(join(osdHome, "test", "run.mjs"), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(serverMarker)}, 'started');\n`);
    const launcher = new Launcher({osdHome, storageDir, workspaceFolders: []});
    try {
      const starting = launcher.start();
      for (let attempt = 0; launcher.buildChild === undefined && attempt < 100; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(launcher.buildChild).not.to.equal(undefined);
      await launcher.stop();
      expect(await starting).to.equal(undefined);
      expect(launcher.state).to.equal("stopped");
      expect(existsSync(serverMarker)).to.equal(false);
    } finally {
      await launcher.stop();
      rmSync(osdHome, {recursive: true, force: true});
      rmSync(storageDir, {recursive: true, force: true});
    }
  });
});

// Stop is not an accident: a stop the launcher was asked for emits no "exit"
// (the extension turns "exit" into "the system stopped unexpectedly"), and
// a child killed from outside still does. A fake `test/run.mjs` that answers
// /osd/serving stands in for the real one.
describe("editors/vscode/launcher.js: an intended stop is not an unexpected exit", function () {
  this.timeout(20000);
  const fakeHome = () => {
    const osdHome = mkdtempSync(join(tmpdir(), "osd-launcher-stop-home-"));
    mkdirSync(join(osdHome, "tools"), {recursive: true});
    mkdirSync(join(osdHome, "test"), {recursive: true});
    writeFileSync(join(osdHome, "tools", "osd-build.mjs"), "process.exit(0);\n");
    writeFileSync(join(osdHome, "test", "run.mjs"),
      "import {createServer} from 'node:http';\n" +
      "createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ready: true, generation: 'fake'})); })" +
      ".listen(Number(process.env.STG_PORT), '127.0.0.1');\n");
    return osdHome;
  };

  for (const how of ["stop", "rebuild"]) {
    it(`${how}(): no "exit", and the log says it stopped`, async () => {
      const osdHome = fakeHome();
      const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-stop-storage-"));
      const launcher = new Launcher({osdHome, storageDir, workspaceFolders: [], timeoutMs: 15000});
      const exits = [];
      const lines = [];
      launcher.on("exit", (e) => exits.push(e));
      launcher.on("log", (l) => lines.push(l));
      try {
        await launcher.start();
        expect(launcher.state).to.equal("running");
        if (how === "stop") {
          await launcher.stop();
          expect(launcher.state).to.equal("stopped");
        } else {
          await launcher.rebuild();
          expect(launcher.state).to.equal("running");
        }
        expect(exits, "an intended stop is not an unexpected exit").to.deep.equal([]);
        expect(lines.join("")).to.contain("--- osd stopped ---");
      } finally {
        await launcher.stop();
        rmSync(osdHome, {recursive: true, force: true});
        rmSync(storageDir, {recursive: true, force: true});
      }
    });
  }

  // a child that never answers /osd/serving: "starting" for as long as we like
  const silentHome = () => {
    const osdHome = fakeHome();
    writeFileSync(join(osdHome, "test", "run.mjs"), "setInterval(() => {}, 1000);\n");
    return osdHome;
  };

  it("stop() while starting: start() resolves undefined, no \"exit\"", async () => {
    const osdHome = silentHome();
    const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-stop-storage-"));
    const launcher = new Launcher({osdHome, storageDir, workspaceFolders: [], timeoutMs: 15000});
    const exits = [];
    const lines = [];
    launcher.on("exit", (e) => exits.push(e));
    launcher.on("log", (l) => lines.push(l));
    try {
      const starting = launcher.start();
      for (let i = 0; launcher.state !== "starting" && i < 200; i++) await new Promise((r) => setTimeout(r, 10));
      expect(launcher.state).to.equal("starting");
      await launcher.stop();
      expect(await starting, "a cancel, not an error").to.equal(undefined);
      expect(launcher.state).to.equal("stopped");
      expect(exits).to.deep.equal([]);
      expect(lines.join("")).to.contain("--- osd stopped ---");
    } finally {
      await launcher.stop();
      rmSync(osdHome, {recursive: true, force: true});
      rmSync(storageDir, {recursive: true, force: true});
    }
  });

  it("a start that gives up says so, rejects, and is no \"exit\"", async () => {
    const osdHome = silentHome();
    const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-stop-storage-"));
    const launcher = new Launcher({osdHome, storageDir, workspaceFolders: [], timeoutMs: 1500});
    const exits = [];
    const lines = [];
    launcher.on("exit", (e) => exits.push(e));
    launcher.on("log", (l) => lines.push(l));
    try {
      await rejects(launcher.start());
      expect(launcher.state).to.equal("stopped");
      expect(exits).to.deep.equal([]);
      expect(lines.join("")).to.contain("--- osd start abandoned ---");
    } finally {
      await launcher.stop();
      rmSync(osdHome, {recursive: true, force: true});
      rmSync(storageDir, {recursive: true, force: true});
    }
  });

  it("stop() while starting wins over a ready answer the child gives on its way out", async () => {
    const osdHome = fakeHome();
    // not ready until told to stop; then ready for a moment, then gone
    const armed = join(osdHome, "armed");
    writeFileSync(join(osdHome, "test", "run.mjs"),
      "import {createServer} from 'node:http';\n" +
      "import {writeFileSync} from 'node:fs';\n" +
      "setInterval(() => {}, 1000);\n" +
      "let signals = 0;\n" +
      "process.on('SIGTERM', () => {\n" +
      `  if (++signals > 1) { writeFileSync(${JSON.stringify(join(osdHome, "twice"))}, 'twice'); return; }\n` +
      "  createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ready: true, generation: 'late'})); })" +
      ".listen(Number(process.env.STG_PORT), '127.0.0.1');\n" +
      "  setTimeout(() => process.exit(0), 1500);\n" +
      "});\n" +
      `writeFileSync(${JSON.stringify(armed)}, 'armed');\n`);
    const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-stop-storage-"));
    const launcher = new Launcher({osdHome, storageDir, workspaceFolders: [], timeoutMs: 15000});
    const exits = [];
    launcher.on("exit", (e) => exits.push(e));
    try {
      const starting = launcher.start();
      // the SIGTERM handler is installed: the ready answer will come
      for (let i = 0; !existsSync(armed) && i < 500; i++) await new Promise((r) => setTimeout(r, 10));
      expect(existsSync(armed)).to.equal(true);
      await launcher.stop();
      expect(await starting, "not a running system").to.equal(undefined);
      expect(launcher.state).to.equal("stopped");
      expect(exits).to.deep.equal([]);
      expect(existsSync(join(osdHome, "twice")), "one SIGTERM per stop").to.equal(false);
    } finally {
      await launcher.stop();
      rmSync(osdHome, {recursive: true, force: true});
      rmSync(storageDir, {recursive: true, force: true});
    }
  });

  it("a stop that comes before the start timeout, with a shutdown that outlasts it, is still a stop", async () => {
    const osdHome = fakeHome();
    // never ready; on SIGTERM it takes longer to go than start() waits
    const armed = join(osdHome, "armed");
    writeFileSync(join(osdHome, "test", "run.mjs"),
      "import {writeFileSync} from 'node:fs';\n" +
      "setInterval(() => {}, 1000);\n" +
      "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 1500));\n" +
      `writeFileSync(${JSON.stringify(armed)}, 'armed');\n`);
    const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-stop-storage-"));
    const launcher = new Launcher({osdHome, storageDir, workspaceFolders: [], timeoutMs: 1000});
    const exits = [];
    const lines = [];
    launcher.on("exit", (e) => exits.push(e));
    launcher.on("log", (l) => lines.push(l));
    try {
      const starting = launcher.start();
      for (let i = 0; !existsSync(armed) && i < 500; i++) await new Promise((r) => setTimeout(r, 10));
      expect(existsSync(armed)).to.equal(true);
      await launcher.stop();
      expect(await starting, "the stop's cancel, not a timeout error").to.equal(undefined);
      expect(exits).to.deep.equal([]);
      expect(lines.join("")).to.contain("--- osd stopped ---").and.not.contain("start abandoned");
    } finally {
      await launcher.stop();
      rmSync(osdHome, {recursive: true, force: true});
      rmSync(storageDir, {recursive: true, force: true});
    }
  });

  it("a stop while a timed-out start is already shutting the child down: still that start's error, one SIGTERM", async () => {
    const osdHome = fakeHome();
    const armed = join(osdHome, "armed");
    const twice = join(osdHome, "twice");
    writeFileSync(join(osdHome, "test", "run.mjs"),
      "import {writeFileSync} from 'node:fs';\n" +
      "setInterval(() => {}, 1000);\n" +
      "let signals = 0;\n" +
      "process.on('SIGTERM', () => {\n" +
      `  if (++signals > 1) { writeFileSync(${JSON.stringify(twice)}, 'twice'); return; }\n` +
      "  setTimeout(() => process.exit(0), 2000);\n" +
      "});\n" +
      `writeFileSync(${JSON.stringify(armed)}, 'armed');\n`);
    const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-stop-storage-"));
    const launcher = new Launcher({osdHome, storageDir, workspaceFolders: [], timeoutMs: 800});
    const exits = [];
    const lines = [];
    launcher.on("exit", (e) => exits.push(e));
    launcher.on("log", (l) => lines.push(l));
    try {
      const starting = launcher.start();
      const failed = rejects(starting, /never answered ready/);
      for (let i = 0; !existsSync(armed) && i < 500; i++) await new Promise((r) => setTimeout(r, 10));
      // past the start's timeout, inside the child's 2 s shutdown
      await new Promise((r) => setTimeout(r, 1500));
      expect(launcher.state, "the timed-out start is still shutting down").to.equal("starting");
      await launcher.stop();
      await failed;
      expect(launcher.state).to.equal("stopped");
      expect(existsSync(twice), "one SIGTERM").to.equal(false);
      expect(exits).to.deep.equal([]);
      expect(lines.join("")).to.contain("--- osd start abandoned ---").and.not.contain("--- osd stopped ---");
    } finally {
      await launcher.stop();
      rmSync(osdHome, {recursive: true, force: true});
      rmSync(storageDir, {recursive: true, force: true});
    }
  });

  it("a child that dies while starting is start()'s error, not also an \"exit\"", async () => {
    const osdHome = fakeHome();
    writeFileSync(join(osdHome, "test", "run.mjs"), "setTimeout(() => process.exit(3), 100);\n");
    const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-stop-storage-"));
    const launcher = new Launcher({osdHome, storageDir, workspaceFolders: [], timeoutMs: 15000});
    const exits = [];
    launcher.on("exit", (e) => exits.push(e));
    try {
      await rejects(launcher.start(), /exited before it started serving \(code 3/);
      expect(exits, "one popup, not two").to.deep.equal([]);
    } finally {
      await launcher.stop();
      rmSync(osdHome, {recursive: true, force: true});
      rmSync(storageDir, {recursive: true, force: true});
    }
  });

  it("a child killed from outside is still an unexpected exit", async () => {
    const osdHome = fakeHome();
    const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-stop-storage-"));
    const launcher = new Launcher({osdHome, storageDir, workspaceFolders: [], timeoutMs: 15000});
    const exits = [];
    launcher.on("exit", (e) => exits.push(e));
    try {
      await launcher.start();
      const gone = new Promise((resolve) => launcher.once("exit", resolve));
      process.kill(launcher.pid, "SIGKILL");
      await gone;
      expect(exits).to.have.length(1);
      expect(exits[0].signal).to.equal("SIGKILL");
      expect(launcher.state).to.equal("stopped");
    } finally {
      await launcher.stop();
      rmSync(osdHome, {recursive: true, force: true});
      rmSync(storageDir, {recursive: true, force: true});
    }
  });
});

describe("editors/vscode/launcher.js: Launcher end to end (against this checkout)", function () {
  this.timeout(180000);

  it("includes inherited packs and notebook scratch while honoring warm and debug settings", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "osd-launcher-env-"));
    const badHome = mkdtempSync(join(tmpdir(), "osd-launcher-env-home-"));
    const inheritedPacks = join(storageDir, "inherited-packs");
    const oldPacks = process.env.OSD_PACKS;
    const oldWarm = process.env.OSD_WARM;
    const oldInspect = process.env.OSD_INSPECT;
    const port = await pickInspectorPort();
    const portRange = {from: port, to: port};
    process.env.OSD_PACKS = inheritedPacks;
    process.env.OSD_WARM = "1";
    process.env.OSD_INSPECT = "9229";
    const launcher = new Launcher({osdHome: badHome, storageDir, warm: "off", portRange});
    try {
      await rejects(launcher.start());
      expect(launcher.env.OSD_PACKS).to.equal([inheritedPacks, join(storageDir, "packs")].join(delimiter));
      expect(launcher.env.OSD_WARM).to.equal("0");
      expect(launcher.env).not.to.have.property("OSD_INSPECT");
      expect(existsSync(join(storageDir, "packs", "notebook-scratch", "src"))).to.equal(true);
      const debuggerLauncher = new Launcher({osdHome: badHome, storageDir, warm: "off", debug: true, portRange});
      await rejects(debuggerLauncher.start());
      expect(debuggerLauncher.env.OSD_PACKS).to.equal([inheritedPacks, join(storageDir, "packs")].join(delimiter));
      expect(debuggerLauncher.env.OSD_INSPECT).to.equal(String(debuggerLauncher.inspectPort));
      expect(debuggerLauncher.env.OSD_WORKERS).to.equal("1");
    } finally {
      if (oldPacks === undefined) delete process.env.OSD_PACKS;
      else process.env.OSD_PACKS = oldPacks;
      if (oldWarm === undefined) delete process.env.OSD_WARM;
      else process.env.OSD_WARM = oldWarm;
      if (oldInspect === undefined) delete process.env.OSD_INSPECT;
      else process.env.OSD_INSPECT = oldInspect;
      rmSync(storageDir, {recursive: true, force: true});
      rmSync(badHome, {recursive: true, force: true});
    }
  });

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
// own writable storage, keyed by seed content. A small fake seed here, never the
// real 100+ MB one -- what is under test is the copy mechanism, content-keyed
// reuse and stale-generation cleanup, not the seed's own size.
describe("editors/vscode/launcher.js: keptHomeNotice", function () {
  it("sums every old copy, including earlier generations, and formats the total", () => {
    expect(keptHomeNotice("/old/b", [{size: 512}, {size: 1024}, {size: 1024 * 1024}]))
      .to.equal("previous working copy kept at /old/b; total size of all old working copies: 1.0 MiB");
    expect(keptHomeNotice("/old/b", [{size: 512}, {size: 1024}]))
      .to.equal("previous working copy kept at /old/b; total size of all old working copies: 2 KiB");
  });
});

describe("editors/vscode/launcher.js: linkOrCopyTree / ensureMaterializedHome (packaging)", function () {
  let seedDir, storageDir, seedId;

  beforeEach(() => {
    seedDir = mkdtempSync(join(tmpdir(), "osd-seed-"));
    mkdirSync(join(seedDir, "test"), {recursive: true});
    writeFileSync(join(seedDir, "test", "run.mjs"), "// fake\n");
    writeFileSync(join(seedDir, "top.txt"), "hello");
    mkdirSync(join(seedDir, "src"), {recursive: true});
    writeFileSync(join(seedDir, "src", "zcl_materialized.clas.abap"), "CLASS zcl_materialized DEFINITION. ENDCLASS.\n");
    mkdirSync(join(seedDir, "node_modules", "x"), {recursive: true});
    writeFileSync(join(seedDir, "node_modules", "x", "index.js"), "module.exports = 1;\n");
    symlinkSync(join(seedDir, "node_modules"), join(seedDir, "output"), "dir");
    storageDir = mkdtempSync(join(tmpdir(), "osd-storage-"));
    seedId = writeSeedId(seedDir);
  });

  afterEach(() => {
    rmSync(seedDir, {recursive: true, force: true});
    rmSync(storageDir, {recursive: true, force: true});
  });

  it("concurrent first starts publish one complete archived home", async () => {
    rmSync(join(seedDir, "output"));
    seedId = writeSeedId(seedDir);
    const tar = join(storageDir, "seed.tar");
    writeTar(seedDir, tar);
    writeFileSync(join(seedDir, "seed.tar.br"), brotliCompressSync(readFileSync(tar)));
    const [first, second] = await Promise.all([
      Promise.resolve().then(() => ensureMaterializedHome(seedDir, storageDir)),
      Promise.resolve().then(() => ensureMaterializedHome(seedDir, storageDir)),
    ]);
    expect(first).to.equal(second);
    expect(readFileSync(join(first, MATERIALIZED_MARKER), "utf8").trim()).to.equal(seedId);
    expect(readFileSync(join(first, "top.txt"), "utf8")).to.equal("hello");
    expect(existsSync(join(first, ".osd-seed-files.json"))).to.equal(true);
    expect(readdirSync(storageDir).filter((name) => name.startsWith(".osd-home-extract-"))).to.deep.equal([]);
    writeFileSync(join(first, "top.txt"), "archived seed edit\n");
    const cleaned = cleanupOldHomes(storageDir, "f".repeat(64));
    expect(cleaned.removed).to.deep.equal([first]);
    expect(readFileSync(join(cleaned.saved[0], "files", "top.txt"), "utf8")).to.equal("archived seed edit\n");
  });

  function nextSeed() {
    writeFileSync(join(seedDir, "top.txt"), "new seed");
    const currentId = writeSeedId(seedDir);
    const currentHome = ensureMaterializedHome(seedDir, storageDir);
    return {currentId, currentHome};
  }

  it("deletes an unedited old home at activation and leaves the current home", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    const {currentId, currentHome} = nextSeed();
    const result = cleanupOldHomes(storageDir, currentId);
    expect(result.removed).to.deep.equal([oldHome]);
    expect(result.saved).to.deep.equal([]);
    expect(existsSync(oldHome)).to.equal(false);
    expect(existsSync(currentHome)).to.equal(true);
    expect(cleanupOldHomes(storageDir, currentId).removed).to.deep.equal([]);
  });

  it("saves an edited seed file list even when seed content is unchanged", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    const metadata = join(oldHome, ".osd-seed-files.json");
    const edited = readFileSync(metadata, "utf8").replace('"files":', '"note":"user edit","files":');
    writeFileSync(metadata, edited);
    const {currentId} = nextSeed();
    const result = cleanupOldHomes(storageDir, currentId);
    expect(result.removed).to.deep.equal([oldHome]);
    expect(result.saved).to.have.lengthOf(1);
    expect(readFileSync(join(result.saved[0], "snapshot", ".osd-seed-files.json"), "utf8")).to.equal(edited);
  });

  it("saves excluded metadata changed after quarantine before removing the home", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    const {currentId} = nextSeed();
    const result = cleanupOldHomes(storageDir, currentId, {onQuarantined: (quarantine) => {
      writeFileSync(join(quarantine, ".osd-seed-files.json"), "late metadata edit\n");
    }});
    expect(result.removed).to.deep.equal([oldHome]);
    expect(result.saved).to.have.lengthOf(1);
    expect(readFileSync(join(result.saved[0], "snapshot", ".osd-seed-files.json"), "utf8"))
      .to.equal("late metadata edit\n");
  });

  it("keeps a home whose excluded seed marker has extra content", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    writeFileSync(join(oldHome, SEED_ID_FILE), `${seedId}\nuser note\n`);
    const {currentId} = nextSeed();
    const result = cleanupOldHomes(storageDir, currentId);
    expect(result.removed).to.deep.equal([]);
    expect(existsSync(oldHome)).to.equal(true);
  });

  it("saves changed and added files and deleted paths before removing an edited home", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    writeFileSync(join(oldHome, "top.txt"), "user edit\n");
    writeFileSync(join(oldHome, "added.txt"), "added by user\n");
    rmSync(join(oldHome, "src", "zcl_materialized.clas.abap"));
    const {currentId} = nextSeed();
    const result = cleanupOldHomes(storageDir, currentId, {onSaved: (saved) => {
      expect(existsSync(oldHome)).to.equal(false);
      expect(readFileSync(join(saved, "snapshot", "top.txt"), "utf8")).to.equal("user edit\n");
    }});
    expect(result.removed).to.deep.equal([oldHome]);
    expect(result.saved).to.have.lengthOf(1);
    expect(readFileSync(join(result.saved[0], "files", "top.txt"), "utf8")).to.equal("user edit\n");
    expect(readFileSync(join(result.saved[0], "snapshot", "top.txt"), "utf8")).to.equal("user edit\n");
    expect(readFileSync(join(result.saved[0], "files", "added.txt"), "utf8")).to.equal("added by user\n");
    expect(JSON.parse(readFileSync(join(result.saved[0], "deleted.json"), "utf8")))
      .to.include("src/zcl_materialized.clas.abap");
    expect(existsSync(oldHome)).to.equal(false);
  });

  it("keeps a home with a live serving pid lock", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    writeFileSync(join(oldHome, `${SERVING_LOCK_PREFIX}${process.pid}-${lockId(1)}.lock`), `${process.pid}\n`);
    expect(hasLiveServingLock(oldHome)).to.equal(true);
    const {currentId} = nextSeed();
    expect(cleanupOldHomes(storageDir, currentId).removed).to.deep.equal([]);
    expect(existsSync(oldHome)).to.equal(true);
  });

  it("writes a launcher lock while building and removes it on stop", async () => {
    const home = ensureMaterializedHome(seedDir, storageDir);
    mkdirSync(join(home, "tools"));
    writeFileSync(join(home, "tools", "osd-build.mjs"), "setInterval(() => {}, 1000);\n");
    const launcher = new Launcher({osdHome: home, storageDir: join(storageDir, "instance"), warm: "off"});
    const starting = launcher.start();
    try {
      for (let tries = 0; launcher.buildChild === undefined && tries < 100; tries++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(launcher.buildChild).to.not.equal(undefined);
      expect(hasLiveServingLock(home)).to.equal(true);
      await launcher.stop();
      expect(await starting).to.equal(undefined);
      expect(readdirSync(home).filter((name) => name.startsWith(SERVING_LOCK_PREFIX))).to.deep.equal([]);
    } finally {
      await launcher.stop();
    }
  });

  it("ignores a stale pid lock", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    writeFileSync(join(oldHome, `${SERVING_LOCK_PREFIX}999999999-${lockId(2)}.lock`), "999999999\n");
    expect(hasLiveServingLock(oldHome)).to.equal(false);
    const {currentId} = nextSeed();
    expect(cleanupOldHomes(storageDir, currentId).removed).to.deep.equal([oldHome]);
  });

  it("keeps a home when a serving lock cannot be trusted", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    writeFileSync(join(oldHome, `${SERVING_LOCK_PREFIX}999999999-${lockId(3)}.lock`), "not a pid\n");
    const {currentId} = nextSeed();
    expect(hasLiveServingLock(oldHome)).to.equal(true);
    expect(cleanupOldHomes(storageDir, currentId).removed).to.deep.equal([]);
    expect(existsSync(oldHome)).to.equal(true);
  });

  it("keeps a home when the host died but its server child is alive", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    writeFileSync(join(oldHome, `${SERVING_LOCK_PREFIX}999999999-${lockId(4)}.lock`),
      `999999999\n${process.pid}\n`);
    const {currentId} = nextSeed();
    expect(hasLiveServingLock(oldHome)).to.equal(true);
    expect(cleanupOldHomes(storageDir, currentId).removed).to.deep.equal([]);
    expect(existsSync(oldHome)).to.equal(true);
  });

  it("ignores a two-PID lock only after both processes die", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    writeFileSync(join(oldHome, `${SERVING_LOCK_PREFIX}999999998-${lockId(7)}.lock`),
      "999999998\n999999999\n");
    const {currentId} = nextSeed();
    expect(hasLiveServingLock(oldHome)).to.equal(false);
    expect(cleanupOldHomes(storageDir, currentId).removed).to.deep.equal([oldHome]);
  });

  it("records the server child PID alongside the host PID", () => {
    const home = ensureMaterializedHome(seedDir, storageDir);
    const lock = join(home, `${SERVING_LOCK_PREFIX}${process.pid}-${lockId(6)}.lock`);
    writeFileSync(lock, `${process.pid}\n0\n`);
    setServingChildPid(lock, 12345);
    expect(readFileSync(lock, "utf8")).to.equal(`${process.pid}\n12345\n`);
  });

  it("saves a user file whose name only resembles a lock", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    writeFileSync(join(oldHome, ".osd-serving-notes"), "999999999\n");
    const {currentId} = nextSeed();
    const result = cleanupOldHomes(storageDir, currentId);
    expect(result.saved).to.have.lengthOf(1);
    expect(readFileSync(join(result.saved[0], "snapshot", ".osd-serving-notes"), "utf8")).to.equal("999999999\n");
  });

  it("restores the old path when a lock appears after quarantine", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    const {currentId} = nextSeed();
    const result = cleanupOldHomes(storageDir, currentId, {onQuarantined: (quarantine) => {
      expect(existsSync(oldHome)).to.equal(false);
      expect(() => writeFileSync(join(oldHome, "late.txt"), "late write\n")).to.throw(/ENOENT/);
      writeFileSync(join(quarantine, `${SERVING_LOCK_PREFIX}${process.pid}-${lockId(5)}.lock`),
        `${process.pid}\n`);
    }});
    expect(result.removed).to.deep.equal([]);
    expect(existsSync(oldHome)).to.equal(true);
  });

  it("restores the old path when content changes after quarantine", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    const {currentId} = nextSeed();
    const result = cleanupOldHomes(storageDir, currentId, {onQuarantined: (quarantine) => {
      expect(existsSync(oldHome)).to.equal(false);
      writeFileSync(join(quarantine, "top.txt"), "late edit\n");
    }});
    expect(result.removed).to.deep.equal([]);
    expect(readFileSync(join(oldHome, "top.txt"), "utf8")).to.equal("late edit\n");
    expect(result.saved).to.deep.equal([]);
  });

  it("keeps an edited home when saving fails", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    writeFileSync(join(oldHome, "top.txt"), "user edit\n");
    const {currentId} = nextSeed();
    writeFileSync(join(storageDir, "osd-saved-edits"), "blocks the save directory");
    const result = cleanupOldHomes(storageDir, currentId);
    expect(result.removed).to.deep.equal([]);
    expect(result.kept).to.have.lengthOf(1);
    expect(readFileSync(join(oldHome, "top.txt"), "utf8")).to.equal("user edit\n");
  });

  it("keeps a home when its content hash cannot be verified", async () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    const alias = mkdtempSync(join(tmpdir(), "osd-sock-"));
    symlinkSync(oldHome, join(alias, "home"), "dir");
    const socket = createServer();
    try {
      await new Promise((resolve, reject) => {
        socket.once("error", reject);
        socket.listen(join(alias, "home", "x.sock"), resolve);
      });
      const {currentId} = nextSeed();
      const result = cleanupOldHomes(storageDir, currentId);
      expect(result.removed).to.deep.equal([]);
      expect(result.kept).to.have.lengthOf(1);
      expect(existsSync(oldHome)).to.equal(true);
    } finally {
      if (socket.listening) await new Promise((resolve) => socket.close(resolve));
      rmSync(alias, {recursive: true, force: true});
    }
  });

  it("keeps a legacy edited home by saving a complete snapshot", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    rmSync(join(oldHome, ".osd-seed-files.json"));
    writeFileSync(join(oldHome, "top.txt"), "legacy edit\n");
    const {currentId} = nextSeed();
    const result = cleanupOldHomes(storageDir, currentId);
    expect(readFileSync(join(result.saved[0], "snapshot", "top.txt"), "utf8")).to.equal("legacy edit\n");
    expect(existsSync(oldHome)).to.equal(false);
  });

  it("linkOrCopyTree copies regular files, keeps symlinks as symlinks, and recurses into directories", () => {
    const dest = join(storageDir, "copy");
    linkOrCopyTree(seedDir, dest);
    expect(readFileSync(join(dest, "top.txt"), "utf8")).to.equal("hello");
    expect(readFileSync(join(dest, "node_modules", "x", "index.js"), "utf8")).to.include("module.exports");
    expect(lstatSync(join(dest, "output")).isSymbolicLink()).to.equal(true);
    expect(readlinkSync(join(dest, "output"))).to.equal(join(seedDir, "node_modules"));
    // The writable materialized home must not share an inode with the seed.
    const a = statSync(join(seedDir, "top.txt"));
    const b = statSync(join(dest, "top.txt"));
    expect(a.ino).to.not.equal(b.ino);
  });

  it("Workbench object-store saves in the materialized home leave the seed and its ID unchanged", () => {
    const home = ensureMaterializedHome(seedDir, storageDir);
    const source = "CLASS zcl_materialized DEFINITION.\nENDCLASS.\n* Workbench edit\n";
    const store = new ObjectStore({
      root: home,
      roots: [{path: "src", writable: true, library: false}],
      libs: [],
      excluded: [],
    });

    // The ADT source PUT handler delegates to ObjectStore.write(), whose
    // writeFileSync replaces the source in place (not through rename).
    store.write("CLAS", "ZCL_MATERIALIZED", source);

    expect(readFileSync(join(home, "src", "zcl_materialized.clas.abap"), "utf8")).to.equal(source);
    expect(readFileSync(join(seedDir, "src", "zcl_materialized.clas.abap"), "utf8"))
      .to.equal("CLASS zcl_materialized DEFINITION. ENDCLASS.\n");
    expect(seedContentId(seedDir)).to.equal(seedId);
    expect(readFileSync(join(seedDir, SEED_ID_FILE), "utf8").trim()).to.equal(seedId);
  });

  it("materializedHomeDir is keyed by the seed's content ID under globalStorageDir", () => {
    expect(materializedHomeDir(storageDir, seedId)).to.equal(join(storageDir, `osd-home-${seedId}`));
    expect(seedId).to.match(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(seedDir, SEED_ID_FILE), "utf8").trim()).to.equal(seedId);
  });

  it("ensureMaterializedHome reuses a copy only while the packaged seed ID matches", () => {
    const target = ensureMaterializedHome(seedDir, storageDir);
    expect(target).to.equal(join(storageDir, `osd-home-${seedId}`));
    expect(existsSync(join(target, "top.txt"))).to.equal(true);
    expect(readFileSync(join(target, MATERIALIZED_MARKER), "utf8").trim()).to.equal(seedId);

    // add to the seed after the first materialize: a second call must NOT
    // pick it up, because the marker says "already done for this seed ID"
    // (a hard link shares content with a file mutated in place, so a NEW
    // file is what proves "no second copy happened" -- an edited existing
    // one would prove nothing either way)
    writeFileSync(join(seedDir, "added-later.txt"), "should not appear");
    const again = ensureMaterializedHome(seedDir, storageDir);
    expect(again).to.equal(target);
    expect(existsSync(join(target, "added-later.txt"))).to.equal(false);
  });

  it("A-to-B-to-A keeps every home at its original path, including clean homes", () => {
    const firstId = seedId;
    const firstHome = ensureMaterializedHome(seedDir, storageDir);
    writeFileSync(join(firstHome, "top.txt"), "edit in A");

    writeFileSync(join(seedDir, "top.txt"), "seed B");
    const secondId = writeSeedId(seedDir);
    const notices = [];
    const secondHome = ensureMaterializedHome(seedDir, storageDir, {
      previousHome: firstHome, onNotice: (line) => notices.push(line),
    });
    expect(secondHome).to.equal(join(storageDir, `osd-home-${secondId}`));
    expect(readFileSync(join(firstHome, "top.txt"), "utf8")).to.equal("edit in A");
    expect(readFileSync(join(secondHome, "top.txt"), "utf8")).to.equal("seed B");
    expect(notices).to.deep.equal([keptHomeNotice(firstHome, listOldHomes(storageDir, secondHome))]);

    // A third seed does not remove an unedited B or the older edited A.
    writeFileSync(join(seedDir, "top.txt"), "seed C");
    writeSeedId(seedDir);
    const thirdHome = ensureMaterializedHome(seedDir, storageDir, {previousHome: secondHome});
    expect(readFileSync(join(secondHome, "top.txt"), "utf8")).to.equal("seed B");
    expect(readFileSync(join(firstHome, "top.txt"), "utf8")).to.equal("edit in A");

    writeFileSync(join(seedDir, "top.txt"), "hello");
    expect(writeSeedId(seedDir)).to.equal(firstId);
    const returnedHome = ensureMaterializedHome(seedDir, storageDir, {
      previousHome: thirdHome, onNotice: (line) => notices.push(line),
    });
    expect(returnedHome).to.equal(firstHome);
    expect(readFileSync(join(firstHome, "top.txt"), "utf8")).to.equal("edit in A");
    expect(readFileSync(join(secondHome, "top.txt"), "utf8")).to.equal("seed B");
    expect(readFileSync(join(thirdHome, "top.txt"), "utf8")).to.equal("seed C");
    expect(notices.at(-1)).to.equal(keptHomeNotice(thirdHome, listOldHomes(storageDir, returnedHome)));
    expect(readdirSync(storageDir).filter((name) => name.startsWith("osd-home-"))).to.have.lengthOf(3);
  });

  it("a save through a previous home's path still succeeds after a seed change", () => {
    const oldHome = ensureMaterializedHome(seedDir, storageDir);
    const store = new ObjectStore({
      root: oldHome, roots: [{path: "src", writable: true, library: false}], libs: [], excluded: [],
    });
    writeFileSync(join(seedDir, "top.txt"), "next seed");
    writeSeedId(seedDir);
    ensureMaterializedHome(seedDir, storageDir);
    store.write("CLAS", "ZCL_MATERIALIZED", "* save after reinstall\n");
    expect(readFileSync(join(oldHome, "src", "zcl_materialized.clas.abap"), "utf8"))
      .to.equal("* save after reinstall\n");
  });

  it("lists old homes with size and edited state, and selects only confirmed stale paths", () => {
    const firstHome = ensureMaterializedHome(seedDir, storageDir);
    const firstSize = listOldHomes(storageDir, "/outside/current")[0].size;
    expect(firstSize).to.be.greaterThan(0);
    writeFileSync(join(seedDir, "top.txt"), "seed B");
    writeSeedId(seedDir);
    const secondHome = ensureMaterializedHome(seedDir, storageDir);
    const homes = listOldHomes(storageDir, secondHome);
    expect(homes).to.have.lengthOf(1);
    expect(homes[0]).to.include({path: firstHome, size: firstSize, edited: false});
    writeFileSync(join(firstHome, "top.txt"), "edited A");
    expect(listOldHomes(storageDir, secondHome)[0].edited).to.equal(true);

    const entries = [firstHome, secondHome, join(storageDir, "osd-home-previous")]
      .map((home) => ({path: home, isDirectory: true}));
    const selected = selectOldHomes(entries, secondHome, firstHome, [firstHome, secondHome]);
    expect(selected).to.deep.equal([]); // A is served; B is current.
    expect(selectOldHomes(entries, secondHome, undefined, [firstHome, secondHome])
      .map(({path}) => path)).to.deep.equal([firstHome]);
    expect(selectOldHomes([...entries, {path: join(storageDir, "osd-home-other"), isDirectory: true}],
      secondHome, undefined).map(({path}) => path)).to.deep.equal([firstHome, join(storageDir, "osd-home-previous")]);
  });

  it("leaves older recovery directories in place and refuses a conflicting current home", () => {
    const legacy = join(storageDir, "osd-home-previous");
    mkdirSync(legacy);
    writeFileSync(join(legacy, "top.txt"), "old recovery");
    const target = materializedHomeDir(storageDir, seedId);
    mkdirSync(target);
    writeFileSync(join(target, "top.txt"), "unmarked user data");
    expect(() => ensureMaterializedHome(seedDir, storageDir)).to.throw(/no matching seed marker/);
    expect(readFileSync(join(target, "top.txt"), "utf8")).to.equal("unmarked user data");
    expect(readFileSync(join(legacy, "top.txt"), "utf8")).to.equal("old recovery");
  });
});

describe("layerContributions: DDIC counts", function () {
  it("counts a search help as a DDIC object of a workspace pack", function () {
    const {layerContributions} = createRequire(import.meta.url)("../editors/vscode/launcher.js");
    const folder = mkdtempSync(join(tmpdir(), "osd-layer-ddic-"));
    try {
      mkdirSync(join(folder, "src", "ddic"), {recursive: true});
      writeFileSync(join(folder, "osd-pack.json"), JSON.stringify({name: "ddic-count", abap: "src", ddic: "src/ddic"}));
      writeFileSync(join(folder, "src", "ddic", "zx_row.tabl.xml"), "<x/>");
      writeFileSync(join(folder, "src", "ddic", "zx_row_sh.shlp.xml"), "<x/>");
      const counts = layerContributions({folder, manifest: join(folder, "osd-pack.json"), srcDir: join(folder, "src")});
      expect(counts.ddic).to.equal(2);
    } finally { rmSync(folder, {recursive: true, force: true}); }
  });
});
