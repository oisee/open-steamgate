#!/usr/bin/env node
// Generate a reproducible semantic corpus for the ZVDB ANYDB/HANA oracle.
// The float embeddings never enter ABAP: their signs become one bit each,
// and both engines compare the exact same canonical uppercase hex value.
import {readFileSync, writeFileSync, mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";

const root = resolve(new URL("../", import.meta.url).pathname);
const source = resolve(process.argv[2] ?? `${root}/packs/zvdb/fixtures/texts.json`);
const target = resolve(process.argv[3] ?? `${root}/packs/zvdb/fixtures/corpus.embeddinggemma-256.json`);
const model = process.env.OLLAMA_EMBED_MODEL ?? "embeddinggemma:300m-qat-q4_0";
const dimensions = Number(process.env.OLLAMA_EMBED_DIMS ?? 256);
const host = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");

if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 1536 || dimensions % 8 !== 0) {
  throw new Error("OLLAMA_EMBED_DIMS must be a multiple of 8 from 8 through 1536");
}
const rows = JSON.parse(readFileSync(source, "utf8"));
if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${source}: expected a non-empty JSON array`);

const response = await fetch(`${host}/api/embed`, {
  method: "POST",
  headers: {"content-type": "application/json"},
  body: JSON.stringify({model, input: rows.map((row) => row.payload), dimensions, truncate: false}),
});
if (!response.ok) throw new Error(`Ollama embed: ${response.status} ${await response.text()}`);
const body = await response.json();
if (body.embeddings?.length !== rows.length) throw new Error("Ollama returned the wrong number of embeddings");

const tags = await fetch(`${host}/api/tags`).then((r) => r.ok ? r.json() : {models: []});
const installed = tags.models?.find((entry) => entry.name === model || entry.model === model);
const asHex = (vector) => {
  if (vector.length !== dimensions || vector.some((n) => !Number.isFinite(n))) {
    throw new Error(`expected ${dimensions} finite components, got ${vector.length}`);
  }
  const bytes = Buffer.alloc(dimensions / 8);
  for (let bit = 0; bit < vector.length; bit++) {
    if (vector[bit] >= 0) bytes[Math.floor(bit / 8)] |= 1 << (7 - bit % 8);
  }
  return bytes.toString("hex").toUpperCase();
};
const hamming = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = Number.parseInt(a.slice(i, i + 2), 16) ^ Number.parseInt(b.slice(i, i + 2), 16);
    while (x !== 0) { n += x & 1; x >>>= 1; }
  }
  return n;
};
const vectors = rows.map((row, index) => ({
  id: String(row.id).toUpperCase(), payload: String(row.payload),
  bucket: "SEMANTIC", model, dimensions, vectorHex: asHex(body.embeddings[index]),
}));
const expected = Object.fromEntries(vectors.map((query) => [query.id,
  vectors.map((candidate) => ({
    id: candidate.id,
    rank: dimensions - 2 * hamming(query.vectorHex, candidate.vectorHex),
  })).sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id)),
]));

const corpus = {
  format: "zvdb-sign-corpus/v1",
  source: source.slice(root.length + 1),
  model,
  modelDigest: installed?.digest ?? null,
  dimensions,
  quantization: "component >= 0 => 1; bits packed most-significant first",
  rank: "dimensions - 2 * popcount(candidate XOR query)",
  vectors,
  expected,
};
mkdirSync(dirname(target), {recursive: true});
writeFileSync(target, JSON.stringify(corpus, null, 2) + "\n");
console.log(`zvdb-corpus: ${vectors.length} texts -> ${dimensions} bits with ${model} -> ${target}`);
