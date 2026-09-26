// The packaging proof (docs/vscode-extension.md, "Packaging"): the .vsix
// `npm run vsix` writes really installs and runs OUTSIDE this checkout --
// unzipped into a scratch folder, run with `osd.home` unset (the packaged
// path, not the dev one) and a scratch storage directory standing in for
// `context.globalStorageUri`. Skipped, not failed, when `build/vsix` was
// never built (`npm run vsix` first) -- the same shape `test/osd-binary.mjs`
// already uses for the compiled binary.
//
// Scratch lives under this checkout's own `.local/` (never `/tmp`, a small
// tmpfs on this box) and is removed again at the end; the workspace layer
// fixture (`.local/b0-demo-ws/`, named in docs/vscode-extension.md's own
// "Live smoke") is created once if missing and left there, since it is
// gitignored scratch by design and other sessions may reuse it.
import {expect} from "chai";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const root = process.cwd();
const VSIX_DIR = join(root, "build", "vsix");
const vsixFile = existsSync(VSIX_DIR)
  ? readdirSync(VSIX_DIR).find((f) => f.endsWith(".vsix"))
  : undefined;
const built = vsixFile !== undefined;

const DEMO_WS = join(root, ".local", "b0-demo-ws");
const SCRATCH = join(root, ".local", "vsix-run-scratch");

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

  let launcher, port, unzipDir, storageDir, globalStorageDir;

  before(async function () {
    if (!built) {
      this.skip();
      return;
    }
    ensureDemoWorkspace();

    rmSync(SCRATCH, {recursive: true, force: true});
    mkdirSync(SCRATCH, {recursive: true});
    unzipDir = join(SCRATCH, "unzipped");
    execFileSync("unzip", ["-q", join(VSIX_DIR, vsixFile), "-d", unzipDir]);

    const extensionDir = join(unzipDir, "extension");
    const {Launcher, ensureMaterializedHome} = createRequire(import.meta.url)(join(extensionDir, "launcher.js"));
    const pkg = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8"));

    const seedDir = join(extensionDir, "osd");
    expect(existsSync(join(seedDir, "test", "run.mjs")), "the .vsix carries a runnable osd/ seed").to.equal(true);

    globalStorageDir = join(SCRATCH, "globalStorage"); // stands in for context.globalStorageUri
    // osd.home unset: this is the packaged path, materializing the bundled
    // seed rather than pointing at a dev checkout.
    const osdHome = ensureMaterializedHome(seedDir, globalStorageDir, pkg.version);
    expect(osdHome).to.not.equal(seedDir, "the launcher must run the materialized copy, never the install folder");

    storageDir = join(SCRATCH, "instance-storage"); // stands in for storageDirFor()
    launcher = new Launcher({osdHome, storageDir, workspaceFolders: [DEMO_WS], timeoutMs: 180000});
    const result = await launcher.start();
    port = result.port;
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
