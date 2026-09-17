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
import {services, channels} from "./generated/services.mjs";
import {shim} from "./generated/socket-shim.mjs";
import {describe} from "../tools/osd-describe.mjs";

const MOUNT = new URL("./", self.location).pathname;
// every prefix this deployment answers, longest first so a service nested
// under another is matched before its parent. Generated from the SICF nodes
// in the tree, so an imported application arrives with its own route.
const SERVICE_PREFIXES = services
  .map((s) => s.path.replace(/^\//, "") + "/")
  .sort((a, b) => b.length - a.length);
const RESET_PATH = "__preview/reset";
// Which bundle is actually answering, said by the bundle itself.
//
// Three times in one day a check passed against something other than the
// thing it was checking: a suite green against a stale build/sw.js, a
// deployment verified by the command exiting 0, a fix confirmed by grepping
// for a comment the bundler strips. The file on disk being right proves
// nothing about the worker in control of the page, which is the one that
// answers, and it can be an older registration.
//
// So the bundle carries its own identity. scripts/build-preview.mjs hashes
// the emitted worker and writes the digest over this placeholder, and the
// same digest into build/build.json. A test can then ask the running worker
// what it is and compare, and a stale one says so instead of passing.
const BUILD_PATH = "__preview/build";
const BUILD_STAMP = "__OSD_BUILD_STAMP__";
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

// The page's websockets. A port per conversation, so a message belongs to
// one socket without either end tagging it, and the conversation ends when
// the page closes it or the handler refuses.
self.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.apc !== "open") {
    return;
  }
  const port = event.ports?.[0];
  if (port === undefined) {
    return;
  }
  const channel = channels.find((c) => c.path === message.path);
  if (channel === undefined) {
    port.postMessage({apc: "close", code: 1008, reason: `no channel on ${message.path}`});
    return;
  }
  const send = (payload) => port.postMessage(payload);
  port.onmessage = (inner) => {
    const body = inner.data;
    if (body?.apc === "message") {
      void run(() => backendOf().then((b) => b.channelMessage(message.id, body.text, send)));
    } else if (body?.apc === "close") {
      void run(() => backendOf().then((b) => b.closeChannel(message.id)));
    }
  };
  // openChannel signals the open itself, before it drains what on_start
  // pushed, because the page must be OPEN before its onmessage can fire
  void run(async () => {
    const backend = await backendOf();
    await backend.openChannel(message.id, channel, send);
  });

  // a failure here is the handler's, and the page can only be told by the
  // socket closing; saying why in the reason is the whole of what we can do
  //
  // describe() rather than error.message, because an ABAP exception has
  // none: the obvious line produced code 1011 with an empty reason, which
  // is how a crash in the transpiled Z-machine looked for an afternoon.
  async function run(work) {
    try {
      await work();
    } catch (error) {
      send({apc: "close", code: 1011, reason: describe(error)});
    }
  }
});

// An ABAP-generated page opens its own websocket in its own script, before
// anything the deployment adds could replace the constructor. So the shim
// goes in ahead of it: one module tag, first thing in the document.
//
// This is a real edit to somebody's HTML and it is worth being uneasy about.
// The justification is narrow: in a bundle there is no network, so
// `new WebSocket(...)` cannot succeed, and a page that hangs on a socket
// that will never open is worse than one told plainly there is none. The
// shim only takes over the channel paths this deployment actually serves
// and hands every other URL to the real constructor.
// inline and classic, not a module and not a src. A module script is
// deferred: it runs after the document is parsed, which is after the page's
// own script has already called new WebSocket( ) and been refused. An
// earlier version of this injected a module and a test asserted the shim was
// installed once the page had loaded — which was true, and proved nothing,
// because by then the socket had already failed.
const SHIM = `<script>${shim}\ninstall({paths: ${JSON.stringify(channels.map((c) => c.path))}});</script>`;

async function withSocketShim(answer) {
  const type = answer.headers?.get?.("content-type") ?? "";
  if (channels.length === 0 || type.includes("text/html") === false) {
    return answer.body;
  }
  const html = new TextDecoder().decode(answer.body);
  const at = html.search(/<head[^>]*>/i);
  const patched = at < 0
    ? SHIM + html
    : html.slice(0, html.indexOf(">", at) + 1) + SHIM + html.slice(html.indexOf(">", at) + 1);
  const bytes = new TextEncoder().encode(patched);
  answer.headers?.set?.("content-length", String(bytes.length));
  return bytes;
}

function backendOf() {
  return start();
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(MOUNT)) {
    return;
  }
  const path = url.pathname.slice(MOUNT.length);
  // a bare service path with no trailing slash is the service's own root,
  // which is how a terminal page is opened
  const served = SERVICE_PREFIXES.some((p) => path.startsWith(p) || path + "/" === p);
  if (path !== RESET_PATH && path !== BUILD_PATH && served === false) {
    return;
  }
  event.respondWith(serve(event.request, url, path));
});

async function serve(request, url, path) {
  try {
    // answered before the runtime is started: the point is to identify the
    // worker even when the runtime behind it is broken
    if (path === BUILD_PATH) {
      return new Response(JSON.stringify({stamp: BUILD_STAMP}), {
        headers: {"content-type": "application/json", "cache-control": "no-store"},
      });
    }
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
    if (EMPTY_STATUSES.has(answer.status)) {
      return new Response(null, {status: answer.status, headers: answer.headers});
    }
    return new Response(await withSocketShim(answer), {status: answer.status, headers: answer.headers});
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
  // the worker's own identity, for the status service: the stamp is the
  // generation this bundle is (there is no other), the mount says which
  // deployment it is (main, pr-7) and nothing more than that
  await backend.startBackend(stored, {stamp: BUILD_STAMP, mount: MOUNT});
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
