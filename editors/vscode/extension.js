// A thin VS Code client of a running osd (Q2, docs/vscode-extension.md).
//
// It holds no ABAP and runs nothing itself: the Test Explorer asks the ADT
// façade which test classes an object has and runs them there, the status
// bar reads /osd/serving, and the dump list is /osd/dumps. abaplint stays
// the language server; this adds only what needs a running system.
"use strict";

const vscode = require("vscode");
const path = require("node:path");
const fs = require("node:fs");
const {objectOf, adtObjectOf, fileOf, Osd, outcomes, runActionFor} = require("./lib.js");

const EXCLUDE = "{**/node_modules/**,**/.local/**,**/output/**,**/gen/**,**/build/**}";

function osd() {
  const url = vscode.workspace.getConfiguration("osd").get("url", "http://localhost:3030");
  if (osd.client?.url !== url.replace(/\/+$/, "")) osd.client = new Osd(url);
  return osd.client;
}

function activate(context) {
  const output = vscode.window.createOutputChannel("osd");
  context.subscriptions.push(output);
  context.subscriptions.push(statusBar(context));
  context.subscriptions.push(testExplorer(output));
  context.subscriptions.push(vscode.commands.registerCommand("osd.showDumps", () => showDumps(output)));

  // Ctrl+F2 / Ctrl+F3 (docs/vscode-extension.md): one diagnostic collection
  // for both, so an activation that passes clears what a check had left, and
  // the other way round.
  const diagnostics = vscode.languages.createDiagnosticCollection("osd-abap");
  context.subscriptions.push(diagnostics);
  context.subscriptions.push(vscode.commands.registerCommand("osd.check", () => check(diagnostics, output)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.activate", () => activateCurrent(diagnostics, output)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.run", () => run(output)));
}

// ---- status bar: which generation the system serves, or that it is down

function statusBar(context) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  item.command = "osd.showDumps";
  item.show();
  let dumpsSeen;
  const tick = async () => {
    try {
      const serving = await osd().serving();
      const dumps = await osd().dumps().catch(() => []);
      const generation = String(serving.generation ?? "?").slice(0, 8);
      const hot = serving.hot?.swaps ? ` +${serving.hot.swaps}` : "";
      item.text = `$(server) osd ${generation}${hot}${dumps.length ? `  $(bug) ${dumps.length}` : ""}`;
      item.tooltip = `${osd().url}\ngeneration ${serving.generation}\npid ${serving.pid}\n${dumps.length} short dump(s) -- click to list`;
      item.backgroundColor = dumpsSeen !== undefined && dumps.length > dumpsSeen
        ? new vscode.ThemeColor("statusBarItem.errorBackground") : undefined;
      dumpsSeen ??= dumps.length;
    } catch {
      item.text = "$(debug-disconnect) osd down";
      item.tooltip = `nothing answers /osd/serving at ${osd().url} (setting osd.url)`;
      item.backgroundColor = undefined;
    }
  };
  tick();
  const timer = setInterval(tick, 5000);
  context.subscriptions.push({dispose: () => clearInterval(timer)});
  return item;
}

async function showDumps(output) {
  try {
    const dumps = await osd().dumps();
    output.clear();
    if (dumps.length === 0) output.appendLine("No short dumps.");
    for (const d of dumps) {
      output.appendLine(JSON.stringify(d, undefined, 2));
      output.appendLine("");
    }
  } catch (e) {
    output.appendLine(String(e.message ?? e));
  }
  output.show(true);
}

// ---- Ctrl+F2 / Ctrl+F3: check and activate the object of the current editor
// (docs/vscode-extension.md), over the ADT façade's checkruns and activation
// routes (tools/adt-facade.mjs). Both keys apply to the whole object, not
// only the include that happens to be open, so an edit in the definitions
// part is checked and activated along with the implementations beside it.

function currentObject() {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) return undefined;
  const object = adtObjectOf(editor.document.fileName);
  return object === undefined ? undefined : {editor, object};
}

// severity -> vscode.DiagnosticSeverity; A and X are ABAP's abort/exception
// levels and read as errors the same as E
function severityOf(code) {
  if (code === "W") return vscode.DiagnosticSeverity.Warning;
  if (code === "I" || code === "S") return vscode.DiagnosticSeverity.Information;
  return vscode.DiagnosticSeverity.Error;
}

function diagnosticAt(line, column, message, severity) {
  const at = new vscode.Position(Math.max(0, (line ?? 1) - 1), Math.max(0, (column ?? 1) - 1));
  return new vscode.Diagnostic(new vscode.Range(at, at.translate(0, 1)), message, severityOf(severity));
}

async function check(diagnostics, output) {
  const current = currentObject();
  if (current === undefined) return;
  const {editor, object} = current;
  try {
    const reports = await osd().check(object, object.include, editor.document.getText());
    const issues = reports.flatMap((r) => r.issues);
    diagnostics.set(editor.document.uri, issues.map((i) => diagnosticAt(i.line, i.column, i.message, i.severity)));
    const failed = reports.filter((r) => r.status === "notProcessed");
    if (failed.length > 0) {
      vscode.window.showErrorMessage(`osd check: ${failed.map((r) => r.statusText).join("; ")}`);
    } else {
      vscode.window.setStatusBarMessage(`osd check: ${issues.length === 0 ? "no errors" : `${issues.length} issue(s)`}`, 5000);
    }
  } catch (e) {
    output.appendLine(`osd check ${object.name}: ${String(e.message ?? e)}`);
    vscode.window.showErrorMessage(`osd check: ${String(e.message ?? e)}`);
  }
}

async function activateCurrent(diagnostics, output) {
  const current = currentObject();
  if (current === undefined) return;
  const {editor, object} = current;
  if (editor.document.isDirty) await editor.document.save();
  try {
    const result = await osd().activate(object);
    if (result.ok) {
      diagnostics.delete(editor.document.uri);
      const generation = String(result.generation ?? "?").slice(0, 8);
      vscode.window.setStatusBarMessage(`osd: ${object.name} activated, generation ${generation}`, 5000);
    } else {
      // an issue names the object it belongs to (objDescr); the ones this
      // editor's object owns go on it, the rest -- what activating it broke
      // elsewhere -- go to the output channel rather than nowhere
      const own = result.issues.filter((i) => i.objDescr === object.name || i.objDescr === "");
      const elsewhere = result.issues.filter((i) => i.objDescr !== object.name && i.objDescr !== "");
      diagnostics.set(editor.document.uri, own.map((i) => diagnosticAt(i.line, i.column, i.message)));
      if (elsewhere.length > 0) {
        output.appendLine(`osd activate ${object.name}: also broke ${elsewhere.map((i) => `${i.objDescr} (${i.message})`).join("; ")}`);
      }
      vscode.window.showErrorMessage(`osd: ${object.name} did not activate (${result.issues.length || "no"} issue(s), see Problems)`);
    }
  } catch (e) {
    output.appendLine(`osd activate ${object.name}: ${String(e.message ?? e)}`);
    vscode.window.showErrorMessage(`osd activate: ${String(e.message ?? e)}`);
  }
}

// ---- F8: SE80's own key, dispatched by object type (lib.js RUN_TABLE).
// Only a class with ABAP Unit tests reaches a real action today; everything
// else answers the text of the server work its turn would add.

async function run(output) {
  const current = currentObject();
  if (current === undefined) return;
  const {editor, object} = current;
  const hasUnitTests = fs.existsSync(fileOf(path.dirname(editor.document.fileName), object, "testclasses"));
  const action = runActionFor(object, {hasUnitTests});
  if (action.kind === "unit") {
    await vscode.commands.executeCommand("testing.runCurrentFile");
    return;
  }
  output.appendLine(`osd run ${object.name}: ${action.text}`);
  vscode.window.showInformationMessage(`osd: ${action.text}`);
}

// ---- Test Explorer: one item per object, its test classes and methods below

function testExplorer(output) {
  const controller = vscode.tests.createTestController("osd-abap-unit", "ABAP Unit (osd)");
  const objects = new Map(); // item id -> {object, dir}

  const objectItem = (uri) => {
    const object = objectOf(uri.fsPath);
    if (object === undefined) return undefined;
    const id = `${object.type}:${object.name}`;
    let item = controller.items.get(id);
    if (item === undefined) {
      item = controller.createTestItem(id, object.name, vscode.Uri.file(fileOf(path.dirname(uri.fsPath), object, "testclasses")));
      item.canResolveChildren = true;
      controller.items.add(item);
      objects.set(id, {object, dir: path.dirname(uri.fsPath)});
    }
    return item;
  };

  const discover = async (item) => {
    const {object, dir} = objects.get(item.id);
    item.busy = true;
    try {
      const found = await osd().discover(object);
      const classes = [];
      // a class without test methods (the global class of a test-only
      // object is listed too) has nothing to run
      for (const testClass of (found.classes ?? []).filter((c) => (c.methods ?? []).length > 0)) {
        const file = vscode.Uri.file(fileOf(dir, object, testClass.include));
        const classItem = controller.createTestItem(`${item.id}/${testClass.name}`, testClass.name, file);
        classItem.range = new vscode.Range(Math.max(0, testClass.line - 1), 0, Math.max(0, testClass.line - 1), 0);
        for (const m of testClass.methods ?? []) {
          const methodItem = controller.createTestItem(`${classItem.id}/${m.name}`, m.name, file);
          methodItem.range = new vscode.Range(Math.max(0, m.line - 1), 0, Math.max(0, m.line - 1), 0);
          classItem.children.add(methodItem);
        }
        classes.push(classItem);
      }
      item.children.replace(classes);
      item.error = undefined;
    } catch (e) {
      item.error = String(e.message ?? e);
    } finally {
      item.busy = false;
    }
  };

  controller.resolveHandler = async (item) => {
    if (item === undefined) {
      for (const uri of await vscode.workspace.findFiles("**/*.clas.testclasses.abap", EXCLUDE)) objectItem(uri);
      return;
    }
    await discover(item);
  };

  const watcher = vscode.workspace.createFileSystemWatcher("**/*.clas.testclasses.abap");
  watcher.onDidCreate((uri) => objectItem(uri));
  watcher.onDidChange((uri) => {
    const item = objectItem(uri);
    if (item !== undefined && item.children.size > 0) discover(item);
  });

  const runHandler = async (request, token) => {
    const run = controller.createTestRun(request);
    // what was asked, grouped by object: the server runs one object at a time
    const asked = request.include ?? [...gather(controller.items)];
    const byObject = new Map();
    for (const item of asked) {
      const [objectId, testClass, method] = item.id.split("/");
      if (!byObject.has(objectId)) byObject.set(objectId, []);
      byObject.get(objectId).push({item, testClass, method});
    }
    for (const [objectId, selections] of byObject) {
      if (token.isCancellationRequested) break;
      const objectItemOf = controller.items.get(objectId);
      if (objectItemOf.children.size === 0) await discover(objectItemOf);
      const {object, dir} = objects.get(objectId);
      for (const sel of selections) {
        const methods = leaves(sel.item);
        methods.forEach((m) => run.started(m));
        try {
          const answer = await osd().run(object, sel.testClass, sel.method);
          const results = outcomes(answer, methods.map((m) => ({testClass: m.id.split("/")[1], method: m.id.split("/")[2]})));
          for (const m of methods) {
            const [, testClass, method] = m.id.split("/");
            const result = results.find((r) => r.testClass === testClass && r.method === method);
            if (result === undefined) {
              run.skipped(m);
            } else if (result.passed) {
              run.passed(m, result.ms);
            } else {
              run.failed(m, result.alerts.map((a) => message(a, dir, m)), result.ms);
            }
          }
          run.appendOutput(`${object.name}: ${answer.counts?.passed ?? 0} passed, ${answer.counts?.failed ?? 0} failed in ${answer.ms ?? 0} ms\r\n`);
        } catch (e) {
          const text = new vscode.TestMessage(String(e.message ?? e));
          methods.forEach((m) => run.errored(m, text));
          output.appendLine(String(e.message ?? e));
        }
      }
    }
    run.end();
  };
  controller.createRunProfile("Run", vscode.TestRunProfileKind.Run, runHandler, true);
  controller.refreshHandler = async () => {
    controller.items.replace([]);
    objects.clear();
    await controller.resolveHandler(undefined);
  };
  return {dispose: () => { watcher.dispose(); controller.dispose(); }};
}

function* gather(collection) {
  for (const [, item] of collection) yield item;
}

// the methods under an item, or the item itself when it is one
function leaves(item) {
  if (item.id.split("/").length === 3) return [item];
  const out = [];
  for (const [, child] of item.children) out.push(...leaves(child));
  return out;
}

function message(alert, dir, item) {
  const text = new vscode.TestMessage([alert.title, ...alert.details].join("\n"));
  const expected = alert.details.find((d) => d.startsWith("Expected ["));
  const actual = alert.details.find((d) => d.startsWith("Actual ["));
  if (expected !== undefined && actual !== undefined) {
    text.expectedOutput = expected.slice("Expected [".length, -1);
    text.actualOutput = actual.slice("Actual [".length, -1);
  }
  text.location = alert.frame !== undefined
    ? new vscode.Location(vscode.Uri.file(path.join(dir, alert.frame.file)), new vscode.Position(alert.frame.line - 1, Math.max(0, alert.frame.column - 1)))
    : new vscode.Location(item.uri, item.range ?? new vscode.Position(0, 0));
  return text;
}

function deactivate() {}

module.exports = {activate, deactivate};
