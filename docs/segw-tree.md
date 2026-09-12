# The SEGW project tree as our tables

**Date:** 2026-09-12 · **Tools:** `npm run segw:tables` (`tools/segw-tables.mjs`),
`npm run segw:tree` (`tools/segw-tree.mjs`), `npm run segw:cloud`
(`tools/segw-cloud.mjs`) · **Test:** `test/segw-tree.mjs`, `ltcl_tree` in
`test/unit/zcl_stg_segw_test`.

SEGW is an editor over a set of tables: `/IWBEP/I_SBD_*` hold the service
builder design (project, model, service, data sources, mappings, generated
artifacts), `/IWBEP/I_SBO_*` the OData model (entity types, properties,
sets, associations, navigation, function imports, annotations). abapGit
serializes those tables one to one into `<project>.iwpr.xml`, which is what
`tools/segw-gen.mjs` reads and `tools/stg-compile.mjs` writes. "SEGW as an
application" starts with owning those tables: this is that step.

## Where the table definitions come from

We do not have the DDIC of the SAP tables and do not write it from memory.
The IWPR files are the contract: `segw-tables --derive <folder>...` reads
every `*.iwpr.xml` under the folders and records, per table,

- the fields, in the order SEGW writes them (every row is a chain; the
  chains of 21 projects agree without a single contradiction, which is what
  a DDIC field order looks like);
- the longest value seen per field;
- the key: the shortest prefix of the fields that is unique in every file,
  never shorter than PROJECT, NODE_UUID and SYLANGU where the table has
  them. That gives PROJECT + NODE_UUID for design and model tables, SYLANGU
  + PROJECT + NODE_UUID for texts, PROJECT + SYLANGU for the project text,
  PROJECT + NODE_HASH + NODE_UUID for the node map and PROJECT + NODE_UUID +
  DS_ATT_PATH for mapping rules, where NODE_UUID alone repeats.

Sources: the 21 SEGW projects available locally (untracked, `.local/`): the
eight public abapGit repositories of the closure corpus, the SAP sample
projects exported from A4H (`/IWBEP/GWSAMPLE_BASIC`, `EPM_DEVELOPER_SCENARIO`,
`MGW_ERROR_LOG`, `SADL_GW_DRAFT_ADMINISTRATION`, `S_EPM_CDS_EXP`,
`S_EPM_SADL_GW_DEV_SCEN_TX`, `S_ESH_SEARCH_ODATA`, `UCONHTTP`) and one project
from the Lars clones. 53 tables, `src/segw/segw-tables.json`.

The two hand-written fixtures under `test/fixtures/segw/` and stg-compile's
output are not a source: they are written from the spec, not the other way
round.

## What is generated

`segw-tables` without arguments turns the spec into

- `src/segw/ddic/zstg_<table>.tabl.xml`, 53 tables `ZSTG_SBD_*` / `ZSTG_SBO_*`.
  Every field is CHAR of the size class above the longest value seen (1, 4,
  10, 32, 40, 60, 80), LANG for SYLANGU, STRING above 80 (the annotation and
  vocabulary values). Flags, counters, `0001` versions and `20130411152822.077079`
  timestamps come back out of the tables exactly as they went in, which is
  what a byte-identical export needs; typing them would mean inventing the
  SAP domains. One column is ours, `STG_SEQ` (INT4, not key): the row's
  position in the imported file, because SEGW does not write rows in key
  order and the order is part of the file.
- `src/segw/zstg_segw.stg.yaml`: service `ZSTG_SEGW_SRV`, one entity per
  table (`Project`, `EntityType`, `Property`, `EntitySet`, `Association`,
  `NavProperty`, `FunctionImport`, `DataSource`, `MappingProperty`, ...;
  tables segw-gen does not read are named after their table, `SboTm`),
  properties named after the fields (`NodeUuid`, `ParentUuid`, `StgSeq`,
  `Language` for SYLANGU), all creatable / updatable / deletable. SEGW
  builds method names from the first 16 characters of an entity name, so
  the names differ there (`Artifact` and `ArtifactText`, not
  `GeneratedArtifact`).

`stg-compile --all` compiles the YAML into `gen/stg/zstg_segw/` and
`cds2ddic` writes the table source classes `gen/cds/zcl_stg_tab_zstg_sb*`,
so the service is served by the generic CRUD of `zcl_stg_sadl_dpc` without
a line of hand-written ABAP. `segw-tables --check` (and the test) fails when
the tracked files differ from the spec.

## Import and export

`segw-tree import <file.iwpr.xml>` turns every table block into rows of
`ZSTG_<table>` under `data/zstg_<table>.tabu.json` (client 123, `STG_SEQ` =
position); rows the data folder already holds for that project are replaced,
other projects stay. `test/seed.mjs` loads `data/` at start, so the imported
project is served by `ZSTG_SEGW_SRV` in the unit tests and the preview.

`segw-tree export <PROJECT>` writes the rows back in abapGit's form: tables
in alphabetical order (the order abapGit writes them), rows by `STG_SEQ`,
fields in the order of the spec, initial fields left out, XML-escaped as
abapGit does. `segw-tree check <file>...` imports into memory, exports and
compares byte for byte.

**Result:** all 21 SEGW-written IWPR files round trip byte for byte, the
UTF-8 byte order mark aside (abapGit writes one, stg-compile does not; it is
not data). The test runs this over the corpus when `.local/` has it and
skips in CI, like the closure run.

The hand-written fixtures `zstg_mapped.iwpr.xml` and `zstg_mini.iwpr.xml`
were re-sorted to that shape (table blocks alphabetical, fields in the
spec's order) and round trip byte for byte too. `stg-compile` writes the
tree from the same spec: every row's fields in the order
`src/segw/segw-tables.json` gives, a field the spec does not know refused
at write time, SEGW's label fields in the text tables (`ET_LABEL`,
`ESET_LABEL`, `PROP_LABEL`, `NAVP_LABEL`, `ASSOC_LABEL`, `ASST_LABEL`,
`FI_LABEL`, `FI_PARAM_LABEL`; a `DESCRIPTION` only in `SBD_DST`, `SBD_MDT`,
`SBD_PRT`; the key alone in `SBD_GAT`, `SBD_OPT`, `SBD_SET`, `SBD_SVT`,
`SBO_RCT`), `MODEL_GUID` in `SBO_ASO` / `SBO_AT`. So a compiled YAML
imports and exports byte-identically as well (`test/stg-compile.mjs` checks
the demo; `npm run segw:tree check` any compiled file). Everything segw-gen
reads is unaffected: it parses the file and does not care about order.

## Through the service

`segw-tree push <file.iwpr.xml> [--url http://localhost:3030]` does the
import against a running gateway (`npm start`) in one call: `POST
ImportSet` with the file as `Content`. `zcl_stg_segw_import` (through the
hand-written `zcl_zstg_segw_dpc_ext`, the only ABAP of the service) reads
the `<T><T>row</T></T>` nesting, turns every row into a line of `ZSTG_<T>`
through the generated table source (`ASSIGN COMPONENT` per field, so a
field SEGW never writes is a 400 with `SBO_ET.MADE_UP: not a field of
ZSTG_SBO_ET` and nothing is written), deletes the project's rows in every
`ZSTG_SB*` table and inserts the new ones; the response is `Project`,
`Rows`, `Tables`. The editor sends the file the user picked the same way,
one `$batch` entry. A function import was the first idea, but its
parameters travel in the URL and a 30 KB file does not fit a request line.
`push --rows` is the other route, the generic CRUD only: GET the project's
rows per set, DELETE by key, POST the rows with `StgSeq`.

`pull <PROJECT>` GETs `ExportSet('<PROJECT>')`: `zcl_stg_segw_export`
writes the file in ABAP (tables alphabetical, rows by `STG_SEQ`, fields in
the table's component order, which is the spec's, initial fields left out,
escaped as abapGit does), the mirror of the import, so the editor's Export
button is one GET. `pull --rows` GETs every set with `$filter=Project eq
'...'&$orderby=StgSeq` and writes the IWPR here instead. The round trip goes through the
database, not through JSON files: the test pulls the seeded `ZSTG_MAPPED`
and gets the fixture's bytes, pushes both fixtures through `ImportSet` and
row by row and pulls them back byte for byte, twice (a push replaces, it
does not double). One gateway bug surfaced on the way: a key value with a backslash
(`DS_ATT_PATH`, `IT_TRAVEL_ID_RANGE\HIGH`) reached `__metadata.uri`
unescaped and broke the JSON; `zcl_stg_json` now escapes the URI.

## Deleting a node

`DELETE NodeSet(Project='P',NodeUuid='x')` takes the node with its subtree,
the way SEGW deletes: the rows whose `PARENT_UUID` (`SBD_*`, `SBO_PR`),
`ENTITY_GUID` (`SBO_NP`), `ASSOCIATION_GUID` (`SBO_RC`, `SBO_AT`) or
`FUNCTION_IMPORT` (`SBO_FP`) is the node, their subtrees in turn, and every
row sharing the node's `NODE_UUID` (its text rows, the `SBD_MR` rules of a
mapping property). `zcl_stg_segw_tree` finds the parent columns of every
`ZSTG_SB*` table through RTTI, so a new table joins the cascade by having
one of those columns. `ENTITY_TYPE` of an entity set is a reference, not a
parent: deleting an entity type leaves its sets. The generic `DELETE` on
the table sets stays one row, as the editor's property form expects; the
tree's Delete goes to `NodeSet`. A node nobody has is a 400.

## Generate in ABAP

`GET GenerateSet?$filter=Project eq 'P'` returns the generated classes of a
project as rows (`Name`, `Content`), made by `zcl_stg_segw_gen` from the
`ZSTG_SB*` rows: the same model `tools/segw-gen.mjs` builds from an IWPR
file (entity types with their properties by `SORT_ORDER`, sets, complex
types, associations with constraints and sets, navigation, function
imports; `DEFINE_` stems cut to 23 characters and made unique, `TS_`/`GC_`
to 27) and the same templates, line for line. segw-gen is the oracle: the
test pushes both fixtures, the compiled demo YAML and every corpus project
through `ImportSet` and expects the ABAP MPC to equal segw-gen's byte for
byte (the colleague's rule: same input, same templates, no tolerance).
`npm run segw:tree generate <P> --out <dir>` writes the files. Stage 1 was
the `_MPC`; stage 2 (`zcl_stg_segw_gen_dpc`) adds the `_DPC` base (the
include banners with the generation stamp, the CRUDQ dispatch per entity
set, the method signatures in the class editor's order, the comm-services
block, SADL delegation and the SADL XML for mapped sets, the local ODC
client, stubs for operations mapped to a function module as segw-gen
writes them without a function group), the abapGit XML of both classes
with the component texts, and the `_EXT` pair. Every file is compared;
the `_DPC` of a project with a search-help mapping waits for stage 3 (the
search-help interface and its implementation).

## The Cloud pass

`npm run segw:cloud` runs abaplint over `src/`, the generated table sources
and the generated `ZSTG_SEGW` classes with `syntax.version: Cloud` (ABAP for
Cloud Development) instead of `open-abap`, style rules off, and prints the
issues per rule and file. Informational, exit 0. On 2026-09-12: 155 issues,
133 of them `strict_sql` ("INTO must be last"): the 7.02 form of Open SQL
that the repository's `downport` rule asks for is exactly what Steampunk
does not accept, so a Steampunk build of this code means the strict form in
the sources and the transpiler's own downport. Four `parser_error` are
`DESCRIBE` in the JSON and gateway classes, the rest are unresolved classes
of the narrowed file list, not language findings.

## Next

- The editor is `webapp/segw/` (`docs/segw-editor.md`); what it still
  lacks is listed there.
- Generate, stage 3: the operations mapped to a function module (with the
  function group's signature) and to a search help, checked byte for byte
  against `tools/segw-gen.mjs` like the rest; then the editor's Generate
  button goes to the service.
