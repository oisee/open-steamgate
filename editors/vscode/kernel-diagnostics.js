"use strict";
const path = require("node:path");
const fs = require("node:fs");
const {Worker} = require("node:worker_threads");
const SUPPORT = "https://github.com/oisee/open-steamgate/blob/main/";
const supportUrl = (finding) => SUPPORT + finding.supportAnchor;

function toDiagnostics(vscode, findings, document, mode) {
  if (mode === "off") return [];
  return findings.filter((f) => f.kind === "kernel-reject" && f.file === path.basename(document.fileName)).map((f) => {
    const line = Math.max(0, Math.min(document.lineCount - 1, f.line - 1));
    const text = document.lineAt(line).text;
    const diagnostic = new vscode.Diagnostic(new vscode.Range(line, text.search(/\S/) < 0 ? 0 : text.search(/\S/), line, text.length),
      f.message, mode === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
    diagnostic.source = "OSD kernel";
    diagnostic.code = {value: f.supportAnchor.split("#")[1], target: vscode.Uri.parse(supportUrl(f))};
    return diagnostic;
  });
}

function scanObject(file, buffers, {scanner, timeout = 5000, env = process.env} = {}) {
  scanner ??= fs.existsSync(path.join(__dirname, "kernel-runtime", "tools", "osd-kernel-compat.mjs"))
    ? path.join(__dirname, "kernel-runtime", "tools", "osd-kernel-compat.mjs")
    : path.resolve(__dirname, "../../tools/osd-kernel-compat.mjs");
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "kernel-worker.js"), {workerData: {file, buffers, scanner}, env});
    const timer = setTimeout(() => finish(new Error(`scanner exceeded ${timeout} ms`)), timeout);
    let done = false;
    function finish(error, warnings) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error); else resolve(warnings);
    }
    worker.once("message", (result) => finish(result.error ? new Error(result.error) : undefined, result.warnings));
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) => { if (!done) finish(new Error(`scanner exited ${code}`)); });
  });
}

async function resolveKernelObjectFile(object, {running, home, layers: userLayers = []} = {}) {
  const filename = `${object.name.toLowerCase().replaceAll("/", "#")}.${object.type.toLowerCase()}.abap`;
  const selected = [...(running?.files.values() ?? [])].find((file) => path.basename(file).toLowerCase() === filename);
  if (selected) return selected;
  if (!home) return undefined;
  const {pathToFileURL} = require("node:url");
  const {layers, filesIn} = await import(pathToFileURL(path.join(home, "tools/osd-inputs.mjs")).href);
  const resolved = layers(home, undefined, {...process.env, OSD_LAYERS: userLayers.map((layer) => typeof layer === "string" ? layer : layer.srcDir).join(path.delimiter)});
  const owner = resolved.owner.get(`${object.type.toUpperCase()} ${object.name.toUpperCase()}`);
  if (!owner) return undefined;
  return filesIn(home, owner).filter(({name}) => name.toLowerCase() === filename)
    .map(({file}) => path.resolve(home, file))[0];
}

function registerKernelDiagnostics(vscode, context, output, {scan = scanObject, delay = 400, onCount = () => {}, resolveFile} = {}) {
  const collection = vscode.languages.createDiagnosticCollection("osd-kernel");
  const timers = new Map(), revisions = new Map(), counts = new Map();
  let disposed = false, sequence = 0, queue = Promise.resolve();
  const mode = () => vscode.workspace.getConfiguration("osg").get("kernelStrict", "error");
  const eligible = (doc) => /\.abap$/i.test(doc.fileName) && doc.uri.scheme === "file" && vscode.workspace.getWorkspaceFolder(doc.uri);
  const buffers = (file) => {
    const prefix = path.basename(file).split(".").slice(0, 2).join(".").toLowerCase();
    return vscode.workspace.textDocuments.filter((doc) => path.dirname(doc.fileName) === path.dirname(file)
      && path.basename(doc.fileName).toLowerCase().startsWith(prefix + ".") && /\.(abap|xml)$/i.test(doc.fileName))
      .map((doc) => ({file: doc.fileName, source: doc.getText()}));
  };
  const count = () => onCount([...counts.values()].reduce((a, b) => a + b, 0));
  const scanSafe = (file, current = () => true) => {
    // One parser at a time; gather the newest buffers when its turn arrives.
    const job = queue.then(() => disposed || !current() ? [] : scan(file, buffers(file)));
    queue = job.catch(() => {});
    return job.catch((error) => { output.appendLine(`OSD kernel: ${String(error.message ?? error).replace(/[\r\n]+/g, " ")}`); return []; });
  };
  function schedule(doc) {
    if (!eligible(doc) || disposed) return;
    const key = doc.uri.toString(), revision = ++sequence;
    revisions.set(key, revision);
    clearTimeout(timers.get(key));
    timers.delete(key);
    if (mode() === "off") { collection.delete(doc.uri); counts.delete(key); count(); return; }
    timers.set(key, setTimeout(async () => {
      timers.delete(key);
      const findings = await scanSafe(doc.fileName, () => revisions.get(key) === revision && mode() !== "off");
      if (disposed || revisions.get(key) !== revision || mode() === "off") return;
      const diagnostics = toDiagnostics(vscode, findings, doc, mode());
      collection.set(doc.uri, diagnostics);
      counts.set(key, diagnostics.length); count();
    }, delay));
  }
  function changed(doc, closed = false) {
    // An include can change the resolved type in another open include.
    const prefix = path.basename(doc.fileName).split(".").slice(0, 2).join(".").toLowerCase();
    for (const other of vscode.workspace.textDocuments) {
      if ((!closed || other !== doc) && path.dirname(other.fileName) === path.dirname(doc.fileName) && path.basename(other.fileName).toLowerCase().startsWith(prefix + ".")) schedule(other);
    }
  }
  const subscriptions = [collection,
    vscode.workspace.onDidOpenTextDocument(changed),
    vscode.workspace.onDidChangeTextDocument((event) => changed(event.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString(); clearTimeout(timers.get(key)); timers.delete(key);
      revisions.delete(key); counts.delete(key); collection.delete(doc.uri); count();
      // Siblings now resolve against the closed file on disk.
      changed(doc, true);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("osg.kernelStrict")) for (const doc of vscode.workspace.textDocuments) schedule(doc);
    }),
  ];
  const api = {
    async allow(file, object) {
      if (mode() !== "refuse") return true;
      file ??= object && resolveFile ? await resolveFile(object) : undefined;
      if (!file) return true;
      const findings = await scanSafe(file);
      if (mode() !== "refuse") return true;
      const first = findings.find((finding) => finding.kind === "kernel-reject");
      if (!first) return true;
      const message = `osd: refusing to run ${first.message}. ${supportUrl(first)}`;
      output.appendLine(message);
      void vscode.window.showErrorMessage(message);
      return false;
    },
    dispose() {
      disposed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      for (const subscription of subscriptions) subscription.dispose();
      counts.clear(); count();
    },
  };
  context.subscriptions.push(api);
  for (const doc of vscode.workspace.textDocuments) schedule(doc);
  return api;
}
module.exports = {supportUrl, toDiagnostics, scanObject, registerKernelDiagnostics, resolveKernelObjectFile};
