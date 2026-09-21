#!/usr/bin/env node
// Seed one canonical embedding corpus through OData, then require the
// portable ABAP and HANA/AMDP implementations to return the same full order.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const root = resolve(new URL("../", import.meta.url).pathname);
const base = (process.env.ZVDB_URL ?? process.argv[2] ?? "http://127.0.0.1:8050")
  .replace(/\/$/, "") + "/sap/opu/odata/sap/ZVDB_100_SRV";
const corpusFile = resolve(process.env.ZVDB_CORPUS ?? process.argv[3]
  ?? `${root}/packs/zvdb/fixtures/corpus.embeddinggemma-256.json`);
const corpus = JSON.parse(readFileSync(corpusFile, "utf8"));
const engines = (process.env.ZVDB_ENGINES ?? "ANYDB,HANA").split(",").map((one) => one.trim()).filter(Boolean);
const concurrency = Number(process.env.ZVDB_SEED_CONCURRENCY ?? 8);
const shouldSeed = process.env.ZVDB_SEED !== "0";
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("ZVDB_SEED_CONCURRENCY must be a positive integer");

async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: {accept: "application/json", "content-type": "application/json", ...options.headers},
  });
  const text = await response.text();
  let body;
  try { body = text === "" ? undefined : JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

const key = (row) => `(Bucket='${row.bucket}',Id='${row.id}')`;
async function upsert(row) {
  const entity = {
    Bucket: row.bucket, Id: row.id, Dimensions: row.dimensions,
    VectorHex: row.vectorHex, Payload: row.payload, Model: row.model,
  };
  let exists = true;
  try { await request(`/VectorSet${key(row)}?$format=json`); } catch (error) {
    if (!String(error.message).includes(": 4")) throw error;
    exists = false;
  }
  await request(exists ? `/VectorSet${key(row)}` : "/VectorSet", {
    method: exists ? "PUT" : "POST", body: JSON.stringify(entity),
  });
}
if (shouldSeed) {
  let seeded = 0;
  for (let offset = 0; offset < corpus.vectors.length; offset += concurrency) {
    await Promise.all(corpus.vectors.slice(offset, offset + concurrency).map(upsert));
    seeded += Math.min(concurrency, corpus.vectors.length - offset);
    if (seeded % 100 === 0 || seeded === corpus.vectors.length) {
      console.log(`zvdb-oracle: seeded ${seeded}/${corpus.vectors.length}`);
    }
  }
}

const search = async (query, engine) => {
  const filter = `Bucket eq '${query.bucket}' and QueryId eq '${query.id}' and Engine eq '${engine}'`;
  const top = corpus.expected[query.id].length;
  const body = await request(`/SearchResultSet?$filter=${encodeURIComponent(filter)}&$top=${top}&$format=json`);
  return (body?.d?.results ?? []).map((row) => ({id: row.ResultId, rank: Number(row.Rank), engine: row.Engine}));
};

const byId = new Map(corpus.vectors.map((row) => [row.id, row]));
const queries = corpus.queryIds === undefined
  ? corpus.vectors
  : corpus.queryIds.map((id) => byId.get(id) ?? (() => { throw new Error(`query ${id} is absent from vectors`); })());
let checked = 0;
for (const query of queries) {
  const expected = corpus.expected[query.id].map(({id, rank}) => ({id, rank}));
  const strip = (rows) => rows.map(({id, rank}) => ({id, rank}));
  for (const engine of engines) {
    const actual = await search(query, engine);
    if (JSON.stringify(strip(actual)) !== JSON.stringify(expected)) {
      throw new Error(`${query.id}: ${engine} differs from corpus\n${JSON.stringify(actual)}\n${JSON.stringify(expected)}`);
    }
  }
  checked++;
  if (checked % 20 === 0 || checked === queries.length) {
    console.log(`zvdb-oracle: checked ${checked}/${queries.length}`);
  }
}

console.log(`zvdb-oracle: ${corpus.vectors.length} vectors, ${queries.length} queries, ${engines.join(" = ")} = ${corpus.model}/${corpus.dimensions}`);
