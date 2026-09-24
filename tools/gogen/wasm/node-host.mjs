// OSGo's wasm under Node, as the service worker runs it (osgo-sw.js): sql.js
// at globalThis.SQL, Go's loader, osgoReady awaited. Answers the report of
// the start and globalThis.osgo (handle, exportDatabase).
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const require = createRequire(import.meta.url);

export async function startOsgo(wasm, env = {}, image = undefined) {
  const goroot = process.env.GOROOT || execFileSync("go", ["env", "GOROOT"]).toString().trim();
  const t0 = performance.now();
  const SQL = globalThis.SQL = await require("sql.js")();
  globalThis.osgoOpenDatabase = (dsn) => (dsn === "preview" && image ? new SQL.Database(image) : null);
  require(join(goroot, "lib", "wasm", "wasm_exec.js"));
  const ready = new Promise((r) => { globalThis.osgoReady = r; });
  const go = new Go();
  go.argv = ["osgo"];
  go.env = {...env, OSGO_STORED: image ? "1" : ""};
  const {instance} = await WebAssembly.instantiate(readFileSync(wasm), go.importObject);
  const t1 = performance.now();
  go.run(instance);
  const report = await ready;
  if (report.error) throw new Error(report.error);
  return {report, instantiateMs: Math.round(t1 - t0), startMs: Math.round(performance.now() - t1), osgo: globalThis.osgo};
}
