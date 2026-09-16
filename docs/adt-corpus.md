# ADT capture corpus and VSP consumer checks

`tools/adt-corpus.py` turns HTTP JSONL captures into a browsable, reproducible
corpus. It does not contact SAP or OSD. Python 3 is sufficient except for
Brotli decoding, which uses the repository's existing Node runtime (no npm
dependency). `tools/adt-vsp-consume.go` separately exercises the actual VSP
client against captured responses using an injected transport with no network
implementation.

## Build the corpus

From the open-steamgate checkout:

```sh
python3 tools/adt-corpus.py \
  --capture a4h=.local/capture/oracle/a4h-adt.jsonl \
  --capture osd=.local/capture/oracle/osd-adt.jsonl \
  --capture vscode=.local/capture/oracle/osd-plain.jsonl \
  --capture mixed=.local/capture/oracle/cloud-adt.jsonl \
  --vsp ../vsp \
  --export-bodies \
  --out .local/adt-corpus/latest
```

Each `--capture SIDE=FILE` explicitly assigns provenance. `mixed` is indexed
but never silently used as an A4H reference. `--reference` and `--target`
default to `a4h` and `osd`; to compare the VS Code capture, use
`--target vscode`. Input format is the HTTP recorder's `{method,url,request,
response}` envelope with `{bytes,truncated,base64}` bodies. RFC/DIAG JSONL is
not HTTP: such rows are rejected with their file and line, not silently skipped.

Generated files contain original URLs, headers, value examples and source
previews. Keep the output under ignored `.local/`; it is not a sanitized public
fixture. The tool never edits its inputs. Rebuilding replaces generated files
of the same name; unused schema files from earlier builds can remain, but the
new index only links current observations. Use a fresh output directory for a
snapshot intended for review.

| Output | Purpose |
| --- | --- |
| README.md | Resource index, sample counts and links |
| resources/*.md | Request/response variants and structural comparisons per operation |
| schemas/*.json | Full namespace-aware paths, counts, value forms, examples and provenance |
| records.json | Every exchange, request signature, response profile, links, header values and source row |
| bodies/* | Decoded XML, JSON, text or binary, with --export-bodies; linked from resource pages |
| manifest.json | Capture paths, roles, sizes and SHA-256 |
| comparisons.json | Structural and value differences with selected reference/target records |
| correlations.json | Hashed candidate values reused across headers, query and XML/JSON fields |
| errors.json / summary.json | Input failures and summary; unreadable bodies also remain in records |
| VSP.md / vsp.json | Go source URL candidates and XML tags, source line and file hashes |

## What the comparison means

The resource key is method plus an explicit collection-aware URL template.
Object names are replaced only at known collection boundaries. Encoded
namespaces stay within a single URL segment. Package settings are not confused
with package objects; class includes and source/main keep separate addresses.

Inside that resource, variants preserve significant query values, Accept,
request Content-Type, session type, request body shape, response status and
response shape. Only `_`, `lockHandle` and `sap-contextid` query values become
binding placeholders in the request-match signature; originals remain in the
record. This is a conservative grouping, not automatic object mapping.

XML uses `{namespace URI}localName` for both elements and attributes: changing
prefix spelling does not change the schema. Fields retain full parent paths,
observed occurrence counts, value forms, up to three readable examples and
hashes of all distinct observed values. Child-order observations are retained
as values. URI forms distinguish server-root-relative, document-relative,
absolute and network-path references. A string that resembles a GUID, date or
relative path is labelled a candidate, not declared dynamic.

Schema examples come from one representative observation; per-exchange values
and hashes remain in records.json, and --export-bodies preserves full decoded
documents without the display example limit.

These are observed profiles, **not inferred XSD**. Counts are per document,
not a claim of required/minimum cardinality. Different classes can legitimately
have different numbers of includes. Empty collections cannot prove the shape
or readability of their entries. No Unicode source text is equated merely
because it has the same MIME type; decoded body hashes expose content changes.

For every reference variant the tool selects the latest captured target
observation, preferring an exact request signature and then exact URL. The
report explicitly says when either preference could not be satisfied. A
different query/body/object makes this an exploratory comparison, not a test
failure. All older variants remain accessible. `at` denotes completion time;
it is not used to infer causal request order.

Results distinguish `observed-difference`, `observed-content-difference`,
`observed-shape-match`, `empty-observation`, `unreadable`, and
`not-observed-on-target`. A shape match is never named a compatibility pass.
Value differences remain separately available even when shapes match.
For recognized collection roots, absence of item elements is inconclusive;
unrecognized empty-container semantics still need resource-specific rules.

Decode failures, truncation, byte-count mismatches, invalid XML/JSON, unsupported
encoding and non-HTTP rows never become matches. Exit 2 means incomplete input
processing; observed differences alone do not make the corpus command fail.

## Correlations

The report looks for exact value reuse across cookies, CSRF, context, ETag,
conditional headers, request IDs, lock query parameters and candidate body
fields. Raw candidate tokens are replaced with SHA-256 in this report (other
corpus files still contain private data). Matches are scoped to input file.

These are evidence for future bindings, not a completed session correlator.
The old recorder lacks request start/connection metadata, so neither direction
of causality nor concurrent session ownership can be proved. Body candidates
use the retained value examples; the report does not claim exhaustive detection
of arbitrary encoded/embedded tokens. Never globally erase GUID-looking strings
when turning this corpus into replay fixtures.

## Exercise VSP itself

Run the helper in the sibling VSP module so Go imports exactly that checkout.
The report is private. Go dependencies must already be available, or Go may
need its normal module download during compilation.

```sh
go -C ../vsp run ../open-steamgate/tools/adt-vsp-consume.go \
  --out ../open-steamgate/.local/adt-corpus/latest/vsp-consumer.json \
  ../open-steamgate/.local/capture/oracle/a4h-adt.jsonl \
  ../open-steamgate/.local/capture/oracle/osd-adt.jsonl \
  ../open-steamgate/.local/capture/oracle/osd-plain.jsonl \
  ../open-steamgate/.local/capture/oracle/cloud-adt.jsonl
```

Use absolute capture filenames when the resulting report will be joined with
the corpus: `records.json` uses absolute `file:row` references. Alternatively,
the helper resolves filenames to absolute paths itself.

Repeat the corpus command with
`--consumer-report .local/adt-corpus/latest/vsp-consumer.json` to generate
`VSP-CONSUMER.md` and `vsp-consumer-checks.json`.

The helper calls VSP's real search, package, class structure, source reading,
syntax check, unit-test and activation methods where successful recorded
responses exist. It injects an `HTTPDoer` that returns only the fixture for the
selected method/path (object name case is ignored); unexpected requests fail.
CSRF HEAD is synthetic. Request headers, query and bodies produced by VSP are
recorded, but are not claimed identical to the recorded Eclipse request.

This tests response consumption, not authentication, session continuity,
request acceptance by OSD, error-response handling, or live client workflows.
No matching captured operation means **not tested**. No-error Go decoding alone
is not sufficient: the joined report compares counts of returned objects,
messages or source bytes and separately labels empty results inconclusive.
Package grouping nodes with no OBJECT_NAME are intentionally skipped by VSP;
class structure only exposes direct children. Additional structural rows are
reported separately, rather than treated as missing consumer data.

`VSP.md` is a lexical discovery aid: Go string literals, surrounding function
context and XML tags, with comments/tests marked in JSON. It is not a Go AST,
call graph, complete endpoint list, nor proof that a literal is executed.
Dynamic paths and helper calls require source review.

## Tests

```sh
python3 test/adt-corpus.py
go -C ../vsp run ../open-steamgate/tools/adt-vsp-consume.go --self-test
```

Tests cover namespace aliases, wrong parent paths, URI form/cardinality,
invalid XML, text versus XML, truncation/compression, query preservation,
empty results, values beyond the example limit, scoped token reuse and a
complete corpus build preserving failures/history. The Go self-test verifies
malformed XML rejection, nonempty search decoding and unexpected-route refusal.
