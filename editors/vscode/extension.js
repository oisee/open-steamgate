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
const crypto = require("node:crypto");
const {objectOf, adtObjectOf, fileOf, Osd, outcomes, runActionFor, entitySetLenses, methodAtLine, resultRows, stripMetadata, keyOf,
  readersLensLine, readersLensTitle, readersQuickPickItems, readerFilePattern,
  freestyleTableHtml, freestyleOutputItems, notebookAbapSource, notebookFromJson, notebookToJson,
  hotspotBucket, hotspotColor, hotspotBadge, hotspotHoverText, implementsClassrun,
  dataPreviewObjectOf, tablHasMandt, dataPreviewQuery, dataPreviewCountQuery, dataPreviewStatusText,
  transpileLayers, classifyTestPath, needsPackageSplit, packageOf, hasTestMethods, demoFailureObjects, progRunLens,
  groupServices, serviceLabel, serviceContextValue, serviceActionContext, normalizeTransactionRow,
  appManifestDetails, httpTestFiles, closureTestNames, dumpsForService, serviceDetailsHtml,
  serviceHttpUrl, serviceMetadataUrl, serviceMetadataExternalUrl, serviceWsUrl, serviceClassNodes,
  webguiPanelHtml, runWebguiPanel,
  warmStatusText, activationBuildText, closureTestsText,
  presetSettings, isOpenSteamgateCheckout: isOpenSteamgateManifest, osdHomeChoice, osdStateContext, systemOverviewModel,
  debuggerConfiguration, debugAttachPlan, runWithDebuggerAttach, breakpointToggleText} = require("./lib.js");
const {Launcher, ensureMaterializedHome, materializedHomeDir, selectOldHomes, listOldHomes,
  detectWorkspaceLayers, databaseEnv, defaultDedicatedName, describeDatabase,
  isOpenSteamgateCheckout: isOpenSteamgatePath, decideStartTarget, classify, PORT_RANGE, isFree,
  pickInspectorPort, SEED_ID_FILE} = require("./launcher.js");
const {systemOverviewHtml} = require("./system-overview.js");

// Q6a "Notebook SQL, ABAP and SQLScript" (docs/vscode-extension.md): the
// notebook type a *.osdnb file opens as and the controller for its cells.
const NOTEBOOK_TYPE = "osd-sql-notebook";

// One report panel per transaction code. F8 and the CodeLens both reach the
// same command, so a second run should refresh the existing view in place.
const webguiPanels = new Map();

const EXCLUDE = "{**/node_modules/**,**/.local/**,**/output/**,**/gen/**,**/build/**}";

function osd() {
  const url = vscode.workspace.getConfiguration("osd").get("url", "http://localhost:3030");
  if (osd.client?.url !== url.replace(/\/+$/, "")) osd.client = new Osd(url);
  return osd.client;
}

// ---- B0 "Pocket SAP" spike (docs/vscode-extension.md, "B0 spike"): the
// extension starts and stops the system itself, over editors/vscode/launcher.js
// (the pure half, unit-tested without VS Code in test/vscode-launcher.mjs).
// Everything below is the VS Code glue: which folder is osdHome, where this
// window's own storage is, the tree view, the status bar Start/Stop and
// "Open launchpad".

/** `osd.home` when set, else the workspace folder when the window has
 *  exactly one -- the task's own resolution order. `undefined` when neither
 *  applies (no workspace, or more than one folder and no setting), which
 *  every caller below treats as "nothing to start". */
function osdHomeOf() {
  const configured = vscode.workspace.getConfiguration("osd").get("home", "").trim();
  return osdHomeChoice({configuredHome: configured, workspaces: workspaceDescriptors()})?.path;
}

function workspaceDescriptors() {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(folder.uri.fsPath, "package.json"), "utf8"));
    } catch {
      manifest = undefined;
    }
    return {
      path: folder.uri.fsPath,
      isOpenSteamgate: isOpenSteamgateManifest(manifest, {
        buildScript: fs.existsSync(path.join(folder.uri.fsPath, "tools", "osd-build.mjs")),
        vscodeExtension: fs.existsSync(path.join(folder.uri.fsPath, "editors", "vscode", "package.json")),
      }),
    };
  });
}

/** Whether this install carries a bundled seed to run (a packaged .vsix,
 *  `scripts/build-vsix.mjs`'s own `extension/osd/`) -- checked by a file
 *  `test/run.mjs` itself needs, not by the directory merely existing,
 *  which a dev install (the symlink from `editors/vscode/` onto this
 *  checkout, `docs/vscode-extension.md`'s "remote/WSL note") never has. */
function bundledSeedDir(context) {
  const dir = path.join(context.extensionUri.fsPath, "osd");
  return fs.existsSync(path.join(dir, "test", "run.mjs")) ? dir : undefined;
}

function bundledHomeDir(context, seedDir) {
  const seedId = fs.readFileSync(path.join(seedDir, SEED_ID_FILE), "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(seedId)) throw new Error(`Invalid packaged seed ID in ${seedDir}`);
  return materializedHomeDir(context.globalStorageUri.fsPath, seedId);
}

function materializeBundledHome(context, seedDir, launcher) {
  return ensureMaterializedHome(seedDir, context.globalStorageUri.fsPath, {
    previousHome: launcher?.osdHome,
    onNotice: (line) => { void vscode.window.showInformationMessage(`osd: ${line}`); },
  });
}

const BUNDLED_HOME_PREFERENCE = "osd.startHomePreference";
const START_HOME_PROMPT = "Run the system from this folder? (edits go to your files and git)";
const START_HOME_YES = "Yes";
const START_HOME_NO = "No, use the bundled copy (remembered)";
const START_HOME_ALWAYS_ASK = "Always ask";

/** The remembered "use the bundled copy" answer, as the visible workspace
 *  setting osd.startSource. An answer an older build kept in workspace
 *  storage is moved there once, so it can be seen and undone in Settings. */
async function startSourcePreference(context) {
  if (context.workspaceState.get(BUNDLED_HOME_PREFERENCE) === "bundled") {
    await setStartSource("bundled");
    await context.workspaceState.update(BUNDLED_HOME_PREFERENCE, undefined);
  }
  return vscode.workspace.getConfiguration("osd").get("startSource", "ask") === "bundled" ? "bundled" : undefined;
}

async function setStartSource(value) {
  const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration("osd").update("startSource", value, target);
}

/** osd: Choose which system Start runs -- the one place to leave "always
 *  bundled", point Start at a checkout, or go back to asking. */
async function chooseStartSystem(context, controller) {
  const config = vscode.workspace.getConfiguration("osd");
  const folders = vscode.workspace.workspaceFolders;
  const workspaceFolder = folders?.length === 1 ? folders[0].uri.fsPath : undefined;
  const checkout = workspaceFolder !== undefined && isOpenSteamgatePath(workspaceFolder);
  const scope = folders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  const home = config.get("home", "").trim();
  const source = config.get("startSource", "ask");
  const items = [];
  if (bundledSeedDir(context)) {
    items.push({label: "$(package) Bundled copy", description: home === "" && source === "bundled" ? "current" : "",
      detail: "The system packaged in this extension, in its own working copy.", pick: "bundled"});
  }
  if (checkout) {
    items.push({label: "$(folder) This workspace folder", description: home === workspaceFolder ? "current" : "",
      detail: workspaceFolder, pick: "workspace"});
  }
  items.push({label: "$(folder-opened) Another open-steamgate checkout...", description: home !== "" && home !== workspaceFolder ? `current: ${home}` : "",
    detail: "Pick a folder; it needs npm install and npm run bootstrap.", pick: "other"});
  items.push({label: "$(question) Ask each time", description: home === "" && source === "ask" ? "current" : "",
    detail: "Start asks when the open folder is an open-steamgate checkout; otherwise it runs the bundled copy.", pick: "ask"});
  const chosen = await vscode.window.showQuickPick(items, {placeHolder: "Which system should osd: Start run?"});
  if (!chosen) return;
  if (chosen.pick === "bundled") {
    await config.update("home", "", scope);
    await setStartSource("bundled");
  } else if (chosen.pick === "workspace") {
    await config.update("home", workspaceFolder, vscode.ConfigurationTarget.Workspace);
    await setStartSource("ask");
  } else if (chosen.pick === "other") {
    const picked = await vscode.window.showOpenDialog({canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
      openLabel: "Run this checkout"});
    if (!picked?.length) return;
    const dir = picked[0].fsPath;
    if (!isOpenSteamgatePath(dir)) {
      void vscode.window.showErrorMessage(`osd: ${dir} is not an open-steamgate checkout (no abap_transpile.json or tools/osd-build.mjs).`);
      return;
    }
    await config.update("home", dir, scope);
    await setStartSource("ask");
  } else {
    await config.update("home", "", scope);
    await setStartSource("ask");
  }
  const restart = "Restart now";
  const answer = await vscode.window.showInformationMessage("osd: the next Start runs the chosen system.", restart);
  if (answer === restart) {
    await controller.stop();
    await controller.start();
  }
}

/** Resolve the pure launcher decision against this VS Code window. A
 *  workspace checkout gets a choice only when a packaged bundled system is
 *  available; development installs without one already run the open folder
 *  as their system. Choosing the bundle is remembered in workspace storage,
 *  while Always ask uses it this time and clears that preference. */
async function resolveStartTarget(context, launcher) {
  const configured = vscode.workspace.getConfiguration("osd").get("home", "").trim();
  const folders = vscode.workspace.workspaceFolders;
  const workspaceFolder = folders?.length === 1 ? folders[0].uri.fsPath : undefined;
  const descriptor = workspaceDescriptors().find((folder) => folder.path === workspaceFolder);
  const checkout = workspaceFolder !== undefined &&
    (isOpenSteamgatePath(workspaceFolder) || descriptor?.isOpenSteamgate === true);
  const seedDir = bundledSeedDir(context);
  const preference = await startSourcePreference(context);
  const facts = {configuredHome: configured, workspaceFolder, workspaceIsOpenSteamgate: checkout,
    bundledHome: seedDir, rememberedChoice: preference};
  let target = decideStartTarget(facts);

  if (target.kind === "prompt") {
    const answer = await vscode.window.showInformationMessage(
      START_HOME_PROMPT, START_HOME_YES, START_HOME_NO, START_HOME_ALWAYS_ASK);
    if (answer === undefined) return {kind: "cancelled"};
    if (answer === START_HOME_YES) {
      await vscode.workspace.getConfiguration("osd").update("home", workspaceFolder, vscode.ConfigurationTarget.Workspace);
      target = decideStartTarget({...facts, configuredHome: workspaceFolder});
    } else {
      if (answer === START_HOME_NO) {
        await setStartSource("bundled");
      } else if (answer === START_HOME_ALWAYS_ASK) {
        await setStartSource("ask");
      } else {
        return {kind: "cancelled"};
      }
      // Always ask still needs a source for this Start. Use the bundle for
      // this run; because the choice was cleared, the next Start asks again.
      target = decideStartTarget({...facts, rememberedChoice: "bundled"});
    }
  }

  if (target.kind === "ready" && target.source === "bundled") {
    target.osdHome = materializeBundledHome(context, seedDir, launcher);
  }
  return target;
}

function homeSourceText(source) {
  if (source === "workspace") return "from workspace";
  if (source === "bundled") return "bundled copy";
  return undefined;
}

/** Selected home and its visible source. A packaged extension chooses the
 *  bundled copy, except when the open-steamgate checkout itself is open;
 *  DX2 uses that checkout as osd.home so edits reach the system in view. */
function osdHomeChoiceFor(context, homeMode = "auto") {
  const configured = vscode.workspace.getConfiguration("osd").get("home", "").trim();
  const folders = workspaceDescriptors();
  const seedDir = bundledSeedDir(context);
  const bundledHome = seedDir === undefined ? undefined : bundledHomeDir(context, seedDir);
  return {...(osdHomeChoice({configuredHome: configured, workspaces: folders, bundledHome, bundledAvailable: seedDir !== undefined, homeMode}) ?? {}), seedDir};
}

/** Mainline's first-start choice takes precedence in auto mode for a packaged
 *  install opened on the checkout. Other preset modes use DX2's pure choice. */
async function resolveStartChoice(context, homeMode = "auto", launcher) {
  if (homeMode === "auto") {
    const folders = vscode.workspace.workspaceFolders;
    const workspaceFolder = folders?.length === 1 ? folders[0].uri.fsPath : undefined;
    const descriptor = workspaceDescriptors().find((folder) => folder.path === workspaceFolder);
    const checkout = workspaceFolder !== undefined &&
      (isOpenSteamgatePath(workspaceFolder) || descriptor?.isOpenSteamgate === true);
    if (checkout && bundledSeedDir(context) !== undefined) {
      const target = await resolveStartTarget(context, launcher);
      if (target.kind === "cancelled") return target;
      if (target.kind === "ready") {
        return {
          path: target.osdHome,
          kind: target.source === "bundled" ? "bundled copy" : "osd.home",
          source: target.source,
          materialized: target.source === "bundled",
        };
      }
    }
  }

  const choice = osdHomeChoiceFor(context, homeMode);
  if (choice.path === undefined) return undefined;
  const folders = vscode.workspace.workspaceFolders;
  const workspaceFolder = folders?.length === 1 ? folders[0].uri.fsPath : undefined;
  const source = choice.kind === "bundled copy" ? "bundled"
    : choice.path === workspaceFolder ? "workspace" : "configured";
  return {...choice, source};
}

/** Explicit cleanup only: the selection and modal confirmation both finish
 *  before any directory is removed. Re-read the current launcher afterward. */
async function removeOldWorkingCopies(context, controller) {
  const storageDir = context.globalStorageUri.fsPath;
  const sizeLabel = (bytes) => bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  const currentHome = () => {
    const seedDir = bundledSeedDir(context);
    return seedDir === undefined ? undefined : bundledHomeDir(context, seedDir);
  };
  const servedHome = () => controller.launcher?.state !== "stopped" ? controller.launcher?.osdHome : undefined;
  try {
    const homes = listOldHomes(storageDir, currentHome(), servedHome());
    if (homes.length === 0) {
      await vscode.window.showInformationMessage("osd: No old working copies found.");
      return;
    }
    const picked = await vscode.window.showQuickPick(homes.map((home) => ({
      label: path.basename(home.path),
      description: `${sizeLabel(home.size)} · edited: ${home.edited ? "yes or unknown" : "no"}`,
      detail: home.path,
      home,
    })), {canPickMany: true, placeHolder: "Select old working copies to remove"});
    if (!picked?.length) return;
    const selected = picked.map((item) => item.home.path);
    const answer = await vscode.window.showWarningMessage(
      `Delete ${selected.length} old working ${selected.length === 1 ? "copy" : "copies"}?`,
      {modal: true, detail: selected.join("\n")}, "Delete selected");
    if (answer !== "Delete selected") return;

    const entries = fs.readdirSync(storageDir).map((name) => {
      const home = path.join(storageDir, name);
      return {path: home, isDirectory: fs.lstatSync(home).isDirectory()};
    });
    const eligible = selectOldHomes(entries, currentHome(), servedHome(), selected);
    for (const home of eligible) fs.rmSync(home.path, {recursive: true});
    await vscode.window.showInformationMessage(`osd: Removed ${eligible.length} old working ${eligible.length === 1 ? "copy" : "copies"}.`);
  } catch (error) {
    await vscode.window.showErrorMessage(`osd: Could not remove old working copies: ${error.message}`);
  }
}

/** Every byte a launch needs beyond osdHome's own tracked files lives here:
 *  the extension's own global storage, one subdirectory per osdHome (a
 *  short hash of its path, so two different checkouts never share a
 *  database or a TLS folder) -- never under osdHome and never under a
 *  workspace folder. */
function storageDirFor(context, osdHome) {
  const hash = crypto.createHash("sha1").update(osdHome).digest("hex").slice(0, 16);
  return path.join(context.globalStorageUri.fsPath, "osd-instance", hash);
}

/** `osd.warm`'s own setting (T7, docs/vscode-extension.md "Warm"): "auto",
 *  "on" or "off", read fresh on every launch the way osd.home is. */
function osdWarmModeOf() {
  return vscode.workspace.getConfiguration("osd").get("warm", "auto");
}

/** `osd.debug` is read at each launch and each unit run so a settings change
 *  takes effect without reloading the extension. */
function osdDebugEnabled() {
  return vscode.workspace.getConfiguration("osd").get("debug", false) === true;
}

/** The workspace folders to offer as layers, minus osdHome itself -- a
 *  workspace that IS the open-steamgate checkout (the common case while
 *  developing this extension) must never be layered on top of itself. */
function workspaceFoldersFor(osdHome) {
  const resolvedHome = osdHome === undefined ? undefined : path.resolve(osdHome);
  return (vscode.workspace.workspaceFolders ?? [])
    .map((f) => f.uri.fsPath)
    .filter((f) => path.resolve(f) !== resolvedHome);
}

// ---- databases (docs/vscode-extension.md, "Databases") -------------------
//
// `osd.database.system` picks what the running system itself sits on;
// `osd.database.tests` (default "same") lets a detached ABAP Unit run sit
// on a DIFFERENT one -- system=sqlite, tests=hana runs a live Fiori session
// on SQLite while the Test Explorer proves the same DPC against a real
// HANA. Connection settings (host/port/user/database or schema) are plain
// `settings.json`, per kind; a password is never one of them -- it lives in
// `context.secrets`, put there by "osd: Set database password (HANA)" /
// "(PostgreSQL)", and is read back only right before it is handed to a
// process's own environment (launcher.js `databaseEnv`, never argv, never a
// tracked file).

const HANA_PASSWORD_SECRET = "osd.database.hana.password";
const POSTGRES_PASSWORD_SECRET = "osd.database.postgres.password";

/** `{kind, host, port, user, database, schema, password, fresh}` for
 *  `kind` (one of DATABASE_KINDS), read from `osd.database.<kind>.*` and
 *  `context.secrets`. `osdHome` names the dedicated schema/database this
 *  window defaults to when the setting is left empty (launcher.js
 *  `defaultDedicatedName`), so two windows on two different checkouts never
 *  collide in one shared HANA or PostgreSQL by accident. */
async function databaseConfigFor(context, kind, osdHome) {
  const config = vscode.workspace.getConfiguration("osd");
  if (kind === "sqlite" || kind === "duckdb") {
    return {kind};
  }
  const dedicated = defaultDedicatedName(osdHome ?? "");
  if (kind === "postgres") {
    return {
      kind,
      host: config.get("database.postgres.host", "").trim() || undefined,
      port: config.get("database.postgres.port", 0) || undefined,
      user: config.get("database.postgres.user", "").trim() || undefined,
      database: config.get("database.postgres.database", "").trim() || `osd_${dedicated}`,
      password: await context.secrets.get(POSTGRES_PASSWORD_SECRET),
    };
  }
  if (kind === "hana") {
    return {
      kind,
      host: config.get("database.hana.host", "").trim() || undefined,
      port: config.get("database.hana.port", 0) || undefined,
      user: config.get("database.hana.user", "").trim() || undefined,
      schema: config.get("database.hana.schema", "").trim() || `OSD_${dedicated.toUpperCase()}`,
      fresh: config.get("database.hana.fresh", false) === true,
      password: await context.secrets.get(HANA_PASSWORD_SECRET),
    };
  }
  throw new Error(`osd.database: unknown kind "${kind}"`);
}

/** `osd.database.system`'s own config -- what the launcher starts on. */
async function systemDatabaseConfig(context, osdHome) {
  const kind = vscode.workspace.getConfiguration("osd").get("database.system", "sqlite");
  return databaseConfigFor(context, kind, osdHome);
}

/** `osd.database.tests`'s own config, or `undefined` for "same" (the
 *  default) -- exactly the façade route's own default when no `dbEnv` is
 *  sent at all (tools/adt-facade.mjs, tools/osd-unit.mjs `unitChildEnv`):
 *  a detached run's usual throwaway SQLite file. */
async function testsDatabaseConfig(context, osdHome) {
  const kind = vscode.workspace.getConfiguration("osd").get("database.tests", "same");
  if (kind === "same") {
    return undefined;
  }
  return databaseConfigFor(context, kind, osdHome);
}

/** The `env: {STG_DB, HANA_..., PG...}` a run of tests should carry with it
 *  over `Osd#run`'s own request body, whatever `osd.database.tests` is
 *  right now -- `undefined` for "same", which sends no body at all (the
 *  route's default, unchanged). */
async function testsDbEnv(context, osdHome) {
  const config = await testsDatabaseConfig(context, osdHome);
  return config === undefined ? undefined : databaseEnv(config);
}

async function setDatabasePassword(context, kind) {
  const secretKey = kind === "hana" ? HANA_PASSWORD_SECRET : POSTGRES_PASSWORD_SECRET;
  const value = await vscode.window.showInputBox({
    title: `osd: ${kind === "hana" ? "HANA" : "PostgreSQL"} password`,
    password: true,
    ignoreFocusOut: true,
    placeHolder: "leave empty to clear the stored password",
  });
  if (value === undefined) {
    return; // cancelled
  }
  if (value === "") {
    await context.secrets.delete(secretKey);
    vscode.window.setStatusBarMessage(`osd: ${kind} password cleared`, 4000);
    return;
  }
  await context.secrets.store(secretKey, value);
  vscode.window.setStatusBarMessage(`osd: ${kind} password stored`, 4000);
}

/** Owns the one Launcher this window may have running, and the config
 *  update that makes every other feature (Test Explorer, the lenses, the
 *  notebook, hotspots, the existing status bar) follow it: setting `osd.url`
 *  to the launched address. `onDidChange` fires on every state change, for
 *  the tree view and the ▶/■ status bar item to redraw from. */
class SystemController {
  constructor(context, output) {
    this.context = context;
    this.output = output;
    this.launcher = undefined;
    this.homeSource = undefined;
    this.homeMode = "auto";
    this.homeKind = undefined;
    this.overviewPanel = undefined;
    this.overviewListener = undefined;
    this.overviewRender = 0;
    this.debuggerState = {};
    this.debuggerStarts = new Map();
    this.debuggerTransition = Promise.resolve();
    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession((session) => {
      if (session.name === `OSD: ABAP (${this.debuggerState.systemPort})`) {
        this.debuggerState = debugAttachPlan(this.debuggerState,
          {type: "system-session-ended", port: this.debuggerState.systemPort}).state;
      }
    }));
    this.emitter = new vscode.EventEmitter();
    this.onDidChange = this.emitter.event;
  }

  /** Builds (or rebuilds, if osdHome or the workspace folders changed) the
   *  one Launcher this controller drives. Throws when there is no osdHome
   *  to build -- callers show that as an error rather than starting nothing
   *  silently. */
  async ensureLauncher(forceDebug = false) {
    const choice = await resolveStartChoice(this.context, this.homeMode, this.launcher);
    if (choice?.kind === "cancelled") return undefined;
    if (choice?.path === undefined) {
      throw new Error("osd.home is not set, and this window has no single workspace folder to default to");
    }
    const osdHome = choice.kind === "bundled copy" && choice.materialized !== true
      ? materializeBundledHome(this.context, choice.seedDir, this.launcher)
      : choice.path;
    this.homeSource = choice.source;
    if (this.launcher !== undefined && this.launcher.osdHome === osdHome && this.launcher.state !== "stopped") {
      return this.launcher;
    }
    const database = await systemDatabaseConfig(this.context, osdHome);
    if (this.launcher === undefined || this.launcher.osdHome !== osdHome) {
      if (this.launcher !== undefined && this.launcher.state !== "stopped") {
        await this.launcher.stop();
      }
      const launcher = new Launcher({
        osdHome,
        storageDir: storageDirFor(this.context, osdHome),
        workspaceFolders: workspaceFoldersFor(osdHome),
        database,
        warm: osdWarmModeOf(),
        debug: osdDebugEnabled() || forceDebug,
      });
      launcher.homeKind = choice.kind;
      launcher.on("log", (line) => this.output.append(line));
      launcher.on("state", (state) => {
        if (state === "stopped") {
          this.debuggerTransition = this.debuggerTransition.then(() => this.applyDebuggerEvent({type: "system-stopped"}));
        }
        this.emitter.fire();
      });
      launcher.on("exit", ({code, signal}) => {
        this.output.appendLine(`\n--- osd exited on its own (code ${code ?? "?"}, signal ${signal ?? "?"}) ---`);
        vscode.window.showWarningMessage(`osd: the system stopped unexpectedly (code ${code ?? "?"}, signal ${signal ?? "?"})`);
      });
      this.launcher = launcher;
    } else {
      // Same osdHome, stopped: pick up whatever osd.database.* is now,
      // rather than what it was the last time this window started -- a
      // setting change must not need a window reload to take effect.
      this.launcher.database = database;
      this.launcher.databaseLabel = describeDatabase(database);
      this.launcher.warmMode = osdWarmModeOf();
      this.launcher.homeKind = choice.kind;
      this.launcher.debug = osdDebugEnabled() || forceDebug;
    }
    this.homeKind = choice.kind;
    return this.launcher;
  }

  async applyDebuggerEvent(event) {
    if (event.type === "system-started" && this.debuggerState.systemPort !== undefined) {
      const name = `OSD: ABAP (${this.debuggerState.systemPort})`;
      if (!vscode.debug.sessions.some((session) => session.name === name) && !this.debuggerStarts.has(name)) {
        this.debuggerState = debugAttachPlan(this.debuggerState,
          {type: "system-session-ended", port: this.debuggerState.systemPort}).state;
      }
    }
    const plan = debugAttachPlan(this.debuggerState, event);
    this.debuggerState = plan.state;
    for (const action of plan.actions) {
      const root = this.launcher?.osdHome ?? osdHomeOf();
      const config = debuggerConfiguration(action.port, {target: action.target, restart: action.restart, root,
        storageDir: this.launcher?.storageDir, layers: this.launcher?.layers});
      const name = config.name;
      if (action.type === "stop") {
        const session = vscode.debug.sessions.find((candidate) => candidate.name === name);
        if (session !== undefined) await vscode.debug.stopDebugging(session);
        this.debuggerStarts.delete(name);
        continue;
      }
      if (vscode.debug.sessions.some((candidate) => candidate.name === name)) {
        if (action.target === "system") {
          this.debuggerState = debugAttachPlan(this.debuggerState, {type: "system-attached", port: action.port}).state;
        }
        continue;
      }
      if (this.debuggerStarts.has(name)) {
        if (await this.debuggerStarts.get(name) !== true) return false;
        continue;
      }
      const starting = vscode.debug.startDebugging(undefined, config);
      this.debuggerStarts.set(name, starting);
      try {
        const started = await starting;
        if (started !== true) {
          this.output.appendLine(`debugger did not start for ${name}`);
          vscode.window.showErrorMessage(`osd: VS Code could not attach to ${name}`);
          return false;
        }
        if (action.target === "system") {
          this.debuggerState = debugAttachPlan(this.debuggerState, {type: "system-attached", port: action.port}).state;
        }
      } finally {
        this.debuggerStarts.delete(name);
      }
    }
    return true;
  }

  async attachSystemDebugger() {
    if (this.launcher?.debug !== true || this.launcher.inspectPort === undefined) return false;
    await this.debuggerTransition;
    return this.applyDebuggerEvent({type: "system-started", enabled: true, port: this.launcher.inspectPort});
  }

  /** `osd.url` follows a launch: every existing feature that calls osd()
   *  above reads that setting fresh on every call, so this alone is what
   *  makes them all reach the instance this controller just started. A
   *  single workspace folder gets the Workspace target so the setting does
   *  not leak into the user's global settings across unrelated projects. */
  async #pointUrlAt(port) {
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    try {
      await vscode.workspace.getConfiguration("osd").update("url", `http://localhost:${port}`, target);
    } catch (error) {
      vscode.window.showErrorMessage(`osd: running on :${port}, but could not update osd.url: ${String(error.message ?? error)}`);
    }
  }

  async applyPreset(name) {
    const preset = presetSettings(name);
    this.homeMode = preset.home ?? "auto";
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    const config = vscode.workspace.getConfiguration("osd");
    await Promise.all([
      config.update("database.system", preset.database, target),
      config.update("warm", preset.warm, target),
      config.update("keymap", preset.keymap, target),
    ]);
  }

  async start(options = {}) {
    const forceDebug = options === true || options.forceDebug === true;
    const launchOptions = options === true ? {} : options;
    if (this.launcher !== undefined && this.launcher.state !== "stopped") {
      if (this.launcher.state === "running") return true;
      vscode.window.showInformationMessage(`osd: already ${this.launcher.state}`);
      return false;
    }
    let launcher;
    try {
      launcher = await this.ensureLauncher(forceDebug);
    } catch (e) {
      vscode.window.showErrorMessage(`osd: ${String(e.message ?? e)}`);
      return;
    }
    if (launcher === undefined) return false;
    if (launcher.state !== "stopped") {
      if (launcher.state === "running") return true;
      vscode.window.showInformationMessage(`osd: already ${launcher.state}`);
      return false;
    }
    this.output.show(true);
    this.output.appendLine(`--- osd start: ${launcher.osdHome} (${launcher.databaseLabel}) ---`);
    return this.#launch(launcher, launchOptions, "osd start");
  }

  async stop() {
    if (this.launcher === undefined) {
      return;
    }
    await this.launcher.stop();
    this.emitter.fire();
  }

  async rebuild(options = {}) {
    return this.#rebuild(options);
  }

  async fullRebuild() {
    return this.#rebuild({force: true});
  }

  async #rebuild(options = {}) {
    const force = options.force === true || options.forceBuild === true;
    let launcher;
    try {
      launcher = await this.ensureLauncher();
    } catch (e) {
      vscode.window.showErrorMessage(`osd: ${String(e.message ?? e)}`);
      return false;
    }
    if (launcher.state !== "stopped" && launcher.state !== "running") {
      vscode.window.showInformationMessage(`osd: already ${launcher.state}`);
      return false;
    }
    this.output.show(true);
    this.output.appendLine(force
      ? "--- osd full rebuild (force: stop, build, start) ---"
      : "--- osd rebuild (full: stop, build, start) ---");
    try {
      const result = launcher.state === "running"
        ? await launcher.rebuild({...options, force})
        : await launcher.start({...options, force});
      if (result === undefined) return false;
      await this.#pointUrlAt(launcher.port);
      if (launcher.debug) await this.attachSystemDebugger();
      this.emitter.fire();
      return true;
    } catch (e) {
      await this.#launcherError(launcher, e, "osd rebuild");
      this.emitter.fire();
      return false;
    }
  }

  async #launch(launcher, options, label) {
    let result;
    try {
      result = await launcher.start(options);
    } catch (error) {
      await this.#launcherError(launcher, error, label);
      this.emitter.fire();
      return false;
    }
    if (result === undefined) return false;
    await this.#pointUrlAt(result.port);
    if (launcher.debug) await this.attachSystemDebugger();
    vscode.window.setStatusBarMessage(
      `osd: running on :${result.port} · ${launcher.databaseLabel}, generation ${String(result.generation).slice(0, 8)}`, 5000);
    this.emitter.fire();
    return true;
  }

  async #launcherError(launcher, error, label) {
    const errorLog = typeof error?.logText === "string" ? error.logText : "";
    const lastLog = typeof launcher?.lastLog === "string" ? launcher.lastLog : "";
    const logText = errorLog.trim() ? errorLog : lastLog.trim() ? lastLog : "";
    const message = String(error?.message ?? error);
    if (/STG_DB_FRESH/.test(message) && launcher.database?.kind === "hana") {
      const choice = await vscode.window.showErrorMessage(`${label}: ${message}`, "Set osd.database.hana.fresh and retry");
      if (choice !== undefined) {
        await vscode.workspace.getConfiguration("osd").update("database.hana.fresh", true, vscode.ConfigurationTarget.Workspace);
        await this.start();
      }
      return;
    }
    const issue = classify(logText, error);
    const action = await vscode.window.showErrorMessage(`${label}: ${issue.message}`, ...issue.actions);
    if (action === "Open log") {
      this.output.show(true);
    } else if (action === "Full rebuild") {
      await this.rebuild({forceBuild: true});
    } else if (action === "Fetch packs") {
      this.output.show(true);
      this.output.appendLine("--- osd fetch packs ---");
      try {
        await launcher.fetchPacks();
        this.output.appendLine("--- osd restart after fetching packs ---");
        await this.#launch(launcher, {}, "osd start after fetching packs");
      } catch (fetchError) {
        await this.#launcherError(launcher, fetchError, "osd fetch packs");
      }
    } else if (action === "Pick another port") {
      const failureText = [logText, error?.code, error?.message ?? error].filter(Boolean).join(" ");
      await this.#pickAnotherPort(launcher, failureText);
    }
  }

  async #pickAnotherPort(launcher, logText) {
    const previous = launcher.lastAttemptedPort ?? Number(logText.match(/(?:127\.0\.0\.1|localhost|\*|::):([0-9]+)/)?.[1]);
    const choices = [];
    for (let port = PORT_RANGE.from; port <= PORT_RANGE.to; port++) {
      if (port !== previous && await isFree(port)) {
        choices.push({label: `:${port}`, description: "available", port});
      }
    }
    if (choices.length === 0) {
      vscode.window.showErrorMessage(`osd: no other free port in ${PORT_RANGE.from}-${PORT_RANGE.to}`);
      return;
    }
    const selected = await vscode.window.showQuickPick(choices, {placeHolder: "Pick another port for osd"});
    if (selected === undefined) return;
    this.output.show(true);
    this.output.appendLine(`--- osd start on :${selected.port} ---`);
    await this.#launch(launcher, {port: selected.port}, "osd start");
  }

  async quickStart(name = "defaults") {
    const state = this.launcher?.state ?? "stopped";
    if (state !== "stopped" && state !== "running") {
      vscode.window.showInformationMessage(`osd: already ${state}`);
      return;
    }
    await this.applyPreset(name);
    // A running launcher has already captured its database and warm settings.
    // Stop it so start() rebuilds the Launcher from the selected preset.
    if (state === "running") await this.stop();
    const started = await this.start();
    if (started) await this.openSystemOverview();
  }

  openLog() {
    this.output.show(true);
  }

  async #overviewModel() {
    const state = this.launcher?.state ?? "stopped";
    const choice = osdHomeChoiceFor(this.context, this.homeMode);
    const homePath = this.launcher?.osdHome ?? choice.path;
    const layerFolders = this.launcher?.layers ?? (homePath === undefined ? [] : detectWorkspaceLayers(workspaceFoldersFor(homePath)));
    const keymap = vscode.workspace.getConfiguration("osd").get("keymap", "abap");
    let serving;
    let status;
    const baseUrl = state === "running" && this.launcher?.port !== undefined
      ? `http://localhost:${this.launcher.port}` : undefined;
    if (baseUrl !== undefined) {
      const client = new Osd(baseUrl);
      [serving, status] = await Promise.all([
        client.serving().catch(() => undefined),
        client.systemStatus().catch(() => undefined),
      ]);
    }
    const model = systemOverviewModel({
      state,
      launcher: this.launcher,
      serving,
      status,
      homeKind: this.launcher?.homeKind ?? choice.kind,
      homePath,
      layers: layerFolders,
      keymap,
      baseUrl,
    });
    let sysinfoUrl;
    if (state === "running" && baseUrl !== undefined) {
      try {
        sysinfoUrl = (await vscode.env.asExternalUri(vscode.Uri.parse(`${baseUrl}${model.sources.sysinfo}`))).toString();
      } catch {
        sysinfoUrl = `${baseUrl}${model.sources.sysinfo}`;
      }
      if (model.launchpadUrl) {
        try {
          model.launchpadUrl = (await vscode.env.asExternalUri(vscode.Uri.parse(model.launchpadUrl))).toString();
        } catch {
          // The host URL remains useful for local windows.
        }
      }
    }
    return {model, sysinfoUrl};
  }

  async openSystemOverview() {
    if (this.overviewPanel === undefined) {
      const panel = vscode.window.createWebviewPanel("osdSystemOverview", "System overview", vscode.ViewColumn.Beside, {
        enableScripts: false,
        retainContextWhenHidden: true,
        enableCommandUris: ["osd.start", "workbench.action.openSettings"],
      });
      this.overviewPanel = panel;
      panel.onDidDispose(() => {
        this.overviewPanel = undefined;
        this.overviewListener?.dispose();
        this.overviewListener = undefined;
      });
      this.overviewListener = this.onDidChange(() => { this.refreshOverview(); });
    } else {
      this.overviewPanel.reveal(vscode.ViewColumn.Beside);
    }
    await this.refreshOverview();
  }

  async refreshOverview() {
    const panel = this.overviewPanel;
    if (panel === undefined) return;
    const render = ++this.overviewRender;
    const {model, sysinfoUrl} = await this.#overviewModel();
    if (this.overviewPanel === panel && this.overviewRender === render) {
      panel.webview.html = systemOverviewHtml(model, {sysinfoUrl});
    }
  }

  /** T7 "Rebuild (warm)" (docs/vscode-extension.md "Warm", the $(tools)
   *  icon in the view's own title bar): activate every CLAS/INTF whose
   *  source changed since the serving generation, in one call
   *  (tools/adt-facade.mjs `core/http/changed`, Osd#activateMany above) --
   *  the fast path a cold "Full rebuild" (the "..." menu, still stop +
   *  build + start) is the fallback for whenever this cannot tell what
   *  changed: not running yet, the warm registry not primed, or the route
   *  itself saying so. Never dumps or hangs on that: every branch below
   *  either falls back to rebuild() or reports and returns, and the try
   *  around the live calls falls back too, on the chance of a transient
   *  network failure between "primed" and the next request. */
  async rebuildWarm() {
    if (this.launcher === undefined || this.launcher.state !== "running") {
      this.output.appendLine("--- osd rebuild (warm): not running -- falling back to a full rebuild ---");
      return this.rebuild();
    }
    this.output.show(true);
    try {
      const serving = await osd().serving();
      const warm = serving.warm;
      if (warm?.state !== "primed") {
        const reason = warm?.reason ?? (warm?.state === "off" ? "osd.warm is off" : `warm: ${warm?.state ?? "unknown"}`);
        this.output.appendLine(`--- osd rebuild (warm): not primed (${reason}) -- falling back to a full rebuild ---`);
        vscode.window.setStatusBarMessage(`osd: warm not primed (${reason}) -- full rebuild instead`, 5000);
        return this.rebuild();
      }
      const changed = await osd().changed();
      if (changed.objects === undefined) {
        this.output.appendLine(`--- osd rebuild (warm): ${changed.reason ?? "could not tell what changed"} -- falling back to a full rebuild ---`);
        return this.rebuild();
      }
      if (changed.objects.length === 0) {
        vscode.window.setStatusBarMessage("osd: nothing changed since the serving generation", 5000);
        return undefined;
      }
      this.output.appendLine(`--- osd rebuild (warm): activating ${changed.objects.map((o) => o.name).join(", ")} ---`);
      const result = await osd().activateMany(changed.objects);
      const build = activationBuildText(result);
      const tests = closureTestsText(result);
      if (result.ok) {
        vscode.window.setStatusBarMessage(
          `osd: ${changed.objects.length} object(s) activated${build ? ` (${build})` : ""}${tests ? `, ${tests}` : ""}`, 5000);
      } else {
        this.output.appendLine(`osd rebuild (warm): ${result.issues.map((i) => `${i.objDescr || "?"}: ${i.message}`).join("; ")}`);
        vscode.window.showErrorMessage(`osd rebuild (warm): ${result.issues.length} issue(s), see the output channel`);
      }
      this.emitter.fire();
      return undefined;
    } catch (e) {
      this.output.appendLine(`osd rebuild (warm): ${String(e.message ?? e)} -- falling back to a full rebuild`);
      return this.rebuild();
    }
  }

  async openLaunchpad() {
    if (this.launcher?.state !== "running") {
      vscode.window.showInformationMessage("osd: not running -- osd.start first");
      return;
    }
    await openExternalOrOwn(`http://localhost:${this.launcher.port}/app/flp.html`);
  }

  /** The context-menu twin of openLaunchpad() above (docs/vscode-extension.md,
   *  "Services tree"): always the webview iframe, regardless of `osd.openIn`
   *  -- that setting is the *default* for a service row's own click, and the
   *  Launchpad node's own click stays openLaunchpad() (the system browser)
   *  unconditionally, so a person who wants it inside VS Code this once asks
   *  for it by name rather than by a setting they would have to remember to
   *  flip back. */
  async openLaunchpadInVsCode() {
    if (this.launcher?.state !== "running") {
      vscode.window.showInformationMessage("osd: not running -- osd.start first");
      return;
    }
    await openInWebview(`http://localhost:${this.launcher.port}/app/flp.html`, "osdLaunchpad", "Fiori Launchpad");
  }
}

/** The Activity Bar tree: state, the layers (base osdHome plus every
 *  detected workspace layer), and the Services this instance registers,
 *  grouped by kind (docs/vscode-extension.md, "Services tree") -- lib.js's
 *  Osd#services() answers whichever of the two sources exists (the
 *  composing route, docs/ideas.md T8, or ZOSD_STATUS_SRV's own ServiceSet),
 *  already normalized; groupServices()/serviceLabel()/serviceClassNodes()
 *  do the rest without needing to know which one it was. */
class OsdTreeProvider {
  constructor(controller, discoverCapabilities = serviceCapabilities) {
    this.controller = controller;
    this.discoverCapabilities = discoverCapabilities;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.groups = [];
    this.rows = [];
    this.capabilitiesByRow = new Map();
    this.transactions = [];
    this.transactionsLoaded = false;
    this.groupBy = vscode.workspace.getConfiguration("osd").get("services.groupBy", "kind");
    // T7 (docs/vscode-extension.md "Warm"): /osd/serving's own `warm` field,
    // shown on the state row the way the status bar shows it.
    this.warm = undefined;
    const refresh = () => this.refresh(true).then(() => this.emitter.fire(), () => this.emitter.fire());
    controller.onDidChange(refresh);
    // the prime finishing, or a swap happening, is not a controller state
    // change (start/stop/rebuild) -- nothing else tells this the row is
    // stale, so it polls the same way the status bar does, and only while
    // there is something running to ask.
    this.timer = setInterval(() => {
      if (this.controller.launcher?.state === "running") this.refresh().then(() => this.emitter.fire(), () => this.emitter.fire());
    }, 5000);
  }

  dispose() {
    clearInterval(this.timer);
  }

  /** Both live reads this row and the Services tree depend on: osd.refreshTree
   *  (view/title's own $(refresh)) calls this by name, and so does the
   *  constructor's own timer and controller listener. */
  async refresh(forceTransactions = false) {
    if (forceTransactions) this.capabilitiesByRow.clear();
    await Promise.all([this.refreshServices(), this.refreshTransactions(forceTransactions), this.#refreshWarm()]);
  }

  async #refreshWarm() {
    if (this.controller.launcher?.state !== "running") {
      this.warm = undefined;
      return;
    }
    try {
      this.warm = (await osd().serving()).warm;
    } catch {
      this.warm = undefined;
    }
  }

  async refreshServices() {
    if (this.controller.launcher?.state !== "running") {
      this.rows = [];
      this.groups = [];
      this.capabilitiesByRow.clear();
      return;
    }
    try {
      this.rows = await osd().services();
      for (const row of this.rows) {
        const saved = this.capabilitiesByRow.get(serviceRowKey(row));
        if (saved !== undefined) row.detailsCapabilities = saved;
      }
      this.groups = groupServices(this.rows, this.groupBy);
    } catch {
      this.rows = [];
      this.groups = [];
    }
  }

  async refreshTransactions(force = false) {
    if (this.controller.launcher?.state !== "running") {
      this.transactions = [];
      this.transactionsLoaded = false;
      return;
    }
    if (this.transactionsLoaded && !force) return;
    try {
      this.transactions = await osd().transactions();
    } catch {
      this.transactions = [];
    }
    this.transactionsLoaded = true;
  }

  async setServiceGrouping(groupBy) {
    this.groupBy = groupBy === "pack" ? "pack" : "kind";
    const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration("osd").update("services.groupBy", this.groupBy, target);
    this.groups = groupServices(this.rows, this.groupBy);
    this.emitter.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (element === undefined) {
      return this.rootItems();
    }
    if (element.contextValue === "osd-layers") {
      return this.layerItems();
    }
    if (element.contextValue === "osd-services") {
      return this.serviceGroupItems();
    }
    if (element instanceof SystemGroupItem) {
      return systemDoorItems();
    }
    if (element instanceof TransactionGroupItem) {
      return this.transactionItems();
    }
    if (element instanceof ServiceGroupItem) {
      return this.serviceRowItems(element.group);
    }
    if (element instanceof ServiceRowItem) {
      return this.serviceClassItems(element.row);
    }
    return [];
  }

  rootItems() {
    const launcher = this.controller.launcher;
    const state = launcher?.state ?? "stopped";
    const source = homeSourceText(this.controller.homeSource);
    const sourceSuffix = source === undefined ? "" : ` · ${source}`;
    const warmText = warmStatusText(this.warm);
    const swaps = this.warm?.swaps ?? 0;
    const label = state === "running"
      ? `Running on :${launcher.port} · ${launcher.databaseLabel}, generation ${String(launcher.generation).slice(0, 8)}` +
        (warmText ? ` · ${warmText}` : "") + (swaps ? ` +${swaps}` : "") + sourceSuffix
      : state === "stopped" ? `Stopped${sourceSuffix}`
        : `${state[0].toUpperCase()}${state.slice(1)}…${sourceSuffix}`;
    const stateItem = new vscode.TreeItem(label);
    stateItem.iconPath = new vscode.ThemeIcon(
      state === "running" ? "pass-filled" : state === "stopped" ? "circle-large-outline" : "sync~spin");
    stateItem.contextValue = osdStateContext(state);
    stateItem.command = {command: "osd.openSystemOverview", title: "Open System overview"};
    if (this.warm !== undefined) {
      const lastVerify = this.warm.lastVerify === undefined ? "never"
        : `${this.warm.lastVerify.verdict ?? "?"} at ${this.warm.lastVerify.at ?? "?"}`;
      stateItem.tooltip = `warm: ${this.warm.state}${this.warm.reason ? ` (${this.warm.reason})` : ""}\n` +
        `generation: ${this.warm.generation ?? "n/a"}\nunverified: ${(this.warm.unverified ?? []).join(", ") || "none"}\n` +
        `swaps: ${this.warm.swaps ?? 0}\ncopies: ${this.warm.copies ?? 0}\nlast verify: ${lastVerify}`;
    }

    const launchpad = new vscode.TreeItem("▶ Open Fiori Launchpad");
    launchpad.contextValue = "osd-launchpad";
    launchpad.iconPath = new vscode.ThemeIcon("link-external");
    launchpad.command = {command: "osd.openLaunchpad", title: "Open Fiori Launchpad"};

    const layers = new vscode.TreeItem("Layers", vscode.TreeItemCollapsibleState.Expanded);
    layers.contextValue = "osd-layers";
    layers.iconPath = new vscode.ThemeIcon("layers");

    const services = new vscode.TreeItem("Services", vscode.TreeItemCollapsibleState.Collapsed);
    services.contextValue = "osd-services";
    services.iconPath = new vscode.ThemeIcon("plug");

    const system = new SystemGroupItem();
    const transactions = new TransactionGroupItem(this.transactions);
    const grouping = vscode.workspace.getConfiguration("osd").get("services.groupBy", "kind");
    this.groupBy = grouping === "pack" ? "pack" : "kind";
    this.groups = groupServices(this.rows, this.groupBy);

    return [stateItem, launchpad, system, transactions, layers, services];
  }

  layerItems() {
    const launcher = this.controller.launcher;
    const choice = osdHomeChoiceFor(this.controller.context, this.controller.homeMode);
    const osdHome = launcher?.osdHome ?? choice.path;
    const base = new vscode.TreeItem(osdHome === undefined ? "(osd.home not set, no single workspace folder)" : `base: ${osdHome}`);
    base.iconPath = new vscode.ThemeIcon("folder-library");
    const items = [base];
    const layers = launcher?.layers ?? (osdHome === undefined ? [] : detectWorkspaceLayers(workspaceFoldersFor(osdHome)));
    for (const layer of layers) {
      const item = new vscode.TreeItem(`workspace: ${layer.folder}`);
      item.iconPath = new vscode.ThemeIcon("folder");
      items.push(item);
    }
    return items;
  }

  serviceGroupItems() {
    if (this.controller.launcher?.state !== "running") {
      return [new vscode.TreeItem("(start the system to see its services)")];
    }
    if (this.groups.length === 0) {
      return [new vscode.TreeItem("(none, or nothing answered yet -- osd.refreshTree)")];
    }
    return this.groups.map((group) => new ServiceGroupItem(group));
  }

  async serviceRowItems(group) {
    return Promise.all(group.rows.map(async (row) => {
      const key = serviceRowKey(row);
      let capabilities = row.detailsCapabilities ?? this.capabilitiesByRow.get(key);
      if (capabilities === undefined) {
        try {
          capabilities = await this.discoverCapabilities(row);
        } catch {
          capabilities = {sources: {}, testClasses: []};
        }
        this.capabilitiesByRow.set(key, capabilities);
      }
      row.detailsCapabilities = capabilities;
      return new ServiceRowItem(row);
    }));
  }

  transactionItems() {
    if (this.controller.launcher?.state !== "running") return [new vscode.TreeItem("(start the system to see transactions)")];
    if (this.transactions.length === 0) return [new vscode.TreeItem("(no transactions registered)")];
    return this.transactions.map((tran) => new TransactionItem(tran));
  }

  refreshItem(item) {
    this.emitter.fire(item);
  }

  rememberCapabilities(row, capabilities) {
    this.capabilitiesByRow.set(serviceRowKey(row), capabilities);
  }

  async serviceClassItems(row) {
    const items = serviceClassNodes(row).map((node) => new ServiceClassItem(node));
    if (row.kind !== "ODATA" || !row.handler) return items;
    // Q2b's own map (tools/adt-facade.mjs core/http/segw/entitysets), lazily
    // -- fetched only once this row is actually expanded, never eagerly for
    // every OData row the group happens to list.
    let map;
    try {
      map = await osd().entitySets(row.handler);
    } catch {
      return items;
    }
    if (map === undefined || !Array.isArray(map.sets) || map.sets.length === 0) return items;
    let source;
    try {
      const files = await vscode.workspace.findFiles(readerFilePattern({type: "CLAS", name: row.handler}), EXCLUDE, 1);
      if (files.length > 0) source = fs.readFileSync(files[0].fsPath, "utf8");
    } catch {
      source = undefined;
    }
    const lenses = source === undefined ? [] : entitySetLenses(source, map);
    for (const set of map.sets) {
      const lens = lenses.find((l) => l.set === set.set && l.kind === set.kind);
      items.push(new EntitySetItem(row.handler, set, lens?.line));
    }
    return items;
  }
}

function serviceRowKey(row) {
  return `${row.kind}\n${row.path}\n${row.handler ?? ""}`;
}

class SystemGroupItem extends vscode.TreeItem {
  constructor() {
    super("System", vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "osd-system-group";
    this.iconPath = new vscode.ThemeIcon("server-environment");
  }
}

function systemDoorItems() {
  return [
    new HostDoorItem("Serving", "/osd/serving", "Generation and warm state", "open"),
    new HostDoorItem("Short dumps", "/osd/dumps", "Runtime errors collected by this system", "dumps"),
    new HostDoorItem("SQL", "/osd/sql", "Bounded SELECT door", "sql"),
  ];
}

class HostDoorItem extends vscode.TreeItem {
  constructor(label, route, description, action) {
    super(`${label}  ${route}`, vscode.TreeItemCollapsibleState.None);
    this.route = route;
    this.contextValue = `osd-host-${action}`;
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(action === "dumps" ? "warning" : action === "sql" ? "database" : "pulse");
    this.command = {command: action === "dumps" ? "osd.showDumps" : action === "sql" ? "osd.newSqlNotebook" : "osd.openHostDoor", title: label,
      arguments: [route]};
  }
}

class TransactionGroupItem extends vscode.TreeItem {
  constructor(transactions) {
    super(`TRAN (${transactions.length})`, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "osd-transactions";
    this.iconPath = new vscode.ThemeIcon("list-tree");
  }
}

class TransactionItem extends vscode.TreeItem {
  constructor(transaction) {
    const label = transaction.text ? `${transaction.tcode} · ${transaction.text}` : transaction.tcode;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.transaction = transaction;
    this.contextValue = "osd-transaction";
    this.description = `${transaction.kind}${transaction.runnable ? " · runnable" : ""}`;
    this.tooltip = transaction.reason || transaction.source || transaction.tcode;
    this.iconPath = new vscode.ThemeIcon(transaction.kind === "REPORT" ? "symbol-file" : "play");
    if (transaction.runnable) {
      this.command = {command: "osd.openWebguiTransaction", title: "Open transaction", arguments: [{tcode: transaction.tcode}]};
    }
  }
}

/** One kind's own node ("OData (n)", "Apps (n)", ...), collapsed, its rows
 *  fetched from `group.rows` -- no server round trip of its own, since
 *  refreshServices() above already asked once for the whole tree. */
class ServiceGroupItem extends vscode.TreeItem {
  constructor(group) {
    super(`${group.label} (${group.rows.length})`, vscode.TreeItemCollapsibleState.Collapsed);
    this.group = group;
    this.contextValue = "osd-service-group";
    this.iconPath = new vscode.ThemeIcon(group.groupBy === "pack" ? "package" : "folder");
  }
}

/** One service row: a click selects its details panel, and capability flags
 *  control the context actions package.json contributes. Expandable for
 *  every kind serviceClassNodes() answers at least one node for. */
class ServiceRowItem extends vscode.TreeItem {
  constructor(row) {
    const {label, description} = serviceLabel(row);
    const expandable = row.kind === "ODATA" || serviceClassNodes(row).length > 0;
    super(label, expandable ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.row = row;
    this.description = description;
    this.contextValue = serviceActionContext(row, row.detailsCapabilities);
    this.iconPath = new vscode.ThemeIcon(
      row.kind === "APP" ? "browser" : row.kind === "ODATA" ? "database" : row.kind === "APC" ? "broadcast" : "plug");
    // A single click selects details. The inline play action retains the
    // setting-controlled browser/webview open target.
    this.command = {command: "osd.showServiceDetails", title: "Details", arguments: [this]};
  }
}

/** A DPC/MPC/handler class node under a service row, or an entity set under
 *  an OData row's own DPC (EntitySetItem below) -- both leaves, both a
 *  click away from the source they name. */
class ServiceClassItem extends vscode.TreeItem {
  constructor(node) {
    super(node.name, vscode.TreeItemCollapsibleState.None);
    this.node = node;
    this.contextValue = "osd-service-class";
    this.iconPath = new vscode.ThemeIcon("symbol-class");
    this.description = node.role.toUpperCase();
    this.command = {command: "osd.openServiceClass", title: "Open source", arguments: [node]};
  }
}

/** One entity set under an OData row's DPC, from `map.sets` (Osd#entitySets)
 *  -- `line` is the `<set>_get_entityset` / `<set>_get_entity` method's own
 *  line in the DPC's source when a workspace copy of it was found (lib.js
 *  entitySetLenses, the same lookup Q2b's CodeLens already does),
 *  `undefined` when it was not (the class opens at its top instead, rather
 *  than the node doing nothing at all). */
class EntitySetItem extends vscode.TreeItem {
  constructor(dpcName, set, line) {
    super(set.set, vscode.TreeItemCollapsibleState.None);
    this.dpcName = dpcName;
    this.set = set;
    this.line = line;
    this.contextValue = "osd-service-entityset";
    this.iconPath = new vscode.ThemeIcon("symbol-field");
    this.description = set.kind;
    this.command = {command: "osd.openEntitySetMethod", title: "Open method", arguments: [dpcName, set, line]};
  }
}

/** `osd.openIn` (docs/vscode-extension.md, "Services tree"): the shared
 *  target for a service row's inline Open action -- the system browser
 *  (`vscode.env.openExternal`, this extension's default everywhere else,
 *  e.g. openLaunchpad() above) or a webview tab inside VS Code, the same
 *  iframe-over-CSP pattern openDataPreview() (Q7) and, for a running
 *  system's own pages, the gui-reports spike's openWebguiTransaction()
 *  already use: the panel carries no copy of the page, it iframes the
 *  running osd's own URL, so whatever that page does (a click inside the
 *  Fiori launchpad, a $batch request) runs exactly as it does in a
 *  browser tab. `vscode.env.asExternalUri` is asked first either way --
 *  under Remote-WSL/Remote-SSH a bare `http://localhost:<port>` is a
 *  coincidence when it works and a dead port otherwise, the same reasoning
 *  openWebguiTransaction's own comment gives. */
async function openExternalOrOwn(url) {
  let external;
  try {
    external = await vscode.env.asExternalUri(vscode.Uri.parse(url));
  } catch {
    external = vscode.Uri.parse(url);
  }
  await vscode.env.openExternal(external);
}

async function openInWebview(url, panelType, title) {
  let external;
  try {
    external = await vscode.env.asExternalUri(vscode.Uri.parse(url));
  } catch {
    external = vscode.Uri.parse(url);
  }
  const panel = vscode.window.createWebviewPanel(panelType, title, vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.webview.html = iframePanelHtml(external.toString(), title);
}

let serviceDetailsPanel;
let serviceDetailsSelection = 0;
let serviceDetailsItem;

function serviceSourceRoot() {
  return activeController?.launcher?.osdHome ?? osdHomeOf() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function sourcePath(root, relativePath, allowAbsolute = false) {
  if (!relativePath) return undefined;
  const rootPath = path.resolve(root ?? process.cwd());
  if (path.isAbsolute(relativePath) && !allowAbsolute) return undefined;
  const absolute = path.isAbsolute(relativePath) ? path.resolve(relativePath) : path.resolve(rootPath, relativePath);
  if (!path.isAbsolute(relativePath) && (path.relative(rootPath, absolute) === ".." || path.relative(rootPath, absolute).startsWith(`..${path.sep}`))) {
    return undefined;
  }
  return fs.existsSync(absolute) ? absolute : undefined;
}

function testSourcesForService(root, row) {
  const collected = [];
  const seen = new Set();
  const readTree = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        readTree(file);
      } else if (/\.(?:mjs|cjs|js|ts|abap)$/i.test(entry.name) && !seen.has(file)) {
        seen.add(file);
        try { collected.push({path: path.relative(root, file).replaceAll(path.sep, "/"), source: fs.readFileSync(file, "utf8")}); } catch {}
      }
    }
  };
  readTree(path.join(root, "test"));
  return httpTestFiles(collected, row.path, row.name);
}

async function classSourcePath(row, role, root) {
  const direct = sourcePath(root, role === "dpc" || role === "handler" ? row.handlerSource : row.mpcSource);
  if (direct) return direct;
  const name = role === "mpc" ? row.mpc : row.handler;
  if (!name) return undefined;
  try {
    const files = await vscode.workspace.findFiles(readerFilePattern({type: "CLAS", name}), EXCLUDE, 1);
    return files[0]?.fsPath;
  } catch { return undefined; }
}

/** Resolve menu targets as the kind group is expanded, before a row can be
 *  right-clicked. The full details panel can still fetch its richer data
 *  only when selected. */
async function serviceCapabilities(row) {
  const root = serviceSourceRoot();
  const sources = {};
  const classes = row.kind === "ODATA"
    ? [{role: "dpc", name: row.handler}, {role: "mpc", name: row.mpc}]
    : row.kind === "APP" ? [] : [{role: "handler", name: row.handler}];
  const closures = await Promise.all(classes.filter(({name}) => name).map(async ({role, name}) => {
    const found = await classSourcePath(row, role, root);
    if (found) sources[role] = {path: found};
    try { return await osd().closure("CLAS", name); } catch { return undefined; }
  }));
  if (row.kind === "APP") {
    const folder = sourcePath(root, row.source);
    if (folder) sources.app = {path: folder};
  } else if (row.kind !== "ODATA") {
    const declaration = sourcePath(root, row.source);
    if (declaration) sources.service = {path: declaration};
  }
  return {sources, testClasses: closureTestNames(...closures)};
}

async function serviceDetailsData(item, provider) {
  const row = item.row;
  const root = serviceSourceRoot();
  const details = {row, sources: {}, metadataUrl: row.kind === "ODATA"
    ? await serviceMetadataExternalUrl(row, osd().url, (url) => vscode.env.asExternalUri(vscode.Uri.parse(url)))
    : undefined};
  if (row.kind === "ODATA") {
    const names = [{role: "dpc", name: row.handler}, {role: "mpc", name: row.mpc}].filter((one) => one.name);
    const settled = await Promise.all(names.map(async ({role, name}) => {
      const [readers, closure] = await Promise.allSettled([osd().readers("CLAS", name), osd().closure("CLAS", name)]);
      details.readers ??= {};
      details.closures ??= {};
      details.readers[role] = readers.status === "fulfilled" ? readers.value : undefined;
      details.closures[role] = closure.status === "fulfilled" ? closure.value : undefined;
      const source = await classSourcePath(row, role, root);
      details.sources[role] = source ? {path: source} : undefined;
      return closure.status === "fulfilled" ? closure.value : undefined;
    }));
    try {
      const map = row.handler ? await osd().entitySets(row.handler) : undefined;
      details.entitySets = map?.sets ?? [];
    } catch (e) {
      details.entitySets = [];
      details.entitySetsError = String(e.message ?? e);
    }
    const [serving, dumps] = await Promise.allSettled([osd().serving(), osd().dumps()]);
    details.serving = serving.status === "fulfilled" ? serving.value : undefined;
    details.dumps = dumpsForService(dumps.status === "fulfilled" ? dumps.value : [], row);
    details.httpTests = testSourcesForService(root, row);
    item.row.detailsCapabilities = {
      sources: details.sources,
      testClasses: closureTestNames(...settled),
    };
  } else if (row.kind === "APP") {
    const folder = sourcePath(root, row.source);
    if (folder) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8"));
        details.app = appManifestDetails(manifest, row, provider.rows);
      } catch {
        details.app = appManifestDetails({}, row, provider.rows);
      }
    } else {
      details.app = appManifestDetails({}, row, provider.rows);
    }
    details.sources.app = folder ? {path: folder} : undefined;
    item.row.detailsCapabilities = {sources: details.sources, testClasses: []};
  } else {
    const handler = await classSourcePath(row, "handler", root);
    const declaration = sourcePath(root, row.source);
    details.sources.handler = handler ? {path: handler} : undefined;
    details.sources.service = declaration ? {path: declaration} : undefined;
    let closure;
    if (row.handler) {
      const [readers, found] = await Promise.allSettled([osd().readers("CLAS", row.handler), osd().closure("CLAS", row.handler)]);
      details.readers = readers.status === "fulfilled" ? readers.value : undefined;
      closure = found.status === "fulfilled" ? found.value : undefined;
      details.closure = closure;
    }
    item.row.detailsCapabilities = {sources: details.sources, testClasses: closureTestNames(closure)};
  }
  item.contextValue = serviceActionContext(row, item.row.detailsCapabilities);
  provider.rememberCapabilities(row, item.row.detailsCapabilities);
  provider.refreshItem(item);
  return details;
}

async function showServiceDetails(item, provider, output) {
  if (!item?.row) return;
  if (serviceDetailsPanel === undefined) {
    serviceDetailsPanel = vscode.window.createWebviewPanel("osdServiceDetails", "Service details", vscode.ViewColumn.Beside,
      {enableScripts: true, retainContextWhenHidden: false});
    serviceDetailsPanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.command === "openSource") await openServiceSource(serviceDetailsItem, message.role, output);
    });
    serviceDetailsPanel.onDidDispose(() => {
      serviceDetailsPanel = undefined;
      serviceDetailsItem = undefined;
      serviceDetailsSelection += 1;
    });
  }
  serviceDetailsItem = item;
  const selection = ++serviceDetailsSelection;
  serviceDetailsPanel.title = `${serviceLabel(item.row).label} · Details`;
  serviceDetailsPanel.webview.html = serviceDetailsHtml({row: item.row}, "loading");
  try {
    const details = await serviceDetailsData(item, provider);
    if (selection === serviceDetailsSelection && serviceDetailsPanel !== undefined) {
      const nonce = crypto.randomBytes(16).toString("base64");
      serviceDetailsPanel.webview.html = serviceDetailsHtml(details, nonce);
    }
  } catch (e) {
    output?.appendLine(`osd service details ${item.row.name ?? item.row.path}: ${String(e.message ?? e)}`);
    if (selection === serviceDetailsSelection && serviceDetailsPanel !== undefined) {
      serviceDetailsPanel.webview.html = serviceDetailsHtml({row: item.row, entitySetsError: String(e.message ?? e)}, crypto.randomBytes(16).toString("base64"));
    }
  }
}

async function openServiceSource(item, role, output) {
  const source = item?.row?.detailsCapabilities?.sources?.[role]?.path ??
    (role === "service" || role === "app" ? item?.row?.source : undefined);
  const root = serviceSourceRoot();
  const target = sourcePath(root, source, path.isAbsolute(source ?? ""));
  if (!target) {
    vscode.window.showWarningMessage(`osd: ${role} source was not found for ${item?.row?.name ?? item?.row?.path ?? "service"}`);
    return;
  }
  try {
    if (role === "app") {
      await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(target));
    } else {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      await vscode.window.showTextDocument(document);
    }
  } catch (e) {
    output?.appendLine(`osd open service source ${target}: ${String(e.message ?? e)}`);
    vscode.window.showErrorMessage(`osd: ${String(e.message ?? e)}`);
  }
}

/** frame-src names the one origin this panel is allowed to embed; nothing
 *  else in the page runs a script of its own, so a strict default-src
 *  'none' beside it costs nothing (the gui-reports spike's own
 *  webguiPanelHtml, reused verbatim in shape). */
function iframePanelHtml(url, title) {
  const origin = new URL(url).origin;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${xmlEscapeHtml(origin)}; style-src 'unsafe-inline';">
<style>html,body{margin:0;height:100%;background:#1f4e79}iframe{border:0;width:100%;height:100%;display:block}</style>
</head>
<body><iframe src="${xmlEscapeHtml(url)}" title="${xmlEscapeHtml(title)}"></iframe></body>
</html>`;
}

async function openServiceRow(item) {
  const row = item?.row ?? item;
  if (row === undefined || row.kind === "APC") return;
  const url = serviceHttpUrl(row, osd().url);
  const openIn = vscode.workspace.getConfiguration("osd").get("openIn", "browser");
  if (openIn === "vscode") {
    await openInWebview(url, "osdService", serviceLabel(row).label);
  } else {
    await openExternalOrOwn(url);
  }
}

async function openServiceRowExternal(item) {
  const row = item?.row ?? item;
  if (row === undefined || row.kind === "APC" || !row.path) return;
  await openExternalOrOwn(serviceHttpUrl(row, osd().url));
}

async function openHostDoor(route) {
  if (!route) return;
  await openExternalOrOwn(`${osd().url}${route}`);
}

async function copyServiceUrl(item) {
  const row = item?.row ?? item;
  if (row === undefined) return;
  await vscode.env.clipboard.writeText(serviceHttpUrl(row, osd().url));
  vscode.window.setStatusBarMessage(`osd: copied ${row.path}`, 3000);
}

async function copyServiceWsUrl(item) {
  const row = item?.row ?? item;
  if (row === undefined) return;
  await vscode.env.clipboard.writeText(serviceWsUrl(row, osd().url));
  vscode.window.setStatusBarMessage(`osd: copied ${row.path} (ws://)`, 3000);
}

async function copyServiceMetadata(item) {
  const row = item?.row ?? item;
  if (!row?.path || row.kind !== "ODATA") return;
  const url = serviceMetadataUrl(row, osd().url);
  await vscode.env.clipboard.writeText(url);
  vscode.window.setStatusBarMessage(`osd: copied ${row.path}/$metadata`, 3000);
}

async function openServiceMetadata(item) {
  const row = item?.row ?? item;
  if (!row?.path || row.kind !== "ODATA") return;
  const url = serviceMetadataUrl(row, osd().url);
  if (vscode.workspace.getConfiguration("osd").get("openIn", "browser") === "vscode") {
    await openInWebview(url, "osdServiceMetadata", `${serviceLabel(row).label} $metadata`);
  } else {
    await openExternalOrOwn(url);
  }
}

async function testServiceClosure(item, output) {
  const row = item?.row;
  const names = row?.detailsCapabilities?.testClasses ?? [];
  if (names.length === 0) return;
  output.appendLine(`osd service tests ${row.name ?? row.path}: ${names.join(", ")}`);
  let methods = 0;
  let failures = 0;
  for (const name of names) {
    try {
      const run = await osd().run({type: "CLAS", name});
      const results = outcomes(run);
      methods += results.length;
      failures += results.filter((result) => result.passed !== true).length;
      output.appendLine(`  ${name}: ${results.length} method(s), ${results.filter((result) => result.passed !== true).length} failed`);
    } catch (e) {
      failures += 1;
      output.appendLine(`  ${name}: ${String(e.message ?? e)}`);
    }
  }
  const summary = `${methods} test method(s), ${failures} failed`;
  output.appendLine(`osd service tests: ${summary}`);
  vscode.window.setStatusBarMessage(`osd: service tests ${summary}`, 5000);
}

/** A DPC/MPC/handler class node's own click: a workspace glob on the name
 *  (readerFilePattern, the same lookup Q3's "read by" quick pick already
 *  uses), open at the top -- the composing route's own `handlerUri` names
 *  the class the same way Check/Activate do, but this extension opens by
 *  file, not by ADT uri, so the file glob is what every source path here
 *  goes through regardless of which of the two sources answered. */
async function openServiceClass(node, output) {
  if (node?.name === undefined) return;
  const direct = sourcePath(serviceSourceRoot(), node.source);
  if (direct) {
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(direct));
      await vscode.window.showTextDocument(document);
      return;
    } catch (e) {
      output?.appendLine(`osd open service class ${node.name}: ${String(e.message ?? e)}`);
    }
  }
  const pattern = readerFilePattern({type: "CLAS", name: node.name});
  try {
    const files = await vscode.workspace.findFiles(pattern, EXCLUDE, 1);
    if (files.length === 0) {
      vscode.window.showWarningMessage(`osd: ${node.name}'s file was not found in this workspace`);
      return;
    }
    await vscode.window.showTextDocument(files[0]);
  } catch (e) {
    output?.appendLine(`osd open service class ${node.name}: ${String(e.message ?? e)}`);
    vscode.window.showErrorMessage(`osd: ${String(e.message ?? e)}`);
  }
}

/** An entity set node's own click: the same DPC file openServiceClass()
 *  above opens, at the method's own line when one was found while building
 *  the node, else at the top. */
async function openEntitySetMethod(dpcName, set, line, output) {
  const pattern = readerFilePattern({type: "CLAS", name: dpcName});
  try {
    const files = await vscode.workspace.findFiles(pattern, EXCLUDE, 1);
    if (files.length === 0) {
      vscode.window.showWarningMessage(`osd: ${dpcName}'s file was not found in this workspace`);
      return;
    }
    const editor = await vscode.window.showTextDocument(files[0]);
    if (typeof line === "number") {
      const at = new vscode.Position(line - 1, 0);
      editor.selection = new vscode.Selection(at, at);
      editor.revealRange(new vscode.Range(at, at));
    }
  } catch (e) {
    output?.appendLine(`osd open entity set ${dpcName} ${set?.set}: ${String(e.message ?? e)}`);
    vscode.window.showErrorMessage(`osd: ${String(e.message ?? e)}`);
  }
}

/** The ▶/■ status bar item: a second one from Q2's own generation display
 *  above, because the two answer different questions -- "what is this osd
 *  serving" versus "is a system running at all, and shall I start or stop
 *  one" -- and B0 must work even when nothing is serving yet, which Q2's
 *  item already assumes something is. */
function startStopStatusBar(context, controller) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 11);
  const refresh = () => {
    const state = controller.launcher?.state ?? "stopped";
    const source = homeSourceText(controller.homeSource);
    const sourceSuffix = source === undefined ? "" : ` · ${source}`;
    if (state === "running") {
      item.text = `$(primitive-square) osd${sourceSuffix}`;
      item.tooltip = `osd is running on :${controller.launcher.port} · ${controller.launcher.databaseLabel}${source === undefined ? "" : `, ${source}`} -- click to stop`;
      item.command = "osd.stop";
    } else if (state === "stopped") {
      item.text = `$(play) osd${sourceSuffix}`;
      item.tooltip = `click to build and start osd (B0)${source === undefined ? "" : `, ${source}`}`;
      item.command = "osd.start";
    } else {
      item.text = `$(sync~spin) osd ${state}${sourceSuffix}`;
      item.tooltip = `osd is ${state}${source === undefined ? "" : `, ${source}`}`;
      item.command = undefined;
    }
  };
  refresh();
  const off = controller.onDidChange(refresh);
  item.show();
  context.subscriptions.push({dispose: () => {
    off.dispose();
    item.dispose();
  }});
  return item;
}

/** One click delegates to VS Code's own breakpoint activation switch. */
function breakpointToggleStatusBar(context) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 12);
  item.text = breakpointToggleText();
  item.tooltip = "Toggle whether VS Code reacts to breakpoints; markers stay set";
  item.command = "osd.toggleBreakpoints";
  const command = vscode.commands.registerCommand("osd.toggleBreakpoints", async () => {
    try {
      await vscode.commands.executeCommand("workbench.debug.viewlet.action.toggleBreakpointsActivatedAction");
    } catch (e) {
      vscode.window.showErrorMessage(`osd: could not toggle breakpoints: ${String(e.message ?? e)}`);
    }
  });
  item.show();
  context.subscriptions.push(command, {dispose: () => item.dispose()});
  return item;
}

function activate(context) {
  const output = vscode.window.createOutputChannel("osd");
  context.subscriptions.push(output);
  // Q6b "Classrun" (docs/vscode-extension.md): F9's own channel, separate
  // from "osd" above -- a class's console output is what somebody asked
  // for, not a log line among the status bar's and F8's, and a second run
  // should not have to be found again in the general channel's scrollback.
  const classrunOutput = vscode.window.createOutputChannel("osd console");
  context.subscriptions.push(classrunOutput);
  context.subscriptions.push(statusBar(context));
  breakpointToggleStatusBar(context);
  context.subscriptions.push(testExplorer(context, output));
  context.subscriptions.push(vscode.commands.registerCommand("osd.showDumps", () => showDumps(output)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.setHanaPassword", () => setDatabasePassword(context, "hana")));
  context.subscriptions.push(vscode.commands.registerCommand("osd.setPostgresPassword", () => setDatabasePassword(context, "postgres")));

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
  context.subscriptions.push(vscode.commands.registerCommand("osd.run", () => run(output, classrunOutput)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.runWithDebugger", () => run(output, classrunOutput, true)));

  // Q6b "Classrun" (docs/vscode-extension.md): F9, "Run as ABAP Application
  // (Console)" -- osd.classrun on the current class, standalone (F9's own
  // binding) or reached through F8's dispatch (run(), above) when the class
  // implements IF_OO_ADT_CLASSRUN and has no ABAP Unit tests.
  context.subscriptions.push(vscode.commands.registerCommand("osd.classrun", () => classrunCurrent(classrunOutput)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.classrunWithDebugger", () => classrunCurrent(classrunOutput, true)));

  // Q2b "Runner" (docs/vscode-extension.md): a lens over each
  // `<set>_get_entityset` / `<set>_get_entity` method of a SEGW _DPC_EXT
  // class, and the command it (and F8, above) both call.
  context.subscriptions.push(vscode.commands.registerCommand("osd.callEntitySet", (args) => callEntitySet(args, output)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.callEntitySetWithDebugger", (args) =>
    args === undefined ? run(output, classrunOutput, true) : callEntitySet({...args, withDebugger: true}, output)));
  context.subscriptions.push(entitySetLensProvider(output));
  // gui-reports spike: "Open in VS Code" for a converted report, the same
  // action F8 (RUN_TABLE.PROG) reaches, placed as a lens above its own
  // REPORT line rather than asked for by name.
  context.subscriptions.push(vscode.commands.registerCommand("osd.openWebguiTransaction", (args) => openWebguiTransaction(args?.tcode, output)));
  context.subscriptions.push(progLensProvider());

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

  // B0 "Pocket SAP" spike (docs/vscode-extension.md, "B0 spike"): the
  // extension starts and stops the system itself. Its own Output channel,
  // separate from "osd" above -- a build's and a server's own log is a
  // different thing from what a check or an activation reports.
  const systemOutput = vscode.window.createOutputChannel("osd system");
  context.subscriptions.push(systemOutput);
  const controller = new SystemController(context, systemOutput);
  activeController = controller;
  context.subscriptions.push(vscode.commands.registerCommand("osd.gettingStarted", () => {
    const {publisher, name} = context.extension.packageJSON;
    return vscode.commands.executeCommand("workbench.action.openWalkthrough", `${publisher}.${name}#gettingStarted`, false);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("osd.quickStart", (preset) => controller.quickStart(preset ?? "defaults")));
  context.subscriptions.push(vscode.commands.registerCommand("osd.openSystemOverview", () => controller.openSystemOverview()));
  context.subscriptions.push(vscode.commands.registerCommand("osd.removeOldWorkingCopies",
    () => removeOldWorkingCopies(context, controller)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.chooseStartSystem",
    () => chooseStartSystem(context, controller)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.start", () => controller.start()));
  context.subscriptions.push(vscode.commands.registerCommand("osd.stop", () => controller.stop()));
  context.subscriptions.push(vscode.commands.registerCommand("osd.rebuild", () => controller.rebuild()));
  context.subscriptions.push(vscode.commands.registerCommand("osd.rebuildWarm", () => controller.rebuildWarm()));
  context.subscriptions.push(vscode.commands.registerCommand("osd.fullRebuild", () => controller.fullRebuild()));
  context.subscriptions.push(vscode.commands.registerCommand("osd.openSystemLog", () => controller.openLog()));
  context.subscriptions.push(vscode.commands.registerCommand("osd.openLaunchpad", () => controller.openLaunchpad()));
  context.subscriptions.push(vscode.commands.registerCommand("osd.openLaunchpadInVsCode", () => controller.openLaunchpadInVsCode()));
  const treeProvider = new OsdTreeProvider(controller);
  context.subscriptions.push(treeProvider);
  context.subscriptions.push(vscode.window.registerTreeDataProvider("osdTree", treeProvider));
  context.subscriptions.push(vscode.commands.registerCommand("osd.refreshTree",
    () => treeProvider.refresh(true).then(() => treeProvider.emitter.fire(), () => treeProvider.emitter.fire())));
  context.subscriptions.push(vscode.commands.registerCommand("osd.groupServicesByKind", () => treeProvider.setServiceGrouping("kind")));
  context.subscriptions.push(vscode.commands.registerCommand("osd.groupServicesByPack", () => treeProvider.setServiceGrouping("pack")));

  // Services tree (docs/vscode-extension.md, "Services tree"): a row's own
  // click shows the reusable details webview. Inline Open uses osd.openIn;
  // the context menu's Open is always the external browser.
  context.subscriptions.push(vscode.commands.registerCommand("osd.openServiceRow", (row) => openServiceRow(row)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.openServiceRowExternal", (item) => openServiceRowExternal(item)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.showServiceDetails", (item) => showServiceDetails(item, treeProvider, output)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.openServiceSource", (item, role) => openServiceSource(item, role, output)));
  for (const [command, role] of [["osd.openServiceSourceDpc", "dpc"], ["osd.openServiceSourceMpc", "mpc"],
    ["osd.openServiceSourceHandler", "handler"], ["osd.openServiceSourceApp", "app"],
    ["osd.openServiceSourceDeclaration", "service"]]) {
    context.subscriptions.push(vscode.commands.registerCommand(command, (item) => openServiceSource(item, role, output)));
  }
  context.subscriptions.push(vscode.commands.registerCommand("osd.openHostDoor", (route) => openHostDoor(route)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.testServiceClosure", (item) => testServiceClosure(item, output)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.copyServiceUrl", (item) => copyServiceUrl(item)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.copyServiceWsUrl", (item) => copyServiceWsUrl(item)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.copyServiceMetadata", (item) => copyServiceMetadata(item)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.openServiceMetadata", (item) => openServiceMetadata(item)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.openServiceClass", (node) => openServiceClass(node, output)));
  context.subscriptions.push(vscode.commands.registerCommand("osd.openEntitySetMethod",
    (dpcName, set, line) => openEntitySetMethod(dpcName, set, line, output)));
  context.subscriptions.push({dispose: () => {
    serviceDetailsPanel?.dispose();
    serviceDetailsPanel = undefined;
    serviceDetailsItem = undefined;
  }});
  context.subscriptions.push(startStopStatusBar(context, controller));
}

// the one controller this window's deactivate() stops, if any -- a plain
// module-level slot rather than a class of its own, because there is never
// more than one activate() per window
let activeController;

// ---- status bar: which generation the system serves, or that it is down

// /osd/serving's own `databaseIdentity.engine` (tools/osd-database-identity.mjs):
// a public, bounded vocabulary, never the connection -- read straight off
// whatever osd.url points to, which need not be an instance this window
// itself started (docs/vscode-extension.md, "Databases").
const DB_ENGINE_LABEL = {sqlite: "SQLite", duckdb: "DuckDB", HDB: "HANA", postgres: "PostgreSQL"};

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
      const warm = serving.warm;
      // T7 (docs/vscode-extension.md "Warm"): the swap count from the warm
      // field when it is there (this façade carries it, #108), else the
      // older `serving.hot.swaps` a system without it still answers with
      const swaps = warm?.swaps ?? serving.hot?.swaps ?? 0;
      const warmText = warmStatusText(warm);
      const engine = serving.databaseIdentity?.engine;
      const dbLabel = DB_ENGINE_LABEL[engine] ?? engine;
      item.text = `$(server) osd ${generation}${dbLabel ? ` · ${dbLabel}` : ""}${warmText ? ` · ${warmText}` : ""}${swaps ? ` +${swaps}` : ""}${dumps.length ? `  $(bug) ${dumps.length}` : ""}`;
      const lastVerify = warm?.lastVerify === undefined ? "never"
        : `${warm.lastVerify.verdict ?? "?"} at ${warm.lastVerify.at ?? "?"}`;
      item.tooltip = `${osd().url}\ngeneration ${serving.generation}\ndatabase ${dbLabel ?? "unknown"}\npid ${serving.pid}` +
        (warm === undefined ? "" : `\nwarm: ${warm.state}${warm.reason ? ` (${warm.reason})` : ""}` +
          `\nwarm generation: ${warm.generation ?? "n/a"}\nunverified: ${(warm.unverified ?? []).join(", ") || "none"}` +
          `\nswaps: ${warm.swaps ?? 0}\ncopies: ${warm.copies ?? 0}\nlast verify: ${lastVerify}`) +
        `\n${dumps.length} short dump(s) -- click to list`;
      item.backgroundColor = dumpsSeen !== undefined && dumps.length > dumpsSeen
        ? new vscode.ThemeColor("statusBarItem.errorBackground") : undefined;
      dumpsSeen ??= dumps.length;
    } catch {
      // T7: right after a launch the façade answers nothing at all while the
      // warm registry primes synchronously (docs/warm-compile.md), for up to
      // about the ~9 s that was measured -- "warming up..." rather than
      // "osd down" for the first 20 s of a launch this window itself made,
      // so a person does not read a normal start as a failure.
      const since = activeController?.launcher?.startedAt;
      const launching = activeController?.launcher?.state !== "stopped" && since !== undefined && Date.now() - since < 20000;
      item.text = launching ? "$(sync~spin) osd warming up…" : "$(debug-disconnect) osd down";
      item.tooltip = launching
        ? `${osd().url} has not answered yet -- normal for the first few seconds of a launch (osd.warm primes synchronously)`
        : `nothing answers /osd/serving at ${osd().url} (setting osd.url)`;
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
      // T7 (docs/vscode-extension.md "Warm"): what the build behind this
      // activation was, off X-OSD-Build/X-OSD-Swap-Ms -- "hot-swapped in
      // <ms> ms (warm)", "recycled (host-held module)" or "cold build:
      // <reason>" -- plus the closure-tests count (kept on the result for
      // B1, shown here as the line the task asks for).
      const build = activationBuildText(result);
      const tests = closureTestsText(result);
      const extra = [build, tests].filter(Boolean).join(", ");
      vscode.window.setStatusBarMessage(
        `osd: ${object.name} activated, generation ${generation}${extra ? ` (${extra})` : ""}`, 5000);
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

async function requireDebugSystem(output, action) {
  const attached = await activeController?.attachSystemDebugger();
  if (attached === true) return true;
  const message = `${action} with debugger needs a system started by osd.start with osd.debug enabled; enable it and restart the system`;
  output.appendLine(`osd debugger: ${message}`);
  vscode.window.showWarningMessage(`osd: ${message}`);
  return false;
}

async function run(output, classrunOutput, forceDebugger = false) {
  const current = currentObject();
  if (current === undefined) {
    // Q7: a TABL or a DDLS -- adtObjectOf (currentObject's own) knows
    // neither type (Check/Activate do not reach them), so they are found
    // here instead, off the file F8 was pressed on.
    const editor = vscode.window.activeTextEditor;
    const preview = editor === undefined ? undefined : dataPreviewObjectOf(editor.document.fileName);
    if (preview === undefined) return;
    const hasMandt = preview.type === "TABL" && tablHasMandt(editor.document.getText());
    const action = runActionFor(preview);
    if (action.kind === "data-preview") {
      if (forceDebugger && !(await requireDebugSystem(output, "Run"))) return;
      await openDataPreview(action.objectType, action.name, hasMandt, output);
    } else {
      output.appendLine(`osd run ${preview.name}: ${action.text}`);
      vscode.window.showInformationMessage(`osd: ${action.text}`);
    }
    return;
  }
  const {editor, object} = current;
  const hasUnitTests = fs.existsSync(fileOf(path.dirname(editor.document.fileName), object, "testclasses"));
  // Q6b: read straight off the buffer VS Code already has, not necessarily
  // saved -- the same "the editor's own text" Ctrl+F2 already does for a
  // check. Only asked for a CLAS; the regex would never match anything
  // else, but there is no reason to run it over a table or a CDS view.
  const hasClassrun = object.type === "CLAS" && implementsClassrun(editor.document.getText());
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
  const action = runActionFor(object, {hasUnitTests, hasClassrun, entitySet});
  // Q4: a run is server work, so it is a point the table this object's own
  // heat comes from may have changed -- fire-and-forget, the same as the
  // timer, so F8 does not wait on it.
  void refreshHotspots(output);
  if (action.kind === "unit") {
    if (forceDebugger) await vscode.commands.executeCommand("osd.debugCurrentTests", object);
    else await vscode.commands.executeCommand("testing.runCurrentFile");
    return;
  }
  if (action.kind === "call-entityset") {
    await callEntitySet({service: action.service, set: action.set, kind: action.entityKind, withDebugger: forceDebugger}, output);
    return;
  }
  if (action.kind === "classrun") {
    await classrunObject(object.name, classrunOutput, forceDebugger);
    return;
  }
  if (action.kind === "webgui") {
    await openWebguiTransaction(action.tcode, output);
    return;
  }
  output.appendLine(`osd run ${object.name}: ${action.text}`);
  vscode.window.showInformationMessage(`osd: ${action.text}`);
}

// ---- gui-reports spike (docs/gui-reports.md): F8 on a converted report
// opens SAP Easy Access, at that report's transaction, in a webview panel
// beside the editor rather than in the system browser "Open launchpad"
// uses -- the ask was a panel inside VS Code, and a webview is the one VS
// Code has.
//
// The panel does not carry a copy of the page: it iframes the running
// osd's own URL, so the sapevent round trip (docs/webgui.md) runs exactly
// as it does in a browser tab, clicks and all. The one real constraint is
// what a webview's default Content-Security-Policy blocks by default (no
// origin at all, same as any other webview until the page's own CSP names
// one) and what "localhost" even means from inside the panel: under
// Remote-WSL and Remote-SSH the webview itself renders in the local UI
// process, on the other side of the remote/local boundary from the osd
// server it is asking for, so a bare `http://localhost:<port>` is a
// coincidence when it works (Remote-WSL's own automatic port forwarding)
// and a dead port otherwise (Remote-SSH forwards nothing unless asked).
// `vscode.env.asExternalUri` is VS Code's own answer to exactly that: it
// hands back the URL this window's UI can actually reach, forwarding the
// port first if that remote needs it, and is a no-op when nothing is
// remote at all -- so this asks it rather than assuming osd's configured
// URL already is the right one.
async function openWebguiTransaction(tcode, output) {
  const baseUri = vscode.Uri.parse(osd().url);
  await runWebguiPanel(tcode, baseUri, webguiPanels, {
    createPanel: (name) => vscode.window.createWebviewPanel("osdWebgui", `Easy Access: ${name}`, vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
    }),
    // Resolve only the listener; the resource path and transaction command
    // are added to the transport address after VS Code has forwarded it.
    resolveBase: (uri) => vscode.env.asExternalUri(uri),
    panelHtml: webguiPanelHtml,
    onResolveError: (e) => output.appendLine(`osd webgui ${tcode}: asExternalUri failed, using ${baseUri.toString()} as typed (${String(e.message ?? e)})`),
  });
}

// ---- Q6b "Classrun": F9, ADT's "Run as ABAP Application (Console)" --
// tools/adt-facade.mjs `oo/classrun`, one class at a time, its own output
// channel so a run is not lost among the status bar's and F8's lines. A
// dump still shows: the route answers 200 with what the class wrote and
// then a trace, so the channel shows both rather than an error dialog with
// nothing behind it.

async function classrunCurrent(classrunOutput, withDebugger = false) {
  const current = currentObject();
  if (current === undefined) return;
  const {object} = current;
  if (object.type !== "CLAS") {
    vscode.window.showInformationMessage(`osd: ${object.name} is not a class`);
    return;
  }
  await classrunObject(object.name, classrunOutput, withDebugger);
}

async function classrunObject(name, classrunOutput, withDebugger = false) {
  if (withDebugger && !(await requireDebugSystem(classrunOutput, "Classrun"))) return;
  classrunOutput.show(true);
  classrunOutput.appendLine(`--- classrun ${name} ---`);
  try {
    const {text, ms, generation} = await osd().classrun(name);
    classrunOutput.appendLine(text);
    classrunOutput.appendLine(`(${ms} ms${generation ? `, ${generation}` : ""})`);
  } catch (e) {
    classrunOutput.appendLine(`osd classrun ${name}: ${String(e.message ?? e)}`);
    vscode.window.showErrorMessage(`osd classrun: ${String(e.message ?? e)}`);
  }
}

// ---- Q7 "F8 on a table or a CDS view" (docs/vscode-extension.md): a
// webview of the rows, over the façade's own datapreview/ddic (TABL) /
// datapreview/cds (DDLS) route (lib.js Osd#dataPreview) -- the same door
// ADT's own Data Preview uses, so the name resolution (a DDLS's own CDS
// name, not its @AbapCatalog.sqlViewName) and the DDIC field labels are
// the façade's, not guessed here. A row's own count, when the fetch came
// back at the row cap, is one more query through the plain freestyle
// route -- the one door this whole feature is told to prefer, and the one
// that already exists for exactly "run this SQL and hand back a number".

async function openDataPreview(objectType, name, hasMandt, output) {
  const panel = vscode.window.createWebviewPanel("osdDataPreview", `Data Preview ${name}`, vscode.ViewColumn.Beside,
    {enableScripts: true, retainContextWhenHidden: true});
  let allClients = false;
  const load = async () => {
    const rowLimit = vscode.workspace.getConfiguration("osd").get("dataPreview.rowLimit", 100);
    panel.webview.html = dataPreviewHtml(name, {loading: true});
    const statement = dataPreviewQuery(name, {hasMandt, allClients});
    try {
      const result = await osd().dataPreview(objectType, name, statement, rowLimit);
      let total;
      if (result.rows.length >= rowLimit) {
        try {
          const count = await osd().freestyle(dataPreviewCountQuery(name, {hasMandt, allClients}), 1);
          const first = count.rows[0] ?? {};
          total = Number(first.N ?? first.n ?? Object.values(first)[0]);
        } catch (e) {
          output.appendLine(`osd data preview ${name}: count failed: ${String(e.message ?? e)}`);
        }
      }
      panel.webview.html = dataPreviewHtml(name, {
        objectType, columns: result.columns, rows: result.rows, ms: result.ms, generation: result.generation,
        statement, hasMandt, allClients, status: dataPreviewStatusText(result.rows.length, rowLimit, total),
      });
    } catch (e) {
      output.appendLine(`osd data preview ${name}: ${String(e.message ?? e)}`);
      panel.webview.html = dataPreviewHtml(name, {error: String(e.message ?? e)});
    }
  };
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.command === "refresh") {
      await load();
    } else if (message?.command === "toggleAllClients") {
      allClients = message.value === true;
      await load();
    } else if (message?.command === "openNotebook") {
      await newSqlNotebook(typeof message.statement === "string" ? message.statement : `SELECT * FROM ${name}`);
    }
  });
  await load();
}

function dataPreviewShell(name, body) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); font-size: 13px; padding: 8px; color: var(--vscode-foreground); }
  .meta { margin-bottom: 8px; opacity: 0.9; }
  .meta div { margin: 4px 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid var(--vscode-panel-border, #555); padding: 4px 8px; text-align: left; white-space: nowrap; }
  th { background: var(--vscode-editor-lineHighlightBackground, #2a2a2a); }
  button { cursor: pointer; }
  label { user-select: none; cursor: pointer; margin-right: 12px; }
  .osd-error { color: var(--vscode-errorForeground, #f66); }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** The webview body for `openDataPreview`'s current state: `{loading:
 *  true}` while a fetch is in flight, `{error}` when one failed (F8 on a
 *  DDLS with no database object behind it lands here with the façade's
 *  own message, not a bare 404), or the full shape with `columns` (lib.js
 *  dataPreviewRows' own `{name, label, key}`), `rows`, `status` (lib.js
 *  dataPreviewStatusText), `statement` (what "Open in SQL notebook" seeds
 *  its cell with) and `hasMandt`/`allClients` (the toggle, shown only for
 *  a TABL that carries the field at all). MANDT itself is dropped from
 *  the table while filtered -- every row would show the same value -- and
 *  shown once "all clients" reveals rows that may not share it. */
function dataPreviewHtml(name, state = {}) {
  if (state.loading === true) {
    return dataPreviewShell(name, `<p>loading ${xmlEscapeHtml(name)}...</p>`);
  }
  if (state.error !== undefined) {
    return dataPreviewShell(name, `<p class="osd-error">${xmlEscapeHtml(state.error)}</p>
<button id="refresh">Refresh</button>
<script>
  const vscode = acquireVsCodeApi();
  document.getElementById("refresh").addEventListener("click", () => vscode.postMessage({command: "refresh"}));
</script>`);
  }
  const shown = state.columns.filter((c) => state.allClients || c.name !== "MANDT");
  const thead = shown.map((c) => `<th title="${xmlEscapeHtml(c.name)}">${xmlEscapeHtml(c.label)}</th>`).join("");
  const tbody = state.rows.map((row) => `<tr>${shown.map((c) => `<td>${xmlEscapeHtml(cellText(row[c.name]))}</td>`).join("")}</tr>`).join("");
  const generation = state.generation === undefined ? "" : ` -- ${xmlEscapeHtml(String(state.generation).slice(0, 8))}`;
  const toggle = state.hasMandt
    ? `<label><input type="checkbox" id="all-clients"${state.allClients ? " checked" : ""}> all clients</label>`
    : "";
  const body = `<div class="meta">
  <div>${xmlEscapeHtml(state.objectType)} ${xmlEscapeHtml(name)} -- ${xmlEscapeHtml(state.status)} -- ${state.ms} ms${generation}</div>
  <div>${toggle}<button id="refresh">Refresh</button> <button id="notebook">Open in SQL notebook</button></div>
</div>
<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
<script>
  const vscode = acquireVsCodeApi();
  document.getElementById("refresh").addEventListener("click", () => vscode.postMessage({command: "refresh"}));
  document.getElementById("notebook").addEventListener("click", () =>
    vscode.postMessage({command: "openNotebook", statement: ${JSON.stringify(state.statement)}}));
  const allClients = document.getElementById("all-clients");
  if (allClients) allClients.addEventListener("change", () => vscode.postMessage({command: "toggleAllClients", value: allClients.checked}));
</script>`;
  return dataPreviewShell(name, body);
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
      return entitySetLenses(document.getText(), map).flatMap((lens) => {
        const range = new vscode.Range(lens.line - 1, 0, lens.line - 1, 0);
        const args = {service: lens.service, set: lens.set, kind: lens.kind};
        return [new vscode.CodeLens(range, {
          title: lens.title,
          command: "osd.callEntitySet",
          arguments: [args],
        }), new vscode.CodeLens(range, {
          title: `$(debug) Call ${lens.set} with debugger`,
          command: "osd.callEntitySetWithDebugger",
          arguments: [args],
        })];
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

// ---- gui-reports spike: a CodeLens "▶ Run in Easy Access (ZGUI_...)"
// above a *.prog.abap's own REPORT line -- "Open in VS Code" for a
// converted report, symmetric to F8 (RUN_TABLE.PROG in lib.js) rather than
// a second way of deciding what to do. lib.js progRunLens does the
// placement, tested without VS Code the same way entitySetLenses is; this
// never asks the server whether the report was actually converted, for the
// reason openWebguiTransaction's own comment gives.

function progLensProvider() {
  const provider = {
    provideCodeLenses(document) {
      const object = adtObjectOf(document.fileName);
      if (object === undefined || object.type !== "PROG") return [];
      const lens = progRunLens(document.getText(), object.name);
      if (lens === undefined) return [];
      const range = new vscode.Range(lens.line - 1, 0, lens.line - 1, 0);
      return [new vscode.CodeLens(range, {
        title: lens.title,
        command: "osd.openWebguiTransaction",
        arguments: [{tcode: lens.tcode}],
      })];
    },
  };
  const registration = vscode.languages.registerCodeLensProvider({pattern: "**/*.prog.abap"}, provider);
  return {dispose: () => registration.dispose()};
}

/** `{service, set, kind}` (a lens's own command arguments, or F8's) into
 *  the GET and the webview: `get_entityset` calls the set with `$top=20`;
 *  `get_entity` first asks the set for one row to default the key prompt
 *  to (lib.js `keyOf`, off `__metadata.uri` -- this client does not
 *  otherwise know the entity type's key properties), then calls the one
 *  entity. Cancelling the prompt leaves nothing called. */
async function callEntitySet({service, set, kind, withDebugger = false}, output) {
  if (withDebugger && !(await requireDebugSystem(output, "Call EntitySet"))) return;
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

// ---- Test Explorer: Project / Packs / Workspace layers / System groups,
// each object's test classes and methods below it (docs/vscode-extension.md,
// "Test Explorer groups"). lib.js's transpileLayers()/classifyTestPath() do
// the pure half (which of the four a file falls under, and which package
// inside it); everything here is the tree built around that, and, below the
// object level, unchanged from before this: same object/class/method ids
// (so a run's history still matches them), same discover()/run() shape.

function testExplorer(context, output, {
  attachUnitDebugger = (event) => activeController?.applyDebuggerEvent(event),
  pickUnitInspectorPort = pickInspectorPort,
} = {}) {
  const controller = vscode.tests.createTestController("osd-abap-unit", "ABAP Unit (osd)");
  const objects = new Map(); // object item id -> {object, dir} -- unchanged meaning, any tree depth
  const groupNodes = new Map(); // group/subgroup/package id -> its TestItem

  const GROUP_LABEL = {project: "Project", packs: "Packs", workspace: "Workspace layers", system: "System"};
  const GROUP_ORDER = ["project", "packs", "workspace", "system"];

  function readTranspileConfig(root) {
    if (root === undefined) return {};
    try {
      return JSON.parse(fs.readFileSync(path.join(root, "abap_transpile.json"), "utf8"));
    } catch {
      return {};
    }
  }

  function ensureGroupNode(id, label, parent) {
    let node = groupNodes.get(id);
    if (node === undefined) {
      node = controller.createTestItem(id, label);
      groupNodes.set(id, node);
      if (parent === undefined) controller.items.add(node);
      else parent.children.add(node);
    }
    return node;
  }

  function objectItemFor(entry) {
    const id = `${entry.object.type}:${entry.object.name}`;
    if (objects.has(id)) return undefined; // the same object found twice (two scans overlapping) -- keep the first
    const item = controller.createTestItem(id, entry.object.name, entry.uri);
    item.canResolveChildren = true;
    objects.set(id, {object: entry.object, dir: entry.dir});
    return item;
  }

  // one bucket per bucketKey holds the object items directly: Project's own
  // top node (Project has no sub-node of its own), else the one mandatory
  // sub-node a pack / lib / workspace layer always gets. Split further by
  // packageOf() once the bucket clears PACKAGE_SPLIT_THRESHOLD -- the
  // "~15" the task named, read off lib.js so a test and this agree on it.
  function placeEntries(containerNode, entries) {
    if (!needsPackageSplit(entries.length)) {
      for (const entry of entries) {
        const item = objectItemFor(entry);
        if (item !== undefined) containerNode.children.add(item);
      }
      return;
    }
    const byPackage = new Map();
    for (const entry of entries) {
      const pkg = packageOf(entry.classification.relInGroup);
      if (!byPackage.has(pkg)) byPackage.set(pkg, []);
      byPackage.get(pkg).push(entry);
    }
    for (const [pkg, pkgEntries] of byPackage) {
      const target = pkg === undefined ? containerNode : ensureGroupNode(`${containerNode.id}:pkg:${pkg}`, pkg, containerNode);
      for (const entry of pkgEntries) {
        const item = objectItemFor(entry);
        if (item !== undefined) target.children.add(item);
      }
    }
  }

  // Item 5 (docs/vscode-extension.md): a class's own testclasses include,
  // or a PROG's local test classes -- abapGit keeps those inline in the
  // program's own `*.prog.abap` (or an include it reaches the same way),
  // never split out the way a class's `.testclasses.abap` is. Both routes
  // land on the same generic server side (tools/adt-facade.mjs
  // `core/http/unit/object[/run]`, `type=CLAS` or `type=PROG`; FUGR is not
  // accepted there -- refused with 400, so a function group's own `FOR
  // TESTING` is never listed, a gap named in the doc rather than guessed
  // at silently).
  const TEST_FILE_GLOB = "**/{*.clas.testclasses.abap,*.prog.abap}";

  // findFiles() the way the four groups actually differ: Project and Packs
  // sit under the repo root and stay behind EXCLUDE (never .local, gen,
  // node_modules, output, build -- the same exclude every other feature
  // here uses); a lib's own folder and a running workspace layer's own
  // folder are asked for directly, RelativePattern-scoped, bypassing
  // EXCLUDE on purpose -- that is the one thing that lets System (`.local/
  // lars/*`, today) be found at all, without also walking the dozens of
  // other clones and worktrees `.local/**` carries that are neither.
  async function scanAll(root, layers, workspaceLayers, showSystem) {
    const uris = [...await vscode.workspace.findFiles(TEST_FILE_GLOB, EXCLUDE)];
    if (showSystem) {
      for (const lib of layers.libs) {
        const base = path.join(root, lib.folder);
        if (!fs.existsSync(base)) continue;
        const pattern = new vscode.RelativePattern(vscode.Uri.file(base), TEST_FILE_GLOB);
        uris.push(...await vscode.workspace.findFiles(pattern));
      }
    }
    for (const wl of workspaceLayers) {
      const folder = typeof wl.folder === "string" ? wl.folder : wl.srcDir;
      if (typeof folder !== "string" || !fs.existsSync(folder)) continue;
      const pattern = new vscode.RelativePattern(vscode.Uri.file(folder), TEST_FILE_GLOB);
      uris.push(...await vscode.workspace.findFiles(pattern));
    }
    return uris;
  }

  // Bugs 1/2/6 (docs/vscode-extension.md): `vscode.workspace.findFiles`
  // above walks every open workspace folder, which is not necessarily
  // osdHome -- a packaged install's osdHome is a materialized copy of the
  // bundled seed in globalStorage, while the window's own workspace folder
  // (the checkout a person actually opened and edits) is a different tree
  // entirely. Classifying a file found there against osdHome's own
  // abap_transpile.json made `path.relative` climb out of one tree and back
  // down into the other, so every project/packs file landed in one "`..`"
  // sub-node holding everything (and Packs, whose own prefix check can
  // never match a path that starts "`..`", held nothing at all). Each
  // file's OWN workspace folder is read once and cached, and that folder's
  // OWN config -- never osdHome's -- is what its packages and its System/
  // Packs membership are read against. A lib's own folder and a running
  // workspace layer's own folder are found by an explicit RelativePattern
  // rooted at `root` (osdHome) or the layer's own absolute folder
  // respectively (see scanAll above), so they are always already under the
  // root they are classified against and need no lookup here; a file with
  // no owning workspace folder at all (that is exactly this case) falls
  // back to `root`.
  const configCache = new Map(); // workspace-folder root -> {layers, demoObjects}
  const layersFor = (folderRoot) => {
    if (!configCache.has(folderRoot)) {
      const config = readTranspileConfig(folderRoot);
      configCache.set(folderRoot, {layers: transpileLayers(config), demoObjects: demoFailureObjects(config)});
    }
    return configCache.get(folderRoot);
  };

  const buildTree = async () => {
    const root = activeController?.launcher?.osdHome ?? osdHomeOf();
    const layers = transpileLayers(readTranspileConfig(root));
    const workspaceLayers = activeController?.launcher?.layers ?? [];
    const showSystem = vscode.workspace.getConfiguration("osd").get("tests.showSystem", true);

    controller.items.replace([]);
    groupNodes.clear();
    objects.clear();
    configCache.clear();
    if (root === undefined) return;

    const placed = [];
    for (const uri of await scanAll(root, layers, workspaceLayers, showSystem)) {
      let source;
      try {
        source = fs.readFileSync(uri.fsPath, "utf8");
      } catch {
        continue;
      }
      // the cheap filter, done up front: a testclasses include (or a PROG
      // with no local test class at all) never becomes an item only to be
      // found empty once expanded (lib.js hasTestMethods -- discover()'s
      // own server round trip still filters per class/method the same way,
      // below)
      if (!hasTestMethods(source)) continue;
      const object = objectOf(uri.fsPath);
      if (object === undefined) continue;
      // the file's OWN workspace folder, not osdHome -- bugs 1/2/6 above
      const ownRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? root;
      const {layers: ownLayers, demoObjects} = layersFor(ownRoot);
      const classification = classifyTestPath(ownRoot, uri.fsPath, ownLayers, workspaceLayers);
      // outside every known root, or hidden by that root's own
      // exclude_filter (test/fixtures/, deploy/ is not a layer at all,
      // a lib's own excluded corner) -- not part of the system, not listed
      if (classification === undefined) continue;
      // Item 4: a class or program abap_transpile.json's own `options.skip`
      // already marks as deliberately failing gets its own sub-node under
      // Project, so "Run" there stays green while the demo itself still
      // runs and still fails when asked for on purpose.
      if (classification.group === "project" && demoObjects.has(object.name)) {
        classification.subgroup = "Demos (fail on purpose)";
      }
      placed.push({uri, object, dir: path.dirname(uri.fsPath), classification});
    }

    const groupsPresent = new Set(["project", "packs"]);
    if (showSystem) groupsPresent.add("system");
    if (workspaceLayers.length > 0) groupsPresent.add("workspace");
    for (const group of GROUP_ORDER) {
      if (groupsPresent.has(group)) ensureGroupNode(`group:${group}`, GROUP_LABEL[group], undefined);
    }

    const buckets = new Map(); // bucketKey -> {group, subgroup, entries}
    for (const entry of placed) {
      const {group, subgroup} = entry.classification;
      if (!groupsPresent.has(group)) continue; // e.g. a workspace-layer file with no active layer known right now
      const bucketKey = subgroup === undefined ? `group:${group}` : `group:${group}:${subgroup}`;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, {group, subgroup, entries: []});
      buckets.get(bucketKey).entries.push(entry);
    }
    for (const [bucketKey, bucket] of buckets) {
      const topNode = groupNodes.get(`group:${bucket.group}`);
      const containerNode = bucket.subgroup === undefined ? topNode : ensureGroupNode(bucketKey, bucket.subgroup, topNode);
      placeEntries(containerNode, bucket.entries);
    }
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
      await buildTree();
      return;
    }
    await discover(item);
  };

  // narrowly scoped, so an unrelated edit never disturbs another object's
  // own expansion: onDidChange only re-runs discover() for an object
  // already found and already expanded (the tree's own shape did not
  // change); a create or a delete can change which bucket exists or
  // whether a group is now empty, so those go through buildTree() again --
  // debounced, so a burst of saves (a checkout, a branch switch) rebuilds
  // once rather than once per file
  let rebuildTimer;
  const scheduleRebuild = () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => { buildTree().catch((e) => output.appendLine(String(e.message ?? e))); }, 300);
  };
  const watcher = vscode.workspace.createFileSystemWatcher(TEST_FILE_GLOB);
  watcher.onDidCreate(() => scheduleRebuild());
  watcher.onDidDelete(() => scheduleRebuild());
  watcher.onDidChange((uri) => {
    const object = objectOf(uri.fsPath);
    const item = object === undefined ? undefined : controllerFind(`${object.type}:${object.name}`);
    if (item !== undefined && item.children.size > 0) discover(item);
  });

  // objects.has(id) is not enough on its own to find a TestItem anywhere in
  // the tree (controller.items is top-level groups only, now) -- walk every
  // group down to the object items once, for the rare watcher onDidChange
  function controllerFind(id) {
    const walk = (collection) => {
      for (const [, child] of collection) {
        if (child.id === id) return child;
        const found = walk(child.children);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    return walk(controller.items);
  }

  // the ancestor object item of `item` (itself, if `item` already is one),
  // or undefined when `item` sits above every object (a group, a pack/lib/
  // workspace-layer sub-node, or a package split inside one)
  function objectAncestorOf(item) {
    let node = item;
    while (node !== undefined && !objects.has(node.id)) node = node.parent;
    return node;
  }

  // every object item under `item`, itself included when it already is one
  // -- "running a group runs all of its children", the way the Testing API
  // does by default: a group/pack/lib/workspace-layer/package node handed
  // to the run handler (Run on the group, or "Run All") expands to every
  // object it holds, each run in full
  function objectDescendantsOf(item) {
    if (objects.has(item.id)) return [item];
    const out = [];
    for (const [, child] of item.children) out.push(...objectDescendantsOf(child));
    return out;
  }

  const runHandler = async (request, token, forceDebugger = false) => {
    const run = controller.createTestRun(request);
    const useDebugger = forceDebugger || osdDebugEnabled();
    // `osd.database.tests` (docs/vscode-extension.md, "Databases"): read
    // once per run, not once per object -- it does not change mid-run, and
    // a per-object read would mean one call to context.secrets per object.
    // `undefined` for "same" sends no dbEnv at all, exactly the route's own
    // default.
    const dbEnv = await testsDbEnv(context, activeController?.launcher?.osdHome ?? osdHomeOf());
    // what was asked, expanded down to (or across) actual objects, then
    // grouped by object: the server runs one object at a time
    const asked = request.include ?? [...gather(controller.items)];
    const selections = [];
    for (const item of asked) {
      if (objects.has(item.id)) {
        selections.push({item, objectItem: item, testClass: undefined, method: undefined});
        continue;
      }
      const ancestor = objectAncestorOf(item);
      if (ancestor !== undefined) {
        const suffix = item.id.slice(ancestor.id.length).replace(/^\//, "");
        const [testClass, method] = suffix === "" ? [undefined, undefined] : suffix.split("/");
        selections.push({item, objectItem: ancestor, testClass, method});
        continue;
      }
      for (const objItem of objectDescendantsOf(item)) {
        selections.push({item: objItem, objectItem: objItem, testClass: undefined, method: undefined});
      }
    }
    const byObject = new Map();
    for (const sel of selections) {
      if (!byObject.has(sel.objectItem.id)) byObject.set(sel.objectItem.id, []);
      byObject.get(sel.objectItem.id).push(sel);
    }
    for (const [objectId, sels] of byObject) {
      if (token.isCancellationRequested) break;
      const objectItemOf = sels[0].objectItem;
      if (objectItemOf.children.size === 0) await discover(objectItemOf);
      const {object, dir} = objects.get(objectId);
      for (const sel of sels) {
        if (token.isCancellationRequested) break;
        const methods = leaves(sel.item);
        methods.forEach((m) => run.started(m));
        try {
          const inspectPort = useDebugger ? await pickUnitInspectorPort() : undefined;
          if (token.isCancellationRequested) {
            methods.forEach((m) => run.skipped(m));
            break;
          }
          const execute = (signal) => osd().run(object, sel.testClass, sel.method, dbEnv, inspectPort,
            inspectPort !== undefined, signal);
          const answer = inspectPort === undefined ? await execute() : await runWithDebuggerAttach(
            () => attachUnitDebugger({type: "unit-started", port: inspectPort}), execute, token);
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
  controller.createRunProfile("Debug", vscode.TestRunProfileKind.Debug,
    (request, token) => runHandler(request, token, true), false);
  const debugCurrentTests = vscode.commands.registerCommand("osd.debugCurrentTests", async (object) => {
    await buildTree();
    const item = controllerFind(`${object.type}:${object.name}`);
    if (item === undefined) {
      vscode.window.showWarningMessage(`osd: no Test Explorer item for ${object.name}`);
      return;
    }
    if (item.children.size === 0) await discover(item);
    const cancellation = new vscode.CancellationTokenSource();
    try {
      await runHandler(new vscode.TestRunRequest([item]), cancellation.token, true);
    } finally {
      cancellation.dispose();
    }
  });
  controller.refreshHandler = async () => {
    await buildTree();
  };
  return {dispose: () => { clearTimeout(rebuildTimer); watcher.dispose(); debugCurrentTests.dispose(); controller.dispose(); }};
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

// ---- Q6a notebooks: a *.osdnb file holds SQL, ABAP, SQLScript, and markdown
// cells (lib.js notebookFromJson / notebookToJson handles the JSON format).
// SQL uses ADT freestyle preview, ABAP uses the notebook classrun route, and
// SQLScript uses the AMDP sandbox. All run in the same serving osd.

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

/** `osd.newSqlNotebook`'s own untitled notebook, and Q7's "Open in SQL
 *  notebook" button -- `statement` is the cell it opens with, ready to
 *  run; the command palette calls this with none, which keeps the
 *  original placeholder cell. */
async function newSqlNotebook(statement) {
  const data = new vscode.NotebookData([
    new vscode.NotebookCellData(vscode.NotebookCellKind.Code, statement ?? "SELECT * FROM zstg_demo", "sql"),
  ]);
  const doc = await vscode.workspace.openNotebookDocument(NOTEBOOK_TYPE, data);
  await vscode.window.showNotebookDocument(doc);
}

function sqlNotebookController(output) {
  const controller = vscode.notebooks.createNotebookController("osd-sql-kernel", NOTEBOOK_TYPE, "osd notebook");
  controller.supportedLanguages = ["sql", "abap", "sqlscript"];
  controller.supportsExecutionOrder = true;
  let executionOrder = 0;
  controller.executeHandler = (cells) => {
    for (const cell of cells) runNotebookCell(controller, cell, ++executionOrder, output);
  };
  return controller;
}

async function runNotebookCell(controller, cell, executionOrder, output) {
  const execution = controller.createNotebookCellExecution(cell);
  execution.executionOrder = executionOrder;
  execution.start(Date.now());
  try {
    const source = cell.document.getText();
    if (cell.document.languageId === "abap") {
      const result = await osd().notebookAbap(notebookAbapSource(source));
      await execution.replaceOutput([new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.text(result.text ?? "", "text/plain"),
      ])]);
      execution.end(result.ok === true, Date.now());
    } else {
      let result;
      if (cell.document.languageId === "sqlscript") {
        result = await osd().amdpCell(source);
        if (result.error !== undefined) throw new Error(result.error);
      } else {
        const rowLimit = vscode.workspace.getConfiguration("osd").get("notebook.rowLimit", 100);
        result = await osd().freestyle(source, rowLimit);
      }
      const html = freestyleTableHtml(result.columns, result.rows, {ms: result.ms, generation: result.generation});
      await execution.replaceOutput([
        new vscode.NotebookCellOutput(freestyleOutputItems(html).map(({mime, value}) =>
          vscode.NotebookCellOutputItem.text(value, mime))),
      ]);
      execution.end(true, Date.now());
    }
  } catch (e) {
    const message = String(e.message ?? e);
    output.appendLine(`osd ${cell.document.languageId}: ${message}`);
    await execution.replaceOutput([
      new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error({name: "osd", message})]),
    ]);
    execution.end(false, Date.now());
  }
}

// B0: a window that started the system stops it on the way out, rather than
// leaving a build's server as an orphan the way closing a terminal would
// not (VS Code awaits a returned promise here).
async function deactivate() {
  await activeController?.stop();
}

module.exports = {activate, deactivate, SystemController, testExplorer, OsdTreeProvider, TransactionItem};
