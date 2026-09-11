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

> **Status: CRUD works end to end; `$batch` and `$expand` next.** `npm test`
> serves a SEGW-shaped demo DPC, transpiled and running Open SQL over SQLite,
> as OData v2: `$metadata`, entity sets, keys, `$filter` delivered as
> SELECT-OPTIONS, `$top/$skip/$orderby/$inlinecount/$count`, POST/PUT/DELETE
> through the DPC's create/update/delete. A Fiori Elements list report in
> `webapp/` renders it (`npm run e2e`).
> See `AGENDA.md`. This repo also holds the
> research that scopes the work — a verified prior-art matrix, a gap-list of the
> genuinely-novel pieces, and a phased build order. See
> [`docs/prior-art.md`](docs/prior-art.md). The layers we have already
> reverse-engineered in sibling projects (SAP compression, EXPORT data
> clusters, the ADT transport) are indexed in
> [`docs/layers-we-own.md`](docs/layers-we-own.md).

---

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
