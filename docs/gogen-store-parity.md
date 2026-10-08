# OSGo store parity gate

On 2026-10-08 the store parity harness was red on `origin/main` at
`f7a98bae`, without a CI signal: `reads: 0 of 31 answers the same` and
`writes: 0 of 20 answers the same` (exit 1). Go returned additional scalar
keys that the harness's reduced Node importing signature did not request,
reported writable sources as active without a live generation, and accepted
an invalid repository name that Node refused. The retained evidence also
showed an unwanted file from that invalid write. This was a gap in the CI
gate, not evidence that the read commands had parity.

The harness now compares the scalar keys returned by Node's `execute` for
each command, including `EV_JSON`, `EV_STATE` and `EV_CHANGED`; only elapsed
time and timestamps of files written during the comparison are normalized.
It compares successful WRITE JSON and revisions, refusal codes, and the
resulting files. The read list uses HISTORY in place of ACTIVATE: Node's
ACTIVATE enters the compiler and publication journal even for a missing
object. CHECK/ACTIVATE capability refusals remain explicit Go-only checks
in the write list; compiler execution is outside this store-read parity gate.

That full-answer mode is necessary but not sufficient. An ABAP front does not
receive Node's `execute()` object: `CALL FUNCTION 'ZOSD_STORE' DESTINATION
'STORE'` reaches `StoreDestination.call()`, which fills only the importing
scalars and typed tables that caller declared. The harness therefore runs a
second mode through the RFC signature as well. Node uses typed output boxes
and table row types; Go uses the session-first `abap.ZOSD_STORE` adapter that
`cmd/osgo` installs with `abap.SetStore`, not a direct `objstore.Call`. It
compares the union of importing scalars and tables declared by the ADT call
sites: `EV_SOURCE`, `EV_FILE`, `EV_STATE`, `EV_CHANGED`, `EV_PACKAGE`,
`EV_VERSION`, `EV_NOTE`, `EV_JSON`, `EV_ERROR`, `ET_OBJECT`, and
`ET_REVISION`, field by field.

The gogen host signature carries `IV_JSON`, `EV_JSON`, `EV_STATE` and
`EV_CHANGED`, and the adapter maps `ET_REVISION-SUBJECT_FULL`, since ADT
batch 1 (#672), so the expected-gap lists are empty and those fields are
compared like every other; the harness also fails if the frontend signature
stops carrying one of the four scalars, since no read or write call here
supplies `IV_JSON`. A gap added back to the lists is reported per
command, never passed silently, and one the gogen host starts to carry fails
until it is removed again.

`test/osgo-storecmp.mjs` runs the harness over
`tools/gogen/testdata-store/tree` and requires exit 0 plus equal, nonzero read
and write totals in both modes. It is registered in the existing `gogen` group of
`test/suites.d/gogen-osgo.json`, run by the `gogen` job at
`.github/workflows/gogen.yml:130`. No workflow change is needed.

Emitter regressions cover real ZIP layers, materialized and shared-only
active snapshots, edits before and after emission, main sources and class
includes. Emission takes the retained bytes' digest, including immutable
archive and library sources. Without a live generation all source objects
are inactive; synthetic `$TMP` remains active, matching Node. Active reads
require a retained path and matching digest, rather than an emitted digest
of an unproven working file.

The VFS golden fixture includes `src/zz_order.clas.abap`: its filesystem
insertion follows programs while VFS ordering puts CLAS before PROG. Removing
the VFS object sort must therefore fail the Go golden comparison.
