// The service worker a preview deployment is served through.
//
// GitHub Pages hands out files; open-steamgate answers requests. The worker
// bridges the two: every request below <mount>/sap/opu/odata/sap/ is handed to
// the transpiled ABAP runtime, everything else (the Fiori app files, sw.js,
// screenshots) goes to the network as usual. The pattern is larshp/hithub's
// web/preview-worker.mjs (MIT).
//
// Listeners are registered during the initial evaluation, as the service
// worker specification requires; the runtime is imported on the first request.
const MOUNT = new URL("./", self.location).pathname;
const SERVICE_PREFIX = "sap/opu/odata/sap/";
const RESET_PATH = "__preview/reset";
const DATABASE_CACHE = "open-steamgate-preview-database";
const DATABASE_KEY = `${MOUNT}__preview/database`;
const EMPTY_STATUSES = new Set([204, 205, 304]);

let application;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(MOUNT)) {
    return;
  }
  const path = url.pathname.slice(MOUNT.length);
  if (path !== RESET_PATH && !path.startsWith(SERVICE_PREFIX)) {
    return;
  }
  event.respondWith(serve(event.request, url, path));
});

async function serve(request, url, path) {
  try {
    const backend = await start();
    if (path === RESET_PATH) {
      await backend.resetBackend();
      await storeDatabase(backend);
      return Response.redirect(`${MOUNT}app/`, 303);
    }
    const mutation = request.method !== "GET" && request.method !== "HEAD";
    const headers = Object.fromEntries(request.headers);
    // ZCL_STG_HTTP_HANDLER builds absolute URLs (__metadata.uri, Location)
    // from these, the way it would behind a reverse proxy.
    headers.host = url.host;
    headers["x-forwarded-proto"] = url.protocol.replace(":", "");
    headers["x-forwarded-prefix"] = MOUNT.slice(0, -1);
    const answer = await backend.handleRequest({
      method: request.method,
      path: `/${path}`,
      search: url.search,
      headers,
      body: mutation ? new Uint8Array(await request.arrayBuffer()) : undefined,
    });
    if (mutation) {
      await storeDatabase(backend);
    }
    return new Response(EMPTY_STATUSES.has(answer.status) ? null : answer.body,
      {status: answer.status, headers: answer.headers});
  } catch (error) {
    return failure(error);
  }
}

function start() {
  application ??= load().catch((error) => {
    application = undefined;
    throw error;
  });
  return application;
}

async function load() {
  const backend = await import("./preview-backend.mjs");
  const stored = await readDatabase(backend.buildId);
  await backend.startBackend(stored);
  if (stored === undefined) {
    await storeDatabase(backend);
  }
  return backend;
}

// The worker is shut down when idle; the database lives in cache storage so
// the next start reads it back. A new build starts over.
async function readDatabase(buildId) {
  try {
    const cache = await caches.open(DATABASE_CACHE);
    const stored = await cache.match(DATABASE_KEY);
    if (stored === undefined || stored.headers.get("x-build-id") !== buildId) {
      return undefined;
    }
    return new Uint8Array(await stored.arrayBuffer());
  } catch {
    return undefined;
  }
}

async function storeDatabase(backend) {
  try {
    const cache = await caches.open(DATABASE_CACHE);
    await cache.put(DATABASE_KEY, new Response(await backend.exportDatabase(), {
      headers: {"content-type": "application/octet-stream", "x-build-id": backend.buildId},
    }));
  } catch {
    // storage unavailable (private window): edits are lost on restart, nothing else
  }
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function failure(error) {
  const message = escapeHtml(error?.stack || error?.message || error);
  return new Response(`<!doctype html><meta charset="utf-8"><title>Preview failed</title>
<style>body{margin:0;padding:2rem;font:16px system-ui,sans-serif}pre{white-space:pre-wrap}</style>
<h1>open-steamgate could not answer this request</h1><pre>${message}</pre>
<p><a href="${MOUNT}${RESET_PATH}">Reset the preview</a></p>`,
  {status: 500, headers: {"content-type": "text/html; charset=utf-8"}});
}
