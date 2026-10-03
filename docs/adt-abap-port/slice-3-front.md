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
4. An ENQ context that ended is not a session that ended. `ANSWER` never turns `SESSION_ENDED` into the CSRF
   refusal: the session binds its key again and keeps its token (#471), a read is answered, and a write with a
   dead handle is the route's 409. Only a logoff or an expiry ends a session. A step whose ENQ session ended while
   it waited (a logoff during the wait, `ENQ_SESSION_ENDED` from the lock server) is answered by the front as the
   CSRF refusal (403, `Required`), not as a dump.
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

- `test/start.mjs` inline (the suites that call `startServer()` themselves): the front with `AbapSessions`, over
  the system's own classes.
- `test/start.mjs` in child mode, the default of `test/run.mjs` and so of `npm start`, the deploys and `osd up`:
  the front with `AbapSessions` too. The parent runs no system, so it loads the **ADT kernel**
  (`tools/adt-abap-kernel.mjs`): the closure of the classes the front calls, read off the generated modules (138
  modules, against 1939 for the whole system), with a database of its own in memory holding only their tables,
  and the lock server in the parent. Measured by stoker on a running host: +55 MB RSS for the parent (675 MB against 620
  MB), and 0.2 s to load. The sessions and their locks therefore outlive every recycle of the serving child (an editor
  locks, saves, activates and saves again under one handle; `test/osd-child.mjs` kills the child and the lock is
  still held). They last as long as the parent, as Node's `Sessions` did. **After editing the front, restart the host.** The kernel is
  loaded once (`tools/adt-abap-kernel.mjs`, `loadAdtKernel`), and a change to a `ZCL_OSD_ADT_*` class or to the
  front's tables (`ZOSD_ADT_SESS`, `ZOSD_ADT_SHDL`) recycles the serving child but not the parent, which keeps
  serving the old front until it restarts. This is detected: once per generation the parent compares the hash of
  the front's closure (its modules and table statements, `closureHash`) with the one it loaded. When they differ
  it says so on the console, naming the restart, and every answer of the front carries `X-OSD-Front-Stale: 1`: discovery (`discovery`, `core/discovery`), `core/http/systeminformation` and refusals included, so a client (the VS Code extension) can show a "restart the host" hint from requests it already makes.
  Nothing is refused, because the editor that would fix the front goes through it.
- `OSD_ADT=js`, in either shape: Node's `Sessions`, its middleware and Node's routes, as before slice 3. This is
  the emergency exit when the ABAP front itself is broken. A step of the front that dumps logs the reason once per
  generation and names this switch. If the kernel cannot load, the parent says why and falls back the same way.
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
- **A session that ends behind the verdict acts on nothing.** Between the front's step and the Node route, another
  step can run (the session's own logoff, an UNLOCK, an expiry). The routes that change an object therefore ask
  again inside a step of their own, where they act: a write runs inside `sessions.whileHeld(session, handle, type,
  name, work)` (the handle check and the write in one step), and `deleteObject` first checks that the caller's
  session is still alive and answers the CSRF refusal when it is not. Before, a DELETE queued behind its own
  logoff deleted the object with no holder left to stop it.
- **A session nobody needs keeps no row.** A request that opens a session and asks nothing of it (no token
  fetch, no state, no write: a readiness probe, a plain GET) is answered as before, cookies and token included,
  but its step ends the session again. A refused write keeps no session it opened either. The session that stays
  is opened by the first request that fetches a token or asks for state, which is how every ADT client starts.
- **The body goes to ABAP only for an ABAP row**, asked of `ZCL_OSD_ADT_ROUTER=>MATCH` over the router's own
  table, so a big PUT that a Node route serves is not copied into hex. Every answer of the front names who served
  it: `X-OSD-Served-By: ABAP` or `HOST`.
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
- **What a continuation gets is a snapshot.** The step has ended and no lock is held, so another step may have run
  in between, and the session it is handed may have ended. A continuation that changes something under a
  session's lock asks again inside a step where it acts, with `sessions.whileHeld` or as `deleteObject` does. A
  continuation that throws is logged (`console.error`) and answered 500.
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
  542 passing and 4 pending, with `osd-child` in the run, on main after #471: 11 cases in `test/adt-abap-front.mjs`, including #471's acceptance test (old handle 409, GET 200, relock a new handle), which now runs, and the logoff-first order of the #432 race (a LOCK queued behind its own logoff is refused and takes no lock; red with the existence check of `RESOLVE` disabled). The adapter's parity suite, `adt-abap-diff` (rewritten for option B), `adt-abap-csrf`,
  `adt-abap-session`, `adt-devloop`, `adt-activation` and `tmp-package` are all part of that run.
- **ABAP-FS conformance** (`--start`, own port): 30 PASS, 1 FAIL, 16 MISSING, no regressions.

### Known limitation: two lock tables

B0 now rebuilds the child's ADT locks at boot from a parent-kernel snapshot;
see [B0 state across recycle](one-runtime-b0.md). The measurements below are
before B0. The front and its authoritative rows still live in the parent;
live lock/unlock synchronization awaits B1's remote step.

In child mode there are two lock servers, one per process. `locks()` keeps one table per process on
`globalThis.__osdLocks` (`tools/osd-enq.mjs:303-306`). The serving child installs its own through
`test/setup.mjs:384-398` (`installEnq`), and the parent's ADT kernel installs a second one at
`tools/adt-abap-kernel.mjs:97,106`. An ENQUEUE, DEQUEUE or ENQUEUE_READ from a program in the child therefore goes
to the child's table and does not see the ADT locks held in the parent.

Measured with a throwaway classrun class in the child that calls ENQUEUE_READ for `ZOSD_ADT_LOCK`, before and
after an ADT LOCK through the front:

| mode | before the LOCK | LOCK | after the LOCK |
|---|---|---|---|
| child (`test/run.mjs`) | 0 rows | 200, served by ABAP | 0 rows |
| inline | 0 rows | 200, served by ABAP | 1 row |

This is not a regression against main. Under the mixed front, child mode kept ADT locks in Node's `Sessions` and
in no lock table at all. No ABAP in the tree reads or takes `ZOSD_ADT_LOCK` from the child today; the lock object
is used only under `src/adt`.

What it forces: `ZCL_OSD_DEVELOPMENT` (0.8, must, "lock through ENQ") and an SM12 view need one lock table for
the whole system. A lock server shared across processes, E2 or an equivalent, is therefore a prerequisite of that
phase. E2 is parked for 0.7. The two ways to one table, with no choice made here:

- one lock server shared across the two processes (the E2 socket `tools/osd-enq.mjs` mentions, not built yet);
- the ADT front moved into the child, which then needs sessions and locks that survive a recycle (a file
  database for `ZOSD_ADT_SESS` and `ZOSD_ADT_SHDL`, and a lock table that outlives the process).

### Group C and the child's runtime

Until the lock-table and child-runtime question above is decided, slices 4a (writes), 4b (activation), the data
preview and ABAP Unit stay HOST routes and continuations that delegate to the child. They do not become ABAP rows
served in the parent.

The parent's ADT kernel has a database holding only the ADT tables, and reaches the source tree through the
STORE destination. That is enough for 4a writes (the store's files) and for 4b activation: the route decides in
ABAP and ends with a HOST verdict whose continuation (`publish`) runs in the parent after the step, where the
store and the supervisor live. Group C (data preview, ABAP Unit) needs the child's database and runtime, which
parent ABAP cannot reach. A group C route has three ways to get there: stay a HOST route, with Node proxying to
the child as today; end in a continuation that calls the child's door; or call the child through a new
destination from parent ABAP. If the front ever moves into the child (for C, or for the one lock table above),
the kernel in the parent is undone: `tools/adt-abap-kernel.mjs` and the child branch of `test/start.mjs`. The
handler, the continuation registry, `AbapSessions` and the tests stay.

### Measured overhead, with the real session

stoker measured the running host (median of the last 100 of 120 requests per cell):

| request | `OSD_ADT=js` | child | inline |
|---|---|---|---|
| `core/discovery` (HOST) | 0.70 ms | 2.91 ms | 3.09 ms |
| source GET (HOST) | 0.61 ms | 2.47 ms | 2.73 ms |

So a HOST row costs **+1.9 to 2.2 ms** with the ABAP front, not about 1 ms. The in-process bench of this branch
(one process, the inline mount, three alternating runs against main `d0768a9f`) gave smaller figures: +1.1 to +1.4
ms on discovery, +0.9 to +1.3 ms on a source GET and +0.2 to +0.7 ms on a LOCK. stoker's table is the one to
quote, because it measures the host as it runs. The cost is the real session: a sweep, a read and a touch per
request, then the adapter's `peek` and `handles` for `req.adt`, and the commit. That is more than the 0.45 to
0.6 ms the shim-only measurement (below) predicted.

**The sweep grows with the table.** `RESOLVE` ends expired sessions on every request with a scan of
`ZOSD_ADT_SESS` by `TOUCHED`, which has no index. Measured through the adapter: 0.54 ms with 1 session, 0.58 ms
with 1 001, 1.61 ms with 11 001 and 7.86 ms with 61 001, so about 0.12 ms per thousand. Sessions nobody needs no
longer stay (above), so the table holds only the sessions of real clients. An index on `TOUCHED`, or a sweep at
most every N seconds, is a change to `ZCL_OSD_ADT_SESSION` and its table, and is left to that class's owner.

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

The ICF entry `handle_request` now strips `X-OSD-Miss` case-insensitively; the internal `ANSWER` response keeps the ZCX miss flag for the Node front.
