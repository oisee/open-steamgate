// The service worker of the OSGo preview: OSGo compiled to wasm answers
// every request below <mount>/sap/, as the net/http server answers them on a
// port; everything else (the Fiori apps, the launchpad) is a file of the
// static host. The shape is web/preview-worker.mjs, with Go in the place of
// the transpiler's runtime (tools/gogen/wasm-preview.mjs builds it).
//
// A classic script: importScripts during the first evaluation is the one way
// a worker takes Go's loader and sql.js, both of which are classic scripts.
/* global Go, initSqlJs */
importScripts("wasm_exec.js", "sql-wasm.js");

const MOUNT = new URL("./", self.location).pathname;
const BUILD_ID = "__OSGO_BUILD_ID__";
const PREFIXES = ["sap/"];
const DATABASE_CACHE = "osgo-preview-database";
const DATABASE_KEY = `${MOUNT}__osgo/database`;
const RESET_PATH = "__osgo/reset";
const INFO_PATH = "__osgo/info";
const EMPTY_STATUSES = new Set([204, 205, 304]);

let started;
let info = {};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(MOUNT)) return;
  const path = url.pathname.slice(MOUNT.length);
  if (path !== RESET_PATH && path !== INFO_PATH && !PREFIXES.some((p) => path.startsWith(p))) return;
  event.respondWith(serve(event.request, url, path));
});

async function serve(request, url, path) {
  try {
    if (path === INFO_PATH) {
      await start();
      return new Response(JSON.stringify({buildId: BUILD_ID, ...info}), {headers: {"content-type": "application/json", "cache-control": "no-store"}});
    }
    if (path === RESET_PATH) {
      await caches.delete(DATABASE_CACHE);
      started = undefined;
      return new Response("reset: the next request starts OSGo on a fresh seed; reload the page", {headers: {"content-type": "text/plain"}});
    }
    const osgo = await start();
    const mutation = request.method !== "GET" && request.method !== "HEAD";
    const headers = Object.fromEntries(request.headers);
    // ZCL_STG_HTTP_HANDLER builds absolute URLs from these, as behind a proxy
    headers.host = url.host;
    headers["x-forwarded-proto"] = url.protocol.replace(":", "");
    headers["x-forwarded-prefix"] = MOUNT.slice(0, -1);
    const answer = await osgo.handle({
      method: request.method,
      url: `/${path}${url.search}`,
      headers,
      body: mutation ? new Uint8Array(await request.arrayBuffer()) : undefined,
    });
    if (mutation) await storeDatabase(osgo);
    const h = new Headers();
    for (const [k, v] of answer.headers) h.append(k, v);
    const empty = EMPTY_STATUSES.has(answer.status) || request.method === "HEAD";
    return new Response(empty ? null : answer.body, {status: answer.status, headers: h});
  } catch (error) {
    return new Response(`OSGo could not answer: ${error?.stack || error}`, {status: 500, headers: {"content-type": "text/plain; charset=utf-8"}});
  }
}

function start() {
  started ??= boot().catch((error) => {
    started = undefined;
    throw error;
  });
  return started;
}

async function boot() {
  const t0 = performance.now();
  const [SQL, stored] = await Promise.all([
    initSqlJs({locateFile: (file) => `${MOUNT}${file}`}),
    readDatabase(),
  ]);
  const tSql = performance.now();
  self.SQL = SQL;
  self.osgoOpenDatabase = (dsn) => (dsn === "preview" && stored ? new SQL.Database(stored) : null);
  const ready = new Promise((resolve) => { self.osgoReady = resolve; });
  const go = new Go();
  go.argv = ["osgo"];
  go.env = {OSGO_STORED: stored ? "1" : ""};
  const {instance} = await WebAssembly.instantiateStreaming(fetch(`${MOUNT}osgo.wasm`), go.importObject);
  const tWasm = performance.now();
  go.run(instance).then(() => { started = undefined; });
  const report = await ready;
  if (report.error) throw new Error(report.error);
  const tReady = performance.now();
  info = {
    stored: Boolean(stored),
    sqljsMs: Math.round(tSql - t0),
    wasmMs: Math.round(tWasm - tSql),
    goStartMs: Math.round(tReady - tWasm),
    goSeedMs: report.seedMs,
    totalMs: Math.round(tReady - t0),
  };
  if (!stored) await storeDatabase(self.osgo);
  return self.osgo;
}

async function readDatabase() {
  try {
    const cache = await caches.open(DATABASE_CACHE);
    const hit = await cache.match(DATABASE_KEY);
    if (hit === undefined || hit.headers.get("x-build-id") !== BUILD_ID) return undefined;
    return new Uint8Array(await hit.arrayBuffer());
  } catch {
    return undefined;
  }
}

async function storeDatabase(osgo) {
  try {
    const cache = await caches.open(DATABASE_CACHE);
    await cache.put(DATABASE_KEY, new Response(osgo.exportDatabase(), {
      headers: {"content-type": "application/octet-stream", "x-build-id": BUILD_ID},
    }));
  } catch {
    // storage unavailable (a private window): edits are lost on restart
  }
}
