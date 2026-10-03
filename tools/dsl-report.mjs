#!/usr/bin/env node
// Render a report selection model through the L1 recipes.
import {convertTrace, legacyTrace, legacyEntries, traceArgs} from "./dsl-trace.mjs";
import {readFileSync, readdirSync, writeFileSync} from "node:fs";
import {basename, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {reportModel} from "./dsl-report-model.mjs";
import {renderWithEngine} from "./dsl-build.mjs";
import {traceNodes} from "./dsl-daemons.mjs";
export {reportModel} from "./dsl-report-model.mjs";

export async function renderReport(kind, report, {out} = {}) {
  const recipes = {help: "report-help", manpage: "report-manpage", args: "report-args-go"};
  const recipe = recipes[kind];
  if (!recipe) throw new Error(`unknown report rendering ${kind}`);
  const model = await reportModel(report);
  const template = readFileSync(join("recipes", recipe, "template.tpl"), "utf8");
  const rendered = await renderWithEngine(template, model);
  const trace = traceNodes(model, rendered.trace).map((entry) => {
    if (kind === "args") {
      const sources = [model.elements, model.elements.filter((item) => item.positional),
        model.elements.filter((item) => item.checkbox), model.elements.filter((item) => item.source_kind === "select-option")];
      return {...entry, nodes: sources[entry.line - 1].map((item) => item["@id"])};
    }
    if (entry.node.startsWith(`report/${model.name.toUpperCase()}/radio/`)) {
      const group = entry.node.split("/").at(-1);
      return {...entry, nodes: model.elements.filter((item) => item.radio_group === group).map((item) => item["@id"])};
    }
    return entry;
  });
  if (out) {
    writeFileSync(out, rendered.text);
    const source = report.endsWith(".prog.abap") ? report : join(report, readdirSync(report).find(file => file.endsWith(".prog.abap")));
    const pair = convertTrace(trace, {[basename(out)]: rendered.text}, {model, generator: "dsl-report", source, recipe: `recipes/${recipe}/template.tpl`});
    writeFileSync(`${out}.trace.json`, legacyTrace() ? `${JSON.stringify(legacyEntries(trace), null, 2)}\n` : pair.trace);
    if (!legacyTrace()) writeFileSync(`${out}.trace.meta.json`, pair.meta);
  }
  return {model, text: rendered.text, trace};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, report, ...rest] = traceArgs(process.argv.slice(2));
  if (!report || !["model", "help", "manpage", "args"].includes(command)) {
    throw new Error("usage: node tools/dsl-report.mjs model|help|manpage|args <report> [--out <file>]");
  }
  const out = rest[0] === "--out" ? rest[1] : undefined;
  if (command === "model") {
    const model = await reportModel(report);
    const json = `${JSON.stringify(model, null, 2)}\n`;
    if (out) writeFileSync(out, json); else process.stdout.write(json);
  } else {
    const result = await renderReport(command, report, {out});
    if (!out) process.stdout.write(result.text);
  }
}
