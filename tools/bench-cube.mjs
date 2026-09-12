#!/usr/bin/env node
// The analytical cube on a row store and on a column store, side by side.
//
//   node tools/bench-cube.mjs [rows] [sqlite,duckdb]
//
// For every store a child process boots the transpiled runtime with
// STG_DB=<store> and STG_DATA_SCALE=<rows> (tools/gen-data.mjs), serves the
// SADL service and times the requests an Analytical List Page makes on
// ZC_STG_FLIGHTCUBE: the grand total, the chart per airline, the table per
// airline/month/status, a filtered breakdown. Reported: load time, median
// and best of 5 runs per query after one warm-up.
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

const QUERIES = {
  total: "$select=SEATS,REVENUE",
  by_airline: "$select=AIRLINE,SEATS,REVENUE&$orderby=REVENUE desc",
  by_airline_month_status: "$select=AIRLINE,FLIGHTMONTH,STATUS,SEATS,REVENUE&$orderby=REVENUE desc&$top=129&$inlinecount=allpages",
  filtered_by_month: "$filter=STATUS eq 'A' and AIRLINE eq 'LH'&$select=FLIGHTMONTH,SEATS,REVENUE&$orderby=FLIGHTMONTH",
};

async function child() {
  const loadStart = Date.now();
  const {startServer} = await import("../test/start.mjs");
  const load = Date.now() - loadStart;
  const server = startServer(true);
  const S = "http://localhost:3030/sap/opu/odata/sap/ZSTG_SADL_SRV/Zc_Stg_FlightcubeSet?";
  const out = {store: process.env.STG_DB ?? "sqlite", rows: Number(process.env.STG_DATA_SCALE ?? 0), load_ms: load, queries: {}};
  for (const [name, q] of Object.entries(QUERIES)) {
    const times = [];
    for (let i = 0; i < 6; i++) {
      const t = Date.now();
      const res = await fetch(S + q + "&$format=json");
      const d = (await res.json()).d;
      if (i > 0) {
        times.push(Date.now() - t);
      }
      if (i === 0) {
        out.queries[name] = {result_rows: d.results.length, count: d.__count};
      }
    }
    times.sort((a, b) => a - b);
    out.queries[name].median_ms = times[Math.floor(times.length / 2)];
    out.queries[name].best_ms = times[0];
  }
  server.close();
  process.stdout.write("BENCH " + JSON.stringify(out) + "\n");
  process.exit(0);
}

function runStore(store, rows) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--expose-gc", fileURLToPath(import.meta.url), "--child"], {
      env: {...process.env, STG_DB: store, STG_DATA_SCALE: String(rows)},
      stdio: ["ignore", "pipe", "inherit"],
    });
    let buf = "";
    p.stdout.on("data", (d) => { buf += d; });
    p.on("exit", (code) => {
      const line = buf.split("\n").find((l) => l.startsWith("BENCH "));
      if (code !== 0 || !line) {
        reject(new Error(`${store}: exit ${code}, no result`));
      } else {
        resolve(JSON.parse(line.slice(6)));
      }
    });
  });
}

if (process.argv.includes("--child")) {
  await child();
} else {
  const rows = Number(process.argv[2] ?? 100000);
  const stores = (process.argv[3] ?? "sqlite,duckdb").split(",");
  const results = [];
  for (const store of stores) {
    results.push(await runStore(store, rows));
  }
  console.log(`\nZC_STG_FLIGHTCUBE, ${rows.toLocaleString("en")} facts + seeds, median of 5 (best) in ms\n`);
  const names = Object.keys(QUERIES);
  console.log(["query", ...results.map((r) => r.store)].join("\t"));
  console.log(["load", ...results.map((r) => r.load_ms)].join("\t"));
  for (const n of names) {
    console.log([n, ...results.map((r) => `${r.queries[n].median_ms} (${r.queries[n].best_ms})`)].join("\t"));
  }
  console.log("rows", ...results.map((r) => `${r.queries.by_airline_month_status.count}`));
}
