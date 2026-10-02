# DSL L1 RFC and search-help proof

Measured by `test/dsl-dpc.mjs` on 2026-10-02. No SAP, MCP, network publishing,
or private corpus was used. Both existing mapping oracles are unchanged.

The bridge covers **15 distinct projects, 17 whole-class cases, 14 distinct
mapped operations / 24 operation instances, 29,691 class lines and 3,533
mapped-body lines**. The duplicated cases are the IWPR/STG forms of
`ZOSD_TEST` and the synthetic mapping project's BOP variant. Four class cases
also render the 18-line search-help interface method (72 interface lines).
Operation counts below include the method opening and closing lines; they
exclude signatures, dispatch calls and separators. All output lines have
exactly one node, and the ABAP profile returns zero findings.

The projects and whole-class line counts are:

| Input | Class lines |
|---|---:|
| `test/fixtures/segw/zstg_label.iwpr.xml` | 550 |
| `test/fixtures/segw/zstg_mapped.iwpr.xml` | 859 |
| `test/fixtures/segw/zstg_mini.iwpr.xml` | 324 |
| `src/zosd_test/segw/zosd_test.iwpr.xml` | 645 |
| `compiled complex` | 550 |
| `src/demo/zstg_demo.stg.yaml` | 1,179 |
| `src/demo_data/zosd_taxi.stg.yaml` | 550 |
| `src/demo_odc/zstg_odc.stg.yaml` | 345 |
| `src/icf/zosd_icf.stg.yaml` | 896 |
| `src/regression/zosd_ref.stg.yaml` | 324 |
| `src/segw/zstg_segw.stg.yaml` | 15,434 |
| `src/status/zosd_status.stg.yaml` | 1,022 |
| `src/zosd_test/segw/zosd_test.stg.yaml` | 645 |
| `gen/cds/zc_stg_travel_cds.stg.yaml` | 887 |
| `packs/zvdb/src/zvdb_100.stg.yaml` | 789 |
| `test/fixtures/dsl-dpc/zl1_mapping.stg.yaml` | 2,346 |
| `compiled mapping with BOP artifact and custom range semantics` | 2,346 |

The mapped operations are:

| Project input | Operation | Body lines |
|---|---|---:|
| `test/fixtures/segw/zstg_mapped.iwpr.xml` | `STATUSVHSET_GET_ENTITYSET` | 155 |
| `test/fixtures/segw/zstg_mapped.iwpr.xml` | `TRAVELSET_GET_ENTITY` | 109 |
| `test/fixtures/segw/zstg_mapped.iwpr.xml` | `TRAVELSET_GET_ENTITYSET` | 210 |
| `src/demo/zstg_demo.stg.yaml` | `STATUSVHSET_GET_ENTITYSET` | 155 |
| `test/fixtures/dsl-dpc/zl1_mapping.stg.yaml` | `EMPTYHELPSET_GET_ENTITY` | 66 |
| `test/fixtures/dsl-dpc/zl1_mapping.stg.yaml` | `EMPTYHELPSET_GET_ENTITYSET` | 111 |
| `test/fixtures/dsl-dpc/zl1_mapping.stg.yaml` | `EMPTYSET_GET_ENTITYSET` | 124 |
| `test/fixtures/dsl-dpc/zl1_mapping.stg.yaml` | `HELPSET_GET_ENTITY` | 85 |
| `test/fixtures/dsl-dpc/zl1_mapping.stg.yaml` | `HELPSET_GET_ENTITYSET` | 174 |
| `test/fixtures/dsl-dpc/zl1_mapping.stg.yaml` | `ITEMSET_CREATE_ENTITY` | 192 |
| `test/fixtures/dsl-dpc/zl1_mapping.stg.yaml` | `ITEMSET_DELETE_ENTITY` | 140 |
| `test/fixtures/dsl-dpc/zl1_mapping.stg.yaml` | `ITEMSET_GET_ENTITY` | 151 |
| `test/fixtures/dsl-dpc/zl1_mapping.stg.yaml` | `ITEMSET_GET_ENTITYSET` | 264 |
| `test/fixtures/dsl-dpc/zl1_mapping.stg.yaml` | `ITEMSET_UPDATE_ENTITY` | 145 |
| `compiled mapping with BOP artifact and custom range semantics` | `EMPTYHELPSET_GET_ENTITY` | 66 |
| `compiled mapping with BOP artifact and custom range semantics` | `EMPTYHELPSET_GET_ENTITYSET` | 111 |
| `compiled mapping with BOP artifact and custom range semantics` | `EMPTYSET_GET_ENTITYSET` | 124 |
| `compiled mapping with BOP artifact and custom range semantics` | `HELPSET_GET_ENTITY` | 85 |
| `compiled mapping with BOP artifact and custom range semantics` | `HELPSET_GET_ENTITYSET` | 174 |
| `compiled mapping with BOP artifact and custom range semantics` | `ITEMSET_CREATE_ENTITY` | 192 |
| `compiled mapping with BOP artifact and custom range semantics` | `ITEMSET_DELETE_ENTITY` | 140 |
| `compiled mapping with BOP artifact and custom range semantics` | `ITEMSET_GET_ENTITY` | 151 |
| `compiled mapping with BOP artifact and custom range semantics` | `ITEMSET_GET_ENTITYSET` | 264 |
| `compiled mapping with BOP artifact and custom range semantics` | `ITEMSET_UPDATE_ENTITY` | 145 |

Every IWPR fixture with mappings and every compiled STG project with
`function:` or `searchhelp:` is admitted. The ordinary DPC bridge also covers
the other compiled projects already admitted by the MPC bridge. Its existing
three width exclusions remain: the generated taxi, flight and travel cube
models have ABAP structure names longer than SEGW's 32-character field; none
has a mapped RFC/search-help operation.

## Mapping coverage

| Kind | Existing fixture coverage | Added coverage |
|---|---|---|
| IN | mapped Travel read; demo search-help selection | two ordered inputs, scalar/structure inputs, keys/nonkeys, navigation |
| OUT | mapped Travel structure and result table | scalar, structure and row-one table outputs; create keys and fallback |
| TABLES | existing result parameter is EXPORTING, so no TABLES call group | synthetic ET_ITEMS uses the signature's TABLES group |
| RANGES | mapped Travel query, all H/L/O/S components | mixed scalar/range filters and custom semantics |
| CONSTANTS | mapped query's quoted X | table components, embedded apostrophe, unquoted integer, long parameter |
| exceptions | local/remote call plus ET_RETURN log | no log, long alignment widths, empty call groups |
| search help | mapped fixture and demo query | read with two selections, empty read/query selections/results |

The added STG project also covers create/update/delete, CHANGING, no output
table, no filters, missing signatures and both BOP/non-BOP declaration paths.
The bridge requires traced output from all twenty new partials.

## Model mutations

Each mutation starts from the unchanged model. Removing the affected nodes'
lines leaves byte-identical output; replacements additionally check both the
old and new line's node. Insertion compares the remaining sequence, so a new
line cannot falsely make all later lines look changed. Every mutated result
also passes the ABAP profile.

| Independent mutation | Changed/inserted lines | Trace ownership |
|---|---:|---|
| Rename an IN mapping's module parameter | 1 | that parameter mapping |
| Change a constant including an apostrophe | 1 | that constant |
| Add a HIGH2 range component mapping | 1 inserted | the new range component |
| Change the read search-help name | 3 | the module node (two selections plus call) |
| Swap two IN mappings | 2 | those two mapping nodes |

The four earlier DPC mutations (stamp, method, SADL binding and property)
remain in the suite.

## Template mutants

| Mutant | Result | Rejection |
|---|---|---|
| Drop the first OUT mapping | RED | whole-class byte equality |
| Reverse IN mapping order | RED | whole-class byte equality |
| Omit the constant's literal filter | RED | quotes/escaping differ byte for byte |
| Keep an opaque search-help body | RED | data-only model and selection-node trace; bytes deliberately remain equal |

Mutants override a partial in memory for one render. No source file is
modified, so no file restoration is needed. Each mutant immediately rerenders
the original model/templates and requires the named bridge green.

## Copied oracle quirks

The corresponding partial's template comment records these choices:

- Declarations sort underscores as slashes; mapped parameters precede logs
  and constant-only parameters. Table declarations have an extra space; line
  declarations have two spaces before TYPE/LIKE.
- Call groups stay EXPORTING, IMPORTING, TABLES, CHANGING; parameter order is
  mapping encounter order. Alignment starts at 14 locally and 21 remotely,
  extending to the longest parameter. Only remote calls list
  communication_failure; local calls catch cx_root.
- Read assigns every input through converted keys, including nonkeys. Each
  table output repeats the row-one read. Query converts filters inside the
  nested select-option loop and orders range semantics H/L/O/S.
- Query paging starts at skip plus one. Create commits and reads back;
  update/delete commit without output assignments. Only nonempty create keys
  are handed to the read request.
- Leading/interstitial blank lines, repeated banners and uneven indentation
  are significant. Mustache standalone tags must not consume these blanks.
  Commit ends with the oracle's `) .` spelling.
- Search-help DATA is unindented. Query reads ls_paging but uses is_paging to
  calculate max hits, and keeps the `responce` spelling. Read inserts one
  blank between selections, fixes max hits to one and maps all inputs as EQ.
  Result components use the final path segment, while input selection names
  retain the full upper-case path. The interface forwarding alignment is
  deliberately uneven.
- Constants use single quotes, not string backticks. Lexical CHAR/INT4
  descriptors preserve this through the literal filter; module type metadata
  remains on each constant node.

## Deviations and repository checks

- The STG compiler does not declare BOP artifacts or arbitrary range semantics.
  A second case decorates the compiled synthetic IWPR with one BOP artifact
  and one custom semantic before import; both oracles consume that same tree.
- One final STG generator-order test exceeded Mocha's two-second default
  under load. The acceptance suites are rerun with `--timeout 60000`; all
  assertions remain enabled. Earlier runs passed with the default.
- Range insertion adds one component mapping to an existing select-option
  table; its distinct node owns exactly the one inserted assignment.
- The full size check initially found inherited breaches in `adt-facade.mjs`
  (3,107 / 3,102) and `osd-store.mjs` (1,689 / 1,661). Service-registration
  counting was moved to `segw-registry.mjs`, and object naming/type/include
  metadata to `osd-store-types.mjs`, preserving the original exports. No
  budget is raised; existing store, ADT and extension tests exercise the carve.

Acceptance commands: embedded-template check; npm lint; mocha DPC, SEGW
and STG compile suites; suite manifest check; size budget; OO comments; leak
scan. The lint command succeeds with the repository's warning-only complexity
and method-length findings. No required check is removed or skipped.
