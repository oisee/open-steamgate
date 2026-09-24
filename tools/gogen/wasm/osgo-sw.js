// The service worker of the OSGo preview: OSGo compiled to wasm answers
// every request below <mount>/sap/, as the net/http server answers them on a
// port; everything else (the Fiori apps, the launchpad) is a file of the
// static host. The shape is web/preview-worker.mjs, with Go in the place of
// the transpiler's runtime (tools/gogen/wasm-preview.mjs builds it).
//
// A classic script: importScripts during the first evaluation is the one way
// a worker takes Go's loader and sql.js, both of which are classic scripts.
/* global Go, initSqlJs */
const MOUNT = new URL("./", self.location).pathname;

// Go's os under GOOS=js calls globalThis.fs (Node's shape, callbacks). This
// one answers the files below /media/ (OSGO_MEDIA) out of <mount>media/ by
// fetch, read-only, and writes stdout and stderr to the console: the host
// hook for SMW0, the place of abap.W3MI_LOADER in the JS preview. Anything
// else is ENOENT. It is installed before wasm_exec.js, which keeps an fs it
// finds.
self.fs = (() => {
  const files = new Map();
  let next = 100;
  let line = "";
  const decoder = new TextDecoder("utf-8");
  const error = (code) => Object.assign(new Error(code), {code});
  const statOf = (size) => ({dev: 0, ino: 0, mode: 0o100444, nlink: 1, uid: 0, gid: 0, rdev: 0, size, blksize: 4096,
    blocks: Math.ceil(size / 512), atimeMs: 0, mtimeMs: 0, ctimeMs: 0, isDirectory: () => false});
  const load = async (path) => {
    if (!path.startsWith("/media/")) throw error("ENOENT");
    const res = await fetch(`${MOUNT}media/${path.slice(7).split("/").map(encodeURIComponent).join("/")}`, {cache: "force-cache"});
    if (!res.ok) throw error("ENOENT");
    return new Uint8Array(await res.arrayBuffer());
  };
  return {
    constants: {O_WRONLY: -1, O_RDWR: -1, O_CREAT: -1, O_TRUNC: -1, O_APPEND: -1, O_EXCL: -1, O_DIRECTORY: -1},
    writeSync(fd, buf) {
      line += decoder.decode(buf);
      const nl = line.lastIndexOf("\n");
      if (nl !== -1) {
        console.log(line.slice(0, nl));
        line = line.slice(nl + 1);
      }
      return buf.length;
    },
    write(fd, buf, offset, length, position, callback) {
      if (offset !== 0 || length !== buf.length || position !== null) { callback(error("ENOSYS")); return; }
      callback(null, this.writeSync(fd, buf));
    },
    open(path, flags, mode, callback) {
      if (flags !== 0) { callback(error("EROFS")); return; }
      load(path).then((bytes) => { const fd = next++; files.set(fd, bytes); callback(null, fd); }, (e) => callback(e));
    },
    close(fd, callback) { files.delete(fd); callback(null); },
    fstat(fd, callback) {
      const f = files.get(fd);
      if (f === undefined) callback(error("EBADF")); else callback(null, statOf(f.length));
    },
    stat(path, callback) { load(path).then((b) => callback(null, statOf(b.length)), (e) => callback(e)); },
    lstat(path, callback) { this.stat(path, callback); },
    read(fd, buffer, offset, length, position, callback) {
      const f = files.get(fd);
      if (f === undefined) { callback(error("EBADF")); return; }
      const at = position ?? f.pos ?? 0;
      const n = Math.max(0, Math.min(length, f.length - at));
      buffer.set(f.subarray(at, at + n), offset);
      if (position === null || position === undefined) f.pos = at + n;
      callback(null, n);
    },
  };
})();
importScripts("wasm_exec.js", "sql-wasm.js");

const BUILD_ID = "__OSGO_BUILD_ID__";
const PREFIXES = ["sap/"];
const DATABASE_CACHE = "osgo-preview-database";
const DATABASE_KEY = `${MOUNT}__osgo/database`;
const RESET_PATH = "__osgo/reset";
const INFO_PATH = "__osgo/info";
// answered by the worker alone: the page -> worker -> page round trip that
// every answer pays, measured beside the ones Go answers
const PING_PATH = "__osgo/ping";
const EMPTY_STATUSES = new Set([204, 205, 304]);

let started;
let info = {};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(MOUNT)) return;
  const path = url.pathname.slice(MOUNT.length);
  if (path !== RESET_PATH && path !== INFO_PATH && path !== PING_PATH && !PREFIXES.some((p) => path.startsWith(p))) return;
  event.respondWith(serve(event.request, url, path, performance.now()));
});

// The page's WebSockets to the push channels: a MessageChannel per socket,
// the protocol of web/preview-socket.mjs (the JS preview's shim, which this
// worker injects into the HTML it answers, as web/preview-worker.mjs does).
self.addEventListener("message", (event) => {
  const message = event.data;
  const port = event.ports?.[0];
  if (message?.apc !== "open" || port === undefined) return;
  const send = (payload) => port.postMessage(payload);
  const query = message.search ?? "";
  let conn;
  let queue = Promise.resolve();
  // one message at a time, in order, as a socket delivers them
  const run = (work) => { queue = queue.then(work).catch((error) => {
    send({apc: "close", code: 1011, reason: "handler failed"});
    conn?.close("handler failed", 1006);
    conn = undefined;
    console.warn(`APC ${message.path}: ${error?.message ?? error}`);
  }); };
  port.onmessage = (inner) => {
    const body = inner.data;
    if (body?.apc === "message") {
      run(async () => {
        if (conn === undefined) return;
        for (const text of await conn.message(body.text)) send({apc: "message", text});
      });
    } else if (body?.apc === "close") {
      run(async () => {
        await conn?.close("closed by the client", 1000);
        conn = undefined;
        send({apc: "close", code: 1000, reason: "bye"});
      });
    }
  };
  run(async () => {
    const osgo = await start();
    try {
      const path = message.path.startsWith(MOUNT) ? `/${message.path.slice(MOUNT.length)}` : message.path;
      conn = await osgo.apcOpen(path, query.replace(/^\?/, ""));
    } catch (error) {
      send({apc: "close", code: 1011, reason: String(error?.message ?? error)});
      return;
    }
    // open before drain: the page's socket is OPEN before ON_START's messages
    send({apc: "open"});
    for (const text of conn.out) send({apc: "message", text});
  });
});

// The shim goes first in the <head> of an HTML answer, inline and classic,
// so it is in place before the page's own script opens its socket (the
// reasoning is web/preview-worker.mjs's SHIM).
let shim;
async function withSocketShim(osgo, headers, body) {
  const type = headers.get("content-type") ?? "";
  if (!type.includes("text/html") || osgo.channels.length === 0) return body;
  shim ??= (await (await fetch(`${MOUNT}preview-socket.mjs`)).text()).replace(/^export /gm, "");
  // a page below a mount opens its socket below it too
  const paths = [...osgo.channels].flatMap((p) => [p, `${MOUNT.slice(0, -1)}${p}`]);
  const tag = `<script>${shim}\ninstall({paths: ${JSON.stringify(paths)}});</script>`;
  const html = new TextDecoder().decode(body);
  const at = html.search(/<head[^>]*>/i);
  const patched = at < 0 ? tag + html : html.slice(0, html.indexOf(">", at) + 1) + tag + html.slice(html.indexOf(">", at) + 1);
  const bytes = new TextEncoder().encode(patched);
  headers.set("content-length", String(bytes.length));
  return bytes;
}

async function serve(request, url, path, arrived) {
  try {
    if (path === PING_PATH) return new Response("{}", {headers: {"content-type": "application/json", "cache-control": "no-store"}});
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
    const t0 = performance.now();
    const answer = await osgo.handle({
      method: request.method,
      url: `/${path}${url.search}`,
      headers,
      body: mutation ? new Uint8Array(await request.arrayBuffer()) : undefined,
    });
    const took = performance.now() - t0;
    if (mutation) await storeDatabase(osgo);
    const h = new Headers();
    // the time Go took, as the worker sees it, beside what the page sees
    h.append("server-timing", `osgo;dur=${took.toFixed(2)}, sw;dur=${(performance.now() - arrived).toFixed(2)}`);
    for (const [k, v] of answer.headers) h.append(k, v);
    const empty = EMPTY_STATUSES.has(answer.status) || request.method === "HEAD";
    return new Response(empty ? null : await withSocketShim(osgo, h, answer.body), {status: answer.status, headers: h});
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
  // the worker's own copy first, else the image the build seeded
  // (seed.sqlite), else Go seeds from zz_db.json
  const [SQL, kept] = await Promise.all([
    initSqlJs({locateFile: (file) => `${MOUNT}${file}`}),
    readDatabase(),
  ]);
  const stored = kept ?? await fetch(`${MOUNT}seed.sqlite`).then((r) => (r.ok ? r.arrayBuffer() : undefined)).then((b) => b && new Uint8Array(b)).catch(() => undefined);
  const tSql = performance.now();
  self.SQL = SQL;
  self.osgoOpenDatabase = (dsn) => (dsn === "preview" && stored ? new SQL.Database(stored) : null);
  const ready = new Promise((resolve) => { self.osgoReady = resolve; });
  const go = new Go();
  go.argv = ["osgo"];
  go.env = {OSGO_STORED: stored ? "1" : "", OSGO_MEDIA: "/media"};
  const {instance} = await WebAssembly.instantiateStreaming(fetch(`${MOUNT}osgo.wasm`), go.importObject);
  const tWasm = performance.now();
  go.run(instance).then(() => { started = undefined; });
  const report = await ready;
  if (report.error) throw new Error(report.error);
  const tReady = performance.now();
  info = {
    stored: kept ? "cache" : stored ? "seed.sqlite" : "",
    sqljsMs: Math.round(tSql - t0),
    wasmMs: Math.round(tWasm - tSql),
    goStartMs: Math.round(tReady - tWasm),
    goSeedMs: report.seedMs,
    totalMs: Math.round(tReady - t0),
  };
  if (!kept) await storeDatabase(self.osgo);
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
