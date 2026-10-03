#!/usr/bin/env node
// Render or compare SAMC/SAPC XML from an L1 JSON model. SAMC is byte-identical with abapGit's serialisation (A4H capture), BOM included.
import {convertTrace, legacyTrace, legacyEntries, traceArgs} from "./dsl-trace.mjs";
import {readFileSync, writeFileSync} from "node:fs";
import {basename, join} from "node:path";
import {pathToFileURL} from "node:url";
import {XMLValidator} from "fast-xml-parser";
import {renderWithEngine} from "./dsl-build.mjs";
import {buildDaemonModel, traceNodes} from "./dsl-daemons.mjs";
import {deriveSamc, historicalAuthorities} from "./dsl-samc-derive.mjs";

export async function renderDaemon(file) {
  return renderDaemonModel(JSON.parse(readFileSync(file, "utf8")));
}

export async function renderDaemonModel(input) {
  const model = buildDaemonModel(input);
  const kind = model.kind;
  const template = readFileSync(join("recipes", `${kind}-xml`, "template.tpl"), "utf8");
  const rendered = await renderWithEngine(template, model, {}, "template.tpl", "xml");
  const valid = XMLValidator.validate(rendered.text);
  if (valid !== true) throw new Error(`XML line ${valid.err.line}: ${valid.err.msg}`);
  return {text: rendered.text, trace: traceNodes(model, rendered.trace), model};
}

export function firstDifference(actual, expected) {
  const left = actual.split("\n");
  const right = expected.split("\n");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) return i + 1;
  }
  return 0;
}

export async function checkDerived(paths, applicationId, decl, target, numberingFile = target) {
  const rendered = await renderDaemonModel(deriveSamc(paths, applicationId, decl, numberingFile, true));
  const explained = new Set(rendered.model.authorities.map((row) => `${row.channelId}|${row.program_id}|${row.activity}`));
  const grantWithoutUse = historicalAuthorities(target, applicationId)
    .filter((row) => !explained.has(row.key))
    .map((row) => ({nr: row.nr, key: row.key, node: `samc/${applicationId}/auth/${row.nr}`}));
  const line = firstDifference(rendered.text, readFileSync(target, "utf8"));
  if (!line) return {line: 0, grantWithoutUse};
  const node = rendered.trace[line - 1]?.node;
  const row = [...rendered.model.channels, ...rendered.model.authorities].find((entry) => entry["@id"] === node);
  return {line, node, source: row?.source ?? [], grantWithoutUse};
}

async function main(args) {
  if (["derive", "check"].includes(args[0]) && args.slice(1).includes("--app")) {
    const [command, ...rest] = args;
    const paths = [];
    const options = {};
    for (let i = 0; i < rest.length; i++) {
      if (["--app", "--decl", "--out", "--against", "--numbering"].includes(rest[i])) options[rest[i++].slice(2)] = rest[i];
      else paths.push(rest[i]);
    }
    if (!paths.length || !options.app) throw new Error("derive/check needs ABAP folders and --app");
    const decl = options.decl ? JSON.parse(readFileSync(options.decl, "utf8")) : {};
    if (command === "derive") {
      const model = deriveSamc(paths, options.app, decl, options.numbering ?? options.against);
      const value = `${JSON.stringify(model, null, 2)}\n`;
      if (options.out) writeFileSync(options.out, value);
      else process.stdout.write(value);
      return 0;
    }
    if (!options.against) throw new Error("check needs --against <file.samc.xml>");
    const log = console.log;
    let result;
    try { console.log = (...items) => console.error(...items); result = await checkDerived(paths, options.app, decl, options.against, options.numbering ?? options.against); }
    finally { console.log = log; }
    for (const grant of result.grantWithoutUse) console.error(`${options.against}: grant without use at ${grant.node} (${grant.key})`);
    if (result.line) {
      console.error(`${options.against}: drift at line ${result.line}, node ${result.node ?? "unknown"}${result.source.length ? `, source ${result.source.map((p) => `${p.file}:${p.line}`).join(", ")}` : ""}`);
      return 1;
    }
    console.log(`ok ${options.against}`);
    return 0;
  }
  const [command, file, ...rest] = args;
  if (!file || !["render", "check"].includes(command)) throw new Error("usage: dsl-samc.mjs render <model.json> [--out <file>] | check <model.json> <target.xml> (SAMC target: abapGit's own serialisation captured on A4H, BOM included)");
  const log = console.log;
  let rendered;
  try {
    console.log = (...items) => console.error(...items);
    rendered = await renderDaemon(file);
  } finally {
    console.log = log;
  }
  if (command === "check") {
    if (rest.length !== 1) throw new Error("check needs a target XML file");
    const line = firstDifference(rendered.text, readFileSync(rest[0], "utf8"));
    if (line) { console.error(`${rest[0]}: drift at line ${line}`); return 1; }
    console.log(`ok ${rest[0]}`);
  } else if (rest.length === 0) process.stdout.write(rendered.text);
  else if (rest.length === 2 && rest[0] === "--out") {
    writeFileSync(rest[1], rendered.text);
    const old = {generator: "dsl-daemons", template: "template.tpl", model: file, lines: rendered.trace};
    const pair = convertTrace(old, {[basename(rest[1])]: rendered.text}, {model: rendered.model, recipe: `recipes/${rendered.model.kind}-xml/template.tpl`});
    writeFileSync(`${rest[1]}.trace.json`, legacyTrace() ? `${JSON.stringify({...old,lines:legacyEntries(old.lines)}, null, 2)}\n` : pair.trace);
    if (!legacyTrace()) writeFileSync(`${rest[1]}.trace.meta.json`, pair.meta);
  } else throw new Error("render accepts only --out <file>");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(traceArgs(process.argv.slice(2))).then((code) => { process.exitCode = code; }, (error) => { console.error(error.message); process.exitCode = 2; });
}
