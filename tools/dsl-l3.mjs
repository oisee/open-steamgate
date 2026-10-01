#!/usr/bin/env node
// DSL L3: a set of L2 rules run as one unit, with a durable alert log and a
// trace from every alert to its rule line (docs/dsl-l3.md). A set is one
// manifest, `<set>.l3.yaml`, naming its rules by their `.l2.yaml` files; this
// compiler checks it, then renders through ZCL_OSD_TPL the set's runner class
// ZCL_L3_<SET> and its job report, each with a trace sidecar. It knows the
// set language and the L2 compiler's API, nothing of any domain.
//
//   node tools/dsl-l3.mjs build <set.l3.yaml> --out <dir> [--ddic <folder>]...
//   node tools/dsl-l3.mjs check <set.l3.yaml> --out <dir> [--ddic <folder>]...
//   node tools/dsl-l3.mjs explain <set>/<rule>/<model hash>/<date>/<seq> [--set <set.l3.yaml>]... [--db <sqlite file>]
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join, relative, resolve as resolvePath, sep} from "node:path";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import yaml from "js-yaml";
const abaplint = createRequire(import.meta.url)("@abaplint/core");
import {compileRule, lineIndex, modelHash, renderModel, rulePath, RuleError} from "./dsl-l2.mjs";
import {DEFAULT_DDIC, registryFor} from "./dsl-ddic.mjs";

export const SET_TEMPLATE = "recipes/l3-set/template.tpl";
export const JOB_TEMPLATE = "recipes/l3-job/template.tpl";
// the templates of the ports (docs/dsl-l3.md, "Ports and adapters")
export const PORT_TEMPLATES = {
  "iface-source": "recipes/l3-ports/iface-source.tpl", "iface-sink": "recipes/l3-ports/iface-sink.tpl",
  factory: "recipes/l3-ports/factory.tpl", exception: "recipes/l3-ports/exception.tpl",
  "source-table": "recipes/l3-ports/source-table.tpl", "source-mem": "recipes/l3-ports/source-mem.tpl",
  "sink-log": "recipes/l3-ports/sink-log.tpl", "sink-dummy": "recipes/l3-ports/sink-dummy.tpl",
  "sink-capture": "recipes/l3-ports/sink-capture.tpl",
};
// what a port of each kind may be served by without a class of its own
export const GENERATED = {source: ["table", "dummy", "capture"], sink: ["log", "dummy", "capture"]};
// the methods a hand-written variant class must implement through the port's interface
export const PORT_METHODS = {source: ["read"], sink: ["put"]};
// the alert log is the one sink the runner knows how to fill
export const SINK_TABLE = "ZOSD_L3_ALERT";
export const SINK_GROUP = ["set_name", "rule_name", "model_hash", "check_date"];

// the widths of ZOSD_L3_ALERT's columns the runner writes from the manifest
export const WIDTH = {set: 16, rule: 60, hash: 71, file: 128, jobname: 32};
// a set name: the class ZCL_L3_<SET>, the report ZL3_<SET> (whose converted
// class ZCL_OSD_GUITX_L3_<SET> has 30 characters at most) and the job names
// L3_<SET>_<nn> are made of it
export const SET_NAME = /^[a-z][a-z0-9_]{0,12}$/;
// ---------------------------------------------------------------------------
// static checks on ABAP source, read with abaplint (statements, not text)

// Statements that end, split or leave the unit of work, and ones that write. A generated check
// class holds none of either; the generated runner and variants may write (the log does) but
// never end or split the unit. The one statement the runner may hold is SUBMIT, in the mode P
// path that a replay refuses (`jobs: true`). Hand-written variants are not scanned: a static
// scan cannot see what a helper they call does, so a replay does not bind them at all.
const S0 = abaplint.Statements;
const ENDS_UNIT = new Map([[S0.Commit, "COMMIT"], [S0.Rollback, "ROLLBACK"], [S0.Wait, "WAIT"], [S0.Submit, "SUBMIT"],
  [S0.CallTransaction, "CALL TRANSACTION"], [S0.Receive, "RECEIVE RESULTS"]]);
const WRITES = new Map([[abaplint.Statements.ModifyDatabase, "MODIFY"], [abaplint.Statements.InsertDatabase, "INSERT"],
  [abaplint.Statements.UpdateDatabase, "UPDATE"], [abaplint.Statements.DeleteDatabase, "DELETE"], [abaplint.Statements.MergeDatabase, "MERGE"]]);
const COMMITTING_FM = /^'(DB_COMMIT|DB_ROLLBACK|BAPI_TRANSACTION_COMMIT|BAPI_TRANSACTION_ROLLBACK)'$/i;

// [{line, what}] for each statement of the source that ends the unit of work, writes (when
// writes is false), registers an update task or runs native SQL
export function unitFindings(text, name, {writes = false, jobs = false} = {}) {
  const registry = new abaplint.Registry();
  registry.addFile(new abaplint.MemoryFile(name, text));
  registry.parse();
  const found = [];
  for (const object of registry.getObjects()) {
    for (const file of object.getABAPFiles()) {
      for (const statement of file.getStatements()) {
        const type = statement.get().constructor;
        const line = statement.getStart().getRow();
        const source = statement.concatTokens().replace(/\s+/g, " ");
        if (ENDS_UNIT.has(type) && !(jobs && type === S0.Submit)) found.push({line, what: `${ENDS_UNIT.get(type)} statement`});
        else if (!writes && WRITES.has(type)) found.push({line, what: `${WRITES.get(type)} database statement`});
        else if (type === abaplint.Statements.CallFunction && (/\bIN UPDATE TASK\b|\bIN BACKGROUND\b|\bDESTINATION\b|\bSTARTING NEW TASK\b/i.test(source) || COMMITTING_FM.test((source.split(" ")[2] ?? "").replace(/\.$/, "")))) found.push({line, what: "CALL FUNCTION that registers an update or ends the unit"});
        else if (type === abaplint.Statements.SetUpdateTask) found.push({line, what: "SET UPDATE TASK statement"});
        else if (type === abaplint.Statements.CallDatabase) found.push({line, what: "native SQL"});
      }
    }
  }
  return found;
}

// What the named class of a source declares: its DEFINITION line, the interfaces it names and the
// methods its own IMPLEMENTATION holds (a second class in the file counts for nothing).
export function classShape(text, name, className) {
  const registry = new abaplint.Registry();
  registry.addFile(new abaplint.MemoryFile(name, text));
  registry.parse();
  const same = (a) => a?.toLowerCase() === className.toLowerCase();
  const S = abaplint.Statements, E = abaplint.Expressions;
  const shape = {line: undefined, interfaces: [], methods: []};
  let inDefinition = false, inImplementation = false;
  for (const file of registry.getObjects().flatMap((o) => o.getABAPFiles())) {
    for (const statement of file.getStatements()) {
      const type = statement.get();
      if (type instanceof S.ClassDefinition) {
        inDefinition = same(statement.findFirstExpression(E.ClassName)?.concatTokens());
        if (inDefinition) shape.line = statement.getStart().getRow();
      } else if (type instanceof S.ClassImplementation) {
        inImplementation = same(statement.findFirstExpression(E.ClassName)?.concatTokens());
      } else if (type instanceof S.EndClass) {
        inDefinition = false;
        inImplementation = false;
      } else if (inDefinition && type instanceof S.InterfaceDef) {
        shape.interfaces.push(statement.findFirstExpression(E.InterfaceName).concatTokens().toLowerCase());
      } else if (inImplementation && type instanceof S.MethodImplementation) {
        shape.methods.push(statement.findFirstExpression(E.MethodName).concatTokens().toLowerCase());
      }
    }
  }
  return shape.line === undefined ? undefined : shape;
}

const KEYS = ["set", "title", "class", "report", "date", "rules", "ports", "bindings"];
const PORT_KEYS = ["kind", "table", "key", "group", "seq", "variants"];
const PORT_NAME = /^[a-z][a-z0-9_]{0,11}$/;
const RULE_KEYS = ["rule", "enabled"];
const CHAR = (length) => ({built_in: "CHAR", length});

export class SetError extends RuleError {}

const path = (file) => relative(process.cwd(), file).split(sep).join("/");

// The nearest line of a manifest path (`rules/2/enabled`), or of its parent.
function lineOf(index, key) {
  let current = `/${key}`;
  while (current) {
    if (index.has(current)) return index.get(current);
    current = current.slice(0, current.lastIndexOf("/"));
  }
  return 1;
}

// the source of a hand-written variant class, beside the set or under src
function findClassFile(className, roots) {
  const name = `${className}.clas.abap`;
  const walk = (dir) => {
    if (!existsSync(dir)) return undefined;
    for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) { const hit = walk(join(dir, entry.name)); if (hit) return hit; }
      else if (entry.name.toLowerCase() === name) return join(dir, entry.name);
    }
    return undefined;
  };
  for (const root of roots) { const hit = walk(root); if (hit) return hit; }
  return undefined;
}

// The generated check class of a rule sits beside its rule file, as
// `node tools/dsl-l2.mjs build <rule> --out <its folder>` writes it.
const sidecarOf = (ruleFile, className) => join(dirname(ruleFile), `${className}.clas.trace.json`);

export function compileSet(file, {ddic, registry, out} = {}) {
  const text = readFileSync(file, "utf8");
  const where = path(file);
  const fail = (line, message) => { throw new SetError(where, line, message); };
  let doc;
  try {
    doc = yaml.load(text, {schema: yaml.FAILSAFE_SCHEMA, filename: where});
  } catch (error) {
    throw new SetError(where, (error.mark?.line ?? 0) + 1, error.reason ?? error.message);
  }
  const index = lineIndex(text);
  const line = (key) => lineOf(index, key);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail(1, "a set is a mapping with set, title and rules");
  for (const key of Object.keys(doc)) if (!KEYS.includes(key)) fail(line(key), `unknown key ${key} (${KEYS.join(", ")})`);
  const scalar = (key, required) => {
    const value = doc[key];
    if (value === undefined) {
      if (required) fail(1, `a set needs ${key}`);
      return undefined;
    }
    if (typeof value !== "string" || value.includes("\n")) fail(line(key), `${key} is one line of text`);
    return value;
  };
  const set = scalar("set", true);
  if (!SET_NAME.test(set)) fail(line("set"), `set ${JSON.stringify(set)} is a lower-case name of 1 to 13 letters, digits and _ starting with a letter`);
  const title = scalar("title", true);
  const className = (scalar("class") ?? `zcl_l3_${set}`).toLowerCase();
  if (!/^z[a-z0-9_]{1,29}$/.test(className)) fail(line("class"), `class ${className} is a Z name of at most 30 characters`);
  const report = (scalar("report") ?? `zl3_${set}`).toLowerCase();
  if (!/^z[a-z0-9_]{1,18}$/.test(report)) fail(line("report"), `report ${report} is a Z name of at most 19 characters (its converted class ZCL_OSD_GUITX_<name without Z> has 30)`);
  const date = scalar("date", true);
  if (date !== "$date" && date !== "today") fail(line("date"), `date is $date (the caller passes the check date) or today ($date, the current date when the caller passes none); L2 rules know no other parameter`);

  if (!Array.isArray(doc.rules)) fail(line("rules"), "rules is a list of {rule: <file.l2.yaml>, enabled: true|false}");
  if (!doc.rules.length) fail(line("rules"), "a set needs at least one rule");
  const seen = {file: new Map(), name: new Map(), class: new Map()};
  const all = doc.rules.map((entry, i) => {
    const at = line(`rules/${i}`);
    if (typeof entry === "string") entry = {rule: entry};
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(at, "a rule entry is {rule: <file.l2.yaml>} with an optional enabled: true|false");
    for (const key of Object.keys(entry)) if (!RULE_KEYS.includes(key)) fail(line(`rules/${i}/${key}`), `unknown key ${key} in a rule entry (${RULE_KEYS.join(", ")})`);
    if (typeof entry.rule !== "string" || !entry.rule.endsWith(".l2.yaml")) fail(at, "rule names a .l2.yaml file, relative to the set");
    const enabled = entry.enabled ?? "true";
    if (enabled !== "true" && enabled !== "false") fail(line(`rules/${i}/enabled`), `enabled is true or false, not ${JSON.stringify(enabled)}`);
    const ruleFile = resolvePath(dirname(file), entry.rule);
    if (!existsSync(ruleFile)) fail(at, `rule file ${entry.rule} does not exist (${path(ruleFile)})`);
    const twice = (kind, key, what) => {
      if (seen[kind].has(key)) fail(at, `${what} is already in the set at line ${seen[kind].get(key)}`);
      seen[kind].set(key, at);
    };
    twice("file", ruleFile, `rule file ${entry.rule}`);
    let compiled;
    try {
      // out: the rule's own folder, where its class is built, so a rule
      // outside a repository records the path its sidecar records
      compiled = compileRule(ruleFile, {out: dirname(ruleFile), ...(ddic ? {ddic} : {}), ...(registry ? {registry} : {})});
    } catch (error) {
      if (error instanceof RuleError) fail(at, `rule ${entry.rule} does not compile: ${error.message}`);
      throw error;
    }
    twice("name", compiled.rule, `rule ${compiled.rule}`);
    twice("class", compiled.class, `class ${compiled.class}`);
    if (compiled.rule.length > WIDTH.rule) fail(at, `rule name ${compiled.rule} is longer than ${WIDTH.rule} characters, the width of ZOSD_L3_ALERT-RULE_NAME`);
    const hash = modelHash(renderModel(compiled));
    const sidecar = sidecarOf(ruleFile, compiled.class);
    let committed;
    try { committed = JSON.parse(readFileSync(sidecar, "utf8")).model; } catch { committed = undefined; }
    if (committed === undefined) fail(at, `rule ${entry.rule} has no generated class beside it (${path(sidecar)}); build it with node tools/dsl-l2.mjs build ${path(ruleFile)} --out ${path(dirname(ruleFile))}`);
    if (committed !== hash) fail(at, `the generated class of ${entry.rule} is stale (its trace names ${committed}, the rule compiles to ${hash}); rebuild it with node tools/dsl-l2.mjs build ${path(ruleFile)} --out ${path(dirname(ruleFile))}`);
    // a check class is read-only by construction: a replay runs it with the table swapped
    const classFile = join(dirname(ruleFile), `${compiled.class}.clas.abap`);
    if (existsSync(classFile)) {
      const [first] = unitFindings(readFileSync(classFile, "utf8"), basename(classFile));
      if (first) fail(at, `the generated class of ${entry.rule} (${path(classFile)}:${first.line}) holds a ${first.what}; a check class only reads (a replay swaps table content under it)`);
    }
    const recorded = compiled.source;
    if (recorded.length > WIDTH.file) fail(at, `rule path ${recorded} is longer than ${WIDTH.file} characters, the width of ZOSD_L3_ALERT-RULE_FILE`);
    return {at, enabled: enabled === "true", compiled, hash, recorded};
  });
  const enabled = all.filter((r) => r.enabled);
  if (!enabled.length) fail(line("rules"), "every rule of the set is disabled; a set runs at least one");
  if (enabled.length > 99) fail(line("rules"), "a set runs at most 99 rules (the job name numbers them in two digits)");

  const id = `set/${set}`;

  // ports and bindings (docs/dsl-l3.md, "Ports and adapters")
  const asMap = (value, key, what) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(line(key), `${key} is ${what}`);
    return value;
  };
  let registry0;
  const columnsOf = (table, key) => {
    registry0 ??= registryFor(ddic ?? DEFAULT_DDIC, []);
    const object = registry0.getObject("TABL", table.toUpperCase());
    if (!object) fail(line(`${key}/table`), `table ${table.toUpperCase()} is not in the DDIC given`);
    const names = (object.getFields() ?? []).filter((f) => !f.FIELDNAME.startsWith(".")).map((f) => f.FIELDNAME.toLowerCase());
    const clidep = /<CLIDEP>X</.test(object.getXML() ?? "");
    return {names, client: clidep ? names[0] : undefined};
  };
  const classSearch = [dirname(file), "src"];
  const portDocs = doc.ports === undefined ? {alerts: {kind: "sink", table: SINK_TABLE, group: [...SINK_GROUP], seq: "alert_seq", variants: {log: "generated"}}} : asMap(doc.ports, "ports", "a mapping of port name to its definition");
  const implicit = doc.ports === undefined;
  const bindingDocs = doc.bindings === undefined ? (implicit ? {alerts: "log"} : {}) : asMap(doc.bindings, "bindings", "a mapping of port name to the variant it is bound to");
  if (!Object.keys(portDocs).length) fail(line("ports"), "ports names at least one port");
  // a hand-written variant: the named class itself declares the port's interface and implements
  // each of its methods (read with abaplint, so a second class in the file counts for nothing);
  // refused at the class's own file and line otherwise. Nothing more is asked of it: a replay
  // never binds a hand-written class (the factory refuses it from data, before it is created)
  const checkClass = ({className, iface, kind, at, vname}) => {
    const found = findClassFile(className, classSearch);
    if (!found) fail(at, `class ${className} of variant ${vname} is not found (${className}.clas.abap beside the set or under src)`);
    const text = readFileSync(found, "utf8");
    const shape = classShape(text, basename(found), className);
    if (!shape) throw new SetError(path(found), 1, `${basename(found)} does not define class ${className}`);
    if (!shape.interfaces.includes(iface)) {
      throw new SetError(path(found), shape.line, `class ${className} does not implement ${iface}, the interface of the ${kind} port (INTERFACES ${iface}.)`);
    }
    for (const method of PORT_METHODS[kind]) {
      if (!shape.methods.includes(`${iface}~${method}`)) {
        throw new SetError(path(found), shape.line, `class ${className} does not implement ${iface}~${method} in its own implementation; the port's signature is ${PORT_METHODS[kind].join(", ")} (see the generated ${iface})`);
      }
    }
  };
  const ifaceOf = (port) => `zif_l3_${set}_${port}`;
  const tooLong = (name, key) => { if (name.length > 30) fail(line(key), `the generated name ${name} has ${name.length} characters, a class or interface name has at most 30; shorten the set, port or variant name`); };
  const ports = Object.entries(portDocs).map(([name, def], pi) => {
    const key = `ports/${name}`;
    const at = implicit ? line("set") : line(key);
    if (!PORT_NAME.test(name)) fail(at, `port ${JSON.stringify(name)} is a lower-case name of 1 to 12 letters, digits and _ starting with a letter`);
    asMap(def, key, "a mapping with kind, table and variants");
    for (const k of Object.keys(def)) if (!PORT_KEYS.includes(k)) fail(line(`${key}/${k}`), `unknown key ${k} in a port (${PORT_KEYS.join(", ")})`);
    const text = (k, required) => {
      const v = def[k];
      if (v === undefined) { if (required) fail(at, `port ${name} needs ${k}`); return undefined; }
      if (typeof v !== "string" || v.includes("\n") || !/^[A-Za-z][A-Za-z0-9_]*$/.test(v)) fail(line(`${key}/${k}`), `${k} of port ${name} is a name of letters, digits and _`);
      return v;
    };
    const kind = text("kind", true);
    if (!GENERATED[kind]) fail(line(`${key}/kind`), `kind of port ${name} is source or sink, not ${JSON.stringify(kind)}`);
    const table = text("table", true).toLowerCase();
    const {names, client} = implicit ? {names: null, client: undefined} : columnsOf(table, key);
    const column = (k, v) => {
      if (names && !names.includes(v.toLowerCase())) fail(line(`${key}/${k}`), `${table.toUpperCase()} has no field ${v.toUpperCase()}`);
      return v.toLowerCase();
    };
    let keyField, group, seq;
    if (kind === "source") {
      keyField = column("key", text("key", true));
      for (const k of ["group", "seq"]) if (def[k] !== undefined) fail(line(`${key}/${k}`), `${k} belongs to a sink, port ${name} is a source`);
    } else {
      if (def.key !== undefined) fail(line(`${key}/key`), `key belongs to a source, port ${name} is a sink`);
      if (table.toUpperCase() !== SINK_TABLE) fail(line(`${key}/table`), `a sink writes ${SINK_TABLE}, the table the runner fills, not ${table.toUpperCase()}`);
      if (!Array.isArray(def.group) || def.group.some((g) => typeof g !== "string")) fail(line(`${key}/group`), `group of sink ${name} is a list of field names`);
      group = def.group.map((g) => column("group", g));
      if (JSON.stringify(group) !== JSON.stringify(SINK_GROUP)) fail(line(`${key}/group`), `group of sink ${name} is ${SINK_GROUP.join(", ")} (the key of one rule version and date), the fields the runner knows`);
      seq = column("seq", text("seq", true));
    }
    const variantDocs = asMap(def.variants, `${key}/variants`, `a mapping of variant name to generated or a class name`);
    if (!Object.keys(variantDocs).length) fail(line(`${key}/variants`), `port ${name} needs at least one variant`);
    tooLong(ifaceOf(name), key);
    const iface = ifaceOf(name);
    const variants = Object.entries(variantDocs).map(([vname, value0]) => {
      let value = value0;
      const vkey = `${key}/variants/${vname}`;
      const vat = implicit ? at : line(vkey);
      if (!PORT_NAME.test(vname)) fail(vat, `variant ${JSON.stringify(vname)} is a lower-case name of 1 to 12 letters, digits and _ starting with a letter`);
      if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) fail(vat, `variant ${vname} is generated or the name of a class`);
      let className, generated = value === "generated";
      if (generated) {
        if (!GENERATED[kind].includes(vname)) fail(vat, `a generated variant of a ${kind} is one of ${GENERATED[kind].join(", ")}; ${vname} needs a class of its own (${vname}: <class>)`);
        className = `zcl_l3_${set}_${name}_${vname}`;
        tooLong(className, vkey);
      } else {
        className = value.toLowerCase();
        checkClass({className, iface, kind, at: vat, vname});
      }
      return {
        "@id": `${id}/port/${name}/variant/${vname}`, set_line: vat,
        name: vname, "name@type": CHAR(30), class: className, generated,
        is_table: generated && vname === "table", is_log: generated && vname === "log",
        is_dummy: generated && vname === "dummy", is_capture: generated && vname === "capture",
        // what the factory knows of a variant without creating it: a hand-written class counts as live
        // and not volatile, and a replay does not bind it
        port: name, "port@type": CHAR(30), hand: !generated,
        volatile: generated && (vname === "dummy" || vname === "capture"),
        nonlive: generated && kind === "source" && vname !== "table",
      };
    });
    const bound = bindingDocs[name];
    const bat = line(`bindings/${name}`);
    if (bound === undefined) fail(implicit ? at : line("bindings"), `port ${name} has no binding; bindings names the variant each port runs with`);
    if (typeof bound !== "string" || !variants.some((v) => v.name === bound)) fail(bat, `binding ${name}: ${JSON.stringify(bound)} is not a variant of the port (${variants.map((v) => v.name).join(", ")})`);
    return {
      "@id": `${id}/port/${name}`, set_line: at,
      name, "name@type": CHAR(30), kind, is_source: kind === "source", is_sink: kind === "sink",
      table, key: keyField, seq, iface, exception: `zcx_l3_${set}_port`, ports_class: `zcl_l3_${set}_ports`,
      group: group?.map((g, i) => ({name: g, lead: i === 0 ? "WHERE" : "AND"})) ?? [],
      has_client: client !== undefined, client: client ?? "",
      variants,
      binding: {"@id": `${id}/binding/${name}`, set_line: implicit ? at : bat, variant: bound, "variant@type": CHAR(30)},
    };
  });
  for (const name of Object.keys(bindingDocs)) if (!ports.some((p) => p.name === name)) fail(line(`bindings/${name}`), `binding ${name} names no port of the set`);
  const sinks = ports.filter((p) => p.is_sink);
  if (sinks.length !== 1) fail(line("ports"), `a set has exactly one sink, the alert sink the runner writes through; this one has ${sinks.length}`);
  const SET = set.toUpperCase();
  const node = (r, n) => ({
    "@id": `${id}/rule/${r.compiled.rule}`, set_line: r.at,
    name: r.compiled.rule, "name@type": CHAR(WIDTH.rule),
    hash: r.hash, "hash@type": CHAR(WIDTH.hash),
    check_class: r.compiled.class, "check_class@type": CHAR(30),
    file: r.recorded, "file@type": CHAR(WIDTH.file),
    // the alert line of the rule: what an alert row names; a rule whose
    // clauses carry their own alerts names its root line
    alert_line: String(r.compiled.alert?.rule_line ?? r.compiled.rule_line), "alert_line@type": {built_in: "INT4"},
    ...(n ? {index: String(n), jobname: `L3_${SET}_${String(n).padStart(2, "0")}`, "jobname@type": CHAR(WIDTH.jobname)} : {}),
  });
  const model = {
    "@id": id, set_line: line("set"),
    set, "set@type": CHAR(WIDTH.set), title, class: className, report, source: rulePath(file, out),
    jobs: `L3_${SET}_*`, "jobs@type": CHAR(WIDTH.jobname),
    date: {"@id": `${id}/date`, set_line: line("date"), today: date === "today"},
    ports_class: `zcl_l3_${set}_ports`, exception: `zcx_l3_${set}_port`,
    ports, sources: ports.filter((p) => p.is_source).map((p, i) => ({...p, index: String(i + 1)})), sink: sinks[0],
    rules: enabled.map((r, i) => node(r, i + 1)),
    disabled: all.filter((r) => !r.enabled).map((r) => node(r)),
  };
  Object.defineProperty(model, "where", {value: where});
  return model;
}

// the nearest node with an @id on a trace path (1-based array indexes)
function provenance(model, tracePath) {
  let current = model, node = model;
  for (const part of String(tracePath ?? "").split("/").filter(Boolean)) {
    current = Array.isArray(current) ? current[Number(part) - 1] : current?.[part];
    if (current?.["@id"]) node = current;
  }
  return {node: node["@id"], set_line: node.set_line};
}

function sidecar(model, template, rendered) {
  return JSON.stringify({
    generator: "dsl-l3", set: model.source, template,
    model: `sha256:${createHash("sha256").update(JSON.stringify(model)).digest("hex")}`,
    ...(model.rules ? {rules: Object.fromEntries(model.rules.map((r) => [r.name, {file: r.file, class: r.check_class, model: r.hash}]))} : {}),
    lines: rendered.trace.map((entry) => ({line: entry.line, template_line: entry.template_line, path: entry.path,
      ...provenance(model, entry.path)})),
  }, null, 1) + "\n";
}

const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function classXml(model, name = model.class, descript = `L3 rule set ${model.set}`) {
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values><VSEOCLASS><CLSNAME>${name.toUpperCase()}</CLSNAME><LANGU>E</LANGU><DESCRIPT>${xmlEscape(descript.slice(0, 60))}</DESCRIPT><STATE>1</STATE><CLSCCINCL>X</CLSCCINCL><FIXPT>X</FIXPT><UNICODE>X</UNICODE></VSEOCLASS></asx:values>
 </asx:abap>
</abapGit>
`;
}

function intfXml(name, descript) {
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_INTF" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values><VSEOINTERF><CLSNAME>${name.toUpperCase()}</CLSNAME><LANGU>E</LANGU><DESCRIPT>${xmlEscape(descript.slice(0, 60))}</DESCRIPT><EXPOSURE>2</EXPOSURE><STATE>1</STATE><UNICODE>X</UNICODE></VSEOINTERF></asx:values>
 </asx:abap>
</abapGit>
`;
}

// every node with an @id of a model, id -> its manifest line
function linesById(model, map = new Map()) {
  if (Array.isArray(model)) { for (const x of model) linesById(x, map); return map; }
  if (!model || typeof model !== "object") return map;
  if (model["@id"]) map.set(model["@id"], model.set_line);
  for (const value of Object.values(model)) linesById(value, map);
  return map;
}

function progXml(model) {
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_PROG" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values><PROGDIR><NAME>${model.report.toUpperCase()}</NAME><DBAPL>S</DBAPL><SUBC>1</SUBC><FIXPT>X</FIXPT><UCCHECK>X</UCCHECK></PROGDIR></asx:values>
 </asx:abap>
</abapGit>
`;
}

// The files of a set, name -> content. What the abap profile refuses is a
// SetError at the manifest line of the node the line traces to.
export async function renderSet(model) {
  const {renderRecipe} = await import("./dsl-abap.mjs");
  const quiet = console.log;
  let runner, job;
  try {
    console.log = (...items) => console.error(...items); // runtime bootstrap diagnostics
    runner = await renderRecipe(model, SET_TEMPLATE, {profile: "abap"});
    job = await renderRecipe(model, JOB_TEMPLATE, {profile: "abap"});
  } finally {
    console.log = quiet;
  }
  const known = linesById(model);
  const nodeLine = (nodeId) => known.get(nodeId) ?? model.set_line;
  const extra = await renderPorts(model);
  // nothing the runner or a generated variant holds may end the unit of work while a table is swapped
  for (const [name, text] of [[`${model.class}.clas.abap`, runner.text], ...extra.results.map(([n, r]) => [n, r.text])]) {
    const [first] = unitFindings(text, name, {writes: true, jobs: name === `${model.class}.clas.abap`});
    if (first) throw new SetError(model.where ?? model.source, model.set_line, `the generated ${name} line ${first.line} holds a ${first.what}; nothing generated may end the unit of work`);
  }
  const results = [[`${model.class}.clas.abap`, runner], [`${model.report}.prog.abap`, job], ...extra.results];
  for (const [name, result] of results) {
    const error = result.findings.find((f) => f.severity === "E");
    if (error) throw new SetError(model.where ?? model.source, nodeLine(error.node), `the generated ${name} line ${error.line}: ${error.text} (${error.rule}, ${error.node})`);
  }
  return {
    files: {
      ...extra.files,
      [`${model.class}.clas.abap`]: runner.text,
      [`${model.class}.clas.xml`]: classXml(model),
      [`${model.class}.clas.trace.json`]: sidecar(model, SET_TEMPLATE, runner),
      [`${model.report}.prog.abap`]: job.text,
      [`${model.report}.prog.xml`]: progXml(model),
      [`${model.report}.prog.trace.json`]: sidecar(model, JOB_TEMPLATE, job),
    },
    findings: [...runner.findings.map((f) => ({...f, file: `${model.class}.clas.abap`})),
      ...job.findings.map((f) => ({...f, file: `${model.report}.prog.abap`})),
      ...extra.results.flatMap(([name, r]) => r.findings.map((f) => ({...f, file: name})))],
  };
}

// The interface of each port, its generated variants, the factory and the
// exception class, each rendered from a model of its own whose root is the
// node it traces to: the port for an interface, the variant for a variant
// class, the set for the factory.
async function renderPorts(model) {
  const {renderRecipe} = await import("./dsl-abap.mjs");
  const quiet = console.log;
  const files = {}, results = [];
  const base = {set: model.set, "set@type": CHAR(WIDTH.set), source: model.source, ports_class: model.ports_class, exception: model.exception};
  const one = async (name, ext, root, template, descript, interface_ = false) => {
    let result;
    try {
      console.log = (...items) => console.error(...items);
      result = await renderRecipe(root, PORT_TEMPLATES[template], {profile: "abap"});
    } finally { console.log = quiet; }
    results.push([`${name}.${ext}.abap`, result]);
    files[`${name}.${ext}.abap`] = result.text;
    files[`${name}.${ext}.xml`] = interface_ ? intfXml(name, descript) : classXml(model, name, descript);
    files[`${name}.${ext}.trace.json`] = sidecar(root, PORT_TEMPLATES[template], result);
  };
  for (const port of model.ports) {
    const {variants, binding, ...fields} = port;
    const portRoot = {...base, ...fields, port: port.name, "@id": port["@id"], set_line: port.set_line};
    await one(port.iface, "intf", portRoot, port.is_source ? "iface-source" : "iface-sink", `L3 port ${port.name} of ${model.set}`, true);
    for (const variant of variants) {
      if (!variant.generated) continue;
      const root = {...portRoot, "@id": variant["@id"], set_line: variant.set_line, variant: variant.name, class: variant.class,
        capture: variant.is_capture, dummy: variant.is_dummy};
      const template = port.is_source ? (variant.is_table ? "source-table" : "source-mem")
        : variant.is_log ? "sink-log" : variant.is_dummy ? "sink-dummy" : "sink-capture";
      await one(variant.class, "clas", root, template, `L3 port ${port.name}, variant ${variant.name}`);
    }
  }
  const setRoot = {...model};
  await one(model.ports_class, "clas", setRoot, "factory", `L3 ports of ${model.set}`);
  await one(model.exception, "clas", setRoot, "exception", `L3 port refusal of ${model.set}`);
  return {files, results};
}

export async function buildSet(file, out, options = {}) {
  const model = compileSet(file, {out, ...options});
  const rendered = await renderSet(model);
  mkdirSync(out, {recursive: true});
  for (const [name, content] of Object.entries(rendered.files)) writeFileSync(join(out, name), content);
  return {model, ...rendered};
}

// Regenerate into a scratch folder and compare byte for byte with `out`.
export async function checkSet(file, out, options = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "dsl-l3-"));
  try {
    const {files} = await buildSet(file, scratch, {...options, out});
    const drift = [];
    for (const name of Object.keys(files)) {
      let committed;
      try { committed = readFileSync(join(out, name)); } catch { drift.push(`${name}: missing in ${out}`); continue; }
      if (!committed.equals(readFileSync(join(scratch, name)))) drift.push(`${name}: differs from a fresh build`);
    }
    return drift;
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
}

// ---------------------------------------------------------------------------
// explain: an alert key down to the rule line and the generated check lines

// `<set>/<rule>/<model hash>/<check date>/<seq>`; the hash is the full
// `sha256:<hex>` or at least eight of its hex digits.
export function parseAlertKey(key) {
  const parts = String(key).split("/");
  if (parts.length !== 5) throw new Error(`an alert key is <set>/<rule>/<model hash>/<check date>/<seq>, got ${JSON.stringify(key)}`);
  const [set, rule, hash, date, seq] = parts;
  const hex = hash.replace(/^sha256:/, "");
  if (!/^[0-9a-f]{8,64}$/.test(hex)) throw new Error(`model hash ${hash} is sha256:<hex> or at least 8 of its hex digits`);
  if (!/^\d{8}$/.test(date)) throw new Error(`check date ${date} is YYYYMMDD`);
  if (!/^\d+$/.test(seq) || Number(seq) < 1) throw new Error(`alert sequence ${seq} is a number from 1`);
  return {set, rule, hash: hex, date, seq: Number(seq)};
}

function setFiles(root = "src") {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith(".l3.yaml")) found.push(join(dir, entry.name));
    }
  };
  if (existsSync(root)) walk(root);
  return found;
}

const git = (args) => spawnSync("git", args, {encoding: "utf8", maxBuffer: 64 * 1024 * 1024});

// The rule file and its check class's sidecar as they were when the class
// carried `hash`: the working tree when it still does, else the commit that
// wrote it, found by git's pickaxe on the sidecar.
function ruleVersion(entry, hash, base) {
  const ruleFile = join(base, entry.file);
  const sidecarPath = join(dirname(ruleFile), `${entry.check_class}.clas.trace.json`);
  const inRepo = (file) => relative(base, file).split(sep).join("/");
  const read = (file) => readFileSync(file, "utf8");
  const current = existsSync(sidecarPath) ? JSON.parse(read(sidecarPath)) : undefined;
  if (current?.model.replace(/^sha256:/, "").startsWith(hash)) {
    return {where: "the working tree", rule: read(ruleFile), check: read(sidecarPath.replace(/\.trace\.json$/, ".abap")), trace: current};
  }
  const log = git(["-C", base, "log", "--format=%H", "-S", hash, "--", inRepo(sidecarPath)]);
  for (const commit of log.status === 0 ? log.stdout.split("\n").filter(Boolean) : []) {
    const show = (file) => git(["-C", base, "show", `${commit}:${file}`]);
    const trace = show(inRepo(sidecarPath));
    if (trace.status !== 0) continue;
    const parsed = JSON.parse(trace.stdout);
    if (!parsed.model.replace(/^sha256:/, "").startsWith(hash)) continue;
    const rule = show(parsed.rule ?? inRepo(ruleFile));
    const check = show(inRepo(sidecarPath).replace(/\.trace\.json$/, ".abap"));
    if (rule.status !== 0 || check.status !== 0) continue;
    return {where: `commit ${commit.slice(0, 12)}`, rule: rule.stdout, check: check.stdout, trace: parsed};
  }
  return undefined;
}

function alertRow(db, key) {
  if (!db) return undefined;
  return import("node:sqlite").then(({DatabaseSync}) => {
    const handle = new DatabaseSync(db, {readOnly: true});
    try {
      return handle.prepare(`SELECT * FROM zosd_l3_alert WHERE set_name = ? AND rule_name = ? AND model_hash LIKE ?
        AND check_date = ? AND alert_seq = ?`).get(key.set, key.rule, `sha256:${key.hash}%`, key.date, key.seq);
    } finally { handle.close(); }
  });
}

// alert -> set and rule -> the rule version -> its alert line -> the lines of
// the generated check that trace to it. `row` is the alert row when known.
export async function explainAlert(key, {sets = setFiles(), db, row} = {}) {
  const k = typeof key === "string" ? parseAlertKey(key) : key;
  const found = sets.map((file) => ({file, model: compileSet(file)})).find((s) => s.model.set === k.set);
  if (!found) throw new Error(`no set ${k.set} in ${sets.map(path).join(", ") || "(no .l3.yaml found)"}`);
  const {model} = found;
  const entry = [...model.rules, ...model.disabled].find((r) => r.name === k.rule);
  if (!entry) throw new Error(`set ${k.set} (${path(found.file)}) has no rule ${k.rule}`);
  const top = git(["rev-parse", "--show-toplevel"]);
  const base = top.status === 0 ? top.stdout.trim() : process.cwd();
  const version = ruleVersion(entry, k.hash, base);
  if (!version) throw new Error(`rule ${k.rule}: no version with model hash ${k.hash} in the working tree or in git history of ${entry.file}`);
  const alertRowFound = row ?? await alertRow(db, k);
  const ruleLines = version.rule.split("\n");
  const ruleLine = alertRowFound?.rule_line ? Number(alertRowFound.rule_line) : Number(entry.alert_line);
  const checkLines = version.check.split("\n");
  const generated = version.trace.lines.filter((l) => l.rule_line === ruleLine).map((l) => l.line);
  const runnerTrace = JSON.parse(readFileSync(join(dirname(found.file), `${model.class}.clas.trace.json`), "utf8"));
  const runnerLines = runnerTrace.lines.filter((l) => l.node === entry["@id"]).map((l) => l.line);
  const out = [
    `alert   ${k.set}/${k.rule}/sha256:${k.hash.slice(0, 12)}.../${k.date}/${k.seq}`,
    ...(alertRowFound ? [`text    ${String(alertRowFound.alert_text).trimEnd()}`, `run     ${String(alertRowFound.run_id).trim()} at ${alertRowFound.run_ts}`] : []),
    `set     ${path(found.file)}:${entry.set_line}: ${readFileSync(found.file, "utf8").split("\n")[entry.set_line - 1].trim()}`,
    `rule    ${k.rule}, ${entry.file} as of ${version.where}, model ${version.trace.model}`,
    `line    ${entry.file}:${ruleLine}: ${(ruleLines[ruleLine - 1] ?? "").trim()}`,
    `check   ${entry.check_class}.clas.abap, ${generated.length} line(s) trace to rule line ${ruleLine}:`,
    ...generated.map((n) => `  ${String(n).padStart(5)}  ${checkLines[n - 1]}`),
    `runner  ${model.class}.clas.abap lines ${compress(runnerLines)} trace to set line ${entry.set_line}`,
  ];
  return {text: out.join("\n"), set: found.file, rule: entry, ruleLine, generated, runnerLines, version: version.where};
}

const compress = (numbers) => {
  const out = [];
  for (const n of numbers) {
    const last = out.at(-1);
    if (last && last[1] === n - 1) last[1] = n; else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");
};

async function main(args) {
  const [command, target, ...rest] = args;
  const ddic = [];
  const sets = [];
  let out, db;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--out") out = rest[++i];
    else if (rest[i] === "--ddic") ddic.push(rest[++i]);
    else if (rest[i] === "--set") sets.push(rest[++i]);
    else if (rest[i] === "--db") db = rest[++i];
    else throw new Error(`unknown argument ${rest[i]}`);
  }
  if (command === "explain" && target) {
    const {text} = await explainAlert(target, {...(sets.length ? {sets} : {}), db});
    console.log(text);
    return 0;
  }
  if (!["build", "check"].includes(command) || !target || !out) {
    console.error("Usage: node tools/dsl-l3.mjs <build|check> <set.l3.yaml> --out <dir> [--ddic <folder>]...\n"
      + "       node tools/dsl-l3.mjs explain <set>/<rule>/<model hash>/<date>/<seq> [--set <set.l3.yaml>]... [--db <sqlite file>]");
    return 2;
  }
  const options = ddic.length ? {ddic} : {};
  if (command === "check") {
    const drift = await checkSet(target, out, options);
    for (const line of drift) console.error(line);
    console.log(drift.length ? `${target}: ${drift.length} file(s) drifted; rebuild with: node tools/dsl-l3.mjs build ${target} --out ${out}`
      : `${target}: generated files match`);
    return drift.length ? 1 : 0;
  }
  const {files, findings} = await buildSet(target, out, options);
  for (const name of Object.keys(files)) console.log(`wrote ${join(out, name)}`);
  console.log(`abap profile: ${findings.length} finding(s)`);
  for (const f of findings) console.log(`${f.severity} ${f.file}:${f.line} ${f.rule}: ${f.text} (${f.node})`);
  return findings.some((f) => f.severity === "E") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // exit only once stdout and stderr have drained: a piped stdout is
  // asynchronous, and process.exit() right after console.log loses the output
  const flushThenExit = (code) => process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
  main(process.argv.slice(2)).then(flushThenExit, (error) => {
    console.error(error.message);
    flushThenExit(1);
  });
}
