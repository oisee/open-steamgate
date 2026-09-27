// Inventory the materialized seed, not the checkout's complete dependency tree.
import {existsSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {join, relative} from "node:path";

const OSI = new Set(["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Unlicense", "Zlib", "Python-2.0"]);
const LICENSE_OVERRIDES = new Map([
  [".local/lars/open-abap-odata", {
    id: "MIT",
    note: "LICENSE file reads 'todo'; the author's intent is MIT; treated as MIT by the open-steamgate maintainer, 2026-09-27",
  }],
  ...[".local/lars/open-abap-gui", ".local/lars/open-abap-gui/converter"].map((path) => [path, {
    id: "MIT",
    note: "LICENSE file reads 'todo', package.json licence empty, converter/ without a licence; treated as MIT by the open-steamgate maintainer, 2026-09-27",
  }]),
]);
// oisee/zork-abap LICENSE at 0c8d96b908f88fc3207e7f9a00bc43f724b32b6f.
// Its root LICENSE is outside the fetched src/zork_00 folder in the seed.
const ZORK_ABAP_LICENSE = `MIT License

Copyright (c) 2025

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
const licenseName = (dir) => readdirSync(dir).find((name) => /^(?:licen[cs]e|copying)(?:\..*)?$/i.test(name));
const metaAt = (dir) => {
  const file = join(dir, "package.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
};
const spdx = (value) => typeof value === "string" ? value.trim() : value?.type?.trim() ?? "";
const clearText = (text) => /Permission is hereby granted, free of charge/i.test(text) ? "MIT"
  : /Apache License\s+Version 2\.0/i.test(text) ? "Apache-2.0"
  : /Redistribution and use in source and binary forms/i.test(text) ? "BSD-like"
  : /Permission to use, copy, modify, and\/or distribute this software/i.test(text) ? "ISC"
  : "";
const recognized = (id) => OSI.has(id) || /^\((?:MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|Unlicense|Zlib|Python-2\.0)(?: (?:OR|AND) (?:MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|Unlicense|Zlib|Python-2\.0))*\)$/.test(id);

export function inventoryThirdParties(seedRoot, sourceRoot) {
  const entries = [];
  const add = (name, path, dir, fallbackDir = dir) => {
    const meta = metaAt(dir);
    const sourceMeta = dir === fallbackDir ? meta : metaAt(fallbackDir);
    const file = licenseName(dir) ?? licenseName(fallbackDir);
    const from = existsSync(join(dir, file ?? "__missing__")) ? dir : fallbackDir;
    const licenseText = file ? readFileSync(join(from, file), "utf8").trim() : "";
    const declared = spdx(meta.license) || spdx(sourceMeta.license);
    const inferred = clearText(licenseText);
    const override = LICENSE_OVERRIDES.get(path);
    const id = override?.id ?? (declared || inferred || "UNKNOWN");
    const issues = [];
    if (!recognized(id)) issues.push(`unclear or non-OSI license ${id}`);
    if (licenseText && /^(todo|tbd|unknown)$/i.test(licenseText)) issues.push("LICENSE file is a placeholder");
    entries.push({name, path, id, declared, licenseText, licenseFile: file ? relative(sourceRoot, join(from, file)) : "", note: override?.note, issues});
  };

  const libraries = JSON.parse(readFileSync(join(seedRoot, "libs.lock.json"), "utf8")).libraries;
  for (const lib of libraries) {
    const path = `.local/lars/${lib.folder}`;
    if (existsSync(join(seedRoot, path))) add(lib.folder, path, join(seedRoot, path), join(sourceRoot, path));
  }
  // Some filtered libraries carry a generator package in addition to ABAP.
  // Its package.json is in the seed even though its own LICENSE may live at
  // the library root.
  const converter = ".local/lars/open-abap-gui/converter";
  if (existsSync(join(seedRoot, converter, "package.json"))) {
    add("open-abap-gui/converter", converter, join(seedRoot, converter), join(sourceRoot, converter));
  }

  const scanModules = (dir) => {
    if (!existsSync(dir)) return;
    for (const item of readdirSync(dir, {withFileTypes: true})) {
      if (!item.isDirectory() || item.name === ".bin") continue;
      const path = join(dir, item.name);
      if (item.name.startsWith("@")) { scanModules(path); continue; }
      const meta = metaAt(path);
      if (Object.keys(meta).length === 0) continue;
      add(meta.name ?? item.name, relative(seedRoot, path), path);
      scanModules(join(path, "node_modules"));
    }
  };
  scanModules(join(seedRoot, "node_modules"));
  const zorkSources = JSON.parse(readFileSync(new URL("../packs/zork/osd-pack.json", import.meta.url), "utf8")).sources;
  const coveredZorkFolders = zorkSources.map(({folder}) => `packs/zork/${folder}`)
    .filter((folder) => existsSync(join(seedRoot, folder)));
  if (coveredZorkFolders.length > 0) {
    entries.push({
      name: "oisee/zork-abap interpreter", path: coveredZorkFolders[0], id: "MIT", declared: "",
      licenseText: ZORK_ABAP_LICENSE, licenseFile: "", issues: [],
      note: `Covers fetched folders: ${coveredZorkFolders.join(", ")}. LICENSE from https://github.com/oisee/zork-abap at 0c8d96b908f88fc3207e7f9a00bc43f724b32b6f; the repository root is outside the fetched source folders`,
    });
  }
  const zorkStory = "packs/zork/src/zork1-z3.w3mi.data.z3";
  if (existsSync(join(seedRoot, zorkStory))) {
    const licenseFile = "packs/zork/ZORK1-LICENSE.txt";
    const licenseText = readFileSync(join(sourceRoot, licenseFile), "utf8").trim();
    entries.push({
      name: "Zork I story", path: zorkStory, id: "MIT", declared: "",
      licenseText, licenseFile, issues: [],
      note: "Source release by Microsoft, 2025; no trademark rights are granted; rebuilt from the MIT-licensed ZIL source, not the historical binary",
    });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const issues = entries.flatMap((entry) => entry.issues.map((issue) => `${entry.path}: ${issue}`));
  return {entries, issues};
}

export function writeThirdPartyNotices(seedRoot, outputFile, sourceRoot) {
  const result = inventoryThirdParties(seedRoot, sourceRoot);
  const lines = ["# Third-party notices", "", "Generated from the staged system seed. Paths identify the bundled copy; source paths name the licence evidence used when a filtered library omitted its LICENSE file.", ""];
  for (const entry of result.entries) {
    lines.push(`## ${entry.name} — ${entry.path}`, "", `License: ${entry.id}${entry.note ? " (maintainer override)" : entry.declared ? " (package declaration)" : entry.licenseText ? " (identified from license text)" : " (no evidence found)"}.`, "");
    if (entry.note) lines.push(`Note: ${entry.note}`, "");
    if (entry.licenseFile) lines.push(`Source license file: ${entry.licenseFile}`, "");
    if (entry.licenseText) lines.push("```text", entry.licenseText, "```", "");
    if (entry.issues.length) lines.push(`Review: ${entry.issues.join("; ")}.`, "");
  }
  writeFileSync(outputFile, `${lines.join("\n")}\n`);
  return result;
}
