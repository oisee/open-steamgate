#!/usr/bin/env node
// The seed capture of packs/rap-flight: run SAP's data generator once in the
// transpiled runtime and write what it made into the pack's data/ folder as
// abapGit TABU JSON, the format every pack's seed rows have (test/seed.mjs
// reads them at start).
//
//   npm run transpile                      # the generator and its tables
//   node tools/rap-flight/seed-capture.mjs [--out packs/rap-flight/data]
//
// Boots the runtime the way test/start.mjs does (output/init.mjs), runs
// ZCL_OSD_RAPFLIGHT_SEED=>RUN inside one dialog step -- committed when it
// returns, rolled back if it dumps (tools/osd-dialog-step.mjs) -- and then
// selects every table the generator fills. Dates come out as the internal
// YYYYMMDD and go into the file as YYYY-MM-DD, which is what abapGit's own
// serialiser writes and what test/seed.mjs converts back.
import {mkdirSync, writeFileSync, readFileSync, existsSync} from "node:fs";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {dialogStep} from "../osd-dialog-step.mjs";

// the tables the generator writes, in the order a reader expects them
export const TABLES = [
  "/dmo/airport", "/dmo/carrier", "/dmo/connection", "/dmo/flight",
  "/dmo/agency", "/dmo/customer",
  "/dmo/supplcat", "/dmo/supplcat_t", "/dmo/supplement", "/dmo/suppl_text",
  "/dmo/travel", "/dmo/booking", "/dmo/book_suppl",
  "/dmo/trvl_stat", "/dmo/trvl_stat_t", "/dmo/oall_stat", "/dmo/oall_stat_t",
  "/dmo/book_stat", "/dmo/book_stat_t",
  "/dmo/travel_m", "/dmo/booking_m", "/dmo/booksuppl_m",
];

/** abapGit's file name for a namespaced table: /dmo/travel -> #dmo#travel.tabu.json */
export const fileOf = (table) => table.toLowerCase().replace(/\//g, "#") + ".tabu.json";

/** the DATS columns of a table, read off its abapGit XML, so the file can carry ISO dates */
export function dateColumns(tablXml) {
  const out = new Set();
  for (const m of tablXml.matchAll(/<DD03P>([\s\S]*?)<\/DD03P>/g)) {
    const name = /<FIELDNAME>([^<]+)</.exec(m[1])?.[1]?.toLowerCase();
    const datatype = /<DATATYPE>([^<]+)</.exec(m[1])?.[1];
    const rollname = /<ROLLNAME>([^<]+)</.exec(m[1])?.[1]?.toUpperCase();
    if (name && (datatype === "DATS" || /_DATE$|^BEGIN_DATE$|^END_DATE$|^FLIGHT_DATE$|^BOOKING_DATE$/.test(rollname ?? ""))) out.add(name);
  }
  return out;
}

/** one row as the file holds it: trimmed strings, ISO dates, numbers as numbers */
export function fileRow(row, dates) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.toLowerCase();
    if (typeof v === "string") {
      const t = v.replace(/\s+$/, "");
      out[key] = dates.has(key) && /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : t;
    } else {
      out[key] = v;
    }
  }
  return out;
}

export async function capture({root = process.cwd(), out = join("packs", "rap-flight", "data"), log = console.log} = {}) {
  const from = (file) => import(pathToFileURL(resolve(root, "output", file)).href);
  const {initializeABAP} = await from("init.mjs");
  await initializeABAP();
  const {zcl_osd_rapflight_seed} = await from("zcl_osd_rapflight_seed.clas.mjs");
  const started = performance.now();
  const lines = await dialogStep(() => zcl_osd_rapflight_seed.run(), "rap-flight seed");
  for (const line of lines.array()) log(`  ${line.get()}`);
  const counts = await zcl_osd_rapflight_seed.counts();
  log(`seed-capture: ${counts.get()} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  const client = globalThis.abap.context.databaseConnections.DEFAULT;
  mkdirSync(resolve(root, out), {recursive: true});
  const written = [];
  for (const table of TABLES) {
    const xml = tablXmlOf(root, table);
    const dates = xml ? dateColumns(xml) : new Set();
    const rows = ((await client.select({select: `SELECT * FROM "${table}"`})).rows ?? []).map((r) => fileRow(r, dates));
    const file = join(out, fileOf(table));
    writeFileSync(resolve(root, file), "[\n" + rows.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n");
    written.push({table, rows: rows.length, file});
    log(`seed-capture: ${table}: ${rows.length} rows -> ${file}`);
  }
  return {counts: counts.get(), written};
}

function tablXmlOf(root, table) {
  const name = table.toLowerCase().replace(/\//g, "#") + ".tabl.xml";
  for (const dir of ["packs/rap-flight/upstream/legacy", "packs/rap-flight/upstream/managed", "packs/rap-flight/upstream/reuse",
    "packs/rap-flight/upstream/reuse/agency", "packs/rap-flight/upstream/reuse/supplement", "packs/rap-flight/upstream/reuse/carrier"]) {
    const p = resolve(root, dir, name);
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  return undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const outIndex = process.argv.indexOf("--out");
  const out = outIndex > 0 ? process.argv[outIndex + 1] : undefined;
  capture(out ? {out} : {}).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
