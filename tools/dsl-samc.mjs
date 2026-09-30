#!/usr/bin/env node
// Render or compare a whole SAMC/SAPC abapGit file from its L1 JSON model.
import {readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {XMLValidator} from "fast-xml-parser";
import {renderWithEngine} from "./dsl-build.mjs";
import {buildDaemonModel, traceNodes} from "./dsl-daemons.mjs";

export async function renderDaemon(file) {
  const model = buildDaemonModel(JSON.parse(readFileSync(file, "utf8")));
  const kind = model.channels ? "samc" : "sapc";
  const template = readFileSync(join("recipes", `${kind}-xml`, "template.tpl"), "utf8");
  const rendered = await renderWithEngine(template, model, {}, "template.tpl", "html");
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

async function main(args) {
  const [command, file, ...rest] = args;
  if (!file || !["render", "check"].includes(command)) throw new Error("usage: dsl-samc.mjs render <model.json> [--out <file>] | check <model.json> <target.xml>");
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
    writeFileSync(`${rest[1]}.trace.json`, `${JSON.stringify({generator: "dsl-daemons", template: "template.tpl", model: file, lines: rendered.trace}, null, 2)}\n`);
  } else throw new Error("render accepts only --out <file>");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.error(error.message); process.exitCode = 2; });
}
