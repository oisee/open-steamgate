// Forward a list of TCP ports to one host, and say who knocked.
//
// The reason this exists rather than a shell one-liner: when a client fails
// to connect and every capture is empty, "it used a port we do not forward"
// and "it never tried at all" look identical. So this logs the connection
// itself — the moment, the port, the peer and the bytes each way — before it
// logs anything about content. A port nobody touched and a port that
// answered nothing are then different lines.
//
// Plain TCP on purpose: it carries TLS, DIAG and RFC alike without
// understanding any of them, which is what makes it safe to point at
// everything at once.
//
//   node tools/osd-tcp-forward.mjs --host 10.0.0.1 --ports 3200,3300,50001 [--dump file.jsonl]
//
// The host is given on the command line and never written down here: this
// repository is public and the systems we talk to are not.
import {createServer, connect} from "node:net";
import {createWriteStream} from "node:fs";
import {basename} from "node:path";

export function forwardPorts({host, ports, dump, onEvent}) {
  const file = dump === undefined ? undefined : createWriteStream(dump, {flags: "a"});
  const seen = new Map(ports.map((p) => [p, 0]));
  const say = (entry) => {
    const line = {at: new Date().toISOString(), ...entry};
    file?.write(JSON.stringify(line) + "\n");
    onEvent?.(line);
  };

  const servers = ports.map((port) => {
    const server = createServer((client) => {
      seen.set(port, seen.get(port) + 1);
      const peer = `${client.remoteAddress}:${client.remotePort}`;
      say({event: "open", port, peer});
      let up = 0;
      let down = 0;
      const upstream = connect({host, port});
      client.on("data", (chunk) => { up += chunk.length; });
      upstream.on("data", (chunk) => { down += chunk.length; });
      const done = (why) => {
        if (client.destroyed && upstream.destroyed) {
          return;
        }
        say({event: "close", port, peer, up, down, why});
        client.destroy();
        upstream.destroy();
      };
      upstream.on("error", (e) => done(`upstream: ${e.message}`));
      client.on("error", (e) => done(`client: ${e.message}`));
      client.on("end", () => done("client ended"));
      upstream.on("end", () => done("upstream ended"));
      client.pipe(upstream);
      upstream.pipe(client);
    });
    server.on("error", (e) => say({event: "listen failed", port, why: e.message}));
    server.listen(port, "0.0.0.0");
    return server;
  });

  return {servers, seen};
}

if (basename(process.argv[1] ?? "") === "osd-tcp-forward.mjs") {
  const arg = (name, fallback) => {
    const at = process.argv.indexOf("--" + name);
    return at === -1 ? fallback : process.argv[at + 1];
  };
  const host = arg("host");
  const ports = (arg("ports") ?? "").split(",").filter((p) => p !== "").map(Number);
  if (host === undefined || ports.length === 0) {
    console.error("usage: node tools/osd-tcp-forward.mjs --host <host> --ports 3200,3300 [--dump file.jsonl]");
    process.exit(2);
  }
  const {seen} = forwardPorts({host, ports, dump: arg("dump"), onEvent: (e) => console.log(JSON.stringify(e))});
  console.log(`forwarding ${ports.join(", ")} -> ${host}`);
  const verdict = () => {
    console.log("connections per port:");
    for (const [port, count] of seen) {
      console.log(`  ${port}: ${count}`);
    }
    process.exit(0);
  };
  process.on("SIGINT", verdict);
  process.on("SIGTERM", verdict);
}
