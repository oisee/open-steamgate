import {expect} from "chai";
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {spawn} from "node:child_process";
import {tmpdir} from "node:os";
import {dirname, join, relative, resolve} from "node:path";
import {pathToFileURL, fileURLToPath} from "node:url";
import {ObjectStore} from "../tools/osd-store.mjs";
import {UnitRun} from "../tools/osd-unit.mjs";
import {hashOf} from "../tools/osd-build.mjs";
import {modulesOf, transpile} from "../tools/osd-transpile.mjs";
import {createRequire} from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const {pickInspectorPort, packNameOf} = createRequire(import.meta.url)("../editors/vscode/launcher.js");
const {Launcher} = createRequire(import.meta.url)("../editors/vscode/launcher.js");
const {debuggerConfiguration, runningAbapSources, breakpointWarning} = createRequire(import.meta.url)("../editors/vscode/lib.js");
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeVlq(text) {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const char of text) {
    const digit = BASE64.indexOf(char);
    if (digit < 0) throw new Error(`invalid source-map VLQ character: ${char}`);
    value |= (digit & 31) << shift;
    if ((digit & 32) !== 0) {
      shift += 5;
      continue;
    }
    values.push((value & 1) === 1 ? -(value >> 1) : value >> 1);
    value = 0;
    shift = 0;
  }
  return values;
}

function generatedPosition(mappings, sourceIndex, sourceLine, sourceColumn) {
  let previousSource = 0;
  let previousLine = 0;
  let previousColumn = 0;
  for (const [lineIndex, line] of mappings.split(";").entries()) {
    let generatedColumn = 0;
    for (const segment of line.split(",")) {
      if (segment === "") continue;
      const [generatedDelta, sourceDelta, lineDelta, columnDelta] = decodeVlq(segment);
      generatedColumn += generatedDelta;
      if (sourceDelta === undefined) continue;
      previousSource += sourceDelta;
      previousLine += lineDelta;
      previousColumn += columnDelta;
      if (previousSource === sourceIndex && previousLine === sourceLine - 1 && previousColumn >= sourceColumn) {
        return {line: lineIndex + 1, column: generatedColumn};
      }
    }
  }
  return undefined;
}

class InspectorClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
    this.waiters = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (pending === undefined) return;
        this.pending.delete(message.id);
        if (message.error !== undefined) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result ?? {});
        return;
      }
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.method === message.method && waiter.predicate(message.params));
      if (waiterIndex >= 0) this.waiters.splice(waiterIndex, 1)[0].resolve(message.params);
      else this.events.push(message);
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    const result = new Promise((resolve, reject) => this.pending.set(id, {resolve, reject}));
    this.socket.send(JSON.stringify({id, method, params}));
    return result;
  }

  waitFor(method, predicate = () => true, timeoutMs = 15000) {
    const index = this.events.findIndex((event) => event.method === method && predicate(event.params));
    if (index >= 0) return Promise.resolve(this.events.splice(index, 1)[0].params);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.resolve !== finish);
        reject(new Error(`timed out waiting for inspector event ${method}`));
      }, timeoutMs);
      const finish = (params) => {
        clearTimeout(timer);
        resolve(params);
      };
      this.waiters.push({method, predicate, resolve: finish});
    });
  }
}

async function inspectorTarget(port) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const [target] = await response.json();
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {
      // The detached child has not opened its inspector yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`unit child inspector did not open on port ${port}`);
}

function breakpointFor(sourcePath, sourceLine, sourceColumn) {
  const output = join(ROOT, "output");
  for (const name of readdirSync(output).filter((entry) => entry.endsWith(".mjs.map"))) {
    const mapFile = realpathSync(join(output, name));
    const data = JSON.parse(readFileSync(mapFile, "utf8"));
    const source = data.sources.find((entry) => {
      const absolute = resolve(dirname(mapFile), entry);
      return absolute === sourcePath || (sourcePath.endsWith("/src/webgui/zcl_osd_abap_tokens.clas.testclasses.abap") &&
        entry.replaceAll("\\", "/").endsWith("/src/webgui/zcl_osd_abap_tokens.clas.testclasses.abap"));
    });
    if (source === undefined) continue;
    const position = generatedPosition(data.mappings, data.sources.indexOf(source), sourceLine, sourceColumn);
    if (position === undefined) continue;
    const moduleFile = mapFile.slice(0, -4);
    return {url: pathToFileURL(realpathSync(moduleFile)).href, lineNumber: position.line - 1,
      columnNumber: position.column, source, position};
  }
  throw new Error(`no source-map position for ${sourcePath}:${sourceLine}`);
}

describe("VS Code debugger transport: detached ABAP Unit child", function () {
  this.timeout(180000);

  it("keeps projected DPC maps portable and resolves them through attach overrides", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-dpc-map-"));
    try {
      const home = join(dir, "home");
      const storage = join(dir, "storage");
      const workspace = join(dir, "workspace");
      const workspaceSource = join(workspace, "src");
      const packSource = join(storage, "packs", packNameOf(workspace), "src");
      const generation = join(home, "build", "by-input", "abc123", "output");
      const otherWorkspace = join(dir, "other-workspace", "src");
      mkdirSync(workspaceSource, {recursive: true});
      mkdirSync(otherWorkspace, {recursive: true});
      mkdirSync(dirname(packSource), {recursive: true});
      symlinkSync(workspaceSource, packSource, "dir");
      writeFileSync(join(dirname(packSource), "osd-pack.json"), JSON.stringify({name: "projected", abap: "src"}));
      const source = join(workspaceSource, "zcl_ship_dpc_ext.clas.abap");
      const abap = `CLASS zcl_ship_dpc_ext DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS shipset_get_entityset.
ENDCLASS.
CLASS zcl_ship_dpc_ext IMPLEMENTATION.
  METHOD shipset_get_entityset.
    DATA lv_count TYPE i.
    lv_count = 1.
  ENDMETHOD.
ENDCLASS.`;
      writeFileSync(source, abap);
      writeFileSync(join(otherWorkspace, "zcl_ship_dpc_ext.clas.abap"), abap);
      const config = {input_folder: relative(home, packSource),
        output_folder: relative(home, generation), input_filter: [".*\\.abap$"], exclude_filter: [],
        libs: [], options: {}, write_source_map: true, write_unit_tests: false};
      await transpile({root: home, config, modules: modulesOf(ROOT)});
      const map = JSON.parse(readFileSync(join(generation, "zcl_ship_dpc_ext.clas.mjs.map"), "utf8"));
      const mapped = map.sources.find((entry) => entry.endsWith("zcl_ship_dpc_ext.clas.abap"));
      expect(mapped).to.equal(`${relative(generation, packSource).replaceAll("\\", "/")}/zcl_ship_dpc_ext.clas.abap`);
      expect(JSON.stringify(map)).not.to.include(workspace);
      expect(JSON.stringify(map)).not.to.include(storage);
      symlinkSync(generation, join(home, "output"), "dir");
      const attach = debuggerConfiguration(9341, {root: home, storageDir: storage,
        layers: [{folder: workspace, srcDir: workspaceSource}]});
      expect(attach.outFiles).to.deep.equal([`${generation}/**/*.mjs`]);
      expect(attach.resolveSourceMapLocations).to.deep.equal([`${generation}/**`, "!**/node_modules/**"]);
      expect(attach.pauseForSourceMap).to.equal(true);
      expect(attach.sourceMapPathOverrides[`${dirname(mapped)}/*`]).to.equal(`${workspaceSource}/*`);
      expect(attach.sourceMapPathOverrides[`file://${packSource}/*`]).to.equal(`${workspaceSource}/*`);
      const running = runningAbapSources(home, {storageDir: storage,
        layers: [{folder: workspace, srcDir: workspaceSource}]});
      expect(breakpointWarning(source, running), "the compiled DPC file is the editor's breakpoint source")
        .to.equal(undefined);
      // The same bytes under a retargeted projection may reuse the same
      // generation: its map names the stable projection, while the attach
      // config points to the workspace now open in the editor.
      const previousPacks = process.env.OSD_PACKS;
      process.env.OSD_PACKS = join(storage, "packs");
      let before;
      let after;
      try {
        before = hashOf(ROOT);
        rmSync(packSource);
        symlinkSync(otherWorkspace, packSource, "dir");
        after = hashOf(ROOT);
      } finally {
        if (previousPacks === undefined) delete process.env.OSD_PACKS;
        else process.env.OSD_PACKS = previousPacks;
      }
      expect(after).to.equal(before);
      await transpile({root: home, config, modules: modulesOf(ROOT)});
      const retargeted = JSON.parse(readFileSync(join(generation, "zcl_ship_dpc_ext.clas.mjs.map"), "utf8"));
      expect(retargeted).to.deep.equal(map);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it("binds a workspace ABAP Unit breakpoint at a multiline call's executable start", async () => {
    const source = `CLASS ltcl_probe DEFINITION FINAL FOR TESTING.
  PRIVATE SECTION.
    METHODS helper IMPORTING iv_text TYPE string.
    METHODS counts FOR TESTING.
ENDCLASS.
CLASS ltcl_probe IMPLEMENTATION.
  METHOD helper.
  ENDMETHOD.
  METHOD counts.
    me->helper(
      iv_text = 'hello'
    ).
  ENDMETHOD.
ENDCLASS.`;
    const dir = mkdtempSync(join(tmpdir(), "osd-statement-map-"));
    let client;
    let child;
    let exited;
    try {
      const home = join(dir, "home");
      const storage = join(dir, "instance");
      const workspace = join(dir, "workspace");
      const workspaceSource = join(workspace, "src");
      const packSource = join(storage, "packs", packNameOf(workspace), "src");
      mkdirSync(workspaceSource, {recursive: true});
      mkdirSync(dirname(packSource), {recursive: true});
      symlinkSync(workspaceSource, packSource, "dir");
      writeFileSync(join(workspace, "osd-pack.json"), JSON.stringify({name: "probe", abap: "src"}));
      writeFileSync(join(workspaceSource, "zcl_probe.clas.abap"),
        "CLASS zcl_probe DEFINITION PUBLIC FINAL CREATE PUBLIC. PUBLIC SECTION. ENDCLASS. " +
        "CLASS zcl_probe IMPLEMENTATION. ENDCLASS.");
      const testFile = join(workspaceSource, "zcl_probe.clas.testclasses.abap");
      writeFileSync(testFile, source);
      const config = {input_folder: relative(home, packSource), output_folder: "build/by-input/generation/output",
        input_filter: [".*\\.abap$"], exclude_filter: [], libs: [], options: {},
        write_source_map: true, write_unit_tests: false};
      await transpile({root: home, config, modules: modulesOf(ROOT)});
      const module = join(home, config.output_folder, "zcl_probe.clas.testclasses.mjs");
      const map = JSON.parse(readFileSync(module + ".map", "utf8"));
      expect(realpathSync(resolve(dirname(module), map.sources[0]))).to.equal(testFile);
      const position = generatedPosition(map.mappings, 0, 10, 4);
      expect(position, "ABAP call line has a source-map position").to.not.equal(undefined);
      const generated = readFileSync(module, "utf8").split("\n")[position.line - 1];
      expect(generated.slice(position.column)).to.match(/^await this\.me\.get\(\)\.#helper\(/);
      const port = await pickInspectorPort();
      const attach = debuggerConfiguration(port, {target: "unit", root: home, storageDir: storage,
        layers: [{folder: workspace, srcDir: workspaceSource, manifest: join(workspace, "osd-pack.json")}]});
      expect(attach.sourceMapPathOverrides[`${dirname(map.sources[0])}/*`]).to.equal(`${workspaceSource}/*`);
      expect(attach.outFiles).to.deep.equal([`${home}/build/live/output/**/*.mjs`]);

      const runner = join(dir, "runner.mjs");
      const runtime = createRequire(import.meta.url).resolve("@abaplint/runtime");
      writeFileSync(runner, `import runtime from ${JSON.stringify(pathToFileURL(runtime).href)};\n` +
        `globalThis.abap = new runtime.ABAP();\n` +
        `await import(${JSON.stringify(pathToFileURL(module).href)});\n` +
        `await new abap.Classes['CLAS-ZCL_PROBE-LTCL_PROBE']().FRIENDS_ACCESS_INSTANCE.counts();\n`);
      child = spawn(process.execPath, [`--inspect-brk=127.0.0.1:${port}`, "--enable-source-maps", runner],
        {cwd: dir, stdio: "ignore"});
      exited = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve(code));
      });
      const target = await inspectorTarget(port);
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, {once: true});
        socket.addEventListener("error", reject, {once: true});
      });
      client = new InspectorClient(socket);
      await client.send("Debugger.enable");
      const breakpoint = await client.send("Debugger.setBreakpointByUrl", {
        url: pathToFileURL(module).href, lineNumber: position.line - 1, columnNumber: position.column,
      });
      await client.send("Runtime.runIfWaitingForDebugger");
      await client.waitFor("Debugger.paused"); // entry in runner.mjs
      await client.send("Debugger.resume");
      const hit = await client.waitFor("Debugger.paused");
      expect(hit.hitBreakpoints).to.include(breakpoint.breakpointId);
      expect(hit.callFrames[0].location.lineNumber).to.equal(position.line - 1);
      await client.send("Debugger.resume");
      client.socket.close();
      client = undefined;
      expect(await exited).to.equal(0);
    } finally {
      if (child?.exitCode === null) child.kill("SIGTERM");
      client?.socket.close();
      await exited?.catch(() => {});
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it("attaches over CDP and stops on an ABAP line in a test method", async () => {
    const sourcePath = join(ROOT, "src/webgui/zcl_osd_abap_tokens.clas.testclasses.abap");
    const sourceLines = readFileSync(sourcePath, "utf8").split(/\r?\n/);
    const sourceLine = sourceLines.findIndex((line) => line.includes("lt_token = zcl_osd_abap_tokens=>scan")) + 1;
    expect(sourceLine).to.be.greaterThan(0);
    const breakpoint = breakpointFor(sourcePath, sourceLine, sourceLines[sourceLine - 1].search(/\S/));
    const inspectPort = await pickInspectorPort();
    const runner = new UnitRun(new ObjectStore({root: ROOT}));
    const resultPromise = runner.runDetached("CLAS", "ZCL_OSD_ABAP_TOKENS", {
      testClass: "LTCL_SCAN",
      method: "KEYWORDS_AND_NAMES",
      inspectPort,
      waitForDebugger: true,
    });
    let client;
    let released = false;
    try {
      const target = await inspectorTarget(inspectPort);
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, {once: true});
        socket.addEventListener("error", reject, {once: true});
      });
      client = new InspectorClient(socket);
      await client.send("Debugger.enable");
      const set = await client.send("Debugger.setBreakpointByUrl", {
        url: breakpoint.url,
        lineNumber: breakpoint.lineNumber,
        columnNumber: breakpoint.columnNumber,
      });
      expect(set.breakpointId).to.be.a("string");
      await client.send("Runtime.runIfWaitingForDebugger");
      released = true;
      const entry = await client.waitFor("Debugger.paused");
      expect(entry.reason).to.equal("Break on start");
      await client.send("Debugger.resume");
      const paused = await client.waitFor("Debugger.paused");
      expect(paused.hitBreakpoints).to.include(set.breakpointId);
      expect(paused.callFrames[0].location.lineNumber).to.equal(breakpoint.lineNumber);
      const script = client.events.find((event) => event.method === "Debugger.scriptParsed"
        && event.params.scriptId === paused.callFrames[0].location.scriptId);
      expect(script?.params.url).to.equal(breakpoint.url);
      await client.send("Debugger.resume");
      client.socket.close();
      client = undefined;
      const result = await resultPromise;
      expect(result.ok).to.equal(true);
      expect(result.counts).to.include({passed: 1, failed: 0});
    } finally {
      if (client !== undefined) {
        if (!released) await client.send("Runtime.runIfWaitingForDebugger").catch(() => {});
        await client.send("Debugger.resume").catch(() => {});
        client.socket.close();
      }
      await resultPromise.catch(() => {});
    }
  });

  it("terminates a child paused at startup when the debug request is aborted", async () => {
    const inspectPort = await pickInspectorPort();
    const cancellation = new AbortController();
    const runner = new UnitRun(new ObjectStore({root: ROOT}));
    const resultPromise = runner.runDetached("CLAS", "ZCL_OSD_ABAP_TOKENS", {
      testClass: "LTCL_SCAN", method: "KEYWORDS_AND_NAMES", inspectPort,
      waitForDebugger: true, signal: cancellation.signal,
    });
    try {
      await inspectorTarget(inspectPort);
      cancellation.abort();
      try {
        await resultPromise;
        throw new Error("expected cancelled run");
      } catch (error) {
        expect(error.message).to.equal("ABAP Unit run cancelled");
      }
      let closed = false;
      try {
        await fetch(`http://127.0.0.1:${inspectPort}/json/list`);
      } catch {
        closed = true;
      }
      expect(closed, "the paused inspector closed").to.equal(true);
    } finally {
      cancellation.abort();
      await resultPromise.catch(() => {});
    }
  });
});

describe("VS Code debugger transport: serving DPC after earlier activity", function () {
  this.timeout(180000);

  it("pauses on a DPC line after a plain call, a detached session, and Stop/Start", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "osd-dpc-debug-"));
    const launcher = new Launcher({osdHome: ROOT, storageDir, workspaceFolders: [], warm: "off"});
    const sourcePath = join(ROOT, "src/demo/zcl_zstg_demo_dpc_ext.clas.abap");
    const lines = readFileSync(sourcePath, "utf8").split(/\r?\n/);
    const sourceLine = lines.findIndex((line) => line.includes("lt_status = ranges_for(")) + 1;
    expect(sourceLine).to.be.greaterThan(0);
    let client;
    try {
      for (let run = 0; run < 2; run++) {
        const {port} = await launcher.start();
        const breakpoint = breakpointFor(sourcePath, sourceLine, lines[sourceLine - 1].search(/\S/));
        const url = `http://127.0.0.1:${port}/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$format=json`;
        // This request loads and executes the DPC before any debugger exists.
        expect((await fetch(url)).status).to.equal(200);
        const inspectPort = await launcher.openInspector();
        for (let session = 0; session < 2; session++) {
          const target = await inspectorTarget(inspectPort);
          const socket = new WebSocket(target.webSocketDebuggerUrl);
          await new Promise((resolve, reject) => {
            socket.addEventListener("open", resolve, {once: true});
            socket.addEventListener("error", reject, {once: true});
          });
          client = new InspectorClient(socket);
          await client.send("Debugger.enable");
          const scripts = client.events.filter((event) => event.method === "Debugger.scriptParsed" &&
            event.params.url.includes("zcl_zstg_demo_dpc_ext"));
          expect(scripts.map((event) => event.params.url), `expected ${breakpoint.url}`).to.include(breakpoint.url);
          const set = await client.send("Debugger.setBreakpointByUrl", {
            url: breakpoint.url, lineNumber: breakpoint.lineNumber, columnNumber: breakpoint.columnNumber,
          });
          if (set.locations.length === 0) {
            await client.waitFor("Debugger.breakpointResolved", (event) => event.breakpointId === set.breakpointId);
          }
          const response = fetch(url);
          const paused = await client.waitFor("Debugger.paused");
          expect(paused.hitBreakpoints).to.include(set.breakpointId);
          await client.send("Debugger.resume");
          expect((await response).status).to.equal(200);
          client.socket.close();
          client = undefined;
        }
        await launcher.stop();
      }
    } finally {
      client?.socket.close();
      await launcher.stop();
      rmSync(storageDir, {recursive: true, force: true});
    }
  });
});

describe("VS Code controller: Attach and call across a generation switch", function () {
  it("waits for the replacement session's verified DPC breakpoint despite late old termination", async () => {
    const home = mkdtempSync(join(tmpdir(), "osd-attach-generation-"));
    const first = join(home, "build", "by-input", "first", "output");
    const second = join(home, "build", "by-input", "second", "output");
    mkdirSync(first, {recursive: true});
    mkdirSync(second, {recursive: true});
    symlinkSync(first, join(home, "output"), "dir");
    const listeners = {start: [], end: []};
    const events = [];
    const file = join(home, "src", "zcl_demo_dpc_ext.clas.abap");
    class SourceBreakpoint {
      constructor() { this.enabled = true; this.location = {uri: {scheme: "file", fsPath: file}}; }
    }
    const api = {
      SourceBreakpoint,
      EventEmitter: class { event = () => ({dispose() {}}); fire() {} },
      TreeItem: class {},
      workspace: {onDidChangeWorkspaceFolders: () => ({dispose() {}})},
      window: {setStatusBarMessage: () => ({dispose() {}})},
      debug: {
        breakpoints: [new SourceBreakpoint()],
        onDidStartDebugSession(fn) { listeners.start.push(fn); return {dispose() {}}; },
        onDidTerminateDebugSession(fn) { listeners.end.push(fn); return {dispose() {}}; },
        async stopDebugging(session) {
          events.push(`stop ${session.id}`);
          // VS Code may deliver termination after the new session starts.
        },
        async startDebugging(_folder, config) {
          events.push(`start ${config.outFiles[0]}`);
          return true;
        },
      },
    };
    const require = createRequire(import.meta.url);
    const Module = require("node:module");
    const extensionPath = require.resolve("../editors/vscode/extension.js");
    delete require.cache[extensionPath];
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === "vscode") return api;
      return originalLoad.call(this, request, parent, isMain);
    };
    let SystemController;
    try { ({SystemController} = require(extensionPath)); }
    finally { Module._load = originalLoad; }
    try {
      const output = [];
      const controller = new SystemController({subscriptions: []}, {appendLine: (line) => output.push(line)});
      controller.launcher = {state: "running", inspectPort: 9401, inspectorOpen: true, debug: false,
        osdHome: home, storageDir: home, layers: []};
      controller.debuggerState = {systemPort: 9401};
      controller.debuggerOutputPattern = `${first}/**/*.mjs`;
      const old = {id: "old", name: "OSD: ABAP (9401)",
        getDebugProtocolBreakpoint: async () => ({verified: true})};
      listeners.start.forEach((fn) => fn(old));
      rmSync(join(home, "output"));
      symlinkSync(second, join(home, "output"), "dir");
      expect(await controller.attachSystemDebugger({onDemand: true})).to.equal(true);
      expect(events).to.deep.equal([`stop old`, `start ${second}/**/*.mjs`]);
      // The old DAP marker was verified, but the serving generation changed.
      let ready = false;
      const waiting = controller.waitForDebuggerReady(file, 500).then((value) => { ready = value; return value; });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(ready).to.equal(false);
      const replacement = {id: "new", name: old.name,
        getDebugProtocolBreakpoint: async () => ({verified: true})};
      listeners.start.forEach((fn) => fn(replacement));
      listeners.end.forEach((fn) => fn(old));
      expect(await waiting).to.equal(true);
      expect(controller.activeSystemSessionId).to.equal("new");
      expect(controller.debuggerState.systemPort).to.equal(9401);
      expect(output).to.deep.equal([]);
    } finally {
      rmSync(home, {recursive: true, force: true});
    }
  });
});
