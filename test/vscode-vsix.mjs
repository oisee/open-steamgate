// The packaging proof (docs/vscode-extension.md, "Packaging"): the .vsix
// `npm run vsix` writes really installs and runs OUTSIDE this checkout --
// unzipped into a scratch folder, run with `osd.home` unset (the packaged
// path, not the dev one) and a scratch storage directory standing in for
// `context.globalStorageUri`. Skipped, not failed, when `build/vsix` was
// never built (`npm run vsix` first) -- the same shape `test/osd-binary.mjs`
// already uses for the compiled binary.
//
// Scratch defaults to ~/.cache/osd-vsix-test (outside the checkout, never
// `/tmp`, a small tmpfs on this box) and is removed again at the end; the workspace layer
// fixture (`.local/b0-demo-ws/`, named in docs/vscode-extension.md's own
// "Live smoke") is created once if missing and left there, since it is
// gitignored scratch by design and other sessions may reuse it.
import {expect} from "chai";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, lstatSync, symlinkSync} from "node:fs";
import {basename, join} from "node:path";
import {homedir, tmpdir} from "node:os";
import {buildVsix, stampStagedPackage} from "../scripts/build-vsix.mjs";

const root = process.cwd();
const VSIX_DIR = join(root, "build", "vsix");
const trackedVersion = JSON.parse(readFileSync(join(root, "editors", "vscode", "package.json"), "utf8")).version;
const versionParts = /^(\d+)\.(\d+)\.\d+$/.exec(trackedVersion);
if (versionParts === null) throw new Error(`expected a plain major.minor.patch version, got ${trackedVersion}`);
const commitCount = execFileSync("git", ["rev-list", "--count", "HEAD"], {cwd: root, encoding: "utf8"}).trim();
const currentVsixFile = `osd-vscode-${versionParts[1]}.${versionParts[2]}.${commitCount}.vsix`;
let builtVsix = existsSync(join(VSIX_DIR, currentVsixFile)) ? currentVsixFile : undefined;
let built = builtVsix !== undefined;

function packagedPacks(archive) {
  const entries = execFileSync("unzip", ["-Z1", archive], {encoding: "utf8"});
  return [...new Set(entries.split("\n").map((entry) => /^extension\/osd\/packs\/([^/]+)\//.exec(entry)?.[1])
    .filter((name) => name !== undefined))].sort();
}

const DEMO_WS = join(root, ".local", "b0-demo-ws");
// **Outside the checkout, on purpose.** A scratch folder under this tree
// resolves a bare import by walking up into the checkout's own node_modules,
// so a package the .vsix forgot (js-yaml, found by the first real install,
// 2026-09-26) still loads here and the test is green for a package that fails
// in a user's globalStorage. Not /tmp either: it is a small tmpfs.
const SCRATCH = join(process.env.OSD_VSIX_SCRATCH ?? join(homedir(), ".cache", "osd-vsix-test"));

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
    mkdirSync(SCRATCH, {recursive: true});
    const scratch = mkdtempSync(join(SCRATCH, "repackage-"));
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
      const first = await buildVsix();
      copyFileSync(first.out, firstArchive);

      writeFileSync(sourceFile, "second packaged seed content\n");
      const second = await buildVsix();

      expect(second.pkg.version).to.equal(first.pkg.version);
      expect(basename(first.out)).to.equal(currentVsixFile);
      expect(basename(second.out)).to.equal(currentVsixFile);
      expect(readFileSync(join(VSIX_DIR, "stage", "extension", "package.json"), "utf8"))
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
      expect(readFileSync(join(firstSeed, seedFile), "utf8")).to.equal("first packaged seed content\n");
      expect(readFileSync(join(secondSeed, seedFile), "utf8")).to.equal("second packaged seed content\n");
      expect(readFileSync(join(firstSeed, seedLink), "utf8")).to.equal("first packaged seed content\n");
      expect(readFileSync(join(secondSeed, seedLink), "utf8")).to.equal("second packaged seed content\n");
      expect(lstatSync(join(VSIX_DIR, "stage", "extension", "osd", seedLink)).isFile(),
        "staged symlinks must have the same file type as the archive").to.equal(true);

      const firstId = firstLauncher.seedContentId(firstSeed);
      const secondId = secondLauncher.seedContentId(secondSeed);
      expect(secondId).to.not.equal(firstId);
      expect(readFileSync(join(firstSeed, firstLauncher.SEED_ID_FILE), "utf8").trim()).to.equal(firstId);
      expect(readFileSync(join(secondSeed, secondLauncher.SEED_ID_FILE), "utf8").trim()).to.equal(secondId);

      const firstHome = firstLauncher.ensureMaterializedHome(firstSeed, globalStorage);
      expect(readFileSync(join(firstHome, seedFile), "utf8")).to.equal("first packaged seed content\n");
      writeFileSync(join(firstHome, seedFile), "user edit in the first materialized home\n");
      const secondHome = secondLauncher.ensureMaterializedHome(secondSeed, globalStorage);
      expect(secondHome).to.not.equal(firstHome);
      expect(readFileSync(join(secondHome, seedFile), "utf8")).to.equal("second packaged seed content\n");
      expect(lstatSync(firstHome).isDirectory(), "the old write path stays available").to.equal(true);
      expect(readFileSync(join(firstHome, seedFile), "utf8")).to.equal("user edit in the first materialized home\n");

      builtVsix = currentVsixFile;
      built = true;
    } finally {
      rmSync(sourceFile, {force: true});
      rmSync(sourceLink, {force: true});
      rmSync(scratch, {recursive: true, force: true});
    }

    // Leave the normal build artifact for the out-of-checkout smoke below.
    // The two packages above deliberately contain the temporary source file.
    const canonical = await buildVsix();
    expect(basename(canonical.out)).to.equal(currentVsixFile);
    builtVsix = basename(canonical.out);
    built = true;
  });
});

describe("packaging selected packs", function () {
  this.timeout(240000);

  it("builds a Zork-only archive without checkout gen/", async function () {
    const gen = join(root, "gen");
    const scratch = mkdtempSync(join(root, ".local", "vsix-hidden-gen-"));
    const hidden = join(scratch, "gen");
    const hadGen = existsSync(gen);
    if (hadGen) renameSync(gen, hidden);
    try {
      const {out} = await buildVsix({});
      expect(packagedPacks(out)).to.deep.equal(["zork"]);
    } finally {
      if (hadGen) renameSync(hidden, gen);
      rmSync(scratch, {recursive: true, force: true});
    }
  });

  it("ships only zork by default and adds named packs with OSD_VSIX_PACKS", async function () {
    const originalPacks = process.env.OSD_VSIX_PACKS;
    try {
      const defaultBuild = await buildVsix({});
      expect(packagedPacks(defaultBuild.out)).to.deep.equal(["zork"]);

      process.env.OSD_VSIX_PACKS = " zork, lsd ";
      const expandedBuild = await buildVsix();
      expect(packagedPacks(expandedBuild.out)).to.deep.equal(["lsd", "zork"]);
    } finally {
      if (originalPacks === undefined) delete process.env.OSD_VSIX_PACKS;
      else process.env.OSD_VSIX_PACKS = originalPacks;
      // The live smoke below must start from the default artifact.
      const canonical = await buildVsix({});
      builtVsix = basename(canonical.out);
      built = true;
    }
  });

  it("checks fetched sources only for selected packs", async function () {
    const name = `vsix-guard-${process.pid}`;
    const packDir = join(root, "packs", name);
    mkdirSync(packDir);
    try {
      writeFileSync(join(packDir, "osd-pack.json"), JSON.stringify({
        name, sources: [{folder: "upstream", repo: "https://example.invalid/missing", ref: "main"}],
      }));
      const defaultBuild = await buildVsix({});
      expect(packagedPacks(defaultBuild.out)).to.deep.equal(["zork"]);

      let error;
      try {
        await buildVsix({OSD_VSIX_PACKS: name});
      } catch (caught) {
        error = caught;
      }
      expect(error?.message).to.contain(`pack ${name} fetches upstream`);
    } finally {
      rmSync(packDir, {recursive: true, force: true});
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

  let launcher, port, unzipDir, storageDir, globalStorageDir, osdHome, LauncherClass;

  before(async function () {
    if (!built) {
      this.skip();
      return;
    }
    ensureDemoWorkspace();

    rmSync(SCRATCH, {recursive: true, force: true});
    mkdirSync(SCRATCH, {recursive: true});
    unzipDir = join(SCRATCH, "unzipped");
    execFileSync("unzip", ["-q", join(VSIX_DIR, builtVsix), "-d", unzipDir]);

    const extensionDir = join(unzipDir, "extension");
    const packagedVersion = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8")).version;
    expect(builtVsix).to.equal(`osd-vscode-${packagedVersion}.vsix`);
    expect(readFileSync(join(unzipDir, "extension.vsixmanifest"), "utf8"))
      .to.contain(`Version="${packagedVersion}"`);
    const {Launcher, ensureMaterializedHome, seedContentId, SEED_ID_FILE} = createRequire(import.meta.url)(join(extensionDir, "launcher.js"));
    const seedDir = join(extensionDir, "osd");
    expect(existsSync(join(seedDir, "test", "run.mjs")), "the .vsix carries a runnable osd/ seed").to.equal(true);
    expect(existsSync(join(seedDir, "gen")), "the seed must not carry generated files from excluded packs").to.equal(false);
    // hdb and @abaplint/database-pg (-> pg) travel with the package (both
    // pure JS, docs/vscode-extension.md "Packaging"); the native DuckDB
    // module does not, on purpose.
    expect(existsSync(join(seedDir, "node_modules", "hdb")), "hdb ships in the .vsix").to.equal(true);
    expect(existsSync(join(seedDir, "node_modules", "@abaplint", "database-pg")),
      "@abaplint/database-pg ships in the .vsix").to.equal(true);
    expect(existsSync(join(seedDir, "node_modules", "@duckdb")), "DuckDB's native module does NOT ship in the .vsix").to.equal(false);
    const seedId = readFileSync(join(seedDir, SEED_ID_FILE), "utf8").trim();
    expect(seedId, "the packaged ID matches the packaged seed content").to.equal(seedContentId(seedDir));

    globalStorageDir = join(SCRATCH, "globalStorage"); // stands in for context.globalStorageUri
    // osd.home unset: this is the packaged path, materializing the bundled
    // seed rather than pointing at a dev checkout.
    osdHome = ensureMaterializedHome(seedDir, globalStorageDir);
    expect(osdHome).to.equal(join(globalStorageDir, `osd-home-${seedId}`));
    expect(osdHome).to.not.equal(seedDir, "the launcher must run the materialized copy, never the install folder");
    LauncherClass = Launcher;

    storageDir = join(SCRATCH, "instance-storage"); // stands in for storageDirFor()
    launcher = new Launcher({osdHome, storageDir, workspaceFolders: [DEMO_WS], timeoutMs: 180000});
    const result = await launcher.start();
    port = result.port;
    expect(existsSync(join(osdHome, "gen", "stg", "zvdb_100")),
      "the first build must not regenerate an excluded pack's service").to.equal(false);
  });

  after(async function () {
    if (!built) {
      return;
    }
    const pid = launcher?.pid;
    if (launcher !== undefined) {
      await launcher.stop();
    }
    if (pid !== undefined) {
      expect(() => process.kill(pid, 0), "no process left running after stop()").to.throw();
    }
    rmSync(SCRATCH, {recursive: true, force: true});
  });

  it("TravelSet answers over the materialized, out-of-repo copy", async function () {
    if (!built) {
      this.skip();
    }
    const res = await fetch(`http://localhost:${port}/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$format=json`);
    expect(res.status).to.equal(200);
    const body = await res.json();
    expect(body.d.results.length).to.be.at.least(1);
  });

  it("serves the launchpad and returns only bundled pack tiles", async function () {
    if (!built) {
      this.skip();
    }
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
    if (!built) {
      this.skip();
    }
    const duckLauncher = new LauncherClass({
      osdHome, storageDir: join(SCRATCH, "duckdb-instance-storage"),
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
    if (!built) {
      this.skip();
    }
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
