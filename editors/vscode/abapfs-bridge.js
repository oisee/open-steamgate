"use strict";

const {mkdirSync, openSync, closeSync} = require("node:fs");
const {join} = require("node:path");
const {randomBytes} = require("node:crypto");
const EXTENSION_ID = "murbani.vscode-abap-remote-fs";
const OFFER_KEY = "osd.abapfs.local.offered";

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
  const refresh = () => {
    const launcher = controller.launcher;
    const credentials = launcher?.state === "running" ? launcher.adtCredentials : undefined;
    if (current === credentials) return;
    current = credentials;
    connections = credentials ? [{
      id: "osd_local", name: "OSD (local)", url: `http://127.0.0.1:${launcher.port}`,
      client: credentials.client, language: credentials.language, user: credentials.user,
      autoConnect: true,
      auth: {kind: "provider", getHeaders: async () => current === credentials && !disposed
        ? {Authorization: `Bearer ${credentials.token}`} : {}},
    }] : [];
    if (provider) changed.fire();
    else if (credentials && !offered) {
      const url = `http://127.0.0.1:${launcher.port}`;
      offered = true;
      // Remember even dismissal or Not now, before another lifecycle event.
      void (async () => {
        // Memento caches can lag in another extension host. An exclusive file
        // in shared global storage makes the once-only claim atomic across windows.
        if (context.globalState.get(OFFER_KEY, false)) return;
        const storage = context.globalStorageUri.fsPath;
        mkdirSync(storage, {recursive: true});
        try { closeSync(openSync(join(storage, `${OFFER_KEY}.claim`), "wx")); }
        catch (error) { if (error.code === "EEXIST") return; throw error; }
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

module.exports = {registerAbapFsBridge, startCredentials, EXTENSION_ID};
