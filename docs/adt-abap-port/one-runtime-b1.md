# One runtime B1: remote ADT step

Opt in with `OSD_ADT_ONE_RUNTIME=1`. The child-mode parent does not load
an ADT kernel with this switch. The default remains the existing kernel.

`POST /osd/adt-step` is an internal JSON door secured by a random
per-spawn `X-OSD-ADT-Step-Key` header and a loopback socket check. It requires
`application/json` and is never mounted on the parent public port. Input is
`{view: {method, path, url, headers, query?}, bodyHex?}`. The hex body must
contain complete bytes. Output is `{record, adt}`: the record's body is a
UTF-8 string, headers are ordered name/value pairs (including both cookies),
and the session snapshot carries locks as entry pairs. The child resolves
AbapSessions and calls ANSWER in one dialog step. The parent replays the
record and runs HOST continuations after that step. A pool uses its primary.
The door is 404 with the switch off and rejects malformed input with 400.

The resource bridge and protocol details are in
[B2](one-runtime-b2.md); the remote front needs both slices for STORE routes.

B1/B2 initially let the same door accept a view with `sessionCall` and
JSON `args` for the remaining Node session operations. They run in the
child's FIFO; this compatibility is necessary when the parent kernel is
absent. [B3](one-runtime-b3.md) now puts this compatibility interface behind
`/osd/adt-sessions`; the request door no longer accepts session-only views. No session or lock authority lives in the parent.
