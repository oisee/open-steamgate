# CLAUDE.md

**open-steamgate** — a local IWBEP / OData runtime that runs real ABAP
`_MPC_EXT` / `_DPC_EXT` classes offline (transpile → Open SQL over SQLite →
OData → Fiori), deploying back through abapGit.

> **Doc intent:** CLAUDE.md = dev context (this file). README.md = the pitch and
> the prior-art matrix. docs/ = research and the layer knowledge we carry over
> from sibling projects. AGENDA.md = what is open and what was decided.

---

## Where this repo is

**CRUD works end to end (2026-09-11); `$batch`, `$expand`, navigation next.**
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
- **No SAP API is called by the agent.** abapGit is the blessed last mile for
  code and for the one-time seed-data capture. Deploy-back stays SAP-side and is
  already the vsp sibling's territory.
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
  interface part of **our fork** `oisee/open-abap-odata` as libs. `folder`
  points at `.local/lars/` / `.local/fork/` clones when present, else the URL
  is cloned. Interface-layer changes go into the fork, never as PRs upstream
  (decision 2026-09-11).
- ABAP goes under `src/` (7.02-compatible, `open-abap` abaplint version),
  tests under `test/unit/*.clas.testclasses.abap`, seed captures under `data/`
  as abapGit TABU JSON (`test/seed.mjs` pads CHAR to DDIC length).
- Every SAP-vs-open-abap discrepancy goes into `ANORMALIES.md` before any
  workaround. Known: no implicit MANDT; `sy-mandt = 123`.
- Closure audit of a real DPC: `npm run probe -- <folder> [--lib <stubs>]`.
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
