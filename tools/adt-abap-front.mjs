// The ABAP front of the ADT façade (ADR 0007, slice 3, option B): every
// request under /sap/bc/adt and the Node logoff path enters the handler.
//
// The seam is one middleware inside adtRouter (tools/adt-facade.mjs), after
// the X-OSD-Generation stamp and the STG_ADT_DUMP capture, before the first
// route. There is no Node session middleware in front of it any more and no
// route table matched in JavaScript: who serves a request is the handler's
// verdict, decided in one dialog step that also resolves the session
// (ZCL_OSD_ADT_SESSION, through AbapSessions in tools/adt-abap-sessions.mjs)
// and runs the CSRF gate (ZCL_OSD_ADT_CSRF). docs/adt-abap-port/
// slice-3-front.md is the design note.
//
// The front calls ZCL_OSD_ADT_HANDLER=>ANSWER with the request record and
// reads its answer record, not what cl_express_icf_shim would write: the
// shim keeps one Set-Cookie line of two (port-map risk 5), the record keeps
// both. The shim stays the path of a real ICF.
//
// The verdict:
//  - ABAP: the handler answered (a route, or a refusal -- the CSRF gate's,
//    a session that ended); the record is replayed onto the response;
//  - HOST: the step ends, the record's Set-Cookie lines and token go onto
//    the response, req.adt is the session ABAP resolved, and the answer's
//    continuation runs after the step, outside the work-process lock. No
//    continuation (the default kind "") is next(): the Node route serves.
//
// A failure of the step (a dump, a shim fault, a nested step) is answered as
// the Node façade answers one -- the ADT exception document, 500,
// ExceptionInternalError in our namespace -- for every request, a HOST row
// included: no session was resolved, so nothing may go past the gate.
import {withoutHostPaths} from "./osd-build-issues.mjs";
import {remoteStep, stepJSON} from "./adt-remote-step.mjs";
import {currentStepToken} from "./osd-dialog-step.mjs";
import {withSystem} from "./osd-store-destination.mjs";

export const HANDLER = "ZCL_OSD_ADT_HANDLER";
export const SERVED_BY = "x-osd-served-by";
const NAMESPACE = "org.open-steamgate.osd";

// ---- continuations -------------------------------------------------------
//
// A HOST verdict may carry a continuation (ZIF_OSD_ADT_ROUTE=>TY_CONTINUATION:
// kind, payload as JSON). The kind names a handler a host registered here at
// startup; it runs after the step, with:
//   {req, res, next, kind, payload, session, answer, replay, resume}
// where payload is the parsed JSON (undefined when empty), session is
// req.adt.session (resolved in ABAP), answer is the handler's record
// ({status, contentType, headers, body, servedBy, continuation}) and replay()
// sends that record as an ABAP answer. A handler answers on its own (it
// replaces the ABAP answer), calls replay() after its work (it extends it),
// or calls next() (the Node route serves). Cookies and the token are already
// on res when it runs. resume(json) finishes host work through the route's
// ABAP RESUME in a fresh step and sends that response.
//
// What a continuation holds is a snapshot: the step has ended, no work-process
// lock is held, and between the verdict and the continuation another step may
// run -- a logoff, an UNLOCK, an expiry. The session it is handed may have
// ended since. A continuation (or a Node route) that changes something under
// a session's lock asks again inside a step of its own, right where it acts:
// sessions.whileHeld(session, handle, type, name, work) for a write under a
// handle, sessions.deleteObject for a delete (tools/adt-abap-sessions.mjs).
const continuations = new Map();

/** register a continuation handler for one kind; answers a function that
 *  takes the registration back. A kind is registered once per process. */
export function registerContinuation(kind, handler) {
  if (typeof kind !== "string" || typeof handler !== "function") throw new TypeError("registerContinuation(kind, handler)");
  if (continuations.has(kind)) throw new Error(`ADT continuation ${JSON.stringify(kind)} is registered already`);
  continuations.set(kind, handler);
  return () => { if (continuations.get(kind) === handler) continuations.delete(kind); };
}

export function continuationKinds() {
  return [...continuations.keys()].sort();
}

// the default: the Node façade serves the request
continuations.set("", ({next}) => next());
// the built-in kind for tests: what ABAP decided and who it was decided for,
// as JSON, replacing the ABAP answer
continuations.set("echo", ({res, kind, payload, session, answer}) => {
  res.status(200).json({kind, payload, session: session === undefined ? undefined
    : {id: session.id, user: session.user, stateful: session.stateful},
  abap: {status: answer.status, body: answer.body.toString("utf8")}});
});

/** The request body as bytes, or undefined when a parser has already turned
 *  it into something else: an ABAP route reads bytes, and a body that was
 *  parsed and thrown away would reach it as nothing. */
export async function bodyOf(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
  const length = req.headers["content-length"];
  const has = req.headers["transfer-encoding"] !== undefined || (length !== undefined && Number(length) > 0);
  // a body-parser that skipped leaves {} behind, with no body to lose
  if (has === false) return Buffer.alloc(0);
  if (req.readableEnded !== true && req.complete !== true) {
    // "data" events, as the Node façade's own rawBody reads a stream: a
    // request arrives the same way whoever reads it first
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }
  return undefined;
}

const text = (value) => String(value?.get?.() ?? value ?? "");

/** whether the router's own table gives the request an ABAP row; its table
 *  is read once per router class (a warm load is a new one) */
let table = {router: undefined, rows: undefined};
export async function abapServes(method, path) {
  const a = globalThis.abap;
  const router = a.Classes.ZCL_OSD_ADT_ROUTER;
  if (router === undefined) return true;
  if (table.router !== router) table = {router, rows: await router.routes()};
  const found = new a.types.Character(1);
  const route = router.METHODS.MATCH.parameters.ES_ROUTE.type();
  await router.match({it_routes: table.rows, iv_method: new a.types.String().set(String(method).toUpperCase()),
    iv_path: new a.types.String().set(path), ev_found: found, es_route: route});
  return found.get() === "X" && text(route.get().served_by) !== "HOST";
}

/** ZCL_OSD_ADT_HANDLER=>ANSWER from JavaScript: the request record in, the
 *  answer record out. Runs inside the caller's step. */
export async function answerOf(handler, view, session) {
  const a = globalThis.abap;
  const params = handler.METHODS.ANSWER.parameters;
  const request = params.IS_REQUEST.type();
  const r = request.get();
  r.method.set(String(view.method).toUpperCase());
  r.path.set(view.path);
  r.uri.set(view.url);
  const query = String(view.url).includes("?") ? String(view.url).slice(String(view.url).indexOf("?") + 1) : "";
  // The record uses Express qs semantics to match Node routes: joined repeats,
  // nested values and raw bad escapes. Integer-like keys reorder; prototype-named
  // keys drop; x[a]=1 stringifies as [object Object]; arrays past arrayLimit 20
  // become objects. Repeated _action reaches ZCL_OSD_ADT_LOCK as "LOCK,UNLOCK",
  // just as it does on the Node route.
  const fields = view.query === undefined ? new URLSearchParams(query) : Object.entries(view.query);
  for (const [name, value] of fields) {
    const row = r.query.appendInitial().get();
    row.name.set(name);
    row.value.set(String(value));
  }
  for (const [name, value] of Object.entries(view.headers)) {
    for (const one of Array.isArray(value) ? value : [value]) {
      const row = r.headers.appendInitial().get();
      row.name.set(name);
      row.value.set(String(one));
    }
  }
  // The body goes to ABAP only for a row ABAP serves, asked of the router
  // itself (ZCL_OSD_ADT_ROUTER=>MATCH over its own table): a big PUT that a
  // Node route serves is not turned into hex, three times its size, for
  // nothing. A route ending in a continuation is an ABAP row here.
  if (view.body.length > 0 && await abapServes(view.method, view.path)) {
    r.body.set(view.body.toString("hex").toUpperCase());
  }
  const response = params.ES_RESPONSE.type();
  const servedBy = new a.types.String();
  const input = {is_request: request, es_response: response, ev_served_by: servedBy};
  if (session !== undefined) {
    input.io_session = new a.types.ABAPObject({qualifiedName: "ZIF_OSD_ADT_SESSION",
      RTTIName: "\\INTERFACE=ZIF_OSD_ADT_SESSION"}).set(session);
  }
  await handler.answer(input);
  return responseOf(response, text(servedBy));
}

/** Convert the response of either ANSWER or RESUME without losing headers. */
export function responseOf(response, servedBy = "ABAP") {
  const s = response.get();
  const kind = text(s.continuation?.get().kind);
  return {
    status: s.status.get() || 200,
    contentType: text(s.content_type),
    headers: s.headers.array().map((row) => [text(row.get().name), text(row.get().value)]),
    body: Buffer.from(text(s.body), "utf8"),
    servedBy,
    continuation: kind === "" ? undefined : {kind, payload: text(s.continuation.get().payload)},
  };
}

/** {step, answer} for adtRouter's `abap` option, from the transpiled handler
 *  and the host's dialogStep: what test/start.mjs and the tests mount, said
 *  once. answer(view, session) runs inside the step. */
export function abapRunner({handler, step, stale, remote}) {
  if (remote !== undefined) {
    const runtime = remote.primary ?? remote;
    return {
      remote: runtime,
      async execute(view, req, options) {
        const {body, ...request} = view;
        const context = (runtime.adtContextSeq = (runtime.adtContextSeq ?? 0) + 1);
        runtime.adtContexts ??= new Map();
        runtime.adtContexts.set(context, {store: options.store,
          system: (kind, name, json) => options.system(kind, name, req, json)});
        try {
          let systemIdentity, identityError;
          try {
            const identity = await options.system?.("IDENTITY", "", req, "");
            if (identity !== undefined) systemIdentity = JSON.parse(JSON.stringify(identity));
          } catch (error) { identityError = String(error.message ?? error); }
          // Ask the child's router before encoding: HOST bodies stay in the parent.
          const needsBody = body.length > 0 && (await stepJSON(await remoteStep(runtime, {view: request, bodyRequired: true}))).bodyRequired;
          const response = await remoteStep(runtime, {view: request, bodyHex: needsBody ? body.toString("hex") : "",
            identity: options.sessions.identity, context, systemIdentity, identityError});
          const result = await stepJSON(response);
          if (!response.ok) throw Object.assign(new Error(result.error?.message ?? "ADT step failed"), {code: result.error?.code});
          if (result.adt !== undefined) req.adt = {...result.adt, sessions: options.sessions,
            session: result.adt.session === undefined ? undefined : {...result.adt.session,
              locks: new Map(result.adt.session.locks)}};
          const publications = await Promise.all(runtime.adtContexts.get(context).publications ?? []);
          const failed = publications.filter(p => p.EV_ACTIVE !== "X");
          if (failed.length) {
            // lazy: adt-documents pulls @abaplint/core and the store, which the
            // serving child must not load at boot (test/setup.mjs keeps it out)
            const {activationFailureDocument} = await import("./adt-documents.mjs");
            const entries = failed.flatMap(p => p.failureEntries ?? [{type: p.type ?? "PROG", name: p.name ?? "",
              issues: [{message: withoutHostPaths(String(p.EV_NOTE), options.store?.root ?? runtime.root)
                .split("\n")[0].slice(0, 500), severity: "E", line: 1, column: 1}],
            }]);
            return {...result.record, status: 200, servedBy: "ABAP", continuation: undefined,
              contentType: "application/xml", body: Buffer.from(activationFailureDocument(entries))};
          }
          return {...result.record, body: Buffer.from(result.record.body, "utf8")};
        } finally { runtime.adtContexts.delete(context); }
      },
    };
  }
  return {
    stale,
    resume: (kind, json) => resumeOf(globalThis.abap.Classes?.[HANDLER] ?? handler, kind, json),
    step: (work, label) => step(work, label),
    // the class slot read each time, so a warm load (tools/osd-hot.mjs) is
    // the handler the next request enters
    answer: (view, session) => answerOf(globalThis.abap.Classes?.[HANDLER] ?? handler, view, session),
  };
}

/** Call only inside the request's fresh dialog step. */
export async function resumeOf(handler, kind, json) {
  if (currentStepToken() === undefined) throw new Error("ADT RESUME requires a dialog step");
  const a = globalThis.abap;
  return responseOf(await handler.resume({iv_kind: new a.types.String().set(kind),
    iv_json: new a.types.String().set(json)}));
}

/** Host work finishes by sending the response returned by ABAP RESUME. */
export async function resume(req, res, kind, json) {
  const {store, step, front} = req.osdFacade;
  const record = await withSystem((k, n) => front.system?.(k, n, req), () => step(async () => {
    const original = req.adt?.session;
    // A fresh stateless GET ends its session in ANSWER and cannot continue.
    if (original !== undefined && await front.sessions.get(original.id) === undefined) {
      const error = new Error("the ADT session has ended");
      error.code = "ENQ_SESSION_ENDED";
      throw error;
    }
    const session = await front.sessions?.sessionFor?.(req);
    // Re-resolve in the new step: this pins ENQ and notices ended sessions.
    if (session !== undefined) {
      const a = globalThis.abap;
      const params = a.Classes[HANDLER].METHODS.ANSWER.parameters.IS_REQUEST.type().get();
      // A fresh request had no cookie on arrival. Re-entry uses the session
      // ANSWER resolved, including that case, rather than opening a new one.
      const headers = original === undefined ? req.headers
        : {...req.headers, cookie: `sap-contextid=${original.id}`};
      for (const [name, value] of Object.entries(headers)) {
        for (const one of Array.isArray(value) ? value : [value]) {
          const r = params.headers.appendInitial().get(); r.name.set(name); r.value.set(String(one));
        }
      }
      await session.zif_osd_adt_session$resolve({it_cookies: await a.Classes.ZCL_OSD_ADT_CSRF.cookies_of({it_headers: params.headers}),
        it_headers: params.headers});
    }
    return front.resume(kind, typeof json === "string" ? json : JSON.stringify(json));
  }, `ADT RESUME ${kind}`), {store});
  // RESUME does not stamp session headers; keep every header its owner
  // returned, alongside the cookies already sent by ANSWER.
  replay(res, record, req.method);
  return record;
}

const SESSION_HEADERS = new Set(["set-cookie", "x-csrf-token"]);

/** send an answer record, as the handler wrote it, onto an express response;
 *  `sessionSent` when its cookies and token are on the response already */
export function replay(res, record, method, {sessionSent = false} = {}) {
  res.status(record.status);
  for (const [name, value] of record.headers) {
    if (sessionSent && SESSION_HEADERS.has(name.toLowerCase())) continue;
    // set, not append, for the one header express refuses as a list
    if (name.toLowerCase() === "content-type") res.set(name, value);
    else res.append(name, value);
  }
  if (record.contentType !== "") res.set("content-type", record.contentType);
  // Node redirect/create routes end bytes explicitly, without Express ETags.
  if (record.status === 201 || (record.status >= 300 && record.status < 400 && record.status !== 304)) {
    res.removeHeader("ETag");
    res.set("Content-Length", String(record.body.length));
    res.end(method === "HEAD" ? undefined : record.body);
    return;
  }
  // a body is sent, and on a HEAD express drops it and keeps its
  // Content-Length. An empty answer is ended, as the Node façade ends one
  // (`.end()`), unless it is typed and not a HEAD: the Node façade answers
  // that with `.type(t).send("")`, and express gives it an ETag (UNLOCK)
  const typed = record.contentType !== "" || record.headers.some(([name]) => name.toLowerCase() === "content-type");
  if (record.body.length === 0 && (typed === false || method === "HEAD" || record.status === 304)) res.end();
  else res.send(record.body);
}

// A step of the front that dumps is said once per generation, with the way
// out: OSD_ADT=js runs the Node façade and Node's sessions without the ABAP
// front, which is the emergency exit when ZCL_OSD_ADT_* itself is broken.
const said = new Set();
function dumped(generation, message) {
  const key = String(generation ?? "");
  if (said.has(key)) return;
  said.add(key);
  console.error(`ADT front: a step of ZCL_OSD_ADT_HANDLER dumped (${message}) in generation ${key || "?"}; ` +
    "every ADT request answers 500 while it does. OSD_ADT=js turns the ABAP front off (Node sessions and routes).");
}

/**
 * @param {object} options
 * @param {Function} options.step the dialog step: (work, label) => Promise
 * @param {Function} options.answer (view, session) => Promise of the answer record, inside the step
 * @param {Function} options.resume (kind, json) => response record, called inside a fresh step
 * @param {object} options.sessions AbapSessions: sessionFor(req) gives the ZIF_OSD_ADT_SESSION
 *   whose RESOLVE sets req.adt
 * @param {Function} options.refuse the façade's refusal: (res, status, type, message, options)
 * @param {Function} [options.system] (kind, name, req, json) => value: this façade's SYSTEM answers
 * @param {object} [options.store] this façade's ObjectStore, what OBJECT reads
 * @param {Function} [options.hostLogoff] ends a delegated logoff inside its front step, until A3a
 * @param {Function} [options.miss] (req, kind) => void, records the stripped X-OSD-Miss marker
 * @param {Function} [options.served] (servedBy, req, record) => void, for a test or a log
 * @param {Function} [options.generation] () => the live generation, for the one log line of a dump
 * @param {Function} [options.stale] () => true when the ABAP the front runs is older than the generation
 */
export function abapFront(options) {
  return async (req, res, next) => {
    req.osdFacade = {store: options.store, options: options.facadeOptions ?? options, step: options.step, front: options};
    // the full path, undecoded, whatever router prefix express has stripped
    const url = req.originalUrl ?? req.url;
    const path = url.split("?")[0];
    const refuse = (message) => options.refuse(res, 500, "ExceptionInternalError", message, {namespace: NAMESPACE});
    // a kernel older than the generation's front (tools/adt-abap-kernel.mjs):
    // said on every answer, never refused
    if (options.stale?.() === true) res.set("X-OSD-Front-Stale", "1");
    const body = await bodyOf(req);
    if (body === undefined) {
      refuse(`${req.method} ${path}: the request body was parsed before the ADT facade; mount it behind express.raw`);
      return;
    }
    // read off the stream here (or found empty), so the Node route that may
    // serve it next finds it where a raw parser would have put it: a parser
    // that skipped the request (a wildcard content type) left {} or nothing
    if (Buffer.isBuffer(req.body) === false && typeof req.body !== "string") req.body = body;
    const view = {method: req.method, headers: req.headers, url, path, body, query: req.query};
    const system = options.system ?? (() => undefined);
    let record;
    try {
      // Discovery must wait before acquiring the shared work process.
      if (options.store !== undefined && ["GET", "HEAD"].includes(req.method)
        && /^\/sap\/bc\/adt\/core\/http\/unit\/object\/?$/i.test(path)) {
        const {waitUnitWarmup} = await import("./osd-unit.mjs");
        await waitUnitWarmup(options.store);
      }
      record = options.execute !== undefined ? await options.execute(view, req, options) : await withSystem((kind, name, json) => system(kind, name, req, json),
        () => options.step(async () => {
          const answer = await options.answer(view, await options.sessions?.sessionFor?.(req));
          // Until A3a ports logoff, its HOST fallback must end the session
          // before this step releases the FIFO to a queued LOCK or DELETE.
          if (path === "/sap/public/bc/icf/logoff" && ["GET", "HEAD"].includes(req.method)
            && answer.servedBy === "HOST" && answer.continuation === undefined) await options.hostLogoff?.(req);
          return answer;
        },
          `ADT ${req.method} ${path}`),
        {store: options.store});
    } catch (e) {
      if (res.headersSent === true) return;
      // the ENQ session of the step ended while it waited for the work
      // process or in a WAIT (a logoff): the session is gone, and the answer
      // is the refusal a client logs on again after, not a dump
      if (e?.status === 413) {
        options.refuse(res, 413, "ExceptionInvalidRequest", e.message, {namespace: NAMESPACE});
        return;
      }
      if (e?.code === "ENQ_SESSION_ENDED") {
        res.status(403).set("x-csrf-token", "Required").type("text/plain; charset=utf-8").send("CSRF token validation failed");
        return;
      }
      const message = String(e?.message?.get?.() ?? e?.message ?? e);
      dumped(options.generation?.(), message);
      refuse(`${HANDLER}: ${message}`);
      return;
    }
    // Slice 0 stamps the ZCX miss kind here. This is an internal marker,
    // consumed even when a continuation replays the answer later.
    record.headers = record.headers.filter(([name, value]) => {
      if (name.toLowerCase() !== "x-osd-miss") return true;
      if (value === "object" || value === "resource") options.miss?.(req, value);
      return false;
    });
    const by = record.servedBy === "HOST" ? "HOST" : "ABAP";
    res.set(SERVED_BY, by);
    options.served?.(by, req, record);
    if (record.servedBy !== "HOST") {
      replay(res, record, req.method);
      return;
    }
    // the session of this step: its cookies, both lines, and its token
    for (const [name, value] of record.headers) {
      const lower = name.toLowerCase();
      if (lower === "set-cookie") res.append("Set-Cookie", value);
      else if (lower === "x-csrf-token") res.setHeader("x-csrf-token", value);
    }
    const kind = record.continuation?.kind ?? "";
    const handler = continuations.get(kind);
    if (handler === undefined) {
      refuse(`${HANDLER}: no continuation ${JSON.stringify(kind)} is registered on this host`);
      return;
    }
    let payload;
    try {
      payload = record.continuation?.payload ? JSON.parse(record.continuation.payload) : undefined;
    } catch (e) {
      refuse(`${HANDLER}: the payload of continuation ${JSON.stringify(kind)} is not JSON: ${e.message}`);
      return;
    }
    try {
      await handler({req, res, next, kind, payload, session: req.adt?.session, answer: record,
        resume: (json) => resume(req, res, kind, json),
        replay: () => replay(res, record, req.method, {sessionSent: true})});
    } catch (e) {
      if (e?.code === "ENQ_SESSION_ENDED" && res.headersSent !== true) {
        res.status(403).set("x-csrf-token", "Required").type("text/plain; charset=utf-8").send("CSRF token validation failed");
        return;
      }
      console.error(`ADT continuation ${JSON.stringify(kind)} failed on ${req.method} ${path}: ${e?.stack ?? e?.message ?? e}`);
      if (res.headersSent !== true) refuse(`continuation ${JSON.stringify(kind)}: ${String(e?.message ?? e)}`);
    }
  };
}
