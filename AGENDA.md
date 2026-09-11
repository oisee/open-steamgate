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

## Phase 0 — done 2026-09-11

`npm test` is green: abaplint, transpile, 6 ABAP Unit tests, 2 mocha wire
tests. A hand-written SEGW-shaped MPC/DPC (`src/demo/`) runs its Open SQL
against SQLite seeded from an abapGit TABU capture (`data/`), honours
`it_filter_select_options`, paging and `it_key_tab`. The ICF handler answers
501 until the dispatcher exists. First two entries in `ANORMALIES.md`.

## Sprint 0 — audit before building (highest priority)

Do this before any architectural commitment.

- [ ] **Dependency-closure probe.** Pick 3–5 representative real `_DPC_EXT`
      classes; compute their actual dependency closure (base classes, BAPIs,
      `CL_*` utils, auth-checks, message classes) against what `open-abap-core`
      + `abaplint/deps` implement. Critic's finding: this likely dwarfs Phase 2
      and is the real long pole. **Tool ready:** `npm run probe -- <folder>`
      (`tools/closure-probe.mjs`); iterate, adding stubs via `--lib`, until the
      table is empty. Needs the real classes under `.local/` (never tracked).
- [ ] **Corpus check.** Confirm the target services are classic code-based SEGW,
      not SADL-/RAP-generated (which have no transpilable `GET_ENTITYSET`).
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
- [ ] **QW5** Truthful `$metadata` (keys, entity sets, the 11 EDM setters).
- [ ] **QW2** Generic entity serializer via RTTI.
- [ ] **QW3** URL + `$top/$skip/$orderby/$count/keys` into a populated
      request context.
- [ ] **QW4** `$filter` → SELECT-OPTIONS (the crux, timeboxed).

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
