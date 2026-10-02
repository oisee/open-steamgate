# Slice 3: CSRF in ABAP, and the front moving up

ADR 0007 puts the session, the CSRF token and the router in ABAP. Slice 3 splits that between two owners:
the session itself (`ZIF_OSD_ADT_SESSION`, #458, and its implementation on `feat/adt-session-impl`) is stoker's;
the CSRF gate and the move of the front are dell's. This note covers dell's half. Part A is built. Part B was
decided for option B and is built on `feat/adt-front-up`, over the session implementation (#464) and its adapter
(#465).

## Part A: the CSRF gate (built)

`ZCL_OSD_ADT_CSRF` states the rules of the Node session middleware (`tools/adt-session.mjs`, port-map section 2,
step 6) once, with no server:

- every answer under `/sap/bc/adt` carries `x-csrf-token` = the session's token, never the word `fetch`;
- `x-csrf-token: fetch` (any case) asks for the token, and that same header answers it;
- POST, PUT, DELETE, PATCH and MERGE whose header is not the session's token are refused: 403,
  `text/plain; charset=utf-8`, `CSRF token validation failed`, `x-csrf-token: Required`. These are the bytes of
  `refuseToken`. Express adds the same ETag on both sides because the body is the same.
- `fetch` is not a token, so a write that sends `fetch` is refused, as it is in Node. The brief said "fetch on any
  method returns the token". That holds for a safe method; on a write the refusal wins in both implementations;
- the token comparison is exact (Node `!==`). An empty or missing header, or `fetch`, is refused without asking the
  session. Any other value is checked by `TOKEN_VALID( id, token )`;
- a session whose token is empty or `fetch` is a broken session. It answers a 500 exception document, not a token
  a client would misread;
- the Set-Cookie lines go first and the token header last. A refusal keeps the cookies, because Node sets them
  before its gate.

`ZCL_OSD_ADT_HANDLER=>ANSWER` takes an optional `io_session`, and `HANDLE_REQUEST` passes the one set by
`USE_SESSION`. With no session (the default, which is the mixed phase of slices 1 and 2), the handler adds nothing:
the Node middleware has already gated the request before the front. The handler resolves the session first, then
runs the gate, then the router, then stamps the session onto the answer. That way a HOST row's marker answer
carries the token too.

Evidence:

- **ABAP Unit:** 19 cases in `zcl_osd_adt_handler.clas.testclasses.abap` (`ltcl_csrf`) against a local session
  double. They cover the token on GET and HEAD, fetch, every unsafe method with no token or a wrong one, a wrong
  case, the admitted write, the safe methods, cookie order, cookies kept on a refusal, a route's own token header
  replaced, no session meaning no gate, a session that raises, a `fetch` or empty token, and Cookie header parsing.
- **Diff against Node:** `test/adt-abap-csrf.mjs`. It runs the handler alone behind `cl_express_icf_shim` under
  `dialogStep`, with `ZCL_OSD_ADT_SESSION_MEM` (in `test/unit`, an in-memory double with Node's lookup rules) as the
  session. It compares against the Node façade:
  - status, type, length, ETag, token and body of GET and HEAD with and without fetch;
  - 76 refusals: five methods, three paths, five header shapes, plus another session's token;
  - the attacks a critic named, on both sides: an empty token, OPTIONS, a mixed-case method (refused by the HTTP
    parser on both; the handler's own upper-casing is the unit case `a_mixed_case_method`), a method override
    either way, a HEAD with a body, an ended session's cookie and token, and a cookie-free request carrying another
    session's token. No refusal shows either session's token in a header or the body;
  - a token that stays the same within one session and changes for a new one;
  - a write with the right token passing the gate.

  The token is compared by its shape, not its value, because it is random on both sides.
  The double is test-only ABAP and stays out of every system seed: `TEST_ONLY_ABAP` in `scripts/build-vsix.mjs`,
  through `copySeedTree`, which the VSIX and the binary seed both stage with (`test/vscode-vsix-packaging.mjs`).
- **Red:** with the gate opened (`ADMITS` always true), the unit run and the diff test both fail. With the token
  stamp removed, all five diff cases fail.
- **Green:** `adt-abap-csrf`, `adt-abap-diff`, `adt-session` and `adt-facade` give 158 passing. ABAP-FS conformance
  (`--start`) gives 29 PASS, 2 FAIL, 16 MISSING, the figure `docs/abapfs-conformance.md` records for main, with no
  regressions.

**Measured, port-map risk 5:** a second Set-Cookie line does not survive the shim. Two things cause this:
`cl_http_entity=>set_header_field` replaces a header of the same name, and `set_cookie` is an `ASSERT 1 = 'todo'`
stub in open-abap-core. The answer record (`ty_response-headers`) keeps both lines. The diff test pins the one line
that survives, so this case flips when the gap is fixed.

## Part B: the front moves up (built, option B)

### Before

`tools/adt-abap-front.mjs` sat behind the Node session middleware. It matched the ABAP route table in JavaScript.
A HOST row went to `next()` with no step and no ABAP. An ABAP row ran the handler through the shim in a step, bound
the ENQ session first (`enter`) and replayed the recorded answer. The session and the CSRF gate were Node's.

### Now

Every request under `/sap/bc/adt` enters `ZCL_OSD_ADT_HANDLER` first, in one dialog step:

1. The front reads the body (the handler takes it as bytes), and hands it on as `req.body` for a Node route.
2. In the step, `AbapSessions#sessionFor(req)` makes the request's `ZCL_OSD_ADT_SESSION`. The front calls
   `ZCL_OSD_ADT_HANDLER=>ANSWER` with the request record and that session (`answerOf`), not through the shim.
3. `ANSWER` resolves the session, runs the gate (Part A) and routes. The `RESOLVE` it calls also sets `req.adt`
   (`{session, sessions, fetching}`), so the host's SYSTEM answers (`LOCK_HANDLE`, `SESSION`, `LOCK_HOLDER`)
   and the Node routes see the same session.
4. A session that ended while its request waited (`ZCX_OSD_ADT=>SESSION_ENDED`, an ended ENQ key) is answered
   in `ANSWER` as the CSRF refusal (403, `Required`), with no cookies. The step ends without an exception, so the
   deletion of the session's rows commits.
5. The verdict:
   - **ABAP**: the record is replayed onto the response.
   - **HOST**: the record's two `Set-Cookie` lines and its `x-csrf-token` go onto the response. Then the
     continuation runs after the step, with no work-process lock held. The default continuation is `next()`,
     which runs the Node route.

The Node `Sessions`, its middleware, the JS matcher (`matchRoute`, `routeRows`) and the front's `enter` and
`ended` options are gone from every host that mounts the front. The ENQ binding of a stateful session is
`RESOLVE`'s. `adtRouter` makes the `AbapSessions` itself when `abap` is given, with the façade's system id and
client, and refuses a Node `Sessions` next to the front. `ZCL_OSD_ADT_HANDLER=>USE_SESSION` stays the ICF path's
(a system); on Node the session is passed per request, because the adapter wraps it per request.

Per host:

- `test/start.mjs` inline (and so `npm start`, `test/run.mjs`, `osd up` in the binary): the front with
  `AbapSessions`.
- `test/start.mjs` in child mode, and `OSD_ADT=js`: no ABAP in that process, so Node's `Sessions` and its
  middleware, as before.
- `tools/osd-serve.mjs` (the child, and `osd serve`): mounts no ADT façade.
- `web/preview-backend.mjs`: mounts no ADT façade (no ADT client reaches a service worker).

The one-owner guard (`claimAdtSessions`) does not fire in any host or suite: a façade with the front claims
`abap`, and the Node-only façades use `Sessions` without the ENQ owner table, which claims nothing.

What changed in behaviour, on purpose:

- **Fail closed.** A step that fails (a dump, a nested step) answers the ADT exception document, 500, for every
  request, a HOST row included. Before, HOST rows never touched ABAP and kept answering.
- **The logoff waits for the work process.** The logoff and the session DELETE end the session through
  `AbapSessions`, in a step of their own. A LOCK queued before the logoff now runs first and is granted, and the
  logoff then releases it. Before, the logoff passed the queued LOCK and the LOCK found its session gone.
- **An ended ENQ session is an ended ADT session.** When the lock server ends a session's ENQ key, the next
  request cannot bind it. It deletes the session and answers the CSRF refusal. Before, a write with an old handle
  answered 409.
- **A delegated request queues** behind a long step, because it takes the work process for its session.

### The continuation

A route may end in a HOST verdict of its own: `ZIF_OSD_ADT_ROUTE=>TY_RESPONSE` has one more field,
`continuation` (`kind`, `payload` as JSON text). When a route sets a kind, the handler answers `EV_SERVED_BY =
HOST` and keeps the route's response. On a system, where no host stands behind the handler, that response is the
answer. On Node:

```js
import {registerContinuation, continuationKinds} from "./tools/adt-abap-front.mjs";
const unregister = registerContinuation("publish", async ({req, res, next, kind, payload, session, answer, replay}) => {
  // after the step: no work-process lock held; a dialogStep of its own is allowed
});
```

- A kind is registered once per process, at host startup, and registering it twice throws.
- The handler runs after the step. `payload` is the parsed JSON, `session` is `req.adt.session` (resolved in
  ABAP), and `answer` is the handler's record (`status`, `contentType`, `headers`, `body`, `servedBy`,
  `continuation`). The session's cookies and token are already on `res`.
- The handler can replace the ABAP answer by sending its own, extend it by doing its work and then calling
  `replay()`, or delegate with `next()`.
- The kind `""` (no continuation) is `next()`. The kind `echo` is built in for tests: it answers JSON with the
  kind, the payload, the session and ABAP's answer.
- An unregistered kind, or a payload that is not JSON, answers 500 `ExceptionInternalError`.

The test route is `ZCL_OSD_ADT_ROUTE_ECHO` in `test/unit`. It is test-only ABAP (`TEST_ONLY_ABAP`), and a test puts
it in front of the table with `ZCL_OSD_ADT_HANDLER=>USE_ROUTES`.

### Evidence

- `test/adt-abap-front.mjs` (7 cases):
  - every ADT request enters the handler once, counted at `answer`, whoever serves it;
  - a fresh fetch gets both `Set-Cookie` lines, and its id and token are a row of `ZOSD_ADT_SESS`;
  - a HOST route (`core/http/sessions`) names the session ABAP resolved;
  - a write with another session's token is refused by ABAP, with and without a cookie;
  - logoff, then a dump, then an ended ENQ session: each next request gets a fresh session, and the refusal's
    deletion commits;
  - the `echo` continuation answers after the step with the ABAP session;
  - a registered kind runs with no work-process lock held, may take a step of its own and extends the answer
    with `replay()`; an unknown kind is a 500.
- ABAP Unit `an_ended_session` in `ltcl_csrf`: `SESSION_ENDED` is the CSRF refusal, with no cookies, on a read and
  on a write.
- **Red on main** (`d0768a9f`, the same claims through main's mount): no step for a HOST row, the session is not a
  row of `ZOSD_ADT_SESS`, a foreign-token write is not refused by ABAP, and `an_ended_session` fails (an
  exception document instead of the refusal).
- **Green:** the `adt` suite group (`test/suites.d/adt.json`) together with `osd-enq` and `osd-enq-abap` gives
  524 passing and 4 pending, the 7 new cases included. The adapter's parity suite, `adt-abap-diff` (rewritten for option B), `adt-abap-csrf`,
  `adt-abap-session`, `adt-devloop`, `adt-activation` and `tmp-package` are all part of that run.
- **ABAP-FS conformance** (`--start`, own port): 30 PASS, 1 FAIL, 16 MISSING, no regressions.

### Measured overhead, with the real session

One process per run, 120 requests per cell, the median of the last 100, two rounds per run. The same script ran on
main (`d0768a9f`, mixed front, Node sessions) and on the branch (option B, `AbapSessions`), alternating, four runs
each. The LOCK is a relock of the session's own lock.

| request | main | option B | added |
|---|---|---|---|
| `core/discovery` (HOST) | 0.47-0.52 ms | 1.83-2.68 ms | +1.3 to +2.2 ms |
| source GET (HOST) | 0.39-0.46 ms | 1.52-2.41 ms | +1.1 to +2.0 ms |
| LOCK (ABAP) | 1.57-1.90 ms | 2.37-2.56 ms | +0.6 to +0.9 ms |

The figures are round 2 of each run. This is more than the 0.45 to 0.6 ms the earlier shim-only measurement
(below) predicted. The real session adds a sweep, a read and a touch per request, then the adapter's `peek` and
`handles` for `req.adt`, and the commit. The LOCK already paid for a step and a bind on main, so its share is
smaller.

### The fork: how a HOST row reaches Node

**A. A host call from inside the step.** The handler calls a kernel seam such as
`KERNEL_ADT_HOST=>FORWARD( method path headers body session )`. The seam would be an `abap.Classes` slot like
`KERNEL_LOCK`, and it returns status, headers and body for the handler to write. To keep the
work-process rules, the seam has to:

1. commit the step's LUW, which also persists the session row it touched;
2. roll out: snapshot the shim's static server (`tools/osd-dialog-step.mjs`, #438) and release the FIFO lock, as
   `WAIT` does;
3. run the Node route outside the step's async context (`outsideStepContext`). Without that, any route that takes a
   step of its own (`exclusive`, `lockedClient`, the data preview, unit runs) throws "a nested dialog step". A long
   route such as activation or a unit run would also hold every OData request behind it;
4. re-enter the express router with a synthetic `req`/`res`, record the answer, take the lock back and roll in.

Costs:

- a new kernel seam, reached from ABAP through `@KERNEL` lines;
- a synthetic express request for 142 route registrations, including body parsers, `req.params` and HEAD/ETag/304
  handling;
- the unit-run cancellation seam (`X-OSD-Request-Id`, socket `close`) loses its socket;
- one more place where a forgotten roll-in answers a caller with another caller's response.

**B. A verdict, then delegate after the step.** The handler's step ends with the HOST verdict it already gives (the
`X-OSD-Served-By: HOST` marker) plus the resolved session: id, user, stateful, token and the Set-Cookie lines. The
front copies the cookies and the token onto the real response, sets `req.adt` from the verdict, and calls `next()`.
The Node route runs after the step, outside the lock, exactly as a HOST row runs today.

Costs and benefits:

- no new seam, no roll-out and no synthetic express request;
- each delegated request costs one step;
- risk 5 is sidestepped on Node **only if the front takes the cookies from `ANSWER`'s own record**
  (`es_response-headers`), which keeps both Set-Cookie lines. The shim's recorder does not: `HANDLE_REQUEST` writes
  the record through `set_header_field`, which replaces the first `set-cookie` with the second before the shim
  reads anything, and no recording downstream of the shim can bring the lost line back (measured: a fresh GET with
  `fetch` through the shim arrives with one cookie, `test/adt-abap-csrf.mjs`). So under B the front calls
  `ZCL_OSD_ADT_HANDLER=>ANSWER` with the request record, in the step, and replays that record; the shim stays the
  path of a real ICF only. On a system, ICF owns the cookies (the interface says so) and there is no host behind
  the handler, so a HOST row is the 404 it already is.

B is the smaller mechanism. A is closer to the brief's wording, "delegate through a host call".

**Decision (dell and stoker, 2026-10-02): B.** stoker builds the Node session adapter over `ZCL_OSD_ADT_SESSION`
(item 1 below). The order is: the session implementation (`feat/adt-session-impl`), then the adapter, then B is
switched on (`USE_SESSION` bound, the front moved up, the Node middleware and the JS matcher removed).

### Needed whichever way the fork goes

Where each item stands with B built:

1. Done: the Node routes read the session through `AbapSessions` (#465).
2. Logoff stays Node's and calls `END` through the adapter.
3. `X-OSD-Generation` and the capture stay in the Node front, mounted before it.
4. Done: the ENQ binding is `RESOLVE`'s, and an ended session is the handler's CSRF refusal.
5. Sidestepped on Node by reading `ANSWER`'s record. Still open for the shim path.

The original notes follow.

1. **The Node routes' view of the session.** In `tools/adt-facade.mjs`, 11 places read `req.adt.session` (`.id`,
   `.locks`, `.stateful`, `.user`) or call `Sessions` methods: `holds`, `holderOf`, `lock`, `unlock`, `release`,
   `end` (logoff and `DELETE core/http/sessions/:id`). `abapSession` in `tools/adt-enq.mjs` clears `.locks` from
   `onEnqContextEnded`. Once the session and its handles are in `ZOSD_ADT_SESS` / `ZOSD_ADT_SHDL`, the façade needs
   one of two things:
   - an adapter: a `Sessions` whose `get`, `holds`, `end` and the rest are ABAP calls in a step, run before or after
     the route and never inside it;
   - or those routes have moved to ABAP. The write path is group A, stoker's.

   This decides the order more than the fork does. The front can move up only when the routes still on Node read
   the session through the adapter. Otherwise there are two session stores again.
2. **Logoff.** `/sap/public/bc/icf/logoff` sits outside BASE: no gate, no token, no cookies. It needs either the
   second ICF node with the same handler (port-map step 1) or it stays Node's and calls `END` through the adapter.
3. **`X-OSD-Generation` and the `STG_ADT_DUMP` capture** stay in the Node front. The capture has to wrap the ABAP
   entry too, which means mounting it before the moved front.
4. **The ENQ binding** (`enter`) moves into `RESOLVE` (stoker's `KERNEL_ENQ_SESSION`), so the front's `enter` and
   `ended` options go. A session that ended while its step waited then has to come back as the CSRF refusal, out of
   the handler.

   **A session that ends during a WAIT** is not covered by the step boundary. A WAIT (an ABAP route polling a job,
   or `_WAIT` on an ENQUEUE) commits, rolls out and gives the work process up; a logoff or a session DELETE can run
   in that gap and end the session. When the step rolls back in, nothing re-resolves it, so:
   - the step's answer is still stamped with the old token and cookies. That is harmless: the next request names a
     session that is gone, opens a fresh one, and its write is refused with `Required`, which makes a client log on
     again;
   - an ENQUEUE after the WAIT runs under an ENQ key that is ended and stays ended (#433), so `KERNEL_ENQ_SESSION`
     throws `EnqSessionEnded`, no lock is taken, and the request is answered as one from a session that is gone
     (the CSRF refusal), as slice 2 answers a LOCK queued behind its own logoff;
   - a handle the step wrote after the WAIT belongs to a session row that is deleted. The implementation must not
     resurrect the row on that write (stoker's `ADOPT_HANDLE` on an unknown id: nothing, or an error);
   - under B a delegated Node route runs after the step, so the session can also end between the verdict and the
     route. The adapter therefore re-checks at use (`holds`, `get` read the tables) rather than trusting the
     verdict's copy.
5. **Risk 5.** For the shim path on any host (a real ICF, or option A), two Set-Cookie lines need open-abap-core's
   `if_http_entity~set_cookie`. It should append a `set-cookie` row rather than assert. That is a fork PR like
   #1218, with an ANORMALIES entry first.

### Measured overhead (before the session existed)

One process, 120 requests per cell, the median of the last 100, the same script for every cell, two rounds. The
route is delegated to Node, and "ABAP first" runs the handler in a step through the shim before `next()`:

| request (round 2) | Node only | mixed (today) | ABAP first, no session | ABAP first, session double |
|---|---|---|---|---|
| `discovery` | 0.39 ms | 0.43 ms | 0.87 ms | 1.03 ms |
| `debugger/listeners` | 0.19 ms | 0.21 ms | 0.64 ms | 0.69 ms |

Round 1 shows the same order: from 0.31–0.62 ms to 0.80–1.53 ms. Entering ABAP costs about 0.45 to 0.6 ms per
delegated request, measured as option B. The in-memory session adds up to 0.15 ms. Not measured:

- the real session, whose `RESOLVE` writes a row per request (the touch), and the commit at the end of the step;
- option A's commit, roll-out and roll-in, which come on top of B's step.

A delegated request also waits for the work process once the front moves up, so it queues behind a long OData step,
which it does not do today.
