// The ABAP front of the ADT façade (ADR 0007, slice 1): where the Node host
// hands a request under /sap/bc/adt to ZCL_OSD_ADT_HANDLER first, and gives
// it to the Node façade when ABAP says the route is not its own.
//
// The seam is one middleware inside adtRouter (tools/adt-facade.mjs), after
// the session middleware, the X-OSD-Generation stamp and the STG_ADT_DUMP
// capture, before the first route. So in the mixed phase a ported route gets
// the same session cookies, CSRF token and generation header as every other
// route -- those move to ABAP in slice 2 -- and a capture still sees both
// sides. docs/adt-abap-port/abap-skeleton.md is the design note.
//
// `run` is the host's ICF runner -- cl_express_icf_shim.run under
// dialogStep, the same function mountServices takes -- passed in rather than
// imported, because adt-facade.mjs is loaded by processes with no ABAP in
// them (the child-mode parent) and the transpiled runtime belongs to whoever
// serves it.
//
// The shim writes its answer straight onto an express response. Here it
// writes onto a recorder instead, and the recorder is replayed onto the real
// response only when ABAP served the route. The handler marks a request it
// does not serve with `X-OSD-Served-By: HOST` (a 404 on a system, where no
// host stands behind it); that answer is dropped and `next()` runs the Node
// façade exactly as it ran before the front existed.
import {AsyncLocalStorage} from "node:async_hooks";
import {provideSystem} from "./osd-store-destination.mjs";

export const HANDLER = "ZCL_OSD_ADT_HANDLER";
export const SERVED_BY = "x-osd-served-by";
const BASE = "/sap/bc/adt";

// What the ABAP asks the host (ZOSD_STORE DESTINATION 'STORE', SYSTEM) is
// the answer of the façade instance whose request is running, not of the
// process: a test mounts several adtRouters with different options. The
// binding rides the async context of the call, through the work-process
// queue of dialogStep, to the destination.
const bound = new AsyncLocalStorage();
provideSystem((kind) => bound.getStore()?.system?.(kind));

/** an express response as far as cl_express_icf_shim uses one */
function recorder() {
  const answer = {status: 200, headers: [], body: Buffer.alloc(0)};
  answer.append = (name, value) => { answer.headers.push([String(name), String(value)]); return answer; };
  answer.status = (code) => { answer.code = code; return answer; };
  answer.send = (body) => { answer.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? "")); return answer; };
  return answer;
}

/**
 * @param {object} options
 * @param {Function} options.run the ICF runner: ({req, res, class, base}) => Promise
 * @param {Function} [options.system] (kind) => value: the SYSTEM answers of this façade
 * @param {Function} [options.served] (servedBy, req) => void, for a test or a log
 */
export function abapFront(options) {
  return async (req, res, next) => {
    // the request as the shim reads it: the full path, undecoded, whatever
    // router prefix express has stripped by now
    const url = req.originalUrl ?? req.url;
    const view = {
      method: req.method,
      headers: req.headers,
      url,
      path: url.split("?")[0],
      // a body only when the host already buffered one (express.raw); the
      // stream is left alone, so a route that reads it still can
      body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
    };
    const answer = recorder();
    try {
      await bound.run({system: options.system},
        () => options.run({req: view, res: answer, class: HANDLER, base: BASE}));
    } catch (e) {
      if (res.headersSent === false) {
        res.status(500).type("text/plain").send(`${HANDLER}: ${String(e?.message?.get?.() ?? e?.message ?? e)}`);
      }
      return;
    }
    const host = answer.headers.some(([name, value]) => name.toLowerCase() === SERVED_BY && value === "HOST");
    options.served?.(host ? "HOST" : "ABAP", req);
    if (host) {
      next();
      return;
    }
    res.status(answer.code ?? 200);
    for (const [name, value] of answer.headers) {
      // set, not append, for the one header express refuses as a list
      if (name.toLowerCase() === "content-type") res.set(name, value);
      else res.append(name, value);
    }
    // an empty answer is ended, as the Node façade ends one; a body is sent,
    // and on a HEAD express drops it and keeps its Content-Length
    if (answer.body.length === 0) res.end();
    else res.send(answer.body);
  };
}
