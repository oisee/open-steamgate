# The ABAP skeleton: the seam (slice 1) and the locks (slice 2)

ADR 0007 moves the ADT façade to ABAP group by group, with the Node façade (`tools/adt-facade.mjs`) as the reference
until the last group has moved. Slice 1 puts the ABAP router in front of the Node façade and ports three route rows.
This note says where the seam is, what crosses it, what slice 2 built on it (the locks, over ENQ), and what is left
for slice 3.

## Where the seam is

The seam is one middleware inside `adtRouter` (`tools/adt-facade.mjs`), mounted on `/sap/bc/adt` when the host passes
`options.abap`. It sits after the three middlewares the façade already has and before the first route:

1. `sessions.middleware()`: the session cookies, the CSRF token and the CSRF gate (`tools/adt-session.mjs`);
2. the `X-OSD-Generation` stamp;
3. the `STG_ADT_DUMP` capture;
4. **the ABAP front** (`tools/adt-abap-front.mjs`);
5. the Node routes, unchanged, ending in the catch-all and its miss registry.

So in the mixed phase a route served by ABAP still gets the same cookies, token and generation header as every other
route, and a capture still records both sides. Those three move to ABAP in slice 3, and then the front moves up to the
top of the router.

`options.abap` is `{run, routes}`, made by `abapRunner()` from the transpiled shim and router and the host's
`dialogStep`. `run` is `cl_express_icf_shim.run` under `dialogStep`, the same function `mountServices` takes
(`tools/osd-icf.mjs`). `routes` reads `ZCL_OSD_ADT_ROUTER=>ROUTES` in a step of its own. Both are passed in, not
imported, because `adt-facade.mjs` is also loaded by the child-mode parent, which runs no ABAP. `test/start.mjs` passes
them in inline mode. `OSD_ADT=js` turns the front off.

## What crosses it

**Who serves a request is decided in JavaScript, before any ABAP runs.** The front reads the route table once (the
`routes` callback) and matches it with `matchRoute`, which follows the ABAP matcher's rules. A test holds the two
matchers equal over the real table and a synthetic one. So for each request under `/sap/bc/adt` the front:

1. matches the full undecoded path (`req.originalUrl`, because Express has stripped the router prefix by then). A HOST
   row, or no row, goes to `next()` at once: no step, no work-process lock, no ABAP. Nothing that goes wrong on the
   ABAP side (a dump, a shim fault, a nested step) can stand between a client and a route Node still serves. If the
   table cannot be read, every route stays Node's, and the front says so once on the console;
2. for an ABAP row, reads the body as bytes: a Buffer from `express.raw`, a string from `express.text`, or the unread
   stream. A body that a parser has already turned into something else (`express.json`) is refused with a 500 exception
   document that names the cause, rather than reaching ABAP as nothing. A parser that skipped a request without a body
   leaves `{}`, and that is an empty body;
3. runs `ZCL_OSD_ADT_HANDLER` through the runner, with a recorder in place of the express response. A throw there is
   answered through the façade's own `refuse()`: 500, `ExceptionInternalError` in `org.open-steamgate.osd`, the same
   document and content type the Node façade's `answered()` sends for a failure, never `text/plain`;
4. replays status, headers and body onto the real response. An empty body is ended, as the Node façade ends one. A body
   is sent, so on a HEAD Express drops it and keeps the GET's `Content-Length`. If the handler marked the answer
   `X-OSD-Served-By: HOST`, the two tables disagree; the front believes the handler and calls `next()`.

On a system there is no host behind the handler. There a request no ABAP row serves is a 404 with an exception
document and the marker header, which is the honest answer.

What the ABAP needs from the host goes through the one host seam that exists, `ZOSD_STORE DESTINATION 'STORE'`
(`tools/osd-store-destination.mjs`), as port-map section 3 plans. Slice 1 adds the command `SYSTEM` with `IV_TYPE` =
the kind and the answer in a new exporting parameter `EV_JSON`. The only kind so far is `IDENTITY`.
`CAPABILITIES` is unchanged: SYSTEM draws no button on any screen.

The identity belongs to the façade instance, not to the process: a test mounts several `adtRouter`s with different
options. So the front runs each call inside `withSystem(answers, work)` (`tools/osd-store-destination.mjs`). That is an
`AsyncLocalStorage` binding, made per call, which follows the call through the work-process queue of `dialogStep` to
the destination. Nothing is set process-wide. A `SYSTEM` call that no façade instance bound is refused with `EV_ERROR`
instead of answered from the environment, because a plausible identity would be a wrong answer that looks right. A
host that cannot answer (an exception in the answers) is `EV_ERROR` too, and the route then answers 500. The same
binding is how slice 2 gives each façade instance its own `ObjectStore` (port-map risk 12).

## The ABAP

Package `src/adt/` (`ZOSD_ADT`, SICF node `zosd_adt.sicf.xml` on `/sap/bc/adt/`):

| object | role |
|---|---|
| `ZCL_OSD_ADT_HANDLER` | `if_http_extension`. Request record in, router, response out. Catches `ZCX_OSD_ADT` once, and anything else as a 500 `ExceptionInternalError` in `org.open-steamgate.osd`. Marks what it does not serve. |
| `ZCL_OSD_ADT_ROUTER` | The ordered route table: method, pattern with `:param` segments, handler class, `served_by` ABAP or HOST. |
| `ZIF_OSD_ADT_ROUTE` | `handle( request ) RETURNING response`. A route class is created by name. |
| `ZCX_OSD_ADT` | Status, type id, namespace, message, properties. `document( )` is byte-equal to `exceptionDocument`. Factories `not_found` 404, `read_only` 405, `not_supported` 501, `conflict` 409, `internal` 500: the Node façade's `answered()` mapping. |
| `ZCL_OSD_ADT_XML` | `esc( )`: `& < > "`, as the Node façade escapes. |
| `ZCL_OSD_ADT_URI` | `decode_segment( )`: a `:param` decoded as Express decodes one. |
| `ZCL_OSD_ADT_HOST` | `SYSTEM` through the STORE destination; `identity( )`. |
| `ZCL_OSD_ADT_SYSINFO` | `GET core/http/systeminformation`. |
| `ZCL_OSD_ADT_GRAPH` | `GET` and `HEAD compatibility/graph`. |

The router's rules are Express's, because the Node façade is the reference:

- the first row that matches wins;
- `:name` matches one non-empty segment and is percent-decoded after the split and after the match, by
  `ZCL_OSD_ADT_URI`. Every `%XX` is a byte, the bytes must be UTF-8, and `+` stays `+`. A segment that does not decode
  (`%zz`, a lone `%FF`) is a 400 `ExceptionInvalidRequest`, "Failed to decode param '<segment>'": Express's status and
  message. `cl_http_utility=>unescape_url` is not used, because in open-abap it is `decodeURIComponent` in a kernel
  line, and its `URIError` is a JavaScript error that no `CATCH` reaches;
- a last segment `*` matches the rest;
- literal segments compare without case, and one trailing slash is ignored;
- HEAD matches a HEAD row, else a GET row. A HEAD row of its own is how a HEAD answers differently: the graph has one,
  answering an empty `application/xml` without a charset, as the Node façade does.

Slice 1's table is four rows: the three ported rows and a catch-all `* /sap/bc/adt/*` served by HOST. The 142
registrations of port-map section 1 arrive group by group. The per-type ones are generated from the type table, never
listed by hand.

## Routes ported

| row | Node | ABAP |
|---|---|---|
| `GET core/http/systeminformation` | identity JSON | the same five keys in the same order, values from SYSTEM IDENTITY |
| `GET compatibility/graph` | `compatibilityGraphDocument()` | the same nodes and edges, in the same order |
| `HEAD compatibility/graph` | empty, `application/xml` | the same |

`HEAD core/http/systeminformation` is served by the HEAD→GET rule.

Discovery stays with Node in this slice. In the mixed phase it has to advertise every route, including those still
served by HOST, so its ABAP form needs the advertise column of the whole table. That table arrives with the groups.

Extra keys given to `adtRouter` through `options.identity` are not carried into the ABAP document. No caller passes
any.

## Gate 1

`test/adt-abap-diff.mjs` mounts two `adtRouter`s over one store, one with the front and one without. It compares
status, content type, content length, entity tag and body:

- for every ported row, including HEAD, a trailing slash and an upper-case path. It also asserts that ABAP answered;
- for routes ABAP does not serve. It asserts that they reached the Node façade and that no ABAP step ran for them. A
  POST is refused by the Node CSRF gate before the front is reached;
- with the ABAP side broken (a runner that throws): the ABAP row answers what the Node façade's `answered()` answers for
  the same failure, and every HOST row answers as before;
- for a ported row that raises (the host refuses `SYSTEM IDENTITY`, `ZCX_OSD_ADT=>INTERNAL`), over HTTP for GET and HEAD,
  against `answered()` for the same message;
- for two façade instances with different identities, with requests interleaved, and for a `SYSTEM` call nobody bound;
- for the two matchers, JS and ABAP, over the real table and a synthetic one, four methods and 17 paths;
- for the body: streamed, `express.raw` and `express.text` reach ABAP as the same bytes; `express.json` with a body is
  refused;
- for the exception document, for four cases (no properties, our namespace, five escaped properties, non-ASCII), against
  `exceptionDocument`.

Each of these fails when its fix is taken out (a mutated graph node, HOST rows entering the step, a text/plain refusal,
a different refusal content type, an unbound fallback, a Buffer-only body, a case-sensitive or slash-strict JS
matcher). ABAP Unit in `zcl_osd_adt_router.clas.testclasses.abap` covers the decoding; with `unescape_url` back in
place, three of its cases die with `URI malformed`. The existing `test/adt-*.mjs` suites stay green. `test/adt-facade.mjs` starts the inline
server, so its systeminformation and graph cases now run through the ABAP front.

Measured on one inline server, 20 requests each, medians, same script both ways:

| request | Node only | with the ABAP front |
|---|---|---|
| systeminformation (ABAP) | 0.94 ms | 2.92 ms |
| compatibility/graph (ABAP) | 0.69 ms | 1.19 ms |
| discovery (delegated) | 0.59 ms | 0.67 ms |

A delegated request pays only the JS match: it takes no work-process lock, so it never waits for an OData step. Once the
session moves (slice 3) every ADT request runs ABAP, and the question comes back then.

The route table is read once per front. A warm swap that changes `ZCL_OSD_ADT_ROUTER` (`OSD_WARM=1`) is not seen
until the process is recycled. The table is not something a person edits while working, so this is noted and not
built.

## Not in slice 1

- **Child mode.** The parent of `STG_SERVE=child` loads no ABAP, so there the Node façade answers everything. Putting
  the front there means forwarding to the child's ICF, which is claimed away from `/sap/bc/adt` today
  (`tools/osd-serve.mjs`, `claimed`).
- **OSGo and the preview.** `/sap/bc/adt` is claimed by `src/icf/nodes.json`, so OSGo does not mount the SICF node
  (`tools/gogen/osgo.mjs`). The Go front needs the `STG_ADT_DUMP` capture before any group switches there (port-map
  risk 11).
- **The miss registry.** A `not_found` raised by an ABAP route does not reach `facade.missed` yet. No ported route
  raises one.
- **The node flip.** `src/icf/nodes.json` still says HOST `adt-facade` for `/sap/bc/adt`. `nodes()` now lists both
  that node and the SICF one, and `test/osd-routes.mjs` asserts both until the last group has moved.

## Slice 2: the session's locks on ENQ

Slice 2 moves LOCK and UNLOCK into ABAP over the lock server (ADR 0008) and binds the ADT session to its ENQ
session. The session record itself, its cookies and CSRF stay in the Node middleware, which still runs before the
front: that move is slice 3.

### The ABAP

| object | role |
|---|---|
| `ZOSD_ADT_LOCK` | Table: `MANDT`, `OBJTYPE` CHAR 4, `OBJNAME` CHAR 40. It holds no rows. It exists to be the lock object's primary table. |
| `EZOSD_ADT_OBJ` | Lock object over it (ENQU). The transpiler generates `ENQUEUE_` / `DEQUEUE_EZOSD_ADT_OBJ`, and `tools/osd-enq-host.mjs` serves them. |
| `ZCL_OSD_ADT_TYPES` | The lockable types and their collections: the six source types in `TYPES` order, then DEVC. `type_of_path( )`. |
| `ZCL_OSD_ADT_LOCK` | `POST <collection>/:name`: `_action` LOCK, UNLOCK, else 400; a missing object 404; a library object an empty handle. |
| `ZCX_OSD_ADT` | Two new factories: `invalid_request` (400) and `locked_by_other` (403, EU 510, V1 user, V2 object). |
| `ZCL_OSD_ADT_HOST` | `object( )` (store command OBJECT), `lock_handle( )` and `lock_release( )` (SYSTEM kinds). |

The router generates seven POST rows from `ZCL_OSD_ADT_TYPES=>LOCKABLE`. None is written by hand.

The lock is `ENQUEUE_EZOSD_ADT_OBJ` in **mode X**, `_SCOPE 1`, with both key fields literal. X is chosen for what the
measured contract says about the same owner: a second X is refused with MC 602 ("your own lock"), not counted. So a
second LOCK of the same session is a 602, which the route reads as "you have it", and one UNLOCK releases it. With
E, the second LOCK would count 2 and one UNLOCK would leave the object held. MC 601 is another owner, and `sy-msgv1`
is that owner's user: the route renders it as `lockedByOtherDocument`. The ADT refusal is ENQ's `FOREIGN_LOCK`, drawn
in the ADT format, as ADR 0008 says.

### Session binding

The front gets an `enter(req)` hook, which `abapRunner` runs first inside the step, before the shim. The façade's
hook (`abapSession` in `tools/adt-enq.mjs`) binds the step with `bindEnqSession("adt:" + id, {user})` when the
request's session is stateful:

- **The session is the middleware's choice.** `req.adt.session` is what `sessionIdOf` named. No second reading of
  the cookies exists, so the one precedence rule stays the one rule.
- **The ENQ session carries the ADT user.** `bindEnqSession` takes a `user`. Without it the ENQ session opens with
  `sy-uname`, which is the process's user, and the EU 510 refusal names the wrong holder.
- **"Stateful" is the session's flag,** which the middleware sets and never clears. A stateless request of a
  stateful session is bound like any other, so it never clears the session's locks (the #395 fix, by construction).
  A session that never asked for state binds nothing: its step is its ENQ session, and a lock taken there goes when
  the request ends. That is how a stateless request behaves on a system. The Node façade keeps such a lock, so this
  is the one place the two modes answer differently; no client in the suites locks without state.
- **The end** is `Sessions#end`, which logoff, `DELETE core/http/sessions/:id` and expiry already go through. With
  the ABAP front it ends with `endEnqSession("adt:" + id)`.

The slice-1 plan proposed SYSTEM kinds `ENQ_BIND` and `ENQ_END` called from the handler. That plan assumed the
session id was decided in ABAP. It is not decided there yet, and the front already has the session, so `enter`
costs no host round trip. Open question 3 of slice 1 is answered this way for now. It comes back when the session
moves.

### One source of truth for who holds what

The Node routes that still check a lock (PUT source and includes, POST include, DELETE object) and the ABAP LOCK
route have to agree. The two candidates were "ABAP updates the Node session map" and "the Node routes ask ENQ". The
decision splits the state by what it is:

- **Who holds an object is the lock server's, and only its.** `Sessions` now takes an owner table. The default,
  `SessionOwners`, is the old in-memory map, so `test/adt-session.mjs` and the façade without ABAP are unchanged.
  With the ABAP front, the façade passes `EnqOwners` (`tools/adt-enq.mjs`). Its `holder`, `take`, `drop` and `end`
  are `ENQUEUE_READ`-style reads and `ENQUEUE` / `DEQUEUE` on the same table the ABAP route writes, with the
  argument built from the dictionary by the same `request()` the generated modules use (`enqHolder`, `enqTake` and
  `enqDrop` in `tools/osd-enq-host.mjs`). `holderOf`, `holds( )`, `release` and the expiry sweep all read from
  there. No copy of the owner table exists to drift.
- **The handle is the session's,** as port-map step 8 says: an ADT value, not an ENQ one. It stays in
  `session.locks`, and ABAP writes it through two SYSTEM kinds bound per request like IDENTITY. `LOCK_HANDLE "TYPE
  NAME"` returns the session's handle for the object (`Sessions#adopt`: the one it has, or a new UUID).
  `LOCK_RELEASE <handle>` forgets the handle and returns the object (`Sessions#forget`). The route then dequeues.
  The handle is minted in JavaScript with `randomUUID`, so its format is the Node façade's by construction.

A write is allowed when `Sessions#holds(session, handle, type, name)` is true: the handle is the session's for that
object, **and** the lock server says this session holds it. `stillHeld`, which every write route runs right before it
writes, now asks exactly that. So a handle left in the map after its lock went (a session without state, whose ENQ
session ended with the request) writes nothing.

When the ABAP route table cannot be read, the Node LOCK route serves. With `EnqOwners` it takes the same lock from
the host (`enqTake`), so the fallback does not split the table either.

### The rest of the seam

- **OBJECT** is a store command on `ZOSD_STORE` (port-map section 3), answering `{found, type, name, writable}` from
  `IV_TYPE` and `IV_NAME`. It reads the store the call is bound to: `withSystem(answers, work, {store})`. That is port-map
  risk 12, each façade instance with its own store, done the way slice 1 planned. CAPABILITIES does not list it, because no
  screen draws a button for it.
- **The SYSTEM answers are per request now:** `system(kind, name, req)`. The slice-1 kinds ignore the request.
- **An empty answer.** The Node façade answers UNLOCK with `.type("text/plain").send("")`, and Express gives that
  an ETag. The front used to `end()` every empty answer. It now sends an empty answer that is typed and not a HEAD,
  and ends the rest. The graph's HEAD keeps its `end()`.
- **CSRF** is unchanged. The middleware refuses a write without the token before the front is reached. A test
  confirms that the ABAP-mounted router answers exactly as the Node one does and that no step runs.

### Gate 1, slice 2

`test/adt-abap-diff.mjs` runs eight sequences twice, against the Node façade and against the ABAP front, each over
its own copy of one tree. It compares every answer: status, content type, length, entity tag and body. The handle is
random on both sides, so it is checked as a UUID and replaced, and so is the ETag of a body that carries one, after
checking that the ETag is Express's tag of that body. The sequences:

1. lock, a stateless GET, the PUT, UNLOCK, a PUT after the UNLOCK;
2. a second session refused with EU 510, the holder relocking (same handle), UNLOCK handing the lock over;
3. logoff releases;
4. `DELETE core/http/sessions/:id` releases, and the stateless poll before it does not;
5. DELETE respects the holder, and the holder's DELETE takes the lock with it;
6. the same user in another session is refused;
7. a package (DEVC) locks like a source object;
8. the refusals (no object 404, no action 400, an unknown action 400), the `dataname` a client asks for, and an
   UNLOCK of an unknown handle.

Each sequence also asserts the reference statuses, so two sides failing alike cannot pass. It asserts that every
LOCK and UNLOCK was served by ABAP and nothing else was, and that the lock table is empty afterwards. Three more
cases cover the rest:

- CSRF;
- the ENQ row: user, mode X, one count after a relock, gone at logoff;
- a session without state: its lock goes with the request, and the handle left in the map writes nothing (PUT and
  POST include 409).

Each case was checked failing with its fix taken out:

| fix taken out | fails |
|---|---|
| no `bindEnqSession` | 8 of 11 |
| binding sessions without state too | the session-without-state case |
| binding without the ADT user | 7 (EU 510 names `sy-uname`) |
| `EnqOwners#end` a no-op | 8 (logoff, DELETE session) |
| the in-memory owner table with ABAP on | 9 |
| every empty answer ended | 4 (UNLOCK's ETag) |
| `stillHeld` without the lock-server check | the session-without-state case |
| 601 read as "your own" in ABAP | 5 |
| mode E instead of X | 3 (relock counts 2) |

`test/adt-devloop.mjs` now mounts its own routers with the ABAP front, unless `OSD_ADT=js`
(`test/helpers/adt-abap.mjs`). That covers the locking section, "locks across requests and sessions" and the DEVC
lock of "a created package". Its 86 cases pass both ways. `test/adt-session.mjs` (17), `adt-facade`, `adt-editor`,
`adt-notebook`, `adt-versions`, `osd-enq`, `osd-enq-abap`, `osd-routes` and `store-destination` also pass.

Measured on one process, 25 rounds of LOCK, PUT, UNLOCK on one stateful session, median of the last 20, two runs:

| request | Node only | with the ABAP front |
|---|---|---|
| LOCK (ABAP) | 0.72 / 0.82 ms | 2.14 / 2.31 ms |
| PUT (Node, asks ENQ) | 0.98 / 1.15 ms | 1.14 / 1.23 ms |
| UNLOCK (ABAP) | 0.69 / 0.71 ms | 2.11 / 2.22 ms |

A LOCK makes two host calls (OBJECT, LOCK_HANDLE) and an ENQUEUE inside one step. A PUT pays one `ENQUEUE_READ`-style
scan of the lock table.

### Open questions for slice 3

1. **A lock without state.** Under ABAP it lives only as long as its request, and the Node façade keeps it. A4H was
   not measured for this case, and it should be before the Node façade is retired.
2. **The session into ABAP.** `ZCL_OSD_ADT_SESSION`, the tables `ZOSD_ADT_SESS` and `ZOSD_ADT_HNDL`, and CSRF in
   `ZCL_OSD_ADT_CSRF`. Then `LOCK_HANDLE` and `LOCK_RELEASE` go, the handle map becomes a table, the binding moves
   into the handler, and the front moves to the top of `adtRouter`. The binding then needs a host call per stateful
   request (the old `ENQ_BIND`), unless the front keeps reading the session cookie.
3. **OSGo.** `bindEnqSession` binds the Node step token, and the Go dispatcher needs its own binding (slice-1
   question 2, still open). `OBJECT` has no Go implementation, and OSGo does not mount the front.
4. **The lock argument is 40 characters.** Longer names (a namespaced object can reach 120 in TADIR) would be cut,
   and two such names would collide. No object in the tree comes near 40 characters.
5. **Release at the end of a session is synchronous here,** and asynchronous on a system (ADR 0008: gone within a
   second). Nothing in the façade depends on it.
6. The slice-1 questions on HEAD over ICF, the child-mode parent and the IDENTITY cache stay open.
