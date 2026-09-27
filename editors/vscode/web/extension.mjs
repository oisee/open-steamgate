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
  return {metadata: metadata.status, post: created.status, get: fetched.status, id, description, activationToMetadataMs, commandToMetadataMs};
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

function webviewHtml(nonce) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>body{font:14px system-ui;padding:1rem}pre{white-space:pre-wrap}</style></head>
<body><h1>OSD web gateway</h1><button id="run">GET $metadata</button><pre id="result">Waiting</pre>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const result = document.getElementById('result');
document.getElementById('run').onclick = () => vscode.postMessage({type:'fetch', id:1, path:${JSON.stringify(METADATA)}});
window.addEventListener('message', event => {
  if (event.data?.type === 'fetch-result' && event.data.id === 1)
    result.textContent = event.data.status + ' ' + event.data.body;
});
document.getElementById('run').click();
</script></body></html>`;
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
      if (message?.type !== "fetch" || message.path !== METADATA || message.id !== 1) return;
      try {
        const answer = await send("GET", METADATA);
        await panel.webview.postMessage({type: "fetch-result", id: 1, status: answer.status, body: answer.text.slice(0, 1000)});
      } catch (error) {
        await panel.webview.postMessage({type: "fetch-result", id: 1, status: 500, body: String(error)});
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
