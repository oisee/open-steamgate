// SPDX-License-Identifier: MIT
// One host for OSD's built-in DIAG tape screen and RFC-to-ADT bridge.
import {pathToFileURL} from "node:url";
import {listenDiagTape} from "./diag-server.mjs";
import {createRfcAdtServer} from "./rfc-server.mjs";

const connections = new WeakMap();

function track(server) {
  const sockets = new Set();
  connections.set(server, sockets);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
}

function instance(value) {
  if (!/^\d{2}$/.test(value)) throw new Error("INSTANCE must be two digits");
  return value;
}

export async function listenProtocols(env = process.env) {
  const id = instance(env.INSTANCE ?? "00");
  const diagPort = Number(env.STG_DIAG_PORT ?? `32${id}`);
  const rfcPort = Number(env.STG_RFC_PORT ?? `33${id}`);
  const backend = env.STG_ADT_BACKEND ?? `http://127.0.0.1:${env.STG_PORT ?? 3030}`;
  const diag = await listenDiagTape({
    port: diagPort,
    host: env.STG_DIAG_HOST ?? "0.0.0.0",
    logger: (event, peer, error) => {
      if (error) console.error(`diag ${event} ${peer}: ${error.message}`);
    },
  });
  track(diag);
  const rfcBridge = createRfcAdtServer({
    backend,
    backendUser: env.STG_ADT_USER,
    backendPassword: env.STG_ADT_PASSWORD,
    backendClient: env.STG_ADT_CLIENT,
    backendLanguage: env.STG_ADT_LANGUAGE,
    rfcAuthMode: env.STG_RFC_AUTH_MODE ?? "demo",
    rfcUser: env.STG_RFC_USER,
    rfcPassword: env.STG_RFC_PASSWORD,
    rfcClient: env.STG_RFC_CLIENT,
    systemID: env.STG_SYSTEM_ID ?? env.OSD_SID ?? "OSD",
    systemHost: env.STG_HOST_NAME ?? "osd-bridge",
    host: env.STG_RFC_HOST ?? "0.0.0.0",
    port: rfcPort,
    log: (event) => console.error(JSON.stringify(event)),
  });
  track(rfcBridge.server);
  try {
    await rfcBridge.listen();
  } catch (error) {
    await closeProtocols({diag});
    throw error;
  }
  console.error(`OSD JS protocols: DIAG ${diag.address().port}; RFC ${rfcBridge.server.address().port} -> ${backend}`);
  return {diag, rfc: rfcBridge.server};
}

export async function closeProtocols(servers, {graceMs = 5000} = {}) {
  const closed = Promise.all(Object.values(servers).map((server) => new Promise((resolve) => server.close(resolve))));
  let timer;
  const graceful = await Promise.race([
    closed.then(() => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), graceMs); }),
  ]);
  clearTimeout(timer);
  if (!graceful) {
    for (const server of Object.values(servers)) {
      for (const socket of connections.get(server) ?? []) socket.destroy();
    }
    await closed;
  }
}

export async function main(env = process.env) {
  const servers = await listenProtocols(env);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await closeProtocols(servers);
  };
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
    close().then(() => process.exit(0), (error) => {
      console.error(error);
      process.exit(1);
    });
  });
  return servers;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
