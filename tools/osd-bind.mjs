// SPDX-License-Identifier: MIT
// Which address the system listens on, said once.
//
//   OSD_BIND unset (or "localhost")  loopback only: 127.0.0.1, plus ::1 when
//                                    the host has IPv6, so a client that
//                                    resolves `localhost` to ::1 (Node 17+
//                                    keeps the OS order) still connects
//   OSD_BIND=0.0.0.0                 every IPv4 interface (containers)
//   OSD_BIND=::                      every interface, IPv4 and IPv6
//   OSD_BIND=<address>               that address only
//
// Loopback is the default because the system has no real logon: the ADT
// facade accepts any credentials and the RFC bridge runs in demo mode, which
// is only honest when nothing but this machine can reach them. A container
// sets OSD_BIND=0.0.0.0 (docker/), because a published port arrives on the
// container's own interface, never on its loopback.
//
// Every listener of the system asks here: the HTTP and HTTPS fronts of
// test/start.mjs (push channels ride on the HTTP one), the DIAG and RFC
// listeners of tools/protocols/server.mjs, and the dev proxies. The serving
// child of tools/osd-serve.mjs stays on 127.0.0.1 whatever this says: it is
// the front's internal hop and nobody else's door. OSGo reads the same
// variable in tools/gogen/go/cmd/osgo (selectedBind).
import {createServer} from "node:net";

export const LOOPBACK = "127.0.0.1";

/** the host to bind, from OSD_BIND; "localhost" and unset are loopback */
export function bindHost(env = process.env) {
  const value = String(env.OSD_BIND ?? "").trim();
  return value === "" || value.toLowerCase() === "localhost" ? LOOPBACK : value;
}

/** true when the binding is the loopback default, which gets the ::1 twin */
export function isLoopbackDefault(env = process.env) {
  return bindHost(env) === LOOPBACK && String(env.OSD_BIND ?? "").trim() !== LOOPBACK;
}

/** the addresses a listener ends up on, for a log line or a status field */
export function bindAddresses(env = process.env) {
  return isLoopbackDefault(env) ? [LOOPBACK, "::1"] : [bindHost(env)];
}

/** "127.0.0.1, ::1" -- for a log line */
export function describeBind(env = process.env) {
  return bindAddresses(env).join(", ");
}

/**
 * Listen `server` (http, https, net) on `port` at the configured host. With
 * the loopback default, ::1 is opened as well once the first listener is up
 * (on its actual port, so port 0 works): a plain net listener that hands each
 * connection to `server`, so requests, TLS and upgrades are answered by the
 * one server and its handlers. ::1 is best effort: a host without IPv6 just
 * has the IPv4 loopback. Returns `server`; `server.close` closes the twin too.
 */
export function listenBound(server, port, env = process.env, callback) {
  const host = bindHost(env);
  let twin;
  if (isLoopbackDefault(env)) {
    server.once("listening", () => {
      const actual = server.address()?.port ?? port;
      twin = createServer({pauseOnConnect: false}, (socket) => server.emit("connection", socket));
      twin.on("error", (error) => {
        // no IPv6 on this host, or ::1 taken by somebody else: the IPv4
        // loopback stands, and a client resolving localhost falls back to it
        if (!["EADDRNOTAVAIL", "EAFNOSUPPORT", "EADDRINUSE"].includes(error?.code)) {
          console.error(`::1 listener on ${actual}: ${error?.message ?? error}`);
        }
        twin = undefined;
      });
      twin.listen(actual, "::1");
      twin.unref?.();
    });
    const close = server.close.bind(server);
    server.close = (...args) => {
      twin?.close();
      twin = undefined;
      return close(...args);
    };
  }
  return server.listen(port, host, callback);
}

/** for a re-listen after EADDRINUSE: the same host, no second twin */
export function relisten(server, port, env = process.env) {
  return server.listen(port, bindHost(env));
}
