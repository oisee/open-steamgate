# Trace format v1

Contract agreed per review. Phase 1 is Release 0.7, Must; Phase 2 adds named
anchors per writer in 0.8. Phase 1 is implemented: writers default to v1 and readers accept both v1
and the unversioned formats. Named anchors remain planned for 0.8.

A consumer that commits generated code and provenance should not acquire a
diff when a template moves and the generated file stays byte-identical,
within the phased stability scope below. Absolute template lines and
whole-model hashes currently prevent this.

## Inventory at the branch base

Inspected locally at `053710041` (the local `origin/main`), using
`rg -n 'trace\.json|template_line' tools recipes editors test` and following
the render/sidecar calls into `src/dsl/` and `src/segw/`. No generators ran.
The letters below identify writers, including functions returning file maps
that their caller writes to disk.

| Writer | Outputs and construction |
| --- | --- |
| A: `tools/dsl-mpc.mjs`, `tools/dsl-dpc.mjs` | `<class>.clas.trace.json`; `ZCL_OSD_DSL_TRACE.sidecar` serializes the engine trace and hashes the model. |
| B: `tools/dsl-l2.mjs` | Check and testclasses sidecars beside ABAP, including `src/l2demo/`; local `sidecar` adds nearest-node rule provenance and rendered-model hash. |
| C: `tools/dsl-l3.mjs` | Runner, job, settings and generated ports/adapters/interfaces; local `sidecar` adds set/rule provenance, rule hashes and overlay declarations. |
| D: `tools/dsl-l3-doctor-overlay.mjs` | Doctor report and daemon sidecars; delegates to C's `sidecar`. |
| E: `tools/dsl-l3-remote.mjs` | Remote seam ABAP sidecars; `{source, recipe, lines}` from `renderRecipe`. |
| F: `tools/dsl-l3-cockpit.mjs` | Service aggregate `<project>.service.trace.json`, plus `<filename>.trace.json` for YAML, extension ABAP/XML and cockpit pages/assets. Extension uses the engine; other entries use synthetic template lines equal to output lines. |
| G: `tools/dsl-samc.mjs` | SAMC/SAPC XML `<out>.trace.json`; engine trace enriched by `dsl-daemons.traceNodes`. Here `model` is an input filename, not a hash. |
| H: `tools/dsl-report.mjs` | Help, manpage and Go argument `<out>.trace.json`; a bare array of engine entries, enriched with nearest node and sometimes contributing `nodes`. |
| I: `src/segw/zcl_stg_segw_gen.clas.abap` | Served `GenerateSet` MPC/DPC sidecars; same serializer as A. `tools/segw-tree.mjs generate --out` copies the returned file map. |

There are no sidecar writers in `recipes/`: its files are inputs, including
cockpit JavaScript copied/rendered by F. `tools/segw-gen.mjs` and
`tools/stg-compile.mjs` do not themselves emit traces at this revision.
F supplies coarse service provenance around stg-compile's output. I is the
ABAP SEGW path, distinct from the JS generator used as its test oracle.
`dsl-build`, `dsl-abap`, `dsl-daemons` and `dsl-regions` expose in-memory
traces; they are not additional `.trace.json` writers.

Readers are narrower than the generated file coverage:

- `tools/dsl-l3.mjs compileSet` reads B's `model` to reject stale checks.
  `ruleVersion`/`explainAlert` read `model`, `rule`, `lines[].rule_line`,
  `lines[].line` and runner `lines[].node`; historical lookup uses Git
  pickaxe on the model hash in the committed sidecar.
- Cockpit generation writes traces; cockpit UI recipes/pages do not parse
  them. `test/dsl-l3-cockpit.mjs` reads `lines` and `set_line`.
- No `.trace.json`, `template_line` or DSL sidecar reader was found under
  `editors/`. Its debugger stack traces are a different facility.
- `test/dsl-mpc.mjs`, `dsl-dpc.mjs`, `dsl-l2.mjs`, `dsl-l3.mjs`,
  `dsl-daemons.mjs`, `dsl-report.mjs`, `segw-tree.mjs` and the ABAP trace
  unit test assert fields, coverage and provenance. L2 also reconstructs
  output using `template` and `template_line`; `lift-r1.mjs` checks an
  in-memory template line. L3 governor/sim/replay/stages/resilience/chaos
  suites inspect provenance, overlay fields or compare generated file maps.
- `tools/osd-inputs.mjs` recognizes web sidecar filenames to avoid treating
  them as ABAP objects. ZIP/BSP/input and SEGW repo tests include or exclude
  sidecars as files; `ZCL_STG_SEGW_REPO` strips class traces from deployment.
  These are filename consumers, not field readers.

### Existing fields and sensitivity

All fields emitted by these writers are listed below. T = tests above;
L = L3 compilation/explain; none = no production field reader found.
Columns a/b/c mean: (a) template text moves, output unchanged;
(b) manifest/model changes, this output unchanged; (c) output changes.
`may` is conditional, not a promise that the field changes on every edit.
Parent containers change when a child changes. Paths themselves are assumed
unchanged in a; renaming a file is a separate provenance change.

| Field | Writers | Readers | a | b | c |
| --- | --- | --- | --- | --- | --- |
| `generator` | A B C D F G I | T | no | no | no |
| top-level `template` | A B C D F G I | T (L2 opens file) | no | may (selected recipe) | may |
| `rule`, `set`, `source` | B; C D F; E respectively | L (`rule`), T | no | may (source identity) | may |
| `recipe` | E | none / file-map tests | no | may | may |
| `model` hash | A B C D F I | L, T | no by itself | yes if hashed representation changes | may |
| `model` filename | G | none | no | no unless renamed | no unless renamed |
| `rules` keys, `.file`, `.class` | C D when model has rules | T / file-map comparisons | no | may | may |
| `rules.*.model` | C D | T / file-map comparisons | no by itself | may (referenced rule hash) | may |
| `overlay` | C D | T / file-map comparisons | no | may (feature selection) | may |
| `doctor_overlay`, `sim_overlay`, `replay_overlay`, `snapshot_overlay`, `remote_overlay` | C D as applicable | T (sim/replay explicit assertions; others file maps) | no | may | may |
| `lines` | A B C D E F G I | L, T | may | may | may |
| bare root array | H | T | may | may | may |
| `objects` filename keys and entry arrays | F aggregate | none / file-map tests | no for synthetic entries | may | may |
| entry `line` | all | L, T | no | no for identical output | may (line count/order) |
| entry `template_line` | all | T; profile/regions use in-memory equivalent | yes for engine entries; no for F synthetic entries | may (render branch) | may |
| entry `template` | G H (engine name, usually `template.tpl`/`main`) | T / whole-array comparisons | no | may (partial selection) | may |
| entry `path` | A B C D E G H; F extension only | T; nearest-node resolution before writing | no | may (indexes/compiled tree) | may |
| entry `node` | all | L, T | no | may (node identity/selection) | may |
| entry `nodes` | H (radio/argument contributors) | T | no | may | may |
| entry `rule_line`, `param_rule_line` | B; C D have `rule_line` when applicable | L (`rule_line`), T | no | may (manifest lines move) | may |
| entry `set_line`, `rule_file` | C D; F has `set_line` | T; explain uses node/line mappings | no | may | may |

Template movement alone does not enter the current model hash calculation.
It can accompany a compiler/model change, producing both kinds of churn.
L3 embeds referenced rule hashes in runner ABAP and alert identities: changing
one can change output too. Trace stability must not hide that output change.
Tool versions and template content hashes are proposed metadata, not fields
currently emitted by the inventoried serializers.

## Contract

Each generated file gets one stable `<stem>.trace.json`. Keep existing stems
(`.clas.trace.json`, `.clas.abap.trace.json`, `<asset>.trace.json`) during
migration. An aggregate service trace uses the same format with multiple
outputs. No hash, version of the generator or physical template/source line
belongs in this file.

```json
{
  "format": "osd-trace/1",
  "outputs": [
    {
      "file": "zcl_example.clas.abap",
      "lines": [
        {
          "line": 1,
          "sources": [
            {"file": "example.l2.yaml", "node": "rule/example", "selector": "/class"}
          ],
          "locations": [
            {"recipe": "recipes/l2-check/template.tpl", "anchor": "class.header", "offset": 0}
          ]
        }
      ]
    }
  ]
}
```

`file` paths use `/` and are relative to a declared project root, never an
absolute worktree path. The consumer supplies that root; moving a checkout
does not change the trace. For ABAP, `outputs[].file` is the abapGit file name
the object store serves, including the include suffix, with the same naming
and 1-based physical `line` as the runtime and debugger. Execution traces
recording ABAP object, include and line join provenance on this file and line
without a mapping table.

Every physical output line, including blank lines, has provenance; a final
newline does not add a line. A single-line record uses `"line": 1`. Consecutive
lines with identical sources and location identities use a run-length range
instead, with inclusive endpoints:

```json
{
  "lines": [1, 3],
  "sources": [
    {"file": "example.l2.yaml", "node": "rule/example", "selector": "/class"}
  ],
  "locations": [
    {"recipe": "recipes/l2-check/template.tpl", "anchor": "<partial>", "offset": 0}
  ]
}
```

A record has exactly one of `line` or `lines`. In a range, each location's
`offset` is the offset of the first line; line `n` has offset
`offset + n - a` for `"lines": [a, b]`. Coalesce maximal consecutive runs
with the same source tuples and recipe/anchor identities only when every
location offset advances by one per line. Do not coalesce across invocations
or slot boundaries. Singletons use `line`; ranges require `a < b`. Readers
expand ranges for line lookup, preserving the same information as individual
records while reducing committed JSON size.

Multiple contributors are represented by `sources`/`locations`, not discarded.
`sources` may be empty for generator-owned text. Every line has a location.
A source node may appear more than once on a line with different selectors;
deduplicate sources by the full `(file, node, selector)` tuple.

A source location identifies a manifest/rule file, a persistent semantic
node and a selector relative to that node. Named rule/entity/parameter IDs
replace indexes in compiled models. Anonymous clauses require author-assigned
persistent IDs only where clauses are reorderable; otherwise their ID is the
ordinal within the parent node. Inserting into an ordinal list can change
later identities; reorderable lists use persistent IDs to avoid that churn.
Physical `rule_line`, `param_rule_line`, `set_line` and compiled `path` are
navigation hints in metadata. Readers resolve selectors against the current
or historical source; they must not silently jump to a different node.

Serialization is UTF-8, two-space JSON; scalar arrays and flat objects inline;
LF, final newline, no timestamps. Arrays whose elements are all scalars and
objects whose values are all scalars use one line, with `, ` between items
and `: ` after keys. Containers holding a non-scalar stay multi-line.
Integers use decimal digits, no exponent and no leading zeros
except the value `0`. Key order is exactly the examples' order at every level;
`lines` replaces `line` in the same position for a range record.
Sort outputs by `file`, line records by numeric first line, sources by
`(file, node, selector)`, locations by `(recipe, anchor, offset)`; strings use
Unicode code point order, not host locale. Deduplicate locations by the full
`(recipe, anchor, offset)` tuple. Arrays describe provenance sets, not
execution order. Reject duplicate output files, duplicate or overlapping line
records, invalid ranges and unsupported format versions.

### Template location identity

In Phase 1 (0.7), a writer without real named anchors uses the recipe/partial
file plus one implicit slot per partial: `"anchor": "<partial>"`. The offset
counts emitted lines inside that partial for the source-node invocation.
The top-level recipe is treated as a partial too. This coarse location avoids
physical template lines without requiring all nine writers to adopt named
slots before 0.7 can ship.

In Phase 2 (0.8), writers adopt real named anchors one at a time. The author
assigns explicit, non-emitting anchors to emission slots, such as
`class.header`, `method.check.select`, or `ports.factory.case`. Anchors use the
engine's existing `{{! ... }}` non-emitting comment-tag form, already present
in `src/dsl/dpc-templates/class.tpl` and other recipe partials:
`{{! anchor class.header }}`. Patch insertions use the same tag in inserted
template text. Interpret the `anchor` comment convention without a new lexer.
For each converted writer, the renderer validates unique names within each
recipe/partial and requires named anchors for all emitted text. Initial
adoption names existing slots once. Never derive anchor names from physical
lines, template hashes or traversal sequence numbers. The generator attaches
the enclosing anchor to each emitting token and carries it through rendering;
patch insertions declare their own named slots.

`recipe` is the recipe's persistent project-relative file identity. A file
move keeps that identity through a recipe-move alias map in metadata, mapping
the old identity to the current physical file, valid for one minor version.
After that window, changing the identity is a provenance change.
ABAP-embedded templates and imperative emitters declare a corresponding
logical recipe file, initially with `<partial>` and then explicit named slots
when their writer converts. Partials and overlays retain their own
recipe/anchor identities rather than being numbered in the concatenated
template. F's coarse service mappings use logical recipe files with
`<partial>` initially, then declared service/object slots, not fabricated
template line numbers.

`offset` is a zero-based emitted-line ordinal within the slot for that
source-node invocation, not a count of template lines or tokens. Repeat
invocations are distinguished by source node, never loop index. A named slot
has one contiguous emission per invocation. Split a large section into named
slots before independently editable emissions would shift other offsets.
Non-emitting comments, whitespace and control tags do not consume offsets.
Keep existing slot identities when expressions or control structure are
refactored without changing output. Anchor renames are contract changes;
the planned replacement of `<partial>` with named slots can change provenance
when a writer converts in 0.8.

### Metadata

Write optional `<stem>.trace.meta.json` separately, with
`"format": "osd-trace-meta/1"`. Only operational/history consumers commit
metadata; code-and-trace-only consumers commit `.trace.json` and omit meta.
In this repository, retain metadata only for L3 outputs and the L2 check
classes referenced by L3 sets, whose rule versions drive L3 staleness checks
and alert history. Other metadata, including L2 testclass companions, is
ignored and regenerated locally for navigation tests.
Metadata contains output content SHA-256 for pairing, whole-model hash,
generator name/version, template/partial/overlay content hashes, rule-version
hashes, physical filenames, `template_line`, `rule_line`, `param_rule_line`,
`set_line`, compiled `path` and the recipe-move alias map. These volatile
fields move out of the stable trace in Phase 1. Metadata paths are also
project-relative. Use `sha256:<lowercase hex>` over UTF-8 bytes for file
content; declare the model serialization used for model hashes. Canonicalize
metadata keys lexically and arrays by identity; serialize as two-space JSON;
scalar arrays and flat objects inline, using the same serializer and integer
formatting as the stable trace. Reject mismatched output hashes for
navigation; missing metadata does not prevent stable provenance reads.

Whole-model hashes retain their current meaning during migration. They are
needed for L3 stale checks and alert history; moving them is not permission
to redefine rule versions or change the hash constants in generated ABAP.
An operational/history consumer commits metadata for each rule version.
A code-and-trace-only consumer uses source selectors, but cannot promise
lookup of alerts by historical model hash alone.

## Stability and CI

Phase 1 (0.7) ships the v1 shape, metadata split, project-relative paths,
deterministic serialization, legacy-plus-v1 readers and the CI invariant.
Named anchors across all writers are not a 0.7 prerequisite. With coarse
`<partial>` locations, the invariant covers edits outside the partial whose
provenance is being compared: unchanged output keeps unchanged provenance
for untouched partials. A whole-file stable trace must remain byte-identical
when the edited partial contributes no lines to that output. Edits inside a
contributing partial can change its coarse locations even if output is
unchanged; Phase 1 does not promise stability within that touched partial.

Phase 2 (0.8) converts writers A–I one at a time to named anchors. Once a
writer is converted, a template edit that does not change a generated file
does not change its stable trace within a minor version, with slot identities
held fixed. Each conversion gets its own invariant checks.

These comparisons hold for fixed source rules/manifests and recipe identities,
across supported generator patch versions. Within the applicable phase scope,
the stable trace changes only when output bytes or contributing source
rule/provenance changes. An unrelated manifest edit, source comment or source
line movement must not change this file's trace. A deliberate source-node
reassignment can change provenance even if generated bytes happen to match.

CI must render representative outputs from every writer above in isolated
temporary trees. In Phase 1, edit non-emitting whitespace/comments outside
the partial being compared, including parent recipes and sibling
partials/overlays. First assert generated bytes are equal, then assert stable
provenance for untouched partials is equal; compare whole stable trace bytes
when the touched partial contributes no output lines. For each named-anchor
writer in Phase 2, also edit before and inside anchors and compare the whole
stable trace byte-for-byte. Metadata may differ in either phase. Use real
renderers and serialization, without caches or dropping locations.
Also test unrelated manifest edits/line movement, repeated nodes with distinct
selectors, host/order independence, emitted-line coverage, maximal ranges and
their offset expansion, and a positive output-changing edit.
Reader fixtures cover both legacy shapes and v1, plus missing/mismatched
metadata. An execution-join fixture serves `zcl_example.clas.abap` through the
object store, records a runtime/debugger position for object `ZCL_EXAMPLE`,
its main include and line 1, and asserts that the file/line pair directly
selects the first provenance record above. Include a testclasses include
fixture using `zcl_example.clas.testclasses.abap` to check include naming too.
Register new `test/*.mjs` suites in `test/suites.d/*.json`.
The contract and Phase 1 invariants are exercised by `test/trace-v1.mjs`;
writer-specific navigation and history checks remain in the DSL suites.

## Migration and decisions

Ship readers before switching writers. Readers accept unversioned objects,
report bare arrays and v1 throughout 0.7 and 0.8; remove legacy acceptance no
earlier than 0.9. At the 0.7 writer switch, v1 is the default. Legacy writing
is an explicit opt-in via `OSD_TRACE_LEGACY=1` or a `--trace-legacy` flag for
one minor version (0.7); remove the writer opt-in in 0.8. Do not mix legacy
volatile fields into the stable v1 file.

### Breaking for consumers

The 0.7 default writer switch changes the unversioned shapes to
`"format": "osd-trace/1"` with `outputs`, source selectors and coarse locations.
Line records can contain inclusive ranges. Hashes and physical navigation
fields move to `.trace.meta.json`. Consumers must upgrade their readers or
explicitly opt into legacy writing during 0.7. The current external consumer,
osg-demo, pins a tag in `book/baseline.yaml`; it must migrate before advancing
that pin to the writer switch. This repository's field readers and fixtures
must migrate too.

L3 compilation reads model hashes from metadata with legacy fallback. Explain
searches committed metadata and old sidecars for rule hashes, pairs them with
the historical output/source, then uses selectors/nodes instead of stored
absolute lines. Preserve history tests for both paths. Update L2's template
reconstruction tests to resolve coarse locations and then named anchors
through metadata. Cockpit field tests and service aggregate handling adopt
`outputs`; its UI needs no current parser migration. Future VS Code provenance
support consumes v1 through the same reader; existing stack-trace navigation
uses the same output file/line key. Filename consumers must recognize/exclude
metadata companions as appropriate.

The review decisions are settled: 0.7 uses coarse partial anchors and 0.8
adopts named anchors per writer; anchor syntax uses the existing `{{! ... }}`
non-emitting tags; reorderable anonymous clauses use author-assigned IDs and
other anonymous clauses use parent ordinals; v1 is the default with one minor
version of legacy writer opt-in; only operational consumers commit metadata;
and recipe moves use a metadata alias map valid for one minor version.
