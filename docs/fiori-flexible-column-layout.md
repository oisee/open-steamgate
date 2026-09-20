# Flexible Column Layout template

Travels demonstrates the native Fiori Elements OData V2 layout:
list report → travel object page → booking object page. On wide screens these
are up to three simultaneous columns; narrow screens show fewer columns.

To opt another List Report/Object Page application in, deep-merge
`templates/fiori-elements/flexible-column-layout.json` into its manifest.
Do not replace its existing dependencies, settings or pages. Keep the existing
page hierarchy and navigation properties; the fragment changes layout, not the
OData model. For three levels use a ListReport with an ObjectPage child and a
nested ObjectPage with its association's navigationProperty and target entitySet.
`webapp/manifest.json` is the complete working example.

Two-column mode emphasizes the object, three-column mode emphasizes the child.
Native Fiori Elements actions control fullscreen and column closing. Removing
the flexibleColumnLayout settings restores the ordinary fullscreen navigation.
Other applications are unchanged. This fragment targets Fiori Elements V2,
not freestyle routing, Overview Page or the different V4 manifest contract.

Browser coverage includes desktop three-column navigation, fullscreen/restore,
closing the nested page, and phone-sized navigation. Responsive tables may show
only object keys on phones; tests select visible keys rather than hidden labels.
Existing Travels CRUD tests run in main CI too; actions are scoped to their
column because multiple Create buttons can now be visible simultaneously.

Local browser tests default to a fresh in-memory SQLite database, not the
persistent developer database. Explicit STG_DB selects a backend for targeted
tests; supply a disposable STG_DB_PATH if persistence is needed. CRUD tests alter
their data. The desktop demo is at `/app/index.html` or launchpad Travels.

Reference: [SAP Fiori Elements FCL configuration](https://github.com/SAP-docs/sapui5/blob/main/docs/06_SAP_Fiori_Elements/enabling-the-flexible-column-layout-75631b7.md).

## Integration verification, 2026-09-20

Combined with database-identity commit `e614345` and the local ICF/APC/Zork
changes: build and lint pass (563 ABAP files, zero issues); ABAP Unit passes;
full integration 1245 passing / 3 HANA-dependent pending, exit 0. Browser
FCL + Travels CRUD + launchpad + System Status + Zork: 23/23 twice consecutively
using isolated in-memory SQLite. Read-only FCL review found no blocker.

Status test fixtures now explicitly pass `client: null` to represent no observed
connection; omitting client still uses the current process's connected database.
This prevents config-only tests from inheriting another suite's global ABAP DB.
No fresh Pages verification or persistent-volume schema upgrade is claimed.
Changes beyond `e614345` remain local/uncommitted; nothing deployed here.
