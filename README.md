# open-steamgate

**Run real SAP `_MPC_EXT` / `_DPC_EXT` OData classes offline — no system attached.**

`open-steamgate` is a research project and integration harness for a **local
IWBEP / OData runtime**: cross-compile the actual ABAP Gateway model- and
data-provider classes, run their Open SQL against a local SQLite database seeded
once through a blessed export, and serve the result as a real OData v2 service
that a Fiori Elements / UI5 front end consumes — all without a live SAP system.
Deploy back through abapGit when you want to.

The name: `vsp` (vibing-steampunk) → `steamgate`. **Gate** = the SAP Gateway,
the `/IWBEP/` framework this project reimplements the runtime of.

> **Status: CRUD, `$batch`, navigation, `$expand`, deep insert, function
> imports, value helps (F4 by `Common.ValueList`, `search` → `iv_search_string`,
> text arrangement), an object page (bookings via navigation, Edit/Save as
> MERGE with Gateway semantics, Create below the parent as
> `POST TravelSet('..')/to_Bookings`), a launchpad sandbox with two apps and
> intent-based navigation between them, and read-only SADL over CDS projections (with analytics
> annotations) work end to end, on SQLite or DuckDB (`STG_DB=duckdb`).** `npm test`
> serves a SEGW-shaped demo DPC, transpiled and running Open SQL over SQLite,
> as OData v2: `$metadata`, entity sets, keys, `$filter` delivered as
> SELECT-OPTIONS, `$top/$skip/$orderby/$inlinecount/$count`, POST/PUT/DELETE
> through the DPC's create/update/delete, `$batch` with changesets,
> navigation properties and `$expand`. A Fiori
> Elements list report in `webapp/` lists, filters and deletes through it
> (`npm run e2e`). **Try it without installing anything:**
> [oisee.github.io/open-steamgate/main/app/](https://oisee.github.io/open-steamgate/main/app/)
> runs the whole gateway in your browser (a service worker over sql.js, see
> [`docs/preview-deployments.md`](docs/preview-deployments.md)); every pull
> request gets its own copy.
> See `AGENDA.md`. This repo also holds the
> research that scopes the work — a verified prior-art matrix, a gap-list of the
> genuinely-novel pieces, and a phased build order. See
> [`docs/prior-art.md`](docs/prior-art.md). The layers we have already
> reverse-engineered in sibling projects (SAP compression, EXPORT data
> clusters, the ADT transport) are indexed in
> [`docs/layers-we-own.md`](docs/layers-we-own.md).

---

## Run it

Node 22 or 24.

```sh
git clone https://github.com/oisee/open-steamgate && cd open-steamgate
npm ci
npm start                    # transpile + serve: http://localhost:3030/app/index.html
                             # the launchpad with both apps: http://localhost:3030/app/flp.html
npm test                     # abaplint + ABAP Unit + mocha over the wire
npm run e2e:install && npm run e2e         # Playwright against localhost:3030
npm run web:preview && npm run web:serve   # the browser-only build on :3031
npm run start:duckdb         # the same on DuckDB (STG_DB_PATH=x.duckdb persists)
npm run stg:compile -- src/demo/zstg_demo.stg.yaml --out gen/demo   # SEGW without the GUI
```

The first transpile clones `open-abap-core`, `express-icf-shim` and our fork of
`open-abap-odata` from GitHub unless `.local/` already holds them.

## What the demo is made of

Bottom up, every layer is real, nothing is mocked:

1. **DDIC and data** — `src/ddic/*.tabl.xml` (abapGit format), seed rows in
   `data/*.tabu.json` (`abapGit serialize` format for table contents).
2. **SEGW registration objects** — `zstg_demo_srv ... 0001.iwsv.xml` (service
   → DPC class) and `zstg_demo_mdl ... 0001.iwmo.xml` (model → MPC class), as
   abapGit serializes them. `tools/segw-registry.mjs` reads them and generates
   the registry, so a cloned SEGW repository registers its own services
   (`npm run segw -- path/to/repo --list` shows what it would find).
3. **SEGW-shaped classes** — `src/demo/zcl_zstg_demo_mpc` defines the model
   through `/iwbep/if_mgw_odata_model` (entity types, sets, associations,
   function imports, a value-help set); `zcl_zstg_demo_dpc_ext` is the data
   provider: `it_filter_select_options` → Open SQL with ranges, paging, CRUD,
   deep insert, `get_expanded_entityset`, `iv_search_string`. This is the code
   that lives in a customer system.
4. **The `/IWBEP/` interfaces** — from `open-abap/open-abap-odata`, where the
   model, `$metadata`, annotations and SADL signatures we needed went back
   upstream as PRs #40–#48.
5. **The Gateway** (`src/gateway/`) — URL parser, `$filter` → SELECT-OPTIONS,
   request context with every `io_tech_request_context` facet, dispatcher,
   OData v2 JSON, `$batch`, `$expand`, entry provider. The part that existed
   nowhere in open source.
6. **Runtime** — the abaplint transpiler turns all of it into JavaScript;
   Open SQL runs on SQLite (Node), sql.js (browser) or DuckDB.
7. **Front** — two Fiori Elements V2 apps with no JavaScript of their own:
   Travels (`webapp/manifest.json`, `annotations/annotations.xml`: list
   report, object page, the booking's page below it) and Bookings
   (`webapp/booking/`). `UI.LineItem`, `UI.SelectionFields`,
   `Common.ValueList`, `Common.Text`, `UI.DataFieldForIntentBasedNavigation`
   and `UI.DataFieldWithIntentBasedNavigation` link them by intent;
   `webapp/flp.html` is the launchpad sandbox (`sap.ushell` from the same
   CDN) that resolves `Travel-manage` and `Booking-display`. SAPUI5 1.120 from
   SAP's CDN: Fiori Elements, the smart controls and the launchpad are not
   part of OpenUI5, and the point is that real Fiori apps run unchanged.
   SAPUI5 is SAP's, not part of this project.
8. **Preview** — layers 1–6 in a service worker, layer 7 as static files, on
   GitHub Pages ([`docs/preview-deployments.md`](docs/preview-deployments.md)).

The row **T0009 "Other client, must not leak"** is on purpose: it is seeded
in client 001, a real system (client 123) would not show it. The transpiler
has no implicit MANDT yet (`ANORMALIES.md`), so it leaks through; the demo
keeps it visible as a live reminder, and a unit test pins the behaviour.

## Why

The classic way to test an ABAP OData service is to have SAP. That gates every
edit on a system round-trip, a transport, an activation. But the *substrate*
needed to run these classes off-platform already exists as mature MIT/Apache
open source — an ABAP→JS transpiler with an Open-SQL-over-SQLite runtime, a
DDIC→schema generator, a blessed table-data exporter, and a complete OData
v2/v4 serializer. **What is missing is the one piece that connects them: the
`/IWBEP/` Gateway runtime that turns an OData request into a call on a
transpiled DPC method.** That gap — and only that gap — is what this project
builds.

It is a clean-room reimplementation of the `/IWBEP/` *interfaces*: no SAP source
is bundled, no standard DDIC is shipped, and the agent building it touches no
SAP API. abapGit is the blessed last mile for code and for the one-time seed
data capture.

---

## The finding, in one line

> The **substrate** (transpile ABAP → run Open SQL over SQLite → serve UI5)
> exists, is MIT/Apache, and is reusable. The **Gateway** — everything at and
> above the `/IWBEP/` line — does not exist as working code anywhere, and is the
> novelty this project builds. The two mature halves have **no code connecting
> an OData request to a transpiled DPC method.**

## Prior-art matrix

Best single source per component. Full evidence, licenses and runner-ups in
[`docs/prior-art.md`](docs/prior-art.md).

| Component | Best source | Coverage | Verdict |
|---|---|---|---|
| **Open SQL → SQLite** execution | abaplint transpiler + `@abaplint/database-sqlite` | full | **REUSE AS-IS** |
| **DDIC → local schema** | transpiler `sqlite_database_schema.ts` | partial→full | **REUSE AS-IS** |
| **Table-data export** (blessed) | abapGit `src/data/` (TABU) + open-abap `load-table-contents` | full | **REUSE AS-IS** |
| **OData v2/v4 serializer** ($metadata, $batch) | `@sap-ux/fe-mockserver-core` | full | **REUSE / FORK** |
| **UI5 / Fiori Elements local serving** | `@sap-ux/ui5-middleware-fe-mockserver` | full | **REUSE AS-IS** |
| **MPC model-API** (`IF_MGW_ODATA_MODEL`) | `open-abap/open-abap-odata` | skeleton | **FORK & FILL** ⚠️ license |
| **DPC dispatch** (`IF_MGW_APPL_SRV_RUNTIME`) | `open-abap/open-abap-odata` (`ZCL_OAO_HTTP_HANDLER`) | skeleton | **FORK & BUILD** ⚠️ license |
| **`$filter` → SELECT-OPTIONS** (`io_tech_request_context`) | fe-mockserver parser (parse only) | none for the bridge | **BUILD — the crux** |
| **CDS / SADL / RAP → OData** | *(none viable for ABAP)* | none | **BUILD / DEFER** |
| **Headless deploy-back** | abapGit deserialize | partial | **PIN + wrap** (stays SAP-side) |

## The gaps we actually build

1. **The `/IWBEP/` Gateway runtime.** `open-abap-odata` is a *validated
   skeleton, not a product*: it proves the plug-in contract for one flat
   string-keyed entity, then `ASSERT 1='todo'`s associations, actions,
   nav-props and most EDM setters; `ZCL_OAO_HTTP_HANDLER` wires only
   `GET_ENTITYSET`, hardcoded to a single entity set. Build the in-memory EDM
   model registry and a generic DPC dispatcher (verb+path → GET_ENTITYSET /
   GET_ENTITY / CREATE / UPDATE / DELETE / deep / action, key parsing,
   `$expand`).
2. **`io_tech_request_context`: the `$filter` → SELECT-OPTIONS bridge** — the
   vision's stated hard part and the single highest-risk piece. The target ABAP
   (RANGES / SELECT-OPTIONS / IN) *runs* in the transpiler; a mature JS
   `$filter` parser exists in fe-mockserver — but nothing translates a parsed
   query option into the SIGN/OPTION/LOW/HIGH ranges a DPC reads.
   `open-abap-odata`'s request context is 100% todo-asserts.
3. **The seam.** A fe-mockserver data-access plugin whose entity-set backing
   invokes the transpiled DPC method against SQLite.
4. **Request-body deserializer** for CREATE/UPDATE (fe-mockserver gives the wire
   for free; wire it into the dispatcher's write path).

## Sharpest risks (from the adversarial critic)

- **Dependency-closure of a real `_DPC_EXT` may be the true long pole**, not
  `$filter`. `ZCL_*_DPC_EXT` inherits `/IWBEP/CL_MGW_ABS_DATA`; real handlers
  fan into BAPIs, `CL_*` utils, auth-checks and message classes — the
  transpiler needs runnable *implementations* of all of it, not stubs. **First
  move:** pick 3–5 representative live `_DPC_EXT` classes and compute their
  actual dependency closure against what `open-abap-core` + `abaplint/deps`
  implement.
- **Many modern SEGW services are SADL-mapped** to CDS/BOPF and have no
  hand-written `GET_ENTITYSET` at all → no transpilable ABAP. **v1 targets
  classic code-based SEGW only**; CDS/SADL/RAP is deferred.
- **Fixed client 123 / SysID ABC / no implicit MANDT** in the transpiler runtime
  is a *first-order* correctness risk (most business tables are
  client-dependent), not an edge.
- **`open-abap-odata` is effectively unlicensed** (`LICENSE` reads `"todo"`,
  `package.json` license empty). Treat its stubs as a *spec*, reimplement the
  small interface surface fresh under MIT, or get the grant clarified before any
  fork.

## Build order (weeks-scale)

- **Phase 0 — substrate stand-up** (mostly reuse): transpile one real
  `MPC_EXT`/`DPC_EXT`, generate the SQLite schema from DDIC, seed rows via
  abapGit TABU → SQLite. Exit test: the DPC's Open SQL returns rows from local
  SQLite.
- **Phase 1 — Gateway model + dispatch:** clear the license question;
  reimplement the model registry and a *generic* DPC dispatcher.
- **Phase 2 — the crux, request-context:** build the `$filter`→SELECT-OPTIONS
  translator; back it with differential tests against the stock MockServer /
  fe-mockserver as an OData-conformance oracle.
- **Phase 3 — wire layer:** mount fe-mockserver-core as front-of-house (router,
  $metadata, $batch, body deserialization); plug its data access into the
  Phase-1 dispatcher.
- **Phase 4 — Fiori serving:** serve a real FE app via
  `ui5-middleware-fe-mockserver` pointed at the DPC-backed endpoint.
- **Deferred / out of scope:** CDS/SADL/RAP; code push-back to SAP (SAP-side,
  already the sibling projects' territory).

**Critical path: Phase 2.**

---

## Family

open-steamgate is the OData/Gateway member of a family of SAP-protocol projects.
Public siblings:

- **[vsp / vibing-steampunk](https://github.com/oisee/vibing-steampunk)** — the
  Go-native MCP server + CLI for ABAP Development Tools (ADT). Owns the ADT
  transport, `pkg/sapcompress` (SAP-LZH / LZC **decode**), `pkg/datacluster`
  (EXPORT cluster parser) and the `ZADT_VSP` bridge. abapGit deploy-back — the
  last mile into a real system — is already its territory.
- **[open-rfc-go](https://github.com/oisee/open-rfc-go)** — pure-Go NI / RFC /
  CPIC transport, sniffer/proxy, RFC client and type-3 server.

Two further siblings (a DIAG-protocol project carrying the SAP-LZH **writer**,
and a shared SAP knowledge base) are private; the reusable protocol facts they
hold are summarized here in [`docs/layers-we-own.md`](docs/layers-we-own.md).

## Prior art we build on

MIT unless noted. Full source list with evidence in
[`docs/prior-art.md`](docs/prior-art.md).

- [abaplint/transpiler](https://github.com/abaplint/transpiler) — ABAP→JS
  transpiler + Open-SQL-over-SQLite runtime (Lars Hvam et al.)
- [open-abap/open-abap-odata](https://github.com/open-abap/open-abap-odata) —
  the `/IWBEP/` Gateway shim skeleton (⚠️ license unclear)
- [abapGit](https://github.com/abapGit/abapGit) — Data Config (TABU) blessed
  data export; deserialize as the deploy-back path
- [SAP/open-ux-odata](https://github.com/SAP/open-ux-odata) — fe-mockserver
  OData v2/v4 serializer + FE serving (Apache-2.0)

## License

MIT — see [`LICENSE`](LICENSE). This project is a clean-room reimplementation of
the `/IWBEP/` *interfaces*; it bundles no SAP source and no standard DDIC.
