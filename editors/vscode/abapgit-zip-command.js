"use strict";
const fs = require("node:fs/promises");
const {existsSync} = require("node:fs");
const path = require("node:path");
const {unitChoices, zipArgs, outcomeOf, runZip} = require("./abapgit-zip.js");

const CHECKOUT_NEEDED = "osd: Preparing an abapGit zip needs an open-steamgate checkout (osd.home or a workspace folder), with deploy/manifest.json, source files and Node tools. The bundled system and web build cannot provide these inputs.";

function pickUnit(vscode, items) {
  return new Promise((resolve) => {
    const picker = vscode.window.createQuickPick();
    picker.title = "Prepare abapGit zip: deploy unit";
    picker.items = items;
    picker.matchOnDetail = true;
    picker.activeItems = items.filter((item) => item.picked).slice(0, 1);
    const accepted = picker.onDidAccept(() => {
      const selected = picker.selectedItems[0];
      if (selected) { resolve(selected); picker.hide(); }
    });
    const hidden = picker.onDidHide(() => {
      resolve(undefined);
      accepted.dispose();
      hidden.dispose();
      picker.dispose();
    });
    picker.show();
  });
}

async function prepareAbapgitZip(vscode, output, checkout) {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(checkout, "deploy", "manifest.json"), "utf8"));
    if (manifest.version !== 1) throw new Error(`Deploy manifest version ${manifest.version}; the zip tool reads 1.`);
    const editor = vscode.window.activeTextEditor?.document.uri;
    const choice = await pickUnit(vscode, unitChoices(manifest, editor?.scheme === "file" ? editor.fsPath : undefined, checkout));
    if (!choice) return;
    zipArgs(choice.unit, ""); // Refuse units without a source before asking for a target.
    const folder = path.join(checkout, "build", "deploy");
    await fs.mkdir(folder, {recursive: true});
    const target = await vscode.window.showSaveDialog({title: "Save abapGit zip",
      defaultUri: vscode.Uri.file(path.join(folder, `${choice.unit.name}.zip`)), filters: {"abapGit zip": ["zip"]}});
    if (!target) return;
    if (target.scheme !== "file") throw new Error("The abapGit zip target must be a local file.");
    await fs.mkdir(path.dirname(target.fsPath), {recursive: true});
    const result = await vscode.window.withProgress({location: vscode.ProgressLocation.Notification,
      title: `Preparing abapGit zip: ${choice.unit.name}`}, () =>
      runZip(checkout, choice.unit, target.fsPath, {onOutput: (chunk) => output.append(chunk)}));
    const outcome = outcomeOf(result.code, result.stdout, result.stderr);
    if (!outcome.ok) {
      const action = await vscode.window.showErrorMessage(outcome.refusal ?? outcome.lastError ??
        `abapGit zip failed (exit ${result.code}); no success summary was reported.`, "Show output");
      if (action === "Show output") output.show();
      return;
    }
    // Later "Deploy with vsp": vsp exposes commands, not an API; delivery
    // will call a command with this zip after the person chooses a system.
    const action = await vscode.window.showInformationMessage(
      `abapGit zip written: ${outcome.path} (${outcome.objects} objects)`, "Reveal in Explorer", "Copy path");
    if (action === "Reveal in Explorer") await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(outcome.path));
    if (action === "Copy path") await vscode.env.clipboard.writeText(outcome.path);
  } catch (error) {
    const message = error?.code === "ENOENT" && error?.syscall?.startsWith("spawn")
      ? `osd: could not start Node to run the zip tool (${error.path ?? "node"} not found)`
      : String(error.message ?? error);
    output.appendLine(message);
    const action = await vscode.window.showErrorMessage(message, "Show output");
    if (action === "Show output") output.show();
  }
}

function registerAbapgitZipCommand(vscode, context, output, checkoutOf, isCheckout) {
  context.subscriptions.push(vscode.commands.registerCommand("osd.prepareAbapgitZip", () => {
    const checkout = checkoutOf();
    if (checkout === undefined || !isCheckout(checkout) ||
        !existsSync(path.join(checkout, "deploy", "manifest.json")) ||
        !existsSync(path.join(checkout, "tools", "osd-abapgit-zip.mjs"))) {
      return vscode.window.showErrorMessage(CHECKOUT_NEEDED);
    }
    return prepareAbapgitZip(vscode, output, checkout);
  }));
}
module.exports = {registerAbapgitZipCommand, prepareAbapgitZip, CHECKOUT_NEEDED};
