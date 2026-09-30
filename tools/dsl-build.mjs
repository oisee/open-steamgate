#!/usr/bin/env node
// `dsl build`: a recipe is a build unit. Its template and partials are
// compiled with the grammar of ZCL_OSD_TPL (tag scanner reimplemented here,
// see compileTemplate), linked (partials resolved, every tag name checked
// against the recipe's model schema in its section context) and rendered once
// per sample input through the engine itself, with the profile run on the
// result. Every error carries `<recipe>/<file>:<line>`. docs/dsl-l1.md,
// "Recipes as build units".
//
//   node tools/dsl-build.mjs [--check] [--static] [--dir <recipes>] [<recipe>...]
//   node tools/dsl-build.mjs schema <recipe> [--write] [--dir <recipes>]
import {existsSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {modelR1} from "./lift.mjs";
import {abapModel, constantsModel, methodTableModel} from "./dsl-abap.mjs";

// ---------------------------------------------------------------- scanner --

// The tag grammar of ZCL_OSD_TPL (tokenize, match_sections, apply_filters,
// the partial argument rule). Reimplemented rather than called: the engine's
// parse is private and runs only as part of a render over data, and a build
// step that needs the transpiled runtime to read a template's syntax cannot
// run before the transpile. test/dsl-build.mjs holds the two to each other:
// every refusal case is rendered through the engine and must be refused here
// with the same line and text, every accepted template must render.
const WS = " \t\n\r";
const trim = (text) => {
  let from = 0, to = text.length;
  while (from < to && WS.includes(text[from])) from++;
  while (to > from && WS.includes(text[to - 1])) to--;
  return text.slice(from, to);
};
const hasSpace = (text) => [...text].some((char) => WS.includes(char));
const splitWords = (text) => text.replaceAll("\t", " ").split(" ").filter(Boolean);

class TemplateError extends Error {
  constructor(line, message) {
    super(message);
    this.line = line;
  }
}

function lineStarts(source) {
  const starts = [0];
  for (let i = source.indexOf("\n"); i >= 0; i = source.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

function lineOf(starts, offset) {
  let line = 1;
  for (let low = 0, high = starts.length - 1; low <= high;) {
    const mid = (low + high) >> 1;
    if (starts[mid] > offset) high = mid - 1;
    else { line = mid + 1; low = mid + 1; }
  }
  return line;
}

function tokenize(source, starts) {
  const tokens = [];
  let pos = 0;
  while (pos < source.length) {
    const open = source.indexOf("{{", pos);
    if (open < 0) break;
    const line = lineOf(starts, open);
    const triple = open + 2 < source.length && source.slice(open, open + 3) === "{{{";
    const close = source.indexOf(triple ? "}}}" : "}}", open);
    if (close < 0) throw new TemplateError(line, "tag not closed");
    const token = {kind: "", name: "", line, open};
    let tag;
    if (triple) {
      token.kind = "&";
      tag = source.slice(open + 3, close);
      pos = close + 3;
    } else {
      tag = source.slice(open + 2, close);
      pos = close + 2;
    }
    tag = trim(tag);
    if (!triple && tag !== "") {
      if ("#^/!>&".includes(tag[0])) {
        token.kind = tag[0];
        tag = trim(tag.slice(1));
      } else token.kind = "V";
    }
    token.name = tag;
    if (token.kind !== "!") {
      let base = tag;
      if (token.kind === "V" || token.kind === "&") {
        const bar = tag.indexOf("|");
        if (bar >= 0) base = trim(tag.slice(0, bar));
      } else if (token.kind === ">") base = splitWords(tag)[0] ?? "";
      if (base === "" || hasSpace(base)) throw new TemplateError(line, `invalid tag name "${tag}"`);
      token.base = base;
    }
    tokens.push(token);
  }
  return tokens;
}

function matchSections(tokens) {
  const open = [];
  tokens.forEach((token, index) => {
    if (token.kind === "#" || token.kind === "^") open.push(index);
    else if (token.kind === "/") {
      if (!open.length) throw new TemplateError(token.line, `close tag ${token.name} without open`);
      const opener = tokens[open.pop()];
      if (opener.name !== token.name) throw new TemplateError(token.line, `close tag ${token.name} for ${opener.name}`);
      opener.close = index;
    }
  });
  if (open.length) throw new TemplateError(tokens[open[0]].line, `section ${tokens[open[0]].name} not closed`);
}

// The filters of a value tag, or the first thing wrong with them.
function filterProblem(filters) {
  for (const filter of filters) {
    const words = splitWords(filter);
    const [name, arg] = words;
    if (name === "lower" || name === "upper") {
      if (words.length !== 1) return `filter ${name} takes no argument`;
    } else if (name === "pad") {
      if (words.length !== 2 || !/^[0-9]+$/.test(arg) || arg.length > 3 || +arg < 1 || +arg > 255) return "filter pad needs one width from 1 to 255";
    } else if (name === "literal") {
      if (words.length !== 1) return "filter literal takes no argument";
    } else return `unknown filter "${name ?? ""}"`;
  }
  return undefined;
}

function splitFilters(token) {
  const bar = token.name.indexOf("|");
  if (bar < 0) return {name: token.name, filters: []};
  const rest = token.name.slice(bar + 1);
  // ABAP's SPLIT of an empty string gives no rows, JavaScript's gives one
  return {name: trim(token.name.slice(0, bar)), filters: rest === "" ? [] : rest.split("|")};
}

// Parse one template: {tokens} or {errors}. The engine stops at the first
// scanner error; the checks that follow (filters, partial arguments) are
// collected in source order.
export function compileTemplate(source) {
  const starts = lineStarts(source);
  let tokens;
  try {
    tokens = tokenize(source, starts);
    matchSections(tokens);
  } catch (error) {
    if (error instanceof TemplateError) return {tokens: [], errors: [{line: error.line, message: error.message}]};
    throw error;
  }
  const errors = [];
  for (const token of tokens) {
    if (token.kind === "V" || token.kind === "&") {
      const {name, filters} = splitFilters(token);
      token.value = name;
      token.filters = filters;
      const problem = filterProblem(filters);
      if (problem) errors.push({line: token.line, message: problem});
    } else if (token.kind === ">") {
      token.args = [];
      for (const word of splitWords(token.name).slice(1)) {
        const eq = word.indexOf("=");
        if (eq <= 0) errors.push({line: token.line, message: `partial argument "${word}" is not name=path`});
        else token.args.push({word, name: word.slice(0, eq), path: word.slice(eq + 1)});
      }
      token.partial = token.base;
    }
  }
  return {tokens, errors};
}

// ----------------------------------------------------------------- schema --
// "scalar" | "null" (only ever seen null) | {object: {field: node}} | {array: node}

const isObject = (node) => typeof node === "object" && node !== null && "object" in node;
const isArray = (node) => typeof node === "object" && node !== null && "array" in node;

export function shapeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return {array: value.map(shapeOf).reduce((a, b) => mergeShapes(a, b, "[]"), "null")};
  if (typeof value === "object") {
    const fields = {};
    for (const key of Object.keys(value).sort()) fields[key] = shapeOf(value[key]);
    return {object: fields};
  }
  return "scalar";
}

export function mergeShapes(a, b, where = "") {
  if (a === "null") return b;
  if (b === "null") return a;
  if (a === "scalar" && b === "scalar") return a;
  if (isObject(a) && isObject(b)) {
    const fields = {};
    for (const key of [...new Set([...Object.keys(a.object), ...Object.keys(b.object)])].sort()) {
      fields[key] = key in a.object && key in b.object ? mergeShapes(a.object[key], b.object[key], `${where}.${key}`)
        : (a.object[key] ?? b.object[key]);
    }
    return {object: fields};
  }
  if (isArray(a) && isArray(b)) return {array: mergeShapes(a.array, b.array, `${where}[]`)};
  throw new Error(`the model has two shapes at ${where || "the root"}`);
}

const kindOf = (node) => isObject(node) ? "an object" : isArray(node) ? "an array" : node === "null" ? "null" : "a scalar";

// Differences between the committed schema and the shape the provider
// really produces, as messages.
export function schemaDrift(schema, derived, where = "") {
  const problems = [];
  const name = where || "the model root";
  if (isObject(schema) && isObject(derived)) {
    for (const key of Object.keys(derived.object)) {
      if (!(key in schema.object)) problems.push(`the model has ${where ? `${where}.` : ""}${key}, the schema lacks it`);
      else problems.push(...schemaDrift(schema.object[key], derived.object[key], where ? `${where}.${key}` : key));
    }
    for (const key of Object.keys(schema.object)) {
      if (!(key in derived.object)) problems.push(`the schema has ${where ? `${where}.` : ""}${key}, the model never produces it`);
    }
  } else if (isArray(schema) && isArray(derived)) {
    problems.push(...schemaDrift(schema.array, derived.array, `${where}[]`));
  } else if (schema !== derived) {
    problems.push(`${name} is ${kindOf(schema)} in the schema and ${kindOf(derived)} in the model`);
  }
  return problems;
}

// ------------------------------------------------------------------- link --
// A frame is one level of the context stack, as the engine's: a data
// context (a schema node, `loop` when it is one item of an array) or an
// overlay of partial arguments.

const META = new Set(["@index", "@first", "@last"]);

function fieldOf(node, key) {
  return isObject(node) && Object.hasOwn(node.object, key) ? node.object[key] : undefined;
}

function nearestData(frames) {
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i].node !== undefined) return frames[i];
  return undefined;
}

// Returns {node, label, meta}; or {failed: <label of the context that lacks it>}.
function resolveName(name, frames) {
  if (name === ".") {
    const frame = nearestData(frames);
    return {node: frame.node, label: frame.label};
  }
  if (META.has(name)) {
    return frames.some((frame) => frame.loop) ? {meta: true} : {failed: "a section over an array"};
  }
  const [first, ...rest] = name.split(".");
  let node, label;
  for (let i = frames.length - 1; i >= 0 && node === undefined; i--) {
    const frame = frames[i];
    if (frame.aliases?.has(first)) {
      node = frame.aliases.get(first);
      label = first;
    } else if (frame.node !== undefined && fieldOf(frame.node, first) !== undefined) {
      node = fieldOf(frame.node, first);
      label = frame.label ? `${frame.label}.${first}` : first;
    }
  }
  if (node === undefined) return {failed: nearestData(frames).label};
  for (const segment of rest) {
    const next = fieldOf(node, segment);
    if (next === undefined) return {failed: label};
    node = next;
    label = `${label}.${segment}`;
  }
  return {node, label};
}

const where = (label) => label || "the model root";

// Frames for the body of a section over `node`.
function sectionFrame(node, label) {
  return isArray(node) ? {node: node.array, label: `${label}[]`, loop: true} : {node, label};
}

function linkTokens(unit, tokens, from, to, frames, context, report) {
  for (let i = from; i < to; i++) {
    const token = tokens[i];
    const at = (message) => report(unit, token.line, message, context);
    const check = (name) => {
      const found = resolveName(name, frames);
      if (found.failed !== undefined) {
        at(META.has(name) ? `{{${name}}} is not inside ${found.failed}` : `{{${name}}} is not a field of ${where(found.failed)}`);
        return undefined;
      }
      return found;
    };
    if (token.kind === "V" || token.kind === "&") {
      const found = check(token.value);
      if (found && token.filters.some((filter) => splitWords(filter)[0] === "literal") && !found.meta) {
        const parent = token.value.includes(".") ? resolveName(token.value.split(".").slice(0, -1).join("."), frames) : undefined;
        const last = token.value.split(".").at(-1);
        const holder = parent ? parent.node : frames.map((frame) => frame.node).reverse()
          .find((node) => fieldOf(node, last) !== undefined);
        if (token.value !== "." && fieldOf(holder, `${last}@type`) === undefined) at(`literal needs ${token.value}@type, which the model does not have`);
      }
    } else if (token.kind === "#" || token.kind === "^") {
      const found = check(token.name);
      const inner = token.kind === "#" && found && !found.meta ? [...frames, sectionFrame(found.node, found.label)] : frames;
      linkTokens(unit, tokens, i + 1, token.close, inner, context, report);
      i = token.close;
    } else if (token.kind === ">") {
      linkPartial(unit, token, frames, context, report);
    }
  }
}

function linkPartial(unit, token, frames, context, report) {
  const at = (message) => report(unit, token.line, message, context);
  const partial = unit.partials.get(token.partial);
  if (!partial) return at(`partial ${token.partial} is not declared in recipe.json`);
  if (partial.error) return; // reported once, when it was read
  if (context.chain.includes(token.partial)) {
    return at(`partials call each other in a cycle: ${[...context.chain, token.partial].join(" -> ")}`);
  }
  const aliases = new Map();
  for (const arg of token.args) {
    const found = resolveName(arg.path, frames);
    if (found.failed !== undefined || found.meta) at(`partial argument "${arg.word}" not found`);
    else aliases.set(arg.name, found.node);
  }
  const inner = aliases.size ? [...frames, {aliases}] : frames;
  linkTokens(partial, partial.tokens, 0, partial.tokens.length, inner,
    {chain: [...context.chain, token.partial], via: `${unit.file}:${token.line}`}, report);
}

// -------------------------------------------------------------- providers --
// What builds each recipe's model, and the sample input(s) it is checked on.
// A sample is [label, model]; the schema is the union of their shapes.

const R1_DEMO = "src/lift/zcl_osd_lift_r1_demo.clas.abap";

export const PROVIDERS = {
  "lift-r1": {
    samples: () => ["before", "before_mixed"].map((method) => [method, modelR1(R1_DEMO, method)]),
  },
  "abap-methods": {
    samples: (recipeDir) => [["sample", methodTableModel(abapModel([join(recipeDir, "sample")], {ddic: []}), "zcl_sample_methods")]],
  },
  "abap-constants": {
    samples: (recipeDir) => [["sample", constantsModel(abapModel([join(recipeDir, "sample")], {ddic: []}), "zcl_sample_constants")]],
  },
};

export const PROFILES = ["abap", "sqlscript", "text"];

// ----------------------------------------------------------------- engine --

let engineBoot;
async function engine() {
  engineBoot ??= (async () => {
    // the runtime boot talks on stdout; a build's output is its own
    const log = console.log;
    console.log = (...items) => console.error(...items);
    try {
      await import("../test/start.mjs");
      for (const name of ["zcl_osd_tpl", "zcl_ajson", "zcl_osd_dsl_profile"]) await import(`../output/${name}.clas.mjs`);
    } finally {
      console.log = log;
    }
    return globalThis.abap;
  })();
  return engineBoot;
}

// Render through ZCL_OSD_TPL: {text, trace: [{line, template, template_line, path}], result, json}.
// An engine refusal is an Error whose message is the engine's text.
export async function renderWithEngine(template, data, partials = {}, name = "main") {
  const abap = await engine();
  const box = (value) => new abap.types.String().set(value);
  const row = () => new abap.types.Structure({name: new abap.types.String(), template: new abap.types.String()});
  const table = new abap.types.Table(row());
  for (const [partial, source] of Object.entries(partials)) {
    const entry = row();
    entry.get().name.set(partial);
    entry.get().template.set(source);
    table.append(entry);
  }
  const json = await abap.Classes.ZCL_AJSON.parse({iv_json: box(JSON.stringify(data))});
  let result;
  try {
    result = await abap.Classes.ZCL_OSD_TPL.render({iv_template: box(template), ii_data: json, it_partials: table, iv_name: box(name)});
  } catch (error) {
    if (error.text?.get) throw new Error(error.text.get(), {cause: error});
    throw error;
  }
  const text = (await abap.Classes.ZCL_OSD_TPL.to_string({is_result: result})).get();
  const trace = result.get().trace.array().map((entry) => ({
    line: entry.get().line.get(), template: entry.get().template.get(),
    template_line: entry.get().template_line.get(), path: entry.get().path.get(),
  }));
  return {text, trace, result, json};
}

async function profileFindings(profile, rendered) {
  const abap = await engine();
  const findings = await abap.Classes.ZCL_OSD_DSL_PROFILE.check({
    iv_profile: new abap.types.String().set(profile), iv_strict: new abap.types.Character(1).set(""),
    is_result: rendered.result, io_model: rendered.json,
  });
  return findings.array().map((finding) => Object.fromEntries(Object.entries(finding.get()).map(([key, value]) => [key, value.get()])));
}

// ------------------------------------------------------------------ build --

function readJson(path, problems, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    problems.push({file: label, message: error.code === "ENOENT" ? "file not found" : `not valid JSON: ${error.message}`});
    return undefined;
  }
}

export function recipeNames(dir = "recipes") {
  return readdirSync(dir, {withFileTypes: true}).filter((entry) => entry.isDirectory()
    && existsSync(join(dir, entry.name, "recipe.json"))).map((entry) => entry.name).sort();
}

// Everything short of rendering: the recipe read, compiled and linked.
function load(dir, name) {
  const errors = [];
  const warnings = [];
  const recipeDir = join(dir, name);
  const unit = {file: "recipe.json", partials: new Map(), tokens: []};
  const fail = (file, message, line = 0) => errors.push({recipe: name, file, line, message});
  const manifest = readJson(join(recipeDir, "recipe.json"), errors, "recipe.json");
  if (errors.length) return {name, recipeDir, errors: errors.map((e) => ({recipe: name, file: e.file, line: 0, message: e.message})), warnings};
  for (const key of ["template", "model", "profile", "schema"]) {
    if (typeof manifest[key] !== "string") fail("recipe.json", `"${key}" is missing`);
  }
  if (manifest.partials !== undefined && (typeof manifest.partials !== "object" || manifest.partials === null || Array.isArray(manifest.partials))) {
    fail("recipe.json", `"partials" must map a name to a file`);
  }
  if (errors.length) return {name, recipeDir, errors, warnings};
  if (!PROVIDERS[manifest.model]) fail("recipe.json", `model provider "${manifest.model}" is unknown (${Object.keys(PROVIDERS).join(", ")})`);
  if (!PROFILES.includes(manifest.profile)) fail("recipe.json", `profile "${manifest.profile}" is unknown (${PROFILES.join(", ")})`);

  const sources = new Map();
  const compileFile = (file, label) => {
    let source;
    try {
      source = readFileSync(join(recipeDir, file), "utf8");
    } catch {
      fail("recipe.json", `${label} ${file} not found`);
      return undefined;
    }
    const compiled = compileTemplate(source);
    for (const error of compiled.errors) fail(file, error.message, error.line);
    sources.set(file, source);
    return {file, tokens: compiled.tokens, broken: compiled.errors.length > 0};
  };
  const main = compileFile(manifest.template, "template");
  const partials = new Map();
  for (const [partialName, file] of Object.entries(manifest.partials ?? {})) {
    const compiled = compileFile(file, `partial ${partialName}:`);
    partials.set(partialName, compiled ? {...compiled, partials, error: compiled.broken} : {error: true});
  }
  const schema = readJson(join(recipeDir, manifest.schema), errors, manifest.schema);
  if (schema && !isObject(schema)) fail(manifest.schema, "the schema root must be an object");
  for (const e of errors) e.recipe = name;
  return {name, recipeDir, manifest, main, partials, schema, sources, errors, warnings};
}

function link(loaded) {
  const {main, partials, schema, name} = loaded;
  const seen = new Set();
  const report = (unit, line, message, context) => {
    const via = context.note ? ` (${context.note})` : context.via ? ` (partial called at ${context.via})` : "";
    const key = `${unit.file}:${line}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    loaded.errors.push({recipe: name, file: unit.file, line, message: message + via});
  };
  const unit = {file: main.file, partials};
  linkTokens(unit, main.tokens, 0, main.tokens.length, [{node: schema, label: ""}], {chain: []}, report);
  // a partial nothing calls is noise, not a failure
  const called = new Set();
  const walk = (tokens, stack) => tokens.filter((t) => t.kind === ">").forEach((t) => {
    if (called.has(t.partial) || stack.includes(t.partial)) return;
    called.add(t.partial);
    const partial = partials.get(t.partial);
    if (partial?.tokens) walk(partial.tokens, [...stack, t.partial]);
  });
  walk(main.tokens, []);
  // A partial nobody calls is still a build unit: its references must resolve
  // and must not cycle. It has no caller, so its names are checked against the
  // model root (and the message says so); an argument alias it expects would
  // be reported, which is the honest answer for a partial nothing feeds.
  for (const [partialName, partial] of partials) {
    if (called.has(partialName)) continue;
    loaded.warnings.push({recipe: name, file: "recipe.json", line: 0, message: `partial ${partialName} is not called`});
    if (partial.tokens && !partial.error) {
      linkTokens(partial, partial.tokens, 0, partial.tokens.length, [{node: schema, label: ""}],
        {chain: [partialName], note: "partial is never called, checked against the model root"}, report);
    }
  }
}

async function samplesOf(loaded) {
  const provider = PROVIDERS[loaded.manifest.model];
  try {
    return {samples: await provider.samples(loaded.recipeDir)};
  } catch (error) {
    return {error: `model provider ${loaded.manifest.model} failed on its sample: ${error.message}`};
  }
}

export function deriveSchema(samples) {
  return samples.map(([, model]) => shapeOf(model)).reduce((a, b) => mergeShapes(a, b), "null");
}

// Compile, link and, unless `staticOnly`, render every sample through the
// engine and run the profile. `check` adds the schema drift check.
export async function buildRecipe(name, {dir = "recipes", check = false, staticOnly = false} = {}) {
  const loaded = load(dir, name);
  if (!loaded.manifest) return {recipe: name, errors: loaded.errors, warnings: loaded.warnings, samples: 0};
  const {errors, warnings} = loaded;
  if (loaded.main && isObject(loaded.schema)) link(loaded);
  let samples = 0;
  const needSamples = check || (!staticOnly && !errors.length);
  if (needSamples) {
    const {samples: list, error} = await samplesOf(loaded);
    if (error) errors.push({recipe: name, file: "recipe.json", line: 0, message: error});
    else {
      samples = list.length;
      if (check && loaded.schema && isObject(loaded.schema)) {
        let derived;
        try {
          derived = deriveSchema(list);
          for (const message of schemaDrift(loaded.schema, derived)) {
            errors.push({recipe: name, file: loaded.manifest.schema, line: 0, message});
          }
        } catch (e) {
          errors.push({recipe: name, file: "recipe.json", line: 0, message: e.message});
        }
      }
      if (!staticOnly && !errors.length) {
        const fileOf = (template) => template === loaded.manifest.template || template === "main" ? loaded.main.file
          : loaded.manifest.partials?.[template] ?? template;
        const partialSources = Object.fromEntries(Object.keys(loaded.manifest.partials ?? {})
          .map((partial) => [partial, loaded.sources.get(loaded.manifest.partials[partial])]));
        for (const [label, model] of list) {
          let rendered;
          try {
            rendered = await renderWithEngine(loaded.sources.get(loaded.manifest.template), model, partialSources, loaded.manifest.template);
          } catch (error) {
            const match = /^(.+?):(\d+): (.*)$/s.exec(error.message);
            errors.push(match
              ? {recipe: name, file: fileOf(match[1]), line: +match[2], message: `${match[3]} (sample ${label})`}
              : {recipe: name, file: loaded.manifest.template, line: 0, message: `${error.message} (sample ${label})`});
            continue;
          }
          for (const finding of await profileFindings(loaded.manifest.profile, rendered)) {
            const entry = {recipe: name, file: fileOf(rendered.trace[finding.line - 1]?.template ?? "main"),
              line: finding.template_line, message: `${finding.rule}: ${finding.text}, output line ${finding.line}, node ${finding.node || "-"} (sample ${label})`};
            (finding.severity === "E" ? errors : warnings).push(entry);
          }
        }
      }
    }
  }
  return {recipe: name, errors, warnings, samples};
}

export async function buildAll(names, options = {}) {
  const dir = options.dir ?? "recipes";
  const list = names?.length ? names : recipeNames(dir);
  const results = [];
  for (const name of list) {
    if (!existsSync(join(dir, name, "recipe.json"))) {
      results.push({recipe: name, errors: [{recipe: name, file: "recipe.json", line: 0, message: "no such recipe"}], warnings: [], samples: 0});
    } else results.push(await buildRecipe(name, options));
  }
  return results;
}

export const format = (entry) => `${entry.recipe}/${entry.file}${entry.line ? `:${entry.line}` : ""}: ${entry.message}`;

// ------------------------------------------------------------------- main --

async function main(argv) {
  const args = [...argv];
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  const option = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const [, value] = args.splice(i, 2); return value; };
  const dir = option("--dir", "recipes");
  if (args[0] === "schema") {
    args.shift();
    const write = flag("--write");
    const [name] = args;
    if (!name) throw new Error("usage: dsl-build.mjs schema <recipe> [--write] [--dir <recipes>]");
    const loaded = load(dir, name);
    if (!loaded.manifest) throw new Error(loaded.errors.map(format).join("\n"));
    const {samples, error} = await samplesOf(loaded);
    if (error) throw new Error(error);
    const text = `${JSON.stringify(deriveSchema(samples), null, 1)}\n`;
    if (write) writeFileSync(join(dir, name, loaded.manifest.schema), text);
    else process.stdout.write(text);
    return 0;
  }
  const check = flag("--check");
  const staticOnly = flag("--static");
  const results = await buildAll(args, {dir, check, staticOnly});
  for (const result of results) {
    const status = result.errors.length ? "FAIL" : "ok  ";
    const detail = result.errors.length ? `${result.errors.length} error(s)` : staticOnly ? "compiled and linked"
      : `compiled, linked, rendered ${result.samples} sample(s)${check ? ", schema in step" : ""}`;
    console.log(`${status} ${result.recipe}: ${detail}${result.warnings.length ? `, ${result.warnings.length} warning(s)` : ""}`);
    for (const entry of result.errors) console.log(`  ${format(entry)}`);
    for (const entry of result.warnings) console.log(`  warning: ${format(entry)}`);
  }
  return results.some((result) => result.errors.length) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(error.message);
    process.exit(2);
  });
}
