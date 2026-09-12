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
  `oisee/open-abap-odata`** (decided 2026-09-11; revised 2026-09-12: **we
  work in the fork and send the reusable pieces upstream as PRs**, one at a
  time: #40 registry + exception constructors (merged 2026-09-12), #42 EDM
  setters + facets (open); queued behind it on fork main: associations,
  function imports, `get_expanded_*` in the base class, SADL interfaces +
  annotations. Fork `main` = `upstream/main` + that queue, rebased after
  every merge. Steamgate first, backport what is proven). For the
  transpiler the same rule: fixes go as PRs from branches of `oisee/transpiler`
  off `upstream/main` (#1829 literal length, #1830 FAE dedupe, #1831 views +
  CREATE DATA TABLE OF, #1832 FAE empty driver; all merged and released as
  2.13.86 the same day, workarounds removed). Pulled in as a transpiler lib with
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
      4c2c301 (2026-09-11). Sent upstream as open-abap-odata PR #40
      (2026-09-12); open-steamgate consumes the fork without `exclude_filter`.
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

## Call with Lars, 2026-09-12 (what was agreed; the details stay off the record)

- **Upstream PRs are welcome, one fix at a time, small scope.** Anomalies go
  upstream as separate fixes, not into our workaround pile. NPM releases lag
  the merge; plan for it (#1829–#1832 merged the same day, release pending).
- **open-abap-odata license (#39):** no license is deliberate; Lars leans
  towards MIT but has not decided. Issue closed after the call. Our stance
  stays: interfaces as the spec, clean-room MIT implementation here.
- **open-abap-odata's original goal = ours:** a full OData runtime written in
  ABAP so old Gateway services run on Steampunk without SEGW ("replace the
  runtime, not the services").
- **Nothing that auto-connects to a real SAP system** goes into Lars's repos.
  A "local runtime → real system for missing FM/class, human in the loop"
  bridge is a side project on our side only.
- **Tooling stance (Lars):** catch mistakes with the linter, not with LLM
  rules; no skills/MCP; Node is enough; DDIC/standard-class scaffolds in
  abapGit form belong in `dependencies`.
- **Look at:** open-abap-gui (browser-only front + transpiled back on GitHub
  Pages, visual before/after diffs in PRs; classic reports → classes).
- **Open:** collaboration model (PRs straight into open-abap-odata vs our
  fork as the source); abapGit REST API as the blessed deploy path; whether a
  local SADL / V4 / RAP simulator is needed at all. RFC and a DIAG front:
  "cool but not necessary".

### Links Lars shared after the call (public)

- [larshp/hithub](https://github.com/larshp/hithub) — GitHub clone in ABAP,
  MIT, active. `docs/preview-deployments.md` is the pattern to copy: the
  transpiled app + SQLite-compiled-to-JS bundled by webpack into a **service
  worker**, served from GitHub Pages per PR, screenshots + visual diffs
  against `main`, pinned clock so diffs are deterministic. Same ICF shim we
  use. Has its own `ANORMALIES.md` and an abapGit-metadata script.
- [larshp/zqjs](https://github.com/larshp/zqjs) — a JavaScript engine in ABAP
  derived from QuickJS. The answer to "Steampunk has no JS engine".
- [larshp/stock-allocation-fun](https://github.com/larshp/stock-allocation-fun/pulls)
  — one task, one PR per model (Opus 5, Sol, Astra, Ox Alpha, DeepSeek…): a
  model bake-off on ABAP with preview deployments as the judge.
- [Flow one-pagers](https://docs.heliconialabs.com/flow-onepagers.pdf)
  (Heliconia Labs, July 2026) — abapGit Flow process deck; one-pager 11
  "Transport Sequencing and Preview Deployments" is where a local Gateway +
  Fiori preview per PR would slot in.
- [OpenCode Go](https://opencode.ai/go) — flat-fee key for open-weight
  models with OpenAI/Anthropic-compatible endpoints; the tooling direction
  Lars mentioned (nothing vendor-specific).
- [Gallo, DEFCON 20 (2012): Uncovering SAP vulnerabilities, reversing the
  Diag protocol](https://defcon.org/images/defcon-20/dc-20-presentations/Gallo/DEFCON-20-Gallo-Uncovering-SAP-Vulnerabilities.pdf)
  — the public prior art for DIAG (Core Security, later pysap). Citable in
  `docs/layers-we-own.md`.

**Done 2026-09-12: object page.** `sap.suite.ui.generic.template.ObjectPage`
in the manifest, `UI.Facets` + `UI.FieldGroup#General` + bookings through
`to_Bookings/@UI.LineItem`; non-draft Edit/Save. The gateway now does what
the Gateway does on PATCH/MERGE: `get_entity` first, the request laid over
it (`zcl_stg_entry_provider->set_base`), so Fiori's MERGE of one field no
longer blanks the rest. Fork: `bind_structure` derives
`sap:display-format="Date"` for DATS fields (dates render as dates).

**Lars, 2026-09-12 (afternoon):** invited `oisee` as collaborator on
`abaplint/transpiler` and `open-abap/open-abap-odata`, saw the preview
("looks promising") and said yes to backporting the steamgate work into
open-abap-odata; later the same day: self-merging there is fine, he has no
time for it. **Queue drained 2026-09-12 evening:** #43 associations, #44
function imports, #45 expanded reads, #46 SADL interfaces + annotations,
#47 display-format Date, #48 searchable, all merged (CI green, squash).
Fork `main` == upstream; `abap_transpile.json` now takes upstream directly.

**Done 2026-09-12: value helps.** `StatusVHSet` in the demo MPC/DPC,
`Common.ValueList` on Status and TravelId, `Common.Text` + `TextArrangement`
(StatusText filled by the DPC), `search` → `iv_search_string`; e2e opens the
F4 dialog, searches, picks, filters. Next in this line: object page
(`$expand` to bookings, edit), then `$search` on the list, console cleanup.

**Done 2026-09-12: the preview build.** `npm run web:preview` puts the gateway
into a service worker (sql.js), `preview.yml` deploys `main/` and `pr-<n>/`
to GitHub Pages with screenshots; `docs/preview-deployments.md`. Visual diffs
against `main` (hithub's `generate-screenshot-diffs.mjs`) are the next step.

## Backlog: SEGW offline (decided 2026-09-12, "отличный план")

SEGW is two things: an editor for the project tree and a generator. We do
the generator, the editor is the file.

1. **IWMO/IWSV → registry. Done 2026-09-12 evening.** `tools/segw-registry.mjs`
   reads `<service>.iwsv.xml` (group → model, service → DPC class) and
   `<model>.iwmo.xml` (model → MPC class), joins them by model + version and
   generates `gen/segw/zcl_stg_segw_registry`; the demo now carries its own
   IWSV/IWMO and registers itself, the servers call the generated class. Over
   the corpus it finds 11 services in 8 repos, incl. a SADL one whose DPC is
   `CL_SADL_GTK_EXPOSURE_DPC` and a project whose classes end in `_CUST`, not
   `_EXT`: class names must come from the objects, never from a convention.
2. **IWPR → `_MPC`/`_DPC` generator. First cut 2026-09-12 evening:**
   `tools/segw-gen.mjs` reads the tree (`SBD_*` design: project, model,
   service, generated artifacts, operations per set; `SBO_*` model: entity
   types, properties, sets, associations, association sets, navigation
   properties, referential constraints, complex types, function imports and
   parameters) and writes `_MPC`/`_DPC` `.clas.abap` + `.clas.xml` and the
   two empty `_EXT`. `--check <folder>` diffs against the classes SEGW made
   from the same IWPR. Corpus score: `abap_simple_odata_service` all four
   files byte-identical (timestamps masked); DPC `.abap` identical on 5 of
   7 projects, the other 2 identical modulo method declaration order
   (abapGit version); MPC differs by known things only: text-element labels
   (the tree does not say which labels came from DDIC and which were typed:
   an option later), `super->define( )` of older releases (`--super-define`),
   `set_conversion_exit`, and two repos whose classes were generated from an
   older tree than the one committed. Not yet: RDS templates (`define_rds_n`,
   SADL DPC delegation), media, text pools. `_EXT` never overwritten.
   The project tree mixes sources: `SBD_DS.DS_TYPE` (5 = DDIC structure;
   the corpus has 14) and the `GENERATED_METHODS_RDS` attachment for
   reference data sources (CDS via SADL; 2 corpus projects, they call
   `cl_sadl_gw_model_exposure` in `_MPC_EXT` and `create_for_sadl` in
   `_DPC_EXT`). The generator must route RDS entities to our SADL runtime
   and leave DDIC ones to the hand-written DPC. RFC/BOR mapping and ODC
   (external services) exist in SEGW but not in the corpus: out of scope.
3. **Edit the model without a system.** No GUI: edit the IWPR (or a YAML
   that becomes one), regenerate, deploy the IWPR back through abapGit; SEGW
   on the system sees a normal project. "Not off-stack" for free.

Order: after `$search` / console / T0009 (this list), then 1, then 2.
Merging our own PRs in open-abap-odata: Lars said yes (no time), so the
queue is PR → CI → squash-merge by us. The transpiler stays his to merge. A
second session only for step 2 in its own worktree, if at all.

## Backlog: Gateway extension points the corpus really uses (2026-09-12)

Counted over the corpus DPC/MPC classes. Have: `sap:` annotations and
vocabulary in `$metadata`, SADL exposure, `execute_action`,
`get_expanded_*`, every `io_tech_request_context` facet, changeset types.
Missing, in order of use:
- `get_logger` (17) and `get_message_container` (8) from
  `/iwbep/if_mgw_conv_srv_runtime`: check what open-abap-core stubs and
  make them real (messages must reach the OData error body).
- `set_header` (5) / `get_request_header` (2) on the runtime: response and
  request headers from the DPC.
- media: `get_stream` / `create_stream` (4 each), `$value`, `set_is_media`.
- changesets: `changeset_begin` / `changeset_process` / `changeset_end`
  (4); today `$batch` calls the operations one by one.
- vocabulary annotation providers: `vocab_anno_model` (2) in `_MPC_EXT`,
  `/iwbep/if_mgw_vocan_model`, `IWVB` objects.

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
