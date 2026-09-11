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
does real INSERT / UPDATE / DELETE on SQLite. Still open: deep insert, `$expand`,
navigation properties, function imports, a transaction bracket around
changesets.

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

- **DuckDB (or ClickHouse) as the analytical store.** The transpiler's DB
  layer is a `DatabaseClient` per package (`database-sqlite`, `database-pg`,
  `database-snowflake`) plus a schema generator; Snowflake proves a non-PG
  dialect works. A `database-duckdb` package the size of the Snowflake one
  would run every DPC `SELECT … GROUP BY` on a columnar engine unchanged.
  DuckDB over ClickHouse: embedded, transactional, UPDATE/DELETE, PG-like SQL.
  Pairs with an analytical list page once `$apply`/aggregation is on the wire.
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
