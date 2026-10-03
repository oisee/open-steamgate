# Trace format v1

Draft for review. Release 0.7, Must. This document proposes a contract;
the writers and readers below still use the unversioned formats.

A consumer that commits generated code and provenance should not acquire a
diff when a template moves and the generated file stays byte-identical.
Absolute template lines and whole-model hashes currently prevent this.

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
does not change the trace. Output `line` is 1-based, one record per physical
line, including blank lines; a final newline does not add a record. Multiple
contributors are represented by `sources`/`locations`, not discarded.
`sources` may be empty for generator-owned text. Every line has a location.

A source location identifies a manifest/rule file, a persistent semantic
node and a selector relative to that node. Named rule/entity/parameter IDs
replace indexes in compiled models. Ordered anonymous clauses need explicit
persistent IDs assigned in the source; ordinal IDs are not stable on insert.
Physical `rule_line`, `param_rule_line`, `set_line` and compiled `path` are
navigation hints in metadata. Readers resolve selectors against the current
or historical source; they must not silently jump to a different node.

Serialization is UTF-8, two-space JSON indentation, LF, final newline, no
timestamps. Key order is exactly the example's order at every level.
Sort outputs by `file`, lines by numeric `line`, sources by
`(file, node, selector)`, locations by `(recipe, anchor, offset)`; strings use
Unicode code point order, not host locale. Deduplicate identical contributors.
Arrays describe provenance sets, not execution order. Reject duplicate output
files/line records and unsupported format versions.

### Template location identity

The author assigns explicit, non-emitting named anchors to emission slots,
such as `class.header`, `method.check.select`, or `ports.factory.case`.
Syntax for template directives and patch records remains to be agreed;
the renderer must validate unique names and require an anchor for all emitted
text. Initial adoption names existing slots once. Never derive anchor names
from physical lines, template hashes or traversal sequence numbers.
The generator attaches the enclosing anchor to each emitting token and carries
it through rendering; patch insertions must declare their own named slots.

`recipe` is the recipe's persistent project-relative file identity. A file
move keeps that identity as an alias within the minor version; metadata names
the current physical file. ABAP-embedded templates and imperative emitters
must declare a corresponding logical recipe file and named slots explicitly.
Partials and overlays retain their own recipe/anchor identities rather than
being numbered in the concatenated template. F's coarse service mappings use
declared service/object slots, not fabricated template line numbers.

`offset` is a zero-based emitted-line ordinal within the named slot for that
source-node invocation, not a count of template lines or tokens. Repeat
invocations are distinguished by source node, never loop index. A slot has
one contiguous emission per invocation. Split a large section into named
slots before independently editable emissions would shift other offsets.
Non-emitting comments, whitespace and control tags do not consume offsets.
Keep existing slot identities when expressions or control structure are
refactored without changing output. Anchor renames are contract changes.

### Metadata

Write optional `<stem>.trace.meta.json` separately, with
`"format": "osd-trace-meta/1"`. Consumers may commit only `.trace.json`.
Metadata contains output content SHA-256 for pairing, whole-model hash,
generator name/version, template/partial/overlay content hashes, rule-version
hashes, physical filenames/lines and compiled paths. Use `sha256:<lowercase
hex>` over UTF-8 bytes for file content; declare the model serialization used
for model hashes. Canonicalize metadata keys lexically and arrays by identity.
Reject mismatched output hashes for navigation; missing metadata does not
prevent stable provenance reads.

Whole-model hashes retain their current meaning during migration. They are
needed for L3 stale checks and alert history; moving them is not permission
to redefine rule versions or change the hash constants in generated ABAP.
An operational/history consumer must retain metadata for each rule version.
A code-and-trace-only consumer can omit it and use source selectors, but then
cannot promise lookup of alerts by historical model hash alone.

## Stability and CI

Within a minor version, a template edit that does not change a generated file
does not change its stable trace.

This comparison holds for fixed source rules/manifests and recipe identities,
across supported generator patch versions. More generally the stable trace
changes only when output bytes or the contributing source rule/provenance
changes. An unrelated manifest edit, source comment or source line movement
must not change this file's trace. A deliberate source-node reassignment can
change provenance even if the generated bytes happen to match.

CI must render representative outputs from every writer above in isolated
temporary trees, then edit non-emitting template whitespace/comments before
and inside anchors, including partials/overlays. First assert generated bytes
are equal, then assert stable trace bytes are equal; metadata may differ.
Use real renderers and serialization, without caches or dropping locations.
Also test unrelated manifest edits/line movement, repeated nodes, host/order
independence, emitted-line coverage, and a positive output-changing edit.
Reader fixtures cover both legacy shapes and v1, plus missing/mismatched
metadata. Register new `test/*.mjs` suites in `test/suites.d/*.json`.
These are proposed checks, not tests executed for this documentation draft.

## Migration and review

Proposed window: readers accept unversioned objects, report bare arrays and
v1 throughout 0.7 and 0.8; remove legacy acceptance no earlier than 0.9.
Ship readers before switching writers. During the window, an explicit legacy
writer mode preserves old shapes for consumers that have not upgraded; do
not mix legacy volatile fields into the stable v1 file.

L3 compilation reads model hashes from metadata with legacy fallback. Explain
searches committed metadata and old sidecars for rule hashes, pairs them with
the historical output/source, then uses selectors/nodes instead of stored
absolute lines. Preserve history tests for both paths. Update L2's template
reconstruction tests to resolve anchors through metadata. Cockpit field tests
and service aggregate handling adopt `outputs`; its UI needs no current
parser migration. Future VS Code provenance support consumes v1 through the
same reader; existing stack-trace navigation remains a separate facility.
Filename consumers must recognize/exclude metadata companions as appropriate.

Review decisions still needed: concrete anchor syntax for templates/patches;
persistent IDs for anonymous source clauses; the legacy-mode default at the
0.7 writer switch; and how operational consumers retain historical metadata
when their ordinary code commits intentionally omit it. The compatibility
window and recipe-move alias policy also need agreement.
