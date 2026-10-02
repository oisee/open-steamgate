// The ABAP front of the ADT façade (ADR 0007, slice 1): where the Node host
// hands a request under /sap/bc/adt to ZCL_OSD_ADT_HANDLER, if ABAP serves
// its route, and leaves it to the Node façade otherwise.
//
// The seam is one middleware inside adtRouter (tools/adt-facade.mjs), after
// the session middleware, the X-OSD-Generation stamp and the STG_ADT_DUMP
// capture, before the first route. docs/adt-abap-port/abap-skeleton.md is
// the design note.
//
// **Who serves a request is decided here, in JavaScript, before any ABAP
// runs.** The route table is ZCL_OSD_ADT_ROUTER=>ROUTES, read once through
// the host and matched by matchRoute below, which follows the same rules as
// the ABAP matcher (test/adt-abap-diff.mjs holds the two equal). A HOST row
// goes to next() at once: no work-process lock, no ABAP, so nothing that
// goes wrong in the ABAP -- a dump, a shim fault, a nested step -- can stand
// between a client and a route Node still serves. Only an ABAP row enters
// the step, and a failure there is answered as the Node façade answers one:
// the ADT exception document, 500, ExceptionInternalError in our namespace.
//
// The shim writes its answer straight onto an express response; here it
// writes onto a recorder, which is replayed onto the real response. The
// handler still marks what it does not serve with `X-OSD-Served-By: HOST`
// (on a system that is a 404); if the two tables ever disagree the front
// believes the handler and calls next().
import {withSystem} from "./osd-store-destination.mjs";

export const HANDLER = "ZCL_OSD_ADT_HANDLER";
export const SERVED_BY = "x-osd-served-by";
const BASE = "/sap/bc/adt";
const NAMESPACE = "org.open-steamgate.osd";

/** ZCL_OSD_ADT_ROUTER=>TT_ROUTE (or rows already in JS) as plain rows */
export function routeRows(table) {
  const rows = Array.isArray(table) ? table : table.array().map((row) => row.get());
  return rows.map((r) => Object.fromEntries(["method", "pattern", "handler", "served_by"]
    .map((k) => [k, typeof r[k]?.get === "function" ? String(r[k].get()) : String(r[k] ?? "")])));
}

const split = (path) => {
  // ABAP's SPLIT drops trailing empty fields, which is what makes one
  // trailing slash not matter; the same here
  const parts = String(path).split("/");
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
};

/** The first row that matches, or undefined: ZCL_OSD_ADT_ROUTER=>MATCH in
 *  JavaScript. Literal segments without case, `:name` one non-empty
 *  segment, a last `*` the rest, HEAD falls back to a GET row. */
export function matchRoute(rows, method, path) {
  const segments = split(path);
  for (const row of rows) {
    if (row.method !== "*" && row.method !== method && !(method === "HEAD" && row.method === "GET")) continue;
    const pattern = split(row.pattern);
    let match = true;
    for (let i = 0; i < pattern.length; i++) {
      if (i === pattern.length - 1 && pattern[i] === "*") break;
      const segment = segments[i];
      if (segment === undefined) { match = false; break; }
      if (pattern[i].length > 1 && pattern[i].startsWith(":")) {
        if (segment === "") { match = false; break; }
      } else if (pattern[i].toLowerCase() !== segment.toLowerCase()) {
        match = false;
        break;
      }
    }
    const rest = pattern[pattern.length - 1] === "*";
    if (match && (rest || segments.length === pattern.length)) return row;
  }
  return undefined;
}

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
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  return undefined;
}

/** {run, routes} for adtRouter's `abap` option, from the transpiled shim and
 *  router and the host's dialogStep: what test/start.mjs and the gate test
 *  both mount, said once. */
export function abapRunner({shim, router, step}) {
  return {
    // enter runs first inside the step, where a binding to the step (the
    // ENQ session) takes hold
    run: (args) => step(() => {
      args.enter?.();
      return shim.run({...args, base: new globalThis.abap.types.String().set(args.base)});
    },
      `ADT ${args.req.method} ${args.req.path}`),
    routes: () => step(async () => routeRows(await router.routes()), "ADT route table"),
  };
}

/** an express response as far as cl_express_icf_shim uses one */
function recorder() {
  const answer = {headers: [], body: Buffer.alloc(0)};
  answer.append = (name, value) => { answer.headers.push([String(name), String(value)]); return answer; };
  answer.status = (code) => { answer.code = code; return answer; };
  answer.send = (body) => { answer.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? "")); return answer; };
  return answer;
}

/**
 * @param {object} options
 * @param {Function} options.run the ICF runner: ({req, res, class, base}) => Promise
 * @param {Function} options.routes () => Promise of the route rows (routeRows)
 * @param {Function} options.refuse the façade's refusal: (res, status, type, message, options)
 * @param {Function} [options.system] (kind, name, req) => value: this façade's SYSTEM answers
 * @param {object} [options.store] this façade's ObjectStore, what OBJECT reads
 * @param {Function} [options.enter] (req) => void, run first inside the step:
 *   where the façade binds the step to the request's ENQ session
 * @param {Function} [options.ended] (res) => void: the answer when enter finds
 *   the session ended (EnqSessionEnded, code ENQ_SESSION_ENDED)
 * @param {Function} [options.served] (servedBy, req) => void, for a test or a log
 * @param {number} [options.retryMs] how long a failed route-table read waits before the next try (5000)
 */
export function abapFront(options) {
  const RETRY_MS = options.retryMs ?? 5000;
  // a read that fails (the generation not loaded yet, a hot swap in the way)
  // is not cached: Node serves every route meanwhile, and the table is asked
  // again after RETRY_MS, so a transient failure does not last the process
  let table;
  let failedAt = 0;
  const rows = () => {
    if (table === undefined && Date.now() - failedAt >= RETRY_MS) {
      table = Promise.resolve().then(options.routes).catch((e) => {
        table = undefined;
        failedAt = Date.now();
        console.error(`ADT front: the ABAP route table could not be read, Node serves every route for now: ${String(e?.message?.get?.() ?? e?.message ?? e)}`);
        return [];
      });
    }
    return table ?? Promise.resolve([]);
  };
  return async (req, res, next) => {
    // the full path, undecoded, whatever router prefix express has stripped
    const url = req.originalUrl ?? req.url;
    const path = url.split("?")[0];
    const row = matchRoute(await rows(), req.method, path);
    if (row?.served_by !== "ABAP") {
      options.served?.("HOST", req);
      next();
      return;
    }
    options.served?.("ABAP", req);
    const refuse = (message) => options.refuse(res, 500, "ExceptionInternalError", message, {namespace: NAMESPACE});
    const body = await bodyOf(req);
    if (body === undefined) {
      refuse(`${req.method} ${path}: the request body was parsed before the ADT facade; mount it behind express.raw`);
      return;
    }
    const view = {method: req.method, headers: req.headers, url, path, body};
    const answer = recorder();
    const system = options.system ?? (() => undefined);
    try {
      await withSystem((kind, name) => system(kind, name, req),
        () => options.run({req: view, res: answer, class: HANDLER, base: BASE, enter: () => options.enter?.(req)}),
        {store: options.store});
    } catch (e) {
      if (res.headersSent === true) return;
      // the session ended while the step waited (enter, before any ABAP):
      // answered as the façade answers a session that is gone
      if (e?.code === "ENQ_SESSION_ENDED" && options.ended !== undefined) options.ended(res);
      else refuse(`${HANDLER}: ${String(e?.message?.get?.() ?? e?.message ?? e)}`);
      return;
    }
    if (answer.headers.some(([name, value]) => name.toLowerCase() === SERVED_BY && value === "HOST")) {
      next();
      return;
    }
    res.status(answer.code ?? 200);
    for (const [name, value] of answer.headers) {
      // set, not append, for the one header express refuses as a list
      if (name.toLowerCase() === "content-type") res.set(name, value);
      else res.append(name, value);
    }
    // a body is sent, and on a HEAD express drops it and keeps its
    // Content-Length. An empty answer is ended, as the Node façade ends one
    // (`.end()`), unless it is typed and not a HEAD: the Node façade answers
    // that with `.type(t).send("")`, and express gives it an ETag (UNLOCK)
    const typed = answer.headers.some(([name]) => name.toLowerCase() === "content-type");
    if (answer.body.length === 0 && (typed === false || req.method === "HEAD")) res.end();
    else res.send(answer.body);
  };
}
