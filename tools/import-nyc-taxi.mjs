#!/usr/bin/env node
// One explicit, repeatable import into an OFFLINE OSD DuckDB file. Raw TLC
// Parquet stays under .local/; the public image and repository stay small.
import {createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync} from "node:fs";
import {pipeline} from "node:stream/promises";
import {Readable} from "node:stream";
import {resolve, dirname, join} from "node:path";
import {DuckDBInstance} from "@duckdb/node-api";
import {identity} from "./osd-identity.mjs";
import {migrateDuckdbColumns} from "./osd-db-migrate.mjs";

const ORIGIN = "https://d37ci6vzurychx.cloudfront.net";
const DEFAULT_MONTH = "2025-01";
const MAX_DOWNLOAD = 512 * 1024 * 1024;

function sqlString(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

export function sources(month = DEFAULT_MONTH) {
  if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(month)) throw new Error("month must be YYYY-MM");
  return {
    parquet: `${ORIGIN}/trip-data/yellow_tripdata_${month}.parquet`,
    zones: `${ORIGIN}/misc/taxi_zone_lookup.csv`,
  };
}

async function download(url, path, fetcher = fetch) {
  if (existsSync(path)) return path;
  mkdirSync(dirname(path), {recursive: true});
  const response = await fetcher(url, {redirect: "follow"});
  if (!response.ok || !response.body) throw new Error(`download failed: ${response.status} ${url}`);
  const claimed = Number(response.headers.get("content-length") ?? 0);
  if (claimed > MAX_DOWNLOAD) throw new Error(`download too large: ${claimed} bytes`);
  const partial = `${path}.partial-${process.pid}`;
  let received = 0;
  try {
    const bounded = Readable.from((async function* () {
      for await (const chunk of Readable.fromWeb(response.body)) {
        received += chunk.length;
        if (received > MAX_DOWNLOAD) throw new Error("download exceeded 512 MiB");
        yield chunk;
      }
    })());
    await pipeline(bounded, createWriteStream(partial, {flags: "wx"}));
    renameSync(partial, path);
  } catch (error) {
    rmSync(partial, {force: true});
    throw error;
  }
  return path;
}

export async function importTaxiTrips({database, month = DEFAULT_MONTH, limit, parquet, zones, client = identity().client, fetcher = fetch}) {
  if (!database || !existsSync(database)) throw new Error("pass an existing offline DuckDB file with --db");
  if (!/^\d{3}$/.test(client)) throw new Error("client must be three digits");
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 999_000_000)) {
    throw new Error("limit must be a positive integer below 999000001");
  }
  const official = sources(month);
  const cache = resolve(".local/data/nyc-tlc");
  const parquetFile = parquet ?? await download(official.parquet, join(cache, `yellow_tripdata_${month}.parquet`), fetcher);
  const zoneFile = zones ?? await download(official.zones, join(cache, "taxi_zone_lookup.csv"), fetcher);
  const instance = await DuckDBInstance.create(resolve(database));
  const connection = await instance.connect();
  const started = Date.now();
  try {
    const table = await connection.runAndReadAll("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_name = 'zosd_taxifact'");
    if (Number(table.getRowObjects()[0]?.n ?? 0) !== 1) throw new Error("ZOSD_TAXIFACT is absent; boot this OSD build once before import");
    // a file booted by an earlier build still has ZONE (tools/osd-db-migrate.mjs);
    // its views are remade at the next server start, which has their list
    await migrateDuckdbColumns({
      query: async (sql) => (await connection.runAndReadAll(sql)).getRowObjects(),
      execute: (sql) => connection.run(sql),
    });
    const start = `${month}-01`;
    const [year, mm] = month.split("-").map(Number);
    const end = `${mm === 12 ? year + 1 : year}-${String(mm === 12 ? 1 : mm + 1).padStart(2, "0")}-01`;
    await connection.run(`
      CREATE TEMP TABLE taxi_incoming AS
      WITH valid AS (
        SELECT
          STRFTIME(t.tpep_pickup_datetime, '%Y%m%d') AS pickup_day,
          EXTRACT(HOUR FROM t.tpep_pickup_datetime)::INTEGER AS pickup_hour,
          LEFT(COALESCE(z.Borough, 'Unknown'), 20) AS borough,
          LEFT(COALESCE(z.Zone, 'Unknown'), 80) AS pickup_zone,
          CASE t.payment_type
            WHEN 1 THEN 'Card' WHEN 2 THEN 'Cash'
            WHEN 3 THEN 'No charge' WHEN 4 THEN 'Disputed'
            ELSE 'Other'
          END AS payment,
          t.fare_amount AS fare, t.tip_amount AS tip, t.trip_distance AS distance
        FROM read_parquet(${sqlString(resolve(parquetFile))}) t
        LEFT JOIN read_csv(${sqlString(resolve(zoneFile))}, header = true) z
          ON t.PULocationID = z.LocationID
        WHERE t.tpep_pickup_datetime >= TIMESTAMP ${sqlString(start)}
          AND t.tpep_pickup_datetime < TIMESTAMP ${sqlString(end)}
          AND t.fare_amount BETWEEN 0 AND 10000
          AND t.tip_amount BETWEEN 0 AND 10000
          AND t.trip_distance BETWEEN 0 AND 200
        ${limit === undefined ? "" : `LIMIT ${limit}`}
      ), grouped AS (
        SELECT pickup_day, pickup_hour, borough, pickup_zone, payment,
          COUNT(*)::INTEGER AS trips,
          ROUND(SUM(fare), 2)::DECIMAL(15,2) AS fare,
          ROUND(SUM(tip), 2)::DECIMAL(15,2) AS tip,
          ROUND(SUM(distance), 2)::DECIMAL(15,2) AS distance
        FROM valid
        GROUP BY pickup_day, pickup_hour, borough, pickup_zone, payment
      )
      SELECT ${sqlString(client)} AS mandt,
        LPAD(CAST(1000000 + ROW_NUMBER() OVER () AS VARCHAR), 10, '0') AS fact_id,
        pickup_day, pickup_hour, borough, pickup_zone, payment, trips, fare, tip, distance
      FROM grouped
    `);
    const counted = await connection.runAndReadAll("SELECT COUNT(*) AS n, SUM(trips) AS trips FROM taxi_incoming");
    const rows = Number(counted.getRowObjects()[0]?.n ?? 0);
    const trips = Number(counted.getRowObjects()[0]?.trips ?? 0);
    if (rows < 1) throw new Error("no valid trips found for selected month");
    await connection.run("BEGIN TRANSACTION");
    try {
      await connection.run(`DELETE FROM zosd_taxifact WHERE mandt = ${sqlString(client)}`);
      await connection.run(`INSERT INTO zosd_taxifact
        (mandt, fact_id, pickup_day, pickup_hour, borough, pickup_zone, payment, trips, fare, tip, distance)
        SELECT mandt, fact_id, pickup_day, pickup_hour, borough, pickup_zone, payment, trips, fare, tip, distance FROM taxi_incoming`);
      await connection.run("COMMIT");
    } catch (error) {
      await connection.run("ROLLBACK");
      throw error;
    }
    return {month, client, rows, trips, durationMs: Date.now() - started, sourceBytes: statSync(parquetFile).size};
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

if (process.argv[1]?.endsWith("import-nyc-taxi.mjs")) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const database = option("--db");
  if (!database) {
    console.error("Usage: node tools/import-nyc-taxi.mjs --db <offline.duckdb> [--month YYYY-MM] [--limit N] [--parquet file] [--zones file]");
    process.exitCode = 2;
  } else {
    try {
      const result = await importTaxiTrips({
        database, month: option("--month") ?? DEFAULT_MONTH,
        limit: option("--limit") === undefined ? undefined : Number(option("--limit")),
        parquet: option("--parquet"), zones: option("--zones"),
      });
      console.log(`NYC TLC: ${result.trips.toLocaleString()} trips in ${result.rows.toLocaleString()} analytical groups from ${result.month}, imported in ${(result.durationMs / 1000).toFixed(1)} s`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
