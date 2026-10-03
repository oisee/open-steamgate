# A10: SEGW entity sets

`GET /sap/bc/adt/core/http/segw/entitysets` is served by
`ZCL_OSD_ADT_ENTITYSETS`. HEAD inherits the GET row. This removes exactly
one key and its A10 comment from PORT_PENDING; HOST_ALLOWED is unchanged.

The Node route was first wrapped in `answer()`. A registration throw now
returns the ADT ExceptionInternalError document in org.open-steamgate.osd,
instead of Express's HTML error page. The wrapper test compares its status,
Content-Type, Content-Length, ETag and body with the exact ADT document.
Reverting the wrapper failed that byte assertion; the wrapper was restored
before the port was built.

`SYSTEM SEGW_REGISTRATIONS` is the only new kind; no new STORE command is
added. The shared `segwRegistrationsOf(store)` export in
`tools/osd-store-destination.mjs` supplies both the Node route and its SYSTEM
binding. It walks fresh registrations in host order, unfiltered, with no
copied route logic. The kind is parent-owned for serving-child IPC, and is
available with the runtime switch off as well. Its filesystem imports are
lazy and webpack-ignored. ABAP calls `require( 'SYSTEM' )`; Go/osgo parity
is outside this slice and no Go binding is invented.

ABAP selects the first matching registration, reads the DPC/MPC and their
optional bases using READ, and treats a READ refusal as absent source.
Methods are scanned per line with trailing CR removed. CONSTANTS and
create_entity_set expressions run over the whole text. Duplicate constant
names retain their insertion position with the last value; create calls
can overwrite the set's case. Exact matches and unique 16-character
prefixes resolve; ambiguous prefixes are omitted. All get_entityset rows
precede get_entity rows and duplicate method/kind pairs are removed.
JSON uses ZCL_OSD_ADT_JSON and registration arrays use ORDERED_MEMBERS.

`test/adt-abap-a10.mjs` mounts live Node and ABAP fronts over one store and
asserts ABAP provenance and response byte equality. It covers the demo
DPC_EXT, an STG-generated MPC, multiline constants, duplicate constants,
create-call precedence, both prefix outcomes, CRLF, base/EXT inheritance,
empty sources, missing sources, swallowed read errors, 400, 404, wrapped
500, repeated query values, case/trailing slash, GET and HEAD. A separate
serving-child case checks parent registration facts and READ over IPC,
including 200/400/404 and a trailing question mark. The test is registered
in test/suites.d/adt.json. The existing one-runtime SYSTEM gate now checks
that source registrations are accepted in both modes while other resource
kinds retain their switch requirement.

Validation and red-proof evidence are recorded below after the full runs.

## Files changed

- src/adt/zcl_osd_adt_entitysets.clas.abap and .clas.xml: new route and scanner.
- src/adt/zcl_osd_adt_router.clas.abap: contiguous A10 block before catch-all.
- tools/adt-facade.mjs: answer wrapper and shared registration binding.
- tools/osd-store-destination.mjs: shared facts export and SYSTEM kind.
- tools/osd-system-kinds.mjs: parent ownership for registration discovery.
- test/adt-abap-a10.mjs: wrapper, inline byte diffs and serving-child IPC test.
- test/adt-abap-coverage.mjs: only A10's comment and one pending key removed.
- test/suites.d/adt.json: new suite registered beside the other ABAP ports.
- test/osd-adt-one-runtime.mjs: gate accepts source registrations in both modes.
- docs/adt-abap-port/slice-a10.md: implementation and validation record.

## Validation

Node 22.23.3. Setup used prep.sh, then npm run transpile, and every heavy
command used OSD_HEAVY_RANGE=90-99 tools/osd-heavy.sh.

All 39 files in test/suites.d/adt.json ran in manifest order in a single
mocha invocation for each mode:

| Mode | Passed | Failed |
| --- | ---: | ---: |
| OSD_ADT_ONE_RUNTIME=1 | 1812 | 0 |
| OSD_ADT_ONE_RUNTIME unset | 1812 | 0 |

The focused A10 suite has 17 tests. A10 plus test/xml-wellformed.mjs passed
23 tests. The new untracked class XML was also checked directly with
XMLValidator. npm run lint passed (75 existing warnings, none on the new
route or router; no new method_length or complexity warning). git diff
--check and the new ABAP source's 7-bit ASCII check passed. There were no
fragment failures to rerun on origin/main.

The suite names are "A10 Node answer wrapper", "A10 SEGW entitysets live
Node byte diff", and "A10 serving-child registration facts". The exact
case names and parameters are in test/adt-abap-a10.mjs.

Go/osgo source discovery remains out of scope: it has no new binding, and
the route requires SYSTEM before using the host seam. No live-system call,
commit, or publish was made. Changes remain in the working tree.

## Red proofs

All mutants were temporary and restored. Neither ABAP output nor router
production code is left mutated. Evidence logs are in the gitignored
.local/codex/a10-evidence/ directory.

- Reverted the Node answer wrapper before porting: the registration-throw
  test returned Express HTML and failed the exact document assertion at
  test/adt-abap-a10.mjs:24 in that first test version (the assertion is now
  line 33 after imports were added). See wrapper-red.log.
- OSD_ADT_RED=host temporarily changed only the A10 route's served_by to
  HOST. The demo bytes still matched, but provenance failed at
  test/adt-abap-a10.mjs:100: HOST versus ABAP. See host-red.log.
- OSD_ADT_RED=byte temporarily appended one space to the ABAP sets JSON.
  The demo body comparison failed at test/adt-abap-a10.mjs:98, proving the
  diff checks bytes rather than only parsed JSON. See byte-red.log.

The production preview webpack build also passed with no errors or
warnings. It used webpack's Node API with webpack.config.cjs because this
checkout does not install webpack-cli. The new source-discovery imports
are webpack-ignored and do not add their Node filesystem dependencies to
the preview graph. See preview-webpack.log in the evidence directory.
