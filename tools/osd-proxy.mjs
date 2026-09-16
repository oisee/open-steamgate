// Forwarding the OData front to the process that actually serves it.
//
// The listener a client points at is the façade's: it holds the store, the
// parse and the ADT surface, and it must not restart, because restarting it
// takes the developer's own session down with it. The code a client
// activates only becomes live in a process that has not imported the old
// modules, so the OData runtime lives in a child that can be thrown away
// (tools/osd-runtime.mjs). This carries a request across that seam.
//
// What it is not: a general-purpose proxy. It forwards one prefix to one
// address on the loopback, which is why there is no host allow-list and no
// header filtering beyond the hop-by-hop set. Anything else belongs in the
// façade, not here.

import {request} from "node:http";
import {connect} from "node:net";

// headers that describe this connection rather than this message, and so
// must not be copied onto the next one
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
]);

function forwardable(headers, body) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (HOP_BY_HOP.has(name.toLowerCase()) || value === undefined) {
      continue;
    }
    out[name] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  // The Host stays, and it is the client's, not the child's.
  //
  // OData builds absolute self-links: every __metadata.uri, every next link
  // and every navigation link is made from the Host the request carried. The
  // child answers on an ephemeral loopback port that exists only between
  // these two processes, so letting it see its own address puts a port
  // nobody dialled into every link of every payload. Forwarding the address
  // the client actually used is what makes the seam invisible, which is the
  // whole job here.
  // the body may have been re-read into a Buffer, so the length is ours to
  // state rather than the client's to be trusted about
  if (body === undefined) {
    delete out["content-length"];
  } else {
    out["content-length"] = String(body.length);
  }
  return out;
}

// One request, forwarded and answered. `runtime` is a ServingRuntime; the
// wait for it is the caller's business, because a proxy that starts a
// process behind a request's back is a proxy that hides a crash.
//
// node:http rather than fetch, for one reason that is not style: fetch
// treats Host as a forbidden header and silently replaces it with the
// address it dialled. That puts the child's ephemeral port into every
// absolute link OData builds, which is the one thing this must not do.
export function forward(runtime, req, res) {
  const url = runtime.url;
  if (url === undefined) {
    return Promise.reject(new NotForwardable("no serving runtime is up"));
  }
  const generation = runtime.generation;
  const body = req.method === "GET" || req.method === "HEAD" ? undefined
    : (Buffer.isBuffer(req.body) ? req.body : undefined);

  return new Promise((resolve, reject) => {
    const forwarded = request({
      hostname: "127.0.0.1",
      port: Number(new URL(url).port),
      path: req.originalUrl,
      method: req.method,
      headers: forwardable(req.headers, body),
    }, (answer) => {
      res.status(answer.statusCode ?? 502);
      for (const [name, value] of Object.entries(answer.headers)) {
        if (HOP_BY_HOP.has(name.toLowerCase()) || value === undefined) {
          continue;
        }
        res.setHeader(name, value);
      }
      // which runtime answered, so a client that cares can tell whether the
      // code it activated is the code that replied. Cheap, and it is the
      // difference between a receipt and a hope.
      if (generation !== undefined) {
        res.setHeader("x-osd-generation", String(generation));
      }
      answer.pipe(res);
      answer.on("end", resolve);
      answer.on("error", reject);
    });
    forwarded.on("error", reject);
    if (body === undefined) {
      forwarded.end();
    } else {
      forwarded.end(body);
    }
  });
}

export class NotForwardable extends Error {
  constructor(message) {
    super(message);
    this.code = "NOT_FORWARDABLE";
  }
}

// The express handler: make sure something is serving, then forward to it.
//
// `ensure()` rather than `whenReady()` on purpose. A request arriving during
// a recycle should wait the second it takes rather than fail, and one
// arriving after a crash should get a runtime rather than an explanation.
// The crash is still not hidden: the generation in the answer is a new one,
// and the supervisor keeps what killed the last one.
export function odataProxy(runtime, options = {}) {
  return async function (req, res) {
    try {
      await runtime.ensure();
      await forward(runtime, req, res);
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      // the same shape the in-process front answers a runtime failure with,
      // so a client cannot tell which of the two it was talking to
      const died = runtime.died;
      const detail = died === undefined ? String(e?.message ?? e)
        : `${e?.message ?? e} (last runtime exited ${died.signal ?? died.code})`;
      res.status(503).type("application/json").send(JSON.stringify({
        error: {code: "STG/NOT_SERVING", message: {lang: "en", value: detail}},
      }));
      console.error("OData proxy:", detail);
    }
  };
}

// A websocket upgrade forwarded to the child, byte for byte. The parent
// only decides whether the path is a declared channel and whether a runtime
// is up; from the first frame on, the two sockets are piped and the child's
// handler is the one talking. Nothing here parses a frame.
export function upgradeProxy(runtime, paths, log = () => {}) {
  const known = new Set(paths.map((p) => p.replace(/\/+$/, "")));
  return async (req, socket, head) => {
    const path = req.url.split("?")[0].replace(/\/+$/, "");
    if (!known.has(path)) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    try {
      await runtime.ensure();
    } catch (e) {
      log(`APC ${path}: no serving runtime (${e?.message ?? e})`);
      socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      return;
    }
    const port = Number(new URL(runtime.url).port);
    const upstream = connect(port, "127.0.0.1", () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (const [name, value] of Object.entries(req.headers)) {
        lines.push(`${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
      }
      upstream.write(lines.join("\r\n") + "\r\n\r\n");
      if (head !== undefined && head.length > 0) {
        upstream.write(head);
      }
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on("error", (e) => {
      log(`APC ${path}: upstream ${e?.message ?? e}`);
      socket.destroy();
    });
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
  };
}
