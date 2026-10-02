# F3: host continuations and ABAP re-entry

A route returns `ty_response-continuation-kind` and a JSON `payload` from
its first step. That produces a HOST verdict. Its response should also be
an honest refusal on a system without a continuation host. The step ends
before the host handler runs, freeing the work-process FIFO during builds,
child test runs and other slow host work.

Register each kind once at module scope with `registerContinuation(kind,
handler)`. Duplicate registration throws without replacing the first
handler; mounting a router never registers a kind. A handler resolves its
store and configuration from `req.osdFacade = {store, options, step}`.
These belong to this request's router. Do not capture a router's store in
the process-global registry. The facade also carries the internal front
adapter used to resolve SYSTEM and sessions again on re-entry.

After host work, call the supplied `resume(json)` callback, or
`resume(req, res, kind, json)` from `tools/adt-abap-front.mjs`. Objects are
JSON.stringify'd; strings pass through unchanged. The helper binds that
request's store and SYSTEM, queues a fresh dialog step through its front's
step function, checks that its session still exists and resolves it again
inside the step (including the ENQ pin). Continuations require requests
that keep their session (POST/PUT, or an explicitly stateful GET). A fresh stateless GET ends its session in ANSWER
and cannot resume. An ended session receives the
existing 403 CSRF refusal. It never runs ABAP in `outsideStepContext`.

The only ABAP re-entry is `ZCL_OSD_ADT_HANDLER=>RESUME(iv_kind, iv_json)`.
Register the owner with `ZCL_OSD_ADT_ROUTER=>ADD`, passing the optional
`iv_resume_kind` alongside `iv_method`, `iv_pattern` and `iv_handler`
(`ct_routes` receives the row's `resume_kind`), and
implement `ZIF_OSD_ADT_RESUMABLE~RESUME` on that class. A class owning
several kinds can have several rows. Each kind must have one owner; the
first row with that kind wins. RESUME creates that owner and returns its
`ty_response`; no HTTP routing or first-step CSRF check is repeated. The
handler fences session work before dispatch, rolls route work back on
exceptions, and formats ZCX/root failures in the usual ADT document.
The route must not COMMIT or ROLLBACK. The surrounding dialog step commits
successful work. Unknown ABAP kinds become a typed ZCX internal refusal
with status 500. Unknown host kinds retain the existing front refusal.

The host sends RESUME's status, content type, headers and bytes, retaining
cookies/token already sent by the first step. RESUME does not stamp
session cookies again; every header returned by its owner is replayed. RESUME is terminal: it must
return a finished response, rather than request another continuation.
The kernel closure follows the router's literal owner class and the new
interface, so parent-kernel hosts need no separate loader registry.

The browser preview uses ICF instead of the Node facade. No browser Node
front is mounted. For an ICF node mapped to `ZCL_OSD_ADT_HANDLER`, the entry in
`web/preview-backend.mjs` uses `web/preview-continuations.mjs`, also reached
by the service worker. Every continuation kind still receives the front's
unregistered-kind 500 document byte for byte. A later browser continuation
slice starts at this stub and supplies host work and a fresh resume step.
No activation, ABAP Unit or notebook kind is implemented by F3.

`test/adt-abap-f3.mjs` mounts two routers and exercises host writes and
ABAP STORE writes against both stores, real ABAP RESUME, FIFO waiting and
step context, both unknown-kind paths, duplicate registration, and browser
refusal bytes through the ICF record adapter. `test/adt-preview.mjs` also
exercises the preview backend and service-worker entry with an intact POST
XML body, the default content type and the continuation refusal bytes. The
test-only route and its ABAP Unit tests live under `test/unit/` and are excluded from shipped seeds.

Every STORE command, including LIST, CHECK and ACTIVATE, uses the request's
bound store. Unbound callers retain their destination's default store.
This is necessary for a resumed route that writes: binding the request
alone would otherwise still write through the process's default store.
