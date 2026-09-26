// The VS Code extension's logic that needs no VS Code (editors/vscode/lib.js):
// which object a file is, where its includes live, and what a unit run's
// answer means per method. The live half, against a real server, is in
// test/osd-child.mjs.
import {expect} from "chai";
import express from "express";
import {readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {checkReportDocument, activationSuccessDocument, activationFailureDocument, uriOf as facadeUriOf} from "../tools/adt-documents.mjs";
import {entitySetMapFor} from "../tools/segw-entityset-map.mjs";
import {adtRouter, tableDataDocument} from "../tools/adt-facade.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

const {objectOf, adtObjectOf, uriOf, fileOf, Osd, outcomes, abapFrame, parseCheckReport, parseActivationResult, runActionFor,
  entitySetMethodLines, entitySetLenses, methodAtLine, resultRows, stripMetadata, keyOf,
  readersLensLine, readersLensTitle, readersQuickPickItems, readerFilePattern,
  htmlEscape, freestyleRows, freestyleTableHtml, freestyleOutputItems, notebookAbapSource, amdpCellResult,
  notebookFromJson, notebookToJson,
  HOTSPOTS_SQL, hotspotsFromRows, hotspotBucket, hotspotColor, hotspotBadge, hotspotHoverText,
  implementsClassrun,
  dataPreviewObjectOf, tablHasMandt, MANDT_CLIENT, dataPreviewQuery, dataPreviewCountQuery, dataPreviewStatusText, dataPreviewRows,
  transpileLayers, classifyTestPath, PACKAGE_SPLIT_THRESHOLD, needsPackageSplit, packageDirsFrom, packageOf, hasTestMethods,
  demoFailureObjects, progTcodeOf, webguiTransactionUrl, webguiPanelHtml, runWebguiPanel, progRunLens,
  SERVICE_GROUP_ORDER, serviceGroupLabel, normalizeServiceSetRow, normalizeServiceRow, groupServices, serviceLabel,
  serviceContextValue, serviceActionContext, normalizeTransactionRow, appManifestDetails, httpTestFiles, closureTestNames,
  dumpsForService, serviceDetailsHtml, serviceHttpUrl, serviceMetadataUrl, serviceMetadataExternalUrl, serviceWsUrl, serviceClassNodes,
  warmStatusText, activationBuildText, closureTestsText,
  PRESETS, presetSettings, isOpenSteamgateCheckout, osdHomeChoice, osdStateContext, SYSTEM_STATUS_SETS,
  odataV2Results, systemOverviewModel,
  debuggerConfiguration, debugAttachPlan, runWithDebuggerAttach, breakpointToggleText} =
  createRequire(import.meta.url)("../editors/vscode/lib.js");
const {overviewStatusSection, systemOverviewHtml} = createRequire(import.meta.url)("../editors/vscode/system-overview.js");
import {implementsClassrun as facadeImplementsClassrun} from "../tools/osd-classrun.mjs";
import {namesOf as guiConvertNamesOf} from "../tools/osd-gui-convert.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const Module = require("node:module");

function loadExtension(vscodeApi) {
  const extensionPath = require.resolve("../editors/vscode/extension.js");
  delete require.cache[extensionPath];
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "vscode") return vscodeApi;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(extensionPath);
  } finally {
    Module._load = originalLoad;
  }
}

function loadSystemController(vscodeApi) {
  return loadExtension(vscodeApi).SystemController;
}

function loadTreeItems(vscodeApi) {
  const {OsdTreeProvider, TransactionItem} = loadExtension(vscodeApi);
  return {OsdTreeProvider, TransactionItem};
}

function vscodeStub(settings = {}) {
  class EventEmitter {
    listeners = new Set();
    event = (listener) => {
      this.listeners.add(listener);
      return {dispose: () => this.listeners.delete(listener)};
    };
    fire(value) {
      for (const listener of this.listeners) listener(value);
    }
    dispose() {
      this.listeners.clear();
    }
  }
  class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class ThemeIcon {
    constructor(id) {
      this.id = id;
    }
  }
  const panels = [];
  const externalUris = [];
  return {
    panels,
    externalUris,
    EventEmitter,
    TreeItem,
    ThemeIcon,
    TreeItemCollapsibleState: {None: 0, Collapsed: 1, Expanded: 2},
    ViewColumn: {Beside: 2},
    ConfigurationTarget: {Workspace: 1, Global: 2},
    Uri: {parse: (value) => ({toString: () => value})},
    env: {asExternalUri: async (uri) => {
      externalUris.push(uri.toString());
      return uri;
    }},
    debug: {
      sessions: [],
      onDidTerminateDebugSession: () => ({dispose() {}}),
    },
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({get: (name, fallback) => settings[name] ?? fallback, update: async () => {}}),
    },
    window: {
      createWebviewPanel: (...args) => {
        const panel = {
          args,
          webview: {html: ""},
          onDidDispose: () => ({dispose() {}}),
          reveal() {},
        };
        panels.push(panel);
        return panel;
      },
      showInformationMessage() {},
      showErrorMessage() {},
    },
  };
}

function controllerContext() {
  return {
    subscriptions: [],
    globalStorageUri: {fsPath: path.join(tmpdir(), "osd-controller-test")},
    extensionUri: {fsPath: path.join(tmpdir(), "osd-controller-test-no-bundle")},
    extension: {packageJSON: {version: "test"}},
  };
}

describe("editors/vscode: the extension's logic", function () {
  it("builds the attach profile and keeps a supervised restart on one debugger session", () => {
    const config = debuggerConfiguration(9341);
    expect(config).to.include({name: "OSD: ABAP (9341)", type: "node", request: "attach", address: "127.0.0.1", port: 9341, restart: true, timeout: 30000});
    expect(config.resolveSourceMapLocations).to.deep.equal(["${workspaceFolder}/build/**", "!**/node_modules/**"]);
    expect(config.outFiles).to.deep.equal(["${workspaceFolder}/build/**/*.mjs"]);
    expect(debuggerConfiguration(9342, {target: "unit", restart: false}))
      .to.include({name: "OSD: ABAP Unit (9342)", restart: false, continueOnAttach: true});
    const externalRoot = debuggerConfiguration(9343, {root: "C:\\workspace\\osd"});
    expect(externalRoot.outFiles).to.deep.equal(["C:/workspace/osd/build/**/*.mjs"]);
    expect(externalRoot.skipFiles).to.include("C:/workspace/osd/node_modules/@abaplint/runtime/**");
    expect(() => debuggerConfiguration(0)).to.throw(/invalid inspector port/);

    const first = debugAttachPlan({}, {type: "system-started", enabled: true, port: 9341});
    expect(first.actions).to.deep.equal([{type: "attach", target: "system", port: 9341, restart: true}]);
    const attached = debugAttachPlan(first.state, {type: "system-attached", port: 9341});
    const recycled = debugAttachPlan(attached.state, {type: "system-started", enabled: true, port: 9341});
    expect(recycled.actions).to.deep.equal([]);
    expect(recycled.state).to.equal(attached.state);
    const stopped = debugAttachPlan(recycled.state, {type: "system-stopped"});
    expect(stopped.actions).to.deep.equal([{type: "stop", target: "system", port: 9341}]);
    const restarted = debugAttachPlan(stopped.state, {type: "system-started", enabled: true, port: 9341});
    expect(restarted.actions).to.deep.equal([{type: "attach", target: "system", port: 9341, restart: true}]);
    expect(debugAttachPlan(restarted.state, {type: "unit-started", port: 9342}).actions)
      .to.deep.equal([{type: "attach", target: "unit", port: 9342, restart: false}]);
    expect(breakpointToggleText()).to.equal("$(debug) Toggle ABAP breakpoints");
  });

  it("retries a failed attach and a manually closed system session", () => {
    const pending = debugAttachPlan({}, {type: "system-started", enabled: true, port: 9341});
    expect(pending.state.systemPort).to.equal(undefined);
    expect(debugAttachPlan(pending.state, {type: "system-started", enabled: true, port: 9341}).actions)
      .to.deep.equal(pending.actions);
    const attached = debugAttachPlan(pending.state, {type: "system-attached", port: 9341});
    expect(attached.state.systemPort).to.equal(9341);
    const closed = debugAttachPlan(attached.state, {type: "system-session-ended", port: 9341});
    expect(closed.state.systemPort).to.equal(undefined);
    expect(debugAttachPlan(attached.state, {type: "system-session-ended", port: 9342}).state)
      .to.equal(attached.state);
    expect(debugAttachPlan(closed.state, {type: "system-started", enabled: true, port: 9341}).actions)
      .to.deep.equal(pending.actions);
  });

  it("propagates attach failure to the debug run and aborts its paused child request", async () => {
    for (const failure of [false, new Error("attach rejected")]) {
      let requestSignal;
      const execute = (signal) => new Promise((resolve, reject) => {
        requestSignal = signal;
        signal.addEventListener("abort", () => reject(new Error("request aborted")), {once: true});
      });
      const attach = () => failure === false ? false : Promise.reject(failure);
      try {
        await runWithDebuggerAttach(attach, execute);
        throw new Error("expected attach failure");
      } catch (error) {
        expect(error.message).to.equal(failure === false
          ? "VS Code could not attach to the ABAP Unit child" : "attach rejected");
      }
      expect(requestSignal.aborted).to.equal(true);
    }
  });

  it("aborts an active debug request when Test Explorer cancels the run", async () => {
    let cancel;
    let disposed = false;
    let requestSignal;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested(listener) {
        cancel = () => {
          this.isCancellationRequested = true;
          listener();
        };
        return {dispose: () => { disposed = true; }};
      },
    };
    const execute = (signal) => new Promise((resolve, reject) => {
      requestSignal = signal;
      signal.addEventListener("abort", () => reject(new Error("request aborted")), {once: true});
    });
    const run = runWithDebuggerAttach(() => true, execute, token);
    await new Promise((resolve) => setImmediate(resolve));
    expect(requestSignal.aborted).to.equal(false);
    cancel();
    try {
      await run;
      throw new Error("expected cancelled request");
    } catch (error) {
      expect(error.message).to.equal("request aborted");
    }
    expect(requestSignal.aborted).to.equal(true);
    expect(disposed).to.equal(true);
  });

  it("stops a multi-method debug run before attaching the next selection after cancellation", async () => {
    const api = vscodeStub({home: ROOT, "tests.showSystem": false});
    const source = path.join(ROOT, "src/webgui/zcl_osd_abap_tokens.clas.testclasses.abap");
    api.Uri.file = (fsPath) => ({fsPath});
    api.Range = class {
      constructor() {}
    };
    api.TestMessage = class {
      constructor(message) { this.message = message; }
    };
    api.TestRunProfileKind = {Run: 1, Debug: 2};
    api.workspace.findFiles = async () => [api.Uri.file(source)];
    api.workspace.getWorkspaceFolder = () => ({uri: api.Uri.file(ROOT)});
    api.workspace.createFileSystemWatcher = () => ({onDidCreate() {}, onDidDelete() {}, onDidChange() {}, dispose() {}});
    api.commands = {registerCommand: () => ({dispose() {}})};
    const collection = (parent) => {
      const items = new Map();
      return {
        get size() { return items.size; },
        get: (id) => items.get(id),
        add(item) { item.parent = parent; items.set(item.id, item); },
        replace(next) { items.clear(); next.forEach((item) => this.add(item)); },
        [Symbol.iterator]: () => items[Symbol.iterator](),
      };
    };
    const profiles = new Map();
    const events = [];
    const controller = {
      items: collection(undefined),
      createTestItem(id, label, uri) {
        const item = {id, label, uri};
        item.children = collection(item);
        return item;
      },
      createRunProfile(name, kind, handler) { profiles.set(name, handler); },
      createTestRun() {
        return Object.fromEntries(["started", "passed", "failed", "skipped", "errored", "appendOutput", "end"]
          .map((name) => [name, (item) => events.push([name, item?.id])]));
      },
      dispose() {},
    };
    api.tests = {createTestController: () => controller};
    const {testExplorer} = loadExtension(api);
    const originalDiscover = Osd.prototype.discover;
    const originalRun = Osd.prototype.run;
    const runs = [];
    const attaches = [];
    const cancellationToken = () => {
      const listeners = new Set();
      return {
        isCancellationRequested: false,
        get listenerCount() { return listeners.size; },
        onCancellationRequested(listener) {
          listeners.add(listener);
          return {dispose: () => listeners.delete(listener)};
        },
        cancel() {
          this.isCancellationRequested = true;
          for (const listener of listeners) listener();
        },
      };
    };
    let token = cancellationToken();
    let pickPort = async () => 9341;
    Osd.prototype.discover = async () => ({classes: [{name: "LTCL_SCAN", include: "testclasses", line: 1,
      methods: [{name: "FIRST", line: 2}, {name: "SECOND", line: 3}]}]});
    Osd.prototype.run = (object, testClass, method, dbEnv, inspectPort, waitForDebugger, signal) => {
      runs.push({method, inspectPort, waitForDebugger});
      if (signal.aborted) return Promise.reject(new Error("request aborted"));
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("request aborted")), {once: true});
        setImmediate(() => token.cancel());
      });
    };
    let explorer;
    try {
      explorer = testExplorer(controllerContext(), {appendLine() {}}, {
        attachUnitDebugger: (event) => {
          attaches.push(event);
          return true;
        },
        pickUnitInspectorPort: () => pickPort(),
      });
      await controller.resolveHandler();
      const object = controller.items.get("group:project").children.get("CLAS:ZCL_OSD_ABAP_TOKENS");
      expect(object).not.to.equal(undefined);
      await controller.resolveHandler(object);
      const methods = [...object.children.get("CLAS:ZCL_OSD_ABAP_TOKENS/LTCL_SCAN").children].map(([, item]) => item);
      await profiles.get("Debug")({include: methods}, token);
      expect(runs).to.have.lengthOf(1);
      expect(runs[0]).to.include({method: "FIRST", inspectPort: 9341, waitForDebugger: true});
      expect(attaches).to.have.lengthOf(1);
      expect(attaches[0]).to.include({type: "unit-started", port: runs[0].inspectPort});
      expect(events.filter(([name]) => name === "started").map(([, id]) => id)).to.deep.equal([methods[0].id]);
      expect(events.filter(([name]) => name === "errored").map(([, id]) => id)).to.deep.equal([methods[0].id]);
      expect(events.at(-1)[0]).to.equal("end");
      expect(token.listenerCount).to.equal(0);

      token = cancellationToken();
      pickPort = async () => {
        token.cancel();
        return 9342;
      };
      runs.length = 0;
      attaches.length = 0;
      events.length = 0;
      await profiles.get("Debug")({include: methods}, token);
      expect(runs).to.have.lengthOf(0);
      expect(attaches).to.have.lengthOf(0);
      expect(events.filter(([name]) => name === "started").map(([, id]) => id)).to.deep.equal([methods[0].id]);
      expect(events.filter(([name]) => name === "skipped").map(([, id]) => id)).to.deep.equal([methods[0].id]);
      expect(events.at(-1)[0]).to.equal("end");
    } finally {
      explorer?.dispose();
      Osd.prototype.discover = originalDiscover;
      Osd.prototype.run = originalRun;
    }
  });

  it("maps packaged workspace-layer source-map entries to the open folder", () => {
    const layer = {folder: "/work/project", srcDir: "/work/project/src"};
    const config = debuggerConfiguration(9341, {root: "/installed/osd", storageDir: "/storage/osd", layers: [layer]});
    const {packNameOf} = createRequire(import.meta.url)("../editors/vscode/launcher.js");
    const packSource = `/storage/osd/packs/${packNameOf(layer.folder)}/src`;
    const relativeSource = path.relative("/installed/osd/build/by-input/generation/output", packSource).replaceAll("\\", "/");
    expect(config.sourceMapPathOverrides[`${relativeSource}/*`])
      .to.equal("/work/project/src/*");
    expect(config.sourceMapPathOverrides[`file://${packSource}/*`])
      .to.equal("/work/project/src/*");
  });

  it("quick start applies its preset and restarts a running controller before opening the overview", async () => {
    const api = vscodeStub();
    const SystemController = loadSystemController(api);
    const controller = new SystemController(controllerContext(), {append() {}, appendLine() {}, show() {}});
    controller.launcher = {state: "running"};
    const calls = [];
    controller.applyPreset = async (name) => calls.push(["preset", name]);
    controller.stop = async () => {
      calls.push(["stop"]);
      controller.launcher.state = "stopped";
    };
    controller.start = async () => {
      calls.push(["start"]);
      controller.launcher.state = "running";
      return true;
    };
    controller.openSystemOverview = async () => calls.push(["overview"]);

    await controller.quickStart("defaults");

    expect(calls).to.deep.equal([["preset", "defaults"], ["stop"], ["start"], ["overview"]]);
  });

  it("loads a running controller overview from its launcher port after osd.url changes", async () => {
    const api = vscodeStub({url: "http://localhost:5999", home: "", keymap: "abap"});
    const SystemController = loadSystemController(api);
    const controller = new SystemController(controllerContext(), {append() {}, appendLine() {}, show() {}});
    controller.launcher = {
      state: "running", port: 3542, osdHome: "/work/osd", homeKind: "osd.home", layers: [],
      databaseLabel: "SQLite", generation: "abc123",
    };
    const oldFetch = globalThis.fetch;
    const requested = [];
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      const body = String(url).endsWith("/osd/serving")
        ? {ready: true, database: "/work/db/osd.sqlite", databaseIdentity: {engine: "sqlite", storage: "file"}, warm: {state: "primed"}}
        : {d: {results: []}};
      return {ok: true, status: 200, json: async () => body};
    };
    try {
      await controller.openSystemOverview();
    } finally {
      globalThis.fetch = oldFetch;
    }

    expect(requested).to.have.lengthOf(7);
    expect(requested.every((url) => url.startsWith("http://localhost:3542/"))).to.equal(true);
    expect(requested.some((url) => url.startsWith("http://localhost:5999/"))).to.equal(false);
    expect(api.externalUris).to.deep.equal([
      "http://localhost:3542/sap/bc/osd/sysinfo/",
      "http://localhost:3542/app/flp.html",
    ]);
    expect(api.panels[0].webview.html).to.contain("http://localhost:3542/app/flp.html");
  });

  it("keeps the quick-start preset, DX2 home rule, and state menus in pure logic", () => {
    expect(Object.keys(PRESETS)).to.deep.equal(["defaults"]);
    expect(presetSettings("defaults")).to.deep.equal({home: "auto", database: "sqlite", warm: "auto", keymap: "abap"});
    expect(isOpenSteamgateCheckout({name: "open-steamgate"}, {buildScript: true, vscodeExtension: true})).to.equal(true);
    expect(isOpenSteamgateCheckout({name: "another-project"}, {buildScript: true, vscodeExtension: true})).to.equal(false);
    expect(osdHomeChoice({bundledHome: "/storage/osd", bundledAvailable: true,
      workspaces: [{path: "/work/osd", isOpenSteamgate: true}]})).to.deep.equal({path: "/work/osd", kind: "osd.home"});
    expect(osdHomeChoice({homeMode: "open-steamgate", bundledHome: "/storage/osd", bundledAvailable: true,
      workspaces: [{path: "/work/osd", isOpenSteamgate: true}]})).to.deep.equal({path: "/work/osd", kind: "osd.home"});
    expect(osdHomeChoice({bundledHome: "/storage/osd", bundledAvailable: true,
      workspaces: [{path: "/work/app"}]})).to.deep.equal({path: "/storage/osd", kind: "bundled copy"});
    expect(osdHomeChoice({configuredHome: "/configured/osd", bundledHome: "/storage/osd", bundledAvailable: true,
      workspaces: [{path: "/work/osd", isOpenSteamgate: true}]})).to.deep.equal({path: "/configured/osd", kind: "osd.home"});
    expect(["stopped", "running", "building", "starting"].map(osdStateContext)).to.deep.equal([
      "osd-state-stopped", "osd-state-running", "osd-state-building", "osd-state-building",
    ]);
  });

  it("builds an overview from the live serving and OData status values", () => {
    const model = systemOverviewModel({
      state: "running",
      launcher: {port: 3542, osdHome: "/storage/osd", layers: [{folder: "/workspace/layer"}]},
      homeKind: "bundled copy",
      serving: {ready: true, database: "/storage/db/osd.sqlite", databaseIdentity: {engine: "sqlite", storage: "file"}, warm: {state: "primed", swaps: 2}},
      status: {system: [{Sid: "OSD", GenServing: "abc123"}], processes: [{Pid: "42"}], ports: [{Port: "3542"}],
        services: [{Path: "/app/flp.html"}], packs: [{Name: "demo"}], database: [{name: "Engine", value: "sqlite"}]},
      baseUrl: "http://localhost:3542",
      keymap: "abap",
    });
    expect(model).to.include({state: "running", running: true, keymap: "abap"});
    expect(model.listener).to.include({port: 3542, url: "http://localhost:3542"});
    expect(model.launchpadUrl).to.equal("http://localhost:3542/app/flp.html");
    expect(model.home).to.deep.equal({kind: "bundled copy", path: "/storage/osd"});
    expect(model.layers).to.deep.equal(["/workspace/layer"]);
    expect(model.database).to.deep.equal({engine: "sqlite", storage: "file", path: "/storage/db/osd.sqlite", source: "/osd/serving"});
    expect(model.warm).to.deep.equal({state: "primed", swaps: 2});
    expect(model.status.services[0].Path).to.equal("/app/flp.html");
    expect(model.sources.status).to.deep.equal({
      system: "/sap/opu/odata/sap/ZOSD_STATUS_SRV/SystemSet?$format=json",
      processes: "/sap/opu/odata/sap/ZOSD_STATUS_SRV/ProcessSet?$format=json",
      ports: "/sap/opu/odata/sap/ZOSD_STATUS_SRV/PortSet?$format=json",
      services: "/sap/opu/odata/sap/ZOSD_STATUS_SRV/ServiceSet?$format=json",
      packs: "/sap/opu/odata/sap/ZOSD_STATUS_SRV/PackSet?$format=json",
      database: "/sap/opu/odata/sap/ZOSD_STATUS_SRV/DatabaseSet?$format=json",
    });
    expect(model.sources.sysinfo).to.equal("/sap/bc/osd/sysinfo/");
    const html = systemOverviewHtml(model, {sysinfoUrl: "http://localhost:3542/sap/bc/osd/sysinfo/"});
    expect(html).to.contain("/storage/db/osd.sqlite");
    expect(html).to.contain("primed");
    expect(html).to.contain("System information app");
    expect(html).to.contain("<iframe");
    expect(overviewStatusSection("Services", model.status.services)).to.contain("/app/flp.html");

    const stopped = systemOverviewModel({state: "stopped", homeKind: "osd.home", homePath: "/work/osd", layers: ["/work/app"]});
    expect(stopped.running).to.equal(false);
    expect(stopped.home.path).to.equal("/work/osd");
    expect(systemOverviewHtml(stopped)).to.contain("Start system");
    const statusFallback = systemOverviewModel({state: "running", launcher: {port: 3542}, status: {
      database: [{Name: "Engine", Value: "sqlite"}, {Name: "Storage", Value: "file"}],
    }});
    expect(statusFallback.database).to.include({engine: "sqlite", storage: "file"});
  });

  it("validates every walkthrough markdown entry in package.json", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "editors/vscode/package.json"), "utf8"));
    const walkthroughs = manifest.contributes.walkthroughs;
    expect(walkthroughs).to.have.lengthOf(1);
    expect(manifest.contributes.commands.some((command) => command.command === "osd.gettingStarted" && command.title === "osd: Getting started")).to.equal(true);
    expect(manifest.contributes.commands.some((command) => command.command === "osd.quickStart")).to.equal(true);
    expect(manifest.contributes.commands.some((command) => command.command === "osd.openSystemOverview")).to.equal(true);
    const itemMenu = manifest.contributes.menus["view/item/context"];
    for (const state of ["stopped", "running", "building"]) {
      expect(itemMenu.some((item) => item.when.includes(`viewItem == osd-state-${state}`)), state).to.equal(true);
    }
    const stateItems = itemMenu.filter((item) => item.when.includes("viewItem == osd-state-"));
    expect(stateItems.length).to.be.greaterThan(0);
    expect(stateItems.every((item) => item.group !== "inline" && !item.group?.startsWith("inline@"))).to.equal(true);
    const actionsFor = (state) => stateItems.filter((item) => item.when.includes(`viewItem == osd-state-${state}`)).map((item) => item.command);
    expect(actionsFor("stopped")).to.include.members(["osd.start", "osd.fullRebuild"]);
    expect(actionsFor("running")).to.include.members(["osd.stop", "osd.rebuildWarm", "osd.fullRebuild", "osd.openLaunchpad", "osd.openSystemLog"]);
    expect(actionsFor("building")).to.include.members(["osd.openSystemLog", "osd.stop"]);
    for (const walkthrough of walkthroughs) {
      expect(walkthrough.steps[0].id).to.equal("quickStart");
      for (const step of walkthrough.steps) {
        expect(readFileSync(path.join(ROOT, "editors/vscode", step.media.markdown), "utf8")).not.to.equal("");
      }
    }
  });

  it("contributes each configuration key and command only once", () => {
    const source = readFileSync(path.join(ROOT, "editors/vscode/package.json"), "utf8");
    const manifest = JSON.parse(source);
    // JSON.parse keeps the last value of a duplicate key, so inspect the
    // declarations in the source before that information is lost.
    const properties = source.slice(source.indexOf('"properties": {'), source.indexOf('"notebooks": ['));
    const keys = [...properties.matchAll(/^\s*"(osd\.[^"]+)":\s*\{/gm)].map((match) => match[1]);
    expect(keys).to.have.lengthOf(Object.keys(manifest.contributes.configuration.properties).length);
    expect(new Set(keys).size).to.equal(keys.length);
    const commands = manifest.contributes.commands.map(({command}) => command);
    expect(new Set(commands).size).to.equal(commands.length);
  });

  it("reads all six existing status OData sets for the overview", async () => {
    const routes = [];
    const client = new Osd("http://localhost:3531", async (url) => {
      routes.push(new URL(url).pathname + new URL(url).search);
      const set = new URL(url).pathname.split("/").at(-1).replace("Set", "").toLowerCase();
      return {ok: true, json: async () => ({d: {results: [{set}]}})};
    });
    const status = await client.systemStatus();
    expect(Object.keys(status)).to.deep.equal(Object.keys(SYSTEM_STATUS_SETS));
    expect(status.system).to.deep.equal([{set: "system"}]);
    expect(routes).to.have.lengthOf(6);
    expect(routes).to.include("/sap/opu/odata/sap/ZOSD_STATUS_SRV/SystemSet?$format=json");
    expect(odataV2Results({d: {Sid: "OSD"}})).to.deep.equal([{Sid: "OSD"}]);
  });

  it("names the object and include of an abapGit file", () => {
    expect(objectOf("/x/zcl_a.clas.testclasses.abap")).to.deep.equal({type: "CLAS", name: "ZCL_A", base: "zcl_a", include: "testclasses"});
    expect(objectOf("zcl_a.clas.abap").include).to.equal("main");
    expect(objectOf("#ns#zcl_a.clas.locals_imp.abap")).to.include({name: "/NS/ZCL_A", include: "implementations"});
    expect(objectOf("zprog.prog.abap")).to.include({type: "PROG", name: "ZPROG"});
    expect(objectOf("zif_a.intf.abap")).to.equal(undefined);
  });

  it("finds an include's file beside another file of the object", () => {
    const object = objectOf("zcl_a.clas.abap");
    expect(fileOf("/d", object, "testclasses")).to.equal("/d/zcl_a.clas.testclasses.abap");
    expect(fileOf("/d", object, "main")).to.equal("/d/zcl_a.clas.abap");
    expect(fileOf("/d", object, "implementations")).to.equal("/d/zcl_a.clas.locals_imp.abap");
  });

  it("reads a run per method, the first ABAP frame as the place", () => {
    const run = {testClasses: [
      {name: "LTCL_A", alerts: [], testMethods: [
        {name: "OK", ms: 3, alerts: []},
        {name: "BAD", ms: 4, alerts: [{kind: "failedAssertion", title: "differ", details: ["Expected [1]", "Actual [2]"],
          stack: [{uri: "cl_abap_unit_assert.clas.abap", line: 0}, {uri: "zcl_a.clas.testclasses.abap", line: 12, column: 5}]}]},
      ]},
      {name: "LTCL_SETUP", alerts: [{kind: "exception", title: "class_setup", details: [], stack: []}], testMethods: []},
    ]};
    const got = outcomes(run, [{testClass: "LTCL_SETUP", method: "M1"}]);
    expect(got.map((r) => [r.testClass, r.method, r.passed])).to.deep.equal([
      ["LTCL_A", "OK", true], ["LTCL_A", "BAD", false], ["LTCL_SETUP", "M1", false]]);
    expect(got[1].alerts[0].frame).to.deep.equal({file: "zcl_a.clas.testclasses.abap", line: 12, column: 5});
    expect(abapFrame({stack: []})).to.equal(undefined);
  });

  it("names the object of a file Check/Activate can reach, interfaces included", () => {
    expect(adtObjectOf("/x/zcl_a.clas.testclasses.abap")).to.deep.equal({type: "CLAS", name: "ZCL_A", base: "zcl_a", include: "testclasses"});
    expect(adtObjectOf("zif_a.intf.abap")).to.deep.equal({type: "INTF", name: "ZIF_A", base: "zif_a", include: "main"});
    expect(adtObjectOf("zprog.prog.abap")).to.include({type: "PROG", name: "ZPROG"});
    expect(adtObjectOf("readme.md")).to.equal(undefined);
  });

  it("builds an object's own ADT URI the way tools/adt-documents.mjs does, and refuses a type it does not know", () => {
    expect(uriOf({type: "CLAS", base: "zcl_a"})).to.equal(facadeUriOf("CLAS", "zcl_a"));
    expect(uriOf({type: "INTF", base: "zif_a"})).to.equal(facadeUriOf("INTF", "zif_a"));
    expect(uriOf({type: "PROG", base: "zprog"})).to.equal(facadeUriOf("PROG", "zprog"));
    expect(() => uriOf({type: "FUGR", base: "zfg"})).to.throw(/FUGR/);
  });

  it("Ctrl+F2: reads a check run's diagnostics off checkReportDocument's real shape", () => {
    const clean = parseCheckReport(checkReportDocument([{uri: "/sap/bc/adt/oo/classes/zcl_a", issues: []}]));
    expect(clean).to.deep.equal([{uri: "/sap/bc/adt/oo/classes/zcl_a", status: "processed", statusText: "no errors", issues: []}]);

    const broken = parseCheckReport(checkReportDocument([{uri: "/sap/bc/adt/oo/classes/zcl_a", issues: [
      {severity: "E", message: "\"X\" is not defined", line: 12, column: 5},
      {severity: "W", message: "unused variable", line: 3, column: 1},
    ]}]));
    expect(broken).to.have.lengthOf(1);
    expect(broken[0].statusText).to.equal("2 error(s)");
    expect(broken[0].issues).to.deep.equal([
      {line: 12, column: 5, severity: "E", message: '"X" is not defined'},
      {line: 3, column: 1, severity: "W", message: "unused variable"},
    ]);

    // a check that could not run: no issues, but not a clean pass either
    const notProcessed = parseCheckReport(checkReportDocument([{uri: "/sap/bc/adt/oo/classes/zcl_x", issues: [], status: "notProcessed", statusText: "ZCL_X does not exist"}]));
    expect(notProcessed[0]).to.include({status: "notProcessed", statusText: "ZCL_X does not exist"});
  });

  it("Ctrl+F3: tells a clean activation from a failed one, off the real activation documents", () => {
    expect(parseActivationResult(activationSuccessDocument())).to.deep.equal({ok: true, issues: []});

    const failed = parseActivationResult(activationFailureDocument([
      {type: "CLAS", name: "ZCL_A", issues: [{severity: "E", message: "Syntax error", line: 7, column: 3}]},
    ]));
    expect(failed.ok).to.equal(false);
    expect(failed.issues).to.deep.equal([{line: 7, column: 3, objDescr: "ZCL_A", message: "Syntax error"}]);
  });

  it("SE80's F8, one entry per object type: what this build does, or the route its turn would use", () => {
    expect(runActionFor({type: "CLAS", name: "ZCL_DEMO"}, {hasUnitTests: true})).to.deep.equal({kind: "unit"});
    expect(runActionFor({type: "CLAS", name: "ZCL_DEMO"}, {hasUnitTests: false}).kind).to.equal("not-yet");
    // a service's own class, cursor outside any entity-set method: F8 there
    // means a Gateway client, before ABAP Unit -- still not yet
    const dpc = runActionFor({type: "CLAS", name: "ZCL_ZSTG_DEMO_DPC_EXT"}, {hasUnitTests: true});
    expect(dpc.kind).to.equal("not-yet");
    expect(dpc.text).to.contain("get_entityset");
    const mpc = runActionFor({type: "CLAS", name: "ZCL_ZSTG_DEMO_MPC_EXT"}, {hasUnitTests: true});
    expect(mpc.kind).to.equal("not-yet");
    // Q2b: cursor inside a known entity-set method does what its lens does
    const inside = runActionFor({type: "CLAS", name: "ZCL_ZSTG_DEMO_DPC_EXT"},
      {hasUnitTests: true, entitySet: {service: "ZSTG_DEMO_SRV", set: "TravelSet", entityKind: "get_entityset"}});
    expect(inside).to.deep.equal({kind: "call-entityset", service: "ZSTG_DEMO_SRV", set: "TravelSet", entityKind: "get_entityset"});
    expect(runActionFor({type: "INTF", name: "ZIF_A"})).to.deep.equal({kind: "not-yet", text: "not yet: an interface has nothing of its own to run"});
    expect(runActionFor({type: "FUGR", name: "ZFG"}).text).to.contain("/sap/bc/osd/rfc/functions/<NAME>");
    expect(runActionFor({type: "TABL", name: "ZSTG_DEMO"})).to.deep.equal({kind: "data-preview", objectType: "TABL", name: "ZSTG_DEMO"});
    expect(runActionFor({type: "DDLS", name: "ZC_STG_DEMO"})).to.deep.equal({kind: "data-preview", objectType: "DDLS", name: "ZC_STG_DEMO"});
    expect(runActionFor({type: "IWSV", name: "ZSTG_DEMO_SRV"}).text).to.equal("not yet: the Gateway client on the service document");
    expect(runActionFor({type: "SICF", name: "ZOSD_APP"}).kind).to.equal("not-yet");
    expect(runActionFor({type: "BOGUS", name: "X"}).text).to.contain("BOGUS");
  });

  // ---- Q6b "Classrun": F9, ADT's "Run as ABAP Application (Console)" --
  // implementsClassrun (the buffer scan F8's dispatch and osd-classrun.mjs's
  // server-side check both run) and the dispatch itself, held to the same
  // shape lib.js's own RUN_TABLE test above holds every other kind to.
  it("Q6b: a class buffer declaring IF_OO_ADT_CLASSRUN, off the source text alone", () => {
    const demo = readFileSync(new URL("../src/classrun/zcl_osd_classrun_demo.clas.abap", import.meta.url), "utf8");
    expect(implementsClassrun(demo)).to.equal(true);
    expect(implementsClassrun("CLASS zcl_x DEFINITION.\nENDCLASS.")).to.equal(false);
    // case- and whitespace-insensitive, the way an ABAP statement is
    expect(implementsClassrun("  interfaces   if_oo_adt_classrun .")).to.equal(true);
    // a class that merely names the interface in a comment does not count
    expect(implementsClassrun("* interfaces if_oo_adt_classrun would go here")).to.equal(false);
    // the two implementations (the editor's buffer scan and the façade's
    // own file scan, tools/osd-classrun.mjs) agree on the same fixture
    expect(facadeImplementsClassrun(demo)).to.equal(implementsClassrun(demo));
  });

  it("Q6b: F8 dispatches a no-tests classrun class to a run, tests still win, neither loses to the other", () => {
    expect(runActionFor({type: "CLAS", name: "ZCL_OSD_CLASSRUN_DEMO"}, {hasUnitTests: false, hasClassrun: true}))
      .to.deep.equal({kind: "classrun"});
    // ABAP Unit still wins when a class happens to carry both
    expect(runActionFor({type: "CLAS", name: "ZCL_OSD_CLASSRUN_DEMO"}, {hasUnitTests: true, hasClassrun: true}))
      .to.deep.equal({kind: "unit"});
    // neither: the same "not yet" as before Q6b existed
    expect(runActionFor({type: "CLAS", name: "ZCL_DEMO"}, {hasUnitTests: false, hasClassrun: false}).kind)
      .to.equal("not-yet");
    // a DPC_EXT's own dispatch (Q2b) still comes first, classrun or not
    const dpc = runActionFor({type: "CLAS", name: "ZCL_ZSTG_DEMO_DPC_EXT"}, {hasUnitTests: false, hasClassrun: true});
    expect(dpc.kind).to.equal("not-yet");
    expect(dpc.text).to.contain("get_entityset");
  });

  // ---- Q2b "Runner": the CodeLens over a SEGW _DPC_EXT class's own
  // `<set>_get_entityset` / `<set>_get_entity` methods, and F8 doing what
  // the lens above the cursor's own method does.

  it("Q2b: a lens line over each METHOD <set>_get_entityset. / <set>_get_entity. line, none elsewhere", () => {
    const source = [
      "CLASS zcl_x IMPLEMENTATION.",
      "  METHOD travelset_get_entityset.",
      "    \" body",
      "  ENDMETHOD.",
      "  METHOD travelset_get_entity.",
      "  ENDMETHOD.",
      "  METHODS travelset_get_entityset REDEFINITION.", // a declaration, not the body: no line for this
      "  METHOD other_method.",
      "  ENDMETHOD.",
      "ENDCLASS.",
    ].join("\n");
    expect(entitySetMethodLines(source)).to.deep.equal([
      {line: 2, method: "TRAVELSET_GET_ENTITYSET", kind: "get_entityset"},
      {line: 5, method: "TRAVELSET_GET_ENTITY", kind: "get_entity"},
    ]);
  });

  it("Q2b: a lens only for a method the server's map names, titled with the set's real name", () => {
    const source = [
      "  METHOD travelset_get_entityset.",
      "  ENDMETHOD.",
      "  METHOD bookingset_get_entityset.", // the server does not know this one
      "  ENDMETHOD.",
    ].join("\n");
    const map = {service: "ZSTG_DEMO_SRV", sets: [{method: "TRAVELSET_GET_ENTITYSET", kind: "get_entityset", set: "TravelSet"}]};
    expect(entitySetLenses(source, map)).to.deep.equal([
      {line: 1, kind: "get_entityset", set: "TravelSet", service: "ZSTG_DEMO_SRV", title: "▶ Call TravelSet"},
    ]);
    expect(entitySetLenses(source, undefined)).to.deep.equal([]);
  });

  it("Q2b: the method a cursor's (0-based) line sits inside, cleared by the ENDMETHOD that closes it", () => {
    const source = [
      "  METHOD travelset_get_entityset.", // 0
      "    DATA lv TYPE i.",               // 1
      "  ENDMETHOD.",                      // 2
      "  METHOD travelset_get_entity.",    // 3
      "  ENDMETHOD.",                      // 4
      "  DATA gv TYPE i.",                 // 5, between methods
    ].join("\n");
    expect(methodAtLine(source, 0)).to.equal("TRAVELSET_GET_ENTITYSET");
    expect(methodAtLine(source, 1)).to.equal("TRAVELSET_GET_ENTITYSET");
    expect(methodAtLine(source, 2)).to.equal(undefined);
    expect(methodAtLine(source, 3)).to.equal("TRAVELSET_GET_ENTITY");
    expect(methodAtLine(source, 5)).to.equal(undefined);
  });

  it("Q2b: an OData v2 answer's rows, the key predicate off __metadata, columns without it", () => {
    const setBody = {d: {results: [
      {__metadata: {uri: "http://x/TravelSet('T0001')"}, TravelId: "T0001", Description: "A"},
      {__metadata: {uri: "http://x/TravelSet('T0002')"}, TravelId: "T0002", Description: "B"},
    ]}};
    const rows = resultRows(setBody);
    expect(rows).to.have.lengthOf(2);
    expect(keyOf(rows[0])).to.equal("'T0001'");
    expect(stripMetadata(rows[0])).to.deep.equal({TravelId: "T0001", Description: "A"});

    const entityBody = {d: {__metadata: {uri: "http://x/BookingSet(TravelID='T0001',BookingID='0001')"}, TravelID: "T0001", BookingID: "0001"}};
    const one = resultRows(entityBody);
    expect(one).to.have.lengthOf(1);
    expect(keyOf(one[0])).to.equal("TravelID='T0001',BookingID='0001'");

    expect(resultRows({})).to.deep.equal([]);
    expect(keyOf({})).to.equal(undefined);
  });

  it("Q2b: end to end against the demo's own sources -- what a CodeLens gets is what tools/adt-facade.mjs answers", () => {
    const readSource = (name) => readFileSync(`src/demo/${name.toLowerCase()}.clas.abap`, "utf8");
    const registrations = [{dpc: "ZCL_ZSTG_DEMO_DPC_EXT", mpc: "ZCL_ZSTG_DEMO_MPC_EXT", external: "ZSTG_DEMO_SRV", service: "ZSTG_DEMO_SRV"}];
    const map = entitySetMapFor("ZCL_ZSTG_DEMO_DPC_EXT", registrations, readSource);
    expect(map.service).to.equal("ZSTG_DEMO_SRV");
    const dpcSource = readSource("ZCL_ZSTG_DEMO_DPC_EXT");
    const lenses = entitySetLenses(dpcSource, map);
    expect(lenses.map((l) => l.title)).to.include("▶ Call TravelSet");
    const travel = lenses.find((l) => l.kind === "get_entityset" && l.set === "TravelSet");
    expect(dpcSource.split(/\r\n|\r|\n/)[travel.line - 1]).to.match(/METHOD travelset_get_entityset\.\s*$/i);
    // and F8 with the cursor on that same line does the same as the lens
    const entitySet = {service: map.service, set: travel.set, entityKind: travel.kind};
    expect(runActionFor({type: "CLAS", name: "ZCL_ZSTG_DEMO_DPC_EXT"}, {hasUnitTests: false, entitySet}))
      .to.deep.equal({kind: "call-entityset", service: "ZSTG_DEMO_SRV", set: "TravelSet", entityKind: "get_entityset"});
  });

  // ---- Q3 "Readers": the lens over a class's or interface's own definition
  // line, its title, the quick pick a click shows, and the file glob a
  // chosen reader opens.

  it("Q3: the lens line is the object's own CLASS ... DEFINITION / INTERFACE line, none for another object's", () => {
    const clas = [
      "CLASS zcl_other DEFINITION PUBLIC.",      // 1, not this object
      "ENDCLASS.",                               // 2
      "CLASS zcl_x DEFINITION PUBLIC FINAL.",    // 3
      "  PUBLIC SECTION.",                       // 4
      "ENDCLASS.",                               // 5
      "CLASS zcl_x IMPLEMENTATION.",             // 6, not a DEFINITION line
      "ENDCLASS.",                               // 7
    ].join("\n");
    expect(readersLensLine(clas, {type: "CLAS", name: "ZCL_X"})).to.equal(3);
    expect(readersLensLine(clas, {type: "CLAS", name: "ZCL_NOT_THERE"})).to.equal(undefined);

    const intf = ["\" a comment", "INTERFACE zif_x PUBLIC."].join("\n");
    expect(readersLensLine(intf, {type: "INTF", name: "ZIF_X"})).to.equal(2);

    // an INTERFACES statement (implementing one, inside a class) is not an
    // INTERFACE statement (declaring one)
    expect(readersLensLine("  INTERFACES zif_x.", {type: "INTF", name: "ZIF_X"})).to.equal(undefined);
    expect(readersLensLine(clas, {type: "PROG", name: "ZCL_X"})).to.equal(undefined);
    expect(readersLensLine(clas, undefined)).to.equal(undefined);
  });

  it("Q3: the lens title, off the server's own counts", () => {
    expect(readersLensTitle({readers: 3, tests: 1, services: 2})).to.equal("read by 3 · tests 1 · services 2");
    expect(readersLensTitle(undefined)).to.equal("read by 0 · tests 0 · services 0");
  });

  it("Q3: the quick pick tags a reader that is a test, a service, both, or neither", () => {
    const readers = [
      {type: "CLAS", name: "ZCL_A", include: "ZCL_A", isTest: false, services: []},
      {type: "CLAS", name: "ZCL_B", include: "ZCL_B", isTest: true, services: []},
      {type: "CLAS", name: "ZCL_C", include: "ZCL_C", isTest: false, services: ["ZSTG_DEMO_SRV"]},
      {type: "CLAS", name: "ZCL_D", include: "ZCL_D", isTest: true, services: ["ZSTG_DEMO_SRV", "ZOSD_TEST_SRV"]},
    ];
    const items = readersQuickPickItems(readers);
    expect(items.map((i) => i.label)).to.deep.equal(["ZCL_A", "ZCL_B", "ZCL_C", "ZCL_D"]);
    expect(items[0].description).to.equal("CLAS");
    expect(items[1].description).to.equal("CLAS · Test");
    expect(items[2].description).to.equal("CLAS · Service (ZSTG_DEMO_SRV)");
    expect(items[3].description).to.equal("CLAS · Test · Service (ZSTG_DEMO_SRV, ZOSD_TEST_SRV)");
    expect(items.map((i) => i.reader)).to.deep.equal(readers);
    expect(readersQuickPickItems(undefined)).to.deep.equal([]);
  });

  it("Q3: a reader's file glob, namespace-to-# and all, undefined for a type with no known file shape", () => {
    expect(readerFilePattern({type: "CLAS", name: "ZCL_ZSTG_DEMO_MPC_EXT"})).to.equal("**/zcl_zstg_demo_mpc_ext.clas.abap");
    expect(readerFilePattern({type: "INTF", name: "ZIF_STG_CDS_SOURCE"})).to.equal("**/zif_stg_cds_source.intf.abap");
    expect(readerFilePattern({type: "PROG", name: "ZREPORT"})).to.equal("**/zreport.prog.abap");
    expect(readerFilePattern({type: "CLAS", name: "/NS/ZCL_X"})).to.equal("**/#ns#zcl_x.clas.abap");
    expect(readerFilePattern({type: "FUGR", name: "ZFG"})).to.equal(undefined);
    expect(readerFilePattern(undefined)).to.equal(undefined);
  });

  it("Q3: end to end against the demo's own sources -- what the lens shows is what tools/adt-facade.mjs's readers route answers", () => {
    const mpcSource = readFileSync("src/demo/zcl_zstg_demo_mpc_ext.clas.abap", "utf8");
    const object = adtObjectOf("zcl_zstg_demo_mpc_ext.clas.abap");
    const line = readersLensLine(mpcSource, object);
    expect(line).to.be.a("number");
    expect(mpcSource.split(/\r\n|\r|\n/)[line - 1]).to.match(/^CLASS\s+zcl_zstg_demo_mpc_ext\s+DEFINITION\b/i);
  });

  // ---- Q6a "Notebook SQL": the pure half of a *.osdnb notebook -- the
  // freestyle route's own column-oriented XML into rows, the rows into an
  // escaped HTML table, and a notebook file's JSON into cells and back.

  it("Q6a: the freestyle route's own XML shape (tools/adt-facade.mjs tableDataDocument) becomes columns and rows", () => {
    const xml = tableDataDocument({
      rows: [{TRAVEL_ID: "T0001", DESCRIPTION: "Berlin"}, {TRAVEL_ID: "T0002", DESCRIPTION: "Paris"}],
      columns: ["TRAVEL_ID", "DESCRIPTION"],
    });
    const {columns, rows} = freestyleRows(xml);
    expect(columns).to.deep.equal(["TRAVEL_ID", "DESCRIPTION"]);
    expect(rows).to.deep.equal([
      {TRAVEL_ID: "T0001", DESCRIPTION: "Berlin"},
      {TRAVEL_ID: "T0002", DESCRIPTION: "Paris"},
    ]);
  });

  it("Q6a: an empty result set is zero rows, not one row of nothing", () => {
    const xml = tableDataDocument({rows: [], columns: ["A", "B"]});
    expect(freestyleRows(xml)).to.deep.equal({columns: ["A", "B"], rows: []});
  });

  it("Q6a: a value the XML had to escape (& and <) round-trips through freestyleRows unescaped", () => {
    const xml = tableDataDocument({rows: [{NOTE: "Tom & Jerry <3"}], columns: ["NOTE"]});
    expect(freestyleRows(xml).rows).to.deep.equal([{NOTE: "Tom & Jerry <3"}]);
  });

  it("Q6a: htmlEscape stops a cell value with < or & from becoming markup", () => {
    expect(htmlEscape("<script>alert(1)</script>")).to.equal("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(htmlEscape("Fish & Chips")).to.equal("Fish &amp; Chips");
    expect(htmlEscape(undefined)).to.equal("");
  });

  it("Q6a: the cell output table escapes every cell, and the status line carries rows, ms and generation", () => {
    const html = freestyleTableHtml(["NAME"], [{NAME: "<b>&</b>"}], {ms: 12, generation: "abcdef1234567890"});
    expect(html).to.contain("<th>NAME</th>");
    expect(html).to.contain("<td>&lt;b&gt;&amp;&lt;/b&gt;</td>");
    expect(html).to.not.contain("<b>&</b>");
    expect(html).to.contain("1 row · 12 ms · abcdef12");
  });

  it("Q6a: the status line leaves the generation off when the answer did not carry one", () => {
    const html = freestyleTableHtml([], [], {ms: 3});
    expect(html).to.contain("0 rows · 3 ms</div>");
  });

  it("Q6a: HTML is the only renderer, with an escaped raw JSON disclosure inside it", () => {
    const rows = [{NAME: "<script>alert(1)</script>"}];
    const items = freestyleOutputItems(freestyleTableHtml(["NAME"], rows));
    expect(items.map((item) => item.mime)).to.deep.equal(["text/html"]);
    expect(items[0].value).to.contain("<details><summary>raw JSON</summary><pre>");
    expect(items[0].value).to.contain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(items[0].value).to.not.contain("<script>");
  });

  it("Q6a: an ABAP cell becomes the main method of the notebook classrun class", () => {
    const source = notebookAbapSource("out->write( 'hello' ).\nLOOP AT lt_demo INTO ls_demo.\nENDLOOP.");
    expect(source).to.contain("CLASS zcl_osd_notebook_cell DEFINITION");
    expect(source).to.contain("METHOD if_oo_adt_classrun~main.");
    expect(source).to.contain("    out->write( 'hello' ).\n    LOOP AT lt_demo INTO ls_demo.\n    ENDLOOP.");
    expect(source).to.contain("ENDCLASS.");
  });

  it("Q6a: AMDP sandbox JSON becomes notebook rows or a clear engine message", () => {
    expect(amdpCellResult({status: "ok", result: '[{"ANSWER":42}]', ms: "8"})).to.deep.equal({
      columns: ["ANSWER"], rows: [{ANSWER: 42}], ms: 8, raw: undefined,
    });
    const sqlite = amdpCellResult({
      status: "error", system_db: "sqlite",
      error: "SQLScript notebook cells require a HANA system database; this system uses sqlite.",
    });
    expect(sqlite.error).to.contain("require a HANA system database");
    expect(sqlite.error).to.contain("uses sqlite");
  });

  it("Q6a: a notebook's own JSON becomes cells, code defaulting to sql, markdown its own kind", () => {
    const cells = notebookFromJson(JSON.stringify({cells: [
      {kind: "markdown", value: "# Demo"},
      {kind: "code", value: "SELECT 1"},
      {kind: "code", language: "sql", value: "SELECT 2"},
      {kind: "code", language: "abap", value: "out->write( 'hello' )."},
      {kind: "code", language: "sqlscript", value: "SELECT 1 FROM dummy;"},
    ]}));
    expect(cells).to.deep.equal([
      {kind: "markdown", language: "markdown", value: "# Demo"},
      {kind: "code", language: "sql", value: "SELECT 1"},
      {kind: "code", language: "sql", value: "SELECT 2"},
      {kind: "code", language: "abap", value: "out->write( 'hello' )."},
      {kind: "code", language: "sqlscript", value: "SELECT 1 FROM dummy;"},
    ]);
  });

  it("Q6a: a bad or missing notebook JSON reads as no cells rather than throwing", () => {
    expect(notebookFromJson("not json")).to.deep.equal([]);
    expect(notebookFromJson(JSON.stringify({}))).to.deep.equal([]);
  });

  it("Q6a: notebookToJson and notebookFromJson round-trip a notebook", () => {
    const cells = [
      {kind: "code", language: "sql", value: "SELECT * FROM zstg_demo"},
      {kind: "markdown", language: "markdown", value: "a query"},
    ];
    const text = notebookToJson(cells);
    expect(text.endsWith("\n")).to.equal(true);
    expect(notebookFromJson(text)).to.deep.equal(cells);
  });

  // ---- Q7 "F8 on a table or a CDS view": name resolution off the file
  // alone (dataPreviewObjectOf), the MANDT filter SQL (dataPreviewQuery /
  // dataPreviewCountQuery), the row cap wording (dataPreviewStatusText)
  // and the façade's own datapreview XML (dataPreviewRows), held to
  // tableDataDocument's real shape the same way Q6a's freestyleRows tests
  // are above.

  it("Q7: dataPreviewObjectOf names a TABL and a DDLS off the file alone, and knows neither for anything else", () => {
    expect(dataPreviewObjectOf("/x/src/ddic/zstg_flightfact.tabl.xml")).to.deep.equal({type: "TABL", name: "ZSTG_FLIGHTFACT"});
    expect(dataPreviewObjectOf("zc_stg_flightcube.ddls.asddls")).to.deep.equal({type: "DDLS", name: "ZC_STG_FLIGHTCUBE"});
    expect(dataPreviewObjectOf("zc_stg_flightcube.ddls.xml")).to.deep.equal({type: "DDLS", name: "ZC_STG_FLIGHTCUBE"});
    expect(dataPreviewObjectOf("#ns#ztab.tabl.xml")).to.deep.equal({type: "TABL", name: "/NS/ZTAB"});
    expect(dataPreviewObjectOf("zcl_a.clas.abap")).to.equal(undefined);
    expect(dataPreviewObjectOf("zstg_flightfact.tabl.abap")).to.equal(undefined);
  });

  it("Q7: tablHasMandt reads a TABL's own DD03P rows, off the buffer -- ZSTG_FLIGHTFACT has the field, ZOSD_PACK does not", () => {
    const withMandt = readFileSync(new URL("../src/ddic/zstg_flightfact.tabl.xml", import.meta.url), "utf8");
    const withoutMandt = readFileSync(new URL("../src/status/zosd_pack.tabl.xml", import.meta.url), "utf8");
    expect(tablHasMandt(withMandt)).to.equal(true);
    expect(tablHasMandt(withoutMandt)).to.equal(false);
    expect(tablHasMandt(undefined)).to.equal(false);
  });

  it("Q7: dataPreviewQuery filters to the logon client only for a TABL that has MANDT and is not showing all clients", () => {
    expect(dataPreviewQuery("ZSTG_FLIGHTFACT", {hasMandt: true})).to.equal(`SELECT * FROM ZSTG_FLIGHTFACT WHERE MANDT = '${MANDT_CLIENT}'`);
    expect(MANDT_CLIENT).to.equal("123"); // CLAUDE.md "Known traps": the runtime's own sy-mandt
    expect(dataPreviewQuery("ZSTG_FLIGHTFACT", {hasMandt: true, allClients: true})).to.equal("SELECT * FROM ZSTG_FLIGHTFACT");
    expect(dataPreviewQuery("ZOSD_PACK", {hasMandt: false})).to.equal("SELECT * FROM ZOSD_PACK");
    // a DDLS is never filtered: the CDS-name view has no MANDT column at all
    expect(dataPreviewQuery("ZC_STG_FLIGHTCUBE", {hasMandt: false})).to.equal("SELECT * FROM ZC_STG_FLIGHTCUBE");
    expect(dataPreviewQuery("ZSTG_FLIGHTFACT")).to.equal("SELECT * FROM ZSTG_FLIGHTFACT");
  });

  it("Q7: dataPreviewCountQuery is the same statement, as a count", () => {
    expect(dataPreviewCountQuery("ZSTG_FLIGHTFACT", {hasMandt: true})).to.equal(`SELECT COUNT(*) AS N FROM ZSTG_FLIGHTFACT WHERE MANDT = '${MANDT_CLIENT}'`);
    expect(dataPreviewCountQuery("ZOSD_PACK", {hasMandt: false})).to.equal("SELECT COUNT(*) AS N FROM ZOSD_PACK");
  });

  it("Q7: dataPreviewStatusText says the row cap only once there is something to say about it", () => {
    expect(dataPreviewStatusText(24, 100)).to.equal("24 rows");
    expect(dataPreviewStatusText(1, 100)).to.equal("1 row");
    expect(dataPreviewStatusText(100, 100, 137)).to.equal("first 100 of 137");
    expect(dataPreviewStatusText(100, 100, undefined)).to.equal("first 100 rows");
  });

  it("Q7: dataPreviewRows reads tableDataDocument's own labels and keys, off the real façade shape (datapreview/ddic and /cds)", () => {
    const xml = tableDataDocument({
      rows: [{FACT_ID: "0000000001", AIRLINE: "LH"}, {FACT_ID: "0000000002", AIRLINE: "BA"}],
      columns: ["FACT_ID", "AIRLINE"],
    }, {fields: [
      {name: "FACT_ID", description: "Fact", key: true, letter: "N", dataType: "NUMC", length: 10},
      {name: "AIRLINE", description: "Airline", key: false, letter: "C", dataType: "CHAR", length: 3},
    ]});
    const {columns, rows} = dataPreviewRows(xml);
    expect(columns).to.deep.equal([
      {name: "FACT_ID", label: "Fact", key: true},
      {name: "AIRLINE", label: "Airline", key: false},
    ]);
    expect(rows).to.deep.equal([{FACT_ID: "0000000001", AIRLINE: "LH"}, {FACT_ID: "0000000002", AIRLINE: "BA"}]);
  });

  it("Q7: dataPreviewRows falls back to the column's own name when the façade did not know it (freestyle's own fallback metadata)", () => {
    const xml = tableDataDocument({rows: [{X: "1"}], columns: ["X"]}); // no fields option: the unknown-column branch
    expect(dataPreviewRows(xml).columns).to.deep.equal([{name: "X", label: "X", key: false}]);
  });

  // ---- Q4 "Hotspots": ZOSD_DUMP as heat, off the same freestyle SQL door
  // Q6a's notebook uses (HOTSPOTS_SQL, hotspotsFromRows); tableDataDocument
  // builds the real XML shape a server answers with, the same way Q6a's own
  // tests hold freestyleRows to the real document rather than a hand-typed one.

  it("Q4: HOTSPOTS_SQL is a SELECT, over zosd_dump, grouped by object/include/line", () => {
    expect(HOTSPOTS_SQL).to.match(/^SELECT\b/i);
    expect(HOTSPOTS_SQL).to.contain("FROM zosd_dump");
    expect(HOTSPOTS_SQL).to.contain("GROUP BY objname");
  });

  it("Q4: a server's own freestyle rows (real XML shape) become byLine and byFile counts", () => {
    const rows = [
      {objname: "ZCL_STG_DISPATCHER", include: "main", line: "119", n: "3", last_at: "1700000000000", last_message: "Division by zero"},
      {objname: "ZCL_STG_DISPATCHER", include: "main", line: "44", n: "1", last_at: "1700000001000", last_message: "no such field"},
      {objname: "ZCL_STG_ENTRY_PROVIDER", include: "testclasses", line: "7", n: "12", last_at: "1700000002000", last_message: "conversion"},
    ];
    const xml = tableDataDocument({columns: ["objname", "include", "line", "n", "last_at", "last_message"], rows});
    const {byLine, byFile} = hotspotsFromRows(freestyleRows(xml).rows);
    expect(byLine).to.have.length(3);
    const dispatcher119 = byLine.find((e) => e.objname === "ZCL_STG_DISPATCHER" && e.line === 119);
    expect(dispatcher119).to.deep.equal({objname: "ZCL_STG_DISPATCHER", include: "main", line: 119, count: 3, lastAt: 1700000000000, lastMessage: "Division by zero"});
    expect(byFile).to.deep.equal({ZCL_STG_DISPATCHER: 4, ZCL_STG_ENTRY_PROVIDER: 12});
  });

  it("Q4: a row with no object name or no usable line is dropped, not guessed at", () => {
    const {byLine, byFile} = hotspotsFromRows([
      {objname: "", include: "main", line: "5", n: "2"},
      {objname: "ZCL_A", include: "main", line: "", n: "1"},
      {objname: "ZCL_A", include: "main", line: "0", n: "1"},
    ]);
    expect(byLine).to.deep.equal([]);
    expect(byFile).to.deep.equal({});
    expect(hotspotsFromRows(undefined)).to.deep.equal({byLine: [], byFile: {}});
  });

  it("Q4: intensity buckets a fixed few steps rather than a scale fitted to the data", () => {
    expect([0, 1, 2, 4, 5, 9, 10, 999].map(hotspotBucket)).to.deep.equal([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("Q4: bucket colours are translucent and get heavier with the bucket", () => {
    const colors = [1, 2, 3, 4].map(hotspotColor);
    for (const c of colors) expect(c).to.match(/^rgba\(255, 0, 0, 0(\.\d+)?\)$/);
    const alpha = (c) => Number(/rgba\(255, 0, 0, (0(?:\.\d+)?)\)/.exec(c)[1]);
    expect(alpha(colors[0])).to.be.lessThan(alpha(colors[1]));
    expect(alpha(colors[1])).to.be.lessThan(alpha(colors[2]));
    expect(alpha(colors[2])).to.be.lessThan(alpha(colors[3]));
  });

  it("Q4: a badge is at most two characters (VS Code's own limit)", () => {
    expect(hotspotBadge(1)).to.equal("1");
    expect(hotspotBadge(9)).to.equal("9");
    expect(hotspotBadge(10)).to.equal("9+");
    expect(hotspotBadge(250)).to.equal("9+");
    for (const n of [1, 9, 10, 250]) expect(hotspotBadge(n)).to.have.length.at.most(2);
  });

  it("Q4: a line's hover names the count, the last time and the message", () => {
    const text = hotspotHoverText({count: 3, lastAt: Date.parse("2026-09-25T12:00:00Z"), lastMessage: "Division by zero"});
    expect(text).to.equal("3 dumps, last 2026-09-25T12:00:00.000Z: Division by zero");
    expect(hotspotHoverText({count: 1, lastAt: 0, lastMessage: ""})).to.equal("1 dump, last an unknown time: (no message)");
  });

  // gui-reports spike (docs/gui-reports.md): F8/"Open in VS Code" on a
  // converted report names the same transaction code
  // tools/osd-gui-convert.mjs wires it under. Held to that tool's own
  // namesOf() rather than to a literal, so the two cannot drift silently.
  it("names a report's webgui transaction the way osd-gui-convert.mjs wires it", () => {
    for (const program of ["ZGG_EX_001", "ZGG_EX_012", "ZGG_EX_043"]) {
      expect(progTcodeOf(program)).to.equal(guiConvertNamesOf(program).tcode);
    }
    expect(progTcodeOf(undefined)).to.equal(undefined);
    expect(progTcodeOf("")).to.equal(undefined);
  });

  it("builds the transaction URL after the externally reachable base, retaining its route prefix", () => {
    const url = new URL(webguiTransactionUrl("https://forwarded.example/proxy/?ticket=forwarded", "ZGUI_GG_EX_012"));
    expect(url.pathname).to.equal("/proxy/sap/bc/gui/sap/its/webgui/");
    expect(url.searchParams.get("okcode")).to.equal("ZGUI_GG_EX_012");
    expect(url.searchParams.get("ticket")).to.equal("forwarded");
  });

  it("reloads a report with distinct HTML on each F8 while keeping its transaction URL", () => {
    const url = webguiTransactionUrl("https://forwarded.example/proxy/", "ZGUI_GG_EX_012");
    const first = webguiPanelHtml(url, "ZGUI_GG_EX_012", 1);
    const second = webguiPanelHtml(url, "ZGUI_GG_EX_012", 2);
    expect(second).to.not.equal(first);
    expect(first).to.contain(`src="${url}"`);
    expect(second).to.contain(`src="${url}"`);
  });

  it("reserves one panel before concurrent external URI resolution and drops a stale result", async () => {
    const panels = new Map();
    const resolvers = [];
    const created = [];
    const createPanel = () => {
      const panel = {webview: {html: ""}, reveals: 0, reveal() { this.reveals++; }, onDidDispose(fn) { this.dispose = fn; }};
      created.push(panel);
      return panel;
    };
    const deps = {createPanel, resolveBase: () => new Promise((resolve) => resolvers.push(resolve)), panelHtml: webguiPanelHtml};
    const first = runWebguiPanel("ZGUI_GG_EX_012", "https://forwarded.example/", panels, deps);
    const second = runWebguiPanel("ZGUI_GG_EX_012", "https://forwarded.example/", panels, deps);
    expect(created).to.have.length(1);
    expect(created[0].reveals).to.equal(1);
    resolvers[1]("https://forwarded.example/");
    await second;
    const current = created[0].webview.html;
    resolvers[0]("https://forwarded.example/");
    await first;
    expect(created[0].webview.html).to.equal(current);
    expect(current).to.contain("ZGUI_GG_EX_012");
    const third = runWebguiPanel("ZGUI_GG_EX_012", "https://forwarded.example/", panels, deps);
    resolvers[2]("https://forwarded.example/");
    await third;
    expect(created).to.have.length(1);
    expect(created[0].webview.html).to.not.equal(current);
    created[0].dispose();
    expect(panels.size).to.equal(0);
  });

  it("places the run lens on a report's own REPORT line", () => {
    const source = "REPORT zgg_ex_001.\n\nSTART-OF-SELECTION.\n  WRITE 'hello world'.\n";
    const lens = progRunLens(source, "ZGG_EX_001");
    expect(lens).to.deep.equal({line: 1, tcode: "ZGUI_GG_EX_001", title: "▶ Run in Easy Access (ZGUI_GG_EX_001)"});
    // an include has no REPORT statement of its own: no lens rather than a
    // wrong line
    expect(progRunLens("* nothing but comments\n", "ZGG_EX_001_INC")).to.equal(undefined);
  });
});

describe("editors/vscode: Test Explorer grouping (Project / Packs / Workspace layers / System)", function () {
  const transpileConfig = JSON.parse(readFileSync(path.join(ROOT, "abap_transpile.json"), "utf8"));
  const layers = transpileLayers(transpileConfig);

  it("reads abap_transpile.json's own libs and input folders, not a hardcoded list", () => {
    expect(layers.inputFolders).to.deep.equal(["src", "test", "gen"]);
    const names = layers.libs.map((l) => l.name).sort();
    expect(names).to.deep.equal(
      ["abapgit", "ajson", "express-icf-shim", "open-abap-apc", "open-abap-core", "open-abap-gui", "open-abap-odata"].sort());
    expect(layers.libs.find((l) => l.name === "open-abap-core")).to.include(
      {name: "open-abap-core", folder: ".local/lars/open-abap-core"});
    // the build's own top-level exclude_filter (bug 3, docs/vscode-extension.md)
    expect(layers.excludeFilter.some((re) => re.test("/x/test/fixtures/y.clas.abap"))).to.equal(true);
    // and each lib's own, read the same way
    const core = layers.libs.find((l) => l.name === "open-abap-core");
    expect(core.excludeFilter.some((re) => re.test("/x/.local/lars/open-abap-core/src/tcp/y.clas.abap"))).to.equal(true);
  });

  it("classifies a project file under src/ as Project, with no sub-node of its own", () => {
    const abs = path.join(ROOT, "src/webgui/zcl_osd_webgui.clas.testclasses.abap");
    expect(classifyTestPath(ROOT, abs, layers)).to.deep.equal(
      {group: "project", subgroup: undefined, relInGroup: "src/webgui/zcl_osd_webgui.clas.testclasses.abap"});
  });

  it("classifies a project file under test/ the same way, gen/ included by the same rule though empty today", () => {
    const abs = path.join(ROOT, "test/unit/zcl_stg_gateway_test.clas.testclasses.abap");
    expect(classifyTestPath(ROOT, abs, layers).group).to.equal("project");
    expect(classifyTestPath(ROOT, abs, layers).relInGroup).to.equal("test/unit/zcl_stg_gateway_test.clas.testclasses.abap");
  });

  it("classifies a packs/* file under Packs, one sub-node per pack", () => {
    const zvdb = path.join(ROOT, "packs/zvdb/src/zcl_vdb_100_anydb.clas.testclasses.abap");
    expect(classifyTestPath(ROOT, zvdb, layers)).to.deep.equal(
      {group: "packs", subgroup: "zvdb", relInGroup: "src/zcl_vdb_100_anydb.clas.testclasses.abap"});
    const lsd = path.join(ROOT, "packs/lsd/src/zcl_lsd_media.clas.testclasses.abap");
    expect(classifyTestPath(ROOT, lsd, layers).subgroup).to.equal("lsd");
  });

  it("classifies a .local/lars/<lib> file under System, named by the lib's own folder", () => {
    const core = path.join(ROOT, ".local/lars/open-abap-core/src/rtti/cl_abap_typedescr.clas.testclasses.abap");
    expect(classifyTestPath(ROOT, core, layers)).to.deep.equal(
      {group: "system", subgroup: "open-abap-core", relInGroup: "src/rtti/cl_abap_typedescr.clas.testclasses.abap"});
    const json = path.join(ROOT, ".local/lars/open-abap-core/src/json/#ui2#cl_json.clas.testclasses.abap");
    expect(classifyTestPath(ROOT, json, layers).group).to.equal("system");
    expect(classifyTestPath(ROOT, json, layers).subgroup).to.equal("open-abap-core");
  });

  it("classifies under a running B0 workspace layer before System or Packs, even if it sits under .local", () => {
    const layerFolder = path.join(ROOT, ".local/lars/open-abap-core");
    const abs = path.join(layerFolder, "src/http/cl_http_server.clas.testclasses.abap");
    const workspaceLayers = [{folder: layerFolder}];
    expect(classifyTestPath(ROOT, abs, layers, workspaceLayers)).to.deep.equal(
      {group: "workspace", subgroup: "open-abap-core", relInGroup: "src/http/cl_http_server.clas.testclasses.abap"});
  });

  it("is undefined for a path outside every known root, rather than falling into Project (deploy/ is a staging folder, not a layer)", () => {
    const docs = path.join(ROOT, "docs/vscode-extension.md");
    expect(classifyTestPath(ROOT, docs, layers)).to.equal(undefined);
    // bug 3: exactly this shape (a real capture staged for a system's deploy,
    // never one of abap_transpile.json's input_folder/libs/packs)
    const deploy = path.join(ROOT, "deploy/lsd-a4h-011/src/zcl_zosd_011_lsd_media.clas.testclasses.abap");
    expect(classifyTestPath(ROOT, deploy, layers)).to.equal(undefined);
  });

  it("is undefined for a project file the build's own exclude_filter hides (bug 3: test/fixtures/)", () => {
    const abs = path.join(ROOT, "test/fixtures/adt-editor/zcl_editor.clas.testclasses.abap");
    // it IS under test/, an input_folder -- exclude_filter is what removes
    // it, not the root check: a layers with no excludeFilter at all still
    // classifies it as project, proving the root check alone would pass it
    expect(classifyTestPath(ROOT, abs, {...layers, excludeFilter: []}).group).to.equal("project");
    expect(classifyTestPath(ROOT, abs, layers)).to.equal(undefined);
  });

  it("is undefined for a lib file the LIB's own exclude_filter hides (open-abap-core's /src/tcp/)", () => {
    const abs = path.join(ROOT, ".local/lars/open-abap-core/src/tcp/zcl_x.clas.testclasses.abap");
    expect(classifyTestPath(ROOT, abs, layers)).to.equal(undefined);
  });

  it("bugs 1/2/6: is undefined when root and absPath share no common tree -- the packaged install's own osdHome (a materialized copy) versus the workspace folder a person actually opened", () => {
    // the bug: root is a different tree entirely (a materialized copy in
    // globalStorage, say), while absPath is the real, open workspace
    // folder's own file -- path.relative climbs out of one tree and back
    // down the other, landing on the fallback branch (now undefined) rather
    // than matching any of the four; before the fix that fallback answered
    // {group: "project", subgroup: undefined, relInGroup: "../../.../src/..."},
    // which is where the Project group's stray ".." sub-node came from
    const unrelatedRoot = path.join(ROOT, ".local", "not-a-real-osdhome");
    const abs = path.join(ROOT, "src/webgui/zcl_osd_webgui.clas.testclasses.abap");
    expect(classifyTestPath(unrelatedRoot, abs, layers)).to.equal(undefined);
    // the fix: classify against the file's OWN root instead, and it is fine again
    expect(classifyTestPath(ROOT, abs, layers)).to.deep.equal(
      {group: "project", subgroup: undefined, relInGroup: "src/webgui/zcl_osd_webgui.clas.testclasses.abap"});
    // bug 2 (Packs empty) is the same cause, over a packs/ file
    const zvdb = path.join(ROOT, "packs/zvdb/src/zcl_vdb_100_anydb.clas.testclasses.abap");
    expect(classifyTestPath(unrelatedRoot, zvdb, layers)).to.equal(undefined);
    expect(classifyTestPath(ROOT, zvdb, layers).group).to.equal("packs");
  });

  // ---- Item 4: a class abap_transpile.json's own `options.skip` already
  // marks as deliberately failing (ZOSD_TEST's own demo, so "Run" on
  // Project stays green) gets its own sub-node -- derived from that list
  // rather than a new marker, since it is already the single, explicit,
  // per-object statement of exactly this fact.

  it("reads the demo-failure objects off abap_transpile.json's own options.skip, not a new marker", () => {
    const demoObjects = demoFailureObjects(transpileConfig);
    expect(demoObjects.has("ZCL_ZOSD_TEST_DEMO")).to.equal(true);
    expect(demoObjects.has("ZCL_STG_GATEWAY_TEST")).to.equal(false);
    expect(demoFailureObjects(undefined)).to.deep.equal(new Set());
    expect(demoFailureObjects({options: {}})).to.deep.equal(new Set());
  });

  // ---- Item 5: abapGit keeps a program's local test classes inline, in
  // its own `*.prog.abap` (or an include it reaches) rather than split into
  // a `.testclasses.abap` the way a class's are -- hasTestMethods()/
  // objectOf() are already generic by suffix, so finding one is the same
  // scan with a wider glob (extension.js TEST_FILE_GLOB), not new lib.js
  // logic.

  it("finds FOR TESTING in a PROG's own main file the same way, and classifies it under Project", () => {
    const prog = readFileSync(path.join(ROOT, "src/zosd_test/src/zosd_test_demo_prog.prog.abap"), "utf8");
    expect(hasTestMethods(prog)).to.equal(true);
    expect(objectOf("zosd_test_demo_prog.prog.abap")).to.deep.equal(
      {type: "PROG", name: "ZOSD_TEST_DEMO_PROG", base: "zosd_test_demo_prog", include: "main"});
    const abs = path.join(ROOT, "src/zosd_test/src/zosd_test_demo_prog.prog.abap");
    expect(classifyTestPath(ROOT, abs, layers)).to.deep.equal(
      {group: "project", subgroup: undefined, relInGroup: "src/zosd_test/src/zosd_test_demo_prog.prog.abap"});
  });

  it("a PROG with no FOR TESTING at all is skipped by the same cheap filter as a class", () => {
    const plain = readFileSync(path.join(ROOT, "src/zosd_test/src/zosd_test_demo_plain.prog.abap"), "utf8");
    expect(hasTestMethods(plain)).to.equal(false);
  });

  it("sub-groups by the directory under src/ or test/ once package.xml is not there to ask", () => {
    expect(packageOf("src/rtti/cl_abap_typedescr.clas.testclasses.abap")).to.equal("rtti");
    expect(packageOf("test/adbc/zcl_adbc_test.clas.testclasses.abap")).to.equal("adbc");
    expect(packageOf("src/json/#ui2#cl_json.clas.testclasses.abap")).to.equal("json");
    // a file sitting directly in a content root, no directory of its own
    expect(packageOf("test/cl_http_client.clas.testclasses.abap")).to.equal(undefined);
  });

  it("prefers the nearest package.xml directory over the src/ guess when one is known", () => {
    const dirs = packageDirsFrom(["package.xml", "a/package.xml", "a/b/package.xml"]);
    expect(dirs).to.deep.equal(["", "a", "a/b"]);
    expect(packageOf("a/b/c/zcl_x.clas.testclasses.abap", dirs)).to.equal("a/b");
    expect(packageOf("a/zcl_y.clas.testclasses.abap", dirs)).to.equal("a");
    // a root package.xml alone: everything below it is the root package, i.e. no sub-node
    expect(packageOf("zcl_z.clas.testclasses.abap", packageDirsFrom(["package.xml"]))).to.equal(undefined);
  });

  it("only splits a group into packages once it is bigger than the ~15 the task named", () => {
    expect(PACKAGE_SPLIT_THRESHOLD).to.equal(15);
    expect(needsPackageSplit(15)).to.equal(false);
    expect(needsPackageSplit(16)).to.equal(true);
    // measured in this tree: open-abap-core's own test classes clear it, a single pack does not
    const coreCount = 62;
    const packCount = 1;
    expect(needsPackageSplit(coreCount)).to.equal(true);
    expect(needsPackageSplit(packCount)).to.equal(false);
  });

  it("finds FOR TESTING in a real testclasses include, case-insensitively", () => {
    const real = readFileSync(path.join(ROOT, "test/unit/zcl_stg_gateway_test.clas.testclasses.abap"), "utf8");
    expect(hasTestMethods(real)).to.equal(true);
    expect(hasTestMethods("class ltcl_x definition for testing.\nendclass.")).to.equal(true);
  });

  it("skips a testclasses include with no FOR TESTING at all, the cheap filter done before any server round trip", () => {
    expect(hasTestMethods("CLASS ltcl_empty DEFINITION.\nENDCLASS.\n")).to.equal(false);
    expect(hasTestMethods("")).to.equal(false);
    expect(hasTestMethods(undefined)).to.equal(false);
  });
});

// The "OSD: System" panel's Services tree (docs/vscode-extension.md,
// "Services tree"): grouping by kind, sorting inside a group, and the two
// normalisers that turn either source's own row shape (ZOSD_STATUS_SRV's
// ServiceSet or the composing route's own `GET core/http/services`) into
// the one shape groupServices/serviceLabel/serviceClassNodes read. Most
// logic is pure; route coverage below uses an in-memory ObjectStore, while
// the live round trip against a running osd is test/osd-child.mjs.
describe("editors/vscode: Services tree (grouping, sorting, URLs, normalization)", function () {
  it("labels the four named kinds SEGW's own words, and title-cases a kind it has never seen", () => {
    expect(serviceGroupLabel("ODATA")).to.equal("OData");
    expect(serviceGroupLabel("APP")).to.equal("Apps");
    expect(serviceGroupLabel("ICF")).to.equal("ICF");
    expect(serviceGroupLabel("APC")).to.equal("APC");
    expect(serviceGroupLabel("DAEMON")).to.equal("Daemon");
    expect(serviceGroupLabel("")).to.equal("Other");
    expect(serviceGroupLabel(undefined)).to.equal("Other");
  });

  it("normalizes a ZOSD_STATUS_SRV ServiceSet row: HandlerName is a class for every kind but APP", () => {
    const icf = normalizeServiceSetRow({Path: "/sap/bc/osd/rfc/", Kind: "ICF", HandlerName: "ZCL_OSD_RFC", Text: "RFC channel", Pack: ""});
    expect(icf).to.deep.equal({
      kind: "ICF", name: undefined, path: "/sap/bc/osd/rfc/", text: "RFC channel", pack: undefined,
      handler: "ZCL_OSD_RFC", handlerUri: undefined, handlerSource: undefined, app: undefined,
      mpc: undefined, mpcUri: undefined, mpcSource: undefined, helpers: [], source: undefined,
    });
    const app = normalizeServiceSetRow({Path: "/app/flp.html#Travel-manage", Kind: "APP", HandlerName: "travels", Text: "Travels", Pack: "o4d"});
    expect(app.handler).to.equal(undefined);
    expect(app.app).to.equal("travels");
    expect(app.pack).to.equal("o4d");
  });

  it("normalizes the composing route's own row, already the target shape, missing keys as undefined", () => {
    const odata = normalizeServiceRow({
      kind: "ODATA", name: "ZSTG_DEMO_SRV", path: "/sap/opu/odata/sap/ZSTG_DEMO_SRV", text: "Demo",
      handler: "ZCL_ZSTG_DEMO_DPC_EXT", handlerUri: "/sap/bc/adt/oo/classes/zcl_zstg_demo_dpc_ext",
      mpc: "ZCL_ZSTG_DEMO_MPC_EXT", mpcUri: "/sap/bc/adt/oo/classes/zcl_zstg_demo_mpc_ext",
      source: "src/demo/zstg_demo.iwsv.xml",
    });
    expect(odata).to.deep.equal({
      kind: "ODATA", name: "ZSTG_DEMO_SRV", path: "/sap/opu/odata/sap/ZSTG_DEMO_SRV", text: "Demo", pack: undefined,
      handler: "ZCL_ZSTG_DEMO_DPC_EXT", handlerUri: "/sap/bc/adt/oo/classes/zcl_zstg_demo_dpc_ext",
      handlerSource: undefined, app: undefined, mpc: "ZCL_ZSTG_DEMO_MPC_EXT", mpcUri: "/sap/bc/adt/oo/classes/zcl_zstg_demo_mpc_ext",
      mpcSource: undefined, helpers: [],
      source: "src/demo/zstg_demo.iwsv.xml",
    });
    const app = normalizeServiceRow({kind: "APP", path: "/app/index.html", text: "", handler: undefined, app: "travels"});
    expect(app.text).to.equal("");
    expect(app.app).to.equal("travels");
    expect(app.handler).to.equal(undefined);
  });

  it("groups by kind in OData/Apps/ICF/APC order, a new kind after them alphabetically, rows sorted by path", () => {
    expect(SERVICE_GROUP_ORDER).to.deep.equal(["ODATA", "APP", "ICF", "APC"]);
    const rows = [
      {kind: "ICF", path: "/sap/bc/osd/rfc/", text: "RFC"},
      {kind: "APP", path: "/app/flp.html#B", text: "B"},
      {kind: "JOB", path: "/job/z", text: "Z job"},
      {kind: "ODATA", path: "/sap/opu/odata/sap/ZB_SRV", text: "B service"},
      {kind: "ODATA", path: "/sap/opu/odata/sap/ZA_SRV", text: "A service"},
      {kind: "APP", path: "/app/flp.html#A", text: "A"},
      {kind: "APC", path: "/sap/bc/apc/z", text: "push"},
      {kind: "DAEMON", path: "/daemon/a", text: "A daemon"},
    ];
    const groups = groupServices(rows);
    expect(groups.map((g) => g.kind)).to.deep.equal(["ODATA", "APP", "ICF", "APC", "DAEMON", "JOB"]);
    expect(groups.map((g) => g.label)).to.deep.equal(["OData", "Apps", "ICF", "APC", "Daemon", "Job"]);
    const odataGroup = groups.find((g) => g.kind === "ODATA");
    expect(odataGroup.rows.map((r) => r.path)).to.deep.equal(["/sap/opu/odata/sap/ZA_SRV", "/sap/opu/odata/sap/ZB_SRV"]);
    const appGroup = groups.find((g) => g.kind === "APP");
    expect(appGroup.rows.map((r) => r.path)).to.deep.equal(["/app/flp.html#A", "/app/flp.html#B"]);
  });

  it("groups an empty list into no groups at all", () => {
    expect(groupServices([])).to.deep.equal([]);
    expect(groupServices(undefined)).to.deep.equal([]);
  });

  it("can regroup those same service rows by pack, keeping unpacked rows visible", () => {
    const groups = groupServices([
      {kind: "ODATA", pack: "o4d", path: "/z", text: "Z service"},
      {kind: "APP", pack: "o4d", path: "/a", text: "A app"},
      {kind: "ICF", pack: "zork", path: "/b", text: "B node"},
      {kind: "APC", pack: undefined, path: "/c", text: "C channel"},
    ], "pack");
    expect(groups.map((g) => g.label)).to.deep.equal(["o4d", "Unpacked", "zork"]);
    expect(groups[0].rows.map((r) => r.text)).to.deep.equal(["A app", "Z service"]);
    expect(groups[1].rows.map((r) => r.kind)).to.deep.equal(["APC"]);
    expect(groups.every((g) => g.groupBy === "pack")).to.equal(true);
  });

  it("labels a row by its own text first, then its name, then its path -- the path always in description", () => {
    expect(serviceLabel({text: "Travels", name: "ZSTG_DEMO_SRV", path: "/sap/opu/odata/sap/ZSTG_DEMO_SRV"}))
      .to.deep.equal({label: "Travels", description: "/sap/opu/odata/sap/ZSTG_DEMO_SRV"});
    expect(serviceLabel({text: "", name: "ZSTG_DEMO_SRV", path: "/sap/opu/odata/sap/ZSTG_DEMO_SRV"}))
      .to.deep.equal({label: "ZSTG_DEMO_SRV", description: "/sap/opu/odata/sap/ZSTG_DEMO_SRV"});
    expect(serviceLabel({text: "", name: undefined, path: "/app/index.html"}))
      .to.deep.equal({label: "/app/index.html", description: "/app/index.html"});
  });

  it("gives each kind its own lower-cased contextValue, for view/item/context in package.json to match", () => {
    expect(serviceContextValue("ODATA")).to.equal("osd-service-odata");
    expect(serviceContextValue("APP")).to.equal("osd-service-app");
    expect(serviceContextValue("ICF")).to.equal("osd-service-icf");
    expect(serviceContextValue("APC")).to.equal("osd-service-apc");
    expect(serviceContextValue("DAEMON")).to.equal("osd-service-daemon");
  });

  it("advertises only URL, metadata, WebSocket, test, and source actions with real targets", () => {
    expect(serviceActionContext({kind: "ODATA", path: "/odata"}, {sources: {dpc: {path: "dpc.abap"}}, testClasses: ["ZCL_TEST"]}))
      .to.equal("osd-service-odata;url;metadata;test;source-dpc");
    expect(serviceActionContext({kind: "APC", path: "/ws"}, {sources: {}, testClasses: []}))
      .to.equal("osd-service-apc;url;ws");
    expect(serviceActionContext({kind: "APP", path: ""}, {sources: {}, testClasses: []}))
      .to.equal("osd-service-app");
    expect(serviceActionContext({kind: "ODATA", path: "/odata"}, {sources: {dpc: {path: undefined}}, testClasses: []}))
      .to.equal("osd-service-odata;url;metadata");
  });

  it("resolves Test and Source before a service row is first shown in the tree", async () => {
    const api = vscodeStub();
    const {OsdTreeProvider} = loadTreeItems(api);
    const controller = {launcher: {state: "running"}, onDidChange: () => {}};
    const row = {kind: "ODATA", path: "/sap/opu/odata/sap/ZDEMO", handler: "ZCL_DEMO_DPC_EXT"};
    const provider = new OsdTreeProvider(controller, async () => ({sources: {dpc: {path: "src/demo.clas.abap"}}, testClasses: ["ZCL_TEST"]}));
    try {
      const [item] = await provider.serviceRowItems({rows: [row]});
      expect(item.contextValue).to.equal("osd-service-odata;url;metadata;test;source-dpc");
    } finally {
      provider.dispose();
    }
  });

  it("builds the URL a click or a context action opens: the plain path for APP/ICF/ODATA, $metadata beside it, ws:// for APC", () => {
    const base = "http://localhost:3591";
    const odata = {path: "/sap/opu/odata/sap/ZSTG_DEMO_SRV"};
    expect(serviceHttpUrl(odata, base)).to.equal("http://localhost:3591/sap/opu/odata/sap/ZSTG_DEMO_SRV");
    expect(serviceMetadataUrl(odata, base)).to.equal("http://localhost:3591/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata");
    const apc = {path: "/sap/bc/apc/zosd/push"};
    expect(serviceWsUrl(apc, base)).to.equal("ws://localhost:3591/sap/bc/apc/zosd/push");
    expect(serviceWsUrl(apc, "https://localhost:44300")).to.equal("wss://localhost:44300/sap/bc/apc/zosd/push");
    const app = {path: "/app/flp.html#Travel-manage"};
    expect(serviceHttpUrl(app, base)).to.equal("http://localhost:3591/app/flp.html#Travel-manage");
  });

  it("uses VS Code's external URI for a metadata link in a remote workspace", async () => {
    const row = {path: "/sap/opu/odata/sap/ZDEMO"};
    const externalized = [];
    const url = await serviceMetadataExternalUrl(row, "http://localhost:3030", async (raw) => {
      externalized.push(raw);
      return "https://forwarded.example/sap/opu/odata/sap/ZDEMO/$metadata";
    });
    expect(externalized).to.deep.equal(["http://localhost:3030/sap/opu/odata/sap/ZDEMO/$metadata"]);
    expect(url).to.equal("https://forwarded.example/sap/opu/odata/sap/ZDEMO/$metadata");
  });

  it("expands an OData row to its DPC then its MPC, an ICF/APC row to its one handler, an APP row to nothing", () => {
    const odata = {kind: "ODATA", handler: "ZCL_X_DPC_EXT", handlerUri: "/sap/bc/adt/oo/classes/zcl_x_dpc_ext",
      mpc: "ZCL_X_MPC_EXT", mpcUri: "/sap/bc/adt/oo/classes/zcl_x_mpc_ext"};
    expect(serviceClassNodes(odata)).to.deep.equal([
      {role: "dpc", name: "ZCL_X_DPC_EXT", uri: "/sap/bc/adt/oo/classes/zcl_x_dpc_ext", source: undefined},
      {role: "mpc", name: "ZCL_X_MPC_EXT", uri: "/sap/bc/adt/oo/classes/zcl_x_mpc_ext", source: undefined},
    ]);
    // ServiceSet carries no uri at all -- still a node, just nothing to open by uri
    const icf = {kind: "ICF", handler: "ZCL_OSD_RFC", handlerUri: undefined};
    expect(serviceClassNodes(icf)).to.deep.equal([{role: "handler", name: "ZCL_OSD_RFC", uri: undefined, source: undefined}]);
    const apc = {kind: "APC", handler: "ZCL_OSD_APC_HANDLER", handlerUri: "/sap/bc/adt/oo/classes/zcl_osd_apc_handler"};
    expect(serviceClassNodes(apc)).to.deep.equal([{role: "handler", name: "ZCL_OSD_APC_HANDLER", uri: "/sap/bc/adt/oo/classes/zcl_osd_apc_handler", source: undefined}]);
    const app = {kind: "APP", app: "travels"};
    expect(serviceClassNodes(app)).to.deep.equal([]);
    // a kind this client has never seen, but that still carries a handler
    const daemon = {kind: "DAEMON", handler: "ZCL_OSD_DAEMON"};
    expect(serviceClassNodes(daemon)).to.deep.equal([{role: "handler", name: "ZCL_OSD_DAEMON", uri: undefined, source: undefined}]);
  });

  it("keeps generated MPC helpers under their service row", () => {
    const odata = {kind: "ODATA", handler: "ZCL_X_DPC_EXT", mpc: "ZCL_X_MPC_EXT", helpers: [
      {role: "annotations", name: "ZCL_X_MPC_ANN", source: "gen/stg/x/zcl_x_mpc_ann.clas.abap"},
      {role: "registry", name: "ZCL_STG_SEGW_REGISTRY", source: "gen/segw/zcl_stg_segw_registry.clas.abap"},
    ]};
    expect(serviceClassNodes(odata).map((node) => node.name)).to.deep.equal([
      "ZCL_X_DPC_EXT", "ZCL_X_MPC_EXT", "ZCL_X_MPC_ANN", "ZCL_STG_SEGW_REGISTRY",
    ]);
    expect(serviceClassNodes({kind: "APP", app: "travel", helpers: [
      {role: "registry", name: "ZCL_STG_BSP_REGISTRY", source: "gen/bsp/zcl_stg_bsp_registry.clas.abap"},
    ]})).to.deep.equal([{role: "registry", name: "ZCL_STG_BSP_REGISTRY", uri: undefined,
      source: "gen/bsp/zcl_stg_bsp_registry.clas.abap"}]);
  });

  it("resolves manifest identity, inbound intent, and dataSources to the OData service rows", () => {
    const app = appManifestDetails({"sap.app": {
      id: "stg.travel", title: "Travels", dataSources: {mainService: {uri: "../sap/opu/odata/sap/ZSTG_DEMO_SRV/"}},
      crossNavigation: {inbounds: {"Travel-manage": {}, "Travel-display": {}}},
    }}, {app: "stg.travel", source: "webapp"}, [
      {kind: "ODATA", name: "ZSTG_DEMO_SRV", path: "/sap/opu/odata/sap/ZSTG_DEMO_SRV"},
    ]);
    expect(app).to.deep.equal({id: "stg.travel", title: "Travels", intent: "Travel-manage", folder: "webapp",
      dataSources: [{key: "mainService", uri: "../sap/opu/odata/sap/ZSTG_DEMO_SRV/", service: "ZSTG_DEMO_SRV"}]});
  });

  it("collects HTTP test files by full service URL or a service URL assembled in source", () => {
    expect(httpTestFiles([
      {path: "test/e2e/travel.spec.mjs", source: `fetch(base + "/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet")`},
      {path: "test/other.mjs", source: "ZSTG_DEMO_SRV but no OData request"},
      {path: "test/http.mjs", source: "const url = '/sap/opu/odata/sap/ZOTHER_SRV'"},
      {path: "test/other-service.mjs", source: "// ZSTG_DEMO_SRV is unrelated here\nfetch('/sap/opu/odata/sap/ZOTHER_SRV/Set')"},
      {path: "test/assembled.mjs", source: "fetch('/sap/opu/odata/sap/' + 'ZSTG_DEMO_SRV' + '/Set')"},
    ], "/sap/opu/odata/sap/ZSTG_DEMO_SRV", "ZSTG_DEMO_SRV")).to.deep.equal(["test/assembled.mjs", "test/e2e/travel.spec.mjs"]);
  });

  it("keeps non runnable report and dynpro transactions visible without an Open command", () => {
    const {TransactionItem} = loadTreeItems(vscodeStub());
    const report = new TransactionItem(normalizeTransactionRow({tcode: "ZREP", kind: "REPORT", runnable: false, reason: "unbound"}));
    const dynpro = new TransactionItem(normalizeTransactionRow({tcode: "ZSCREEN", kind: "DYNPRO", runnable: false, reason: "missing screen"}));
    const runnable = new TransactionItem(normalizeTransactionRow({tcode: "ZRUN", kind: "CLASS", runnable: true}));
    expect(report.label).to.equal("ZREP");
    expect(report.command).to.equal(undefined);
    expect(dynpro.command).to.equal(undefined);
    expect(runnable.command?.command).to.equal("osd.openWebguiTransaction");
  });

  it("unions closure tests and filters dumps whose mapped frames name the DPC or MPC", () => {
    expect(closureTestNames({tests: ["ZCL_B", "ZCL_A"]}, {tests: ["ZCL_A", "ZCL_C"]})).to.deep.equal(["ZCL_A", "ZCL_B", "ZCL_C"]);
    const row = {handler: "ZCL_X_DPC_EXT", mpc: "ZCL_X_MPC_EXT"};
    expect(dumpsForService([
      {frames: [{file: "src/demo/zcl_x_mpc_ext.clas.abap"}]},
      {frames: [{file: "src/demo/zcl_other.clas.abap"}]},
      {frames: []},
    ], row)).to.have.lengthOf(1);
  });

  it("normalizes transaction registry reports and renders escaped service details with source links", () => {
    expect(normalizeTransactionRow({tcode: "ZREP", text: "A report", kind: "REPORT", runnable: true, source: "gen/gui/zrep.tran.xml"}))
      .to.include({tcode: "ZREP", kind: "REPORT", runnable: true, source: "gen/gui/zrep.tran.xml"});
    const html = serviceDetailsHtml({row: {kind: "ODATA", text: "<Demo>", path: "/sap/opu/odata/sap/ZDEMO", handler: "ZCL_DEMO_DPC_EXT", mpc: "ZCL_DEMO_MPC_EXT"},
      metadataUrl: "http://localhost/sap/opu/odata/sap/ZDEMO/$metadata",
      sources: {dpc: {path: "src/zcl_demo_dpc_ext.clas.abap"}, mpc: {path: "src/zcl_demo_mpc_ext.clas.abap"}},
      entitySets: [{set: "TravelSet", kind: "get_entityset"}],
      closures: {dpc: {counts: {objects: 5, tests: 1}, tests: ["ZCL_TEST"]}, mpc: {counts: {objects: 4, tests: 0}, tests: []}},
      readers: {dpc: {counts: {readers: 3, tests: 1}}, mpc: {counts: {readers: 1, tests: 0}}},
      serving: {generation: "abc123", warm: {state: "primed"}}, dumps: [], httpTests: ["test/e2e/service.spec.mjs"]}, "testnonce");
    expect(html).to.contain("&lt;Demo&gt;").and.to.contain("ABAP Unit by reference").and.to.contain("HTTP tests by URL");
    expect(html).to.contain("TravelSet").and.to.contain("abc123").and.to.contain("data-source=\"dpc\"");
    expect(html).to.contain("test/e2e/service.spec.mjs");
  });
});

describe("editors/vscode/lib.js: service details data routes", () => {
  it("reads xref closures and the transaction registry through their server routes", async () => {
    const calls = [];
    const client = new Osd("http://localhost:3620", async (url) => {
      calls.push(url);
      return {
        ok: true, status: 200,
        json: async () => url.includes("/transactions")
          ? {transactions: [{tcode: "ZREP", text: "Converted report", kind: "CLASS", runnable: true, source: "gen/gui/zrep.tran.xml"}]}
          : {type: "CLAS", name: "ZCL_DEMO_DPC_EXT", tests: ["ZCL_DEMO_TEST"], counts: {objects: 8, tests: 1}},
      };
    });
    const closure = await client.closure("CLAS", "ZCL_DEMO_DPC_EXT");
    const transactions = await client.transactions();
    expect(closure.counts).to.deep.equal({objects: 8, tests: 1});
    expect(transactions[0]).to.include({tcode: "ZREP", kind: "CLASS", source: "gen/gui/zrep.tran.xml"});
    expect(calls[0]).to.equal("http://localhost:3620/sap/bc/adt/core/http/xref/closure?type=CLAS&name=ZCL_DEMO_DPC_EXT");
    expect(calls[1]).to.equal("http://localhost:3620/sap/bc/adt/core/http/transactions");
  });
});

describe("tools/adt-facade: service detail inventories", function () {
  let server;
  let base;

  before(async function () {
    const app = express();
    const store = new ObjectStore({root: ROOT, libs: []});
    app.use(adtRouter({store, data: {}, watch: false}).router);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}/sap/bc/adt/core/http`;
  });

  after(async function () {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  });

  it("returns exact service class source paths and keeps generated helpers under OData/App rows", async () => {
    const response = await fetch(`${base}/services`);
    expect(response.status).to.equal(200);
    const {services} = await response.json();
    const demo = services.find((row) => row.kind === "ODATA" && row.name === "ZSTG_DEMO_SRV");
    expect(demo.handlerSource).to.match(/\.clas\.abap$/);
    expect(demo.mpcSource).to.match(/\.clas\.abap$/);
    expect(demo.helpers).to.be.an("array");
    expect(services.find((row) => row.kind === "APP").handlerSource).to.equal(undefined);
  });

  it("returns source-relative transaction registry rows including hand-declared transactions", async () => {
    const response = await fetch(`${base}/transactions`);
    expect(response.status).to.equal(200);
    const {transactions} = await response.json();
    expect(transactions.find((row) => row.tcode === "ZOSD_NOTE").source).to.equal("src/webgui/zosd_note.tran.xml");
    expect(transactions.every((row) => row.source.endsWith(".tran.xml"))).to.equal(true);
  });
});

// "run tests on a different database" (docs/vscode-extension.md,
// "Databases"): Osd#run's own half of the wiring -- a fake fetch, no
// server, so this proves the body/headers/query-string split without a
// running osd. The other half (which env a caller builds, and what the
// façade route does with it) is tools/adt-facade.mjs `unitRunDbEnv`
// (test/adt-facade.mjs) and tools/osd-unit.mjs `unitChildEnv`
// (test/osd-unit.mjs).
describe("editors/vscode/lib.js: Osd#run's dbEnv (run tests on a different database)", () => {
  function fakeOsd() {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({url, options});
      if (options.method === "HEAD") {
        return {status: 200, headers: {get: (name) => (name === "x-csrf-token" ? "TOK" : undefined), getSetCookie: () => []}};
      }
      return {ok: true, status: 200, headers: {get: () => undefined}, json: async () => ({ok: true}), text: async () => ""};
    };
    return {client: new Osd("http://localhost:3611", fetchImpl), calls};
  }

  it("with no dbEnv sends no body at all -- the façade route's own default, unchanged", async () => {
    const {client, calls} = fakeOsd();
    await client.run({type: "CLAS", name: "ZCL_X"}, "LTCL_A", "M1");
    const post = calls.find((c) => c.options.method === "POST");
    expect(post.options.body).to.equal(undefined);
    expect(post.options.headers?.["content-type"]).to.equal(undefined);
    expect(post.url).to.contain("testClass=LTCL_A").and.to.contain("method=M1");
  });

  it("with a dbEnv sends it as a JSON body, never in the query string a server logs", async () => {
    const {client, calls} = fakeOsd();
    await client.run({type: "CLAS", name: "ZCL_X"}, undefined, undefined, {STG_DB: "hana", HANA_PASSWORD: "s3cret", HANA_SCHEMA: "OSD_TEST"});
    const post = calls.find((c) => c.options.method === "POST");
    expect(post.url).to.not.contain("s3cret");
    expect(post.url).to.not.contain("HANA_PASSWORD");
    expect(post.options.headers["content-type"]).to.equal("application/json");
    expect(JSON.parse(post.options.body)).to.deep.equal({dbEnv: {STG_DB: "hana", HANA_PASSWORD: "s3cret", HANA_SCHEMA: "OSD_TEST"}});
  });

  it("requests a paused child for a debugger run", async () => {
    const {client, calls} = fakeOsd();
    await client.run({type: "CLAS", name: "ZCL_X"}, "LTCL_A", "M1", undefined, 9444, true);
    const post = calls.find((c) => c.options.method === "POST");
    expect(JSON.parse(post.options.body)).to.deep.equal({inspectPort: 9444, waitForDebugger: true});
  });
});

// ---- T7 "Rebuild (warm)" (docs/vscode-extension.md "Warm"): the pure
// half of the status bar's, the tree's and Ctrl+F3's own text, off
// /osd/serving's `warm` field (tools/osd-store.mjs warmStatus()) and an
// activation's own build headers (activate()/activateMany(), tools/adt-
// facade.mjs warmHeaders()) -- both real server shapes, held here rather
// than re-derived from a running one.

describe("editors/vscode: T7 warm status and build text", function () {
  it("warmStatusText: nothing for off or no warm field at all", () => {
    expect(warmStatusText(undefined)).to.equal(undefined);
    expect(warmStatusText({state: "off"})).to.equal(undefined);
  });

  it("warmStatusText: warming up while priming, warm once primed", () => {
    expect(warmStatusText({state: "priming"})).to.equal("warming up…");
    expect(warmStatusText({state: "primed"})).to.equal("warm");
  });

  it("warmStatusText: cold with the reason exactly as the server gave it", () => {
    expect(warmStatusText({state: "cold", reason: "the transpiler has no `only` option (abaplint/transpiler#1900)"}))
      .to.equal("cold: the transpiler has no `only` option (abaplint/transpiler#1900)");
    expect(warmStatusText({state: "cold"})).to.equal("cold: not primed");
  });

  it("activationBuildText: a warm build that swapped, one that recycled a host-held module, and a cold one", () => {
    expect(activationBuildText({build: "warm", swapMs: 12})).to.equal("hot-swapped in 12 ms (warm)");
    expect(activationBuildText({build: "warm", swapMs: undefined})).to.equal("recycled (host-held module)");
    expect(activationBuildText({build: "cold"})).to.equal("cold build");
    expect(activationBuildText({build: "cold; the transpiler has no `only` option (abaplint/transpiler#1900)"}))
      .to.equal("cold build: the transpiler has no `only` option (abaplint/transpiler#1900)");
  });

  it("activationBuildText: undefined when the answer carried no X-OSD-Build at all", () => {
    expect(activationBuildText({})).to.equal(undefined);
    expect(activationBuildText(undefined)).to.equal(undefined);
  });

  it("closureTestsText: the count, or nothing for none or no closure at all", () => {
    expect(closureTestsText({closureTests: ["ZCL_X_TESTCLASSES"]})).to.equal("1 test in the closure");
    expect(closureTestsText({closureTests: ["ZCL_X", "ZCL_Y", "ZCL_Z"]})).to.equal("3 tests in the closure");
    expect(closureTestsText({closureTests: []})).to.equal(undefined);
    expect(closureTestsText({})).to.equal(undefined);
    expect(closureTestsText(undefined)).to.equal(undefined);
  });
});
