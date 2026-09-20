#!/usr/bin/env node
// Measure the OData query shapes sent by the NYC taxi Analytical List Page.
// The first call warms the runtime; five following calls form the median.
import {performance} from "node:perf_hooks";

const QUERIES = {
  borough: "$select=BOROUGH,TRIPS,FARE,TIP&$orderby=TRIPS desc",
  hour: "$select=PICKUPHOUR,TRIPS&$orderby=PICKUPHOUR",
  payment: "$select=PAYMENT,TRIPS,TIP&$orderby=TRIPS desc",
  topManhattanZones: "$filter=BOROUGH eq 'Manhattan'&$select=ZONE,TRIPS,TIP&$orderby=TRIPS desc&$top=20",
  defaultTable: "$select=BOROUGH,ZONE,PAYMENT,TRIPS,FARE,TIP,DISTANCE&$orderby=TRIPS desc&$top=100&$inlinecount=allpages",
};
const MAX_GROUPS = {borough: 15, hour: 24, payment: 8, topManhattanZones: 20, defaultTable: 2000};

// OSD currently reads the literal OData system option names from the URL.
// URLSearchParams serializes `$select` as `%24select`, which silently turns
// this benchmark into SELECT * over the entire fact table. A URL search
// setter still escapes spaces and values, but preserves the `$` in names.
export function taxiQueryUrl(base, query) {
  const url = new URL("/sap/opu/odata/sap/ZSTG_SADL_SRV/Zc_Osd_TaxicubeSet", base);
  url.search = `${query}&$format=json`;
  return url.href;
}

export async function benchmarkTaxi(base, fetcher = fetch) {
  const report = {};
  for (const [name, query] of Object.entries(QUERIES)) {
    const times = [];
    let rows = 0;
    let groups = 0;
    for (let run = 0; run < 6; run++) {
      const started = performance.now();
      const response = await fetcher(taxiQueryUrl(base, query), {signal: AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status} ${await response.text()}`);
      const body = await response.json();
      rows = body.d?.results?.length ?? 0;
      groups = Number(body.d?.__count ?? rows);
      if (groups > MAX_GROUPS[name]) throw new Error(`${name}: ${groups} groups; expected an analytical aggregate, not the full fact table`);
      if (run > 0) times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    report[name] = {rows, groups, medianMs: Math.round(times[2]), minMs: Math.round(times[0]), maxMs: Math.round(times[4])};
  }
  return report;
}

if (process.argv[1]?.endsWith("bench-taxi.mjs")) {
  const base = process.argv[2] ?? "http://127.0.0.1:3030";
  console.log(JSON.stringify(await benchmarkTaxi(base), null, 2));
}
