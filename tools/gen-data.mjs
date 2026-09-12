#!/usr/bin/env node
// Synthetic flight booking facts for the analytical cube (ZSTG_FLIGHTFACT,
// ZC_STG_FLIGHTCUBE): enough rows to see what a columnar store does with a
// GROUP BY that a row store has to scan. Deterministic (a seeded PRNG), so
// two runs and two databases hold the same data.
//
//   STG_DATA_SCALE=1000000 npm run start:duckdb     a million facts on DuckDB
//   node tools/gen-data.mjs 100000 > facts.csv       the same rows as CSV
//
// DuckDB reads the rows from a CSV in one statement; SQLite takes them in
// multi-row INSERTs. CHAR values are padded to their DDIC length the way
// the runtime stores them (DuckDB trims them on the way in anyway).
import {writeFileSync, unlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const AIRLINES = [["LH", "EUR"], ["AA", "USD"], ["BA", "GBP"], ["UA", "USD"], ["SQ", "SGD"], ["JL", "JPY"], ["AF", "EUR"], ["KL", "EUR"]];
const MONTHS = ["202601", "202602", "202603", "202604", "202605", "202606", "202607", "202608", "202609", "202610", "202611", "202612"];
export const COLUMNS = ["mandt", "fact_id", "airline", "flight_month", "status", "seats", "price", "currency"];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** one fact, index n (1-based); the seeds occupy fact_id 1..24, scaled rows start at 1000001 */
export function* flightFacts(count, seed = 42) {
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const [airline, currency] = AIRLINES[Math.floor(rnd() * AIRLINES.length)];
    const month = MONTHS[Math.floor(rnd() * MONTHS.length)];
    const r = rnd();
    const status = r < 0.7 ? "A" : r < 0.9 ? "O" : "X";
    const seats = 1 + Math.floor(rnd() * 4);
    const price = Math.round((80 + rnd() * 1120) * seats * 100) / 100;
    yield {mandt: "123", fact_id: String(1000000 + i + 1).padStart(10, "0"), airline, flight_month: month, status, seats, price, currency};
  }
}

const PAD = {mandt: 3, fact_id: 10, airline: 3, flight_month: 6, status: 1, currency: 5};

function csvLine(row) {
  return COLUMNS.map((c) => (typeof row[c] === "number" ? String(row[c]) : row[c])).join(",");
}

function sqlValues(row) {
  return "(" + COLUMNS.map((c) => (typeof row[c] === "number" ? String(row[c]) : "'" + String(row[c]).padEnd(PAD[c] ?? 0, " ") + "'")).join(",") + ")";
}

/** loads `count` facts into ZSTG_FLIGHTFACT through the transpiler's database client */
export async function loadFlightFacts(db, count, kind = "sqlite", seed = 42) {
  const started = Date.now();
  if (kind === "duckdb") {
    const file = join(tmpdir(), `stg-flightfacts-${process.pid}.csv`);
    const lines = [COLUMNS.join(",")];
    for (const row of flightFacts(count, seed)) {
      lines.push(csvLine(row));
    }
    writeFileSync(file, lines.join("\n") + "\n");
    try {
      await db.execute(`INSERT INTO "zstg_flightfact" BY NAME SELECT * FROM read_csv('${file}', header = true, all_varchar = false, ` +
        `columns = {'mandt': 'VARCHAR', 'fact_id': 'VARCHAR', 'airline': 'VARCHAR', 'flight_month': 'VARCHAR', 'status': 'VARCHAR', 'seats': 'INTEGER', 'price': 'DECIMAL(15,2)', 'currency': 'VARCHAR'})`);
    } finally {
      unlinkSync(file);
    }
  } else {
    const batch = [];
    const flush = async () => {
      if (batch.length > 0) {
        await db.execute(`INSERT INTO "zstg_flightfact" (${COLUMNS.map((c) => `"${c}"`).join(",")}) VALUES ${batch.join(",")};`);
        batch.length = 0;
      }
    };
    for (const row of flightFacts(count, seed)) {
      batch.push(sqlValues(row));
      if (batch.length >= 500) {
        await flush();
      }
    }
    await flush();
  }
  if (process.env.STG_DATA_TRACE === "1") {
    console.log(`gen-data: ${count} flight facts into ${kind} in ${Date.now() - started} ms`);
  }
}

if (process.argv[1] && /gen-data\.mjs$/.test(process.argv[1])) {
  const count = Number(process.argv[2] ?? 1000);
  process.stdout.write(COLUMNS.join(",") + "\n");
  for (const row of flightFacts(count)) {
    process.stdout.write(csvLine(row) + "\n");
  }
}
