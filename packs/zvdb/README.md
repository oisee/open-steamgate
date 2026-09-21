# ZVDB 100

An isolated open-steamgate pack for deterministic 8–1536-bit binary-vector
search. It is the successor experiment to the archived `ZVDB_002` and
`ZVDB_03` prototypes; none of their SAP GUI reports or incomplete search
classes are loaded.

**Experiment verdict: successful.** The pack demonstrates that the same
compact sign-bit vectors can produce a useful semantic shortlist through
portable ABAP on any supported database and through native SQLScript on HANA,
with identical ranks for the checked corpora. It is a research workbench, not
a production classifier: one global Hamming threshold is not presented as a
reliable accept/reject decision.

The public contract is one rank for both engines:

```text
hamming = popcount(candidate XOR query)
rank    = dimensions - 2 * hamming
```

`ZCL_VDB_100_ANYDB` reads candidates with Open SQL and computes the rank in
ABAP. Vectors are stored in `QBITS RAW(192)` with their active size in
`DIMS`; on SAP HANA this is physically `VARBINARY(192)`. `ZCL_VDB_100_HANA`
executes the equivalent expression as a read-only
AMDP using HANA `BITXOR` and `BITCOUNT`. `ZCL_VDB_100_FACTORY` selects HANA
only when `sy-dbsys = 'HDB'`; callers use the same interface in either mode.
The OData search also accepts `Engine eq 'ANYDB'` or `Engine eq 'HANA'`, so
the two implementations can be compared on the same committed rows.

The UI5 workbench replaces the useful part of the old query reports. Its
resizable Master pane searches the selected bucket on the server, labels the
known intent groups and can take a random sample across twenty distinct
groups. The Detail pane ranks the selected query through `ZVDB_100_SRV` and
can switch between the portable and database-native engines.

Two ready-to-search buckets travel with the pack as abapGit TABU content:

| bucket | model | rows | bits |
| --- | --- | ---: | ---: |
| `EGEMMA768` | `embeddinggemma:300m-qat-q4_0` | 2,002 | 768 |
| `QWEN31024` | `qwen3-embedding:0.6b` | 2,002 | 1,024 |

They contain exactly the same deterministic subset of the CC BY 4.0 MASSIVE
1.1 corpus. The first 1,000 texts cover 20 intents in English, Russian,
German, French and Spanish. Another 1,002 texts cover 20 different intents
as 334 linked triples: English, Russian and a deterministic Latin-script
transliteration of that Russian text. Thus model, quantization and
cross-script quality can be measured against labels fixed before embedding.
`fixtures/MASSIVE-NOTICE.md` carries attribution.

```sh
# Re-select the 2,002 texts from an extracted official MASSIVE 1.1 archive.
MASSIVE_DIR=/path/to/1.1/data npm run zvdb:massive

# Rebuild both corpora, the quality report and TABU rows with Ollama.
OLLAMA_HOST=http://host:11434 npm run zvdb:benchmark

# Require the portable ABAP and HANA/AMDP rankings to match a corpus exactly.
ZVDB_CORPUS=packs/zvdb/fixtures/corpus.embeddinggemma-768.json npm run zvdb:oracle
ZVDB_CORPUS=packs/zvdb/fixtures/corpus.qwen3-1024.json npm run zvdb:oracle
```

`fixtures/benchmark-report.json` compares cosine ranking before quantization
with the one-bit ranking. `npm run zvdb:corpus` remains the small 256-bit
smoke-corpus generator. Embedding-provider and answer-generation buttons are
deliberately absent from the runtime: embeddings are reproducible build data,
not an implicit network dependency of the ABAP application.

The **Vector quality** tile has two deliberately different modes in its
contract:

- **Published** displays the committed, reproducible benchmark report without
  contacting an embedding service or recomputing millions of pairs.
- **Live** is reserved for a bounded asynchronous benchmark of the current
  database, with progress, cancellation and an immutable result record. It is
  not implemented by this experiment and the UI must not imply otherwise.

A production continuation would use Hamming distance only for candidate
selection, then rerank the shortlist with the original float vectors and make
a calibrated, bucket/version-specific decision (including an `UNKNOWN`
outcome). That work is intentionally outside this experiment.

This pack adds `ZVDB_100_VEC` to the generated schema. A pre-pack SQLite file
is preserved under its schema fingerprint and replaced by a fresh database.
Existing persistent HANA and DuckDB schemas are refused with a list of missing
tables: use a fresh HANA schema or DuckDB file for the experiment. Automatic
schema migration is intentionally not part of the prototype.
