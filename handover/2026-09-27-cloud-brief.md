# Cloud session brief (2026-09-27)

This branch exists only to hand work to a cloud Claude session. It carries
no code. Do not merge it into `main`.

## How to work from the cloud

- The session runs in `oisee/open-steamgate`. Most of the work is in
  `oisee/osg-demo`: clone it next to this checkout with
  `gh repo clone oisee/osg-demo ../osg-demo`, and push branches there.
- Bootstrap: `npm install && npm run bootstrap && npm run transpile`, then
  `npm test` to check the base. The `.local/` clones do not exist here;
  bootstrap fetches the libraries.
- Leak scan: `npm run leak` needs `.local/leak-identifiers.json`. That file
  is private and absent here, so the tool exits 2. That is expected: do not
  add an allow entry to work around it. Add no host names, IPs, user names
  or SAP system names anywhere. Alice runs the scan locally before
  anything is merged.
- The other machines' sessions ("dell", "stoker" on i7) are frozen, and
  none of them is reachable from here.
- CLAUDE.md in this repo is the dev context and applies in full.
- Chat with Alice in Russian. Code, commits and PRs are in English.
- The chapter order is fixed: do Objective 1 before 2. Open PRs; merge in
  osg-demo only after Alice has seen it.

## Other state not in the brief below

- `s2c1` (vscode.dev: launchpad + Travels in the web) is WIP on i7,
  `feat/web-launchpad-travels` (64e9086f; rebase it on main first). It is not in scope here.
- osg-demo `feat/fleet-slice` (4fb0211) holds stoker's PLAN.md for parts A/B/C,
  if pushed; read it before Objective 1, but this brief wins where the two differ.
- The Marketplace extension `oisee.open-steamgate` 0.2.1122 is in review.
  Alice uploads 0.2.1127 as the update after that; it is not a task here.

---

# Codex brief: osg-demo "Airship fleet" + open-steamgate beta tails

Written 2026-09-27. Repos:
- `oisee/open-steamgate` (the engine and the VS Code extension);
- `oisee/osg-demo` (the demo pack).

Contract: `osg-demo/docs/fleet-contract.md`, merged in osg-demo#1. It is the
source of truth for names and shapes. Change it only in the same PR that
needs the change.

## Rules (all tasks)

- Git identity per repo: `git config user.name "Alice V."`,
  `git config user.email ooisee@gmail.com`.
- Commits, PRs and code are in English.
- One PR per objective. Do not self-merge in open-steamgate without the
  `test` check green, and never use `gh pr merge --admin`.
- Public repos: no live identifiers (hosts, users, IPs, SAP system names).
  Before every push, from open-steamgate run
  `npm run -s leak -- --paths <changed files>`; it must say 0 matches.
- A new test file in open-steamgate must be registered in
  `test/suites.json`, or CI does not run it.
- ABAP must be 7.02-compatible and 7-bit ASCII (no em dashes in comments);
  run `npm run lint` / abaplint.
- New objects use `ZOSD_` / `ZCL_OSD_`, and live in package `$ZOSD_DEMO` in
  osg-demo.
- No SAP system calls.
- Kill processes by PID only.
- In open-steamgate, after a `web:vscode` build, run `npm run transpile`
  before mocha. The web build leaves a partial generation behind, which
  gives "no such table: zvdb_100_vec".

## Current state

- open-steamgate PR #166 (S2b1: OSD tree in the web entry) and #167 (S2d1:
  bounded read engine in the web worker; rebased at 3ab3bd32) are open.
  Merge each once its `test` check is green and it is MERGEABLE.
- osg-demo #2 (README install section) is open. Merge it only after the
  Marketplace listing `oisee.open-steamgate` is live (0.2.1122 is in
  review).
- W1 (#158, workspace folders with `osd-pack.json` layered as full packs)
  is in main.

## Objective 0: engine fix, pack app manifest rebase (open-steamgate)

**This fix already exists:** branch `fix/pack-app-manifest-rebase` (commit
a7a12e69, critic-passed) is pushed to `origin` once the i7 session pushes
it. If the branch is on origin, open a PR from it and check it against the
spec below. Build it yourself only if the branch is absent.

Branch `fix/pack-app-manifest-rebase`. `packApps` in
`tools/osd-bsp-registry.mjs` copies a pack's `webapp/manifest.json`
verbatim. Instead, it must rebase the OData data-source URI the way
declared apps are rebased, so that a pack's Fiori app loads data from the
local gateway.

Acceptance:
- a mocha test with a fixture pack whose manifest points at
  `/sap/opu/odata/sap/<SRV>/`: the served manifest has the rebased URI;
- the test fails without the fix;
- the test is registered in `test/suites.json`.

## Objective 1: first joint slice (osg-demo)

Branch `feat/fleet-slice`. Build exactly what the contract lists:
- DDIC: `ZOSD_FLEET_SHIP`, `ZOSD_FLEET_VOY`, `ZOSD_FLEET_STAT` (abapGit
  TABL XML), with `data/*.tabu.json` seed:
  - 6 ships (Albatross, Nimbus, Brass Heron, Cumulus, Lady Kelvin, Old
    Boiler), with every status used and 3 home ports;
  - 20 voyages in one year, and at least one ship with no voyages;
  - statuses D/A/M;
  - `MANDT` `123`, dates as ISO strings.
- `ZCL_OSD_FLEET_REPORT`:
  - it is a classrun (`if_oo_adt_classrun`);
  - `ship_lines( )` returns one line per ship with its voyage count and
    passengers;
  - `steam_check` asserts `steam_pct >= 0`;
  - test class `ltcl_fleet` with `counts_voyages`, and a commented-out
    `broken_on_purpose`.
- `src/zosd_fleet.stg.yaml`:
  - project `ZOSD_FLEET`, service `ZOSD_FLEET_SRV`, model `ZOSD_FLEET_MDL`;
  - sets `ShipSet` (CRUDQ), `VoyageSet` (RQ), `StatusVHSet` (from the
    elementary search help `ZOSD_FLEET_STATUS_SH`, mapping both `query`
    and `read`);
  - explicit `field:` for every underscored field; types
    `String(n)`/`Int32`/`Date`;
  - read-only `Ship.StatusText`, with
    `text: {path: StatusText, arrangement: TextFirst}`;
  - a ValueList with `inOut: {Status: Status}` and `displayOnly: Text`;
  - annotations: selectionFields [Status, HomePort], lineItem [ShipId,
    Name, Status, SteamPct, HomePort], and an object-page facet with the
    voyages.
- `ZCL_ZOSD_FLEET_DPC_EXT`: fills `StatusText`, and filters `Ship/Voyages`
  by `SHIP_ID`, because table sources have no association binding.
- `webapp/`:
  - a Fiori Elements V2 list report + object page over `ZOSD_FLEET_SRV`;
  - `crossNavigation.inbounds` has `AirshipFleet-display`;
  - `osd-pack.json` has a tile "Airship fleet" whose URL is
    `/app/flp.html#AirshipFleet-display`.
  The app name derives to `ZOSG_DEMO`. The app needs Objective 0 to load
  data.
- `deploy/manifest.json`: add the new objects to unit `osg-demo`.

Acceptance: one e2e assertion per item, run from an open-steamgate
checkout with `OSD_PACKS=<osg-demo> STG_PORT=<free port>`:
1. `GET .../ZOSD_FLEET_SRV/ShipSet/$count` is 6.
2. `POST /sap/bc/adt/oo/classrun/ZCL_OSD_FLEET_REPORT`: the plain text has
   a line for `S001`.
3. `ShipSet?$filter=Status eq 'A'` returns only ships with status A.
4. A ship changed with MERGE on `ShipSet('S002')` reads back with the new
   value.
5. The tile opens the list report and it shows 6 rows (Playwright).
6. `ltcl_fleet` is green.
Put the e2e script in osg-demo (`test/`) and document in its header how to
run it.

## Objective 2: chapters 2–4 text (osg-demo README)

Replace the "Coming" sections, each with numbered steps and an
**Expected:** result, in the style of chapter 1:
- ch2 Debug, tests, dumps:
  - breakpoint in `ship_lines`, then F9;
  - 3a: uncomment `broken_on_purpose`, and see a failed assertion;
  - 3b: set a negative steam value, run the classrun, and see the dump;
  - transaction `ZOSD_FLEET` through `ZCL_OSD_FLEET_TRAN`
    (`ZIF_OSD_TRANSACTION`, no `SUBMIT`).
- ch3 OData ladder: `$metadata` → ShipSet query/filter → MERGE → value
  help → `Ship/Voyages`.
- ch4 Fiori: the tile → the list report → change the status with the value
  help → the object page with voyages.

Every step must be checked against a running system. Remove the matching
drafts from `docs/next-chapters.md`.

## Objective 3 (optional, only after 1–2): advanced chapter

A CDS cube over voyages (passengers and fuel by ship and month) with
`@OData.publish: true`, as its own service (not `ZSTG_SADL_SRV`), plus one
AMDP method (fuel per 100 km) from the supported pAMDP subset. State the
SQLite/DuckDB outcome and the HANA outcome separately. There is no second
analytical page in the first release.

## Objective 4: ch6 export inventory

Run `segw:zip --unit osg-demo` and document what travels and what does not
(the app's ICF node, seed rows, the transaction), in
`docs/take-to-system.md`. This is text only; build no new features.

## Out of scope

- The APC radar.
- An engine binding for table-source associations (later, a separate PR).
- vscode.dev S2 waves.
- Any SAP system.
