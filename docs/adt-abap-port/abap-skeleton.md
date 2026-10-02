# The ABAP skeleton, slice 1: the seam

ADR 0007 moves the ADT façade to ABAP group by group, with the Node façade (`tools/adt-facade.mjs`) as the reference
until the last group has moved. Slice 1 puts the ABAP router in front of the Node façade and ports three route rows.
This note says where the seam is, what crosses it, and what slice 2 builds on it.

## Where the seam is

The seam is one middleware inside `adtRouter` (`tools/adt-facade.mjs`), mounted on `/sap/bc/adt` when the host passes
`options.abap`. It sits after the three middlewares the façade already has and before the first route:

1. `sessions.middleware()`: the session cookies, the CSRF token and the CSRF gate (`tools/adt-session.mjs`);
2. the `X-OSD-Generation` stamp;
3. the `STG_ADT_DUMP` capture;
4. **the ABAP front** (`tools/adt-abap-front.mjs`);
5. the Node routes, unchanged, ending in the catch-all and its miss registry.

So in the mixed phase a route served by ABAP still gets the same cookies, token and generation header as every other
route, and a capture still records both sides. Those three move to ABAP in slice 2, and then the front moves up to the
top of the router.

`options.abap` is the host's ICF runner: `cl_express_icf_shim.run` under `dialogStep`, the same function
`mountServices` takes (`tools/osd-icf.mjs`). It is passed in, not imported, because `adt-facade.mjs` is also loaded by
the child-mode parent, which runs no ABAP. `test/start.mjs` passes it in inline mode. `OSD_ADT=js` turns it off.

## What crosses it

For each request under `/sap/bc/adt` the front:

1. builds the request the shim reads: method, headers, the full undecoded path (`req.originalUrl`, because Express has
   stripped the router prefix by then), and a body only when the host already buffered one (`express.raw`). The stream
   is not touched, so a Node route that reads it later still can.
2. runs `ZCL_OSD_ADT_HANDLER` through the runner, with a recorder in place of the express response;
3. if the recorded answer carries `X-OSD-Served-By: HOST`, drops it and calls `next()`: the Node façade answers exactly
   as before;
4. otherwise replays status, headers and body onto the real response. An empty body is ended, as the Node façade ends
   one. A body is sent, so on a HEAD Express drops it and keeps the GET's `Content-Length`.

On a system there is no host behind the handler. There the same request is a 404 with an exception document and the
marker header, which is the honest answer.

What the ABAP needs from the host goes through the one host seam that exists, `ZOSD_STORE DESTINATION 'STORE'`
(`tools/osd-store-destination.mjs`), as port-map section 3 plans. Slice 1 adds the command `SYSTEM` with `IV_TYPE` =
the kind and the answer in a new exporting parameter `EV_JSON`. The only kind so far is `IDENTITY`.
`CAPABILITIES` is unchanged: SYSTEM draws no button on any screen.

The identity belongs to the façade instance, not to the process: a test mounts several `adtRouter`s with different
options. So the front runs the handler inside an `AsyncLocalStorage` binding that carries that instance's answers. The
binding follows the call through the work-process queue of `dialogStep` to the destination, which asks it through
`provideSystem()` and falls back to `osdIdentity().adt` when nothing is bound. The same binding is how slice 2 gives
each façade instance its own `ObjectStore` (port-map risk 12).

## The ABAP

Package `src/adt/` (`ZOSD_ADT`, SICF node `zosd_adt.sicf.xml` on `/sap/bc/adt/`):

| object | role |
|---|---|
| `ZCL_OSD_ADT_HANDLER` | `if_http_extension`. Request record in, router, response out. Catches `ZCX_OSD_ADT` once, and anything else as a 500 `ExceptionInternalError` in `org.open-steamgate.osd`. Marks what it does not serve. |
| `ZCL_OSD_ADT_ROUTER` | The ordered route table: method, pattern with `:param` segments, handler class, `served_by` ABAP or HOST. |
| `ZIF_OSD_ADT_ROUTE` | `handle( request ) RETURNING response`. A route class is created by name. |
| `ZCX_OSD_ADT` | Status, type id, namespace, message, properties. `document( )` is byte-equal to `exceptionDocument`. Factories `not_found` 404, `read_only` 405, `not_supported` 501, `conflict` 409, `internal` 500: the Node façade's `answered()` mapping. |
| `ZCL_OSD_ADT_XML` | `esc( )`: `& < > "`, as the Node façade escapes. |
| `ZCL_OSD_ADT_HOST` | `SYSTEM` through the STORE destination; `identity( )`. |
| `ZCL_OSD_ADT_SYSINFO` | `GET core/http/systeminformation`. |
| `ZCL_OSD_ADT_GRAPH` | `GET` and `HEAD compatibility/graph`. |

The router's rules are Express's, because the Node façade is the reference:

- the first row that matches wins;
- `:name` matches one non-empty segment and is percent-decoded after the split;
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
- for routes ABAP does not serve. It asserts that they reached the Node façade. A POST is refused by the Node CSRF gate
  before the front is asked;
- for two façade instances with different identities, with requests interleaved;
- for the exception document, for four cases (no properties, our namespace, five escaped properties, non-ASCII), against
  `exceptionDocument`.

A mutated graph node fails it. The existing `test/adt-*.mjs` suites stay green. `test/adt-facade.mjs` starts the inline
server, so its systeminformation and graph cases now run through the ABAP front.

Measured on one inline server, 20 requests each, medians, same script both ways:

| request | Node only | with the ABAP front |
|---|---|---|
| systeminformation (ABAP) | 0.90 ms | 3.27 ms |
| compatibility/graph (ABAP) | 0.64 ms | 1.75 ms |
| discovery (delegated) | 0.55 ms | 1.09 ms |

A delegated request pays about half a millisecond for asking ABAP first. It also waits for the work process when an
OData step holds it, which a Node-only route did not. That is the end state anyway: every ADT request runs ABAP once
the session moves.

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

## Slice 2: session, CSRF, locks

The session record moves into `ZCL_OSD_ADT_SESSION`, with tables `ZOSD_ADT_SESS` / `ZOSD_ADT_HNDL` because statics do
not survive on OSGo. CSRF moves into `ZCL_OSD_ADT_CSRF`. Then the front moves to the top of `adtRouter`, and the
handler commits session rows whatever the status (port-map risk 1).

Locks go through ENQ (ADR 0008). The session binding is in `tools/osd-enq-host.mjs`; the ADR and the task call it
`osd-enq`. Without a binding, an ENQ session is the dialog step, and a stateless request leaves no lock. An ADT
stateful session is longer, so:

- **Bind.** At the start of every step that belongs to a stateful ADT session, the step is bound with
  `bindEnqSession("adt:" + <session id>)`. A lock taken by `ENQUEUE_EZOSD_ADT_OBJ` in that step then belongs to the ADT
  session, not to the step. A stateless request binds nothing, which is the "a stateless request no longer clears a
  session's locks" fix of `fix/adt-lock-session`, by construction.
- **End.** Logoff, `DELETE core/http/sessions/:id` and expiry call `endEnqSession("adt:" + <session id>)`, which releases
  every lock of that owner. That is the "release owner X" that `DEQUEUE_ALL` cannot do from another request
  (port-map risk 3).
- **Who calls them.** The session id is decided in ABAP in slice 2, so the binding is a host call from the handler.
  The proposal is SYSTEM kinds `ENQ_BIND` and `ENQ_END` on the same destination, with the id in `IV_NAME`; the Node
  destination calls the two functions. On a system, the ICF stateful session is the lock owner and both kinds are
  no-ops.

Open questions for slice 2:

1. Does ICF on a system drop the body of a HEAD answered by a GET handler, as Express does? The router keeps the body
   and relies on the HTTP layer. Gate 2 (A4H) should measure it.
2. `bindEnqSession` binds the step token. On OSGo the step model is the multi-WP dispatcher (ADR 0008, E2), and the
   binding needs its Go equivalent before locks switch there.
3. `ENQ_BIND` as a destination call is one more host round trip per stateful request. The alternative is the front
   reading the session cookie and binding before the step, which duplicates the cookie precedence rule in JS. The
   proposal keeps the rule in ABAP and measures the cost.
4. The child-mode parent: forward to the child's ICF, or give the child `/sap/bc/adt` and make the parent a proxy as it
   is for OData.
5. `SYSTEM IDENTITY` is read on every systeminformation request. Port-map risk 9 suggests caching it by
   `index_generation`. Measure that before adding a cache.
