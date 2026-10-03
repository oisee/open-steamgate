# One runtime B1: remote ADT step

Opt in with `OSD_ADT_ONE_RUNTIME=1`. The child-mode parent does not load
an ADT kernel with this switch. The default remains the existing kernel.

`POST /osd/adt-step` is a loopback-only, internal JSON door. Input is
`{view: {method, path, url, headers, query?}, bodyHex?}`. The hex body must
contain complete bytes. Output is `{record, adt}`: the record's body is a
UTF-8 string, headers are ordered name/value pairs (including both cookies),
and the session snapshot carries locks as entry pairs. The child resolves
AbapSessions and calls ANSWER in one dialog step. The parent replays the
record and runs HOST continuations after that step. A pool uses its primary.
The door is 404 with the switch off and rejects malformed input with 400.

The resource bridge and completed acceptance results are in
[B2](one-runtime-b2.md); the remote front needs both slices for STORE routes.

During the mixed ABAP/Node port, the same door also accepts a view with
`sessionCall` and JSON `args` for the remaining Node session operations.
They run in the child's FIFO; this compatibility is necessary when the
parent kernel is absent. B3 can replace this compatibility interface as
those routes are ported. No session or lock authority lives in the parent.
