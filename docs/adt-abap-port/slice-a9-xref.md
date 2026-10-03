# A9: xref readers and closure

`ZCL_OSD_ADT_XREF` serves GET (and implicit HEAD) for
`core/http/xref/readers` and `core/http/xref/closure`. It validates the
query, walks WBCROSSGT/WBCROSSGTX with Open SQL, classifies results and
writes the ordered JSON. Readers use code-unit sorting; closure uses
`ZCL_OSD_ADT_JS=>COLLATE`, checked against V8 over every demo-store name.
The closure walk preserves Node's stack order and its cap behavior: one
expansion can exceed the cap. `options.xrefLimit` defaults to 5000.

The existing SYSTEM command gains five kinds using IV_JSON/EV_JSON:

| Kind | Input | Answer |
| --- | --- | --- |
| XREF_WARM | `{operation: "READERS" or "CLOSURE", type, name}` | `{available, objects?, limit}` |
| OBJECT_TYPES | `{names: [...]}` (absent means all) | name-to-type object, last store entry wins |
| TESTCLASSES | none | test object names with display suffix removed |
| SERVICE_ROWS | none | `{path, handler, mpc}` rows |
| SEGW_REGISTRATIONS | optional `{registered: true}` | `{service, external, dpc, mpc, registered}` rows |

`SEGW_REGISTRATIONS` keeps raw registration order by default. The registered
projection keeps `registeredServices` winner order, including replacement
of an earlier endpoint. Node and SYSTEM share `adt-xref-facts.mjs`; the
preview destination excludes this filesystem helper from its bundle.
Go parity is deferred; the route requires SYSTEM through COMMANDS.

## Process ownership

With the switch off in the inline runtime, the step and the Node Data
connection read the same DEFAULT database. With `OSD_ADT_ONE_RUNTIME=1`,
the remote ABAP step reads the serving child's DEFAULT connection; Node
Data reads that same child through `/osd/sql`. No xref table query goes to
the parent. The test poisons parent xref SELECTs, checks both routes and
compares their bytes, using both controlled rows and the child's actual
startup-seeded demo graph. Controlled writes report and assert the child
PID. With the switch off in a reduced parent kernel, the native rows
are omitted and the existing catch-all delegates to Node over child Data.
The isolated switch-off test poisons parent xref reads and checks both
HOST answers against live Node.

The source store and its warm compiler remain parent resources. Therefore
XREF_WARM is a parent SYSTEM kind under IPC, as are the other four source
facts. It reads the bound store's already-primed compiler; it does not prime
a compiler or seed tables. This follows the introspection family spec and
Node's existing route behavior. The extra request to warm the child's
index needs clarification: that would change the spec's deliberately stale
startup table behavior. The test separately primes a real WarmCompiler
and byte-compares both warm routes in the inline and remote fronts.

`test/adt-abap-a9.mjs` covers graph overlap, cycles, self references, mixed
case, UNKNOWN types, test classification, service counts, query refusals,
HEAD, the cap seam, host fact failures and collation. Each route has a
reverted body mutant; `OSD_ADT_RED=readers` or `closure` lets that assertion
fail visibly. The suite is registered in the ADT fragment. Only A9's two
PORT_PENDING keys are removed.

## Changed files

- `src/adt/zcl_osd_adt_xref.clas.abap` and `.clas.xml`: native route handler.
- `src/adt/zcl_osd_adt_router.clas.abap`: contiguous A9 rows.
- `src/adt/zcl_osd_kernel_guard.clas.abap`: serving database guard.
- `tools/adt-xref-facts.mjs`: shared host fact exports.
- `tools/adt-facade.mjs`: shared facts and the closure cap seam.
- `tools/osd-store-destination.mjs`: SYSTEM envelope dispatch.
- `tools/osd-system-kinds.mjs`: source fact availability and parent routing.
- `test/adt-abap-a9.mjs`: the 53-case acceptance suite.
- `test/helpers/a9-child.mjs`: test-only child mutation transport.
- `test/helpers/a9-switch-off.mjs`: isolated reduced-parent proof.
- `test/adt-abap-coverage.mjs`: only the A9 block removed.
- `test/osd-adt-one-runtime.mjs`: source facts are available inline; runtime-only kinds remain gated, with every kind still asserted in both modes.
- `test/suites.d/adt.json`: A9 registered next to the other ABAP suites.
- This report.

## Validation

Measured on Node 22.23.3, with all heavy commands through the 90-99 wrapper:

| Check | Result |
| --- | --- |
| Focused A9 suite | 53 passing |
| Entire ADT fragment, switch unset | 1848 passing, 0 failing |
| Entire ADT fragment, switch 1 | 1848 passing, 0 failing |
| XML wellformed | 6 passing |
| npm run lint | pass; no new xref/guard warnings |
| Preview closure | pass; filesystem facts excluded |

Both fragment runs use all 39 files in manifest order in one Mocha process
per mode. The first runs exposed the SYSTEM gate's old assumption that
all parent kinds were runtime-only. The unchanged failing file on
origin/main (490a1cf00b34fd410d2124d63e23233b7419406f), built in an isolated
archive with the same pinned libraries and fetched packs, passed all 57
cases. The updated gate retains assertions for every kind, distinguishes
source-fact availability from process routing, and passes both full runs.

Each intentional trailing-space mutant failed the body equality assertion
at `test/adt-abap-a9.mjs:56`: readers and closure each produced one expected
failure. Each prototype mutation is restored in `finally`; the ordinary
suite also checks the restored route afterward. No mutant remains.

Go parity and the requested change to child warming are not implemented.
The latter remains the process-ownership clarification above; the existing
spec's warm-index branch and both actual serving-child table routes are
proved. All changes remain uncommitted.
