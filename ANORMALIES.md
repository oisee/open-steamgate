# open-abap and transpiler anomaly log

Behaviour that differs between a real SAP system and open-abap / the abaplint
transpiler / its database adapter. Add an entry as soon as the discrepancy is
isolated and before hiding it behind a workaround. Ordinary open-steamgate
defects that reproduce identically on both runtimes do not belong here.

Resolved entries stay as compatibility history. Review all open entries before
upgrading `@abaplint/*` and before every release.

Format adapted from `larshp/hithub` (MIT).

## Entry template

### ANOMALY-YYYY-MM-DD-short-name — Short title

- Status: `open` | `workaround` | `reported` | `fixed` | `not-an-anomaly`
- Discovery date: `YYYY-MM-DD`
- Affected versions: `@abaplint/transpiler-cli x.y.z`, `@abaplint/runtime x.y.z`, `@abaplint/database-sqlite x.y.z`
- Affected ABAP statement, runtime API or adapter: `...`
- Minimal ABAP reproducer: `path/to/reproducer`
- Exact command used to run it: `...`
- Expected SAP behaviour: `...`
- Actual open-abap behaviour: `...`
- Impact on open-steamgate: `...`
- Smallest safe workaround: `...` or `none`
- Upstream issue: `link` or why it has not been reported
- Regression-test location: `path/to/test`
- Upstream version containing a fix: `...` or `unknown`

## Open anomalies

### ANOMALY-2026-09-11-no-implicit-mandt — Client-dependent tables are read across all clients

- Status: `open`
- Discovery date: `2026-09-11`
- Affected versions: `@abaplint/transpiler-cli 2.13.85`, `@abaplint/runtime 2.13.85`, `@abaplint/database-sqlite 2.13.83`
- Affected ABAP statement, runtime API or adapter: `SELECT` on a table with `CLIDEP = X`; `sy-mandt` is the constant `123` (`runtime/src/builtin/sy.ts`)
- Minimal ABAP reproducer: `src/demo/zcl_zstg_demo_dpc_ext.clas.abap` `travelset_get_entityset` against `data/zstg_demo.tabu.json` (3 rows in client 123, 1 in client 001)
- Exact command used to run it: `npm run unit`
- Expected SAP behaviour: 3 rows; the database interface adds `MANDT = sy-mandt` to every Open SQL statement on a client-dependent table unless `CLIENT SPECIFIED`
- Actual open-abap behaviour: 4 rows; no client predicate is generated, `INSERT`/`UPDATE`/`DELETE` likewise touch every client
- Impact on open-steamgate: every real business table is client-dependent; a seeded multi-client capture leaks rows across clients, and any DPC that branches on `sy-mandt` sees `123`
- Smallest safe workaround: seed captures with a single client and set every row's `mandt` to `123`; do not rely on client isolation in tests
- Upstream issue: not reported yet; check `abaplint/transpiler` for an existing MANDT issue before opening one
- Regression-test location: `test/unit/zcl_stg_phase0_test.clas.testclasses.abap` `entityset_reads_sqlite` pins the current 4-row result and will fail when the runtime starts filtering
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-11-oao-handler-hardcodes-test-dpc — open-abap-odata cannot be consumed as a library

- Status: `workaround`
- Discovery date: `2026-09-11`
- Affected versions: `open-abap/open-abap-odata` main at `7b20ba2` (2026-08-27)
- Affected ABAP statement, runtime API or adapter: `zcl_oao_http_handler=>data` declares `lo_dpc TYPE REF TO zcl_zsegw_dpc_ext`, a class that only exists in that repo's `test/` folder
- Minimal ABAP reproducer: add the repo as a lib in `abap_transpile.json` without `exclude_filter`
- Exact command used to run it: `npm run transpile`
- Expected SAP behaviour: n/a (library packaging)
- Actual open-abap behaviour: `Error: CreateObjectTranspiler, target variable "lo_dpc" not a object reference`
- Impact on open-steamgate: blocks using the interface transcription as a lib
- Smallest safe workaround: `"exclude_filter": ["zcl_oao_http_handler"]` on the lib entry (applied)
- Upstream issue: https://github.com/open-abap/open-abap-odata/issues/33 (open, same crash); QW1 in `AGENDA.md` is the fix
- Regression-test location: `npm run transpile` itself
- Upstream version containing a fix: `unknown`

## Resolved anomalies

(none yet)
