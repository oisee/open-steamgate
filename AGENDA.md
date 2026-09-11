# AGENDA — open-steamgate

The living board: what is decided, what is open, what is next. Dated analyses go
in `docs/` as `YYYY-MM-DD-topic.md`.

## Decided (2026-09-11)

- **Repo created** as the OData/Gateway member of the SAP-protocol family
  (`vsp → odgp → steamgate`). Public, MIT.
- **v1 scope = classic code-based SEGW only.** CDS / SADL / RAP deferred (no
  local ABAP interpreter exists anywhere; Gap 5 in `docs/prior-art.md`).
- **v1 OData version = v2** (SEGW's native output). v4 rides with the deferred
  CDS/RAP path.
- **Clean-room reimplementation of the `/IWBEP/` interfaces.** No SAP source, no
  standard DDIC bundled. `open-abap-odata` is a *spec*, not a base (effectively
  unlicensed).
- **Reuse, do not rebuild:** transpiler + `@abaplint/database-sqlite` (Open SQL);
  fe-mockserver-core (OData v2/v4 wire); ui5-middleware-fe-mockserver (FE
  serving); abapGit TABU + `load-table-contents` (seed data); abap2UI5 playground
  (Phase-0 harness template).
- **Build only:** the `/IWBEP/` Gateway runtime (model registry + DPC dispatch)
  and the `$filter` → SELECT-OPTIONS / `io_tech_request_context` bridge (the
  crux). See gap-list in `docs/prior-art.md`.

- **Gateway lives here; the interface/DDIC layer lives in our fork
  `oisee/open-abap-odata`** (decided 2026-09-11, refined the same day: **no
  PRs upstream, we work in the fork**). Pulled in as a transpiler lib with
  `files` limited to `src/{oo,ddic,exceptions,internal}`. Upstream contact is
  issue #39 (license) only. The dispatcher, request context, serializer and
  `$filter` bridge are open-steamgate code. **Working assumption (Alice,
  2026-09-11): treat open-abap-odata as MIT until issue #39 says otherwise.**
  If the answer is "no", reimplement the ~50 signatures from SAP's public
  contract.

## DuckDB as the store, 2026-09-12 (night run)

`tools/duckdb-client.mjs` implements the transpiler's `DatabaseClient` over
`@duckdb/node-api` (in-process, columnar). `STG_DB=duckdb` makes
`test/setup.mjs` load the PostgreSQL DDL the transpiler already emits
(`NCHAR` → `VARCHAR`), the seed rows and the CDS views into DuckDB instead of
SQLite. **All 69 ABAP Unit tests and the HTTP suite pass unchanged on DuckDB**
(`npm run unit:duckdb`, `npm run integration:duckdb`, `npm run start:duckdb`),
including the SADL cube's `GROUP BY`. Adaptations: trailing blanks in
string literals are trimmed (ABAP CHAR semantics; SQLite tolerated the padded
literals, VARCHAR does not); the ABAP LUW is real (INSERT/UPDATE/DELETE open
a transaction, `COMMIT WORK` / `ROLLBACK WORK` end it) and a failed statement,
which aborts a DuckDB transaction, is fenced by replaying the LUW's
successful statements into a fresh transaction (savepoint emulation; test
`ltcl_luw` runs on both stores); `STG_DB_PATH=file.duckdb` persists schema,
seed and data between runs. Open: DECIMAL/DATE column types instead of
NCHAR, and packaging as `@abaplint/database-duckdb`.

## SADL-lite, 2026-09-12 (night run)

Reference-data-source services run now, read-only, with analytics.
- **Build:** `tools/cds2ddic.mjs` parses `src/cds/*.ddls.asddls` with abaplint
  and writes into `gen/cds/` a DDIC VIEW (abapGit XML) per CDS projection,
  so the transpiler creates the SQLite view and ABAP sees typed fields; a
  `zif_stg_cds_source` class per view (static FROM, dynamic WHERE / ORDER BY /
  field list / GROUP BY); and `zcl_stg_cds_registry` with fields, EDM types,
  keys, labels, every annotation, associations with ON pairs and cardinality.
  Single-source projections only; joins, expressions and parameters are next.
- **Runtime (`src/sadl/`, clean-room):** `cl_sadl_gw_model_exposure`
  (`get_exposure_xml` → `expose( model )`) reads the `<sadl:definition>` a
  SEGW RDS MPC carries and builds entity types, sets (`<Structure>Set`),
  associations with referential constraints and navigation properties from
  the registry. `cl_sadl_gw_dpc_factory=>create_for_sadl` returns
  `zcl_stg_sadl_dpc` (`if_sadl_gw_dpc`): ranges → dynamic WHERE, `$orderby`,
  `$top/$skip`, keys, navigation through the association pairs, generic
  `$expand` via the dispatcher.
- **Annotation layer for analytics:** `@Analytics.dataCategory: #CUBE` →
  `sap:semantics="aggregate"` on the set; `@Aggregation.default: #SUM` →
  `sap:aggregation-role="measure"`, other fields `dimension`;
  `@Semantics.amount.currencyCode` / `quantity.unitOfMeasure` → `sap:unit`;
  `@EndUserText.label` → `sap:label`; `@UI.lineItem` / `@UI.selectionField`
  → `UI.LineItem` / `UI.SelectionFields` vocabulary annotations in
  `$metadata`. On an aggregate set `$select=Dim,Measure` runs
  `SELECT dim, SUM(measure) ... GROUP BY dim` (what an analytical list page
  sends on v2).
- Demo: `ZSTG_SADL_SRV` with `ZC_STG_TRAVEL`, `ZC_STG_BOOKING` (association),
  `ZC_STG_TRAVELCUBE` (cube). Generated-shape MPC/DPC in 7.02 syntax; real
  SEGW output is 7.40 and needs the abaplint downport first.
- Fork b18ea73: `if_sadl_gw_model_exposure(_data)`, `cx_sadl_exposure_error`,
  changeset types, `vocab_anno_model`, labels + custom `sap:` annotations +
  vocabulary XML in `$metadata`.
- Open: joins/expressions in CDS, SADL writes (`maxEditMode` ≠ RO), `$apply`
  (v4) and `$select`-less aggregation, DDLS downport of real corpus code.

## `$expand` round two, 2026-09-12 (night run)

Nested paths (`$expand=to_Travel/to_Bookings`) recurse per level. With
`$expand` present the dispatcher calls `get_expanded_entityset` /
`get_expanded_entity` with an `io_expand` tree; a DPC that fills deep rows
itself lists them in `et_expanded_tech_clauses` and the serializer inlines
those components, the rest is expanded generically. The framework base in
the fork (fc5ce3d) delegates to the plain reads, as SAP's does. Demo DPC has
the fast path for `TravelSet?$expand=to_Bookings` (two SELECTs). Two more
transpiler anomalies logged (FAE de-dup by DB key, FAE with empty driver).
Express route answers 500 on a kernel error instead of hanging.

## Deep insert and function imports done 2026-09-11 (night run)

Deep insert: nested navigation payloads in a POST reach `create_deep_entity`
with an `io_expand` tree; the entry provider fills the SEGW deep structure
(one component per navigation property) recursively; the 201 response inlines
what the DPC returned. Function imports: `model->create_action` with input
parameters, return entity type/set or primitive, HTTP method, `sap:action-for`;
`<FunctionImport>` in `$metadata`; `/Service/Action?Param='v'` dispatched to
`execute_action`, result serialized as entity, feed or `{"d":{"Name":v}}`.
Fork: `oisee/open-abap-odata` a5272e8. Lesson kept in code: SAP's
`get_form_fields` lowercases names, the handler uses `get_form_fields_cs`.

## Navigation and `$expand` done 2026-09-11

Fork: `create_association` / `create_association_set` /
`create_navigation_property` / referential constraints are real, `$metadata`
emits them. open-steamgate: `Set(key)/nav`, `Set(key)/nav/$count`,
`Set(key)/nav(key)`, to-many and to-one, `$expand=a,b` (first level) on
entity sets and single entities by the generic route a real Gateway takes when
the DPC has no `get_expanded_*`: `get_entityset` / `get_entity` of the target
set with `it_navigation_path` and the source keys in `it_key_tab`. Navigation
properties not expanded are `__deferred` links. Demo grew a `Booking` entity
(DATS field → `Edm.DateTime`) with a 1:N association. Still open: deep insert,
writes through navigation, `get_expanded_entityset` when a DPC implements it,
nested `$expand`.

## `$batch` done 2026-09-11

`zcl_stg_batch`: multipart/mixed in and out, retrieve parts dispatched one by
one, changesets in order and answered as a whole (first failure becomes the
changeset's single error part, later requests are not run; no rollback of the
earlier ones yet, the local SQLite has no transaction bracket). The Fiori
Elements app runs with `useBatch: true` now; Playwright covers list, filter and
**Delete from the list report** (DELETE inside a changeset, then the refresh
GET in the same batch). Keyboard-driven in the test: pointer clicks never pass
Playwright's stability check under the WSL headless compositor.

## Phase 1b — writes done 2026-09-11

POST / PUT / PATCH / MERGE / DELETE reach `create_entity`, `update_entity`,
`delete_entity` of the DPC with an `io_data_provider`
(`zcl_stg_entry_provider`: request body parsed by `zcl_stg_json=>parse_object`,
mapped through the model, EDM-typed conversion). 201 + Location, 204, business
exceptions as 400 with the DPC's message. CSRF fetch answered. The demo DPC
does real INSERT / UPDATE / DELETE on SQLite. Still open: a transaction bracket around changesets, complex types,
media resources/streams.

## Phase 4 demo — Fiori Elements list report, 2026-09-11

`webapp/` is a Fiori Elements V2 list report (SAPUI5 1.120 from the CDN,
annotations file, no controller code) served by the same Express process at
`/app/`, so no proxy and no CORS. The exact SmartTable requests
(`$select`, `$skip/$top`, `$inlinecount=allpages`, `$filter`, `$metadata`
with `sap-language`) are answered by the dispatcher. `npm run e2e` runs the
Playwright check (needs `playwright install-deps chromium` once, sudo):
**green 2026-09-11**, the list report renders the four travels and the filter
bar's `$filter=Status eq 'X'` reaches the DPC. Console shows FE V2's
`Only ODataModel with batch mode enabled are supported` for the transaction
controller: **`$batch` is a prerequisite for writes from Fiori**, add it to
Phase 1b.

## Phase 1+2 — read path incl. `$filter` done 2026-09-11

`/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$filter=Status eq 'A' and TravelId ge 'T0002'&$top=2&$inlinecount=allpages`
answers real OData v2 JSON from the transpiled DPC over SQLite, with the
filter delivered as `it_filter_select_options` and through
`io_tech_request_context->get_filter( )`. 35 ABAP Unit + 9 mocha. Writes
answer 501: next is Phase 1b (POST/PUT/PATCH/DELETE with body
deserialization, `/iwbep/if_mgw_entry_provider`), then `$expand` and
navigation, then Phase 3/4 (fe-mockserver front, Fiori Elements).

## Phase 0 — done 2026-09-11

`npm test` is green: abaplint, transpile, 6 ABAP Unit tests, 2 mocha wire
tests. A hand-written SEGW-shaped MPC/DPC (`src/demo/`) runs its Open SQL
against SQLite seeded from an abapGit TABU capture (`data/`), honours
`it_filter_select_options`, paging and `it_key_tab`. The ICF handler answers
501 until the dispatcher exists. First two entries in `ANORMALIES.md`.

## Sprint 0 — audit before building (highest priority)

Do this before any architectural commitment.

- [x] **Dependency-closure probe.** Measured 2026-09-11 on eight public SEGW
      repos, see `docs/2026-09-11-closure-probe.md`. The closure of a classic
      hand-written DPC is DDIC (data elements, domains, tables), not code:
      1–65 standard objects, 0–2 standard classes. It is capturable via
      abapGit per user, not something to shim. Framework-bound services
      (SADL, BOPF, CRM) are flagged mechanically. Tool:
      `npm run probe -- --closure <repo>`.
- [ ] **Corpus check.** Confirm the target services are classic code-based SEGW,
      not SADL-/RAP-generated (which have no transpilable `GET_ENTITYSET`).
      Mechanical now: `npm run probe -- --closure <repo>` and grep the output
      for `CL_SADL_GW_DPC_FACTORY` / `/BOBF/`. Still to run on the real
      target corpus.
- [ ] **Accessor grep.** Which `io_tech_request_context` methods do the target
      DPCs actually call (`get_filter` / `get_filter_select_options` / read
      `it_filter_select_options`)? Build for the shapes that exist.
- [x] **Clone + hand-audit `open-abap-odata` `src/`.** Done 2026-09-11, see
      `docs/2026-09-11-lars-ecosystem-audit.md` §4. LICENSE reads `todo`
      (verified). Data path is a literal; interfaces + DDIC are the asset.
- [ ] **Open-SQL coverage probe.** Run the target DPCs' real SELECTs (FOR ALL
      ENTRIES, joins, aggregates, client-dependent) through syntax.abaplint.org
      and the transpiler. Note the fixed-client-123 / no-implicit-MANDT
      correctness risk.

## Quick wins (from the 2026-09-11 ecosystem audit, §6)

Ranked in `docs/2026-09-11-lars-ecosystem-audit.md`. Recommended order:

- [x] **QW0** Asked upstream for an MIT grant on `open-abap-odata`:
      https://github.com/open-abap/open-abap-odata/issues/39 (2026-09-11).
      Not blocking on the answer.
- [x] **QW6** Scaffold Phase 0 in the open-abap house style. Done 2026-09-11.
- [x] **QW7** Closure probe: `tools/closure-probe.mjs` (static, abaplint
      registry with libs as dependencies). The dynamic complement is
      `"unknownTypes": "runtimeError"` in `abap_transpile.json`. Done 2026-09-11.
- [x] **QW1** Registry instead of the hardcoded test DPC, plus working
      gateway exception constructors: `oisee/open-abap-odata` main at
      4c2c301 (2026-09-11). Upstream #33 not PR'd by decision; open-steamgate
      now consumes the fork without `exclude_filter`.
- [x] **QW5** Truthful `$metadata`: keys, entity sets, all EDM setters,
      facets, labels. Fork main (2026-09-11).
- [x] **QW2** Generic OData v2 JSON serializer driven by the model
      (`zcl_stg_json`, `zcl_stg_model_info`). 2026-09-11.
- [x] **QW3** `zcl_stg_url` + `zcl_stg_request_context` (all req facets, filter
      facet, `get_osql_where_clause`, `convert_select_option`) +
      `zcl_stg_dispatcher` (GET entity set / entity / `$count` / `$metadata` /
      service document, `$top/$skip/$orderby/$inlinecount`, OData error
      bodies, 501 for writes). 24 ABAP Unit + 8 mocha. 2026-09-11.
- [x] **QW4** `$filter` → SELECT-OPTIONS: `zcl_stg_filter` (tokenizer,
      recursive-descent parser, range converter). Per-property ORs joined by
      AND, ge/le → BT, ne / not-eq → E EQ, startswith/endswith/substringof →
      CP, datetime/guid/bool literals; inexpressible filters leave the table
      empty and pass the raw string. Unknown property → 400. 2026-09-11.

## Ideas parked (2026-09-11)

- **DuckDB: done as a spike 2026-09-12** (section above). ClickHouse would
  be the same adapter shape without UPDATE/DELETE semantics; not started.
- **SADL-lite: done 2026-09-12** (see the section above); joins and writes
  remain.
- **SAP GUI front (DIAG) for reports and dynpros.** Orthogonal to OData: the
  DIAG sibling already has the protocol reverse-engineered (SAP-LZH writer
  included). open-abap-gui models a classic report / dynpro / selection screen
  through host interfaces (`zif_gg_report_v1`, dynpro builders) and renders
  HTML; a DIAG renderer behind the same host interfaces would let a real SAP
  GUI log on to the local runtime. Separate project, shares the transpiled
  runtime and the DDIC capture with this one.
- **`capture` tool:** probe JSON → abapGit data config for exactly the
  DTEL/DOMA/TABL/TTYP + TABU rows a DPC needs → `.local/capture/<system>/`
  as a lib. See the closure doc.

## Cheap checks that could shrink the plan

- [ ] Does fe-mockserver *evaluate* `$filter` (parse → predicate), not just
      parse? If yes, stronger prior art for Gap 2 → less Phase-2 risk.
- [ ] Is fe-mockserver's data-access seam a public, supported extension point?
      If yes, Phase 3 is reuse, not fork.
- [ ] Can `ui5-middleware-fe-mockserver` point at an arbitrary external OData
      endpoint (not only file-based mock data)? Load-bearing for Phase 4.

## Un-swept sources to check

- [ ] `SAP/abap-file-formats` + `-tools` (official SRVD/SRVB/DDLS/BDEF/IWSG
      spec).
- [ ] Standalone OData parsers: `odata-v4-parser`/`-literal` (Jaystack),
      `@cap-js/cds` `cds.parse.expr`.
- [ ] Alternative wire layers: `odata-v4-server` (Jaystack),
      `@cap-js-community/odata-v2-adapter` (cov2ap, battle-tested v2).
- [x] open-abap org: base-class impl of `/IWBEP/CL_MGW_ABS_DATA`/`ABS_MODEL`;
      open-abap-odata branches/history for a fuller gateway. Swept 2026-09-11:
      no-op base only, single `main`, no fuller gateway; `open-abap-sadl/cds/rap`
      are interface stubs (audit §3).

## Build order (see docs/prior-art.md §4)

0. Substrate stand-up (reuse) → 1. Gateway model + dispatch → **2. request-
   context bridge (crux)** → 3. wire layer → 4. Fiori serving.
