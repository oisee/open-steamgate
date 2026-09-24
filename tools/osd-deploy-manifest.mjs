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
 *  writes its own `package.devc.xml`; one in the folder is the package's
 *  description, and a package is named at import time, not by the file. */
const STRUCTURAL = new Set(["package.devc.xml"]);

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
    return {name, ...units[name]};
  }
  const root = resolve(process.env.OSD_ROOT ?? process.cwd());
  const rel = (p) => relative(root, isAbsolute(p) ? p : resolve(p)).replace(/\/+$/, "");
  const want = rel(input);
  const hits = Object.entries(units).filter(([, u]) => (u.sources ?? []).some((s) => rel(join(root, s)) === want));
  if (hits.length === 1) return {name: hits[0][0], ...hits[0][1]};
  if (hits.length > 1) {
    throw new Error(`${input} is a source of ${hits.length} deploy units (${hits.map(([n]) => n).join(", ")}): pass --unit`);
  }
  throw new Error(`${input} is not the source of any deploy unit in ${manifest.file}. `
    + `Pass --unit <name>, or add a unit that lists what this zip may carry.`);
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

// ------------------------------------------------------------ the unit

const SENTINEL = "\u0001NNN\u0001";

/** A matcher for one listed entry. `{nnn}` stands for an attempt number
 *  (three digits); a unit with `attempt: {from, to}` also accepts each name
 *  renamed the way `tools/osd-rename.mjs` renames an attempt. */
function matcherOf(entry, attempt) {
  const key = entry.replace(/\s+/g, " ").trim();
  const forms = [key];
  if (attempt?.from !== undefined && attempt?.to !== undefined) {
    const [type, ...rest] = key.split(" ");
    const renamed = `${type} ${rename(rest.join(" "), attempt.from, attempt.to.replace("{nnn}", SENTINEL))}`;
    if (renamed !== key) forms.push(renamed);
  }
  const res = forms.map((f) => {
    const escaped = f.replace("{nnn}", SENTINEL).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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
    if (sap !== undefined && (entry?.intended ?? "").trim() === "") {
      refusals.push({file, key: obj.key, ...sap});
    }
  };
  for (const f of files) {
    const obj = objectOf(f, () => read(f));
    if (obj?.structural === true) continue;
    if (obj === undefined) {
      refusals.push({file: f, key: "?", rule: "not-an-object", why: "the file name is not <object>.<type>.<ext>"});
      continue;
    }
    check(f, obj);
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
