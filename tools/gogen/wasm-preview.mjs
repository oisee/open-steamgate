// The OSGo preview: OSGo compiled to wasm, answering in a service worker,
// beside the same Fiori pages the JS preview (scripts/build-preview.mjs)
// serves. Run after tools/gogen/osgo.mjs, which writes the generated half of
// the program (go/cmd/osgo/zz_*):
//
//   node tools/gogen/wasm-preview.mjs [--out <dir>] [--no-build]
//
// <dir> (default build/osgo-preview of this worktree) is plain files for any
// static host: sw.js (tools/gogen/wasm/osgo-sw.js), osgo.wasm, Go's
// wasm_exec.js, sql.js, index.html, app/ (the tree's webapp/ and each pack's,
// with the UI5 bootstrap deferred until the worker answers), packs.json and
// the sandbox config. The worker answers everything below sap/; the rest is
// the static host's.
import {execFileSync} from "node:child_process";
import {copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";
import {brotliCompressSync, constants, gzipSync} from "node:zlib";
import {home} from "./home.mjs";

const here = import.meta.dirname;
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const worktree = resolve(here, "..", "..");
const out = resolve(opt("--out", join(worktree, "build", "osgo-preview")));
const goDir = join(here, "go");
const wasm = join(here, ".out", "wasm", "osgo.wasm");
const require = createRequire(join(worktree, "package.json"));

for (const f of ["zz_generated.go", "zz_db.json", "zz_boot.go"]) {
  if (!existsSync(join(goDir, "cmd", "osgo", f))) throw new Error(`go/cmd/osgo/${f} is missing: run node tools/gogen/osgo.mjs first`);
}
if (!args.includes("--no-build")) {
  mkdirSync(dirname(wasm), {recursive: true});
  const t = performance.now();
  execFileSync("go", ["build", "-ldflags=-s -w", "-o", wasm, "./cmd/osgo"], {cwd: goDir, stdio: "inherit",
    env: {...process.env, GOOS: "js", GOARCH: "wasm", GOPROXY: "off"}});
  console.log(`go build (js/wasm) ${Math.round(performance.now() - t)} ms`);
}

rmSync(out, {recursive: true, force: true});
mkdirSync(out, {recursive: true});
const bytes = readFileSync(wasm);
copyFileSync(wasm, join(out, "osgo.wasm"));
const goroot = execFileSync("go", ["env", "GOROOT"]).toString().trim();
copyFileSync(join(goroot, "lib", "wasm", "wasm_exec.js"), join(out, "wasm_exec.js"));
const sqljs = dirname(require.resolve("sql.js/dist/sql-wasm.js"));
copyFileSync(join(sqljs, "sql-wasm.js"), join(out, "sql-wasm.js"));
copyFileSync(join(sqljs, "sql-wasm.wasm"), join(out, "sql-wasm.wasm"));
// the database a worker kept belongs to the build that seeded it
const buildId = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
writeFileSync(join(out, "sw.js"), readFileSync(join(here, "wasm", "osgo-sw.js"), "utf8").replace("__OSGO_BUILD_ID__", buildId));
writeFileSync(join(out, "index.html"), readFileSync(join(home, "web", "index.html"), "utf8")
  .replace("runs the transpiled ABAP DPC over SQLite", "runs OSGo, the ABAP compiled to Go and to wasm, over SQLite (sql.js)"));
writeFileSync(join(out, "build.json"), JSON.stringify({buildId, builtAt: new Date().toISOString(), runtime: "osgo-wasm"}, null, 2) + "\n");

// The database image: this same wasm run once under Node (wasm/node-host.mjs),
// seeded and booted with its demo rows, exported. The worker starts from it
// on a first visit instead of seeding (osgo-sw.js), so a visitor pays for a
// download the static host compresses rather than for seconds of INSERTs;
// the worker's own copy in cache storage wins once there is one.
{
  const t = performance.now();
  execFileSync(process.execPath, ["--input-type=module", "-e", `
    const {startOsgo} = await import(${JSON.stringify(join(here, "wasm", "node-host.mjs"))});
    const {osgo} = await startOsgo(${JSON.stringify(wasm)});
    const {writeFileSync} = await import("node:fs");
    writeFileSync(${JSON.stringify(join(out, "seed.sqlite"))}, osgo.exportDatabase());
    process.exit(0);`], {stdio: ["ignore", "ignore", "inherit"]});
  const image = readFileSync(join(out, "seed.sqlite"));
  const ibr = brotliCompressSync(image, {params: {[constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: image.length}}).length;
  console.log(`seed.sqlite: ${(image.length / 1048576).toFixed(2)} MB raw, ${(ibr / 1048576).toFixed(2)} MB brotli q11 (${Math.round(performance.now() - t)} ms under Node)`);
}

// SMW0: the media osgo.mjs wrote (.out/media, w3mi.json and the files),
// fetched by the worker's fs when a page asks for one
const media = join(here, ".out", "media");
if (!existsSync(join(media, "w3mi.json"))) throw new Error(".out/media/w3mi.json is missing: run node tools/gogen/osgo.mjs first");
cpSync(media, join(out, "media"), {recursive: true});

// the pages: the tree's webapp/ at app/, each pack's at app/<name>/ (as
// test/start.mjs and osgo mount them), the tiles, the sandbox config
const {tilesOf, webappsOf} = await import(`${home}/tools/osd-packs.mjs`);
const {SANDBOX_CONFIG_PATH, SANDBOX_CONFIG_BODY} = await import(`${home}/tools/osd-sandbox-config.mjs`);
cpSync(join(home, "webapp"), join(out, "app"), {recursive: true});
for (const pack of webappsOf(home)) {
  cpSync(pack.dir, join(out, "app", pack.name), {recursive: true});
  const entry = join(pack.dir, "index.html");
  if (existsSync(entry)) deferBootstrap(entry, join(out, "app", pack.name, "index.html"), "../../", false);
}
writeFileSync(join(out, "app", "packs.json"), JSON.stringify({tiles: tilesOf(home)}, null, 2) + "\n");
mkdirSync(join(out, dirname(SANDBOX_CONFIG_PATH).slice(1)), {recursive: true});
writeFileSync(join(out, SANDBOX_CONFIG_PATH.slice(1)), SANDBOX_CONFIG_BODY);
for (const page of ["index.html", "flp.html"]) deferBootstrap(join(home, "webapp", page), join(out, "app", page), "../", true);

// The UI5 bootstrap waits for the worker: registered, in control, and the
// gateway answering (the first OData answer is the cold start). The same
// loader scripts/build-preview.mjs writes, pointed at this worker.
function deferBootstrap(source, target, prefix, required) {
  const html = readFileSync(source, "utf8");
  const tag = /<script id="sap-ui-bootstrap"[\s\S]*?<\/script>/.exec(html);
  if (tag === null) {
    if (required) throw new Error(`${source}: sap-ui-bootstrap script not found`);
    return;
  }
  const attributes = {};
  for (const m of tag[0].replace(/^<script /, "").matchAll(/([\w-]+)="([^"]*)"|([\w-]+)='([^']*)'/g)) attributes[m[1] ?? m[3]] = m[2] ?? m[4];
  const loader = `<script>
    (async () => {
      const explain = (title, detail) => {
        document.body.innerHTML = "";
        const pre = document.createElement("pre");
        pre.style.cssText = "white-space:pre-wrap;font:14px system-ui;margin:2rem";
        pre.textContent = title + "\\n\\n" + detail;
        document.body.append(pre);
      };
      if (!("serviceWorker" in navigator)) { explain("This browser cannot run the preview", "no navigator.serviceWorker"); return; }
      const expected = new URL(${JSON.stringify(`${prefix}sw.js`)}, location.href).href;
      if (navigator.serviceWorker.controller?.scriptURL !== expected) {
        await navigator.serviceWorker.register(${JSON.stringify(`${prefix}sw.js`)}, {scope: ${JSON.stringify(prefix)}});
        for (let waited = 0; navigator.serviceWorker.controller?.scriptURL !== expected && waited < 60000; waited += 50) {
          await new Promise((tick) => setTimeout(tick, 50));
        }
        if (navigator.serviceWorker.controller?.scriptURL !== expected) { explain("The preview could not start", "the worker does not control this page: " + expected); return; }
      }
      const probe = await fetch(${JSON.stringify(`${prefix}sap/opu/odata/sap/ZSTG_DEMO_SRV/`)}, {headers: {accept: "application/json"}}).catch((e) => e);
      if (!(probe instanceof Response) || !probe.ok) {
        explain("OSGo did not answer", probe instanceof Response ? probe.status + " " + (await probe.text()).slice(0, 2000) : String(probe));
        return;
      }
      const boot = document.createElement("script");
      const attributes = ${JSON.stringify(attributes)};
      for (const name of Object.keys(attributes)) boot.setAttribute(name, attributes[name]);
      document.head.appendChild(boot);
    })();
  </script>`;
  writeFileSync(target, html.replace(tag[0], loader));
}

const gz = gzipSync(bytes, {level: 9}).length;
const br = brotliCompressSync(bytes, {params: {[constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length}}).length;
const mb = (n) => (n / 1048576).toFixed(2);
console.log(`osgo.wasm: ${mb(bytes.length)} MB raw, ${mb(gz)} MB gzip -9, ${mb(br)} MB brotli q11 (build ${buildId})`);
console.log(`-> ${out} (${Math.round(statSync(join(out, "osgo.wasm")).size / 1024)} KB wasm)`);
