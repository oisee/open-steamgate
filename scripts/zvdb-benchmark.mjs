#!/usr/bin/env node
// Embed the same labeled MASSIVE subset with two models, evaluate float
// cosine against one-bit sign vectors, and emit canonical corpora plus the
// abapGit TABU rows that OSG and A4H ingest.
import {readFileSync, writeFileSync, mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";

const root = resolve(new URL("../", import.meta.url).pathname);
const sourceFile = resolve(process.env.ZVDB_BENCHMARK_TEXTS
  ?? `${root}/packs/zvdb/fixtures/benchmark-texts.massive.json`);
const outDir = resolve(process.env.ZVDB_BENCHMARK_DIR
  ?? `${root}/packs/zvdb/fixtures`);
const tabuFile = resolve(process.env.ZVDB_TABU_FILE
  ?? `${root}/packs/zvdb/data/zvdb_100_vec.tabu.json`);
const host = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const batchSize = Number(process.env.ZVDB_EMBED_BATCH ?? 100);
const topK = 10;
const oracleK = 20;
const models = [
  {model: "embeddinggemma:300m-qat-q4_0", dimensions: 768, bucket: "EGEMMA768", file: "corpus.embeddinggemma-768.json"},
  {model: "qwen3-embedding:0.6b", dimensions: 1024, bucket: "QWEN31024", file: "corpus.qwen3-1024.json"},
];
if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("ZVDB_EMBED_BATCH must be a positive integer");

const source = JSON.parse(readFileSync(sourceFile, "utf8"));
const rows = source.rows;
if (!Array.isArray(rows) || rows.length < 1000) throw new Error(`${sourceFile}: expected at least 1000 rows`);
const queryRows = rows.filter((row) => /P(01|06)L[1-5]$/.test(row.id));
if (queryRows.length < 200) throw new Error(`expected at least 200 stratified queries, got ${queryRows.length}`);

const tagsResponse = await fetch(`${host}/api/tags`);
if (!tagsResponse.ok) throw new Error(`Ollama tags: ${tagsResponse.status} ${await tagsResponse.text()}`);
const tags = await tagsResponse.json();
const installed = new Map((tags.models ?? []).flatMap((entry) => [[entry.name, entry], [entry.model, entry]]));
const popcount = Uint8Array.from({length: 256}, (_, n) => {
  let count = 0;
  while (n) { count += n & 1; n >>>= 1; }
  return count;
});
const round = (n) => Number(n.toFixed(4));
const mean = (values) => values.reduce((sum, n) => sum + n, 0) / values.length;
const ratio = (a, b) => b === 0 ? 0 : a / b;

function signBytes(vector, dimensions) {
  if (vector.length !== dimensions || vector.some((n) => !Number.isFinite(n))) {
    throw new Error(`expected ${dimensions} finite components, got ${vector.length}`);
  }
  const bytes = new Uint8Array(dimensions / 8);
  for (let bit = 0; bit < dimensions; bit++) {
    if (vector[bit] >= 0) bytes[Math.floor(bit / 8)] |= 1 << (7 - bit % 8);
  }
  return bytes;
}

function hex(bytes) {
  return Buffer.from(bytes).toString("hex").toUpperCase();
}

function binaryScore(a, b, dimensions) {
  let distance = 0;
  for (let i = 0; i < a.length; i++) distance += popcount[a[i] ^ b[i]];
  return dimensions - 2 * distance;
}

function cosine(a, b, norms, ai, bi) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot / (norms[ai] * norms[bi]);
}

function rankingMetrics(query, ranked) {
  const first = ranked.findIndex((candidate) => candidate.intent === query.intent) + 1;
  const fine = ranked.slice(0, topK).filter((candidate) => candidate.intent === query.intent).length / topK;
  const coarse = ranked.slice(0, topK).filter((candidate) => candidate.scenario === query.scenario).length / topK;
  const cross = ranked.slice(0, topK)
    .filter((candidate) => candidate.intent === query.intent && candidate.locale !== query.locale).length / topK;
  const translationRanks = ranked
    .map((candidate, index) => ({candidate, rank: index + 1}))
    .filter(({candidate}) => candidate.sourceId === query.sourceId && candidate.locale !== query.locale)
    .map(({rank}) => rank);
  const gains = ranked.slice(0, topK).map((candidate) => candidate.intent === query.intent ? 3
    : candidate.scenario === query.scenario ? 1 : 0);
  const dcg = gains.reduce((sum, gain, index) => sum + gain / Math.log2(index + 2), 0);
  const ideal = ranked.map((candidate) => candidate.intent === query.intent ? 3
    : candidate.scenario === query.scenario ? 1 : 0).sort((a, b) => b - a).slice(0, topK);
  const idcg = ideal.reduce((sum, gain, index) => sum + gain / Math.log2(index + 2), 0);
  return {
    intentPrecisionAt10: fine,
    scenarioPrecisionAt10: coarse,
    crossLanguageIntentPrecisionAt10: cross,
    intentMrr: first === 0 ? 0 : 1 / first,
    ndcgAt10: dcg / idcg,
    firstTranslationRank: Math.min(...translationRanks),
    allTranslationsAt10: translationRanks.every((rank) => rank <= topK) ? 1 : 0,
  };
}

async function embed(model) {
  const vectors = [];
  const started = performance.now();
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const response = await fetch(`${host}/api/embed`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        model: model.model,
        input: batch.map((row) => row.payload),
        dimensions: model.dimensions,
        truncate: false,
        keep_alive: "15m",
      }),
    });
    if (!response.ok) throw new Error(`${model.model}: ${response.status} ${await response.text()}`);
    const body = await response.json();
    if (body.embeddings?.length !== batch.length) throw new Error(`${model.model}: wrong embedding count`);
    vectors.push(...body.embeddings);
    console.log(`zvdb-benchmark: ${model.bucket} ${vectors.length}/${rows.length}`);
  }
  return {vectors, seconds: (performance.now() - started) / 1000};
}

function evaluate(floatVectors, bitVectors, model) {
  const norms = floatVectors.map((vector) => Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0)));
  const rowById = new Map(rows.map((row, index) => [row.id, {...row, index}]));
  const aggregates = {float: [], binary: [], overlap: []};
  const labels = source.design.intents;
  const labelIndex = new Map(labels.map((label, index) => [label, index]));
  const matrix = labels.map(() => labels.map(() => 0));
  const retrieval = {tp: 0, fp: 0, fn: 0, tn: 0};
  const expected = {};
  for (const query of queryRows) {
    const qi = rowById.get(query.id).index;
    const floatRanked = rows.map((candidate, index) => ({...candidate, index,
      score: cosine(floatVectors[qi], floatVectors[index], norms, qi, index)}))
      .filter((candidate) => candidate.id !== query.id)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const binaryAll = rows.map((candidate, index) => ({...candidate, index,
      score: binaryScore(bitVectors[qi], bitVectors[index], model.dimensions)}))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const binaryRanked = binaryAll.filter((candidate) => candidate.id !== query.id);
    aggregates.float.push(rankingMetrics(query, floatRanked));
    aggregates.binary.push(rankingMetrics(query, binaryRanked));
    const floatTop = new Set(floatRanked.slice(0, topK).map((candidate) => candidate.id));
    aggregates.overlap.push(binaryRanked.slice(0, topK).filter((candidate) => floatTop.has(candidate.id)).length / topK);
    const relevant = binaryRanked.filter((candidate) => candidate.intent === query.intent).length;
    const retrievedRelevant = binaryRanked.slice(0, topK).filter((candidate) => candidate.intent === query.intent).length;
    retrieval.tp += retrievedRelevant;
    retrieval.fp += topK - retrievedRelevant;
    retrieval.fn += relevant - retrievedRelevant;
    retrieval.tn += binaryRanked.length - relevant - (topK - retrievedRelevant);
    // A direct translation of the same source utterance would make nearest-
    // neighbour classification tautological. Exclude that parallel group.
    const classified = binaryRanked.find((candidate) => candidate.sourceId !== query.sourceId);
    matrix[labelIndex.get(query.intent)][labelIndex.get(classified.intent)]++;
    expected[query.id] = binaryAll.slice(0, oracleK).map((candidate) => ({id: candidate.id, rank: candidate.score}));
  }
  const summarize = (entries) => Object.fromEntries(Object.keys(entries[0])
    .map((key) => [key, round(mean(entries.map((entry) => entry[key])))]));
  const collisions = [];
  let correct = 0;
  for (let actual = 0; actual < labels.length; actual++) {
    correct += matrix[actual][actual];
    for (let predicted = 0; predicted < labels.length; predicted++) {
      if (actual !== predicted && matrix[actual][predicted] > 0) collisions.push({
        actual: labels[actual], predicted: labels[predicted], count: matrix[actual][predicted],
      });
    }
  }
  collisions.sort((a, b) => b.count - a.count || a.actual.localeCompare(b.actual) || a.predicted.localeCompare(b.predicted));
  const precision = ratio(retrieval.tp, retrieval.tp + retrieval.fp);
  const recall = ratio(retrieval.tp, retrieval.tp + retrieval.fn);
  return {
    queries: queryRows.length,
    topK,
    floatCosine: summarize(aggregates.float),
    binarySign: summarize(aggregates.binary),
    binaryFloatTop10Overlap: round(mean(aggregates.overlap)),
    binaryTop10Confusion: {...retrieval, precision: round(precision), recall: round(recall),
      f1: round(ratio(2 * precision * recall, precision + recall)),
      specificity: round(ratio(retrieval.tn, retrieval.tn + retrieval.fp))},
    binaryIntentClassifier: {excludeParallelTranslations: true, accuracy: round(ratio(correct, queryRows.length)),
      labels, matrix, topCollisions: collisions.slice(0, 20)},
    binaryThreshold: thresholdMetrics(bitVectors, model),
    expected,
  };
}

// Treat "same intent" as positive and sweep every attainable Hamming
// threshold. Parallel translations of one source utterance are excluded so
// the result measures semantic generalisation rather than translation lookup.
function thresholdMetrics(bitVectors, model) {
  const positive = Array(model.dimensions + 1).fill(0);
  const negative = Array(model.dimensions + 1).fill(0);
  for (let left = 0; left < rows.length; left++) {
    for (let right = left + 1; right < rows.length; right++) {
      if (rows[left].sourceId === rows[right].sourceId) continue;
      const rank = binaryScore(bitVectors[left], bitVectors[right], model.dimensions);
      const matches = (model.dimensions + rank) / 2;
      (rows[left].intent === rows[right].intent ? positive : negative)[matches]++;
    }
  }
  const totalPositive = positive.reduce((sum, count) => sum + count, 0);
  const totalNegative = negative.reduce((sum, count) => sum + count, 0);
  let tp = 0;
  let fp = 0;
  let previousRecall = 0;
  let previousFpr = 0;
  let previousTpr = 0;
  let averagePrecision = 0;
  let rocAuc = 0;
  let best;
  for (let matches = model.dimensions; matches >= 0; matches--) {
    tp += positive[matches];
    fp += negative[matches];
    const recall = ratio(tp, totalPositive);
    const precision = ratio(tp, tp + fp);
    const fpr = ratio(fp, totalNegative);
    const f1 = ratio(2 * precision * recall, precision + recall);
    averagePrecision += (recall - previousRecall) * precision;
    rocAuc += (fpr - previousFpr) * (previousTpr + recall) / 2;
    previousRecall = recall;
    previousFpr = fpr;
    previousTpr = recall;
    if (best === undefined || f1 > best.f1) {
      best = {matchingBits: matches, similarity: round(matches / model.dimensions), tp, fp,
        fn: totalPositive - tp, tn: totalNegative - fp,
        precision: round(precision), recall: round(recall), f1: round(f1),
        falsePositiveRate: round(fpr)};
    }
  }
  return {excludeParallelTranslations: true, positivePairs: totalPositive, negativePairs: totalNegative,
    averagePrecision: round(averagePrecision), rocAuc: round(rocAuc), bestF1: best};
}

mkdirSync(outDir, {recursive: true});
const report = {
  format: "zvdb-embedding-benchmark-report/v1",
  source: source.source,
  design: source.design,
  queryDesign: `two parallel source utterances per intent: five locales in the 20-intent base and en-US/ru-RU/ru-Latn in the 20-intent extension (${queryRows.length} queries)`,
  models: [],
};
const tabu = [];
for (const model of models) {
  if (!installed.has(model.model)) throw new Error(`${model.model} is not installed at ${host}`);
  const embedded = await embed(model);
  const bits = embedded.vectors.map((vector) => signBytes(vector, model.dimensions));
  const evaluation = evaluate(embedded.vectors, bits, model);
  const vectors = rows.map((row, index) => ({
    ...row,
    bucket: model.bucket,
    model: model.model,
    dimensions: model.dimensions,
    vectorHex: hex(bits[index]),
  }));
  const corpus = {
    format: "zvdb-sign-benchmark-corpus/v1",
    source: source.source,
    design: source.design,
    bucket: model.bucket,
    model: model.model,
    modelDigest: installed.get(model.model)?.digest ?? null,
    dimensions: model.dimensions,
    quantization: "component >= 0 => 1; bits packed most-significant first",
    rank: "dimensions - 2 * popcount(candidate XOR query)",
    queryIds: queryRows.map((row) => row.id),
    vectors,
    expected: evaluation.expected,
  };
  writeFileSync(resolve(outDir, model.file), JSON.stringify(corpus, null, 2) + "\n");
  report.models.push({
    bucket: model.bucket,
    model: model.model,
    modelDigest: corpus.modelDigest,
    dimensions: model.dimensions,
    embedSeconds: round(embedded.seconds),
    ...Object.fromEntries(Object.entries(evaluation).filter(([key]) => key !== "expected")),
  });
  for (const row of vectors) {
    tabu.push({
      mandt: "123", bid: row.bucket, id: row.id, dims: row.dimensions,
      qbits: row.vectorHex, payload: row.payload, model: row.model,
    });
  }
}

mkdirSync(dirname(tabuFile), {recursive: true});
writeFileSync(tabuFile, JSON.stringify(tabu, null, 2) + "\n");
writeFileSync(resolve(outDir, "benchmark-report.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(resolve(root, "packs/zvdb/webapp/quality.json"), JSON.stringify({
  format: report.format, source: report.source, design: report.design,
  models: report.models.map(({bucket, model, dimensions, queries, binarySign, binaryFloatTop10Overlap,
    binaryTop10Confusion, binaryIntentClassifier, binaryThreshold}) => ({bucket, model, dimensions, queries,
    binarySign, binaryFloatTop10Overlap, binaryTop10Confusion, binaryIntentClassifier, binaryThreshold})),
}, null, 2) + "\n");
console.log(`zvdb-benchmark: ${tabu.length} TABU rows -> ${tabuFile}`);
console.log(JSON.stringify(report.models, null, 2));
