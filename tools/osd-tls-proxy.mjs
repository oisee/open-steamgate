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
import {request as httpRequest} from "node:http";
import {request as httpsRequest} from "node:https";
import {credentials, exists, generate, fingerprint} from "./osd-tls.mjs";

export function startProxy(options = {}) {
  const target = new URL(options.target);
  const forward = target.protocol === "https:" ? httpsRequest : httpRequest;
  const tls = options.credentials ?? credentials();
  if (tls === undefined) {
    throw new Error("no certificate: run `npm run osd:tls` first");
  }

  const server = createHttpsServer(tls, (req, res) => {
    const headers = {...req.headers, host: target.host};
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
      answer.pipe(res);
    });
    upstream.on("error", (e) => {
      if (res.headersSent === false) {
        res.writeHead(502, {"content-type": "text/plain"});
      }
      res.end(`the far end did not answer: ${e?.message ?? e}`);
    });
    req.pipe(upstream);
  });

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

  return server.listen(options.port ?? 44300);
}

if (process.argv[1]?.endsWith("osd-tls-proxy.mjs")) {
  const arg = (name, fallback) => {
    const at = process.argv.indexOf("--" + name);
    return at === -1 ? fallback : process.argv[at + 1];
  };
  const target = arg("target");
  if (target === undefined) {
    console.error("usage: node tools/osd-tls-proxy.mjs --target http://host:port [--port 44300]");
    process.exit(2);
  }
  if (exists() === false) {
    generate();
  }
  const port = Number(arg("port", 44300));
  startProxy({target, port});
  console.log(`https://localhost:${port}  ->  ${target}`);
  console.log(`self-signed, sha256 ${fingerprint()}`);
  console.log("a client will ask once whether to trust it; .local/tls/osd.crt is the certificate to import");
}
