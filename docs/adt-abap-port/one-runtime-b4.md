# One runtime B4: continuation RESUME in the serving child

With `OSD_ADT_ONE_RUNTIME=1`, the host continuation's resume callback sends
`POST /osd/adt-resume` to the current primary serving child. It calls
`ZCL_OSD_ADT_HANDLER=>RESUME(kind, json)` in a fresh dialog step. A recycle
between ANSWER and RESUME is allowed; no continuation state is retained
in the former child's memory. Strings pass through unchanged, objects
are JSON encoded, and undefined becomes the empty ABAP string.

The private door shares ADT-step's switch, JSON-only guard, per-spawn key
and timing-safe comparison. It checks loopback and accepts at most 1 MB.
The public parent excludes both private doors from its declared-node proxy.
This main has no internal-node flag, so RESUME is declared like ADT-step.
Invalid envelopes return 400; missing/wrong keys 403; non-JSON 415; the
switched-off door 404; oversized bodies 413.

Each call establishes a new parent STORE/SYSTEM context, carried over IPC
and discarded after the reply. SYSTEM's JSON argument passes through.
The envelope carries kind, JSON, original session ID, request headers,
identity, SYSTEM identity/error and context. Only an original ANSWER
session is checked and re-resolved inside the FIFO, including its ENQ pin.
An ended session cannot be replaced; the host keeps F3's 403 and log line.
RESUME remains terminal and uses F3's ABAP exception rollback behavior.
The host replays the response bytes and owner headers, strips X-OSD-Miss,
and retains ANSWER's cookies/token. Switch-off uses the inline path.

`test/osd-adt-one-runtime.mjs` uses the existing test-only F3 owner. Its
classrun entry installs the fixture route in each fresh process; this is
route registration, not continuation state. The recycle case records a
changed PID, resumes a JSON payload, and checks its exact response bytes
and write into the requesting facade's store. Ended-session and terminal
cases assert F3's refusal bytes and the ended-session log. All three were
run red with the previous ADT_RESUME_REMOTE refusal restored. A public
parent-door test also failed before adding the private proxy exclusion.

No public route moves, new STORE commands, Go logic, or HOST_ALLOWED
entries belong to B4. B3's sessions door is not required.

Validation on Node 26: one-runtime **30 tests x five consecutive runs**;
the requested F3, preview, child, routes, STORE, coverage, differential and
XML checks cover **168 cases** (the initial batch had 167 passes and the
public-door failure; the corrected child suite reran with 17 passes).
The fixture's four ABAP Unit methods pass. ABAP lint exits successfully
with 72 existing warnings and none in the changed class.
