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

`test/osgo-storecmp.mjs` runs the harness over
`tools/gogen/testdata-store/tree` and requires exit 0 plus equal, nonzero read
and write totals. It is registered in the existing `gogen` group of
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
