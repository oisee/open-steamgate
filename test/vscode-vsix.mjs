// The packaging proof (docs/vscode-extension.md, "Packaging"): the .vsix
// `npm run vsix` writes really installs and runs OUTSIDE this checkout --
// unzipped into a scratch folder, run with `osd.home` unset (the packaged
// path, not the dev one) and a scratch storage directory standing in for
// `context.globalStorageUri`. Every package build uses its own scratch output.
//
// Scratch defaults to ~/.cache/osd-vsix-test (outside the checkout, never
// `/tmp`, a small tmpfs on this box) and is removed again at the end; the workspace layer
// fixture (`.local/b0-demo-ws/`, named in docs/vscode-extension.md's own
// "Live smoke") is created once if missing and left there, since it is
// gitignored scratch by design and other sessions may reuse it.
import {expect} from "chai";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, lstatSync, symlinkSync, readdirSync} from "node:fs";
import {basename, join} from "node:path";
import {homedir, tmpdir} from "node:os";
import {createReadStream} from "node:fs";
import {brotliDecompressSync} from "node:zlib";
import {buildVsix, stampStagedPackage} from "../scripts/build-vsix.mjs";
const {writeTar, unpackTar} = createRequire(import.meta.url)("../editors/vscode/launcher.js");

const root = process.cwd();
const trackedVersion = JSON.parse(readFileSync(join(root, "editors", "vscode", "package.json"), "utf8")).version;
const versionParts = /^(\d+)\.(\d+)\.\d+$/.exec(trackedVersion);
if (versionParts === null) throw new Error(`expected a plain major.minor.patch version, got ${trackedVersion}`);
const commitCount = execFileSync("git", ["rev-list", "--count", "HEAD"], {cwd: root, encoding: "utf8"}).trim();
const currentVsixFile = `osd-vscode-${versionParts[1]}.${versionParts[2]}.${commitCount}.vsix`;

function packagedPacks(archive) {
  expect(execFileSync("unzip", ["-Z1", archive], {encoding: "utf8"})).to.contain("extension/osd/seed.tar.br");
  const compressed = execFileSync("unzip", ["-p", archive, "extension/osd/seed.tar.br"], {maxBuffer: 32 * 1024 * 1024});
  const entries = execFileSync("tar", ["-tf", "-"], {
    input: brotliDecompressSync(compressed), encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  return [...new Set(entries.split("\n").map((entry) => /^packs\/([^/]+)\//.exec(entry)?.[1])
    .filter((name) => name !== undefined))].sort();
}

const DEMO_WS = join(root, ".local", "b0-demo-ws");
// **Outside the checkout, on purpose.** A scratch folder under this tree
// resolves a bare import by walking up into the checkout's own node_modules,
// so a package the .vsix forgot (js-yaml, found by the first real install,
// 2026-09-26) still loads here and the test is green for a package that fails
// in a user's globalStorage. Not /tmp either: it is a small tmpfs.
const SCRATCH = join(process.env.OSD_VSIX_SCRATCH ?? join(homedir(), ".cache", "osd-vsix-test"));
function testScratch(name) {
  mkdirSync(SCRATCH, {recursive: true});
  return mkdtempSync(join(SCRATCH, `${name}-`));
}
function buildTestVsix(outputDir, env = {}) {
  return buildVsix({...env, OSD_VSIX_BROTLI_QUALITY: "4"}, outputDir);
}
beforeEach(function () {
  this.currentTest.vsixStartedAt = performance.now();
});
afterEach(function () {
  console.log(`vsix test wall: ${this.currentTest.fullTitle()} ${((performance.now() - this.currentTest.vsixStartedAt) / 1000).toFixed(3)} s`);
});

describe("seed tar", function () {
  it("round-trips a long path and executable mode", async function () {
    const scratch = mkdtempSync(join(tmpdir(), "osd-tar-"));
    try {
      const source = join(scratch, "source");
      const dest = join(scratch, "dest");
      const name = `${"long/".repeat(24)}run.sh`;
      mkdirSync(join(source, "long/".repeat(24)), {recursive: true});
      writeFileSync(join(source, name), "#!/bin/sh\nexit 0\n", {mode: 0o755});
      const tar = join(scratch, "seed.tar");
      writeTar(source, tar);
      mkdirSync(dest);
      await unpackTar(createReadStream(tar), dest);
      expect(readFileSync(join(dest, name), "utf8")).to.equal("#!/bin/sh\nexit 0\n");
      expect(lstatSync(join(dest, name)).mode & 0o777).to.equal(0o755);
    } finally { rmSync(scratch, {recursive: true, force: true}); }
  });

  it("rejects traversal before writing outside the destination", async function () {
    const scratch = mkdtempSync(join(tmpdir(), "osd-tar-"));
    try {
      const source = join(scratch, "source");
      mkdirSync(source);
      writeFileSync(join(source, "safe"), "bad");
      const tar = join(scratch, "seed.tar");
      writeTar(source, tar);
      const bytes = readFileSync(tar);
      bytes.fill(0, 0, 100);
      bytes.write("../escaped", 0);
      bytes.fill(32, 148, 156);
      const sum = bytes.subarray(0, 512).reduce((total, byte) => total + byte, 0);
      bytes.write(`${sum.toString(8).padStart(6, "0")}\0`, 148);
      const dest = join(scratch, "dest");
      mkdirSync(dest);
      let error;
      try { await unpackTar([bytes], dest); } catch (caught) { error = caught; }
      expect(error?.message).to.match(/unsafe tar path/);
      expect(existsSync(join(scratch, "escaped"))).to.equal(false);
    } finally { rmSync(scratch, {recursive: true, force: true}); }
  });

  it("closes an extracted file when the tar stream ends mid-file", async function () {
    if (!existsSync("/proc/self/fd")) this.skip();
    const scratch = mkdtempSync(join(tmpdir(), "osd-tar-truncated-"));
    try {
      const source = join(scratch, "source");
      const dest = join(scratch, "dest");
      mkdirSync(source);
      mkdirSync(dest);
      writeFileSync(join(source, "partial.txt"), "abcdef");
      const tar = join(scratch, "seed.tar");
      writeTar(source, tar);
      const before = readdirSync("/proc/self/fd").length;
      let error;
      try { await unpackTar([readFileSync(tar).subarray(0, 515)], dest); } catch (caught) { error = caught; }
      expect(error?.message).to.match(/truncated tar archive/);
      expect(readdirSync("/proc/self/fd").length).to.equal(before);
    } finally { rmSync(scratch, {recursive: true, force: true}); }
  });
});

describe("packaging version stamp", function () {
  it("stamps the staged package with the commit count and leaves the tracked package untouched", function () {
    const trackedPath = join(root, "editors", "vscode", "package.json");
    const trackedBefore = readFileSync(trackedPath, "utf8");
    const [major, minor] = JSON.parse(trackedBefore).version.split(".");
    const scratch = mkdtempSync(join(tmpdir(), "osd-vsix-version-"));
    try {
      const stagedPath = join(scratch, "package.json");
      copyFileSync(trackedPath, stagedPath);
      const {pkg} = stampStagedPackage(stagedPath, root);
      const commitCount = execFileSync("git", ["rev-list", "--count", "HEAD"], {cwd: root, encoding: "utf8"}).trim();
      expect(pkg.version).to.equal(`${major}.${minor}.${commitCount}`);
      expect(JSON.parse(readFileSync(stagedPath, "utf8")).version).to.equal(pkg.version);
      expect(readFileSync(trackedPath, "utf8")).to.equal(trackedBefore);
    } finally {
      rmSync(scratch, {recursive: true, force: true});
    }
  });
});

describe("packaging changed seed content", function () {
  this.timeout(240000);

  it("packages twice at one stamped version and rematerializes the second seed", async function () {
    const scratch = testScratch("repackage");
    const sourceName = `.vsix-package-test-${process.pid}-${Date.now()}`;
    const sourceFile = join(root, "src", sourceName);
    const linkName = `${sourceName}-link`;
    const sourceLink = join(root, "src", linkName);
    const firstArchive = join(scratch, "first.vsix");
    const firstUnzip = join(scratch, "first");
    const secondUnzip = join(scratch, "second");
    const globalStorage = join(scratch, "globalStorage");
    try {
      writeFileSync(sourceFile, "first packaged seed content\n");
      // npm's local transpiler build also contains .bin symlinks. Make the
      // archive/hash disagreement reproducible even with published packages.
      symlinkSync(sourceName, sourceLink);
      const first = await buildTestVsix(join(scratch, "first-build"));
      copyFileSync(first.out, firstArchive);

      writeFileSync(sourceFile, "second packaged seed content\n");
      const second = await buildTestVsix(join(scratch, "second-build"));

      expect(second.pkg.version).to.equal(first.pkg.version);
      expect(basename(first.out)).to.equal(currentVsixFile);
      expect(basename(second.out)).to.equal(currentVsixFile);
      expect(readFileSync(join(scratch, "second-build", "stage", "extension", "package.json"), "utf8"))
        .to.contain(`"version": "${second.pkg.version}"`);
      execFileSync("unzip", ["-q", firstArchive, "-d", firstUnzip]);
      execFileSync("unzip", ["-q", second.out, "-d", secondUnzip]);

      const firstExtension = join(firstUnzip, "extension");
      const secondExtension = join(secondUnzip, "extension");
      const firstLauncher = createRequire(import.meta.url)(join(firstExtension, "launcher.js"));
      const secondLauncher = createRequire(import.meta.url)(join(secondExtension, "launcher.js"));
      const firstSeed = join(firstExtension, "osd");
      const secondSeed = join(secondExtension, "osd");
      const seedFile = join("src", sourceName);
      const seedLink = join("src", linkName);
      expect(lstatSync(join(scratch, "second-build", "seed-stage", seedLink)).isFile(),
        "staged symlinks must have the same file type as the archive").to.equal(true);

      const firstHome = await firstLauncher.ensureMaterializedHome(firstSeed, globalStorage);
      const secondHome = await secondLauncher.ensureMaterializedHome(secondSeed, globalStorage);
      const firstId = firstLauncher.seedContentId(firstHome);
      const secondId = secondLauncher.seedContentId(secondHome);
      expect(secondId).to.not.equal(firstId);
      expect(readFileSync(join(firstSeed, firstLauncher.SEED_ID_FILE), "utf8").trim()).to.equal(firstId);
      expect(readFileSync(join(secondSeed, secondLauncher.SEED_ID_FILE), "utf8").trim()).to.equal(secondId);
      expect(readFileSync(join(firstHome, seedFile), "utf8")).to.equal("first packaged seed content\n");
      expect(readFileSync(join(secondHome, seedFile), "utf8")).to.equal("second packaged seed content\n");
      expect(readFileSync(join(firstHome, seedLink), "utf8")).to.equal("first packaged seed content\n");
      expect(readFileSync(join(secondHome, seedLink), "utf8")).to.equal("second packaged seed content\n");
      expect(readFileSync(join(firstHome, seedFile), "utf8")).to.equal("first packaged seed content\n");
      writeFileSync(join(firstHome, seedFile), "user edit in the first materialized home\n");
      expect(secondHome).to.not.equal(firstHome);
      expect(readFileSync(join(secondHome, seedFile), "utf8")).to.equal("second packaged seed content\n");
      expect(lstatSync(firstHome).isDirectory(), "the old write path stays available").to.equal(true);
      expect(readFileSync(join(firstHome, seedFile), "utf8")).to.equal("user edit in the first materialized home\n");

    } finally {
      rmSync(sourceFile, {force: true});
      rmSync(sourceLink, {force: true});
      rmSync(scratch, {recursive: true, force: true});
    }
  });
});

describe("packaging selected packs", function () {
  this.timeout(240000);

  it("builds a Zork-only archive without checkout gen/", async function () {
    const gen = join(root, "gen");
    const scratch = mkdtempSync(join(root, ".local", "vsix-hidden-gen-"));
    const outputDir = testScratch("hidden-gen-build");
    const hidden = join(scratch, "gen");
    const hadGen = existsSync(gen);
    if (hadGen) renameSync(gen, hidden);
    try {
      const {out} = await buildTestVsix(outputDir);
      expect(packagedPacks(out)).to.deep.equal(["zork"]);
    } finally {
      if (hadGen) renameSync(hidden, gen);
      rmSync(scratch, {recursive: true, force: true});
      rmSync(outputDir, {recursive: true, force: true});
    }
  });

  it("ships only zork by default and adds named packs with OSD_VSIX_PACKS", async function () {
    const saved = testScratch("selected-packs");
    try {
      const defaultBuild = await buildTestVsix(join(saved, "default-build"));
      expect(packagedPacks(defaultBuild.out)).to.deep.equal(["zork"]);
      const defaultArchive = join(saved, "default.vsix");
      copyFileSync(defaultBuild.out, defaultArchive);

      const expandedBuild = await buildTestVsix(join(saved, "expanded-build"), {OSD_VSIX_PACKS: " zork, lsd "});
      expect(packagedPacks(expandedBuild.out)).to.deep.equal(["lsd", "zork"]);
      expect(packagedPacks(defaultArchive)).to.deep.equal(["zork"]);
    } finally {
      rmSync(saved, {recursive: true, force: true});
    }
  });

  it("checks fetched sources only for selected packs", async function () {
    const name = `vsix-guard-${process.pid}`;
    const packDir = join(root, "packs", name);
    const scratch = testScratch("pack-guard");
    mkdirSync(packDir);
    try {
      writeFileSync(join(packDir, "osd-pack.json"), JSON.stringify({
        name, sources: [{folder: "upstream", repo: "https://example.invalid/missing", ref: "main"}],
      }));
      const defaultBuild = await buildTestVsix(join(scratch, "default-build"));
      expect(packagedPacks(defaultBuild.out)).to.deep.equal(["zork"]);

      let error;
      try {
        await buildTestVsix(join(scratch, "invalid-build"), {OSD_VSIX_PACKS: name});
      } catch (caught) {
        error = caught;
      }
      expect(error?.message).to.contain(`pack ${name} fetches upstream`);
    } finally {
      rmSync(packDir, {recursive: true, force: true});
      rmSync(scratch, {recursive: true, force: true});
    }
  });
});

/** `.local/b0-demo-ws/src/zcl_b0_hello.clas.abap`: a workspace-layer fixture
 *  shaped like the one docs/vscode-extension.md's "Live smoke" describes by
 *  hand -- one abapGit-looking class implementing IF_OO_ADT_CLASSRUN, so
 *  `detectWorkspaceLayers` (editors/vscode/launcher.js) picks the folder up
 *  and classrun has something of the workspace's own to run. No `.clas.xml`
 *  sidecar: src/classrun/*.clas.abap in this same tree has none either, so
 *  it is not needed for a bare-tree transpile. */
function ensureDemoWorkspace() {
  const file = join(DEMO_WS, "src", "zcl_b0_hello.clas.abap");
  if (existsSync(file)) {
    return;
  }
  mkdirSync(join(DEMO_WS, "src"), {recursive: true});
  writeFileSync(file, `CLASS zcl_b0_hello DEFINITION PUBLIC CREATE PUBLIC.
* test/vscode-vsix.mjs's own fixture (docs/vscode-extension.md's "Live
* smoke"): a workspace layer with one classrun-able class.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_b0_hello IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    out->write( 'hello from the B0 workspace layer' ).
  ENDMETHOD.
ENDCLASS.
`);
}

describe("packaging: the .vsix installs and runs outside this checkout (docs/vscode-extension.md, Packaging)", function () {
  this.timeout(240000);

  let launcher, port, unzipDir, storageDir, globalStorageDir, osdHome, LauncherClass, scratch;

  before(async function () {
    const setupStart = performance.now();
    ensureDemoWorkspace();

    scratch = testScratch("live-smoke");
    const {out} = await buildTestVsix(join(scratch, "build"));
    unzipDir = join(scratch, "unzipped");
    execFileSync("unzip", ["-q", out, "-d", unzipDir]);

    const extensionDir = join(unzipDir, "extension");
    const packagedVersion = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8")).version;
    expect(basename(out)).to.equal(`osd-vscode-${packagedVersion}.vsix`);
    expect(readFileSync(join(unzipDir, "extension.vsixmanifest"), "utf8"))
      .to.contain(`Version="${packagedVersion}"`);
    const {Launcher, ensureMaterializedHome, seedContentId, SEED_ID_FILE} = createRequire(import.meta.url)(join(extensionDir, "launcher.js"));
    const seedDir = join(extensionDir, "osd");
    expect(existsSync(join(seedDir, "seed.tar.br")), "the .vsix carries a seed archive").to.equal(true);
    expect(existsSync(join(seedDir, "gen")), "the seed must not carry generated files from excluded packs").to.equal(false);
    // hdb and @abaplint/database-pg (-> pg) travel with the package (both
    // pure JS, docs/vscode-extension.md "Packaging"); the native DuckDB
    // module does not, on purpose.
    const seedId = readFileSync(join(seedDir, SEED_ID_FILE), "utf8").trim();

    globalStorageDir = join(scratch, "globalStorage"); // stands in for context.globalStorageUri
    // osd.home unset: this is the packaged path, materializing the bundled
    // seed rather than pointing at a dev checkout.
    const unpackStart = performance.now();
    osdHome = await ensureMaterializedHome(seedDir, globalStorageDir);
    console.log(`vsix cold unpack: ${((performance.now() - unpackStart) / 1000).toFixed(2)} s`);
    expect(seedId, "the packaged ID matches the unpacked seed content").to.equal(seedContentId(osdHome));
    expect(existsSync(join(osdHome, "test", "run.mjs"))).to.equal(true);
    expect(existsSync(join(osdHome, "node_modules", "hdb"))).to.equal(true);
    expect(existsSync(join(osdHome, "node_modules", "@abaplint", "database-pg"))).to.equal(true);
    expect(existsSync(join(osdHome, "node_modules", "@duckdb"))).to.equal(false);
    expect(osdHome).to.equal(join(globalStorageDir, `osd-home-${seedId}`));
    expect(osdHome).to.not.equal(seedDir, "the launcher must run the materialized copy, never the install folder");
    LauncherClass = Launcher;

    storageDir = join(scratch, "instance-storage"); // stands in for storageDirFor()
    launcher = new Launcher({osdHome, storageDir, workspaceFolders: [DEMO_WS], timeoutMs: 180000});
    const result = await launcher.start();
    port = result.port;
    expect(existsSync(join(osdHome, "gen", "stg", "zvdb_100")),
      "the first build must not regenerate an excluded pack's service").to.equal(false);
    console.log(`vsix live setup wall: ${((performance.now() - setupStart) / 1000).toFixed(3)} s`);
  });

  after(async function () {
    const pid = launcher?.pid;
    if (launcher !== undefined) {
      await launcher.stop();
    }
    if (pid !== undefined) {
      expect(() => process.kill(pid, 0), "no process left running after stop()").to.throw();
    }
    if (scratch !== undefined) rmSync(scratch, {recursive: true, force: true});
  });

  it("TravelSet answers over the materialized, out-of-repo copy", async function () {
    const res = await fetch(`http://localhost:${port}/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$format=json`);
    expect(res.status).to.equal(200);
    const body = await res.json();
    expect(body.d.results.length).to.be.at.least(1);
  });

  it("serves the launchpad and returns only bundled pack tiles", async function () {
    const base = `http://localhost:${port}`;
    const front = await fetch(`${base}/`, {redirect: "manual"});
    expect(front.status).to.equal(302);
    expect(front.headers.get("location")).to.equal("/app/flp.html");
    const page = await fetch(`${base}/app/flp.html`);
    expect(page.status).to.equal(200);
    expect(await page.text()).to.contain("open-steamgate demo: launchpad");
    const tiles = await fetch(`${base}/app/packs.json`);
    expect(tiles.status).to.equal(200);
    const expected = JSON.parse(readFileSync(join(osdHome, "packs", "zork", "osd-pack.json"), "utf8")).tiles ?? [];
    const actual = (await tiles.json()).tiles;
    expect(actual).to.have.length(expected.length);
    expect(actual.every((tile) => tile.pack === "zork")).to.equal(true);
  });

  it("osd.database.system = duckdb refuses with a plain sentence, in a packaged install", async function () {
    const duckLauncher = new LauncherClass({
      osdHome, storageDir: join(scratch, "duckdb-instance-storage"),
      workspaceFolders: [], database: {kind: "duckdb"},
    });
    let error;
    try {
      await duckLauncher.start();
    } catch (e) {
      error = e;
    }
    expect(error?.message).to.equal("DuckDB needs the native module; not in this package");
  });

  it("classrun of the workspace layer's ZCL_B0_HELLO prints", async function () {
    const base = `http://localhost:${port}/sap/bc/adt`;
    const discover = await fetch(`${base}/core/discovery`, {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
    const token = discover.headers.get("x-csrf-token");
    const context = (discover.headers.getSetCookie?.() ?? []).join("; ").match(/sap-contextid=([^;]+)/)?.[1];

    const res = await fetch(`${base}/oo/classrun/ZCL_B0_HELLO`, {
      method: "POST",
      headers: {cookie: `sap-contextid=${context}`, "x-csrf-token": token, "x-sap-adt-sessiontype": "stateful"},
    });
    expect(res.status).to.equal(200);
    const text = await res.text();
    expect(text).to.contain("hello from the B0 workspace layer");
  });
});
