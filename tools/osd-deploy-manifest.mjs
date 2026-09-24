// What may leave this repository for a real system: `deploy/manifest.json`.
//
// Why a list and not a rule (2026-09-24). This tree reimplements SAP's public
// API under SAP's own names -- CL_*, IF_*, CX_*, /IWBEP/*, /UI2/* -- and keeps
// kernel stand-ins beside it, and none of that may ever be imported into a
// system: an import of a class named like a delivered one overwrites the
// delivered one, or fails half-way and leaves rows behind. The zip used to
// copy every file of the folder it was given and refuse exactly one thing, an
// ICF node on a path the system delivers. That is a blocklist, and a
// blocklist is only as good as the last thing somebody thought of.
//
// So the zip is fail-closed now, twice over:
//
//  - **an object ships only if the unit names it.** A unit is one deployable
//    thing (the demo service, an app, a pack); its entry lists every object
//    by type and name. Anything else in the folder refuses the build;
//  - **an SAP-owned name is refused even when it is listed**, unless the
//    entry says why it is intended (`{"object": "...", "intended": "..."}`).
//    A listed name is somebody's claim; the naming rule is the check on the
//    claim.
//
// Every refusal names the file, the object and the rule it broke, and nothing
// is copied on the way to refusing.
import {existsSync, readFileSync} from "node:fs";
import {isAbsolute, join, relative, resolve} from "node:path";
import {rename} from "./osd-rename.mjs";

export const MANIFEST = "deploy/manifest.json";

/** The files of a folder that are structure rather than objects. The layout
 *  writes its own `package.devc.xml` and does **not** copy one found in the
 *  folder: the package is named at import time, and its description is the
 *  zip's `--description`, not whatever a pack happened to carry. */
const STRUCTURAL = new Set(["package.devc.xml"]);
export const isStructural = (file) => STRUCTURAL.has(file);

/** What may follow `<object>.<type>.` in an abapGit file name. Anything else
 *  -- `x.clas.abap.bak`, an editor's swap file, an upper-case `X.CLAS.abap`
 *  that abapGit would not find -- is refused, not copied: fail closed means
 *  a file this does not recognise does not travel. */
const SUFFIXES = {
  "*": /^(xml|abap)$/,
  CLAS: /^(xml|abap|testclasses\.abap|locals_imp\.abap|locals_def\.abap|macros\.abap)$/,
  FUGR: /^(xml|[a-z0-9_#-]+\.(abap|xml))$/,
  W3MI: /^(xml|data\.[a-z0-9]+)$/,
  WAPA: /^[a-z0-9_#.-]+$/,
  DDLS: /^(xml|asddls|baseinfo)$/,
  DDLX: /^(xml|asddlxs)$/,
  DCLS: /^(xml|asdcls)$/,
};
export function suffixProblem(file) {
  if (file !== file.toLowerCase()) return "abapGit file names are lower case";
  const m = /^(.+?)\.([a-z0-9]+)\.(.+)$/.exec(file);
  if (m === null) return "the file name is not <object>.<type>.<ext>";
  // the object part is ASCII: `zcl_\u0131` would upper-case to ZCL_I and
  // pass for a name it is not. Inner spaces are the padding of a versioned
  // name (IWSV, IWMO) and of an ICF node's file name.
  if (!/^[a-z0-9_#-]+(?: +[a-z0-9]+)?$/.test(m[1])) return `"${m[1]}" is not an object name ([a-z0-9_#-])`;
  const type = m[2].toUpperCase();
  const allowed = SUFFIXES[type] ?? SUFFIXES["*"];
  return allowed.test(m[3]) ? undefined : `".${m[3]}" is not a suffix abapGit writes for a ${type}`;
}

/** Names an object creates besides its own, where the XML already says so:
 *  the function modules of a function group and the SQL view of a DDLS. A
 *  Z function group holding SCMS_BINARY_TO_XSTRING would replace the
 *  system's module as surely as a class named CL_ would. */
export function createdNames(file, text) {
  const body = () => (typeof text === "function" ? text() : text);
  if (/\.fugr\.xml$/.test(file)) {
    return [...body().matchAll(/<FUNCNAME>([^<]+)<\/FUNCNAME>/g)].map((m) => ({kind: "FUNC", name: m[1].trim().toUpperCase()}));
  }
  if (/\.ddls\.asddls$/.test(file)) {
    // every spelling of the annotation: `@AbapCatalog.sqlViewName: 'X'`,
    // `@AbapCatalog: { sqlViewName: 'X' }`, and an extend view's
    // `sqlViewAppendName`, which creates an append view of its own
    return [...body().matchAll(/\bsqlView(Append)?Name\s*:\s*'([^']+)'/gi)]
      .map((m) => ({kind: m[1] === undefined ? "SQL view" : "SQL append view", name: m[2].trim().toUpperCase()}));
  }
  return [];
}

export function loadManifest(file = join(process.env.OSD_ROOT ?? process.cwd(), MANIFEST)) {
  if (!existsSync(file)) {
    throw new Error(`no deploy manifest at ${file}: nothing may leave for a system without one`);
  }
  const json = JSON.parse(readFileSync(file, "utf8"));
  if (json.version !== 1) throw new Error(`${file}: deploy manifest version ${json.version}, this tool reads 1`);
  return {...json, file};
}

/** The unit whose `sources` name this input, or the one asked for by name. */
export function unitFor(manifest, input, name) {
  const units = manifest.units ?? {};
  if (name !== undefined) {
    if (units[name] === undefined) {
      throw new Error(`deploy unit "${name}" is not in ${manifest.file} (units: ${Object.keys(units).join(", ")})`);
    }
    return withNamespaces(manifest, {name, ...units[name]});
  }
  const root = resolve(process.env.OSD_ROOT ?? process.cwd());
  const rel = (p) => relative(root, isAbsolute(p) ? p : resolve(p)).replace(/\/+$/, "");
  const want = rel(input);
  const hits = Object.entries(units).filter(([, u]) => (u.sources ?? []).some((s) => rel(join(root, s)) === want));
  if (hits.length === 1) return withNamespaces(manifest, {name: hits[0][0], ...hits[0][1]});
  if (hits.length > 1) {
    throw new Error(`${input} is a source of ${hits.length} deploy units (${hits.map(([n]) => n).join(", ")}): pass --unit`);
  }
  throw new Error(`${input} is not the source of any deploy unit in ${manifest.file}. `
    + `Pass --unit <name>, or add a unit that lists what this zip may carry.`);
}

/** The unit whose objects list this SEGW project (`IWPR <project>`). */
export function unitForProject(manifest, project, name) {
  if (name !== undefined) return unitFor(manifest, undefined, name);
  const key = `IWPR ${String(project).toUpperCase()}`;
  const hits = Object.entries(manifest.units ?? {})
    .filter(([n, u]) => entriesOf({name: n, ...u}).some((e) => e.matches(key)));
  if (hits.length === 1) return withNamespaces(manifest, {name: hits[0][0], ...hits[0][1]});
  throw new Error(hits.length === 0
    ? `no deploy unit in ${manifest.file} lists ${key}: pass --unit, or add a unit that lists what may carry it`
    : `${key} is in ${hits.length} deploy units (${hits.map(([n]) => n).join(", ")}): pass --unit`);
}

/** A unit's customer namespaces are the manifest's plus its own. */
function withNamespaces(manifest, unit) {
  return {...unit, customerNamespaces: [...(manifest.customerNamespaces ?? []), ...(unit.customerNamespaces ?? [])]};
}

// ------------------------------------------------------------ object names

/** `#iwbep#cl_x.clas.abap` -> {type: "CLAS", name: "/IWBEP/CL_X"}. Spaces
 *  inside a versioned name (`zstg_demo_srv     0001.iwsv.xml`) are padding,
 *  and collapse to one so the manifest can be read. */
export function objectOf(file, text) {
  if (STRUCTURAL.has(file)) return {structural: true};
  const m = /^(.+?)\.([a-z0-9]+)\./i.exec(file);
  if (m === null) return undefined;
  const type = m[2].toUpperCase();
  const name = m[1].replace(/#/g, "/").replace(/\s+/g, " ").trim().toUpperCase();
  if (type === "SICF") {
    // two nodes may share a name under different parents (the LSD player and
    // its WebSocket are both ZOSD_011_LSD), so a node is known by its URL,
    // and it is its ICF_NAME that has to be in the customer namespace
    const body = text?.() ?? "";
    const url = /<URL>([^<]*)/.exec(body)?.[1]?.replace(/\/+$/, "").toLowerCase();
    const icf = /<ICF_NAME>([^<]*)/.exec(body)?.[1]?.trim().toUpperCase() ?? m[1].slice(0, 15).trim().toUpperCase();
    return {type, name: icf, key: `SICF ${url ?? name}`};
  }
  return {type, name, key: `${type} ${name}`};
}

/** The rule an SAP-owned name breaks, or undefined for a customer name.
 *
 *  Customer names are Y* and Z*, and a /namespace/ only when the manifest
 *  declares it as ours. Everything else is SAP's: the public API we
 *  reimplement (CL_/IF_/CX_), any other /namespace/ -- /IWBEP/, /UI2/, and
 *  the /OSD/ of the kernel stand-ins alike -- and the standard DDIC. */
export function sapNameRule(name, customerNamespaces = []) {
  const ns = /^(\/[^/]+\/)/.exec(name)?.[1];
  if (ns !== undefined) {
    if (customerNamespaces.map((n) => n.toUpperCase()).includes(ns)) return undefined;
    return {rule: "foreign-namespace", why: `${ns} is not a customer namespace this manifest declares`};
  }
  if (/^(CL|IF|CX)_/.test(name)) {
    return {rule: "sap-api-name", why: "CL_/IF_/CX_ is SAP's public API, reimplemented here and never deployed"};
  }
  if (!/^[YZ]/.test(name)) {
    return {rule: "sap-name", why: "outside the customer namespace (Y*, Z*): a standard DDIC or other SAP-delivered name"};
  }
  return undefined;
}

/** Where each type's XML states the object's own name. abapGit creates the
 *  object under **that** name, not the file's -- its CLAS deserializer takes
 *  VSEOCLASS-CLSNAME -- so a `zcl_ok.clas.xml` carrying CL_GUI_ALV_GRID
 *  would pass a check of file names and replace the system's class. The
 *  file-derived name is only trusted when the XML says the same.
 *  `all: true` means every occurrence of the tag must be the object; the
 *  others hold other names too (W3MI's NAME is also each parameter's). */
export const NAME_TAGS = {
  CLAS: {tag: "CLSNAME", all: true},
  INTF: {tag: "CLSNAME", all: true},
  TABL: {tag: "TABNAME", all: true},
  DTEL: {tag: "ROLLNAME"},
  DOMA: {tag: "DOMNAME", all: true},
  SHLP: {tag: "SHLPNAME", all: true},
  TTYP: {tag: "TYPENAME"},
  VIEW: {tag: "VIEWNAME", all: true},
  ENQU: {tag: "VIEWNAME"},
  DDLS: {tag: "DDLNAME"},
  DDLX: {tag: "NAME"},
  DCLS: {tag: "DCLNAME"},
  // abapGit names a function group by its file (ms_item-obj_name); what the
  // XML adds is its includes, which must be the group's own, and its
  // modules, which createdNames() checks
  FUGR: {fromFile: true},
  MSAG: {tag: "ARBGB"},
  PROG: {tag: "NAME"},
  TRAN: {tag: "TCODE"},
  SAPC: {tag: "APPLICATION_ID", all: true},
  W3MI: {tag: "NAME"},
  W3HT: {tag: "NAME"},
  WAPA: {tag: "APPLNAME", all: true},
  IWPR: {tag: "PROJECT", all: true},
  IWSV: {tag: "TECHNICAL_NAME", version: "VERSION"},
  IWMO: {tag: "TECHNICAL_NAME", version: "VERSION"},
  IWVB: {tag: "TECHNICAL_NAME", version: "VERSION"},
};

/** Types that change an SAP object rather than add one of ours. */
const MODIFIES_SAP = new Set(["ENHO", "ENHS", "ENHC", "ENSC"]);

/** Why the XML of `obj` does not name it, or undefined when it does. */
export function nameTagProblem(obj, xml) {
  if (obj.type === "SICF") return undefined; // known by URL, named by ICF_NAME
  const spec = NAME_TAGS[obj.type];
  if (spec === undefined) return `no rule says where a ${obj.type} names itself, so its name cannot be checked`;
  if (xml === undefined) return `the object has no .${obj.type.toLowerCase()}.xml, so nothing states its name`;
  if (spec.fromFile === true) {
    const own = obj.name.startsWith("/") ? undefined : [`L${obj.name}`, `SAPL${obj.name}`];
    const stray = [...xml.matchAll(/<SOBJ_NAME>([^<]*)<\/SOBJ_NAME>/g)].map((m) => m[1].trim().toUpperCase())
      .filter((inc) => own !== undefined && !own.some((o) => inc.startsWith(o)));
    return stray.length === 0 ? undefined : `include ${stray[0]} is not one of the group's own (L${obj.name}*, SAPL${obj.name})`;
  }
  const values = [...xml.matchAll(new RegExp(`<${spec.tag}>([^<]*)</${spec.tag}>`, "g"))].map((m) => m[1].trim().toUpperCase());
  if (values.length === 0) return `its XML has no <${spec.tag}>`;
  const version = spec.version === undefined ? undefined : new RegExp(`<${spec.version}>([^<]*)<`).exec(xml)?.[1]?.trim();
  const own = (v) => (version === undefined ? v : `${v} ${version}`);
  const wrong = (spec.all === true ? values : values.slice(0, 1)).filter((v) => own(v) !== obj.name);
  return wrong.length === 0 ? undefined
    : `the file says ${obj.name} and its <${spec.tag}> says ${own(wrong[0])}; abapGit creates the one in the XML`;
}

// ------------------------------------------------------------ the unit

// no letters: rename() lower-cases what it renames when the entry is lower
// case (every SICF URL is), and a sentinel with letters would not survive it
const SENTINEL = "\u0001\u0002\u0001";

/** A matcher for one listed entry. `{nnn}` stands for an attempt number
 *  (three digits); a unit with `attempt: {from, to}` also accepts each name
 *  renamed the way `tools/osd-rename.mjs` renames an attempt. */
function matcherOf(entry, attempt) {
  const key = entry.replace(/\s+/g, " ").trim();
  const forms = [key];
  if (attempt?.from !== undefined && attempt?.to !== undefined) {
    const [type, ...rest] = key.split(" ");
    const renamed = `${type} ${rename(rest.join(" "), attempt.from, attempt.to.replaceAll("{nnn}", SENTINEL))}`;
    if (renamed !== key) forms.push(renamed);
  }
  const res = forms.map((f) => {
    const escaped = f.replaceAll("{nnn}", SENTINEL).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .split(SENTINEL).join("\\d{3}");
    return new RegExp(`^${escaped}$`, "i");
  });
  return (k) => res.some((re) => re.test(k));
}

function entriesOf(unit) {
  return (unit.objects ?? []).map((e) => (typeof e === "string" ? {object: e} : e))
    .map((e) => ({...e, matches: matcherOf(e.object, unit.attempt)}));
}

/** Check a folder's files (and the tables whose rows travel) against a unit.
 *  Returns the refusals; an empty list means everything may go. */
export function admit({files, read, tables = [], unit, customerNamespaces}) {
  if (unit === undefined) {
    return [{file: "(all)", key: "(all)", rule: "no-unit", why: "no deploy unit was given, so nothing is listed and nothing may go"}];
  }
  const namespaces = customerNamespaces ?? unit.customerNamespaces ?? [];
  const entries = entriesOf(unit);
  const refusals = [];
  const check = (file, obj) => {
    const entry = entries.find((e) => e.matches(obj.key));
    if (entry === undefined) {
      refusals.push({file, key: obj.key, rule: "not-in-manifest", why: `unit "${unit.name}" does not list it`});
    }
    const sap = sapNameRule(obj.name, namespaces);
    const intended = (entry?.intended ?? "").trim() !== "";
    if (sap !== undefined && !intended) {
      refusals.push({file, key: obj.key, ...sap});
    }
    if (MODIFIES_SAP.has(obj.type) && !intended) {
      refusals.push({file, key: obj.key, rule: "modifies-sap",
        why: `an ${obj.type} enhances an SAP object rather than adding one of ours`});
    }
    for (const c of obj.creates ?? []) {
      const rule = sapNameRule(c.name, namespaces);
      if (rule !== undefined && !intended) {
        refusals.push({file, key: `${obj.key} creates ${c.kind} ${c.name}`, rule: rule.rule, why: rule.why});
      }
    }
  };
  const named = new Map(); // "<object part>.<type>" -> obj, once per object
  for (const f of files) {
    const obj = objectOf(f, () => read(f));
    if (obj?.structural === true) continue;
    const problem = suffixProblem(f);
    if (obj === undefined || problem !== undefined) {
      refusals.push({file: f, key: obj?.key ?? "?", rule: "not-an-object", why: problem ?? "the file name is not <object>.<type>.<ext>"});
      continue;
    }
    const creates = createdNames(f, () => read(f));
    check(f, creates.length > 0 ? {...obj, creates} : obj);
    const stem = /^(.+?\.[a-z0-9]+)\./.exec(f)[1];
    if (!named.has(stem)) named.set(stem, obj);
  }
  for (const [stem, obj] of named) {
    const xmlFile = `${stem}.xml`;
    const problem = nameTagProblem(obj, files.includes(xmlFile) ? read(xmlFile) : undefined);
    if (problem !== undefined) {
      refusals.push({file: files.includes(xmlFile) ? xmlFile : stem, key: obj.key, rule: "name-not-stated", why: problem});
    }
  }
  for (const t of tables) {
    const name = t.replace(/#/g, "/").toUpperCase();
    check(`data/${t}.tabu.json`, {type: "TABU", name, key: `TABU ${name}`});
  }
  return refusals;
}

export function refusalMessage(from, refusals) {
  return `${from}: ${refusals.length} refusal(s), nothing may leave for a system until each is resolved:\n`
    + refusals.map((r) => `  ${r.key}  (${r.file})\n    ${r.rule}: ${r.why}`).join("\n")
    + `\nWhat ships is listed in ${MANIFEST}; an SAP-owned name ships only with "intended": "<why>" on its entry.`;
}
