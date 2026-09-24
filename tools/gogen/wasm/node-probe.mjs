// Starts the OSGo wasm under Node (sql.js loaded, as in the worker) and asks
// it a few requests through osgo.handle: a smoke test of the worker's entry
// without a browser.   node tools/gogen/wasm/node-probe.mjs <osgo.wasm> [url ...]
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import * as fs from "node:fs";
import {join} from "node:path";

const require = createRequire(import.meta.url);
const goroot = execFileSync("go", ["env", "GOROOT"]).toString().trim();
const t0 = performance.now();
globalThis.SQL = await require("sql.js")();
require(join(goroot, "lib", "wasm", "wasm_exec.js"));
const ready = new Promise((r) => { globalThis.osgoReady = r; });
const go = new Go();
go.argv = ["osgo"];
go.env = {};
const {instance} = await WebAssembly.instantiate(fs.readFileSync(process.argv[2]), go.importObject);
const t1 = performance.now();
go.run(instance);
const report = await ready;
const t2 = performance.now();
console.log(`instantiate ${Math.round(t1 - t0)} ms, Go start ${Math.round(t2 - t1)} ms`, report);
const urls = process.argv.slice(3);
for (const url of urls.length ? urls : ["/sap/opu/odata/sap/ZSTG_DEMO_SRV/"]) {
  const s = performance.now();
  const a = await globalThis.osgo.handle({method: "GET", url, headers: {host: "localhost:4900", accept: "application/json"}});
  const text = new TextDecoder().decode(a.body);
  console.log(`${a.status} ${url} ${Math.round(performance.now() - s)} ms ${a.body.length} bytes: ${text.slice(0, 300).replace(/\s+/g, " ")}`);
}
process.exit(0);
