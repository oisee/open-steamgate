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
