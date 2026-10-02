// The ABAP front of the ADT façade (ADR 0007, slice 3, option B): every
// request under /sap/bc/adt enters ZCL_OSD_ADT_HANDLER first.
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
import {withSystem} from "./osd-store-destination.mjs";

export const HANDLER = "ZCL_OSD_ADT_HANDLER";
export const SERVED_BY = "x-osd-served-by";
const BASE = "/sap/bc/adt";
const NAMESPACE = "org.open-steamgate.osd";

// ---- continuations -------------------------------------------------------
//
// A HOST verdict may carry a continuation (ZIF_OSD_ADT_ROUTE=>TY_CONTINUATION:
// kind, payload as JSON). The kind names a handler a host registered here at
// startup; it runs after the step, with:
//   {req, res, next, kind, payload, session, answer, replay}
// where payload is the parsed JSON (undefined when empty), session is
// req.adt.session (resolved in ABAP), answer is the handler's record
// ({status, contentType, headers, body, servedBy, continuation}) and replay()
// sends that record as an ABAP answer. A handler answers on its own (it
// replaces the ABAP answer), calls replay() after its work (it extends it),
// or calls next() (the Node route serves). Cookies and the token are already
// on res when it runs.
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
  const query = String(view.url).includes("?") ? String(view.url).slice(String(view.url).indexOf("?") + 1) : "";
  for (const [name, value] of new URLSearchParams(query)) {
    const row = r.query.appendInitial().get();
    row.name.set(name);
    row.value.set(value);
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
  const s = response.get();
  const kind = text(s.continuation?.get().kind);
  return {
    status: s.status.get() || 200,
    contentType: text(s.content_type),
    headers: s.headers.array().map((row) => [text(row.get().name), text(row.get().value)]),
    body: Buffer.from(text(s.body), "utf8"),
    servedBy: text(servedBy),
    continuation: kind === "" ? undefined : {kind, payload: text(s.continuation.get().payload)},
  };
}

/** {step, answer} for adtRouter's `abap` option, from the transpiled handler
 *  and the host's dialogStep: what test/start.mjs and the tests mount, said
 *  once. answer(view, session) runs inside the step. */
export function abapRunner({handler, step}) {
  return {
    step: (work, label) => step(work, label),
    // the class slot read each time, so a warm load (tools/osd-hot.mjs) is
    // the handler the next request enters
    answer: (view, session) => answerOf(globalThis.abap.Classes?.[HANDLER] ?? handler, view, session),
  };
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
 * @param {object} options.sessions AbapSessions: sessionFor(req) gives the ZIF_OSD_ADT_SESSION
 *   whose RESOLVE sets req.adt
 * @param {Function} options.refuse the façade's refusal: (res, status, type, message, options)
 * @param {Function} [options.system] (kind, name, req) => value: this façade's SYSTEM answers
 * @param {object} [options.store] this façade's ObjectStore, what OBJECT reads
 * @param {Function} [options.served] (servedBy, req, record) => void, for a test or a log
 * @param {Function} [options.generation] () => the live generation, for the one log line of a dump
 */
export function abapFront(options) {
  return async (req, res, next) => {
    // the full path, undecoded, whatever router prefix express has stripped
    const url = req.originalUrl ?? req.url;
    const path = url.split("?")[0];
    const refuse = (message) => options.refuse(res, 500, "ExceptionInternalError", message, {namespace: NAMESPACE});
    const body = await bodyOf(req);
    if (body === undefined) {
      refuse(`${req.method} ${path}: the request body was parsed before the ADT facade; mount it behind express.raw`);
      return;
    }
    // read off the stream here (or found empty), so the Node route that may
    // serve it next finds it where a raw parser would have put it: a parser
    // that skipped the request (a wildcard content type) left {} or nothing
    if (Buffer.isBuffer(req.body) === false && typeof req.body !== "string") req.body = body;
    const view = {method: req.method, headers: req.headers, url, path, body};
    const system = options.system ?? (() => undefined);
    let record;
    try {
      record = await withSystem((kind, name) => system(kind, name, req),
        () => options.step(async () => options.answer(view, await options.sessions?.sessionFor?.(req)),
          `ADT ${req.method} ${path}`),
        {store: options.store});
    } catch (e) {
      if (res.headersSent === true) return;
      // the ENQ session of the step ended while it waited for the work
      // process or in a WAIT (a logoff): the session is gone, and the answer
      // is the refusal a client logs on again after, not a dump
      if (e?.code === "ENQ_SESSION_ENDED") {
        res.status(403).set("x-csrf-token", "Required").type("text/plain; charset=utf-8").send("CSRF token validation failed");
        return;
      }
      const message = String(e?.message?.get?.() ?? e?.message ?? e);
      dumped(options.generation?.(), message);
      refuse(`${HANDLER}: ${message}`);
      return;
    }
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
        replay: () => replay(res, record, req.method, {sessionSent: true})});
    } catch (e) {
      console.error(`ADT continuation ${JSON.stringify(kind)} failed on ${req.method} ${path}: ${e?.stack ?? e?.message ?? e}`);
      if (res.headersSent !== true) refuse(`continuation ${JSON.stringify(kind)}: ${String(e?.message ?? e)}`);
    }
  };
}
