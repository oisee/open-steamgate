import {expect} from "chai";
import {createRequire} from "node:module";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {stageKernelScanner} from "../scripts/build-vsix.mjs";
const {toDiagnostics, scanObject, registerKernelDiagnostics} = createRequire(import.meta.url)("../editors/vscode/kernel-diagnostics.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finding = {file: "zcheck.prog.abap", line: 3, kind: "kernel-reject", form: "BIT-AND on i", message: "BIT-AND on i: rejected on a SAP system", supportAnchor: "docs/osg-support.md#kernel-bit-and-operand-not-x"};
function fixture() {
  const events = {}, values = new Map(), logs = [], popups = [], counts = [];
  let mode = "error";
  const doc = {fileName: "/workspace/zcheck.prog.abap", lineCount: 4, lineAt: () => ({text: "  x = n BIT-AND n."}), getText: () => "unsaved", uri: {scheme: "file", toString: () => "file:///workspace/zcheck.prog.abap"}};
  const subscribe = (name) => (listener) => { events[name] = listener; return {dispose() {}}; };
  const vscode = {
    Diagnostic: class {constructor(range, message, severity) { Object.assign(this, {range, message, severity}); }},
    Range: class {constructor(...positions) {this.positions = positions;}},
    DiagnosticSeverity: {Error: 0, Warning: 1}, Uri: {parse: (uri) => uri},
    languages: {createDiagnosticCollection: (name) => {expect(name).to.equal("osd-kernel"); return {set: (uri, value) => values.set(uri.toString(), value), delete: (uri) => values.delete(uri.toString()), dispose() {}};}},
    workspace: {textDocuments: [doc], getConfiguration: () => ({get: () => mode}), getWorkspaceFolder: () => ({}),
      onDidOpenTextDocument: subscribe("open"), onDidChangeTextDocument: subscribe("change"), onDidCloseTextDocument: subscribe("close"), onDidChangeConfiguration: subscribe("config")},
    window: {showErrorMessage: (text) => popups.push(text)},
  };
  return {vscode, doc, events, values, logs, popups, counts, setMode: (value) => {mode = value; events.config({affectsConfiguration: () => true});}};
}
function register(f, scan) {
  return registerKernelDiagnostics(f.vscode, {subscriptions: []}, {appendLine: (line) => f.logs.push(line)}, {scan, delay: 10, onCount: (count) => f.counts.push(count)});
}
describe("VS Code kernel strict diagnostics", function () {
  this.timeout(15000);
  it("maps Errors and Warnings with source, support form ID, section link and zero-based range", () => {
    const f = fixture();
    const [error] = toDiagnostics(f.vscode, [finding], f.doc, "error");
    expect(error.severity).to.equal(0); expect(error.source).to.equal("OSD kernel");
    expect(error.range.positions).to.deep.equal([2, 2, 2, 18]);
    expect(error.code.value).to.equal("kernel-bit-and-operand-not-x");
    expect(error.code.target).to.equal("https://github.com/oisee/open-steamgate/blob/main/" + finding.supportAnchor);
    expect(toDiagnostics(f.vscode, [finding], f.doc, "warning")[0].severity).to.equal(1);
    expect(toDiagnostics(f.vscode, [finding], f.doc, "off")).to.deep.equal([]);
  });
  it("debounces typing, uses unsaved text, updates the count and clears on close", async () => {
    const f = fixture(); let calls = 0;
    const api = register(f, async (file, buffers) => {calls++; expect(buffers[0].source).to.equal("unsaved"); return [finding];});
    try {
      f.events.open(f.doc); f.events.change({document: f.doc}); f.events.change({document: f.doc});
      await sleep(40); expect(calls).to.equal(1); expect(f.counts.at(-1)).to.equal(1);
      f.vscode.workspace.textDocuments = []; f.events.close(f.doc);
      expect(f.values.size).to.equal(0); expect(f.counts.at(-1)).to.equal(0);
    } finally {api.dispose();}
  });
  it("respects live off/warning/error modes and only refuses execution in refuse", async () => {
    const f = fixture(); let calls = 0; const api = register(f, async () => {calls++; return [finding];});
    try {
      await sleep(30); expect(await api.allow(f.doc.fileName)).to.equal(true);
      f.setMode("off"); await sleep(30); expect(calls).to.equal(1); expect(f.values.size).to.equal(0);
      f.setMode("warning"); await sleep(30); expect(f.values.values().next().value[0].severity).to.equal(1);
      f.setMode("refuse"); expect(await api.allow(f.doc.fileName)).to.equal(false);
      expect(f.popups[0]).to.include("BIT-AND on i").and.include(finding.supportAnchor);
    } finally {api.dispose();}
  });
  it("does not republish an in-flight result after off or close", async () => {
    const f = fixture(); let finish; const api = register(f, () => new Promise((resolve) => {finish = resolve;}));
    try {await sleep(30); f.setMode("off"); finish([finding]); await sleep(20); expect(f.values.size).to.equal(0);} finally {api.dispose();}
  });
  it("rescans open sibling includes when a type changes", async () => {
    const f = fixture(); const include = {...f.doc, fileName: "/workspace/zcheck.prog.testclasses.abap", uri: {scheme: "file", toString: () => "include"}};
    f.vscode.workspace.textDocuments.push(include); let calls = 0;
    const api = register(f, async () => {calls++; return [];});
    try {f.events.change({document: include}); await sleep(40); expect(calls).to.equal(2);} finally {api.dispose();}
  });
  it("logs scanner exceptions once without a popup and allows default runs", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "osd-kernel-fail-"));
    const file = path.join(dir, finding.file); writeFileSync(file, "REPORT zcheck.");
    const f = fixture(); f.doc.fileName = file;
    const api = register(f, (file, buffers) => scanObject(file, buffers, {env: {...process.env, OSD_KERNEL_SCANNER_FAIL: "1"}}));
    try {
      for (let i = 0; i < 100 && f.logs.length === 0; i++) await sleep(20);
      expect(f.logs).to.have.length(1); expect(f.logs[0]).to.include("forced scanner failure"); expect(f.popups).to.have.length(0);
      expect(await api.allow(file)).to.equal(true);
    } finally {api.dispose(); rmSync(dir, {recursive: true, force: true});}
  });
  it("bounds a worker that never replies", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "osd-kernel-timeout-"));
    const scanner = path.join(dir, "hang.mjs"); writeFileSync(scanner, "export function kernelWarnings() {while (true) {}}\n");
    try {await scanObject(path.join(dir, finding.file), [], {scanner, timeout: 100}).then(() => {throw new Error("expected timeout");}, (error) => expect(error.message).to.include("exceeded 100 ms"));}
    finally {rmSync(dir, {recursive: true, force: true});}
  });
  it("runs the unchanged staged VSIX scanner on BIT-AND and xstring writes in an unsaved buffer", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "osd-kernel-vsix-"));
    try {
      stageKernelScanner(ROOT, dir);
      const file = path.join(dir, "zcheck.prog.abap"); writeFileSync(file, "REPORT zcheck.");
      const warnings = await scanObject(file, [{file, source: "REPORT zcheck.\nDATA n TYPE i.\nDATA x TYPE x.\nDATA xs TYPE xstring.\nx = n BIT-AND n.\nxs+0(1) = x."}], {scanner: path.join(dir, "kernel-runtime/tools/osd-kernel-compat.mjs")});
      expect(warnings.map((warning) => warning.form)).to.deep.equal(["BIT-AND on i", "offset/length write on xstring"]);
      expect(warnings.map((warning) => warning.line)).to.deep.equal([5, 6]);
    } finally {rmSync(dir, {recursive: true, force: true});}
  });
});
