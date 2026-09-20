import {createConnection} from "node:net";
const base = `http://127.0.0.1:${process.env.STG_PORT ?? 3030}`;
async function json(path) {
  const r = await fetch(base + path, {signal: AbortSignal.timeout(5000)});
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
// Warm the child before checking its reported state.
const travels = await json('/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$top=1&$format=json');
if (!travels.d?.results?.length) throw new Error("Demo seed is missing");
const build = await json('/sap/bc/adt/core/http/build');
if (!build.system?.serving) throw new Error("No serving runtime");
if (process.env.STG_PROTOCOLS !== "0") {
  const instance = process.env.INSTANCE ?? "00";
  if (!/^\d{2}$/.test(instance)) throw new Error("INSTANCE must be two digits");
  for (const port of [Number(`32${instance}`), Number(`33${instance}`)]) {
    await new Promise((resolve, reject) => {
      const socket = createConnection({host: "127.0.0.1", port});
      socket.setTimeout(3000, () => socket.destroy(new Error(`Port ${port} timed out`)));
      socket.once("connect", () => { socket.end(); resolve(); });
      socket.once("error", reject);
    });
  }
}
