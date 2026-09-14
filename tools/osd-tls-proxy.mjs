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
    write(entry) {
      seen += 1;
      file.write(JSON.stringify({at: new Date().toISOString(), ...entry}) + "\n");
    },
    keep,
    limit: dumpMax,
  };
}

export function startProxy(options = {}) {
  const target = new URL(options.target);
  const forward = target.protocol === "https:" ? httpsRequest : httpRequest;
  const log = options.recorder ?? recorder(options.dump, options.dumpMax ?? 65536);

  const handle = (req, res) => {
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
      }));
      answer.pipe(res);
    });
    upstream.on("error", (e) => {
      if (res.headersSent === false) {
        res.writeHead(502, {"content-type": "text/plain"});
      }
      res.end(`the far end did not answer: ${e?.message ?? e}`);
    });
    req.pipe(upstream);
  };

  const server = options.plain === true
    ? createHttpServer(handle)
    : createHttpsServer(tlsOrThrow(options), handle);

  // an ADT client may open a websocket for its push channel; without this
  // the connection is refused rather than forwarded
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

if (process.argv[1]?.endsWith("osd-tls-proxy.mjs")) {
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
