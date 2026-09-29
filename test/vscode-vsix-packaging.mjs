// VSIX packaging scenarios, run in the full CI profile.
import {expect} from "chai";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {basename, join} from "node:path";
import {excludeStagedPackSources} from "../scripts/build-vsix.mjs";
import {inventoryThirdParties} from "../scripts/third-party-notices.mjs";
import {tilesOf} from "../tools/osd-packs.mjs";
import {root, currentVsixFile, packagedSeedEntries, packagedPacks, testScratch, buildTestVsix, packagedController, timeVsixTests} from "./helpers/vsix.mjs";

describe("packaging changed seed content", function () {
  timeVsixTests();
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
  timeVsixTests();
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

  it("builds a Marketplace archive with Zork I, its notice, and no web entry", async function () {
    const scratch = testScratch("marketplace");
    try {
      const {out, notices} = await buildTestVsix(scratch, {OSD_VSIX_PROFILE: "marketplace", OSD_VSIX_PRERELEASE: "1"});
      expect(packagedPacks(out)).to.deep.equal(["zork"]);
      expect(packagedSeedEntries(out)).not.to.match(/(?:^|\/)zork-mini[^\n]*/m);
      expect(execFileSync("unzip", ["-Z1", out], {encoding: "utf8"})).not.to.contain("extension/dist/web/");
      expect(readFileSync(join(scratch, "seed-stage", "webapp", "flp.html"), "utf8")).to.contain('title: "Zork I (MIT source release)"');
      expect(existsSync(join(scratch, "seed-stage", "packs", "zork", "src", "zork1-z3.w3mi.data.z3"))).to.equal(true);
      expect(existsSync(join(scratch, "seed-stage", "packs", "zork", "games", "zork-mini-z3.w3mi.data.z3"))).to.equal(false);
      expect(readdirSync(join(scratch, "seed-stage", "packs", "zork", "games"))).to.deep.equal([]);
      const pkg = JSON.parse(execFileSync("unzip", ["-p", out, "extension/package.json"], {encoding: "utf8"}));
      expect(pkg).not.to.have.property("browser");
      const manifest = execFileSync("unzip", ["-p", out, "extension.vsixmanifest"], {encoding: "utf8"});
      expect(manifest).to.contain('Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="true"');
      expect(manifest).to.contain('<Icon>extension/resources/icon.png</Icon>');
      expect(manifest).to.contain('Microsoft.VisualStudio.Services.Content.Details');
      const staged = inventoryThirdParties(join(scratch, "seed-stage"), root);
      expect(notices.entries.map((e) => e.path)).to.deep.equal(staged.entries.map((e) => e.path));
      const text = execFileSync("unzip", ["-p", out, "extension/THIRD-PARTY-NOTICES.md"], {encoding: "utf8", maxBuffer: 8 * 1024 * 1024});
      for (const entry of staged.entries) expect(text).to.contain(`## ${entry.name} — ${entry.path}`);
      expect(text).to.contain("## Zork I story — packs/zork/src/zork1-z3.w3mi.data.z3");
      expect(text).to.contain("Copyright (c) 2025 Microsoft");
      expect(text).to.contain("## oisee/zork-abap interpreter — packs/zork/upstream");
      expect(text).to.contain("Covers fetched folders: packs/zork/upstream, packs/zork/games.");
      expect(text).to.contain("Copyright (c) 2025\n\nPermission is hereby granted, free of charge");
      expect(text).to.contain("0c8d96b908f88fc3207e7f9a00bc43f724b32b6f");
      expect(text).to.contain("Source release by Microsoft, 2025; no trademark rights are granted; rebuilt from the MIT-licensed ZIL source, not the historical binary");
      expect(text).to.contain("License: MIT (maintainer override).\n\nNote: LICENSE file reads 'todo'; the author's intent is MIT; treated as MIT by the open-steamgate maintainer, 2026-09-27");
    } finally { rmSync(scratch, {recursive: true, force: true}); }
  });

  it("excludes stale fetched files from a symlinked source without changing the source", async function () {
    const name = `vsix-stale-${process.pid}`;
    const packDir = join(root, "packs", name);
    const scratch = testScratch("stale-source");
    const fetched = join(scratch, "fetched-games");
    mkdirSync(packDir);
    mkdirSync(join(packDir, "src"));
    mkdirSync(fetched);
    writeFileSync(join(fetched, "zork-mini-z3.w3mi.data.z3"), "old excluded game");
    writeFileSync(join(fetched, "kept-game.w3mi.data.z3"), "selected game");
    writeFileSync(join(packDir, "osd-pack.json"), JSON.stringify({
      name, abap: ["src"], sources: [{folder: "games", repo: "https://example.invalid/games",
        ref: "0000000000000000000000000000000000000000", path: "src/games", exclude: ["^zork-mini"]}],
    }));
    symlinkSync(fetched, join(packDir, "games"), "dir");
    try {
      const {out} = await buildTestVsix(join(scratch, "build"), {OSD_VSIX_PACKS: name});
      const entries = packagedSeedEntries(out);
      expect(entries).to.contain(`packs/${name}/games/kept-game.w3mi.data.z3`);
      expect(entries).not.to.contain(`packs/${name}/games/zork-mini-z3.w3mi.data.z3`);
      expect(existsSync(join(fetched, "zork-mini-z3.w3mi.data.z3"))).to.equal(true);
      expect(existsSync(join(packDir, "games", "kept-game.w3mi.data.z3"))).to.equal(true);
    } finally {
      rmSync(packDir, {recursive: true, force: true});
      rmSync(scratch, {recursive: true, force: true});
    }
  });

  it("refuses a traversing source folder before removing staged files", () => {
    const scratch = testScratch("source-traversal");
    const seed = join(scratch, "seed");
    const safe = join(seed, "packs", "safe", "games");
    const outside = join(seed, "outside");
    mkdirSync(safe, {recursive: true});
    mkdirSync(outside);
    writeFileSync(join(safe, "zork-mini-old"), "still staged");
    writeFileSync(join(outside, "zork-mini-important"), "outside pack");
    try {
      expect(() => excludeStagedPackSources(seed, [
        {name: "safe", sources: [{folder: "games", exclude: ["^zork-mini"]}]},
        {name: "safe", sources: [{folder: "../../outside", exclude: ["^zork-mini"]}]},
      ])).to.throw(/escapes its staged pack/);
      expect(existsSync(join(safe, "zork-mini-old"))).to.equal(true);
      expect(readFileSync(join(outside, "zork-mini-important"), "utf8")).to.equal("outside pack");
    } finally { rmSync(scratch, {recursive: true, force: true}); }
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

/** A full workspace pack with a class, DDIC table, TABU capture and webapp. */
function ensureDemoWorkspace(DEMO_WS) {
  const file = join(DEMO_WS, "src", "zcl_b0_hello.clas.abap");
  mkdirSync(join(DEMO_WS, "src", "ddic"), {recursive: true});
  mkdirSync(join(DEMO_WS, "data"), {recursive: true});
  mkdirSync(join(DEMO_WS, "webapp"), {recursive: true});
  writeFileSync(join(DEMO_WS, "osd-pack.json"), JSON.stringify({
    name: "b0-workspace", order: 950, abap: "src", data: "data", ddic: "src/ddic", webapp: "webapp",
    tiles: [{id: "b0-workspace", title: "B0 workspace", url: "/app/b0-workspace/"}],
  }));
  writeFileSync(join(DEMO_WS, "src", "ddic", "zb0_pack_row.tabl.xml"),
    readFileSync(join(root, "src", "ddic", "zstg_status.tabl.xml"), "utf8").replaceAll("ZSTG_STATUS", "ZB0_PACK_ROW"));
  writeFileSync(join(DEMO_WS, "data", "zb0_pack_row.tabu.json"),
    JSON.stringify([{MANDT: "100", STATUS: "A", STATUS_TEXT: "seeded workspace row"}]));
  writeFileSync(join(DEMO_WS, "webapp", "index.html"), "<h1>B0 workspace page v1</h1>\n");
  writeFileSync(file, `CLASS zcl_b0_hello DEFINITION PUBLIC CREATE PUBLIC.
* test/vscode-vsix.mjs's own fixture (docs/vscode-extension.md's "Live
* smoke"): a workspace layer with one classrun-able class.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_b0_hello IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    out->write( 'hello from the B0 workspace layer' ).
    SELECT SINGLE status_text FROM zb0_pack_row INTO @DATA(lv_text) WHERE status = 'A'.
    out->write( lv_text ).
  ENDMETHOD.
ENDCLASS.
`);
}

describe("packaging a prebuilt generation (T2, docs/ideas.md)", function () {
  timeVsixTests();
  this.timeout(240000);

  it("ships the seed's own generation, and a first start elsewhere reuses it", async function () {
    const scratch = testScratch("prebuilt");
    try {
      const {out} = await buildTestVsix(join(scratch, "build"), {OSD_VSIX_PREBUILT: "1"});
      const entries = packagedSeedEntries(out).split("\n");
      const generations = [...new Set(entries.map((entry) => /^build\/by-input\/([0-9a-f]{16})\//.exec(entry)?.[1])
        .filter((hash) => hash !== undefined))];
      expect(generations, "exactly one generation, as real files").to.have.length(1);
      expect(entries.some((entry) => entry.startsWith("gen/"))).to.equal(true);
      expect(entries.some((entry) => /^(output|build\/live)\/?$/.test(entry)), "no links: the first build makes them").to.equal(false);
      // and the cross-reference rows of that generation, one file
      const xref = entries.map((entry) => /^build\/xref\/([0-9a-f]{16})\.json$/.exec(entry)?.[1]).filter((key) => key !== undefined);
      expect(xref, "one cross-reference cache").to.have.length(1);

      const unzipDir = join(scratch, "unzipped");
      execFileSync("unzip", ["-q", out, "-d", unzipDir]);
      const extensionDir = join(unzipDir, "extension");
      const {ensureMaterializedHome, ensureWorkspacePacks} = createRequire(import.meta.url)(join(extensionDir, "launcher.js"));
      // another path than the one it was built under: the name must not depend on it
      const home = await ensureMaterializedHome(join(extensionDir, "osd"), join(scratch, "elsewhere", "globalStorage"));
      // OSD_PACKS the way the launcher sets it on a first start with no
      // workspace folder: its storage, holding the empty notebook-scratch pack
      const env = {...process.env, OSD_PACKS: ensureWorkspacePacks(join(scratch, "elsewhere", "storage"), [])};
      const log = execFileSync(process.execPath, ["tools/osd-build.mjs"], {cwd: home, env, encoding: "utf8"});
      expect(log, "the first build of a materialized copy").to.match(new RegExp(`osd-build: reused ${generations[0]} `));
      expect(log).to.not.match(/osd-build: built /);
      // the copy names the rows the way the seed did, so a first start seeds
      // CROSS & co. from the file instead of parsing the tree (~5 s)
      const key = execFileSync(process.execPath, ["--input-type=module", "-e",
        'process.stdout.write(String(await (await import("./tools/osd-xref-seed.mjs")).cacheKey(process.cwd())));'],
      {cwd: home, env, encoding: "utf8"});
      expect(key, "the copy's cross-reference key").to.equal(xref[0]);

      // the same tree packaged again makes the same seed: the materialized
      // copy is keyed by it, so a rebuilt .vsix of an unchanged tree reuses it
      const again = await buildTestVsix(join(scratch, "build-again"), {OSD_VSIX_PREBUILT: "1"});
      const seedIdOf = (archive) => execFileSync("unzip", ["-p", archive, "extension/osd/.seed-id"], {encoding: "utf8"}).trim();
      expect(seedIdOf(again.out)).to.equal(seedIdOf(out));
    } finally {
      rmSync(scratch, {recursive: true, force: true});
    }
  });
});

describe("packaging: the .vsix installs and runs outside this checkout (docs/vscode-extension.md, Packaging)", function () {
  timeVsixTests();
  this.timeout(240000);

  let launcher, controller, port, unzipDir, storageDir, globalStorageDir, osdHome, LauncherClass, scratch, workspaceApi, DEMO_WS;

  before(async function () {
    const setupStart = performance.now();
    scratch = testScratch("live-smoke");
    DEMO_WS = join(scratch, "workspace-pack");
    ensureDemoWorkspace(DEMO_WS);
    const {out} = await buildTestVsix(join(scratch, "build"));
    unzipDir = join(scratch, "unzipped");
    execFileSync("unzip", ["-q", out, "-d", unzipDir]);

    const extensionDir = join(unzipDir, "extension");
    const packagedVersion = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8")).version;
    expect(basename(out)).to.equal(`open-steamgate-${packagedVersion}.vsix`);
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

    const packaged = packagedController(extensionDir, DEMO_WS, osdHome);
    workspaceApi = packaged.api;
    controller = new packaged.SystemController({subscriptions: [], globalStorageUri: {fsPath: globalStorageDir},
      extensionUri: {fsPath: extensionDir}}, {append() {}, appendLine() {}, show() {}});
    expect(await controller.start()).to.equal(true);
    launcher = controller.launcher;
    storageDir = launcher.storageDir;
    port = launcher.port;
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

  it("serves the launchpad and the workspace pack page and tile", async function () {
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
    expect(actual).to.have.length(expected.length + 1);
    expect(actual.find((tile) => tile.pack === "b0-workspace")).to.include({id: "b0-workspace", url: "/app/b0-workspace/"});
    const workspacePage = await fetch(`${base}/app/b0-workspace/`);
    expect(workspacePage.status).to.equal(200);
    expect(await workspacePage.text()).to.contain("B0 workspace page v1");
    const {layerContributions} = createRequire(import.meta.url)(join(unzipDir, "extension", "launcher.js"));
    expect(layerContributions(launcher.layers[0])).to.deep.equal({abap: 1, data: 1, ddic: 1,
      webapp: "/app/b0-workspace/", tiles: 1});
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
    expect(text).to.contain("seeded workspace row");
  });

  it("page edits change the generation, and closing the folder removes its class, page, and tile", async function () {
    const original = launcher.generation;
    await launcher.stop();
    writeFileSync(join(DEMO_WS, "webapp", "index.html"), "<h1>B0 workspace page v2</h1>\n");
    await launcher.start();
    port = launcher.port;
    expect(launcher.generation).to.not.equal(original);
    expect(await (await fetch(`http://localhost:${port}/app/b0-workspace/`)).text()).to.contain("page v2");
    const pageGeneration = launcher.generation;
    await launcher.stop();
    writeFileSync(join(DEMO_WS, "data", "zb0_pack_row.tabu.json"),
      JSON.stringify([{MANDT: "100", STATUS: "A", STATUS_TEXT: "reseeded workspace row"}]));
    await launcher.start();
    port = launcher.port;
    expect(launcher.generation).to.not.equal(pageGeneration);
    const adt = `http://localhost:${port}/sap/bc/adt`;
    const discover = await fetch(`${adt}/core/discovery`, {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
    const context = (discover.headers.getSetCookie?.() ?? []).join("; ").match(/sap-contextid=([^;]+)/)?.[1];
    const run = await fetch(`${adt}/oo/classrun/ZCL_B0_HELLO`, {method: "POST", headers: {
      cookie: `sap-contextid=${context}`, "x-csrf-token": discover.headers.get("x-csrf-token"),
      "x-sap-adt-sessiontype": "stateful",
    }});
    expect(run.status).to.equal(200);
    expect(await run.text()).to.contain("reseeded workspace row");
    workspaceApi.workspace.workspaceFolders = [];
    await controller.stop();
    expect(await controller.start()).to.equal(true);
    port = controller.launcher.port;
    expect(controller.launcher).to.equal(launcher);
    expect(launcher.workspaceFolders).to.deep.equal([]);
    expect((await fetch(`http://localhost:${port}/app/b0-workspace/`)).status).to.equal(404);
    const tiles = (await (await fetch(`http://localhost:${port}/app/packs.json`)).json()).tiles;
    expect(tiles.some((tile) => tile.pack === "b0-workspace")).to.equal(false);
    const absent = await fetch(`http://localhost:${port}/sap/bc/adt/oo/classes/ZCL_B0_HELLO/source/main`);
    expect(absent.status).to.not.equal(200);
  });
});
