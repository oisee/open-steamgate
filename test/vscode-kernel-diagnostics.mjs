import {expect} from "chai";
import {createRequire} from "node:module";
import {mkdtempSync, mkdirSync, symlinkSync, writeFileSync, renameSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {stageKernelScanner} from "../scripts/build-vsix.mjs";
const {toDiagnostics, scanObject, registerKernelDiagnostics, resolveKernelObjectFile} = createRequire(import.meta.url)("../editors/vscode/kernel-diagnostics.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finding = {file: "zcheck.prog.abap", line: 3, kind: "kernel-reject", form: "BIT-AND on i", message: "BIT-AND on i: rejected on a SAP system", supportAnchor: "docs/osg-support.md#kernel-bit-and-operand-not-x"};
function fixture() {
  const events = {}, values = new Map(), logs = [], popups = [], counts = [];
  let mode = "error";
  const doc = {fileName: "/workspace/zcheck.prog.abap", lineCount: 4, lineAt: () => ({text: "  x = n BIT-AND n."}), getText: () => "unsaved", uri: {scheme: "file", toString: () => "file:///workspace/zcheck.prog.abap"}};
  const subscribe = (name) => (listener) => { events[name] = listener; return {dispose() {}}; };
  const vscode = {
    RelativePattern: class {constructor(base, pattern) {Object.assign(this, {base, pattern});}},
    Diagnostic: class {constructor(range, message, severity) { Object.assign(this, {range, message, severity}); }},
    Range: class {constructor(...positions) {this.positions = positions;}},
    DiagnosticSeverity: {Error: 0, Warning: 1}, Uri: {parse: (uri) => uri},
    languages: {createDiagnosticCollection: (name) => {expect(name).to.equal("osd-kernel"); return {set: (uri, value) => values.set(uri.toString(), value), delete: (uri) => values.delete(uri.toString()), dispose() {}};}},
    workspace: {workspaceFolders: [{uri: {fsPath: "/workspace"}}],
      createFileSystemWatcher: (pattern) => {expect(pattern.pattern).to.equal("**/*.{abap,xml}"); return {onDidChange: subscribe("diskChange"), onDidCreate: subscribe("diskCreate"), onDidDelete: subscribe("diskDelete"), dispose() {}};},
      textDocuments: [doc], getConfiguration: () => ({get: () => mode}), getWorkspaceFolder: () => ({}),
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
  it("refuses the running duplicate and uses the later input layer in the selected home", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "osd-kernel-duplicates-"));
    const f = fixture(); f.vscode.workspace.textDocuments = [];
    const object = {type: "PROG", name: "ZCHECK"};
    try {
      symlinkSync(path.join(ROOT, "tools"), path.join(home, "tools"));
      for (const folder of ["base", "overlay"]) {
        mkdirSync(path.join(home, folder));
        writeFileSync(path.join(home, folder, finding.file), "REPORT zcheck.");
      }
      writeFileSync(path.join(home, "abap_transpile.json"), JSON.stringify({input_folder: ["base", "overlay"]}));
      const base = path.join(home, "base", finding.file), overlay = path.join(home, "overlay", finding.file);
      const api = registerKernelDiagnostics(f.vscode, {subscriptions: []}, {appendLine() {}}, {
        scan: async (file) => file === overlay ? [finding] : [],
        resolveFile: (obj) => resolveKernelObjectFile(obj, {home, running: {files: new Map([["winner", overlay]])}}),
      });
      try {
        f.setMode("refuse");
        expect(await api.allow(undefined, object)).to.equal(false);
        expect(await resolveKernelObjectFile(object, {home})).to.equal(overlay);
        expect(await resolveKernelObjectFile(object, {home, running: {files: new Map([["winner", base]])}})).to.equal(base);
        expect(await resolveKernelObjectFile(object, {home, layers: [{srcDir: path.join(home, "base")}]})).to.equal(base);
        expect(await resolveKernelObjectFile(object, {})).to.equal(undefined);
      } finally {api.dispose();}
    } finally {rmSync(home, {recursive: true, force: true});}
  });
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
  it("rescans after a closed sibling changes, is deleted, or is renamed", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "osd-kernel-disk-"));
    const file = path.join(dir, "zcheck.clas.abap"), include = path.join(dir, "zcheck.clas.locals_def.abap");
    const source = "CLASS zcheck DEFINITION PUBLIC. PUBLIC SECTION. METHODS run. ENDCLASS.\nCLASS zcheck IMPLEMENTATION. METHOD run. DATA x TYPE x. DATA n TYPE local_type. x = n BIT-AND n. ENDMETHOD. ENDCLASS.";
    writeFileSync(file, source); writeFileSync(include, "TYPES local_type TYPE i.");
    const f = fixture(); f.doc.fileName = file; f.doc.getText = () => source;
    let calls = 0;
    const api = register(f, async (...args) => {calls++; return scanObject(...args);});
    const waitForScan = async () => {for (let n = 0; n < 200 && !f.values.has(f.doc.uri.toString()); n++) await sleep(20);};
    const uri = (fsPath) => ({fsPath, toString: () => fsPath});
    try {
      await waitForScan(); expect(f.counts.at(-1)).to.equal(1);
      writeFileSync(include, "TYPES local_type TYPE x.");
      f.events.diskChange(uri(include)); f.events.diskChange(uri(include));
      expect(f.values.size).to.equal(0); await waitForScan(); expect(f.counts.at(-1)).to.equal(0); expect(calls).to.equal(2);
      writeFileSync(include, "TYPES local_type TYPE i."); f.events.diskChange(uri(include));
      await waitForScan(); expect(f.counts.at(-1)).to.equal(1);
      rmSync(include); f.events.diskDelete(uri(include));
      await waitForScan(); expect(f.counts.at(-1)).to.equal(0);
      writeFileSync(include, "TYPES local_type TYPE i."); f.events.diskCreate(uri(include));
      await waitForScan(); expect(f.counts.at(-1)).to.equal(1);
      const renamed = path.join(dir, "zother.clas.locals_def.abap"); renameSync(include, renamed);
      f.events.diskDelete(uri(include)); f.events.diskCreate(uri(renamed));
      await waitForScan(); expect(f.counts.at(-1)).to.equal(0);
    } finally {api.dispose(); rmSync(dir, {recursive: true, force: true});}
  });
  it("invalidates an in-flight sibling scan immediately on a disk event", async () => {
    const f = fixture(); let finish, calls = 0;
    const api = register(f, () => ++calls === 1 ? new Promise((resolve) => {finish = resolve;}) : []);
    try {
      await sleep(30); f.events.diskDelete({fsPath: "/workspace/zcheck.prog.xml", toString: () => "xml"});
      finish([finding]); await sleep(40);
      expect(f.counts.at(-1)).to.equal(0); expect(f.values.get(f.doc.uri.toString())).to.deep.equal([]);
    } finally {api.dispose();}
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
