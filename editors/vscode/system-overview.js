// The webview half of System overview. The model comes from lib.js and the
// existing `/osd/serving` and ZOSD_STATUS_SRV OData routes; VS Code only
// supplies the remote-safe sysinfo URL.
"use strict";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function valueText(value) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function factRow(label, value, source) {
  return `<div class="fact"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(valueText(value))}</span>${source ? `<small>${escapeHtml(source)}</small>` : ""}</div>`;
}

function overviewStatusSection(title, records) {
  if (!Array.isArray(records) || records.length === 0) {
    return `<section><h2>${escapeHtml(title)}</h2><p class="muted">No status rows available. Start the system or refresh the overview.</p></section>`;
  }
  // OData plumbing is not a column: __metadata, and navigation properties
  // that come back as {__deferred: {uri}} on every row.
  const deferred = (value) => value !== null && typeof value === "object" && "__deferred" in value;
  const columns = [...new Set(records.flatMap((record) => Object.keys(record)))]
    .filter((column) => column !== "__metadata" && !records.every((record) => record[column] === undefined || deferred(record[column])));
  if (records.length === 1) {
    // One row, many fields: read it down, field by value.
    const rows = columns.map((column) => `<tr><th>${escapeHtml(column)}</th><td>${escapeHtml(valueText(records[0][column]))}</td></tr>`).join("");
    return `<section><h2>${escapeHtml(title)}</h2><div class="table-wrap"><table class="record"><tbody>${rows}</tbody></table></div></section>`;
  }
  const headings = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const rows = records.map((record) => `<tr>${columns.map((column) => `<td>${escapeHtml(valueText(record[column]))}</td>`).join("")}</tr>`).join("");
  return `<section><h2>${escapeHtml(title)} <small>(${records.length})</small></h2><div class="table-wrap"><table><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function systemOverviewHtml(model, {sysinfoUrl} = {}) {
  const running = model.running === true;
  const warm = model.warm?.state ?? "unavailable";
  const home = model.home ?? {};
  const layerText = model.layers.length ? model.layers.join("\n") : "No abapGit workspace layers";
  const keys = model.keymap === "abap"
    ? "Ctrl+F2 Check · Ctrl+F3 Activate · F8 Run · F9 Classrun · F5/F6/F7/F8 debug"
    : "VS Code key bindings are active (osd.keymap)";
  const database = model.database ?? {};
  const localDatabase = database.path ?? (database.storage === "server" ? "External database server" : database.storage === "memory" ? "Process memory" : "No local file reported");
  const launchpad = model.launchpadUrl
    ? `<a class="button secondary" href="${escapeHtml(model.launchpadUrl)}" target="_blank">Open launchpad</a>` : "";
  const startButton = running ? "" : `<a class="button start" href="command:osd.start">Start system</a>`;
  const sysinfo = running && sysinfoUrl
    ? `<iframe title="System information" src="${escapeHtml(sysinfoUrl)}"></iframe>`
    : `<p class="muted">System information is available after the system starts at <code>${escapeHtml(model.sources.sysinfo)}</code>.</p>`;
  const settingsLink = "command:workbench.action.openSettings?%5B%22osd%22%5D";
  const panelFacts = ["OSD view: the OSD Activity Bar icon", "ABAP Unit: the Testing view", "Build and server log: Output → osd system"];
  const sourceFacts = [
    `Serving process: ${model.sources.serving}`,
    `System status: ${Object.values(model.sources.status).join(", ")}`,
    `System information: ${model.sources.sysinfo}`,
  ];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${escapeHtml(sysinfoUrl ? new URL(sysinfoUrl).origin : "'none'")}; style-src 'unsafe-inline';">
<style>
body{font:13px/1.55 var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:18px 24px;max-width:1100px;margin:auto}
h1{font-size:22px;margin:0}.subtitle,.muted,small{color:var(--vscode-descriptionForeground)}
.actions{display:flex;gap:10px;margin:14px 0 22px}.button{display:inline-block;padding:8px 15px;border-radius:4px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);text-decoration:none;font-weight:600}.button:hover{background:var(--vscode-button-hoverBackground)}.button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.button.start{font-size:16px;padding:12px 24px}
h2{font-size:16px;margin:25px 0 10px;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:5px}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1px;background:var(--vscode-panel-border);border:1px solid var(--vscode-panel-border)}.fact{display:grid;grid-template-columns:110px 1fr;gap:4px 12px;padding:10px;background:var(--vscode-editor-background);min-width:0}.fact span{overflow-wrap:anywhere}.fact small{grid-column:2;font-size:11px}
.columns{display:flex;flex-direction:column;gap:18px}.table-wrap{overflow:auto;max-height:380px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;vertical-align:top;padding:6px 9px;border:1px solid var(--vscode-panel-border)}th{white-space:nowrap}table.record th{width:1%;position:static}td{max-width:48ch;overflow-wrap:break-word}th{background:var(--vscode-sideBar-background);position:sticky;top:0}code{font-family:var(--vscode-editor-font-family)}pre{white-space:pre-wrap;margin:0}iframe{border:1px solid var(--vscode-panel-border);width:100%;height:420px;background:white}
@media(max-width:700px){body{padding:12px}}
</style></head><body>
<h1>System overview</h1><div class="subtitle">${running ? `Running on port ${escapeHtml(model.listener.port)}` : escapeHtml(model.state[0].toUpperCase() + model.state.slice(1))} · live facts from this system</div>
<div class="actions">${startButton}${launchpad}<a class="button secondary" href="${settingsLink}">Settings</a></div>
<h2>What is set up and where to find it</h2>
<div class="facts">
${factRow("System lives in", `${home.kind ?? "osd.home"}: ${home.path ?? "not selected"}`, "Extension launcher selection")}
${factRow("Layers", layerText, "Workspace abapGit folders, after the base system")}
${factRow("HTTP port", running ? model.listener.port : "not running", "Extension launcher state")}
${factRow("Launchpad", model.launchpadUrl ?? "available after start", model.sources.serving)}
${factRow("Database", `${database.engine ?? "unknown"} · ${database.storage ?? "unknown"}`, model.sources.serving)}
${factRow("AMDP:", database.engine === "HDB" || database.engine === "hana" ? "eAMDP on HANA" : `eAMDP on HANA · portable (limited) on ${database.engine ?? "unknown"}`, "docs/notebook-cells.md")}
${factRow("Database file", localDatabase, model.sources.serving)}
${factRow("Warm compile", warm, `${model.sources.serving}${model.warm?.reason ? ` · ${model.warm.reason}` : ""}`)}
${factRow("Keys", keys, "osd.keymap")}
${factRow("Panels", panelFacts.join("\n"), "VS Code views and Output panel")}
</div>
<div class="columns">${overviewStatusSection("System", model.status.system)}${overviewStatusSection("Services", model.status.services)}${overviewStatusSection("Packs", model.status.packs)}${overviewStatusSection("Processes", model.status.processes)}${overviewStatusSection("Ports", model.status.ports)}${overviewStatusSection("Database status", model.status.database)}</div>
<section><h2>System information app</h2>${sysinfo}</section>
<section><h2>Settings</h2><p>Change where the system lives, its database, or its key bindings in <a href="${settingsLink}">osd settings</a>.</p></section>
<details><summary>Data sources</summary><ul>${sourceFacts.map((fact) => `<li><code>${escapeHtml(fact)}</code></li>`).join("")}</ul></details>
</body></html>`;
}

module.exports = {escapeHtml, overviewStatusSection, systemOverviewHtml};
