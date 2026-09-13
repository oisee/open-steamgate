# Prior art: a local IWBEP / OData runtime

**Date:** 2026-09-11 · **Scope:** running real `_MPC_EXT` / `_DPC_EXT` classes
offline (transpile → Open SQL over SQLite → OData v2 → Fiori Elements), deploying
back via abapGit.

This document merges two independent research passes over the Lars Hvam /
abaplint / open-abap / abapGit ecosystem plus SAP's JS OData tooling: a
multi-agent workflow sweep (7 source agents that read source *in-repo*, a
synthesis pass, and an adversarial completeness critic) and a separate manual
sweep. They converge on the same headline and the same single most important
artifact — `open-abap/open-abap-odata` — and are reconciled below.

## One-line finding

> The **substrate** (transpile ABAP → run Open SQL over SQLite → serve UI5)
> exists, is MIT/Apache, and is reusable. The **Gateway** — everything at and
> above the `/IWBEP/` line — does not exist as working code anywhere, and is the
> novelty to build. The two mature halves (abaplint runtime; SAP's JS OData
> tooling) have **no code connecting an OData request to a transpiled DPC
> method.**

> **Update 2026-09-11:** the hand audit prescribed below has been done. See
> `2026-09-11-lars-ecosystem-audit.md` for the verified-by-run state of
> `open-abap-odata`, the open-abap house style to adopt, and a ranked quick-win
> list. Its §7 lists the corrections to this document.

## Reconciling the two passes

Both passes independently identified `open-abap/open-abap-odata` as the crucial
prior art. They differ on how deep they could see:

- The **manual sweep** could not read the internals (GitHub blob/raw and
  DeepWiki blocked automated source access) → it marks everything about the
  project's MPC/DPC/`$filter` depth as *claimed, not verified*, and prescribes a
  hand audit (clone + read `src/`).
- The **workflow agents** did get in-repo and read source. Their verified read:
  the model registry **proves the plug-in contract for one flat string-keyed
  entity**, then `ASSERT 1='todo'` on associations / actions / nav-props / most
  EDM setters; `zcl_oao_http_handler` wires **only `GET_ENTITYSET`, hardcoded to
  one entity set**; `zcl_oao_request_context` is **100% todo-asserts**; and the
  `LICENSE` file **literally reads `"todo"`** with an empty `package.json`
  license field.

**Merged truth (stronger than either alone):** `open-abap-odata` is a
*validated skeleton, effectively unlicensed*. Its interface surface is the
contract; the real work is greenfield. Both passes agree the **`$filter` →
SELECT-OPTIONS bridge is confirmed net-new and the hard part.** A hand audit
(Sprint 0) is still worth doing to lock the go/fork/build call class-by-class,
but do not treat the skeleton as a working base.

---

## 1. Prior-art matrix

Best single source per component; coverage, evidence status, license, verdict.

| Component | Best source | Coverage | Verified? | License | Verdict |
|---|---|---|---|---|---|
| **mpc-model-api** (`IF_MGW_ODATA_MODEL` create_entity_type / add_property / set_key / assoc) | open-abap-odata (`zcl_oao_model`) | skeleton (one flat entity; rest todo-asserts) | verified-in-repo | ⚠️ **unlicensed** | **FORK & FILL** or reimplement fresh |
| **dpc-dispatch** (`IF_MGW_APPL_SRV_RUNTIME` GET_ENTITYSET/GET_ENTITY/CRUD) | open-abap-odata (`zcl_oao_http_handler`) | skeleton (only GET_ENTITYSET, one hardcoded set) | verified-in-repo | ⚠️ unlicensed | **FORK & BUILD**. Runner-up design template: fe-mockserver `fileBasedMockData` hooks |
| **request-context-filter** (`io_tech_request_context`: $filter→SELECT-OPTIONS, $orderby/$top/$skip/$select/keys) | fe-mockserver `filterParser.ts`/`applyParser.ts` (chevrotain) | parse only; the bridge itself absent | verified-in-repo | Apache-2.0 | **REUSE parser + BUILD bridge — the crux.** open-abap-odata's context is 100% todo |
| **open-sql** (SELECT variants, FAE, joins/aggregates, client) | abaplint transpiler runtime + `@abaplint/database-sqlite` | full for the mainline; edges below | verified-in-repo | MIT | **REUSE AS-IS** |
| **ddic** (tables/domains/DTEL/structures → local schema) | transpiler `sqlite_database_schema.ts` | partial→full for schema-gen | verified-in-repo | MIT | **REUSE AS-IS**. Runner-up: abaplint core DDIC parse (production-grade) |
| **table-data-export** (blessed TABLE DATA capture, not code) | abapGit `src/data/` (TABU) | **full** | verified-in-repo | MIT | **REUSE AS-IS**. Blueprint: open-abap `load-table-contents` (TABU JSON → SQLite headless) |
| **odata-serializer** (v2/v4, $metadata/EDMX, $batch) | fe-mockserver-core (`router/` + `data/`) | **full** (v2 and v4) | verified-in-repo | Apache-2.0 | **REUSE-AS-LIBRARY / FORK** — replace file-based data layer with a DPC-backed one |
| **ui5-serving** (Fiori Elements local against OData) | `@sap-ux/ui5-middleware-fe-mockserver` + `@ui5/cli` | full | claimed-in-docs | Apache-2.0 | **REUSE AS-IS**. Template: abap2UI5 playground scaffold |
| **cds-sadl-rap** (CDS+annotations → OData, local) | *(none viable for ABAP)* | parse only (abaplint core) / none | verified-in-repo | core MIT; CAP core proprietary | **BUILD / DEFER** — no ABAP SADL/RAP runtime exists anywhere |
| **headless-deploy** (programmatic abapGit deserialize/pull) | abapGit deserialize / API | data-leg proven; code-push not a stable contract | data verified, push claimed-in-docs | MIT | **PIN a version + wrap.** Deploy-back stays SAP-side (vsp's job) |

**Reuse ledger:** REUSE-AS-IS — open-sql, ddic, table-data-export,
odata-serializer, ui5-serving. FORK & FILL / BUILD — mpc-model-api, dpc-dispatch
(pending license). REUSE-PARSER + BUILD-BRIDGE — request-context-filter.
BUILD/DEFER — cds-sadl-rap. PIN — headless-deploy.

---

## 2. Gap list — the novelty to build

Ranked by load-bearing weight and how confirmed the gap is.

1. **The `/IWBEP/` Gateway runtime — CONFIRMED GAP.** Four sources
   independently confirm nobody has a working one: `abaplint/deps` ships
   lint-only stubs ("no functionallity", some params mistyped as `string`);
   abapGit and abaplint core have zero framework; the SAP JS tools consume a
   *finished* model and never run ABAP. open-abap-odata is the only partial
   reimplementation and is a validated skeleton (one flat entity, then
   todo-asserts). **Build:** the in-memory EDM model registry, and the DPC
   dispatcher (verb+path → GET_ENTITYSET / GET_ENTITY / CREATE / UPDATE /
   DELETE / deep / action, key parsing, `$expand`).

2. **`io_tech_request_context` — the `$filter` → SELECT-OPTIONS bridge —
   CONFIRMED GAP, the vision's stated hard part.** The target ABAP construct
   (RANGES / SELECT-OPTIONS / IN) *is runnable* in the transpiler, and a mature
   JS `$filter`/`$apply` parser exists in fe-mockserver — but nothing translates
   a parsed query option into the `get_filter_select_options()`
   SIGN/OPTION/LOW/HIGH ranges (and `get_osql_where_clause`,
   $orderby/$top/$skip/$select/keys accessors) a DPC reads.
   **The single highest-risk piece of net-new work.**

3. **The seam — CONFIRMED GAP.** Two mature halves (transpiler's
   Open-SQL-over-SQLite + DDIC→schema on one side; fe-mockserver's OData
   serializer + FE serving on the other) with no code bridging an OData request
   to a transpiled DPC. Concretely: a fe-mockserver-core data-access plugin
   whose entity-set backing invokes the transpiled DPC method against SQLite.

4. **Request-body deserializer for CREATE/UPDATE — partial gap.** fe-mockserver
   gives v2/v4 wire (de)serialization for free; open-abap-odata has none. Wire
   it into the dispatcher's write path.

5. **ABAP CDS / SADL / RAP → OData — CONFIRMED GAP (possibly out of scope).**
   No local interpreter exists for ABAP DDLS/annotations, SADL push-down, or RAP
   behavior anywhere. abaplint core parses CDS fully but never serves it. **v1
   is SEGW-only (recommended); CDS/RAP deferred.**

6. **Open-SQL edges to probe, not assume.** `SELECT UNION` unsupported; no
   implicit MANDT/client handling (fixed client 123); FOR ALL ENTRIES / joins /
   aggregate completeness for *your* generated classes is undocumented (FAE had
   historical bugs — abaplint transpiler issue #196). Probe against real
   `_DPC_EXT` SQL before committing.

**Not gaps (settled, reuse):** table-data capture (abapGit TABU, full, MIT);
headless data → SQLite seed (proven in CI via `load-table-contents`); OData
v2/v4 wire serialization (fe-mockserver, full); FE/UI5 local serving
(ui5-middleware-fe-mockserver); DDIC→SQLite schema and Open-SQL execution
(transpiler). Code deploy-back stays SAP-side and is already the vsp sibling's
territory.

**License gate before any fork of the Gateway skeleton:** `open-abap-odata` is
effectively unlicensed (`LICENSE` = "todo", `package.json` license empty, as of
2026-09-11). Its stubs are a *spec, not a base*. Either get the grant clarified
or treat the interface signatures as the contract and reimplement fresh under
MIT — the surface is small and the real work is greenfield regardless.

---

## 3. Sharpest risks (adversarial completeness critic)

The critic flagged that the naïve plan under-weights the real long pole:

- **Dependency-closure of a real `_DPC_EXT` is likely the true long pole, not
  `$filter`.** `ZCL_*_DPC_EXT` inherits `/IWBEP/CL_MGW_ABS_DATA` (MPC from
  `/IWBEP/CL_MGW_ABS_MODEL`); real handlers fan into BAPIs, `CL_*` utils,
  authority-checks and message classes. abaplint/deps ships only stubs — the
  transpiler needs runnable *implementations* of every base class and util a DPC
  touches. **First move: pick 3–5 representative live `_DPC_EXT` classes and
  compute their actual dependency closure against open-abap-core +
  abaplint/deps.** This likely dwarfs Phase 2.
- **Many modern SEGW services are SADL-mapped** to a CDS/BOPF and have no
  hand-written `GET_ENTITYSET` — the DPC delegates to a SADL runtime that does
  not exist off-platform (Gap 5). Confirm the target corpus is *classic
  code-based* SEGW before committing.
- **The accessor surface is not one method.** Real DPCs variously call
  `io_tech_request_context->get_filter( )`, `~get_filter_select_options`, or
  read `it_filter_select_options` from the signature directly. Grep the target
  DPCs for which methods they actually call before building only one.
- **Fixed client 123 / SysID ABC / UTC / fixed-point** silently mis-execute any
  DPC branching on `sy-mandt` / `sy-sysid` / `sy-uzeit` or doing
  client-dependent SELECTs. Blast radius (most business tables are
  client-dependent) makes this a first-order correctness risk.
- **SEGW/DPC is almost always OData v2**; v4 rides with the deferred CDS/RAP
  path. State v1 as v2-only so v4 ambition isn't coupled to the SEGW path.

**Cheap checks that could *cut* Phase-2/3 risk (verify early):**
- fe-mockserver may already *evaluate* `$filter` (parse → predicate), not just
  parse — stronger prior art for Gap 2 than "parse only".
- Its data-access plugin seam may be a public, supported extension point — if
  so, Phase 3 is reuse not fork.
- `ui5-middleware-fe-mockserver` may accept an arbitrary external OData endpoint
  (not only file-based mock data) — load-bearing for Phase 4.

**Un-swept high-value sources to check:**
- **`SAP/abap-file-formats` + `-tools`** — SAP's *official* spec for
  SRVD/SRVB/DDLS/BDEF/IWSG file formats; highest-value for parsing the OData
  object graph and any future CDS/RAP path.
- Standalone OData query parsers as alternatives to lifting chevrotain out of
  fe-mockserver: `odata-v4-parser`/`odata-v4-literal` (Jaystack),
  `@cap-js/cds` `cds.parse.expr`.
- Alternative wire layers: `odata-v4-server` (Jaystack),
  `@cap-js-community/odata-v2-adapter` (cov2ap) — battle-tested v2, matches
  SEGW's v2 output.
- The open-abap org more broadly — a base-class impl of
  `/IWBEP/CL_MGW_ABS_DATA`/`ABS_MODEL`, and open-abap-odata git history/branches
  for a more-complete gateway than the single-entity-set skeleton.

**Meta-note:** every source consulted is Lars Hvam's abaplint ecosystem or SAP's
JS tooling — the sweep has a single-ecosystem bias. No independent (non-abaplint)
ABAP-runtime effort was checked to confirm the "nobody has a Gateway runtime"
claim is ecosystem-wide rather than abaplint-specific.

---

## 3a. How the risks turned out (2026-09-13)

Written 2026-09-11 before any code; this is the two-day-later record. The
research above stays as it was.

| Risk | Outcome |
|---|---|
| Dependency closure is the true long pole | **Measured, and no.** [`docs/2026-09-11-closure-probe.md`](2026-09-11-closure-probe.md): the closure of a hand-written DPC is DDIC (dtel/doma/tabl/ttyp), not code; standard classes on the DPC path are a handful. abapGit captures DDIC, so it is a script, not a shim farm. Caveat: public repos skew small. |
| Many services are SADL-mapped | **Confirmed** (3 of 8 in the probe). v1 stayed code-based SEGW; a read-only SADL runtime over CDS projections was built anyway (`src/sadl/`). BOPF, CRM one-order and RAP stay out. |
| The accessor surface is not one method | **Confirmed.** Corpus DPCs use both the signature table and `io_tech_request_context->get_filter( )`; both are implemented. |
| Fixed client 123 / no implicit MANDT | **Open, unchanged**, in `ANORMALIES.md`. A row seeded in client 001 is kept visible in the demo with a test on it. |
| SEGW/DPC is v2 | **Confirmed and adopted:** v2 only. |
| open-abap-odata unlicensed | **Unchanged upstream** (`LICENSE` = `todo`). Used as the *interface* layer, runtime reimplemented clean-room under MIT, fixes contributed back as PRs #40–#48 and #56–#63 rather than forked. |
| Cheap check: does fe-mockserver evaluate `$filter`? | **Moot.** The wire layer had to be ABAP to run on a system, so nothing of fe-mockserver is mounted; the project has no dependency on it. The `$filter` bridge is `src/gateway/zcl_stg_filter`. |
| Cheap check: is its data-access seam public? | **Moot**, same reason. The dispatcher calls the transpiled DPC directly. |
| Cheap check: can `ui5-middleware-fe-mockserver` point at an external endpoint? | **Not needed.** express serves `webapp/`, SAPUI5 comes from SAP's CDN, and the same files deploy as a BSP. |

---

## 4. Build order (weeks-scale)

- **Phase 0 — substrate stand-up (~all reuse).** Fork the abap2UI5 *playground*
  pipeline (esbuild + transpiler DB hook + ui5-tooling + offline SW) as the
  harness. Transpile one real `ZCL_*_MPC_EXT`/`_DPC_EXT`. Generate the SQLite
  schema from DDIC (`sqlite_database_schema.ts`). Seed rows via abapGit TABU →
  `load-table-contents`. **Exit test:** the transpiled DPC's Open SQL returns
  rows from local SQLite.
- **Phase 1 — Gateway model + dispatch.** Clear the license question;
  reimplement the `/IWBEP/IF_MGW_ODATA_MODEL` registry (associations, keys, EDM
  primitives) and a *generic* DPC dispatcher covering GET_ENTITYSET/GET_ENTITY +
  CRUD with real key parsing.
- **Phase 2 — the crux: request-context.** Vendor fe-mockserver's chevrotain
  `filterParser`/`applyParser` as the parse reference; build the
  `$filter`→SELECT-OPTIONS translator and a populated `io_tech_request_context`.
  Timebox; back with differential tests against stock MockServer / fe-mockserver
  as an OData-conformance oracle.
- **Phase 3 — wire layer.** Mount fe-mockserver-core as front-of-house (v2/v4
  router, $metadata/EDMX, $batch, body deserialization); implement a data-access
  plugin whose entity sets call the Phase-1 dispatcher. Reuse `edmx-parser` +
  `annotation-converter` + `vocabularies-types`.
- **Phase 4 — Fiori serving.** Serve a real FE app via
  `ui5-middleware-fe-mockserver` + `@ui5/cli` pointed at the DPC-backed
  endpoint; ship the offline PWA path from the abap2UI5 template.
- **Deferred / out of scope:** ABAP CDS/SADL/RAP → OData (Gap 5); code push-back
  to SAP (SAP-side, already vsp). Pin abapGit versions — the API is not a stable
  contract.

**Critical path: Phase 2** (request-context) is the long pole and the true
novelty; Phases 0/3/4 are largely assembly of MIT/Apache parts.

### 4a. What actually happened (2026-09-13)

- **Phases 0, 1, 2 and 4 all landed on 2026-09-11**, the day this plan was
  written. Phase 2, the declared critical path, was one commit
  (`$filter -> SELECT-OPTIONS bridge (zcl_stg_filter)`): the shape of a
  SELECT-OPTIONS row is small and the DPC on the other side is the oracle.
  The differential-test harness against stock MockServer was never built; the
  corpus DPCs and a real Fiori client turned out to be the sharper oracle.
- **Phase 3 was dropped as designed.** fe-mockserver is built around mock data
  files, and everything it would have contributed (router, `$metadata`,
  `$batch`, body deserialization) has to exist in ABAP for the same classes to
  run in a system's ICF. So the wire layer is one `if_http_extension` behind
  `cl_express_icf_shim` on Node and behind a service worker in the browser
  build, with the serializer in ABAP (`zcl_stg_json`, `zcl_stg_batch`).
- **The real long pole was SEGW**, not the Gateway: reading and writing the
  project tree the way the transaction does (`tools/segw-gen.mjs`,
  `tools/stg-compile.mjs`, `tools/segw-tree.mjs`, byte-identical over 21 real
  projects), the generator in ABAP, and the Service Builder as a Fiori app.
- **Deferred items that arrived anyway:** read-only SADL over CDS, an
  analytics cube, search helps, RFC replay and a live RFC client, DuckDB,
  media entities. Still deferred: BOPF, RAP, drafts, v4, push-back to SAP.

---

## 5. Sources

**verified-in-repo**
- abaplint/transpiler — runtime + Open SQL + SQLite: `runtime/src/db/db.ts`,
  `packages/database-sqlite`, `statements/select.ts`,
  `db/schema_generation/sqlite_database_schema.ts` (MIT) —
  https://github.com/abaplint/transpiler
- abaplint/deps — `/IWBEP/` gateway lint stubs ("no functionallity") (MIT) —
  https://github.com/abaplint/deps/tree/main/src/gateway
- abaplint core — DDIC parse (`table.ts`/`domain.ts`/`data_element.ts`/
  `table_type.ts`), CDS parse (MIT) — https://github.com/abaplint/abaplint
- open-abap/open-abap-odata — Gateway shim skeleton; `zcl_oao_model`,
  `zcl_oao_http_handler`, `zcl_oao_request_context`, `src/exceptions/`
  reimplements `/IWBEP/CX_MGW_BUSI_EXCEPTION` (⚠️ **unlicensed**,
  `LICENSE`="todo") — https://github.com/open-abap/open-abap-odata
- open-abap/open-abap-core, express-icf-shim (`cl_express_icf_shim.run`),
  load-table-contents (`setup.mjs`, TABU JSON → SQLite) (MIT) —
  https://github.com/open-abap
- abapGit — `src/data/` TABU serializer + Data Config
  (`CHANGE_SUPPORTED_DATA_OBJECTS` exit) (MIT) —
  https://github.com/abapGit/abapGit ;
  https://docs.abapgit.org/user-guide/reference/data-config.html
- abap2UI5 / playground — transpile+SQLite+UI5-serving+offline scaffold (MIT) —
  https://github.com/abap2UI5/playground
- SAP/open-ux-odata — fe-mockserver-core (v2/v4 (de)serializer),
  `request/filterParser.ts` + `applyParser.ts`, `fileBasedMockData.ts`,
  edmx-parser, annotation-converter, vocabularies-types (Apache-2.0) —
  https://github.com/SAP/open-ux-odata
- cap-js/cds-dbs `@cap-js/sqlite` — model→SQLite DDL prior art (Apache-2.0) —
  https://github.com/cap-js/cds-dbs

**claimed-in-docs**
- abapGit programmatic deserialize/pull API — explicitly *not* a guaranteed
  contract — https://docs.abapgit.org/development-guide/api/api.html ;
  https://github.com/abapGit/abapgit-api-rfc
- `@sap-ux/ui5-middleware-fe-mockserver` serving FE locally —
  https://github.com/SAP/open-ux-odata
- SAP CAP core `@sap/cds` — **proprietary** (cannot fork) — https://cap.cloud.sap
- `sap.ui.core.util.MockServer` (OpenUI5, Apache-2.0) — conformance-reference
  only — https://github.com/SAP/openui5

**inferred**
- Transpiler has no deploy-to-SAP path; deploy-back is inherently SAP-side —
  https://github.com/abaplint/transpiler

## 6. Provenance

- Multi-agent workflow sweep (7 source agents in-repo + synthesis + adversarial
  completeness critic), 2026-09-11.
- Independent manual sweep, 2026-09-11 (blocked from reading open-abap-odata
  internals; internals-depth claims from that pass are superseded by the
  workflow's verified-in-repo read above).
