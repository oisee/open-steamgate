# CLAUDE.md

**open-steamgate** — a local IWBEP / OData runtime that runs real ABAP
`_MPC_EXT` / `_DPC_EXT` classes offline (transpile → Open SQL over SQLite →
OData → Fiori), deploying back through abapGit.

> **Doc intent:** CLAUDE.md = dev context (this file). README.md = the pitch and
> the prior-art matrix. docs/ = research and the layer knowledge we carry over
> from sibling projects. AGENDA.md = what is open and what was decided.

---

## Where this repo is

**CRUD, `$batch`, navigation, `$expand`, deep insert, function imports,
value helps (`Common.ValueList`, `search`), an object page with
PATCH/MERGE semantics and Create below the parent (POST through a
navigation property), a launchpad sandbox (`webapp/flp.html`) with two apps
and intent-based navigation, and read-only SADL (reference data source over CDS projections, with analytics
annotations) work end to end (2026-09-12). The whole thing also runs in the
browser as a preview deployment (service worker + sql.js, GitHub Pages).**
`npm test` transpiles a SEGW-shaped demo MPC/DPC and serves it as OData v2
over `src/gateway/` (URL parser, `$filter` → select-options, request context,
entry provider, model info, JSON (de)serializer, dispatcher). A Fiori Elements
V2 list report in `webapp/` renders it (`npm run e2e`). The research that
scopes the work lives in:
- [`docs/prior-art.md`](docs/prior-art.md) — verified reuse-vs-build matrix,
  gap-list, phased build order, source list (verified-in-repo vs claimed).
- [`docs/layers-we-own.md`](docs/layers-we-own.md) — the SAP-protocol layers
  already reverse-engineered in the sibling projects, with reuse notes.
- [`docs/2026-09-11-lars-ecosystem-audit.md`](docs/2026-09-11-lars-ecosystem-audit.md)
  — hand audit of the open-abap repos (built and probed), the house style to
  copy for Phase 0, ranked quick wins.
- [`AGENDA.md`](AGENDA.md) — the living board: decisions, open questions, the
  Sprint-0 audit checklist.

**Do not start building the runtime without reading `docs/prior-art.md` first.**
The whole point is to reuse the mature substrate and build only the confirmed
gap (the `/IWBEP/` Gateway and the `$filter` bridge). Re-deriving what the
transpiler / fe-mockserver / abapGit already do is the failure mode.

---

## The one thing to internalize

The substrate exists (transpile ABAP → run Open SQL over SQLite → serve UI5) and
is MIT/Apache. The Gateway — everything at and above the `/IWBEP/` line — does
not exist as working code anywhere. **Build only the Gateway and the seam.**

Concretely, build order (weeks-scale, critical path = Phase 2):
0. Substrate stand-up (reuse) — transpile one real MPC/DPC, DDIC→SQLite schema, seed via abapGit TABU.
1. Gateway model registry + generic DPC dispatcher.
2. **`$filter` → SELECT-OPTIONS / `io_tech_request_context` — the crux.**
3. Wire layer (fe-mockserver front-of-house → the dispatcher).
4. Fiori Elements serving.

## Scope guards (decided)

- **v1 = classic code-based SEGW only.** Many modern services are SADL-mapped to
  CDS/BOPF and have no hand-written `GET_ENTITYSET` to transpile. Confirm the
  target corpus is code-based before committing to any service.
- **Clean-room.** Reimplement the `/IWBEP/` *interfaces*; bundle no SAP source,
  no standard DDIC. The interface signatures are the contract; the
  implementation is greenfield MIT.
- **SAP systems: only the A4H sandbox, only when Alice asks.** The agent may
  use the A4H MCP server (vsp, `.mcp.json`, gitignored) to build reference
  objects (SEGW sample projects, captures) on explicit request; never a
  productive or customer system, never unasked. The A4H host lives only in
  `.mcp.json`. abapGit stays the last mile for code and for seed-data
  captures; deploy-back is the vsp sibling's territory. (Rule revised
  2026-09-12 by Alice; before that no SAP API was called at all.)
- **Never commit captures** (`*.pcap`, `*.jsonl`) — they carry real logons,
  session GUIDs, credentials. Only protocol facts belong here.
- **Public repo — no live identifiers.** No real hostnames, usernames, IPs,
  transport IDs, or customer namespaces in any tracked file. Operational scratch
  goes under `.local/` (gitignored).

## First move (Sprint 0)

Compute the **dependency-closure of 3–5 representative real `_DPC_EXT`
classes** against what `open-abap-core` + `abaplint/deps` already implement.
The critic's finding: this closure (base classes, BAPIs, utils, auth-checks,
message classes) likely dwarfs the `$filter` work and is the real long pole. Do
this before any architectural commitment. See `AGENDA.md` for the checklist.

## Known traps

- `open-abap-odata` is **effectively unlicensed** (`LICENSE` file reads
  `"todo"`, `package.json` license empty). Treat it as a *spec*, not a base:
  reimplement fresh under MIT unless the grant is clarified.
- Transpiler runtime constants — **fixed client 123, SysID ABC, UTC,
  fixed-point** — silently mis-execute any DPC that branches on `sy-mandt` /
  `sy-sysid` / `sy-uzeit`, and there is **no implicit MANDT** (client-dependent
  SELECTs). First-order correctness risk, not an edge.
- Transpiler input must be **ABAP 7.02 syntax**; newer syntax goes through the
  abaplint downport rule first — an extra pipeline step.
- `open-abap-core` has `ASSERT 1 = 'todo'` stub methods. Don't assume any
  `CL_*` / `IF_*` is fully implemented — verify per class.
- fe-mockserver is built *around* mock data files; verify its data-access seam
  is a public extension point and can be backed by a live DPC call before
  treating Phase 3 as pure reuse.

## Family & links

Public siblings (link freely):
- [vsp / vibing-steampunk](https://github.com/oisee/vibing-steampunk) — ADT
  transport, `pkg/sapcompress` (SAP-LZH/LZC decode), `pkg/datacluster`,
  `ZADT_VSP` bridge, abapGit deploy-back.
- [open-rfc-go](https://github.com/oisee/open-rfc-go) — NI/RFC/CPIC transport.

Private siblings (reference the facts in `docs/layers-we-own.md`, do **not** put
their URLs in tracked files): a DIAG-protocol project (carries the SAP-LZH
*writer*) and a shared SAP knowledge base.

Prior art built on: `abaplint/transpiler`, `open-abap/open-abap-odata`,
`abapGit`, `SAP/open-ux-odata` — see `docs/prior-art.md`.

## Working in the tree

- `npm test` = `abaplint` + transpile + ABAP Unit (inside `output/index.mjs`)
  + mocha wire tests. `npm start` serves `/sap/opu/odata/sap/` on port 3030.
- `abap_transpile.json` pulls open-abap-core, express-icf-shim and the
  interface part of **upstream** `open-abap/open-abap-odata` as libs.
  `folder` points at `.local/lars/` clones when present, else the URL is
  cloned. The fork `oisee/open-abap-odata` is only a staging area for PR
  branches; its `main` tracks upstream. Interface-layer changes: prove them
  here, then one small PR upstream each (open-abap-odata #40–#48, transpiler
  #1829–#1832, all merged 2026-09-12). `oisee` is a collaborator on both
  repos; Lars said self-merging in open-abap-odata is fine (he has no time),
  the transpiler stays his to merge. A
  workaround stays in `src/` or `tools/` only until the fix is on npm.
- ABAP goes under `src/` (7.02-compatible, `open-abap` abaplint version),
  tests under `test/unit/*.clas.testclasses.abap`, seed captures under `data/`
  as abapGit TABU JSON (`test/seed.mjs` pads CHAR to DDIC length).
- Every SAP-vs-open-abap discrepancy goes into `ANORMALIES.md` before any
  workaround. Known: no implicit MANDT; `sy-mandt = 123`.
- Closure audit of a real DPC: `npm run probe -- <folder> [--lib <stubs>]`.
- `STG_DB=duckdb` runs everything on DuckDB (`tools/duckdb-client.mjs`: real
  LUW with replay-based savepoints, literals trimmed); `STG_DB_PATH=x.duckdb`
  persists; `npm run unit:duckdb`, `start:duckdb`.
- Services register themselves from the SEGW objects: `<srv>.iwsv.xml`
  (service → `_DPC_EXT`) and `<mdl>.iwmo.xml` (model → `_MPC_EXT`) in `src/`,
  abapGit-named; `tools/segw-registry.mjs` (part of `transpile`) writes
  `gen/segw/zcl_stg_segw_registry`, which `test/start.mjs` and the preview
  call. `npm run segw -- <folder> --list` shows what a repo would register.
- Analytics: `ZSTG_FLIGHTFACT` (`data/zstg_flightfact.tabu.json`, 24 seed
  rows) → CDS cube `ZC_STG_FLIGHTCUBE` (`@Analytics.dataCategory: #CUBE`,
  `@Aggregation.default: #SUM`) served by `ZSTG_SADL_SRV`; the SADL runtime
  turns `$select` into `GROUP BY`, gives aggregated rows synthetic keys and
  counts before `$top`. Fiori Elements Analytical List Page in
  `webapp/analytics/` (`/app/analytics/index.html`, launchpad tile "Flight
  analytics"). `STG_DATA_SCALE=1000000` adds synthetic facts
  (`tools/gen-data.mjs`); `npm run bench:cube -- 1000000` times the cube on
  SQLite and DuckDB side by side (`tools/bench-cube.mjs`). Tests
  `test/analytics.mjs`, `test/e2e/analytics.spec.mjs`.
- RFC destinations: `.local/rfc-destinations.json` (example in
  `docs/rfc-destinations.example.json`) says per `DESTINATION` name whether
  it is `local`, `replay` (capture folder), `live` (open-rfc, node only),
  `record` (live + capture written) or `fallback` (local FM if transpiled,
  else live); without the file `'NONE'`/`''` run locally and every other name
  replays `STG_RFC_CAPTURE` (`.local/capture/a4h/rfc`). Capture files are the
  `rfc call` JSON of open-rfc-go (`params` + `result`) and may carry
  `{{param:}}`, `{{now:}}`, `{{seq:}}`, `{{sql:}}` placeholders; see AGENDA
  "RFC replay". `tools/rfc-replay.mjs`, `tools/rfc-live.mjs`; tests
  `test/rfc-replay.mjs`, `test/rfc-live.mjs` (live is faked, A4H only by hand).
- Search helps serve themselves: `<name>.shlp.xml` in `src/` (DD30V selection
  table, DD32P parameters) becomes a `zcl_oao_shlp_ddic` provider through
  `tools/segw-shlp.mjs` (part of `transpile`, writes
  `gen/segw/zcl_stg_shlp_registry`, called by `test/start.mjs` and the
  preview); an operation mapped to a search help reaches it through
  `/iwbep/cl_sb_shlp_data_factory` by name. The demo's `StatusVHSet` runs on
  `ZSTG_STATUS_SH` this way. Exit search helps are not served yet.
- SEGW offline: `npm run segw:gen -- <folder> --check` diffs what
  `tools/segw-gen.mjs` makes of a `<project>.iwpr.xml` against the `_MPC`/
  `_DPC` classes in the folder; `--out <dir>` writes them (and the `_EXT`
  pair if missing); `--lib <folder>` (repeatable) supplies the abapGit
  function groups (`*.fugr.xml`) the RFC-mapped operations need
  (`tools/segw-gen-mapping.mjs`: RFC/BOR and search-help data sources,
  `docs/segw-mapping.md`). SAP-delivered sample projects exported from A4H
  live under `.local/corpus-sap/` (never tracked) and are the oracle for
  the mapped kinds. Corpus projects under `.local/corpus/` are the oracle;
  `npm run segw:closure` generates every corpus project and lints it
  against open-abap-odata (`docs/segw-closure.md`), skips without corpus
  (`--corpus <dir>` for another folder of repos, e.g. `.local/corpus-sap`);
  it also uses `.local/lars/s4-private-2022-doma-and-dtel` (abapedia's
  S/4 DOMA/DTEL dump) when cloned. DDIC upstream rule: released data
  elements → open-abap-core, the rest → open-abap-deprecated.
- `npm run stg:compile -- <service>.stg.yaml [--out <dir>]` is SEGW without
  the GUI: one YAML → IWPR + IWSV/IWMO + the four classes through segw-gen
  (`tools/stg-compile.mjs`, `docs/stg-compile.md`); the demo's model is
  `src/demo/zstg_demo.stg.yaml`, `test/stg-compile.mjs` keeps it in step
  with the hand-written classes. Sources per entity: none, `struct:`,
  `table:`/`cds:` (SADL), `service:`+`set:` (another service of the
  registry, consumed in-process through `zcl_stg_odata_client`; the local
  ODC, `src/demo_odc/` is a YAML-only example); per operation
  `function:`/`searchhelp:` with `in`/`out`/`ranges`/`constants` = SEGW's
  data-source mapping (module signature from a `*.fugr.xml` next to the
  YAML or `--lib`); `annotations:` (header, selectionFields, lineItem,
  facets, fieldGroups, label/text/valueList per property) become
  `ZCL_<project>_MPC_ANN` over `vocab_anno_model`, called from the
  `_MPC_EXT`, so the Fiori apps need no local annotation file.
  `stg-compile --all` runs in `transpile`: YAML under `src/` compiles into
  `gen/stg/` unless `src/` already holds the object.
- CDS views go under `src/cds/*.ddls.asddls` (+ `.ddls.xml`); `npm run cds`
  (part of `transpile`) generates `gen/cds/` (DDIC view XML, source classes,
  registry). `gen/` is not tracked. SADL runtime lives in `src/sadl/`.
- `table:` sources are read and written generically: `tools/cds2ddic.mjs`
  emits `gen/cds/zcl_stg_tab_<table>` (read / insert / update / delete over
  the table, `zif_stg_cds_source`) for every TABL under `src/`, and
  `zcl_stg_sadl_dpc` serves POST / PUT / DELETE / GET by key for the
  generated DDIC-mapped DPCs (keys checked, MANDT set, duplicates and
  unknown keys are 400). `src/segw/` is SEGW as an application on top of
  that (`docs/segw-tree.md`): the 53 tables of the project tree
  (`ZSTG_SBD_*` / `ZSTG_SBO_*`) and `ZSTG_SEGW_SRV` are generated by
  `npm run segw:tables` from `src/segw/segw-tables.json`, a spec derived
  from 21 real SEGW projects (`--derive`, fields in SEGW's order, CHAR of
  the size class seen, `STG_SEQ` for the row order); edit the spec, not
  the tables or the YAML (`--check` and `test/segw-tree.mjs` guard it).
  `npm run segw:tree import <file.iwpr.xml>` puts a project into
  `data/zstg_sb*.tabu.json` (seeded at start), `export <PROJECT>` writes it
  back byte-identically for every SEGW-written file; `data/` holds the
  mapped fixture. `npm run segw:cloud` is the informational abaplint pass
  with `syntax.version: Cloud`. `test/unit/zcl_stg_segw_test` is the CRUD
  round trip (`ltcl_crud`) and the served tree (`ltcl_tree`).
- `npm run web:preview` bundles the gateway into a service worker (`build/`,
  sql.js, no server); `npm run e2e:preview` checks it in Chromium; the
  `preview deployment` workflow publishes `main/` and `pr-<n>/` to GitHub
  Pages. See `docs/preview-deployments.md`. `build/` and `web/generated/` are
  not tracked.
- Never put real `_DPC_EXT` sources or captures under a tracked path; use
  `.local/`.

## Local clones

`.local/lars/` (gitignored) holds shallow clones of the abaplint / open-abap /
larshp repos, five of them built (`npm test` green except Playwright). Use them
for source reads instead of GitHub fetches.

## Substrate (when code starts)

Expected stack, Phase 0+: Node ≥ 16, `@abaplint/transpiler` +
`@abaplint/database-sqlite`, `@sap-ux/fe-mockserver-core` +
`@sap-ux/ui5-middleware-fe-mockserver`, `@ui5/cli`. The abap2UI5 *playground*
(transpile + SQLite + UI5-serve + offline-PWA scaffold) is the harness template
to fork for Phase 0.
