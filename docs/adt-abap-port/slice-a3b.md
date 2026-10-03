# A3b: reentrance ticket

Implemented in the working tree over main `490a1cf00b34fd410d2124d63e23233b7419406f`.
No commit was made.

## Route and ownership

One key moved: `GET /sap/bc/adt/core/http/reentranceticket`, handled by
`ZCL_OSD_ADT_REENTRANCE`; HEAD uses the existing GET fallback. Its own router
block sits immediately before the HOST catch-all. Only the A3b comment and
key were removed from `PORT_PENDING`; `HOST_ALLOWED` is unchanged.

Node validates the literal authority and the strict path/query/fragment
syntax before `new URL()`. IPv4 shorthand (`127.1`) and hex IPv4
(`0x7f000001`), nonliteral IPv6, dot segments (including percent-encoded
ones), backslashes and malformed percent escapes are refused.

ABAP owns normalization, ordered query re-serialization, duplicate query
behavior, UTF-8 replacement, Accept negotiation, HTML escaping, the
`sap-usercontext` cookie and the three ordinary plain-text 400 responses.
Redirects have no ETag. Fresh cookie order is context, session, usercontext.
The existing front already supplies correct redirect replay and cookie
appending; it needed no change.

No new STORE commands or SYSTEM kinds. Existing SYSTEM IDENTITY supplies
the client. Go/osgo parity is outside this slice; the route explicitly calls
`ZCL_OSD_ADT_HOST=>REQUIRE( 'SYSTEM' )`. Kernel UUID tickets are unvalidated
handoff values, not credentials; the class comment documents that limit.

## Changed files

- `tools/adt-facade.mjs`: Node grammar tightening before URL parsing.
- `src/adt/zcl_osd_adt_reentrance.clas.abap`: route and parsing/rendering helpers.
- `src/adt/zcl_osd_adt_reentrance.clas.xml`: class metadata with WITH_UNIT_TESTS.
- `src/adt/zcl_osd_adt_reentrance.clas.testclasses.abap`: focused ABAP Unit.
- `src/adt/zcl_osd_adt_router.clas.abap`: the single route row.
- `test/adt-abap-a3b.mjs`: live Node/ABAP diff over one store.
- `test/adt-abap-coverage.mjs`: only A3b's pending block removed.
- `test/suites.d/adt.json`: new suite registered beside the ADT ABAP suites.
- `ANORMALIES.md`: long-timestamp subtraction failure and UTC arithmetic workaround.
- `docs/adt-abap-port/slice-a3b.md`: this report.

## Validation

All heavy commands used `OSD_HEAVY_RANGE=90-99 tools/osd-heavy.sh`.
Setup used the requested prep script, followed by transpilation.
Tests ran on Node **22.23.3**.

`A3b reentrance live Node byte diff` covers normalization, three loopback
literals, uppercase scheme/host, default/zero-padded ports, empty paths,
query ordering and duplicate removal, form escapes and invalid UTF-8,
fragments, Accept weights/specificity/parameters, all refusal families,
duplicate outer `_`, the default clock, and HEAD with case/trailing slash.
It compares status, Content-Type, Content-Length, ETag, Location, Vary,
cookie order and body, masks only checked random/time values, and asserts
ABAP provenance. URL comparisons remove a trailing `?` on both sides.

`A3b focused ABAP Unit` invokes `grammar`, `query`, `accept`, `escaping`,
and `clock`. The clock case is a fixed epoch-millisecond vector.

- Focused A3b plus `test/xml-wellformed.mjs`: **60 passed, 0 failed**.
  The new untracked class XML was also validated directly with XMLValidator
  and checked for WITH_UNIT_TESTS, because the suite scans tracked files.
- `npm run lint`: **passed**; 75 existing warnings, none in the new class;
  no new method_length or cyclomatic_complexity warning.
- Whole `test/suites.d/adt.json`, every file in manifest order, one mocha
  process, OSD_ADT_ONE_RUNTIME unset: **1849 passed, 0 failed**.
- The same whole fragment with OSD_ADT_ONE_RUNTIME=1:
  **1849 passed, 0 failed**.

The fragment includes preview bundling, front/cookie replay, sessions,
ABAP-FS conformance, devloop and both runtime paths. Neither full run failed,
so no failing existing file needed a rerun on origin/main. Initial focused
failures were fixed before the final runs; no required check was skipped.

## Red proof

Temporarily removed Node's entire pre-URL tightening block and ran the
`refuses nonliteral loopback http://127.1/` case against the live fronts.
Node returned **307**, ABAP returned **400**. The byte equality assertion
failed at **test/adt-abap-a3b.mjs:55** (0 passed, 1 expected failure).
The runner restored the exact original source in a finally block, then both
complete fragment runs passed with the tightening present.

## Oracle and the open Eclipse check

The port's oracle is the live Node route, as for every slice: ABAP matches it
byte for byte (dell, 2026-10-03). The route was not compared with an
STG_ADT_DUMP capture of a real Eclipse cloud-project logon; that check is open
for the Eclipse client matrix, not for this slice. No capture was invented and
no SAP system was contacted.
