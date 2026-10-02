"use strict";
const path = require("node:path");
const {spawn} = require("node:child_process");

function unitChoices(manifest, activeFile, checkout) {
  const items = Object.entries(manifest.units ?? {}).map(([name, unit]) => {
    const picked = activeFile !== undefined && (unit.sources ?? []).some((source) => {
      const rel = path.relative(path.resolve(checkout, source), path.resolve(activeFile));
      return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`));
    });
    const description = String(unit.description ?? "").split(/(?<=\.)\s+/)[0];
    return {label: name, detail: `${description} (${(unit.objects ?? []).length} objects)`,
      picked, unit: {...unit, name}};
  });
  return items.sort((a, b) => Number(b.picked) - Number(a.picked));
}

function zipArgs(unit, out) {
  const source = unit.sources?.[0];
  if (!source) throw new Error(`Deploy unit "${unit.name}" has no sources. Prepare its BSP application and ICF node with tools/osd-bsp-app.mjs first, then use tools/osd-abapgit-zip.mjs on that prepared folder with --unit ${unit.name}.`);
  return ["tools/osd-abapgit-zip.mjs", source, "--unit", unit.name, "--out", out];
}

function outcomeOf(exitCode, stdout, stderr) {
  const lines = stdout.split(/\r?\n/);
  const summary = lines.findIndex((line) => /^.+: \d+ files, [\d.]+ KB, deploy unit ".*"$/.test(line));
  const written = summary < 0 ? undefined : /^(.*): \d+ files,/.exec(lines[summary])?.[1];
  let objects = 0;
  if (summary >= 0) {
    for (const line of lines.slice(summary + 1)) {
      const row = /^  ([A-Z0-9]{4}) +(.+)$/.exec(line);
      // DATA lists tables whose rows travel, not additional repository objects.
      if (row && row[1] !== "DATA") objects += row[2].split(", ").length;
      else if (!line.startsWith("  ")) break;
    }
  }
  const refusalAt = stderr.search(/^.*: \d+ refusal\(s\), nothing may leave for a system until each is resolved:/m);
  const refusal = refusalAt < 0 ? undefined : stderr.slice(refusalAt).trim();
  const lastError = stderr.trim().split(/\r?\n/).at(-1) || undefined;
  return {ok: exitCode === 0 && written !== undefined, path: written, objects, refusal, lastError};
}

// Like osdRunCommandLine, use Node on PATH in the checkout. VS Code's
// process.execPath may be Electron, which is not the checkout's Node.
function runZip(checkout, unit, out, {node = "node", onOutput = () => {}} = {}) {
  const args = zipArgs(unit, out);
  return new Promise((resolve, reject) => {
    const child = spawn(node, args, {cwd: checkout, env: {...process.env, OSD_ROOT: checkout}, shell: false});
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; onOutput(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; onOutput(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({code, stdout, stderr}));
  });
}

module.exports = {unitChoices, zipArgs, outcomeOf, runZip};
