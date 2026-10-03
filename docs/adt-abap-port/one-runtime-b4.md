# One runtime B4: continuation RESUME in the serving child

With `OSD_ADT_ONE_RUNTIME=1`, the host continuation's resume callback sends
`POST /osd/adt-resume` to the current primary serving child. It calls
`ZCL_OSD_ADT_HANDLER=>RESUME(kind, json)` in a fresh dialog step. A recycle
between ANSWER and RESUME is allowed; no continuation state is retained
in the former child's memory. Strings pass through unchanged, objects
are JSON encoded, and undefined becomes the empty ABAP string.

The private door shares ADT-step's switch, JSON-only guard, per-spawn key
and timing-safe comparison. It checks loopback and accepts at most 16 MB.
The public parent excludes both private doors from its declared-node proxy.
RESUME is declared internal like ADT-step.
Invalid envelopes return 400; missing/wrong keys 403; non-JSON 415; the
switched-off door 404; oversized bodies 413.

Each call establishes a new parent STORE/SYSTEM context, carried over IPC
and discarded after the reply. SYSTEM's JSON argument passes through.
The envelope carries kind, JSON, original session ID, request headers,
identity, SYSTEM identity/error and context. Forwarded headers are limited to
cookie, authorization, x-csrf-token and x-sap-adt-* for session re-entry.
Only an original ANSWER session is checked and re-resolved inside the FIFO,
including its ENQ pin.
An ended session cannot be replaced; the host keeps F3's 403 and log line.
Calling `resume()` inside `whileHeld`'s work is now refused in the parent,
before any child request, with code `ADT_RESUME_IN_WHILE_HELD` and the
standard ADT 500 exception document. Previously RESUME queued behind the
held FIFO until the 120 s callback timer rejected `whileHeld`: the client
received 500, then the queued RESUME ran and could commit an ABAP write;
replaying onto the finished response could throw a late error. Finish the
work and release the FIFO before calling `resume()`. Inline mode already
refuses a nested dialog step; an inline host without a step function now
keeps the named refusal `ADT_RESUME_NO_STEP`. A lost session after recycle is
logged as an unavailable original ANSWER session, as is an ended session.
RESUME remains terminal and uses F3's ABAP exception rollback behavior.
The host replays the response bytes and owner headers, strips X-OSD-Miss,
and retains ANSWER's cookies/token. Switch-off uses the inline path and
now intentionally strips X-OSD-Miss like ANSWER; both entry points record
object/resource misses.

Exactly-once execution is not guaranteed across a recycle. RESUME is retried
only on `ECONNREFUSED`, when nothing executed. A reset socket gives the client
500 with `fetch failed`, never a silent 200, and is not retried. The uncertain
window is a RESUME step lasting longer than roughly 12 s across a recycle:
it can commit, then the child can exit before replying, leaving the client
with 500 after a committed ABAP write. The host part's store write stays
regardless; child rollback cannot undo that filesystem change.

A hot-swap or publish between ANSWER and RESUME runs the new class: RESUME
creates the handler by kind at call time, rather than retaining ANSWER's
handler instance or generation. Payload compatibility across those generations
is the route author's contract. `use_routes` registrations are lost on
recycle and must be installed again in the new child.

`test/osd-adt-one-runtime.mjs` uses the existing test-only F3 owner. Its
classrun entry installs the fixture route with B4's own `b4-write` kind
in each fresh process, so F3's host registration can coexist in one suite.
This is route registration, not continuation state. The recycle case takes
a LOCK, records a changed PID, resumes a JSON payload, and checks its exact
response bytes, write into the requesting facade's store and original ENQ
holder/handle. Other cases cover a ZCX refusal after a database write
(rolled back), SYSTEM JSON pass-through, a 2 MB continuation, and failed
deferred activation. ANSWER and RESUME wait for publication and both
render the activation-failure document if publication or promotion fails.
Ended-session and terminal cases assert F3's refusal bytes and the
ended-session log. The original recycle, ended-session and terminal cases
were run red with the previous ADT_RESUME_REMOTE refusal restored. A public
parent-door test also failed before adding the private proxy exclusion.

No public route moves, new STORE commands, Go logic, or HOST_ALLOWED
entries belong to B4. B3's sessions door is not required.

Round-2 validation on Node 26: the following files ran together **five
consecutive times, 114 passing per run (570 passes), zero failures**:

```sh
OSD_HEAVY_RANGE=80-89 tools/osd-heavy.sh npx mocha --exit test/osd-adt-one-runtime.mjs test/adt-abap-f3.mjs test/osd-child.mjs test/osd-routes.mjs test/store-destination.mjs
```

The fixture's four ABAP Unit methods pass. ABAP lint exits successfully
with 72 existing warnings and none in the changed class.

Tie-breaker follow-up validation on Node 26: the same five suites ran **three
consecutive times, 116 passing per run (348 passes), zero failures**. The two
new regressions were red before the fix: nested RESUME failed the 1.5 s
fail-fast deadline, and the missing inline step had no named code. The nested
case now checks the exact ADT 500 document, zero child RESUME requests, no
write after a FIFO barrier, and no late error. `npm run web:preview` passed
once; the generated service worker contains neither the added remote-session
module nor its marker/refusal code. The final host process-table check found
no serving children left by this clone.
