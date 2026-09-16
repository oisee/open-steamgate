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

The original build order and how it went (README, "The build order"):
0. Substrate stand-up — done 2026-09-11.
1. Gateway model registry + generic DPC dispatcher — done 2026-09-11.
2. `$filter` → SELECT-OPTIONS / `io_tech_request_context` — done 2026-09-11,
   one commit; the declared critical path was half a day.
3. Wire layer — **dropped on purpose**: no fe-mockserver anywhere. The whole
   request path is ABAP (`src/http/zcl_stg_http_handler` = `if_http_extension`)
   behind `cl_express_icf_shim` on Node and behind the service worker in the
   preview, so the same classes run in a system's ICF.
4. Fiori Elements serving — done 2026-09-11 with the plain SAPUI5 CDN
   bootstrap, no ui5 middleware.

What the long pole actually is: SEGW itself (tree in, tree out, generator,
editor), not the Gateway.

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
- fe-mockserver is built *around* mock data files. Checked and not used: the
  wire layer has to be ABAP to run on a system, so there is no dependency on
  it and no data-access plugin. Keep it that way unless something changes.

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
  the transpiler stays his to merge. `open-abap-core` is the exception to the
  branch-not-fork rule below: `oisee` has no write access there (403), so it
  takes a fork (#1218). A
  workaround stays in `src/` or `tools/` only until the fix is on npm.
- **A transpiler PR comes from a branch inside `abaplint/transpiler`, not
  from a fork.** Lars said so on #1836 (2026-09-13, merged the same
  morning): a branch in the repository triggers the performance and
  regression workflows, and a fork's branch does not, so a PR from a fork is
  reviewed with less evidence than one that costs nothing extra to give him.
  The mechanism, read off the workflows rather than taken on trust:
  `regression.yml` triggers on `push` with `branches-ignore: [main]` and has
  no `pull_request` trigger at all, so a fork PR, whose push lands in the
  fork, never fires it; `ci.yml` and `web.yml` do have `pull_request`, which
  is why such a PR still looks green. The check that did not run and the
  check that passed are the same colour. After pushing a branch, confirm
  **Regression** is in the checks list and not only **CI**. That rule holds for
  `abaplint/transpiler`, where we have push rights; it **cannot** be followed for
  `abaplint/abaplint`, where we do not, and whose regression workflow skips forks
  by an explicit condition. `npm run parked` prints which rule applies to which
  repository, so nobody has to remember. The queue of what is
  waiting to go is `npm run parked`, which derives it from the branches in the
  clone and the entries in ANORMALIES rather than from a list somebody keeps:
  it names each parked branch, its commits, whether it has ever been pushed,
  the anomalies that claim it, and it complains in both directions — a branch
  nothing explains, an entry naming a branch that is gone. A branch that is
  not a defect fix explains itself with `git branch --edit-description`, which
  keeps the note on the branch where it cannot drift from it. Entries whose
  fix belongs upstream in abaplint rather than here say **needs an issue** in
  their Upstream line, and `parked` lists those separately.
  The performance test itself is #1837. Pushing a branch there is not
  merging: `main` is still his, and nothing of ours is merged by us in
  `abaplint/transpiler` or `open-abap-core`. Before offering anything to any of
  the three upstreams, run that repository's own `lint`, in a clone with
  nothing uncommitted in it. Two lint errors sat in the shared
  open-abap-core checkout for a day because neither session had run abaplint
  there, and one was an **em dash in an ABAP comment** — ABAP source is
  7-bit ASCII, and the prose style used everywhere else here is the thing
  most likely to break it. The rule is not "write plainer comments", it is
  "run the lint": the check already existed and nobody had asked it.
- **Running it and reading it find different things.** The
  `general_get_random_int` work is the worked example. One session found
  `ASSERT high > low` by calling `cl_abap_random_int` and watching it fail at
  range 1; the other found `ASSERT low >= 0` one line below by reading the
  file they had been pointed at. The first assertion complicated the design
  and the second killed it. Reading alone would have missed nothing here;
  running alone would have shipped the negative range broken. The tests
  written from the A4H measurement do catch that, which is the part worth
  keeping: measuring the contract is what made the tests able to fail.
- Media out of SMW0 works (`docs/adt-facade.md`): a `*.w3mi.*` object in the
  transpile input becomes a row of `wwwparams` plus a file beside the
  modules, and `WWWDATA_IMPORT` + `SCMS_BINARY_TO_XSTRING` carry it into a
  response. Both of the latter needed work in open-abap-core, held in
  `.local/lars/open-abap-core` until the PRs land: `W3MIMETABTYPE` (#1218),
  `SCMS_BINARY_TO_XSTRING` (absent entirely), and `WWWDATA_IMPORT` walked
  with an offset instead of consuming its remainder, which made a 4 MB file
  take minutes and answer nobody meanwhile. Measured after: 4 MB in 0.3 s.
  In a browser there is no file and no `fs`, so `WWWDATA_IMPORT` lets a host
  answer instead: `abap.W3MI_LOADER(objid, filename)` returns the content as
  upper-case hex and the disk is the fallback rather than the only way.
  `scripts/build-preview.mjs` copies `output/*.w3mi.data.*` into
  `build/media/` (29 objects, 11.4 MB) **beside** the bundle, not inside it,
  so a page pays for the audio only if it plays it, and
  `web/preview-backend.mjs` installs the loader. A compiled binary needs the
  same hook for the same reason. Measured in Chromium: a 4.6 MB track in
  0.78 s cold and 0.34 s warm, and Zork boots from `ZORK-MINI.Z3`.
- ABAP goes under `src/` (7.02-compatible, `open-abap` abaplint version),
  tests under `test/unit/*.clas.testclasses.abap`, seed captures under `data/`
  as abapGit TABU JSON (`test/seed.mjs` pads CHAR to DDIC length).
- Every SAP-vs-open-abap discrepancy goes into `ANORMALIES.md` before any
  workaround. Known: no implicit MANDT; `sy-mandt = 123`.
- Closure audit of a real DPC: `npm run probe -- <folder> [--lib <stubs>]`.
- The database seam (`docs/db-backends.md`): the transpiled ABAP talks to one
  object, `abap.context.databaseConnections["DEFAULT"]`, implementing the
  runtime's eleven-method `DatabaseClient`; `test/setup.mjs` chooses it. Two
  implementations exist, `@abaplint/database-sqlite` and
  `tools/duckdb-client.mjs`, and a third needs no change anywhere else.
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
  `_MPC_EXT`, so the Fiori apps need no local annotation file;
  `complexTypes:` (SBO_CT, a property `type: <complex type>`, a function
  `returns: {complexType:}`). The tree is written in SEGW's own shape
  (fields and order from `src/segw/segw-tables.json`).
  `stg-compile --all` runs in `transpile`: YAML under `src/` compiles into
  `gen/stg/` unless `src/` already holds the object (a stale generated copy
  of an object `src/` now holds is removed).
- CDS views go under `src/cds/*.ddls.asddls` (+ `.ddls.xml`); `npm run cds`
  (part of `transpile`) generates `gen/cds/` (DDIC view XML under the SQL
  view name *and* under the CDS name, source classes with `ty_row`/`tt_row`,
  the registry). `gen/` is not tracked. SADL runtime lives in `src/sadl/`.
  `@ObjectModel.virtualElement` + `virtualElementCalculatedBy: 'ABAP:ZCL_X'`
  on a `cast( )` element is a field an ABAP class fills after the read
  (`docs/virtual-elements.md`, `if_sadl_exit_calc_element_read`);
  `@OData.publish: true` on a view writes `gen/cds/<view>_cds.stg.yaml`,
  which `stg-compile --all` turns into a service (`docs/cds-publish.md`);
  `@ObjectModel.writeEnabled` on a projection of one table makes it writable
  (`docs/cds-writes.md`), and the dispatcher answers 405 for a write the
  model does not allow.
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
  mapped fixture. `push <file>` / `pull <PROJECT>` do the same through a
  running gateway: `POST ImportSet` with the file as `Content`
  (`zcl_stg_segw_import` via the hand-written `zcl_zstg_segw_dpc_ext` in
  `src/segw/`, kept by `stg-compile --all`), `GET ExportSet('P')` for the
  pull (`zcl_stg_segw_export`, the file written in ABAP); `DELETE
  NodeSet(P, uuid)` removes a node with its subtree (`zcl_stg_segw_tree`);
  `GET RepoFileSet?$filter=Project eq 'P'` (or `RepoSet('P')` as a zip, or
  `npm run segw:tree repo <P> --out <dir>`) is the project as an abapGit
  repository, which is how it reaches a system (`zcl_stg_segw_repo`);
  `GET GenerateSet?$filter=Project eq 'P'` is segw-gen in ABAP
  (`zcl_stg_segw_gen` + `zcl_stg_segw_gen_dpc` + `zcl_stg_segw_gen_rfc`:
  MPC, DPC with RFC and search-help bodies, XML, EXT pair), byte-identical
  to `tools/segw-gen.mjs` by test; module signatures come from
  `ZSTG_FM_PARAM`, filled by `POST FunctionGroupSet` with a `*.fugr.xml`
  (`zcl_stg_segw_fugr`). `npm run segw:cloud` is the informational abaplint pass
  with `syntax.version: Cloud`. `test/unit/zcl_stg_segw_test` is the CRUD
  round trip (`ltcl_crud`) and the served tree (`ltcl_tree`).
- Media entities (`docs/media-entities.md`): `set_is_media` in the MPC,
  `m:HasStream` in `$metadata`, `<entity>/$value` served by the DPC's
  `GET_STREAM` / `UPDATE_STREAM` (`zcl_stg_dispatcher=>media`, the binary
  body travels as `ty_response-body_x`), `media_src` / `edit_media` in the
  JSON. The demo's `PhotoSet` over `ZSTG_PHOTO` (seeded PNGs as hex) is one;
  `UI.IsImageURL` on `Travel/PhotoUrl` is what makes the Travels app show
  the picture in the list and in the object page header.
- The SEGW editor is `webapp/segw/` (`docs/segw-editor.md`): freestyle
  SAPUI5 over `ZSTG_SEGW_SRV`, the project tree in SEGW's shape, every
  node edited in place (MERGE), Create for entity types, sets (with their
  operations), associations, navigation properties, function imports,
  parameters and properties, Delete = `NodeSet` subtree delete, Import IWPR through
  `ImportSet` (a `*.fugr.xml` through `FunctionGroupSet`), Export IWPR
  through `ExportSet`, Generate through `GenerateSet` (segw-gen in ABAP);
  "Save to gen/" is the one dev route of `test/start.mjs`
  (`POST /segw/generate/<P>`, `tools/segw-editor.mjs` writes the rows of
  `GenerateSet` to `gen/segw-editor/`, which the transpiler and abaplint
  skip). Launchpad tile "SEGW"
  (`SegwProject-manage`); `test/e2e/segw.spec.mjs`. Tests and the
  Playwright config read `STG_PORT` like `test/start.mjs`, so two sessions
  can run their suites side by side on different ports.
- `npm run web:preview` bundles the gateway into a service worker (`build/`,
  sql.js, no server); `npm run e2e:preview` checks it in Chromium; the
  `preview deployment` workflow publishes `main/` and `pr-<n>/` to GitHub
  Pages. See `docs/preview-deployments.md`. `build/` and `web/generated/` are
  not tracked.
- **webpack stays for the preview; do not swap it for Bun.** Measured
  2026-09-14 (`docs/bun-spike.md` part two): Bun bundles the same graph in
  337 ms against webpack's 56 s and the output cannot be evaluated, because
  it keeps `import.meta` and 8893 top-level awaits and a service worker is a
  classic script. webpack lowers both. Ten of its jobs are load-bearing —
  sixteen node-builtin polyfills, `symlinks: false`, the sql.js asm alias,
  three specifier rewrites, the DuckDB ignore, `Buffer`/`process`, one chunk,
  and Terser with `keep_classnames`/`keep_fnames`, which is not cosmetic
  because the runtime looks classes up by name. None of this touches the
  binary, where a module target makes both constructs legal, and where the
  `%23` defect turned out **not** to block packaging: `Bun.build({compile,
  plugins})` with a five-line `onResolve` builds a binary that runs.
- **The binary is `npm run binary` → `build/osd`** (`bin/osd.mjs`,
  `scripts/build-binary.mjs`, `docs/bun-spike.md` part three, 2026-09-16):
  `build/osd up|serve|build|gen <tool>|unit|doctor`. Four facts a change
  must respect. A compiled Bun binary resolves nothing from a
  `node_modules` beside an external module and its `onResolve` never sees
  a bare specifier, so code generated after the build gets
  `@abaplint/runtime` from a runtime plugin's `build.module` (the binary's
  own copy, one runtime object for host and generated code) and
  `../test/setup.mjs` from `onResolve` by path. Every bundled module shares
  one `import.meta.url` and `process.execPath` is the binary, so a tool
  starts another tool only through `tools/osd-host.mjs`, never by
  `spawn(process.execPath, <script>)` or a path off `import.meta.url`
  (`osd-transpile`'s glob, `stg-compile`'s spec, `start.mjs`'s `webapp`
  were all moved off it). The bundle renames a class whose name collides
  (`types.Date` → `Date2`) and the runtime compares `constructor.name`,
  so `bin/osd.mjs` restores the names and `osd doctor` lists what was
  renamed. Interpreted `bun x.mjs` auto-installs from `~/.bun` when there
  is no node_modules — measure with `--no-install`. And a generator's
  output must not depend on `readdirSync` order (Bun's differs from
  Node's): `gen/` is an input to the generation hash, and the two hosts
  named different generations until every directory read was sorted.
- A page that speaks APC gets `open` before `drain`. A stateful handler
  speaks from `on_start`, so draining what it pushed before signalling open
  delivers a message while the page's socket is still CONNECTING: `onmessage`
  runs before `onopen` and the page's reply is refused as "the socket is not
  open". The page is right; the ordering was wrong (`web/preview-backend.mjs`).
- **Verify a built artefact by its code, never by a comment, and never by
  the build command exiting 0.** Three false greens in one day, 2026-09-14,
  all the same shape: a test that called `install()` itself and passed while
  the injected path it claimed to cover was broken; a suite that passed
  against a stale `build/sw.js`; and a fix "confirmed" by grepping for a
  comment webpack strips. A deployed bundle is checked by content, and a
  test must exercise the real path rather than simulate it. Backlog 8.4.
- **The `input_folder` list of `abap_transpile.json` is the layer order,
  and the later folder wins** — for the transpiler, the builder and the
  object store alike (backlog E.1, 2026-09-16). Only listed folders are the
  system: a folder under `local/` that is not listed is in nobody's tree,
  and an import appends its folder to the list. The builder hands the
  transpiler the winner of a name only (the rest go into the build's
  `exclude_filter`) and logs every override with both files; the same file
  name twice inside one folder refuses the build. `node tools/osd-inputs.mjs`
  prints overrides, duplicates and shadows. Measured before deciding: the
  raw transpiler writes the later folder's module last, and abaplint's
  registry files the first and calls the second "already defined" — a
  duplicate left to either is a guess.
- Never put real `_DPC_EXT` sources or captures under a tracked path; use
  `.local/`.
- **Decode before you scan.** `npm run leak` (`tools/osd-leak-scan.mjs`, hook in
  `.githooks/`, CI in `leak-scan.yml`) looks for live identifiers in what is
  about to be published. It exists because a 746-byte logon template was
  committed to a public repo carrying a system's host name, instance, address,
  logon string and user, and a hand scan written to catch exactly that called
  it clean: the scan looked for runs of printable ASCII and every string in the
  structure was **UTF-16LE**. A NUL after each character hides a host name from
  a grep and from an eye. So the tool builds every byte view a file plausibly
  has — the text, the hex runs in it, the base64 blocks, each read as ASCII and
  as UTF-16LE — and matches over all of them. A sixth identifier was not a
  string at all: the last six bytes of a session GUID are the client's own IPv4
  packed into the uuid's node field, which no text search can see, so private
  addresses are matched in binary too (the two-byte prefixes only — a 10.x
  match is one byte and any random blob produces one per 256, and a check that
  cries wolf gets ignored). The identifier list is gitignored
  (`.local/leak-identifiers.json`): a list of what must not be published cannot
  itself be published, and the tool says so and exits 2 rather than passing
  quietly when it is absent. `.leak-allow.json` **is** tracked and every entry
  needs a reason, so an exception can be told from a way of making the build
  green. The rule "no live identifiers" had been in this file since the first
  week and did no work at all; both times it was attention that caught the
  leak, and attention is what runs out.

## Local clones

`.local/lars/` (gitignored) holds shallow clones of the abaplint / open-abap /
larshp repos, five of them built (`npm test` green except Playwright). Use them
for source reads instead of GitHub fetches.

## Substrate (when code starts)

What it actually is: Node 22/24, `@abaplint/transpiler` called as a library
(`tools/osd-transpile.mjs`, N3; the CLI stays installed for hand runs) +
`@abaplint/database-sqlite` (+ `@duckdb/node-api`, `sql.js` for the browser),
`express` with `cl_express_icf_shim`, `mocha`/`chai` and `@playwright/test`.
No `@sap-ux/*`, no `@ui5/cli`: SAPUI5 comes from SAP's CDN and `webapp/` is
plain files. The one runtime dependency is `open-rfc` (live RFC, Node only).
