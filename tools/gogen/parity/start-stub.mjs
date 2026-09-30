// What test/start.mjs exports, for a suite whose server is external: the
// parity harness started it on STG_PORT already, so starting and closing are
// both nothing. A suite that reaches for the in-process ABAP runtime
// (globalThis.abap) then fails on both backends alike and drops out of the
// comparison, which is the intent: only what goes over HTTP is compared.
export function startServer() {
  const port = Number(process.env.STG_PORT ?? 3030);
  return {
    close(cb) { if (typeof cb === "function") cb(); return this; },
    closeAllConnections() {},
    address() { return {port, address: "127.0.0.1", family: "IPv4"}; },
    on() { return this; },
    once(ev, cb) { if (ev === "listening" && typeof cb === "function") setImmediate(cb); return this; },
    listening: true,
  };
}
