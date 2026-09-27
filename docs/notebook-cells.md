# ABAP and SQLScript notebook cells

This change extends the existing `*.osdnb` notebook without making it a
second runtime. SQL remains on the ADT freestyle preview route. ABAP cells are
turned into one `IF_OO_ADT_CLASSRUN` class in a permanent, ignored scratch
pack, then activated and run by the same object store and classrun paths as
other ABAP. SQLScript cells use the AMDP sandbox already served at
`/sap/bc/osd/amdp/`.

## What changes where

- `tools/osd-store.mjs`: `ObjectStore#write(..., "main", {root})` accepts an
  optional target root for a new object. It must name one of the store's
  writable roots. Existing calls still write to the first writable root; an
  existing object keeps its indexed root.
- `editors/vscode/launcher.js`: every launched instance gets a persistent
  `notebook-scratch` pack under its ignored extension storage. Its `src/`
  remains in `OSD_PACKS` beside any workspace packs, including when no
  workspace layer is open. A notebook run can therefore select the pack
  without changing the roots of an already-running store.
- `tools/adt-facade.mjs`: a notebook ABAP request writes the generated main
  source to the scratch root, awaits the normal build/publish, then runs the
  class through `ClassRun`. Calls are serialized because the notebook uses
  the single class `ZCL_OSD_NOTEBOOK_CELL` and Node replaces its loaded module
  graph on activation.
- `src/amdp/zcl_osd_amdp_sbx.clas.abap`: the existing HANA sandbox accepts a
  notebook request at `/sap/bc/osd/amdp/cell`, returning structured JSON
  while the existing human-facing form stays as it is. HANA calls the
  sandbox's `AMDP` destination.
- `tools/sqlscript-to-procedure-ir.mjs`: the serving hosts intercept the
  same cell route on SQLite, DuckDB and PostgreSQL. The portable parser and
  lowerer run on the system database connection.
- `editors/vscode/lib.js` and `extension.js`: `sql` continues through
  freestyle; `abap` is wrapped as `ZCL_OSD_NOTEBOOK_CELL`'s classrun main;
  `sqlscript` is sent to the AMDP cell route. Results and errors are rendered
  under the cell that ran them.
- `editors/vscode/examples/abap-amdp.osdnb`: a second example with an ABAP
  cell (`SELECT ... INTO TABLE`, `LOOP`, `out->write`) and a SQLScript cell.

## One cell's flow

1. VS Code wraps ABAP statements in the classrun class and sends the source
   to the ADT façade. SQLScript source goes to the sandbox cell route.
   Markdown cells are not executed.
2. For ABAP, the façade locates the `notebook-scratch` writable root, writes
   the class main there, and calls `ObjectStore#publish`. Once the new build
   is live, it completes activation for that source revision, calls the
   existing classrun runner, and returns console text.
   If activation fails, it restores the previous scratch source and its prior
   active or inactive ADT state, or removes a first failed cell so the next
   launcher build can start. The extension
   replaces that cell's output with the returned text.
3. For SQLScript on HANA, the sandbox creates, calls, and drops its throwaway
   procedure as it does for its screen. Portable cells lower a relational
   plan to one statement on the system database. The returned rows and duration
   appear as an HTML table with a raw JSON disclosure; an engine error
   becomes the cell's error output. The SQLScript source is not stored as
   an ABAP object.

## Database behavior

The launcher's `osd.database.system` selects the system database. When it is
HANA, the AMDP sandbox's existing `AMDP` destination runs SQLScript against
that configured HANA service. When both `HANA_*` and `HXE_*` are set, HANA
system mode selects `HANA_*`; other system modes retain the separate `HXE_*`
sandbox connection. The sandbox keeps its own restricted execution
identity. On SQLite, PostgreSQL and DuckDB, the cell uses the portable SQLScript
parser, binder and dialect lowerer on the selected system connection. Output
names the engine. Unsupported syntax is returned as `UNSUPPORTED_SQLSCRIPT`
with its reason. HANA continues to use the native eAMDP sandbox.

## Portable AMDP: what is supported

The `PORTABLE` function list in `tools/sqlscript-lower.mjs` is:
`LOWER`, `UPPER`, `LENGTH`, `ABS`, `COALESCE`, `TRIM`, `LTRIM`, `RTRIM`,
`SUM`, `MIN`, `MAX`, `COUNT`, `AVG`, `ROUND`. This list was generated
from that Set; the dialect lowerer also has explicit measured rewrites and
refusals for other functions. The portable procedure compiler supports
SELECT, INSERT, UPDATE, DELETE and UPSERT, table functions and scalar OUTs
within its typed signatures. The notebook cell currently accepts relational
SELECT bodies, including table variables. It does not invent DDIC schemas
for arbitrary database tables. Unsupported constructs return a named refusal,
including `SYS.*` system views, XML and dynamic SQL. Check and Activate report
portable refusals as warnings for non-HANA systems; HANA-only source can still
activate, and a portable call can still refuse at runtime.

These limits follow the measured observations in
[portable AMDP, 2026-09-22](portable-amdp-2026-09-22.md) and the
[pAMDP handover, 2026-09-24](handover-pamdp-2026-09-24.md).
The [zvdb pack](../packs/zvdb/README.md) is the working showcase.

## Verification

Pure tests cover target-root writes, notebook source construction and cell
language round-tripping. The AMDP sandbox suite covers a portable SQLite
result and a named refusal. HANA execution
uses the sandbox destination and is exercised by the existing HANA-gated
sandbox tests when HANA is configured.
