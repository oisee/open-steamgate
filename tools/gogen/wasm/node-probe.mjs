// Starts the OSGo wasm under Node (node-host.mjs, as in the worker) and asks
// it a few requests through osgo.handle: a smoke test of the worker's entry
// without a browser.   node tools/gogen/wasm/node-probe.mjs <osgo.wasm> [url ...]
import {startOsgo} from "./node-host.mjs";

const {report, instantiateMs, startMs, osgo} = await startOsgo(process.argv[2]);
console.log(`instantiate ${instantiateMs} ms, Go start ${startMs} ms`, report);
const urls = process.argv.slice(3);
for (const url of urls.length ? urls : ["/sap/opu/odata/sap/ZSTG_DEMO_SRV/"]) {
  const s = performance.now();
  const a = await osgo.handle({method: "GET", url, headers: {host: "localhost:4900", accept: "application/json"}});
  const text = new TextDecoder().decode(a.body);
  console.log(`${a.status} ${url} ${Math.round(performance.now() - s)} ms ${a.body.length} bytes: ${text.slice(0, 300).replace(/\s+/g, " ")}`);
}
process.exit(0);
