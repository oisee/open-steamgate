#!/usr/bin/env node
// Generated regions: model + template -> region, regenerate and compare.
//
//   node tools/dsl-regions.mjs check <path>... [--trace] [--ddic <folder>]...
//        every region in the *.abap files under the paths, regenerated and
//        compared byte for byte: one line per region, ok / DRIFT / REFUSED;
//        exit 1 on any drift or refusal, 2 on a malformed marker
//   node tools/dsl-regions.mjs write <path>... [--trace] [--ddic <folder>]...
//        the same, and the drifted regions (only they) rewritten in place
//
// A region names its recipe and the method its model is read from, in ABAP
// comments, so nothing outside the file says which region is which:
//
//     " osd:gen r1-lookup-enrich from=before begin
//     ...generated, indented like the begin marker...
//     " osd:gen r1-lookup-enrich end
//
// <recipe> is a folder under recipes/ with a template.tpl; RECIPES below says
// how its model is built. The text is rendered by ZCL_OSD_TPL (the transpiled
// class in output/, so `npm run transpile` first), with its line trace.
import {createRequire} from "node:module";
import {readFileSync, readdirSync, statSync, writeFileSync} from "node:fs";
import {basename, dirname, join, relative, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {DEFAULT_DDIC, Refusal} from "./dsl-ddic.mjs";
import {modelR1FromSource, modelR2FromSource, modelR3FromSource} from "./lift.mjs";

const abaplint = createRequire(import.meta.url)("@abaplint/core");
const {Structures, Expressions} = abaplint;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A marker is any comment line starting `" osd:gen`; one that does not have
// the full form is an error rather than a line nobody reads.
const MARKER = /^" osd:gen\b/;
const MARKER_TEXT = '" osd:gen';
const MARKER_FORM = /^" osd:gen ([a-z0-9][a-z0-9-]*)((?: [a-z]+=\S+)*) (begin|end)$/;

export class RegionError extends Error {
  constructor(file, line, detail) {
    super(`${file}:${line}: ${detail}`);
    this.file = file;
    this.line = line;
  }
}

const nameOf = (structure, expression) =>
  structure.getFirstStatement()?.findDirectExpression(expression)?.concatTokens().toLowerCase();

// The method `from` of the class whose implementation holds line `line`,
// found through abaplint's structure, or a RegionError.
function methodOfClassAt(file, source, line, from) {
  const registry = new abaplint.Registry();
  registry.addFile(new abaplint.MemoryFile(basename(file), source));
  registry.parse();
  const abapFile = registry.getObjects().filter((o) => o instanceof abaplint.ABAPObject)
    .flatMap((o) => o.getABAPFiles()).find((f) => f.getFilename() === basename(file));
  const implementation = abapFile?.getStructure()?.findAllStructures(Structures.ClassImplementation)
    .find((s) => s.getFirstToken().getRow() <= line && line <= s.getLastToken().getRow());
  if (!implementation) throw new RegionError(file, line, "the region is not inside a class implementation");
  const className = nameOf(implementation, Expressions.ClassName);
  const method = implementation.findAllStructures(Structures.Method).find((m) => nameOf(m, Expressions.MethodName) === from);
  if (!method) throw new RegionError(file, line, `from=${from}: no method ${from} in class ${className}`);
  return {className, method};
}

// How each recipe's model is built. `model` gets the region and the file it
// is in and returns the model, or throws a Refusal (the recipe says no) or a
// RegionError (the marker is wrong).
export const RECIPES = {
  "r1-lookup-enrich": {
    template: join(ROOT, "recipes/r1-lookup-enrich/template.tpl"),
    params: ["from"],
    model: ({file, source, region, ddic}) => {
      methodOfClassAt(file, source, region.begin, region.params.from);
      return modelR1FromSource(basename(file), source, region.params.from, ddic);
    },
  },
  "r2-select-table-per-row": {
    template: join(ROOT, "recipes/r2-select-table-per-row/template.tpl"),
    params: ["from"],
    model: ({file, source, region, ddic}) => {
      methodOfClassAt(file, source, region.begin, region.params.from);
      return modelR2FromSource(basename(file), source, region.params.from, ddic);
    },
  },
  "r3-filter-into-where": {
    template: join(ROOT, "recipes/r3-filter-into-where/template.tpl"),
    params: ["from"],
    model: ({file, source, region, ddic}) => {
      methodOfClassAt(file, source, region.begin, region.params.from);
      return modelR3FromSource(basename(file), source, region.params.from, ddic);
    },
  },
};

// The lines of a file as bytes: each line's text (decoded for reading only),
// its own separator ("\r\n", "\n" or "" at the end) and its byte offsets, so
// a file with mixed line endings is read line by line and a rewrite touches
// no byte outside what it replaces.
function splitLines(bytes) {
  const lines = [];
  let start = 0;
  while (start <= bytes.length) {
    const nl = bytes.indexOf(0x0a, start);
    const stop = nl < 0 ? bytes.length : nl;
    const cr = stop > start && bytes[stop - 1] === 0x0d;
    const textEnd = cr ? stop - 1 : stop;
    lines.push({text: bytes.subarray(start, textEnd).toString("utf8"), sep: nl < 0 ? "" : cr ? "\r\n" : "\n",
      start, end: nl < 0 ? bytes.length : nl + 1});
    if (nl < 0) break;
    start = nl + 1;
  }
  return lines;
}

// Every region of one source (a string or the file's bytes), in order.
// Unbalanced, nested and malformed markers, a marker that does not stand on a
// line of its own, an unknown recipe or a missing parameter are RegionErrors.
export function parseRegions(source, file = "<source>") {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source, "utf8");
  const lines = splitLines(bytes);
  const regions = [];
  let open, markers = 0;
  lines.forEach(({text}, index) => {
    const line = index + 1;
    const trimmed = text.trim();
    if (!MARKER.test(trimmed)) {
      if (text.includes(MARKER_TEXT)) throw new RegionError(file, line, `an osd:gen marker must stand on a line of its own: '${trimmed}'`);
      return;
    }
    markers++;
    const form = MARKER_FORM.exec(trimmed);
    if (!form) throw new RegionError(file, line, `malformed marker: expected '" osd:gen <recipe> [key=value]... begin|end', found '${trimmed}'`);
    const [, recipe, rawParams, kind] = form;
    const params = Object.fromEntries(rawParams.trim().split(" ").filter(Boolean).map((p) => p.split(/=(.*)/s).slice(0, 2)));
    if (kind === "begin") {
      if (open) throw new RegionError(file, line, `nested region: begin inside the ${open.recipe} region begun at line ${open.begin}`);
      const entry = RECIPES[recipe];
      if (!entry) throw new RegionError(file, line, `unknown recipe ${recipe} (known: ${Object.keys(RECIPES).join(", ")})`);
      for (const key of entry.params) {
        if (!params[key]) throw new RegionError(file, line, `recipe ${recipe} needs ${key}=<...> on its begin marker`);
      }
      for (const key of Object.keys(params)) {
        if (!entry.params.includes(key)) throw new RegionError(file, line, `recipe ${recipe} takes no ${key}=`);
      }
      open = {recipe, params, begin: line, indent: /^ */.exec(text)[0], sep: lines[index].sep};
    } else {
      if (!open) throw new RegionError(file, line, `unbalanced marker: end of ${recipe} without a begin`);
      if (Object.keys(params).length) throw new RegionError(file, line, "an end marker takes no parameters");
      if (recipe !== open.recipe) throw new RegionError(file, line, `unbalanced marker: end of ${recipe} closes the ${open.recipe} region begun at line ${open.begin}`);
      const body = lines.slice(open.begin, index);
      regions.push({...open, end: line, body: body.map((l) => l.text), seps: body.map((l) => l.sep), bodyStart: lines[open.begin].start, bodyEnd: lines[index].start});
      open = undefined;
    }
  });
  if (open) throw new RegionError(file, open.begin, `unbalanced marker: ${open.recipe} begin has no end`);
  // Every marker the text holds was read as one. A line split the parser got
  // wrong would otherwise find no region and call the file clean.
  const inText = bytes.toString("latin1").split(MARKER_TEXT).length - 1;
  if (inText !== markers) throw new RegionError(file, 1, `${inText} osd:gen marker(s) in the text, ${markers} read as marker lines`);
  return {regions, lines: lines.map((l) => l.text), bytes};
}

// The region's text with the begin marker's indentation taken off, as the
// template renders it (one trailing newline).
export function regionText(region) {
  return region.body.map((l) => l.startsWith(region.indent) ? l.slice(region.indent.length) : l.trimStart()).join("\n") + "\n";
}

// The region of `source` whose model is read from method `from`.
export function region(source, from) {
  const found = parseRegions(source).regions.find((r) => r.params.from === from);
  if (!found) throw new Error(`no region from=${from}`);
  return regionText(found);
}

let abap;
async function runtime() {
  if (!abap) {
    await import("../test/start.mjs");
    await import("../output/zcl_osd_tpl.clas.mjs");
    await import("../output/zcl_ajson.clas.mjs");
    abap = globalThis.abap;
  }
  return abap;
}

export async function render(model, template) {
  const abap = await runtime();
  const box = (value) => new abap.types.String().set(value);
  const data = await abap.Classes.ZCL_AJSON.parse({iv_json: box(JSON.stringify(model))});
  const result = await abap.Classes.ZCL_OSD_TPL.render({iv_template: box(readFileSync(template, "utf8")), ii_data: data});
  return {
    text: (await abap.Classes.ZCL_OSD_TPL.to_string({is_result: result})).get(),
    trace: result.get().trace.array().map((t) => ({
      line: t.get().line.get(), template_line: t.get().template_line.get(), path: t.get().path.get()})),
  };
}

function abapFiles(paths) {
  return paths.flatMap((path) => {
    if (statSync(path).isFile()) return [path];
    return readdirSync(path, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((e) => e.name === "node_modules" || e.name === ".git" ? []
        : e.isDirectory() ? abapFiles([join(path, e.name)]) : /\.abap$/i.test(e.name) ? [join(path, e.name)] : []);
  });
}

// Check (and with write: true, repair) every region under `paths`. Returns
// one result per region, and per malformed file one error; never throws for
// what it finds in a file.
export async function checkRegions(paths, {write = false, ddic = DEFAULT_DDIC.map((d) => resolve(ROOT, d))} = {}) {
  const results = [];
  for (const file of abapFiles(paths)) {
    const bytes = readFileSync(file);
    const source = bytes.toString("utf8");
    let parsed;
    try {
      parsed = parseRegions(bytes, file);
    } catch (e) {
      if (!(e instanceof RegionError)) throw e;
      results.push({status: "ERROR", file, line: e.line, message: e.message});
      continue;
    }
    const replace = [];
    for (const r of parsed.regions) {
      const base = {file, line: r.begin, recipe: r.recipe, params: r.params};
      const recipe = RECIPES[r.recipe];
      let model;
      try {
        model = recipe.model({file, source, region: r, ddic});
      } catch (e) {
        if (e instanceof Refusal) { results.push({...base, status: "REFUSED", message: e.message}); continue; }
        if (e instanceof RegionError) { results.push({...base, status: "ERROR", message: e.message}); continue; }
        throw e;
      }
      const {text, trace} = await render(model, recipe.template);
      const expected = text.replace(/\n$/, "").split("\n").map((l) => l === "" ? "" : r.indent + l);
      // the canonical body is the rendered lines, each ended like the begin
      // marker line: a line of the right text with another ending is drift
      // too, so check and write agree byte for byte
      const drift = expected.findIndex((l, i) => l !== r.body[i] || (i < r.body.length && r.seps[i] !== r.sep));
      const at = drift >= 0 ? drift : expected.length < r.body.length ? expected.length : -1;
      const result = {...base, status: at < 0 ? "ok" : "DRIFT", trace, template: recipe.template, expected};
      if (at >= 0) {
        result.driftLine = r.begin + 1 + at;
        result.wanted = expected[at];
        result.found = at < r.body.length ? r.body[at] : parsed.lines[r.end - 1];
        if (result.wanted === result.found && at < r.body.length) result.ending = {found: r.seps[at], wanted: r.sep};
        replace.push(r);
      }
      results.push(result);
    }
    if (write && replace.length) {
      // only the bytes of the drifted regions' bodies are replaced; every
      // byte around them is copied as read, whatever its encoding
      const parts = [];
      let at = 0;
      for (const r of replace) {
        const result = results.find((x) => x.file === file && x.line === r.begin);
        parts.push(parsed.bytes.subarray(at, r.bodyStart),
          Buffer.from(result.expected.map((l) => l + r.sep).join(""), "utf8"));
        at = r.bodyEnd;
        result.written = {from: r.body.length, to: result.expected.length};
      }
      parts.push(parsed.bytes.subarray(at));
      writeFileSync(file, Buffer.concat(parts));
    }
  }
  return results;
}

const quote = (s) => s === undefined ? "(none)" : JSON.stringify(s);
export function formatResult(result, {trace = false} = {}) {
  const where = `${result.file}:${result.line}`;
  const what = result.recipe ? ` ${result.recipe}${Object.entries(result.params).map(([k, v]) => ` ${k}=${v}`).join("")}` : "";
  const out = [];
  if (result.status === "ok") out.push(`ok      ${where}${what}`);
  else if (result.status === "DRIFT") {
    const ending = (sep) => sep === "\r\n" ? "CRLF" : "LF";
    out.push(result.ending
      ? `DRIFT   ${where}${what}: line ending of line ${result.driftLine} is ${ending(result.ending.found)}, the region's begin marker line ends in ${ending(result.ending.wanted)}`
      : `DRIFT   ${where}${what}: line ${result.driftLine} is ${quote(result.found)}, the recipe renders ${quote(result.wanted)}`);
    if (result.written) out.push(`  written: ${result.written.from} lines replaced by ${result.written.to}`);
  } else if (result.status === "REFUSED") out.push(`REFUSED ${where}${what}: ${result.message}`);
  else out.push(`ERROR   ${result.message}`);
  if (trace && result.trace) {
    const template = relative(ROOT, result.template);
    for (const t of result.trace) out.push(`  ${result.line + t.line} <- ${template}:${t.template_line} ${t.path}`);
  }
  return out.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  const paths = [], ddic = [];
  let trace = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--trace") trace = true;
    else if (args[i] === "--ddic") ddic.push(args[++i]);
    else paths.push(args[i]);
  }
  if (!["check", "write"].includes(command) || !paths.length) {
    console.error("usage: node tools/dsl-regions.mjs check|write <path>... [--trace] [--ddic <folder>]...");
    process.exit(2);
  }
  const results = await checkRegions(paths, {write: command === "write", ...(ddic.length ? {ddic} : {})});
  for (const result of results) console.log(formatResult(result, {trace}));
  const count = (s) => results.filter((r) => r.status === s).length;
  const drifted = count("DRIFT");
  console.log(`${results.length} region(s): ${count("ok")} ok, ${drifted} drift${command === "write" && drifted ? " (written)" : ""}, ${count("REFUSED")} refused, ${count("ERROR")} error`);
  process.exit(count("ERROR") ? 2 : count("REFUSED") || (drifted && command === "check") ? 1 : 0);
}
