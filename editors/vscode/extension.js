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
const {objectOf, adtObjectOf, fileOf, Osd, outcomes, runActionFor, entitySetLenses, methodAtLine, resultRows, stripMetadata, keyOf,
  readersLensLine, readersLensTitle, readersQuickPickItems, readerFilePattern,
  freestyleTableHtml, notebookFromJson, notebookToJson,
  hotspotBucket, hotspotColor, hotspotBadge, hotspotHoverText} = require("./lib.js");

// Q6a "Notebook SQL" (docs/vscode-extension.md): the notebook type a
// *.osdnb file opens as (package.json `contributes.notebooks`) and the
// kernel that runs its cells.
const NOTEBOOK_TYPE = "osd-sql-notebook";

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

  // Q4 "Hotspots" (docs/vscode-extension.md): line decorations and an
  // explorer badge off ZOSD_DUMP, refreshed by command, by a timer and
  // after osd.run / osd.activate (both registered below, which call
  // refreshHotspots() themselves once their own work is done).
  context.subscriptions.push(hotspots(context, output));
  context.subscriptions.push(vscode.commands.registerCommand("osd.refreshHotspots", () => refreshHotspots(output)));

  // Ctrl+F2 / Ctrl+F3 (docs/vscode-extension.md): one diagnostic collection
  // for both, so an activation that passes clears what a check had left, and
  // the other way round.
  const diagnostics = vscode.languages.createDiagnosticCollection("osd-abap");
  context.subscriptions.push(diagnostics);
  context.subscriptions.push(vscode.commands.registerCommand("osd.check", () => check(diagnostics, output)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.activate", () => activateCurrent(diagnostics, output)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.run", () => run(output)));

  // Q2b "Runner" (docs/vscode-extension.md): a lens over each
  // `<set>_get_entityset` / `<set>_get_entity` method of a SEGW _DPC_EXT
  // class, and the command it (and F8, above) both call.
  context.subscriptions.push(vscode.commands.registerCommand("osd.callEntitySet", (args) => callEntitySet(args, output)));
  context.subscriptions.push(entitySetLensProvider(output));

  // Q3 "Readers" (docs/vscode-extension.md): a lens "read by N · tests M ·
  // services K" over a class's or an interface's own definition line, and
  // the quick pick a click on it opens.
  context.subscriptions.push(vscode.commands.registerCommand("osd.showReaders", (found) => showReaders(found, output)));
  context.subscriptions.push(readersLensProvider(output));

  // Q6a "Notebook SQL" (docs/vscode-extension.md): a *.osdnb notebook of SQL
  // cells over the ADT façade's freestyle data preview.
  context.subscriptions.push(vscode.workspace.registerNotebookSerializer(NOTEBOOK_TYPE, sqlNotebookSerializer()));
  context.subscriptions.push(sqlNotebookController(output));
  context.subscriptions.push(vscode.commands.registerCommand("osd.newSqlNotebook", newSqlNotebook));
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

// ---- Q4 "Hotspots" (docs/vscode-extension.md): ZOSD_DUMP as heat -- line
// decorations in an .abap editor and a dump-count badge in the explorer, off
// the counts osd().hotspots() reads through the freestyle SQL door Q6a's
// notebook already uses. `state.data` is the one place the numbers live
// (`{byLine, byFile}`, lib.js `hotspotsFromRows`'s own shape); everything
// below reads it rather than asking the server again.

/** One `vscode.TextEditorDecorationType` per intensity bucket (lib.js
 *  `hotspotBucket`, 1-4), built once and kept for the life of the
 *  extension -- a decoration type is a VS Code resource, and a fresh set
 *  per refresh would leak one on every tick. */
function hotspotDecorationTypes() {
  if (hotspotDecorationTypes.types === undefined) {
    hotspotDecorationTypes.types = [1, 2, 3, 4].map((bucket) => vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: hotspotColor(bucket),
      overviewRulerColor: hotspotColor(bucket),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    }));
  }
  return hotspotDecorationTypes.types;
}

function decorateEditor(editor, state) {
  if (editor === undefined || !/\.abap$/i.test(editor.document.fileName)) return;
  const object = adtObjectOf(editor.document.fileName);
  const types = hotspotDecorationTypes();
  if (object === undefined) {
    types.forEach((t) => editor.setDecorations(t, []));
    return;
  }
  // perBucket[0] is bucket 1 (one dump), ... perBucket[3] bucket 4 (10+)
  const perBucket = [[], [], [], []];
  for (const entry of state.data.byLine) {
    if (entry.objname !== object.name || entry.include !== object.include) continue;
    const range = new vscode.Range(entry.line - 1, 0, entry.line - 1, 0);
    perBucket[hotspotBucket(entry.count) - 1].push({range, hoverMessage: hotspotHoverText(entry)});
  }
  types.forEach((type, i) => editor.setDecorations(type, perBucket[i]));
}

function decorateVisibleEditors(state) {
  for (const editor of vscode.window.visibleTextEditors) decorateEditor(editor, state);
}

/** `vscode.FileDecorationProvider`: the dump-count badge on an .abap file
 *  in the explorer, off `state.data.byFile` (summed over every include of
 *  the object -- an explorer badge is on the file, not on a class's one
 *  main include). Undefined (no badge) for a file with no dumps, rather
 *  than a "0" nobody asked to see. */
function hotspotFileDecorationProvider(state) {
  return {
    onDidChangeFileDecorations: state.emitter.event,
    provideFileDecoration(uri) {
      if (!/\.abap$/i.test(uri.fsPath)) return undefined;
      const object = adtObjectOf(uri.fsPath);
      const count = object === undefined ? undefined : state.data.byFile[object.name];
      if (!count) return undefined;
      return {
        badge: hotspotBadge(count),
        color: new vscode.ThemeColor("problemsErrorIcon.foreground"),
        tooltip: `${count} dump${count === 1 ? "" : "s"} (osd: Refresh hotspots)`,
      };
    },
  };
}

async function refreshHotspots(output, state) {
  const target = state ?? refreshHotspots.state;
  if (target === undefined) return;
  try {
    target.data = await osd().hotspots();
  } catch (e) {
    output.appendLine(`osd hotspots: ${String(e.message ?? e)}`);
    target.data = {byLine: [], byFile: {}};
  }
  decorateVisibleEditors(target);
  target.emitter.fire(undefined); // every explorer badge this provider owns
}

/** Wires Q4 up: the state `refreshHotspots`/`decorateEditor` share, the
 *  FileDecorationProvider, a refresh on every visible-editor change (a
 *  newly opened editor has had no `setDecorations` call yet) and the timer
 *  (`osd.hotspots.refreshSeconds`, default 30, 0 = off; re-read on a
 *  settings change rather than only at startup). */
function hotspots(context, output) {
  const state = {data: {byLine: [], byFile: {}}, emitter: new vscode.EventEmitter()};
  refreshHotspots.state = state;
  const provider = vscode.window.registerFileDecorationProvider(hotspotFileDecorationProvider(state));
  const onVisible = vscode.window.onDidChangeVisibleTextEditors(() => decorateVisibleEditors(state));

  let timer;
  const restartTimer = () => {
    if (timer !== undefined) clearInterval(timer);
    const seconds = vscode.workspace.getConfiguration("osd").get("hotspots.refreshSeconds", 30);
    timer = seconds > 0 ? setInterval(() => refreshHotspots(output, state), seconds * 1000) : undefined;
  };
  restartTimer();
  const onConfig = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("osd.hotspots.refreshSeconds")) restartTimer();
  });

  refreshHotspots(output, state);
  return {
    dispose: () => {
      if (timer !== undefined) clearInterval(timer);
      provider.dispose();
      onVisible.dispose();
      onConfig.dispose();
      state.emitter.dispose();
      for (const t of hotspotDecorationTypes()) t.dispose();
      refreshHotspots.state = undefined;
    },
  };
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
    // Q4: an activation is the point a class's own line numbers can have
    // moved, so the heat this object's decorations show is worth a refresh
    // even when nothing has dumped -- and if something had, this is also
    // the soonest an editor open on it would see the new count.
    void refreshHotspots(output);
  } catch (e) {
    output.appendLine(`osd activate ${object.name}: ${String(e.message ?? e)}`);
    vscode.window.showErrorMessage(`osd activate: ${String(e.message ?? e)}`);
  }
}

// ---- F8: SE80's own key, dispatched by object type (lib.js RUN_TABLE).
// A class with ABAP Unit tests, and now the cursor inside a SEGW _DPC_EXT
// class's own `<set>_get_entityset` / `<set>_get_entity` method (Q2b,
// below), reach a real action; everything else answers the text of the
// server work its turn would add.

async function run(output) {
  const current = currentObject();
  if (current === undefined) return;
  const {editor, object} = current;
  const hasUnitTests = fs.existsSync(fileOf(path.dirname(editor.document.fileName), object, "testclasses"));
  let entitySet;
  if (object.type === "CLAS" && /_DPC_EXT$/i.test(object.name)) {
    const method = methodAtLine(editor.document.getText(), editor.selection.active.line);
    if (method !== undefined) {
      try {
        const map = await osd().entitySets(object.name);
        const found = map?.sets.find((s) => s.method === method);
        if (found !== undefined) entitySet = {service: map.service, set: found.set, entityKind: found.kind};
      } catch (e) {
        // osd down, or the class is not a registered service's DPC: F8
        // falls back to the "not yet" text rather than failing silently
        output.appendLine(`osd run ${object.name}: ${String(e.message ?? e)}`);
      }
    }
  }
  const action = runActionFor(object, {hasUnitTests, entitySet});
  // Q4: a run is server work, so it is a point the table this object's own
  // heat comes from may have changed -- fire-and-forget, the same as the
  // timer, so F8 does not wait on it.
  void refreshHotspots(output);
  if (action.kind === "unit") {
    await vscode.commands.executeCommand("testing.runCurrentFile");
    return;
  }
  if (action.kind === "call-entityset") {
    await callEntitySet({service: action.service, set: action.set, kind: action.entityKind}, output);
    return;
  }
  output.appendLine(`osd run ${object.name}: ${action.text}`);
  vscode.window.showInformationMessage(`osd: ${action.text}`);
}

// ---- Q2b "Runner": a CodeLens "▶ Call <Set>" above each
// `<set>_get_entityset` / `<set>_get_entity` method of a SEGW _DPC_EXT
// class, and the GET it and F8 (above) both run -- the URL, the status,
// the time and the row count in a webview table, a "raw JSON" toggle
// beside it. lib.js entitySetLenses does the placement (a plain text scan,
// tested without VS Code); this asks the server for the class's own map
// (tools/adt-facade.mjs `core/http/segw/entitysets`) and turns what it
// finds into `vscode.CodeLens`es.

function entitySetLensProvider(output) {
  const emitter = new vscode.EventEmitter();
  const provider = {
    onDidChangeCodeLenses: emitter.event,
    async provideCodeLenses(document) {
      const object = adtObjectOf(document.fileName);
      if (object === undefined || object.type !== "CLAS" || !/_DPC_EXT$/i.test(object.name)) return [];
      let map;
      try {
        map = await osd().entitySets(object.name);
      } catch (e) {
        output.appendLine(`osd entitysets ${object.name}: ${String(e.message ?? e)}`);
        return [];
      }
      return entitySetLenses(document.getText(), map).map((lens) => {
        const range = new vscode.Range(lens.line - 1, 0, lens.line - 1, 0);
        return new vscode.CodeLens(range, {
          title: lens.title,
          command: "osd.callEntitySet",
          arguments: [{service: lens.service, set: lens.set, kind: lens.kind}],
        });
      });
    },
  };
  const registration = vscode.languages.registerCodeLensProvider({pattern: "**/*.abap"}, provider);
  // a save can add, redefine or rename an entity-set method: the class's
  // map the next provideCodeLenses asks for may have changed under it
  const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (/_dpc_ext\.clas\.abap$/i.test(doc.fileName)) emitter.fire();
  });
  return {dispose: () => { registration.dispose(); onSave.dispose(); }};
}

/** `{service, set, kind}` (a lens's own command arguments, or F8's) into
 *  the GET and the webview: `get_entityset` calls the set with `$top=20`;
 *  `get_entity` first asks the set for one row to default the key prompt
 *  to (lib.js `keyOf`, off `__metadata.uri` -- this client does not
 *  otherwise know the entity type's key properties), then calls the one
 *  entity. Cancelling the prompt leaves nothing called. */
async function callEntitySet({service, set, kind}, output) {
  try {
    if (kind === "get_entity") {
      const probe = await osd().odata(service, `${set}?$top=1&$format=json`);
      const defaultKey = keyOf(resultRows(probe.body)[0]);
      const key = await vscode.window.showInputBox({
        prompt: `Key for ${set}`,
        value: defaultKey ?? "",
        placeHolder: "e.g. 'T0001', or TravelID='T0001',BookingID='0001'",
      });
      if (key === undefined) return;
      const call = await osd().odata(service, `${set}(${key})?$format=json`);
      showEntitySetResult(`${set}(${key})`, call);
    } else {
      const call = await osd().odata(service, `${set}?$top=20&$format=json`);
      showEntitySetResult(set, call);
    }
  } catch (e) {
    output.appendLine(`osd call ${set}: ${String(e.message ?? e)}`);
    vscode.window.showErrorMessage(`osd: ${String(e.message ?? e)}`);
  }
}

function showEntitySetResult(title, call) {
  const panel = vscode.window.createWebviewPanel("osdEntitySet", title, vscode.ViewColumn.Beside, {enableScripts: true});
  const rows = resultRows(call.body).map(stripMetadata);
  panel.webview.html = entitySetHtml(title, call, rows);
}

function xmlEscapeHtml(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function entitySetHtml(title, call, rows) {
  const columns = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  const thead = columns.map((c) => `<th>${xmlEscapeHtml(c)}</th>`).join("");
  const tbody = rows.map((row) => `<tr>${columns.map((c) => `<td>${xmlEscapeHtml(cellText(row[c]))}</td>`).join("")}</tr>`).join("");
  const rawJson = xmlEscapeHtml(JSON.stringify(call.body !== undefined ? call.body : call.text, undefined, 2));
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); font-size: 13px; padding: 8px; color: var(--vscode-foreground); }
  .meta { margin-bottom: 8px; opacity: 0.85; }
  .meta div { margin: 2px 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid var(--vscode-panel-border, #555); padding: 4px 8px; text-align: left; white-space: nowrap; }
  th { background: var(--vscode-editor-lineHighlightBackground, #2a2a2a); }
  pre { white-space: pre-wrap; word-break: break-word; display: none; }
  label { user-select: none; cursor: pointer; }
</style>
</head>
<body>
  <div class="meta">
    <div>${xmlEscapeHtml(call.url)}</div>
    <div>HTTP ${call.status} -- ${call.ms} ms -- ${rows.length} row(s)</div>
    <label><input type="checkbox" id="raw-toggle"> raw JSON</label>
  </div>
  <table id="rows-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
  <pre id="raw-json">${rawJson}</pre>
  <script>
    const toggle = document.getElementById("raw-toggle");
    const table = document.getElementById("rows-table");
    const raw = document.getElementById("raw-json");
    toggle.addEventListener("change", () => {
      table.style.display = toggle.checked ? "none" : "";
      raw.style.display = toggle.checked ? "block" : "none";
    });
  </script>
</body>
</html>`;
}

// ---- Q3 "Readers": a CodeLens "read by N · tests M · services K" over a
// class's own `CLASS <name> DEFINITION` line or an interface's own
// `INTERFACE <name>` line (tools/adt-facade.mjs `core/http/xref/readers`,
// the reverse of Q2b's own class-to-service map). lib.js readersLensLine
// does the placement (a plain text scan, tested without VS Code); this asks
// the server for the object's own readers and turns what it finds into one
// `vscode.CodeLens`. A click opens a quick pick of the readers (Test /
// Service tagged) and opens the file of the one chosen.

function readersLensProvider(output) {
  const emitter = new vscode.EventEmitter();
  const provider = {
    onDidChangeCodeLenses: emitter.event,
    async provideCodeLenses(document) {
      const object = adtObjectOf(document.fileName);
      if (object === undefined || (object.type !== "CLAS" && object.type !== "INTF") || object.include !== "main") return [];
      const line = readersLensLine(document.getText(), object);
      if (line === undefined) return [];
      let found;
      try {
        found = await osd().readers(object.type, object.name);
      } catch (e) {
        output.appendLine(`osd readers ${object.name}: ${String(e.message ?? e)}`);
        return [];
      }
      if (found === undefined) return [];
      const range = new vscode.Range(line - 1, 0, line - 1, 0);
      return [new vscode.CodeLens(range, {
        title: readersLensTitle(found.counts),
        command: "osd.showReaders",
        arguments: [found],
      })];
    },
  };
  const registration = vscode.languages.registerCodeLensProvider({pattern: "**/*.abap"}, provider);
  // a save can add, rename or remove a reference this class's readers count
  // depends on, in this file or in whichever other file did the referencing
  const onSave = vscode.workspace.onDidSaveTextDocument(() => emitter.fire());
  return {dispose: () => { registration.dispose(); onSave.dispose(); }};
}

async function showReaders(found, output) {
  if (found === undefined) return;
  if (found.readers.length === 0) {
    vscode.window.showInformationMessage(`osd: nothing reads ${found.name}`);
    return;
  }
  const picked = await vscode.window.showQuickPick(readersQuickPickItems(found.readers), {placeHolder: `Readers of ${found.name}`});
  if (picked === undefined) return;
  const pattern = readerFilePattern(picked.reader);
  if (pattern === undefined) {
    vscode.window.showInformationMessage(`osd: ${picked.reader.name} (${picked.reader.type}) has no source file this extension knows how to open`);
    return;
  }
  try {
    const files = await vscode.workspace.findFiles(pattern, EXCLUDE, 1);
    if (files.length === 0) {
      vscode.window.showWarningMessage(`osd: ${picked.reader.name}'s file was not found in this workspace`);
      return;
    }
    await vscode.window.showTextDocument(files[0]);
  } catch (e) {
    output.appendLine(`osd show readers ${found.name}: ${String(e.message ?? e)}`);
    vscode.window.showErrorMessage(`osd: ${String(e.message ?? e)}`);
  }
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

// ---- Q6a "Notebook SQL": a *.osdnb file is a small JSON document of SQL
// (or markdown) cells (lib.js notebookFromJson / notebookToJson does the
// pure JSON <-> cells half); running a cell POSTs it to the ADT façade's
// freestyle data preview (lib.js Osd#freestyle, tools/adt-facade.mjs
// `datapreview/freestyle`) and shows the rows under it, the way a Jupyter
// SQL kernel would -- except the "kernel" is the same running osd every
// other door in this extension already talks to, not a second process.

function sqlNotebookSerializer() {
  return {
    deserializeNotebook(content) {
      const text = Buffer.from(content).toString("utf8");
      const cells = notebookFromJson(text).map((c) => new vscode.NotebookCellData(
        c.kind === "markdown" ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code,
        c.value,
        c.language,
      ));
      return new vscode.NotebookData(cells);
    },
    serializeNotebook(data) {
      const cells = data.cells.map((c) => ({
        kind: c.kind === vscode.NotebookCellKind.Markup ? "markdown" : "code",
        language: c.languageId,
        value: c.value,
      }));
      return Buffer.from(notebookToJson(cells), "utf8");
    },
  };
}

async function newSqlNotebook() {
  const data = new vscode.NotebookData([
    new vscode.NotebookCellData(vscode.NotebookCellKind.Code, "SELECT * FROM zstg_demo", "sql"),
  ]);
  const doc = await vscode.workspace.openNotebookDocument(NOTEBOOK_TYPE, data);
  await vscode.window.showNotebookDocument(doc);
}

function sqlNotebookController(output) {
  const controller = vscode.notebooks.createNotebookController("osd-sql-kernel", NOTEBOOK_TYPE, "osd SQL");
  controller.supportedLanguages = ["sql"];
  controller.supportsExecutionOrder = true;
  let executionOrder = 0;
  controller.executeHandler = (cells) => {
    for (const cell of cells) runSqlCell(controller, cell, ++executionOrder, output);
  };
  return controller;
}

async function runSqlCell(controller, cell, executionOrder, output) {
  const execution = controller.createNotebookCellExecution(cell);
  execution.executionOrder = executionOrder;
  execution.start(Date.now());
  const rowLimit = vscode.workspace.getConfiguration("osd").get("notebook.rowLimit", 100);
  try {
    const result = await osd().freestyle(cell.document.getText(), rowLimit);
    const html = freestyleTableHtml(result.columns, result.rows, {ms: result.ms, generation: result.generation});
    await execution.replaceOutput([
      new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.text(html, "text/html"),
        vscode.NotebookCellOutputItem.json(result.rows),
      ]),
    ]);
    execution.end(true, Date.now());
  } catch (e) {
    const message = String(e.message ?? e);
    output.appendLine(`osd sql: ${message}`);
    await execution.replaceOutput([
      new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error({name: "osd", message})]),
    ]);
    execution.end(false, Date.now());
  }
}

function deactivate() {}

module.exports = {activate, deactivate};
