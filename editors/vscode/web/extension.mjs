import * as vscode from "vscode";

const SERVICE = "/sap/opu/odata/sap/ZSTG_DEMO_SRV";
const METADATA = `${SERVICE}/$metadata`;
const DB_NAME = "open-steamgate-vscode-web";
const LAST_TRAVEL = "last-travel";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let backendPromise;
let requestQueue = Promise.resolve();
let activationToMetadataMs;

function transaction(mode, work) {
  return new Promise((resolve, reject) => {
    const opened = indexedDB.open(DB_NAME, 1);
    opened.onupgradeneeded = () => opened.result.createObjectStore("values");
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const db = opened.result;
      let result;
      const tx = db.transaction("values", mode);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      const request = work(tx.objectStore("values"));
      request.onsuccess = () => { result = request.result; };
    };
  });
}

const readValue = (key) => transaction("readonly", (store) => store.get(key));
const writeValue = (key, value) => transaction("readwrite", (store) => store.put(value, key));

function backendOf() {
  backendPromise ??= (async () => {
    // preview-backend imports this before the transpiled runtime. Do not pin
    // Date in a worker shared with the VS Code extension host.
    globalThis.__stgPreviewFreezeTime = false;
    const backend = await import("../../../web/preview-backend.mjs");
    if (backend.database !== "sql.js") throw new Error("The web extension requires the sql.js preview build");
    const stored = await readValue(backend.buildId);
    await backend.startBackend(stored && new Uint8Array(stored), {mount: "/", stamp: backend.buildId});
    if (!stored) await writeValue(backend.buildId, await backend.exportDatabase());
    return backend;
  })().catch((error) => {
    backendPromise = undefined;
    throw error;
  });
  return backendPromise;
}

// Keep the request and its snapshot in one queue. The preview backend already
// serializes ABAP requests; this extra queue also orders IndexedDB exports.
function gateway(request) {
  const result = requestQueue.then(async () => {
    const backend = await backendOf();
    const answer = await backend.handleRequest(request);
    if (!["GET", "HEAD"].includes(request.method)) {
      await writeValue(backend.buildId, await backend.exportDatabase());
    }
    return answer;
  });
  requestQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function send(method, path, {headers = {}, body} = {}) {
  const answer = await gateway({
    method, path, headers: {
      host: "osd.invalid", "x-forwarded-proto": "https", ...headers,
    }, body: body === undefined ? undefined : encoder.encode(JSON.stringify(body)),
  });
  return {status: answer.status, headers: answer.headers, text: decoder.decode(answer.body)};
}

// The wire format uses base64 because VS Code's webview message transport is
// JSON based. Never decode a multipart body as text on its way to the gateway.
function bytesFromBase64(value) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid base64 body");
  }
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function base64FromBytes(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value ?? 0);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function bridgeError(status, detail) {
  const body = encoder.encode(String(detail));
  return {status, statusText: status === 403 ? "Forbidden" : status === 400 ? "Bad Request" : "Bad Gateway",
    headers: [["content-type", "text/plain; charset=utf-8"]], body: base64FromBytes(body)};
}

async function bridgeRequest(message) {
  try {
    if (typeof message.method !== "string" || !/^[A-Z]+$/.test(message.method) ||
        typeof message.path !== "string" || !message.path.startsWith("/") ||
        typeof message.query !== "string" || (message.query && !message.query.startsWith("?")) ||
        !Array.isArray(message.headers)) return bridgeError(400, "Invalid bridge request");
    // Decode each segment once before checking it. URL parsers may already
    // canonicalize literal dot segments; an encoded dot inside a name is fine.
    let segments;
    try { segments = message.path.split("/").map((segment) => decodeURIComponent(segment)); }
    catch { return bridgeError(400, "Malformed percent-encoding in path"); }
    if (!/^\/sap\/(?:opu\/odata\/|bc\/)/i.test(segments.join("/")) ||
        segments.some((segment) => segment === "." || segment === ".." ||
          segment.includes("/") || segment.includes("\\"))) {
      return bridgeError(403, "Path outside the virtual gateway");
    }
    const headers = new Headers(message.headers);
    headers.set("host", "osd.invalid");
    headers.set("x-forwarded-proto", "https");
    const body = bytesFromBase64(message.body ?? "");
    const answer = await gateway({method: message.method, path: message.path, search: message.query,
      headers: Object.fromEntries(headers), body});
    const responseHeaders = new Headers(answer.headers);
    const statusText = {200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
      400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
      405: "Method Not Allowed", 409: "Conflict", 500: "Internal Server Error"};
    return {status: answer.status, statusText: statusText[answer.status] ?? "",
      headers: Array.from(responseHeaders.entries()), body: base64FromBytes(answer.body)};
  } catch (error) {
    return bridgeError(502, String(error?.message ?? error));
  }
}

function required(answer, status, step) {
  if (answer.status !== status) {
    throw new Error(`${step}: expected ${status}, got ${answer.status}: ${answer.text.slice(0, 500)}`);
  }
}

function travelId() {
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return "W" + Array.from(bytes, (byte) => (byte % 36).toString(36).toUpperCase()).join("");
}

async function probe(commandStarted) {
  const metadata = await send("GET", METADATA);
  required(metadata, 200, "$metadata");
  const commandToMetadataMs = Math.round(performance.now() - commandStarted);
  const photo = await gateway({method: "GET", path: `${SERVICE}/PhotoSet('T0001')/$value`,
    headers: {host: "osd.invalid", "x-forwarded-proto": "https"}});
  if (photo.status !== 200) throw new Error(`PhotoSet direct GET: ${photo.status}`);
  const photoBytes = photo.body instanceof Uint8Array ? photo.body : new Uint8Array(photo.body);
  const photoDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", photoBytes));
  const photoHash = Array.from(photoDigest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const tokenAnswer = await send("GET", `${SERVICE}/`, {headers: {"x-csrf-token": "fetch"}});
  required(tokenAnswer, 200, "CSRF fetch");
  const token = tokenAnswer.headers.get("x-csrf-token");
  if (!token) throw new Error("CSRF fetch returned no token");
  const id = travelId();
  const description = `Web probe ${id}`;
  const created = await send("POST", `${SERVICE}/TravelSet`, {
    headers: {"content-type": "application/json", "x-csrf-token": token},
    body: {TravelId: id, Description: description},
  });
  required(created, 201, "TravelSet POST");
  const fetched = await send("GET", `${SERVICE}/TravelSet('${id}')`, {headers: {accept: "application/json"}});
  required(fetched, 200, "TravelSet GET");
  const row = JSON.parse(fetched.text).d;
  if (row.TravelId !== id || row.Description !== description) throw new Error("TravelSet GET returned the wrong row");
  await writeValue(LAST_TRAVEL, {id, description});
  return {metadata: metadata.status, post: created.status, get: fetched.status, id, description,
    photo: {status: photo.status, hash: photoHash, bytes: photoBytes.length,
      contentType: photo.headers.get("content-type"), contentLength: photo.headers.get("content-length")},
    activationToMetadataMs, commandToMetadataMs};
}

async function verifyLastTravel() {
  const last = await readValue(LAST_TRAVEL);
  if (!last) throw new Error("No web probe TravelSet row has been recorded");
  const fetched = await send("GET", `${SERVICE}/TravelSet('${last.id}')`, {headers: {accept: "application/json"}});
  required(fetched, 200, "persistent TravelSet GET");
  const row = JSON.parse(fetched.text).d;
  if (row.TravelId !== last.id || row.Description !== last.description) {
    throw new Error("The TravelSet row did not survive the page reload");
  }
  return {get: fetched.status, id: last.id, description: last.description};
}

// Runs in the isolated webview. Keep it self-contained so the exact same
// function is embedded in the generated page and exercises real postMessage.
function webviewRuntime(service) {
  const vscode = acquireVsCodeApi();
  const origin = "https://osd.invalid";
  const pending = new Map();
  let nextId = 1;
  const encode = new TextEncoder();
  const decode = new TextDecoder();
  const toBase64 = (bytes) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  };
  const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message?.type === "fetch-result" && pending.has(message.id)) {
      pending.get(message.id)(message.response);
      pending.delete(message.id);
    }
  });
  async function bridgeFetch(input, init = {}) {
    const source = input instanceof Request ? input : null;
    const url = new URL(source?.url ?? input, `${origin}${service}/`);
    if (url.origin !== origin) throw new TypeError("URL outside the virtual gateway");
    const method = String(init.method ?? source?.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? source?.headers ?? {});
    let body = init.body;
    if (body === undefined && source && method !== "GET" && method !== "HEAD") body = await source.arrayBuffer();
    if (body instanceof URLSearchParams) {
      if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
      body = body.toString();
    } else if (typeof body === "string" && !headers.has("content-type")) {
      headers.set("content-type", "text/plain;charset=UTF-8");
    } else if (body instanceof Blob) {
      if (body.type && !headers.has("content-type")) headers.set("content-type", body.type);
    }
    if (body instanceof Blob) body = await body.arrayBuffer();
    const bytes = body === undefined || body === null ? new Uint8Array(0)
      : typeof body === "string" ? encode.encode(body)
      : body instanceof ArrayBuffer ? new Uint8Array(body)
      : ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
      : (() => { throw new TypeError("Unsupported request body"); })();
    const id = nextId++;
    const answer = new Promise((resolve) => pending.set(id, resolve));
    vscode.postMessage({type: "fetch", id, method, path: url.pathname, query: url.search,
      headers: Array.from(headers.entries()), body: toBase64(bytes)});
    const response = await answer;
    return new Response([204, 205, 304].includes(response.status) ? null : fromBase64(response.body), {status: response.status,
      statusText: response.statusText, headers: response.headers});
  }
  // A later UI5 XHR adapter can install a constructor backed by this fetch.
  window.osdBridge = {fetch: bridgeFetch, installXHR: (factory) => { window.XMLHttpRequest = factory(bridgeFetch); }};
  const result = document.getElementById("result");
  const show = (name, value) => { result.textContent = `${name} ${JSON.stringify(value)}`; };
  const requireStatus = (answer, status, step) => {
    if (answer.status !== status) throw new Error(`${step}: ${answer.status} ${answer.statusText}`);
  };
  const freshId = () => "W" + Array.from(crypto.getRandomValues(new Uint8Array(7)),
    (byte) => (byte % 36).toString(36).toUpperCase()).join("");
  let saved;
  window.addEventListener("message", (event) => {
    if (event.data?.type === "probe-saved") saved?.();
  });
  async function runProbe() {
    try {
      const metadata = await bridgeFetch("$metadata");
      requireStatus(metadata, 200, "metadata");
      const metadataText = await metadata.text();
      if (!metadata.headers.get("content-type")?.includes("xml") || !metadataText.includes("Edmx")) throw new Error("metadata body or content-type missing");
      const tokenResponse = await bridgeFetch("./?probe=csrf", {headers: {"x-csrf-token": "fetch"}});
      requireStatus(tokenResponse, 200, "token");
      const token = tokenResponse.headers.get("x-csrf-token");
      if (!token || !(await tokenResponse.text())) throw new Error("CSRF response missing token or body");
      const id = freshId();
      const description = `Webview probe ${id}`;
      const created = await bridgeFetch("TravelSet", {method: "POST",
        headers: {"content-type": "application/json", "x-csrf-token": token},
        body: JSON.stringify({TravelId: id, Description: description})});
      requireStatus(created, 201, "POST");
      const location = created.headers.get("location");
      if (!location?.includes(`TravelSet('${id}')`) || !created.headers.get("content-type")?.includes("json") ||
          !(await created.text()).includes(id)) throw new Error("POST response headers or body missing");
      const fetched = await bridgeFetch(`TravelSet('${id}')?$format=json`, {headers: {accept: "application/json"}});
      requireStatus(fetched, 200, "GET");
      const row = (await fetched.json()).d;
      if (row.TravelId !== id || row.Description !== description || !fetched.headers.get("content-type")?.includes("json")) throw new Error("GET response mismatch");
      const filtered = await bridgeFetch(`TravelSet?$filter=${encodeURIComponent(`TravelId eq '${id}'`)}&$format=json`);
      requireStatus(filtered, 200, "filtered GET");
      const filteredRows = (await filtered.json()).d.results;
      if (filteredRows.length !== 1 || filteredRows[0].TravelId !== id) throw new Error("query was not forwarded");
      const refused = await bridgeFetch(`${origin}/outside`);
      requireStatus(refused, 403, "path guard");
      const batchId = freshId();
      const boundary = `batch_${batchId}`;
      const change = `change_${batchId}`;
      const batchBody = [
        `--${boundary}`, "Content-Type: application/http", "Content-Transfer-Encoding: binary", "",
        "GET TravelSet?$top=1&$format=json HTTP/1.1", "Accept: application/json", "", "",
        `--${boundary}`, `Content-Type: multipart/mixed; boundary=${change}`, "",
        `--${change}`, "Content-Type: application/http", "Content-Transfer-Encoding: binary", "",
        "POST TravelSet HTTP/1.1", "Content-Type: application/json", "",
        JSON.stringify({TravelId: batchId, Description: `Batch café ${batchId}`}),
        `--${change}--`, "", `--${boundary}--`, "",
      ].join("\r\n");
      const bodyBytes = encode.encode(batchBody);
      const batch = await bridgeFetch("$batch", {method: "POST",
        headers: {"content-type": `multipart/mixed; boundary=${boundary}`, "x-csrf-token": token}, body: bodyBytes});
      if (batch.status !== 202) throw new Error(`batch: ${batch.status} ${await batch.text()}`);
      const batchText = await batch.text();
      if (!batch.headers.get("content-type")?.includes("multipart/mixed") ||
          !batchText.includes("HTTP/1.1 200 OK") || !batchText.includes("HTTP/1.1 201 Created") ||
          !batchText.includes(batchId)) throw new Error("batch response mismatch");
      const batchRow = await bridgeFetch(`TravelSet('${batchId}')?$format=json`);
      requireStatus(batchRow, 200, "batch row");
      if ((await batchRow.json()).d.Description !== `Batch café ${batchId}`) throw new Error("batch bytes changed");
      const stored = new Promise((resolve) => { saved = resolve; });
      vscode.postMessage({type: "probe-complete", id, description});
      await stored;
      show("OSD_WEBVIEW_PROBE", {metadata: metadata.status, csrf: tokenResponse.status, post: created.status,
        get: fetched.status, filtered: filtered.status, forbidden: refused.status,
        batch: batch.status, batchGet: batchRow.status, id, description,
        contentType: fetched.headers.get("content-type"), token, location});
    } catch (error) { show("OSD_WEBVIEW_ERROR", {error: String(error?.stack ?? error)}); }
  }
  window.addEventListener("message", async (event) => {
    if (event.data?.type !== "last-travel") return;
    try {
      const last = event.data.value;
      if (!last) return;
      const answer = await bridgeFetch(`TravelSet('${last.id}')?$format=json`);
      requireStatus(answer, 200, "reload GET");
      const row = (await answer.json()).d;
      if (row.TravelId !== last.id || row.Description !== last.description ||
          !answer.headers.get("content-type")?.includes("json")) throw new Error("reload row mismatch");
      show("OSD_WEBVIEW_VERIFY", {get: answer.status, id: last.id, description: row.Description});
    } catch (error) { show("OSD_WEBVIEW_ERROR", {error: String(error?.stack ?? error)}); }
  });
  document.getElementById("run").onclick = runProbe;
  document.getElementById("verify").onclick = () => vscode.postMessage({type: "get-last-travel"});
  vscode.postMessage({type: "ready"});
}

function webviewHtml(nonce) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>body{font:14px system-ui;padding:1rem}pre{white-space:pre-wrap}</style></head>
<body><h1>OSD web gateway</h1><button id="run">Run write and batch probe</button>
<button id="verify">Verify saved row</button><pre id="result">Waiting</pre>
<script nonce="${nonce}">(${webviewRuntime.toString()})(${JSON.stringify(SERVICE)});</script></body></html>`;
}

export async function activate(context) {
  const started = performance.now();
  const output = vscode.window.createOutputChannel("OSD Web Probe");
  context.subscriptions.push(output);
  const run = (label, work) => async () => {
    const commandStarted = performance.now();
    output.show(true);
    try {
      const result = await work(commandStarted);
      output.appendLine(`${label} ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      output.appendLine(`${label}_ERROR ${String(error?.stack ?? error)}`);
      throw error;
    }
  };
  context.subscriptions.push(vscode.commands.registerCommand("osd.webProbe", run("OSD_WEB_PROBE", probe)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.webVerifyLastTravel", run("OSD_WEB_VERIFY", verifyLastTravel)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.webProbeView", () => {
    const panel = vscode.window.createWebviewPanel("osdWebProbe", "OSD web gateway", vscode.ViewColumn.One, {enableScripts: true});
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    panel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "fetch" && Number.isSafeInteger(message.id)) {
        const response = await bridgeRequest(message);
        await panel.webview.postMessage({type: "fetch-result", id: message.id, response});
      } else if (message?.type === "probe-complete" && /^W[A-Z0-9]{7}$/.test(message.id) &&
                 typeof message.description === "string") {
        await writeValue(LAST_TRAVEL, {id: message.id, description: message.description});
        await panel.webview.postMessage({type: "probe-saved"});
      } else if (message?.type === "get-last-travel") {
        await panel.webview.postMessage({type: "last-travel", value: await readValue(LAST_TRAVEL)});
      }
    });
    panel.webview.html = webviewHtml(nonce);
  }));
  try {
    const metadata = await send("GET", METADATA);
    required(metadata, 200, "activation $metadata");
    activationToMetadataMs = Math.round(performance.now() - started);
    output.appendLine(`OSD_WEB_READY ${JSON.stringify({activationToMetadataMs})}`);
  } catch (error) {
    output.appendLine(`OSD_WEB_BOOT_ERROR ${String(error?.stack ?? error)}`);
    throw error;
  }
}

export function deactivate() {}
