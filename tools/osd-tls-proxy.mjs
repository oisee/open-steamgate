// TLS in front of something that only speaks plain HTTP.
//
// Eclipse refuses an ABAP project over http, full stop, and that refusal
// happens in the client before a single request is made. OSD itself serves
// HTTPS, so it needs none of this; a system that does not is the case here.
//
// It terminates TLS with OSD's self-signed certificate and forwards
// everything unchanged, headers, body, method and status, so it is a wire
// adapter and not a gateway: nothing is interpreted, nothing is cached, and
// the only header it rewrites is Host, because the far end expects its own.
//
// Usage:
//   node tools/osd-tls-proxy.mjs --target http://host:port [--port 44300]
//
// The target is given on the command line and never written down here: this
// repository is public and the systems we talk to are not.
import {createServer as createHttpsServer} from "node:https";
import {createServer as createHttpServer, request as httpRequest} from "node:http";
import {createWriteStream} from "node:fs";
import {request as httpsRequest} from "node:https";
import {credentials, exists, generate, fingerprint} from "./osd-tls.mjs";
import {basename} from "node:path";

// What went over this wire, one JSON line per exchange.
//
// A proxy that forwards and remembers nothing is fine as an adapter and
// useless as an instrument. The reason this exists: when a client is
// expected to speak HTTP here and speaks it somewhere else instead, an
// empty capture and a capture that was never taken look identical, and the
// difference is the whole answer. So the file says how many exchanges
// crossed, even when the answer is none.
//
// Bodies are kept up to `dumpMax` bytes and the line says when it truncated.
// Nothing is interpreted; this is a wire log.
function recorder(path, dumpMax) {
  if (path === undefined) {
    return undefined;
  }
  const file = createWriteStream(path, {flags: "a"});
  let seen = 0;
  let issued = 0;
  const keep = (chunks, total) => {
    const body = Buffer.concat(chunks);
    return {
      bytes: total,
      truncated: total > body.length,
      // text where it is text, base64 where it is not: a captured PNG in a
      // log is noise, a captured XML document is the evidence
      base64: body.toString("base64"),
    };
  };
  return {
    get count() {
      return seen;
    },
    // A number taken when the request arrives, not when the answer finishes.
    //
    // The line is written at the end of the response, so the order of lines
    // is the order things *finished*. With a client that has several requests
    // in flight — a long poll beside a tree expansion — that is not the order
    // it sent them, and a replay built from the file would reorder the
    // session without saying so. The sequence is the send order; the file
    // stays append-ordered.
    begin() {
      issued += 1;
      return {seq: issued, startedAt: new Date().toISOString(), started: process.hrtime.bigint()};
    },
    write(entry, opened) {
      seen += 1;
      const finished = new Date().toISOString();
      file.write(JSON.stringify({
        at: finished,
        seq: opened?.seq,
        startedAt: opened?.startedAt,
        endedAt: finished,
        ms: opened?.started === undefined
          ? undefined
          : Number((process.hrtime.bigint() - opened.started) / 1000000n),
        conn: opened?.conn,
        backend: this.backend,
        ...entry,
      }) + "\n");
    },
    keep,
    limit: dumpMax,
  };
}

export function startProxy(options = {}) {
  const target = new URL(options.target);
  const forward = target.protocol === "https:" ? httpsRequest : httpRequest;
  const log = options.recorder ?? recorder(options.dump, options.dumpMax ?? 65536);

  // Which build of the far end this capture is of.
  //
  // A capture without it is a record of some version of something, and the
  // question "does the deployed system still do this" cannot be answered from
  // it — which is exactly the question an audit of an old corpus runs into.
  // Asked once, at startup, on the one resource that answers it; a far end
  // that has no such resource records nothing rather than a guess.
  if (log !== undefined) {
    const probe = target.protocol === "https:" ? httpsRequest : httpRequest;
    const ask = probe({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: "GET",
      path: "/sap/bc/adt/core/http/build",
      headers: {host: target.host, accept: "application/json"},
      rejectUnauthorized: options.verify === true,
      timeout: 5000,
    }, (answer) => {
      const chunks = [];
      answer.on("data", (chunk) => chunks.push(chunk));
      answer.on("end", () => {
        if (answer.statusCode !== 200) {
          return;
        }
        try {
          log.backend = JSON.parse(Buffer.concat(chunks).toString("utf8")).build;
        } catch {
          // an answer that is not the stamp is not a stamp
        }
      });
      answer.on("error", () => {});
    });
    ask.on("error", () => {});
    ask.on("timeout", () => ask.destroy());
    ask.end();
  }

  const handle = (req, res) => {
    // Taken first, before anything can await: this is the moment the request
    // arrived.
    const opened = log === undefined ? undefined : log.begin();
    if (opened !== undefined) {
      // Which connection it came in on, so that requests in flight together
      // can be told from requests that merely overlap in the file.
      opened.conn = req.socket?.osdConnectionId;
    }
    const headers = {...req.headers, host: target.host};
    const inBody = [];
    let inBytes = 0;
    if (log !== undefined) {
      req.on("data", (chunk) => {
        inBytes += chunk.length;
        const room = log.limit === 0 ? chunk.length : log.limit - inBody.reduce((n, c) => n + c.length, 0);
        if (room > 0) {
          inBody.push(chunk.subarray(0, room));
        }
      });
    }
    const upstream = forward({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: req.url,
      headers,
      // the far end may itself be a self-signed system; this is a local
      // adapter a person pointed at a host on purpose, not a browser
      rejectUnauthorized: options.verify === true,
    }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      if (log === undefined) {
        answer.pipe(res);
        return;
      }
      const out = [];
      let outBytes = 0;
      answer.on("data", (chunk) => {
        outBytes += chunk.length;
        const room = log.limit === 0 ? chunk.length : log.limit - out.reduce((n, c) => n + c.length, 0);
        if (room > 0) {
          out.push(chunk.subarray(0, room));
        }
      });
      answer.on("end", () => log.write({
        method: req.method,
        url: req.url,
        request: {headers: req.headers, body: log.keep(inBody, inBytes)},
        response: {status: answer.statusCode, headers: answer.headers, body: log.keep(out, outBytes)},
      }, opened));
      // A reset partway through an answer has no 502 to give: the status is
      // already sent. Ending the response is all that is left, and the point
      // is that the process survives to serve the next request.
      answer.on("error", () => res.destroy());
      answer.pipe(res);
    });
    upstream.on("error", (e) => {
      // An exchange that failed is still an exchange, and it used to leave no
      // line at all — so a capture showed a gap where a client had seen an
      // error, and a replay would have no reason to expect one.
      if (log !== undefined) {
        log.write({
          method: req.method,
          url: req.url,
          request: {headers: req.headers, body: log.keep(inBody, inBytes)},
          error: String(e?.message ?? e),
        }, opened);
      }
      if (res.headersSent === false) {
        res.writeHead(502, {"content-type": "text/plain"});
      }
      res.end(`the far end did not answer: ${e?.message ?? e}`);
    });
    // A client that walks away mid-request, which Eclipse does routinely when
    // it cancels a long poll.
    req.on("error", () => upstream.destroy());
    res.on("error", () => upstream.destroy());
    req.pipe(upstream);
  };

  const server = options.plain === true
    ? createHttpServer(handle)
    : createHttpsServer(tlsOrThrow(options), handle);

  // an ADT client may open a websocket for its push channel; without this
  // the connection is refused rather than forwarded
  // Nothing a peer does may take this process down.
  //
  // It went down for exactly that: the backend was restarted, the forwarded
  // socket reset, and an unhandled ECONNRESET on a stream nobody was
  // listening to killed the proxy. A debugging instrument that dies when the
  // thing it is watching hiccups is worse than no instrument, because it
  // fails silently and the next reading is simply absent — and it had already
  // cost one confusing "502 Bad Gateway" in a live session before anybody
  // looked at its log.
  server.on("clientError", (error, socket) => {
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    }
    socket.destroy();
  });
  server.on("tlsClientError", (error, socket) => socket.destroy());
  // One id per connection, so that "these two requests were in flight at the
  // same time" can be told from "these two lines are next to each other".
  let connections = 0;
  const mark = (socket) => {
    connections += 1;
    socket.osdConnectionId = connections;
    socket.on("error", () => socket.destroy());
  };
  server.on("connection", mark);
  server.on("secureConnection", mark);

  server.on("upgrade", (req, socket, head) => {
    const headers = {...req.headers, host: target.host};
    const upstream = forward({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: req.url,
      headers,
      rejectUnauthorized: options.verify === true,
    });
    upstream.on("upgrade", (answer, upstreamSocket, upstreamHead) => {
      socket.write(`HTTP/1.1 101 ${answer.statusMessage ?? "Switching Protocols"}\r\n` +
        Object.entries(answer.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n");
      if (upstreamHead?.length > 0) {
        socket.unshift(upstreamHead);
      }
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstream.on("error", () => socket.destroy());
    if (head?.length > 0) {
      upstream.write(head);
    }
    upstream.end();
  });

  server.osdRecorder = log;
  return server.listen(options.port ?? 44300);
}

function tlsOrThrow(options) {
  const tls = options.credentials ?? credentials();
  if (tls === undefined) {
    throw new Error("no certificate: run `npm run osd:tls` first");
  }
  return tls;
}

if (basename(process.argv[1] ?? "") === "osd-tls-proxy.mjs") {
  const arg = (name, fallback) => {
    const at = process.argv.indexOf("--" + name);
    return at === -1 ? fallback : process.argv[at + 1];
  };
  const target = arg("target");
  if (target === undefined) {
    console.error("usage: node tools/osd-tls-proxy.mjs --target http://host:port [--port 44300]");
    console.error("                                   [--plain] [--dump file.jsonl] [--dump-max 65536]");
    process.exit(2);
  }
  const plain = process.argv.includes("--plain");
  if (plain === false && exists() === false) {
    generate();
  }
  const port = Number(arg("port", plain ? 8000 : 44300));
  const dump = arg("dump");
  const server = startProxy({target, port, plain, dump, dumpMax: Number(arg("dump-max", 65536))});
  console.log(`${plain ? "http" : "https"}://localhost:${port}  ->  ${target}`);
  if (plain === false) {
    console.log(`self-signed, sha256 ${fingerprint()}`);
    console.log("a client will ask once whether to trust it; .local/tls/osd.crt is the certificate to import");
  }
  if (dump !== undefined) {
    console.log(`recording to ${dump}`);
    // the count on the way out, because "nothing crossed this wire" has to
    // be something the instrument says rather than something absent from it
    const said = () => {
      console.log(`${server.osdRecorder?.count ?? 0} exchanges crossed ${plain ? "http" : "https"}:${port}`);
      process.exit(0);
    };
    process.on("SIGINT", said);
    process.on("SIGTERM", said);
  }
}
