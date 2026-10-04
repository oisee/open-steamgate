"use strict";

const {mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync, rmdirSync} = require("node:fs");
const {join} = require("node:path");
const {randomBytes, createHash} = require("node:crypto");
const EXTENSION_ID = "murbani.vscode-abap-remote-fs";
const OFFER_KEY = "osd.abapfs.local.offered";
const MOUNT_OFFER_KEY = "osd.abapfs.local.mountOffered";
const RESTART_KEY = "osd.abapfs.local.wasRunning";
const RECOVERY_TTL = 5 * 60_000;
function folderRecoveryKey(uri) {
  if (!uri) return undefined;
  const normalized = new URL(uri.toString());
  normalized.pathname = normalized.pathname.replace(/\/+$/, "") || "/";
  return `${RESTART_KEY}.${createHash("sha256").update(normalized.href).digest("hex")}`;
}
const CONNECTION_ID = "osd-local";

// Memento caches lag across hosts. Serialize claims in shared storage as well
// as recording them in globalState. Completed claims never expire.
function claimShared(context, key, claim = true, ttl = 0) {
  const storage = context.globalStorageUri.fsPath;
  mkdirSync(storage, {recursive: true});
  const file = join(storage, `${key}.claim`);
  const lock = `${file}.lock`;
  try { mkdirSync(lock); }
  catch (error) { if (error.code === "EEXIST") return; throw error; }
  try {
    try {
      const previous = JSON.parse(readFileSync(file, "utf8") || "true");
      if (!ttl || previous.consumed || Date.now() - previous.timestamp < ttl) return;
      unlinkSync(file);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const fd = openSync(file, "wx");
    try { writeFileSync(fd, JSON.stringify(claim)); } finally { closeSync(fd); }
    return file;
  } finally { rmdirSync(lock); }
}

function canAutoConnect(workspace) {
  return workspace.workspaceFile !== undefined || (workspace.workspaceFolders?.length ?? 0) !== 1;
}

// Called only at the serving process boundary, after the build. Never persist it.
function startCredentials(env) {
  return {
    token: randomBytes(32).toString("base64url"),
    user: String(env.OSD_USER ?? "DEVELOPER").trim().toUpperCase().slice(0, 12),
    client: String(env.OSD_ADT_CLIENT ?? "001").trim().slice(0, 3) || "001",
    language: "EN",
  };
}

async function registerAbapFsBridge(vscode, context, controller) {
  const session = randomBytes(16).toString("hex");
  let stopped = false;
  const keys = [...new Set((vscode.workspace.workspaceFolders ?? [])
    .map(folder => folderRecoveryKey(folder.uri)).filter(Boolean))];
  const clearRecovery = async () => {
    for (const key of keys) {
      const recovery = context.globalState.get(key);
      if (recovery?.mount) claimShared(context, `${key}.${recovery.mount}`,
        {session, timestamp: Date.now(), consumed: true});
      await context.globalState.update(key, undefined);
    }
  };
  context.subscriptions.push(controller.onWillStop(event => {
    if (event.shutdown) return;
    stopped = true;
    event.waitUntil(clearRecovery());
  }));
  for (const key of keys) {
    const recovery = context.globalState.get(key);
    if (!recovery) continue;
    const age = Date.now() - recovery.timestamp;
    if (!recovery.mount || !Number.isFinite(age) || age < 0 || age >= RECOVERY_TTL) {
      await context.globalState.update(key, undefined);
      continue;
    }
    const claim = {session, timestamp: Date.now(), consumed: true};
    // The mount id fences independently cached globalState in other hosts.
    // Consume permanently before awaiting anything; failed starts never loop.
    const file = claimShared(context, `${key}.${recovery.mount}`, claim);
    await context.globalState.update(key, undefined);
    if (file && !stopped) { await controller.start(); break; }
  }
  const extension = vscode.extensions?.getExtension(EXTENSION_ID);
  if (!extension) return;
  let api;
  try { api = await extension.activate(); }
  catch { return; } // Optional integration; never print provider errors/credentials.
  const changed = new vscode.EventEmitter();
  let connections = [];
  let current;
  let disposed = false;
  let offered = false;
  const provider = api?.version === 2 && typeof api.registerConnectionProvider === "function";
  const offerMount = () => {
    if (offered || context.globalState.get(MOUNT_OFFER_KEY, false)) return;
    offered = true;
    void (async () => {
      // Remember dismissal as well as Not now, across starts and reloads.
      if (!claimShared(context, MOUNT_OFFER_KEY)) return;
      await context.globalState.update(MOUNT_OFFER_KEY, true);
      if (disposed) return;
      const choice = await vscode.window.showInformationMessage(
        'Open "OSD (local)" in ABAP-FS? VS Code will reload this window; the system will restart automatically afterward.',
        "Open OSD (local) in ABAP-FS", "Not now");
      if (choice !== "Open OSD (local) in ABAP-FS" || disposed || !current) return;
      const reload = !canAutoConnect(vscode.workspace);
      stopped = false;
      if (reload && keys[0]) await context.globalState.update(keys[0], {mount: randomBytes(16).toString("hex"), session, timestamp: Date.now()});
      if (stopped || disposed || !current) { if (stopped) await clearRecovery(); return; }
      try { await api.connect(CONNECTION_ID); }
      catch {
        // Reload can withdraw/dispose the provider while connect is pending.
        // Its cancellation must leave recovery armed for the new host.
        if (reload && (!disposed || stopped)) await clearRecovery();
        if (disposed || !current) return;
        throw new Error("mount failed");
      }
    })().catch(() => vscode.window.showWarningMessage("osd: Could not open the local ABAP-FS connection."));
  };
  const refresh = () => {
    const launcher = controller.launcher;
    const credentials = launcher?.state === "running" ? launcher.adtCredentials : undefined;
    if (current === credentials) return;
    current = credentials;
    connections = credentials ? [{
      id: CONNECTION_ID, name: "OSD (local)", url: `http://127.0.0.1:${launcher.port}`,
      client: credentials.client, language: credentials.language, user: credentials.user,
      autoConnect: canAutoConnect(vscode.workspace),
      auth: {kind: "provider", getHeaders: async () => current === credentials && !disposed
        ? {Authorization: `Bearer ${credentials.token}`} : {}},
    }] : [];
    if (provider) {
      changed.fire();
      if (credentials && !canAutoConnect(vscode.workspace)) offerMount();
    }
    else if (credentials && !offered) {
      const url = `http://127.0.0.1:${launcher.port}`;
      offered = true;
      // Remember even dismissal or Not now, before another lifecycle event.
      void (async () => {
        // Memento caches can lag in another extension host. An exclusive file
        // in shared global storage makes the once-only claim atomic across windows.
        if (context.globalState.get(OFFER_KEY, false)) return;
        if (!claimShared(context, OFFER_KEY)) return;
        await context.globalState.update(OFFER_KEY, true);
        if (disposed) return;
        const choice = await vscode.window.showInformationMessage(
          'Add "OSD (local)" to ABAP-FS? Any password works locally.', "Add", "Not now");
        if (choice !== "Add" || disposed) return;
        const config = vscode.workspace.getConfiguration("abapfs");
        const remote = config.inspect("remote")?.globalValue ?? {};
        if (remote["OSD (local)"]) return; // Do not overwrite an existing connection.
        await config.update("remote", {...remote, "OSD (local)": {
          url,
          client: credentials.client, username: credentials.user, language: credentials.language,
        }}, vscode.ConfigurationTarget.Global);
      })().catch(() => vscode.window.showWarningMessage("osd: Could not add the local ABAP-FS connection."));
    }
  };
  // Refresh before registration: API v2 reads the initial snapshot immediately.
  refresh();
  context.subscriptions.push(changed,
    {dispose() { disposed = true; current = undefined; connections = []; }},
    controller.onDidChange(refresh));
  if (provider) context.subscriptions.push(api.registerConnectionProvider({
    getConnections: () => connections, onDidChange: changed.event,
  }));
}

module.exports = {registerAbapFsBridge, startCredentials, EXTENSION_ID, folderRecoveryKey};
