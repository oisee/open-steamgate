// R1: concrete ABAP types, without changing abaplint or executing RAP.
import * as core from "@abaplint/core";
import {createHash} from "node:crypto";
import {basename, join, resolve} from "node:path";
import {existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {parseBdef} from "./bdef-parse.mjs";
import {parseDDLS} from "../cds2ddic.mjs";
import {resolveTree} from "../cds-tree.mjs";
import {contentFoldersOf, winningByLayer} from "../osd-packs.mjs";
import {nameOf} from "../osd-store-types.mjs";
import {libraryPath} from "../osd-lib-path.mjs";
import {runsAs} from "../osd-main.mjs";
import {fieldControl, runtimeOutputs} from "./rap-runtime-gen.mjs";
import {parseSrvd, serviceYaml} from "./srvd-gen.mjs";

const upper = s => s.toUpperCase();
const ident = s => /^[A-Z_%][A-Z0-9_%]*$/i.test(s);
const digest = s => createHash("sha256").update(s).digest("hex").slice(0, 16);
export function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e =>
    e.isSymbolicLink() || e.name.startsWith(".") ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}
const struct = (name, fields) => {
  if (!fields.length) throw new Error(`Empty RAP structure ${name}`);
  return `  TYPES: BEGIN OF ${name},\n${fields.map(([n, t]) => `           ${n} TYPE ${t},`).join("\n")}\n         END OF ${name}.\n`;
};
// Named includes preserve both direct fields and RAP component groups.
const included = (name, type, group, fields = []) => `  TYPES BEGIN OF ${name}.\n  INCLUDE TYPE ${type} AS ${group}.\n`
  + fields.map(([n, t]) => `  TYPES ${n} TYPE ${t}.\n`).join("") + `  TYPES END OF ${name}.\n`;

// R4: the administrative fields a managed BO fills itself, named by the
// element's @Semantics annotation (the public RAP contract: the framework
// stamps them on create and on change, which is what makes an `etag master`
// on a last-changed field change with every write)
const ADMIN = [
  ["CREATED_AT", /@Semantics\.systemDateTime\.createdAt\s*:\s*true/i],
  ["CREATED_BY", /@Semantics\.user\.createdBy\s*:\s*true/i],
  ["CHANGED_AT", /@Semantics\.systemDateTime\.lastChangedAt\s*:\s*true/i],
  ["CHANGED_BY", /@Semantics\.user\.lastChangedBy\s*:\s*true/i],
  ["LOCAL_CHANGED_AT", /@Semantics\.systemDateTime\.localInstanceLastChangedAt\s*:\s*true/i],
  ["LOCAL_CHANGED_BY", /@Semantics\.user\.localInstanceLastChangedBy\s*:\s*true/i],
];
export function adminOf(annotations) {
  const text = annotations.join("\n");
  return ADMIN.find(([, re]) => re.test(text))?.[0];
}

const featuredOpts = opts => (opts ?? []).some(o => o.name === "features" && o.value === "instance");

// R5 (docs/rap-runtime.md): the place of an entity in its business object's
// tree, read off the CDS associations the BDEF names. The parent is the
// target of the view's `association to parent` (when it is an entity of the
// same BDEF); each association of the BDEF must be one of the view's, end
// in an entity of the same BDEF, and carry key pairs; a create by
// association needs a composition. lock / etag / authorization dependent
// name the association to the parent.
export function treeOf(model, entity, view, projection = false) {
  const names = new Set(model.entities.map(e => upper(e.entity)));
  const cds = view.associations ?? [];
  const parent = cds.find(a => a.composition === "PARENT" && names.has(upper(a.target)));
  const assocs = entity.associations.map(a => {
    if (a.withDraft) throw new Error(`${entity.entity}\\${a.name}: association { with draft; } is outside R5 (draft has a track of its own)`);
    if (a.operations.some(o => o.kind !== "create")) throw new Error(`${entity.entity}\\${a.name}: link / unlink actions are outside R5`);
    if (projection !== !!a.use) throw new Error(`${entity.entity}\\${a.name}: ${projection ? "a projection uses an association (use association)" : "use association belongs to a projection"}`);
    const c = cds.find(x => upper(x.alias) === upper(a.name));
    if (!c) throw new Error(`${entity.entity}: association ${a.name} is no association of the CDS entity ${view.name}`);
    if (!names.has(upper(c.target))) throw new Error(`${entity.entity}\\${a.name}: its target ${c.target} is no entity of this behavior definition (associations to other business objects are outside R5)`);
    if (!(c.pairs ?? []).length) throw new Error(`${entity.entity}\\${a.name}: no key pairs (a composition takes them from the child's association to parent)`);
    const create = a.operations.find(o => o.kind === "create");
    if (create && c.composition !== "CHILD") throw new Error(`${entity.entity}\\${a.name}: create by association needs a composition`);
    return {name: a.name, target: upper(c.target), kind: c.composition === "CHILD" ? "C" : c.composition === "PARENT" ? "P" : "A",
      create: !!create, featCreate: !!create && featuredOpts(create.options), pairs: c.pairs};
  });
  if (projection) {
    // locking belongs to the interface layer; a projection that declares it
    // would say something nothing runs
    for (const clause of ["lock", "etag", "authorization"]) if (entity[clause]) throw new Error(`${entity.entity}: ${clause} ${entity[clause].kind} in a projection (it is the base's, R5)`);
  } else {
    // the association a dependency names must be one the BDEF declares
    for (const [clause, mode] of [["lock", entity.lock], ["etag", entity.etag], ["authorization", entity.authorization]]) {
      if (mode?.kind === "dependent" && mode.association && !entity.associations.some(a => upper(a.name) === upper(mode.association)))
        throw new Error(`${entity.entity}: ${clause} dependent by ${mode.association}, which the behavior definition does not declare (association ${mode.association};)`);
    }
    if (entity.lock?.kind === "master" && parent) throw new Error(`${entity.entity}: lock master on a child (it is locked with its root: lock dependent by ${parent.alias})`);
    for (const [clause, mode] of [["lock", entity.lock], ["etag", entity.etag], ["authorization", entity.authorization]]) {
      if (mode?.kind !== "dependent") continue;
      if (!parent) throw new Error(`${entity.entity}: ${clause} dependent without a parent (no association to parent in ${view.name})`);
      if (mode.association && upper(mode.association) !== upper(parent.alias)) throw new Error(`${entity.entity}: ${clause} dependent by ${mode.association}, which is not the association to the parent (${parent.alias})`);
    }
    if (!parent && entity.lock?.kind === "dependent") throw new Error(`${entity.entity}: lock dependent on a root`);
  }
  return {parent: parent ? upper(parent.target) : undefined, parentAssoc: parent?.alias, assocs};
}

// R5: a projection entity names its base entity (the base view of its
// projection view, an entity of a managed BDEF of the tree), maps its fields
// onto the base's, and only uses what the base declares
function projectionOf(plan, planned, plans) {
  const {entity, view} = planned;
  if (!view.projectionOf) throw new Error(`${entity.entity}: a projection behavior needs a projection view (as projection on), ${view.name} is not one`);
  const base = plans.filter(p => !p.projection).flatMap(p => p.entities.map(e => ({p, e}))).find(({e}) => upper(e.entity.entity) === upper(view.projectionOf));
  if (!base) throw new Error(`${entity.entity}: its base ${view.projectionOf} is no entity of a behavior definition of this tree`);
  if (plan.base && plan.base !== base.p) throw new Error(`${plan.root}: a projection of two behavior definitions`);
  plan.base = base.p;
  planned.base = base.e;
  for (const f of planned.fields) if (!f.from) throw new Error(`${entity.entity}.${f.name}: no base element`);
  const b = base.e.entity;
  const bhas = op => b.operations.some(o => o.kind === op && !o.use);
  for (const op of entity.operations) {
    if (!op.use) throw new Error(`${entity.entity}: a projection uses its operations (use ${op.kind})`);
    if (!bhas(op.kind)) throw new Error(`${entity.entity}: use ${op.kind}, which ${b.entity} does not declare`);
  }
  for (const a of entity.actions) {
    if (!a.use) throw new Error(`${entity.entity}~${a.name}: a projection's own actions are outside R5`);
    const own = b.actions.find(x => upper(x.name) === upper(a.name));
    if (!own) throw new Error(`${entity.entity}: use action ${a.name}, which ${b.entity} does not declare`);
    // R6: an internal action is not exposable, so no projection uses it
    if (own.modifiers.includes("internal")) throw new Error(`${entity.entity}: use action ${a.name}, which is internal to ${b.entity}`);
    // the projection's derived types are the base action's (factory %cid, result)
    Object.assign(a, {modifiers: own.modifiers, determine: own.determine, result: own.result, parameter: own.parameter, cardinality: own.cardinality});
  }
  for (const a of planned.tree.assocs) {
    const own = base.e.tree.assocs.find(x => upper(x.name) === upper(a.name));
    if (!own) throw new Error(`${entity.entity}: use association ${a.name}, which ${b.entity} does not declare`);
    if (a.create && !own.create) throw new Error(`${entity.entity}: use association ${a.name} { create; }, which ${b.entity} does not allow`);
  }
  for (const g of entity.fields) {
    if (g.attributes.some(x => x.name !== "readonly" || x.value)) throw new Error(`${entity.entity}: a projection's field control other than readonly is outside R5`);
  }
  if (entity.determinations.length || entity.validations.length || entity.mappings.length || entity.persistentTable || entity.numbering)
    throw new Error(`${entity.entity}: a projection has no determinations, validations, mapping, table or numbering of its own`);
  if (entity.implementationClass || plan.model.implementationClass) throw new Error(`${plan.root}: a projection's own behavior pool (augment, precheck) is outside R5`);
}

/** R5: what a projection entity serves, the base's behavior through its `use`s */
export function projectedBehavior(planned) {
  const {entity, base, fields} = planned;
  const used = op => entity.operations.some(o => o.kind === op);
  const baseControl = fieldControl(base.entity, base.fields);
  const control = new Map();
  for (const f of fields) {
    const c = {...(baseControl.get(upper(f.from)) ?? {readonly: "", mandatory: "", numbering: false})};
    if (entity.fields.some(g => g.fields.some(x => upper(x) === upper(f.name)))) c.readonly = "X";
    control.set(upper(f.name), c);
  }
  const baseEtag = base.entity.etag?.kind === "master" ? base.entity.etag.field : undefined;
  return {create: used("create"), update: used("update"), delete: used("delete"), control,
    actions: entity.actions.map(a => a.name),
    etag: entity.useEtag && baseEtag ? fields.find(f => upper(f.from) === upper(baseEtag))?.name : undefined};
}

// R6: the action shapes that run -- instance actions, internal, factory and
// determine actions; anything else is refused by name
function checkAction(entity, action, projection) {
  const where = `${entity.entity}~${action.name}`;
  if (action.use && !projection) throw new Error(`${where}: use action outside a projection`);
  const mods = action.modifiers ?? [];
  if (mods.includes("draft")) throw new Error(`${where}: draft ${action.determine ? "determine " : ""}actions are outside R6 (draft)`);
  if (mods.includes("static")) throw new Error(`${where}: static actions are outside R6`);
  if (mods.filter(m => m === "internal" || m === "factory").length > 1) throw new Error(`${where}: an internal factory action is outside R6`);
  // a flat parameter and a result type get their derived types here; the
  // runtime generator refuses running them (rap-runtime-gen.mjs)
  if (action.parameter?.deep || action.parameter?.table || action.result?.deep) throw new Error(`${where}: deep action parameters and results are outside R6`);
  if (mods.includes("factory") && action.result) throw new Error(`${where}: a factory action has no result (the new instance comes back in MAPPED)`);
  if (mods.includes("factory") && action.cardinality && action.cardinality !== "1") throw new Error(`${where}: a factory action has the cardinality [1]`);
  if (!action.determine || projection) return;
  for (const t of action.triggers ?? []) {
    const [owner, name] = t.name.includes("~") ? t.name.split("~") : [undefined, t.name];
    if (owner && ![entity.entity, entity.alias].filter(Boolean).some(n => upper(n) === upper(owner))) throw new Error(`${where}: ${t.kind} ${t.name} of another entity is outside R6`);
    if ((t.options ?? []).some(o => o.name !== "always")) throw new Error(`${where}: ${t.kind} ${t.name} with options other than always`);
    const list = t.kind === "determination" ? entity.determinations : entity.validations;
    const found = list.find(x => upper(x.name) === upper(name));
    if (!found) throw new Error(`${where}: ${t.kind} ${name}, which ${entity.entity} does not declare`);
    if (t.kind === "determination" && found.on !== "save") throw new Error(`${where}: determination ${name} is on modify; a determine action runs determinations on save`);
  }
}

// R5: the derived types of the associations of one entity
//   TABLE FOR CREATE e\_x        %tky, %cid_ref, %target (the target's create rows)
//   TABLE FOR READ IMPORT e\_x   %tky, %control (the target's fields)
//   TABLE FOR READ RESULT e\_x   the target's read result rows
//   TABLE FOR READ LINK e\_x     source-%tky, target-%tky
function associationTypes(plan, e, bind) {
  let out = "";
  const {entity, prefix: p} = e;
  const iface = plan.iface;
  const refs = new Set([entity.entity, `${plan.root}\\${entity.alias ?? entity.entity}`, `${plan.root}\\${entity.entity}`]);
  const local = [...new Set([entity.alias ?? entity.entity, entity.entity])];
  const pool = upper(entity.implementationClass ?? plan.model.implementationClass ?? "");
  for (const [k, a] of e.tree.assocs.entries()) {
    const t = plan.entities.find(x => upper(x.entity.entity) === a.target);
    const tp = t.prefix;
    const x = `${p}_x${k}`;
    out += included(`${x}_trow`, `${tp}_data`, "%data", [["%cid", "c LENGTH 128"], ["%control", `${tp}_control`]]);
    out += `  TYPES t_${x}_trow TYPE STANDARD TABLE OF ${x}_trow WITH DEFAULT KEY.\n`;
    out += included(`${x}_create`, `${p}_tky`, "%tky", [["%cid_ref", "c LENGTH 128"], ["%target", `t_${x}_trow`]]);
    out += `  TYPES t_${x}_create TYPE STANDARD TABLE OF ${x}_create WITH DEFAULT KEY.\n`;
    out += included(`${x}_rimport`, `${p}_tky`, "%tky", [["%control", `${tp}_control`]]);
    out += `  TYPES t_${x}_rimport TYPE STANDARD TABLE OF ${x}_rimport WITH DEFAULT KEY.\n`;
    out += struct(`${x}_link`, [["source", `${p}_features_key`], ["target", `${tp}_features_key`]]);
    out += `  TYPES t_${x}_link TYPE STANDARD TABLE OF ${x}_link WITH DEFAULT KEY.\n`;
    const kinds = [["CREATE", `${x}_create`], ["READ IMPORT", `${x}_rimport`], ["READ RESULT", `${tp}_read_result`], ["READ LINK", `${x}_link`]];
    for (const [kind, type] of kinds) {
      for (const ref of refs) {
        bind("TABLE", kind, `${ref}\\${a.name}`, `${iface}=>t_${type}`);
        bind("STRUCTURE", kind, `${ref}\\${a.name}`, `${iface}=>${type}`);
      }
      if (pool) for (const ref of local) bind(`POOL ${pool}`, kind, `${ref}\\${a.name}`, `${iface}=>t_${type}`);
    }
    e.assocTypes = [...(e.assocTypes ?? []), {name: a.name, prefix: x, target: t}];
  }
  return out;
}

/** Input files are already selected by content layer, never test/ or libraries' BDEFs. */
export function generate(files, dependencies = []) {
  const bdefs = files.filter(f => f.filename.endsWith(".bdef.asbdef"));
  const srvds = files.filter(f => f.filename.endsWith(".srvd.srvdsrv"));
  if (!bdefs.length && !srvds.length) return {outputs: {}, bindings: {}};
  const reg = new core.Registry(new core.Config(JSON.stringify({global: {files: "/**/*.*"}, syntax: {version: "open-abap", errorNamespace: "."}, rules: {}})));
  const ddic = f => /\.(ddls\.(asddls|xml)|tabl\.xml|view\.xml|dtel\.xml|doma\.xml)$/.test(f.filename);
  reg.addFiles(files.filter(ddic).map(f => new core.MemoryFile(f.filename, f.contents)));
  reg.addDependencies(dependencies.filter(ddic).map(f => new core.MemoryFile(f.filename, f.contents)));
  reg.parse();
  const views = new Map(reg.getObjectsByType("DDLS").map(o => {
    const view = parseDDLS(o, reg);
    // The CDS generator skips unsupported expressions; a type generator must
    // refuse them, since losing a component would change a method contract.
    let elements = 0;
    const visit = n => {
      if (n?.get?.().constructor.name === "CDSElement") elements++;
      for (const child of n?.getChildren?.() ?? []) visit(child);
    };
    visit(o.getParsedData()?.tree);
    if (view && !view.skip && elements !== view.fields.length + view.exposedAssociations.length) view.skip = "unsupported CDS elements";
    return [upper(o.getName()), view];
  }));
  // R5: composition pairs and projection associations need every view
  const parsedViews = [...views.values()].filter(v => v && !v.skip);
  resolveTree(parsedViews, views);
  const fieldsOf = (name, visiting = new Set()) => {
    const key = upper(name);
    if (visiting.has(key)) throw new Error(`Cyclic CDS type ${name}`);
    const next = new Set([...visiting, key]);
    const view = views.get(key);
    if (!view || view.skip || !view.fields.length) throw new Error(`Unresolved CDS entity ${name}${view?.skip ? `: ${view.skip}` : ""}`);
    const base = reg.getObject("TABL", view.source) ?? reg.getObject("VIEW", view.source);
    if (!base && !views.has(upper(view.source))) throw new Error(`Unresolved CDS entity ${view.source}`);
    const components = new Map((base?.parseType(reg)?.getComponents?.() ?? []).map(c => [upper(c.name), c.type]));
    const below = !base && views.has(upper(view.source)) ? fieldsOf(view.source, next) : [];
    return view.fields.map(f => {
      const type = components.get(upper(f.base));
      const sourceType = type && !type.containsVoid?.() && !/Unknown|Void/.test(type.constructor.name) ? type.toABAP() : below.find(b => upper(b.name) === upper(f.base))?.type;
      if (!f.virtual && !sourceType) throw new Error(`Unresolved CDS field ${name}.${f.name}`);
      const abap = f.abapType ?? sourceType;
      if (!ident(f.name) || !abap || /todo|unknown|void/i.test(abap)) throw new Error(`Unresolved CDS field ${name}.${f.name}`);
      return {name: f.name.toLowerCase(), type: abap, key: f.key, base: f.base, admin: adminOf(f.annotations ?? []),
        from: f.fromElement ? f.fromElement.toLowerCase() : undefined};
    });
  };
  const outputs = {}, bindings = {}, plans = [];
  const bind = (form, kind, ref, type) => {
    const key = upper(`${form} FOR ${kind} ${ref}`);
    if (bindings[key] && bindings[key] !== type) throw new Error(`Ambiguous RAP reference ${ref}`);
    bindings[key] = type;
  };
  // R5: a projection BDEF is resolved against its base, so the bases go first
  const ordered = bdefs.map(file => ({file, model: parseBdef(file.contents)}))
    .sort((a, b) => (a.model.implementationType === "projection") - (b.model.implementationType === "projection"));
  for (const {file, model} of ordered) {
    if (model.unparsed.length) throw new Error(`${file.filename}: unparsed BDEF grammar`);
    const projection = model.implementationType === "projection";
    if (model.implementationType !== "managed" && model.implementationType !== "unmanaged" && !projection) throw new Error(`${file.filename}: unsupported ${model.implementationType} BDEF (interface BDEFs are outside R5)`);
    const root = basename(file.filename).replace(/\.bdef\.asbdef$/, "");
    const iface = `zif_rap_${digest(upper(root))}`;
    let body = `INTERFACE ${iface} PUBLIC.\n`;
    const responses = new Map();
    const plan = {root, iface, model, entities: [], projection};
    plans.push(plan);
    for (const [index, entity] of model.entities.entries()) {
      if (entity.functions.length) throw new Error(`${entity.entity}~${entity.functions[0].name}: functions are outside R6`);
      // R6: a determine action is an action whose body is the runtime's: it
      // joins the actions (types, %action, the service) marked determine
      for (const d of entity.determineActions) entity.actions.push({...d, determine: true});
      entity.determineActions = [];
      const p = `e${index}`;
      const fields = fieldsOf(entity.entity);
      const view = views.get(upper(entity.entity));
      const planned = {entity, prefix: p, fields, source: view.source, view};
      plan.entities.push(planned);
      planned.tree = treeOf(model, entity, view, projection);
      if (projection) projectionOf(plan, planned, plans);
      if (entity.persistentTable && !reg.getObject("TABL", entity.persistentTable)) throw new Error(`${entity.entity}: missing persistent table ${entity.persistentTable}`);
      for (const mapping of entity.mappings) {
        const table = reg.getObject("TABL", mapping.table);
        if (!table) throw new Error(`${entity.entity}: missing mapping table ${mapping.table}`);
        const columns = table.parseType(reg)?.getComponents?.() ?? [];
        for (const field of mapping.fields) {
          if (!fields.some(f => upper(f.name) === upper(field.field))) throw new Error(`${entity.entity}: unknown mapping field ${field.field}`);
          if (!columns.some(c => upper(c.name) === upper(field.column))) throw new Error(`${entity.entity}: unknown mapping column ${mapping.table}.${field.column}`);
        }
      }
      const keys = fields.filter(f => f.key);
      if (!keys.length) throw new Error(`${entity.entity}: no CDS key`);
      const pairs = fs => fs.map(f => [f.name, f.type]);
      body += struct(`${p}_key`, pairs(keys));
      body += included(`${p}_pky`, `${p}_key`, "%key", entity.numbering === "late" ? [["%pid", "x LENGTH 16"]] : []);
      body += included(`${p}_tky`, `${p}_pky`, "%pky", model.withDraft ? [["%is_draft", "x LENGTH 1"]] : []);
      body += struct(`${p}_control`, fields.map(f => [f.name, "x LENGTH 1"]));
      // %data includes all CDS fields with a key group; %tky shares its key fields.
      body += included(`${p}_data`, `${p}_tky`, "%tky", pairs(fields.filter(f => !f.key)));
      body += struct(`${p}_fail`, [["cause", "i"]]);
      const opFields = entity.operations.map(o => [`%${o.kind}`, "x LENGTH 1"]);
      if (entity.actions.length) {
        body += struct(`${p}_actions`, entity.actions.map(a => [a.name.toLowerCase(), "x LENGTH 1"]));
        opFields.push(["%action", `${p}_actions`]);
      }
      if (opFields.length) body += struct(`${p}_op`, opFields);
      const refs = new Set([entity.entity, `${root}\\${entity.alias ?? entity.entity}`, `${root}\\${entity.entity}`]);
      // R3: the implicit handler forms name an entity by its alias or CDS name,
      // resolved against the behavior definition of the pool they are in
      const pool = upper(entity.implementationClass ?? model.implementationClass ?? "");
      const local = [...new Set([entity.alias ?? entity.entity, entity.entity])];
      const poolBind = (kind, ref, type) => { if (pool) bind(`POOL ${pool}`, kind, ref, type); };
      for (const kind of ["CREATE", "UPDATE", "DELETE", "READ IMPORT", "READ RESULT", "MAPPED", "FAILED", "REPORTED", "LOCK", "KEY OF", "DETERMINATION", "VALIDATION"]) {
        if (["CREATE", "UPDATE", "DELETE"].includes(kind) && !entity.operations.some(o => upper(o.kind) === kind)) continue;
        const name = `${p}_${kind.toLowerCase().replaceAll(" ", "_")}`;
        const fullData = ["CREATE", "UPDATE", "READ RESULT"].includes(kind);
        const extra = [];
        if (["CREATE", "MAPPED", "FAILED", "REPORTED"].includes(kind)) extra.push(["%cid", "c LENGTH 128"]);
        if (["UPDATE", "DELETE"].includes(kind)) extra.push(["%cid_ref", "c LENGTH 128"]);
        if (["CREATE", "UPDATE", "READ IMPORT"].includes(kind)) extra.push(["%control", `${p}_control`]);
        if (kind === "FAILED") extra.push(["%fail", `${p}_fail`], ...(opFields.length ? [["%op", `${p}_op`]] : []));
        if (kind === "REPORTED") extra.push(["%msg", "REF TO object"], ["%element", `${p}_control`], ["%state_area", "c LENGTH 128"], ["%global", "x LENGTH 1"]);
        body += included(name, `${p}_${fullData ? "data" : "tky"}`, fullData ? "%data" : "%tky", extra);
        body += `  TYPES t_${name} TYPE STANDARD TABLE OF ${name} WITH DEFAULT KEY.\n`;
        for (const ref of local) poolBind(kind, ref, `${iface}=>t_${name}`);
        for (const ref of refs) {
          bind("TABLE", kind, ref, `${iface}=>t_${name}`);
          bind("STRUCTURE", kind, ref, `${iface}=>${name}`);
          if (["MAPPED", "FAILED", "REPORTED"].includes(kind)) {
            bind("TABLE", `${kind} EARLY`, ref, `${iface}=>t_${name}`);
            bind("STRUCTURE", `${kind} EARLY`, ref, `${iface}=>${name}`);
          }
        }
        if (["MAPPED", "FAILED", "REPORTED"].includes(kind)) {
          const list = responses.get(kind) ?? [];
          list.push([(entity.alias ?? entity.entity).toLowerCase(), `t_${name}`]); responses.set(kind, list);
        }
      }
      // R4: instance feature control. The result row is the key and the
      // %features group (%update, %delete, %action-<a>, %field-<f>, each an
      // if_abap_behv=>fc-o / fc-f value), the request the same flags
      const creating = entity.associations.filter(a => a.operations.some(o => o.kind === "create"));
      if (creating.length) body += struct(`${p}_assocs`, creating.map(a => [a.name.toLowerCase(), "x LENGTH 1"]));
      const featureFields = [
        ...entity.operations.filter(o => !o.use && o.kind !== "create").map(o => [`%${o.kind}`, "x LENGTH 1"]),
        ...(entity.actions.length ? [["%action", `${p}_actions`]] : []),
        ...(creating.length ? [["%assoc", `${p}_assocs`]] : []),
        ["%field", `${p}_control`],
      ];
      body += struct(`${p}_feat`, featureFields);
      body += included(`${p}_features_key`, `${p}_tky`, "%tky");
      body += `  TYPES t_${p}_features_key TYPE STANDARD TABLE OF ${p}_features_key WITH DEFAULT KEY.\n`;
      body += `  TYPES BEGIN OF ${p}_features_result.\n  INCLUDE TYPE ${p}_tky AS %tky.\n  INCLUDE TYPE ${p}_feat AS %features.\n  TYPES END OF ${p}_features_result.\n`;
      body += `  TYPES t_${p}_features_result TYPE STANDARD TABLE OF ${p}_features_result WITH DEFAULT KEY.\n`;
      for (const ref of refs) {
        bind("TABLE", "INSTANCE FEATURES KEY", ref, `${iface}=>t_${p}_features_key`);
        bind("STRUCTURE", "INSTANCE FEATURES KEY", ref, `${iface}=>${p}_features_key`);
        bind("STRUCTURE", "INSTANCE FEATURES REQUEST", ref, `${iface}=>${p}_feat`);
        bind("TABLE", "INSTANCE FEATURES RESULT", ref, `${iface}=>t_${p}_features_result`);
        bind("STRUCTURE", "INSTANCE FEATURES RESULT", ref, `${iface}=>${p}_features_result`);
      }
      for (const ref of local) {
        poolBind("INSTANCE FEATURES KEY", ref, `${iface}=>t_${p}_features_key`);
        poolBind("INSTANCE FEATURES REQUEST", ref, `${iface}=>${p}_feat`);
        poolBind("INSTANCE FEATURES RESULT", ref, `${iface}=>t_${p}_features_result`);
      }
      for (const [a, action] of entity.actions.entries()) {
        checkAction(entity, action, projection);
        const param = action.parameter ? fieldsOf(action.parameter.name) : undefined;
        if (param) body += struct(`${p}_a${a}_param`, pairs(param));
        for (const kind of ["IMPORT", "RESULT"]) {
          if (kind === "RESULT" && !action.result) continue;
          const extra = [];
          // R6: a factory action's import carries the %cid the new instance is mapped under
          if (kind === "IMPORT") extra.push(...(action.modifiers.includes("factory") ? [["%cid", "c LENGTH 128"]] : []), ["%cid_ref", "c LENGTH 128"], ...(param ? [["%param", `${p}_a${a}_param`]] : []));
          else {
            const result = action.result.type === "$self" ? fields : fieldsOf(action.result.type);
            body += struct(`${p}_a${a}_payload`, pairs(result));
            extra.push(["%param", `${p}_a${a}_payload`]);
          }
          const name = `${p}_a${a}_${kind.toLowerCase()}`;
          body += included(name, `${p}_tky`, "%tky", extra);
          body += `  TYPES t_${name} TYPE STANDARD TABLE OF ${name} WITH DEFAULT KEY.\n`;
          for (const ref of refs) for (const form of ["TABLE", "STRUCTURE"]) bind(form, `ACTION ${kind}`, `${ref}~${action.name}`, `${iface}=>${form === "TABLE" ? "t_" : ""}${name}`);
          for (const ref of local) poolBind(`ACTION ${kind}`, `${ref}~${action.name}`, `${iface}=>t_${name}`);
        }
      }
    }
    // R5: the derived types of every association of the BDEF, once the
    // types of all its entities exist (a parent may come before its child)
    for (const e of plan.entities) body += associationTypes(plan, e, bind);
    for (const [kind, fields] of responses) {
      if (fields.some(([n]) => !ident(n))) throw new Error(`${root}: response aliases must be ABAP identifiers`);
      const name = `r_${kind.toLowerCase()}`;
      body += struct(name, fields);
      for (const phase of ["", " EARLY"]) bind("RESPONSE", kind + phase, root, `${iface}=>${name}`);
      for (const pool of new Set([model.implementationClass, ...model.entities.map(e => e.implementationClass)].filter(Boolean).map(upper))) {
        bind(`POOL ${pool}`, "RESPONSE", kind, `${iface}=>${name}`);
      }
    }
    outputs[`${iface}.intf.abap`] = body + "ENDINTERFACE.\n";
  }
  // R2c: a service definition becomes a stg-compile model in gen/rap/
  const entityOf = name => {
    const view = views.get(upper(name));
    if (!view || view.skip) throw new Error(`Unresolved CDS entity ${name}${view?.skip ? `: ${view.skip}` : ""}`);
    const fields = fieldsOf(name);
    const owner = plans.flatMap(p => p.entities.map(e => ({p, e}))).find(({e}) => upper(e.entity.entity) === upper(name));
    if (!owner) return {view, fields};
    const {entity} = owner.e;
    // R5: a child is created through its parent's association, so its set
    // takes a POST (through the navigation) when a parent creates it
    const created = owner.p.entities.some(x => x.tree.assocs.some(a => a.create && a.target === upper(entity.entity)));
    const assocs = owner.e.tree.assocs;
    if (owner.p.projection) return {view, fields, assocs, behavior: {...projectedBehavior(owner.e), create: projectedBehavior(owner.e).create || created}};
    const has = op => entity.operations.some(o => o.kind === op && !o.use);
    return {view, fields, assocs, behavior: {create: has("create") || created, update: has("update"), delete: has("delete"),
      // R6: an internal action is the BO's own, never the service's
      control: fieldControl(entity, fields), actions: entity.actions.filter(a => !a.modifiers.includes("internal")).map(a => a.name),
      // R4: the `etag master` element is the entity type's ETag
      etag: entity.etag?.kind === "master" ? entity.etag.field : undefined}};
  };
  for (const file of srvds) {
    const srvd = parseSrvd(file.contents, file.filename);
    const stem = basename(file.filename).replace(/\.srvd\.srvdsrv$/, "");
    // abapGit writes the namespace of /DMO/FLIGHT_LEGACY as `#`: the file is
    // #dmo#flight_legacy (nameOf decodes, osd-store-types.mjs)
    if (nameOf(stem) !== srvd.name) throw new Error(`${file.filename}: defines ${srvd.name}`);
    outputs[`${stem.toLowerCase()}.stg.yaml`] = serviceYaml(srvd, entityOf, file.filename);
  }
  return {outputs, bindings, plans};
}

export function main() {
  const root = process.env.OSD_ROOT ?? process.cwd();
  const paths = winningByLayer(contentFoldersOf(root).map(f => resolve(root, f)), walk, f => basename(f).toLowerCase());
  const files = paths.filter(f => /\.(bdef\.asbdef|srvd\.srvdsrv|ddls\.(asddls|xml)|tabl\.xml|view\.xml|dtel\.xml|doma\.xml)$/.test(f)).map(f => ({filename: basename(f), contents: readFileSync(f, "utf8")}));
  const out = join(root, "gen/rap");
  // No dependencies or output when there are no BDEFs; remove stale generated types.
  if (!files.some(f => f.filename.endsWith(".bdef.asbdef") || f.filename.endsWith(".srvd.srvdsrv"))) { rmSync(out, {recursive: true, force: true}); return; }
  const deps = [];
  for (const name of ["open-abap-core", "open-abap-odata"]) {
    const dir = join(libraryPath(root, name), "src");
    deps.push(...walk(dir).filter(f => /\.(tabl|view|dtel|doma)\.xml$/.test(f)).map(f => ({filename: basename(f), contents: readFileSync(f, "utf8")})));
  }
  const {outputs, bindings, plans} = generate(files, deps);
  // the runtime adapters read the behavior pools named by the BDEFs (R2)
  const pools = new Set((plans ?? []).map(p => (p.model.implementationClass ?? "").toLowerCase().replaceAll("/", "#")).filter(Boolean));
  const poolFiles = paths.filter(f => pools.has(basename(f).toLowerCase().split(".")[0]) && /\.clas\.(locals_imp\.|locals_def\.)?abap$/i.test(f))
    .map(f => ({filename: basename(f), contents: readFileSync(f, "utf8")}));
  Object.assign(outputs, runtimeOutputs(plans ?? [], poolFiles));
  mkdirSync(out, {recursive: true});
  outputs["bindings.json"] = JSON.stringify(bindings, null, 2) + "\n";
  for (const file of readdirSync(out)) if (!(file in outputs)) rmSync(join(out, file), {recursive: true, force: true});
  for (const [file, contents] of Object.entries(outputs)) writeFileSync(join(out, file), contents);
  console.log(`bdef-gen: ${Object.keys(outputs).filter(f => f.endsWith(".intf.abap")).length} type interfaces, ${Object.keys(outputs).filter(f => f.endsWith(".clas.abap")).length} runtime classes, ${Object.keys(outputs).filter(f => f.endsWith(".stg.yaml")).length} service definitions`);
}
if (runsAs("bdef-gen.mjs")) main();
