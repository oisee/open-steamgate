#!/usr/bin/env node
// R4's measurement: per behavior definition of the flight reference
// scenario, which behavior constructs it uses and what the RAP generators
// and runtime of this tree do with each one -- run, ignore or refuse.
//
//   node tools/rap-flight/constructs.mjs [--all]
//
// Two halves, both read off code rather than written by hand:
//
// 1. the constructs: every BDEF of the kept folders (the managed scenario
//    and the reuse layer; --all adds the extension BDEFs) parsed with
//    tools/rap/bdef-parse.mjs, every behavior pool it names scanned with
//    abaplint's lexer for its handler forms (METHODS m FOR <form>) and its
//    saver redefinitions, and its EML statements counted;
// 2. the first wall: tools/rap/bdef-gen.mjs's generate() and
//    rap-runtime-gen.mjs's runtimeOutputs() over the BDEF, the scenario's
//    DDIC and the pool, and the first refusal verbatim -- the same call the
//    build makes.
//
// The verdict of a construct is the SUPPORT table below: what the generator
// and runtime do with it, each "runs" naming the test that shows it. That
// table is the one hand-kept part, and it is kept beside the code that
// would have to change with it.
//
// The tree comes from the same place as classify.mjs's: the pinned commit
// with no exclude list, in .local/rap-flight-classify/upstream (fetched if
// missing).
import {basename, join, resolve} from "node:path";
import {existsSync, mkdirSync, readFileSync} from "node:fs";
import {Lexer} from "@abaplint/core/build/src/abap/1_lexer/lexer.js";
import {MemoryFile} from "@abaplint/core";
import {fetchSource} from "../osd-fetch.mjs";
import {parseBdef} from "../rap/bdef-parse.mjs";
import {generate, walk} from "../rap/bdef-gen.mjs";
import {runtimeOutputs} from "../rap/rap-runtime-gen.mjs";
import {libraryPath} from "../osd-lib-path.mjs";
import {runsAs} from "../osd-main.mjs";

const root = resolve(process.env.OSD_ROOT ?? process.cwd());
const dir = join(root, ".local", "rap-flight-classify");
const KEPT = /^(managed|reuse)\//;
const DDIC = /^(managed|reuse|legacy|readonly)\//;
const EXTENSION = /\/(cntry|rev)\//;

// what the tree does with each construct: runs (with the test that shows
// it), ignored (accepted, no effect) or refused (the generator stops)
export const SUPPORT = {
  "managed": ["runs", "test/rap-serve.mjs"],
  "projection": ["runs", "test/rap-r5.mjs: the order projection served over V2 and V4"],
  "interface": ["refused", "bdef-gen: interface BDEF"],
  "with draft": ["refused", "rap-runtime-gen: draft is outside R2"],
  "several pools": ["runs", "test/rap-r7.mjs, ZCL_OSD_RAP_R7_TEST: each entity's handlers in its own pool, every pool's saver called"],
  "persistent table": ["runs", "test/rap-serve.mjs"],
  "with additional save": ["runs", "test/rap-r7.mjs, ZCL_OSD_RAP_R7_TEST, ZCL_OSD_RAPFLIGHT_R7_TEST: the managed write, then the savers' save_modified (the flight travel's change log)"],
  "with unmanaged save": ["runs", "test/rap-r7.mjs, ZCL_OSD_RAP_R7_TEST: no managed write, save_modified writes; read from the mapping table"],
  "etag master": ["runs", "test/rap-r4.mjs: ETag, 428, 412 over V2 and V4"],
  "etag dependent": ["ignored", "checked against the parent association (R5), not served: the child type gets no ETag"],
  "total etag": ["ignored", "draft only"],
  "lock master": ["runs", "test/rap-r5.mjs, ZCL_OSD_RAP_R5_TEST: the root instance is locked (EZOSD_RAP_LOCK)"],
  "lock dependent": ["runs", "test/rap-r5.mjs: a child write locks its root; R6: by the parent's association or one to the lock master (test/rap-r6.mjs)"],
  "authorization master": ["ignored", "no authorization checks"],
  "authorization dependent": ["ignored", "no authorization checks"],
  "early numbering": ["runs", "test/rap-r4.mjs: FOR NUMBERING draws the key"],
  "late numbering": ["refused", "rap-runtime-gen: late numbering (adjust_numbers, %pid) is outside R4"],
  "numbering : managed": ["runs", "test/rap-serve.mjs"],
  "create/update/delete": ["runs", "test/rap-serve.mjs"],
  "update/delete ( features : instance )": ["runs", "test/rap-r4.mjs: disabled update and delete are 400"],
  "field ( features : instance )": ["ignored", "dynamic field control: the features result's %field is not read"],
  "field control readonly/mandatory": ["runs", "test/rap-serve.mjs"],
  "association (read)": ["runs", "ZCL_OSD_RAP_R5_TEST read by association, test/rap-r5.mjs navigation"],
  "association create": ["runs", "test/rap-r5.mjs: POST through the navigation, ZCL_OSD_RAP_R5_TEST create_by"],
  "action": ["runs", "test/rap-serve.mjs"],
  "action ( features : instance )": ["runs", "test/rap-r4.mjs: a disabled action is 400"],
  "association create ( features : instance )": ["runs", "test/rap-r5.mjs generator: %assoc-<a> asked before a create by association"],
  "internal action": ["runs", "test/rap-r6.mjs, ZCL_OSD_RAP_R6_TEST: run IN LOCAL MODE by a determination, refused outside, not exposed"],
  "factory action": ["runs", "test/rap-r6.mjs, ZCL_OSD_RAP_R6_TEST: the copy in MAPPED, answered over V2 and V4"],
  "static action": ["refused", "bdef-gen: static actions are outside R6"],
  "action parameter": ["refused", "rap-runtime-gen: action parameters"],
  "action result not $self": ["refused", "rap-runtime-gen: only $self results"],
  "determine action": ["runs", "test/rap-r6.mjs, ZCL_OSD_RAP_R6_TEST: members where their triggers hold, ( always ) always"],
  "draft determine action": ["refused", "bdef-gen: draft actions are outside R6 (draft)"],
  "function": ["refused", "bdef-gen: functions are outside R6"],
  "side effects": ["ignored", "parsed, nothing reads them"],
  "determination/validation": ["runs", "test/rap-serve.mjs"],
  "unparsed grammar": ["refused", "bdef-parse leaves it unparsed"],
  // handler forms
  "FOR DETERMINE": ["runs", "ZCL_OSD_RAP_TEST system form"],
  "FOR VALIDATE": ["runs", "ZCL_OSD_RAP_TEST system form"],
  "FOR MODIFY action": ["runs", "ZCL_OSD_RAP_TEST system form"],
  "FOR MODIFY create by association": ["refused", "lower-derived: unmanaged create by association is outside R5"],
  "FOR READ": ["runs", "lower-derived (R3)"],
  "FOR READ by association": ["refused", "lower-derived: unmanaged read by association is outside R5"],
  "FOR LOCK": ["ignored", "lowered (R3), never called: no locks"],
  "FOR INSTANCE FEATURES": ["runs", "test/rap-r4.mjs"],
  "FOR GLOBAL FEATURES": ["refused", "lower-derived: GLOBAL"],
  "FOR INSTANCE AUTHORIZATION": ["refused", "lower-derived: INSTANCE AUTHORIZATION"],
  "FOR GLOBAL AUTHORIZATION": ["refused", "lower-derived: GLOBAL"],
  "FOR NUMBERING (create)": ["runs", "test/rap-r4.mjs"],
  "FOR NUMBERING (create by association)": ["runs", "test/rap-r5.mjs, ZCL_OSD_RAP_R5_TEST: the items numbered 10, 20"],
  "FOR PRECHECK": ["refused", "lower-derived: PRECHECK"],
  "saver save_modified": ["runs", "test/rap-r7.mjs, ZCL_OSD_RAP_R7_TEST: lowered from REDEFINITION, called after the managed write"],
  "saver adjust_numbers": ["refused", "late numbering (the phase is called, parameterless: R7)"],
};

const has = (opts, name, value) => (opts ?? []).some(o => o.name === name && (value === undefined || o.value === value));

/** the constructs of one BDEF model, each with where it is */
export function bdefConstructs(model) {
  const out = [];
  const add = (id, where) => out.push({id, where});
  if (model.unparsed.length) add("unparsed grammar", `${model.unparsed.length} statement(s)`);
  if (["managed", "projection", "interface"].includes(model.implementationType)) add(model.implementationType, "header");
  else if (model.implementationType) add(model.implementationType, "header");
  if (model.withDraft) add("with draft", "header");
  const pools = new Set(model.entities.map(e => (e.implementationClass ?? model.implementationClass ?? "").toUpperCase()).filter(Boolean));
  if (pools.size > 1) add("several pools", [...pools].join(", "));
  for (const e of model.entities) {
    const n = e.alias ?? e.entity;
    if (e.persistentTable) add("persistent table", n);
    for (const o of e.options ?? []) if (o.kind === "additional save") add("with additional save", n);
      else if (o.kind === "unmanaged save") add("with unmanaged save", n);
    if (e.etag) add(`etag ${e.etag.kind}`, n);
    if (e.totalEtag) add("total etag", n);
    if (e.lock) add(`lock ${e.lock.kind}`, n);
    if (e.authorization) add(`authorization ${e.authorization.kind}`, n);
    if (e.numbering) add(`${e.numbering} numbering`, n);
    for (const g of e.fields) {
      if (g.attributes.some(a => a.name === "numbering" && a.value === "managed")) add("numbering : managed", n);
      if (g.attributes.some(a => a.name === "features")) add("field ( features : instance )", `${n}: ${g.fields.join(", ")}`);
      if (g.attributes.some(a => a.name === "readonly" || a.name === "mandatory")) add("field control readonly/mandatory", n);
    }
    for (const op of e.operations.filter(o => !o.use)) {
      add("create/update/delete", `${n}: ${op.kind}`);
      if (has(op.options, "features", "instance")) add("update/delete ( features : instance )", `${n}: ${op.kind}`);
    }
    for (const a of e.associations) {
      const create = a.operations.find(o => o.kind === "create");
      if (create) {
        add("association create", `${n}\\${a.name}`);
        if (has(create.options, "features", "instance")) add("association create ( features : instance )", `${n}\\${a.name}`);
      } else add("association (read)", `${n}\\${a.name}`);
    }
    for (const a of e.actions.filter(x => !x.use)) {
      const mods = a.modifiers.filter(m => m !== "draft");
      if (a.modifiers.includes("draft")) continue;
      if (!mods.length) add("action", `${n}~${a.name}`);
      for (const m of mods) add(`${m} action`, `${n}~${a.name}`);
      if (has(a.options, "features", "instance")) add("action ( features : instance )", `${n}~${a.name}`);
      if (a.parameter) add("action parameter", `${n}~${a.name}`);
      if (a.result && a.result.type !== "$self") add("action result not $self", `${n}~${a.name}`);
    }
    for (const a of e.determineActions) add(a.modifiers.includes("draft") ? "draft determine action" : "determine action", `${n}~${a.name}`);
    for (const f of e.functions) add("function", `${n}~${f.name}`);
    if (e.sideEffects.length) add("side effects", n);
    if (e.determinations.length || e.validations.length) add("determination/validation", `${n}: ${e.determinations.length} + ${e.validations.length}`);
  }
  return out;
}

/** the handler forms and saver redefinitions of a pool's sources */
export function poolConstructs(sources) {
  const out = [];
  for (const {filename, contents} of sources) {
    const tokens = new Lexer().run(new MemoryFile(filename, contents)).tokens.filter(t => t.constructor.name !== "Comment");
    const w = i => tokens[i]?.getStr().toUpperCase();
    let declaring = false;
    for (let i = 0; i < tokens.length; i++) {
      if (i === 0 || w(i - 1) === ".") declaring = w(i) === "METHODS";
      if (!declaring) continue;
      const head = w(i - 1) === "METHODS" || w(i - 1) === ":" || w(i - 1) === ",";
      if (!head) continue;
      const name = tokens[i].getStr();
      let end = i;
      while (end < tokens.length && ![".", ","].includes(w(end))) end++;
      const words = tokens.slice(i + 1, end).map(t => t.getStr()).join(" ").replace(/\s*([\\~])\s*/g, "$1").toUpperCase();
      const where = `${basename(filename).split(".")[0].replace(/#/g, "/").toUpperCase()}->${name}`;
      let id;
      if (/^REDEFINITION$/.test(words) && ["SAVE_MODIFIED", "ADJUST_NUMBERS"].includes(name.toUpperCase())) id = `saver ${name.toLowerCase()}`;
      else if (/^FOR DETERMINE /.test(words)) id = "FOR DETERMINE";
      else if (/^FOR VALIDATE /.test(words)) id = "FOR VALIDATE";
      else if (/^FOR MODIFY /.test(words)) id = /\bFOR CREATE \S+\\/.test(words) ? "FOR MODIFY create by association" : "FOR MODIFY action";
      else if (/^FOR READ /.test(words)) id = /\bFOR READ \S+\\/.test(words) ? "FOR READ by association" : "FOR READ";
      else if (/^FOR LOCK /.test(words)) id = "FOR LOCK";
      else if (/^FOR (INSTANCE|GLOBAL) (FEATURES|AUTHORIZATION)/.test(words)) id = words.split(" ").slice(0, 3).join(" ");
      else if (/^FOR NUMBERING /.test(words)) id = /\bFOR CREATE \S+\\/.test(words) ? "FOR NUMBERING (create by association)" : "FOR NUMBERING (create)";
      else if (/^FOR PRECHECK /.test(words)) id = "FOR PRECHECK";
      if (id) out.push({id, where});
      i = end;
      if (w(end) === ".") declaring = false;
    }
  }
  return out;
}

function libraryDdic() {
  const deps = [];
  for (const name of ["open-abap-core", "open-abap-odata"]) {
    const libDir = join(libraryPath(root, name), "src");
    deps.push(...walk(libDir).filter((f) => /\.(tabl|view|dtel|doma)\.xml$/.test(f))
      .map((f) => ({filename: basename(f), contents: readFileSync(f, "utf8")})));
  }
  return deps;
}

async function tree(log) {
  const manifest = JSON.parse(readFileSync(join(root, "packs/rap-flight/osd-pack.json"), "utf8"));
  const [source] = manifest.sources;
  const already = join(dir, "upstream");
  if (!existsSync(already)) {
    mkdirSync(dir, {recursive: true});
    await fetchSource({name: "rap-flight-classify", dir, root}, {...source, exclude: [], folder: "upstream", dir: already}, {log});
  }
  return walk(already).map(path => ({path, rel: path.slice(already.length + 1), filename: basename(path), contents: readFileSync(path, "utf8")}));
}

async function main() {
  const all = process.argv.includes("--all");
  const fetched = await tree(l => console.error(`constructs: ${l}`));
  const files = fetched.filter(f => KEPT.test(f.rel));
  // R5: the dictionary the pack builds with, legacy/ included (the /dmo/
  // data elements live there); before R5 no BDEF got as far as its fields
  // and the pack's overlay (packs/rap-flight/src: the standard data elements
  // the scenario's tables name, as stubs)
  const overlay = walk(join(root, "packs/rap-flight/src")).map(path => ({path, rel: "overlay", filename: basename(path), contents: readFileSync(path, "utf8")}));
  const ddic = [...fetched.filter(f => DDIC.test(f.rel)), ...overlay]
    .filter(f => /\.(ddls\.(asddls|xml)|tabl\.xml|view\.xml|dtel\.xml|doma\.xml)$/.test(f.filename));
  const libDdic = libraryDdic();
  const bdefs = files.filter(f => f.filename.endsWith(".bdef.asbdef") && (all || !EXTENSION.test(f.rel)))
    .sort((a, b) => a.filename.localeCompare(b.filename));
  const name = f => f.filename.split(".")[0].replace(/#/g, "/").toUpperCase();
  const totals = new Map();
  console.log("## Constructs per behavior definition\n");
  console.log("| BDEF | construct | where | verdict |");
  console.log("| --- | --- | --- | --- |");
  const walls = [];
  for (const bdef of bdefs) {
    const model = parseBdef(bdef.contents);
    const pools = new Set([model.implementationClass, ...model.entities.map(e => e.implementationClass)].filter(Boolean).map(p => p.toLowerCase().replace(/\//g, "#")));
    const poolFiles = files.filter(f => pools.has(f.filename.split(".")[0]) && /\.clas\.(locals_imp\.|locals_def\.)?abap$/.test(f.filename));
    const found = [...bdefConstructs(model), ...poolConstructs(poolFiles)];
    const grouped = new Map();
    for (const c of found) grouped.set(c.id, [...(grouped.get(c.id) ?? []), c.where]);
    for (const [id, where] of grouped) {
      const verdict = SUPPORT[id]?.[0] ?? "unknown";
      totals.set(`${id}|${verdict}`, (totals.get(`${id}|${verdict}`) ?? 0) + 1);
      console.log(`| ${name(bdef)} | ${id} | ${[...new Set(where)].slice(0, 4).join("; ")}${where.length > 4 ? "; ..." : ""} | ${verdict} |`);
    }
    let wall = "accepted";
    // R5: a projection is generated against its base, so the base BDEF (the
    // one with the entity the projection's root view projects on) goes along
    // and the projection's wall may be its base's
    const inputs = [bdef];
    if (model.implementationType === "projection") {
      const rootView = model.entities[0]?.entity ?? "";
      const ddls = ddic.find(f => f.filename.endsWith(".ddls.asddls") && name(f) === rootView.toUpperCase());
      const base = /as\s+projection\s+on\s+([\w/]+)/i.exec(ddls?.contents ?? "")?.[1]?.toUpperCase();
      const baseBdef = files.find(f => f.filename.endsWith(".bdef.asbdef") && parseBdef(f.contents).entities.some(e => e.entity.toUpperCase() === base));
      if (baseBdef) inputs.push(baseBdef);
    }
    try {
      const {plans} = generate([...inputs, ...ddic], libDdic);
      runtimeOutputs(plans ?? [], files.filter(f => /\.clas\.(locals_imp\.|locals_def\.)?abap$/.test(f.filename))
        .map(f => ({filename: f.filename, contents: f.contents})));
    } catch (error) {
      wall = String(error.message).split("\n")[0];
    }
    walls.push([name(bdef), model.implementationType ?? "?", wall]);
  }
  console.log("\n## First wall per behavior definition (bdef-gen + rap-runtime-gen)\n");
  console.log("| BDEF | kind | first refusal |");
  console.log("| --- | --- | --- |");
  for (const w of walls) console.log(`| ${w.join(" | ")} |`);
  console.log("\n## Constructs over all BDEFs, by verdict\n");
  console.log("| construct | verdict | BDEFs |");
  console.log("| --- | --- | ---: |");
  for (const [k, v] of [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const [id, verdict] = k.split("|");
    console.log(`| ${id} | ${verdict} | ${v} |`);
  }
  return 0;
}

if (runsAs("constructs.mjs")) {
  main().then(code => process.exit(code), error => { console.error(error); process.exit(1); });
}
