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

/** the startup hint for a loopback-only binding, or undefined */
export function bindHint(env = process.env) {
  const host = bindHost(env);
  return host === LOOPBACK || host === "::1"
    ? "listening on localhost only; for the network set OSD_BIND=0.0.0.0"
    : undefined;
}

const INSTALLED = Symbol("osd-bind");

/**
 * Listen `server` (http, https, net) on `port` at the configured host. With
 * the loopback default, ::1 is opened as well each time the server starts
 * listening (on its actual port, so port 0 works): a plain net listener that
 * hands each connection to `server`, so requests, TLS and upgrades are
 * answered by the one server and its handlers. ::1 is best effort: a host
 * without IPv6 just has the IPv4 loopback.
 *
 * Idempotent across close and listen: `server.close(cb)` closes the twin as
 * well and calls back once both have closed (the twin waits for its own
 * connections, like the primary), and a later `listen` -- relisten() or a
 * plain server.listen -- opens a fresh twin. Returns `server`.
 */
export function listenBound(server, port, env = process.env, callback) {
  install(server, env);
  return server.listen(port, bindHost(env), callback);
}

/** for a re-listen after close or EADDRINUSE: the same host, a fresh twin */
export function relisten(server, port, env = process.env, callback) {
  install(server, env);
  return server.listen(port, bindHost(env), callback);
}

function install(server, env) {
  if (server[INSTALLED] !== undefined) {
    server[INSTALLED].env = env;
    return;
  }
  const state = {env, twin: undefined, closing: undefined, open: new Set()};
  server[INSTALLED] = state;

  // One connection limit for both sockets. net.Server enforces
  // maxConnections per listener, so the twin would add a second allowance
  // (the RFC bridge's 64 would be 128). Every connection of either socket
  // reaches the server as a "connection" event, so it is counted there,
  // before any listener sees it, and one past the limit is dropped the way
  // net drops it: closed, and a "drop" event.
  const emit = server.emit;
  server.emit = function (event, socket, ...rest) {
    if (event === "connection" && socket !== undefined && typeof socket.once === "function") {
      const limit = server.maxConnections;
      if (Number.isInteger(limit) && limit > 0 && state.open.size >= limit) {
        emit.call(this, "drop", {localAddress: socket.localAddress, localPort: socket.localPort,
          remoteAddress: socket.remoteAddress, remotePort: socket.remotePort, remoteFamily: socket.remoteFamily});
        socket.destroy();
        return false;
      }
      state.open.add(socket);
      socket.once("close", () => state.open.delete(socket));
    }
    return emit.call(this, event, socket, ...rest);
  };

  const openTwin = () => {
    if (!isLoopbackDefault(state.env) || state.twin !== undefined || state.closing !== undefined) return;
    const actual = server.address()?.port;
    const twin = createServer((socket) => server.emit("connection", socket));
    state.twin = twin;
    twin.on("error", (error) => {
      // no IPv6 on this host, or ::1 taken by somebody else: the IPv4
      // loopback stands, and a client resolving localhost falls back to it
      if (!["EADDRNOTAVAIL", "EAFNOSUPPORT", "EADDRINUSE"].includes(error?.code)) {
        console.error(`::1 listener on ${actual}: ${error?.message ?? error}`);
      }
      if (state.twin === twin) state.twin = undefined;
    });
    twin.listen(actual, "::1");
    twin.unref?.();
  };
  server.on("listening", openTwin);

  // One close for both sockets, shared by every caller: a second close(cb)
  // while the first is still draining waits for the same end instead of
  // asking the primary again (which answers "not running" at once while
  // ::1 connections are still open).
  const close = server.close.bind(server);
  server.close = (cb) => {
    if (state.closing === undefined) {
      const twin = state.twin;
      state.closing = Promise.all([
        twin?.listening ? new Promise((resolve) => twin.close(() => resolve())) : (twin?.close(), Promise.resolve()),
        new Promise((resolve) => close((error) => resolve(error))),
      ]).then(([, error]) => {
        if (state.twin === twin) state.twin = undefined;
        state.closing = undefined;
        // listened again while this was draining: give it its twin now
        if (server.listening) openTwin();
        return error;
      });
    }
    if (typeof cb === "function") state.closing.then((error) => cb(error));
    return server;
  };
}
