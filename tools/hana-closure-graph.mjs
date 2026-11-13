// The structural half of the closure walk (H5x-2): what an island object
// REFERENCES, as data instead of issue text, and the exclusion decision as a
// graph analysis over those references.
//
// `references(registry, file)` (graph-closure/REPORT.md §3, proto/lib-refs.mjs)
// runs ONE SyntaxLogic pass per object -- the same parse the build's own
// validation runs -- and returns the object's unknown references:
//     [{name, kind, line, level: "definition" | "method" | "signature",
//       method?, via, reason?}]
// The carriers, measured on the pinned core (probes/probe-*.mjs):
// - void and unknown object references (`Object (Void)`/`Object (Unknown)`,
//   extra.ooName/ooType carry the qualified name) -- a missing interface in a
//   TYPE REF TO, a missing INTERFACES;
// - scope vars/types whose type is UnknownType -- the `contains unknown: X
//   not found` carrier; the error text keeps the fix keyword
//   (lookup/lookupDataElement/lookupDomain), so the DTEL/DOMA kind split of
//   the text classifier survives structurally; qualified types
//   (`TYPE zif=>field`) arrive as `Could not resolve top X`;
// - what the scope result does NOT record (measured): a missing SUPERCLASS, a
//   GLOBAL FRIENDS name, a SELECT FROM a missing table, `STANDARD TABLE OF` a
//   missing name, RAISE/CATCH/CREATE OBJECT and static calls. The first two
//   are read off the parsed CLASS DEFINITION statement here (the report's
//   "or comes from SEOCLASS/parse of the definition statement"); the rest
//   stay text-classifier asks (tools/hana-closure-exclude.mjs keeps exactly
//   those shapes -- member cascades counted, never asked, statement-level
//   class references asked).
// Level comes from the scope chain: class/interface scopes are
// "definition", METHOD scopes "method" (+name), method_definition scopes
// (signatures) "signature" (+name, from the METHODS statement). Unknowns are
// deduped by file+name+line visiting top-down, so a definition attribute
// echoed into a method scope keeps its definition level.
//
// The exclusion decision (graphDecide) replaces the text-finding machinery of
// #933 (exclusionDecisions/statusOf, deleted): the island's dependency graph
// has an edge per definition-level reference between island objects, SCCs
// give the cycles of present objects, and
// - a ROOT is an object whose definition references a name answered missing
//   (or whose definition findings name nothing -- parse garbage), never a
//   friend name (FRIENDS is soft: strip the clause, never exclude);
// - a dependent that cannot compile without a root -- definition-level
//   reference, transitively -- is excluded with it ({level: "cascade",
//   of: [roots]}); method-level references stub instead;
// - a cycle of present objects that names only each other is KEPT
//   ({level: "cycle", members}) -- the transpiler resolves a real cycle when
//   all members are present, so a residual cycle is a checker limit;
// - the walk's seed classes (MPC/DPC/_EXT) are never excluded: the run fails
//   with the object and its findings;
// - decided only when no definition-level name is pending, re-decided per
//   iteration (the loop wipes the excluded set whenever the island grows).
import {readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import * as abaplint from "@abaplint/core";
import {loadFiles, loadLibs} from "./osd-transpile.mjs";
import {excludePatterns, layers} from "./osd-inputs.mjs";
import {orderRegistry} from "./osd-warm-order.mjs";

const ST = abaplint.ScopeType;
const UnknownType = abaplint.BasicTypes.UnknownType;

// the analysis registry's syntax settings: the same dialect the build's
// validation runs under (OpenABAP, everything unknown is an error)
const CONFIG = {global: {files: "/**/*.*"}, syntax: {version: abaplint.Version.OpenABAP, errorNamespace: "."}, rules: {}};

// an abapGit file name's object part to the name it stands for (the
// namespace escaped as #ns#) -- the classifier's one rule, shared
import {classifyFindings, nameFromAbapFile} from "./hana-closure-exclude.mjs";

const fileObject = (filename) => {
  const base = String(filename ?? "").split("/").pop() ?? "";
  const m = /^(.+?)\.(?:clas(?:\.locals_(?:imp|def))?|intf)\.abap$/.exec(base);
  return m === null ? undefined : nameFromAbapFile(m[1]);
};
const baseName = (filename) => String(filename ?? "").split("/").pop() ?? "";

const objectKind = (name) => (/^if/i.test(name) ? "intf" : "clas");

// the missing name inside an UnknownType's error text, best effort, with the
// carrier tagged: qual = a type-chain top (a code kind), lookup = a DDIC
// name, const = resolveConstantValue's named object. Order matters: the
// resolveConstantValue wording contains "X not found" as a substring of
// itself ("...Value, not found: Y" would match the bare shape with VALUE).
const NAME_IN_ERROR = [
  [/Could not resolve top ([A-Za-z0-9_\/#]+)/i, "qual"],
  [/unable to resolve ([A-Za-z0-9_\/#]+)/i, "qual"],
  [/resolveConstantValue, not found: ([A-Za-z0-9_\/#]+)/i, "const"],
  [/([A-Za-z0-9_\/#]+) not found/i, "lookup"],
  [/([A-Za-z0-9_\/#]+) unknown/i, "lookup"],
];
// the fix keyword the type lookup left in the error text: it preserves the
// text classifier's DTEL/DOMA kind split
const FIX_IN_ERROR = /,\s*(lookup[A-Za-z]*)\s*$/;

// one reference's unknown, or undefined: the carrier map above. `rt` is the
// readable ReferenceType value ("Object (Void)" and friends).
const fromRef = (ref) => {
  const rt = String(ref.referenceType ?? "");
  const extra = ref.extra ?? {};
  const resolvedName = () => (ref.resolved !== undefined && ref.resolved !== null ? String(ref.resolved.getName()).toUpperCase() : "");
  if (rt === "Object (Unknown)" || rt === "Object (Void)") {
    const name = String(extra.ooName ?? resolvedName() ?? "").toUpperCase();
    if (/^[A-Z0-9_/#$]+$/.test(name) === false) return undefined;
    return {name, kind: "object", ooType: extra.ooType === undefined ? undefined : String(extra.ooType).toUpperCase(), via: rt === "Object (Unknown)" ? "unknown" : "void"};
  }
  if (rt === "Table (Void)" || rt === "Table" && ref.resolved !== undefined && ref.resolved !== null && resolvedName() !== "" &&
      ref.resolved.getType?.()?.constructor?.name === "VoidType") {
    const name = resolvedName();
    if (name === "") return undefined;
    return {name, kind: "table", via: "void"};
  }
  if (rt === "Type (Void)") {
    const name = resolvedName();
    if (name === "" || name.startsWith("<")) return undefined;
    return {name, kind: "type", via: "void"};
  }
  if (rt === "Type" && ref.resolved !== undefined && ref.resolved !== null &&
      ref.resolved.getType() instanceof UnknownType) {
    const reason = String(ref.resolved.getType().getError?.() ?? "");
    const fix = FIX_IN_ERROR.exec(reason)?.[1];
    return {name: String(ref.resolved.getName()).toUpperCase(), kind: "type", via: "unknown-type",
      ...(reason !== "" ? {reason} : {}), ...(fix !== undefined ? {fix} : {})};
  }
  return undefined;
};

// one scope var/type whose type is UnknownType: the `contains unknown` and
// `Could not resolve top` carrier. A SELECT's INTO variable names no table
// ("Select, buildStructureTypeError not found") and a field-symbol names no
// object: both are skipped -- the SELECT shapes stay text asks.
const fromIdentifier = (identifier, varName) => {
  const type = identifier.getType();
  if (!(type instanceof UnknownType)) return undefined;
  const reason = String(type.getError?.() ?? "");
  if (/^Select,/i.test(reason) === true) return undefined;
  for (const [re, tag] of NAME_IN_ERROR) {
    const m = re.exec(reason);
    if (m === null) continue;
    const name = m[1].toUpperCase();
    if (name.startsWith("<") === true || /^[A-Z0-9_/#$]+$/.test(name) === false) return undefined;
    const fix = FIX_IN_ERROR.exec(reason)?.[1];
    return {name, kind: "type", via: tag, reason, ...(varName !== undefined ? {var: String(varName).toUpperCase()} : {}), ...(fix !== undefined ? {fix} : {})};
  }
  return undefined;
};

/** the TADIR-ish kind a request asks an unknown under: the classifier's
 *  vocabulary (tabl/dtel/doma/ddic/clas/intf), derived from the carrier --
 *  ooType for object references, the error text's fix keyword for type
 *  lookups, the name prefix for qualified type chains. Pure. */
export function requestKindOf(name, u = {}) {
  if (u.via === "super" || u.via === "friends") return "clas";
  if (u.kind === "table") return "tabl";
  if (u.kind === "object") return u.ooType === "INTF" ? "intf" : objectKind(name);
  if (u.via === "qual" || u.via === "const") return objectKind(name);
  if (u.fix === "lookupDataElement") return "dtel";
  if (u.fix === "lookupDomain") return "doma";
  return "ddic";
}

/** one island object's structural analysis: one SyntaxLogic pass over the
 *  registry (the build's own file set, so "unknown" means "the build does
 *  not provide it"), attributed per file (a class's locals include is its
 *  own bucket), plus the definition-statement references the scope result
 *  does not record (superclass, GLOBAL FRIENDS). Pure. */
export function analyseObject(reg, filename) {
  const owner = fileObject(filename);
  if (owner === undefined) return undefined;
  const kind = /\.clas\./.test(String(filename ?? "")) === true ? "CLAS" : "INTF";
  const obj = reg.getObject(kind, owner);
  const result = {object: owner, kind, perFile: new Map()};
  const bucketOf = (base) => {
    let b = result.perFile.get(base);
    if (b === undefined) {
      b = {unknowns: [], edges: [], friends: [], supers: [], signatureLines: []};
      result.perFile.set(base, b);
    }
    return b;
  };
  if (obj === undefined) return result;
  // the definition-statement references, per file: the CLASS DEFINITION
  // statement's INHERITING FROM and GLOBAL FRIENDS names, and the METHODS
  // statements (their rows are the signature lines)
  for (const file of obj.getABAPFiles?.() ?? []) {
    const base = baseName(file.getFilename());
    const bucket = bucketOf(base);
    for (const st of file.getStatements()) {
      const sname = st.get().constructor.name;
      if (sname === "ClassDefinition") {
        const toks = st.getTokens();
        const up = toks.map((t) => t.getStr().toUpperCase());
        const inh = up.indexOf("INHERITING");
        if (inh >= 0 && up[inh + 1] === "FROM" && up[inh + 2] !== undefined) {
          const name = up[inh + 2];
          bucket.supers.push({name, line: st.getStart().getRow(), resolved: reg.getObject("CLAS", name) !== undefined});
        }
        const fr = up.indexOf("FRIENDS");
        if (fr >= 0) {
          for (let i = fr + 1; i < toks.length; i++) {
            const s = up[i];
            if (s === ".") break;
            if (/^[A-Z0-9_/#]+$/.test(s) === false) continue;
            bucket.friends.push({name: s, line: st.getStart().getRow()});
          }
        }
      } else if (sname === "MethodDef") {
        const toks = st.getTokens();
        bucket.signatureLines.push(...rangeRows(st.getStart().getRow(), st.getEnd().getRow()));
        bucket.methodDefs = bucket.methodDefs ?? [];
        bucket.methodDefs.push({method: String(toks[1]?.getStr() ?? "").toUpperCase(),
          start: st.getStart().getRow(), end: st.getEnd().getRow()});
      }
    }
  }
  // the scope walk: unknowns and resolved edges, deduped by file+name+line
  // (top-down, so the declaring scope wins the level)
  let spaghetti;
  try {
    spaghetti = new abaplint.SyntaxLogic(reg, obj).run().spaghetti;
  } catch {
    return result;
  }
  const seen = new Set();
  const methodOf = (base, line) => {
    const defs = result.perFile.get(base)?.methodDefs ?? [];
    return defs.find((d) => line >= d.start && line <= d.end)?.method;
  };
  const visit = (node, enclosing) => {
    const id = node.getIdentifier();
    let here = enclosing;
    if (id.stype === ST.MethodDefinition) here = {level: "signature"};
    else if (id.stype === ST.Method || id.stype === ST.MethodInstance) {
      here = {level: "method", method: String(id.sname ?? "").toUpperCase()};
    } else if (id.stype === ST.ClassDefinition || id.stype === ST.Interface) here = {level: "definition"};
    else if (here === undefined) here = {level: "definition"};
    const base = baseName(id.filename ?? "");
    const skip = base === "" || base.startsWith("_builtin") === true || base.startsWith("_global") === true;
    const bucket = skip === false ? bucketOf(base) : undefined;
    if (bucket !== undefined) {
      const push = (entry, line) => {
        const key = `${base}|${entry.name}|${line}`;
        if (seen.has(key) === true) return;
        seen.add(key);
        bucket.unknowns.push({...entry, line,
          level: here.level, ...(here.method !== undefined ? {method: here.method} : {})});
      };
      for (const ref of node.getData().references) {
        if (ref.resolved !== undefined && ref.resolved !== null) {
          const target = String(ref.resolved.getName()).toUpperCase();
          if (target !== owner && target !== "") bucket.edges.push({to: target, level: here.level});
        }
        const e = fromRef(ref);
        if (e !== undefined) push(e, ref.position.getStart().getRow());
      }
      for (const scope of ["vars", "types"]) {
        for (const [vn, identifier] of Object.entries(node.getData()[scope] ?? {})) {
          const e = fromIdentifier(identifier, vn);
          if (e !== undefined) push(e, identifier.getStart().getRow());
        }
      }
    }
    for (const c of node.getChildren()) visit(c, here);
  };
  visit(spaghetti.getTop(), undefined);
  // the statement carriers join the unknowns: a missing superclass is a
  // definition-level unknown (kind super), every friend name a soft one --
  // and a signature-level unknown takes its method's name off the METHODS
  // statement (the method_definition scope's sname is generic)
  for (const [base, bucket] of result.perFile) {
    for (const u of bucket.unknowns) {
      if (u.method === undefined && (u.level === "signature" || u.level === "method") === true) {
        const m = methodOf(base, u.line);
        if (m !== undefined) u.method = m;
      }
    }
    for (const s of bucket.supers) {
      if (s.resolved === true) {
        bucket.edges.push({to: s.name, level: "definition"});
        continue;
      }
      const key = `${base}|${s.name}|${s.line}`;
      if (seen.has(key) === false) {
        seen.add(key);
        bucket.unknowns.push({name: s.name, kind: "super", via: "super", line: s.line, level: "definition"});
      }
    }
    for (const f of bucket.friends) {
      if (reg.getObject("CLAS", f.name) !== undefined) continue;
      const key = `${base}|${f.name}|${f.line}`;
      if (seen.has(key) === false) {
        seen.add(key);
        bucket.unknowns.push({name: f.name, kind: "friend", via: "friends", line: f.line, level: "definition"});
      }
    }
    for (const e of bucket.edges) e.method = methodOf(base, e.line ?? 0);
  }
  return result;
}

/** one object file's unknown references as data (H5x-2's `references`):
 *  [{name, kind, line, level: "definition" | "method" | "signature",
 *    method?, via, reason?}] -- the carriers are in the header comment. One
 *  SyntaxLogic pass per call; the loop's own path (analyseIsland) reuses one
 *  pass per object for the request, the stub planner and the decision. */
export function references(reg, filename) {
  const analysis = analyseObject(reg, filename);
  const base = baseName(filename);
  return (analysis?.perFile.get(base)?.unknowns ?? []).map((u) => ({
    name: u.name, kind: u.kind, line: u.line, level: u.level,
    ...(u.method !== undefined ? {method: u.method} : {}),
    ...(u.via !== undefined ? {via: u.via} : {}),
    ...(u.ooType !== undefined ? {ooType: u.ooType} : {}),
    ...(u.fix !== undefined ? {fix: u.fix} : {}),
    ...(u.var !== undefined ? {var: u.var} : {}),
    ...(u.reason !== undefined ? {reason: u.reason} : {}),
  }));
}

const rangeRows = (from, to) => {
  const rows = [];
  for (let r = from; r <= to; r++) rows.push(r);
  return rows;
};

/** the island's structural analysis, one SyntaxLogic pass per object:
 *  `classPaths` is islandClassPaths's basename -> paths map. Returns
 *  {objects: [{object, file, kind}], byObject: Map(object -> {unknowns,
 *  edges, friends, signatureLines})} -- the unknowns and edges of every file
 *  of the object merged (the decision is per object), `file` the main
 *  file's root-relative path. */
export function analyseIsland({reg, root, classPaths}) {
  const byStem = new Map();
  for (const [base, paths] of classPaths) {
    const stem = base.replace(/\.(?:clas(?:\.locals_imp)?|intf)\.abap$/, "");
    if (stem === base) continue;
    const entry = byStem.get(stem) ?? {files: new Set(), paths: []};
    entry.files.add(base);
    for (const p of paths) entry.paths.push(p);
    byStem.set(stem, entry);
  }
  const objects = [];
  const byObject = new Map();
  const errors = [];
  for (const [stem, entry] of [...byStem.entries()].sort()) {
    const main = entry.paths.map((p) => p.split("/").pop())
      .find((b) => /\.clas\.abap$|\.intf\.abap$/.test(b) === true) ?? entry.paths[0];
    const mainPath = entry.paths.find((p) => p.split("/").pop() === main) ?? entry.paths[0];
    let analysis;
    try {
      analysis = analyseObject(reg, main);
    } catch (error) {
      // one object's analysis must not stop the walk (FIX-1): the throw is
      // recorded {file, error} for the closure-stubs.json `errors` section
      // and the object stays out of every map below -- "red, unknown
      // cause": kept in the build, never excluded by the decision, its
      // findings still classified by the text fallback
      errors.push({file: mainPath.slice(root.length + 1), error: String(error?.message ?? error)});
      continue;
    }
    if (analysis === undefined) continue;
    const merged = {unknowns: [], edges: [], friends: [], signatureLines: []};
    const seen = new Set();
    for (const base of entry.files) {
      const bucket = analysis.perFile.get(base);
      if (bucket === undefined) continue;
      for (const u of bucket.unknowns) {
        const key = `${u.name}|${u.line}`;
        if (seen.has(key) === false) {
          seen.add(key);
          merged.unknowns.push({...u, file: base});
        }
      }
      for (const e of bucket.edges) merged.edges.push(e);
      for (const f of bucket.friends) merged.friends.push(f.name);
      merged.signatureLines.push(...bucket.signatureLines);
    }
    const object = analysis.object;
    const record = {object, file: mainPath.slice(root.length + 1), kind: analysis.kind,
      files: [...entry.files], ...merged};
    objects.push(record);
    byObject.set(object, record);
  }
  return {objects, byObject, errors};
}

/** the registry the analysis runs over: the build's own file set
 *  (abap_transpile.json's inputs and libs, hidden layers kept out) minus
 *  NOTHING -- the closure's own exclusions are the decision's business, the
  *  graph must see their files. Heavy: reads and parses the tree like the
 *  transpile it stands beside. */
export async function structuralRegistry(root, log = () => {}) {
  const config = JSON.parse(readFileSync(join(root, "abap_transpile.json"), "utf8"));
  const stack = layers(root, config);
  const listing = {...config, exclude_filter: [...(config.exclude_filter ?? []), ...excludePatterns(stack.hidden)]};
  const {files} = await loadFiles(root, listing, abaplint);
  const libs = await loadLibs(root, listing, log);
  const reg = new abaplint.Registry(new abaplint.Config(JSON.stringify(CONFIG)));
  for (const file of files) reg.addFile(new abaplint.MemoryFile(file.filename, file.contents));
  for (const lib of libs) reg.addDependency(new abaplint.MemoryFile(lib.filename, lib.contents));
  orderRegistry(reg, abaplint, files, libs);
  // the registry parses here: getObject (and so every SyntaxLogic of the
  // analysis) reads the parsed objects, and nothing else in the walk parses
  // this file set
  reg.parse();
  return reg;
}

// ------------------------------------------------------- the decision ----

// Tarjan's strongly connected components over an adjacency Map. Pure.
export function stronglyConnected(adj) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const idx = new Map();
  const low = new Map();
  const sccs = [];
  const strongconnect = (v) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (idx.has(w) === false) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w) === true) {
        low.set(v, Math.min(low.get(v), idx.get(w)));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const scc = [];
      for (;;) {
        const w = stack.pop();
        onStack.delete(w);
        scc.push(w);
        if (w === v) break;
      }
      if (scc.length > 1) sccs.push(scc.sort());
    }
  };
  for (const v of adj.keys()) if (idx.has(v) === false) strongconnect(v);
  return sccs;
}

/** the exclusion decision over the island's reference graph (H5x-2). Inputs:
 *  `objects` -- every island code object with its `defNames`
 *  ([{name, kind, via}], definition-level unknowns, friend names included
 *  and marked), `edges` (definition-level references to island objects),
 *  `friends` (GLOBAL FRIENDS names), `nameless` (definition findings that
 *  name nothing, signature lines already excluded), `findings` (the raw
 *  definition findings, for the records); `pendingOf(name, kind)` -- the
 *  fixed-point predicate; `statusOf(name, kind)` -- "excluded" | "present" |
 *  "absent" (past the gate "absent" means answered-absent); `guard` -- the
 *  seed service classes, `guardMode` how they were recognised. Returns
 *  {blocked, roots, cascades, cycles, strips, excluded}: roots
 *  [{object, missing, nameless}], cascades [{object, of}], cycles
 *  [{members, kept: true}], strips [{object, of}] (FRIENDS clauses naming an
 *  excluded object -- soft, stripped, never excluded). Throws on a seed
 *  class that would be excluded. Pure. */
export function graphDecide({objects, pendingOf, statusOf, guard = new Set(), guardMode = "registration"}) {
  for (const o of objects ?? []) {
    for (const n of o.defNames ?? []) {
      if (pendingOf(n.name, n.kind) === true) return {blocked: true, roots: [], cascades: [], cycles: [], strips: [], excluded: new Set()};
    }
  }
  const nodes = (objects ?? []).map((o) => o.object);
  const adj = new Map(nodes.map((n) => [n, new Set()]));
  const reverse = new Map(nodes.map((n) => [n, []]));
  for (const o of objects ?? []) {
    for (const to of o.edges ?? []) {
      if (to === o.object || adj.has(to) === false) continue;
      adj.get(o.object).add(to);
      reverse.get(to).push(o.object);
    }
  }
  const sccs = stronglyConnected(adj);
  const inCycle = new Set(sccs.filter((s) => s.length > 1).flat());
  const findingsOf = (object) => {
    const o = (objects ?? []).find((x) => x.object === object);
    return o?.findings ?? [];
  };
  const guardThrow = (object, why) => {
    const how = guardMode === "suffix"
      ? "recognised by suffix (no registration in gen/hana-segw or the island's *.iwsv.xml / *.iwmo.xml)"
      : "gen/hana-segw or the island's *.iwsv.xml / *.iwmo.xml";
    const findings = findingsOf(object).join(" | ");
    const error = new Error(`hana-closure: ${object} is a registered service's own class (${how}): ${why} -- the service itself cannot be excluded from the build, the run fails${findings === "" ? "" : `: ${findings}`}`);
    error.guard = true;
    throw error;
  };
  // roots: a definition reference to an answered-absent name (a friend name
  // never roots), or definition findings that name nothing -- except a
  // cycle member's (its references all resolve; its residual findings are
  // the checker limit the cycle record reports)
  const roots = [];
  const rootSet = new Set();
  for (const o of objects ?? []) {
    const missing = (o.defNames ?? []).filter((n) => n.via !== "friends" && statusOf(n.name, n.kind) === "absent").map((n) => n.name);
    const nameless = inCycle.has(o.object) === true ? [] : (o.nameless ?? []);
    if (missing.length > 0 || nameless.length > 0) {
      rootSet.add(o.object);
      roots.push({object: o.object, missing: [...new Set(missing)].sort(), nameless});
    }
  }
  for (const r of roots) {
    if (guard.has(r.object) === true) guardThrow(r.object, "its definition references a missing name");
  }
  const excluded = new Set(rootSet);
  const queue = [...excluded];
  while (queue.length > 0) {
    const here = queue.pop();
    for (const dependent of reverse.get(here) ?? []) {
      if (excluded.has(dependent) === true) continue;
      if (guard.has(dependent) === true) guardThrow(dependent, `its definition depends on ${here}, which falls`);
      excluded.add(dependent);
      queue.push(dependent);
    }
  }
  // a dependent's `of`: the excluded objects its definition can reach
  const reachableExcluded = (start) => {
    const seen = new Set([start]);
    const stack = [start];
    const out = new Set();
    while (stack.length > 0) {
      const v = stack.pop();
      for (const w of adj.get(v) ?? []) {
        if (excluded.has(w) === true) out.add(w);
        if (seen.has(w) === false) {
          seen.add(w);
          stack.push(w);
        }
      }
    }
    return out;
  };
  const cascades = (objects ?? [])
    .filter((o) => excluded.has(o.object) === true && rootSet.has(o.object) === false)
    .map((o) => ({object: o.object, of: [...reachableExcluded(o.object)].sort()}));
  const cycles = sccs
    .filter((s) => s.every((m) => excluded.has(m) === false))
    .map((s) => ({members: [...s], kept: true}));
  const strips = (objects ?? [])
    .filter((o) => excluded.has(o.object) === false)
    .map((o) => ({object: o.object, of: [...new Set((o.friends ?? []).filter((f) => excluded.has(f) === true))].sort()}))
    .filter((s) => s.of.length > 0);
  return {blocked: false, roots, cascades, cycles, strips, excluded};
}

// --------------------------------------------- the island's test code ----

// the ABAP unit-test framework's kernel classes and interfaces (H5x-3)
const AUNIT_TEST_CODE = /^(?:CL|IF)_AUNIT_[A-Z0-9_/#]+$/;

const namesOf = (o) => [o.object,
  ...(o.unknowns ?? []).map((u) => u.name),
  ...(o.edges ?? []).map((e) => e.to),
  ...(o.friends ?? [])];

/** the island's test code (H5x-3): `roots` name the unit-test framework --
 *  their own name, or a name their unknowns, edges or GLOBAL FRIENDS carry,
 *  or their source text -- and `all` closes that transitively: an object
 *  whose material or source names a test-code object is part of the test
 *  surface with it, at any level (a body-level reference does not stub
 *  against an absent class but leaves with it). The source scan exists
 *  because a RESOLVED friend never reaches the structural record
 *  (analyseObject skips friends the registry can resolve): the bed's EPM
 *  test utilities trace to the decorator only through their GLOBAL FRIENDS
 *  clause, and their file carries a parser finding on top. The scan is
 *  name-shaped, never prose-shaped: a source qualifies through one of its
 *  identifier tokens, not through a sentence. Pure. */
export function testCodeObjects(objects, sourceOf = undefined) {
  const tokensOf = (o) => {
    if (sourceOf === undefined) return undefined;
    const source = sourceOf(o);
    if (typeof source !== "string") return undefined;
    return String(source).toUpperCase().match(/[A-Z0-9_/#]+/g) ?? [];
  };
  const isAunit = (o, tokens) =>
    namesOf(o).some((n) => AUNIT_TEST_CODE.test(String(n ?? "")) === true) ||
    (tokens ?? []).some((t) => AUNIT_TEST_CODE.test(t) === true);
  const mentions = (o, tokens, set) =>
    namesOf(o).some((n) => set.has(n) === true) ||
    (tokens ?? []).some((t) => set.has(t) === true);
  const roots = new Set();
  const tokensByObject = new Map();
  for (const o of objects ?? []) {
    const tokens = tokensOf(o);
    if (tokens !== undefined) tokensByObject.set(o.object, tokens);
    if (isAunit(o, tokens) === true) roots.add(o.object);
  }
  const all = new Set(roots);
  let grew = true;
  while (grew === true) {
    grew = false;
    for (const o of objects ?? []) {
      if (all.has(o.object) === true) continue;
      if (mentions(o, tokensByObject.get(o.object), all) === true) {
        all.add(o.object);
        grew = true;
      }
    }
  }
  return {roots, all};
}

/** the request names out of one iteration's structural pass and its
 *  findings: the references first (with their TADIR-ish kinds), then the
 *  text fallback for the findings no reference carries -- a finding whose
 *  line a reference sits on AND whose message names the reference's thing
 *  is structural-matched and never reaches the classifier (a fallback
 *  shape on the same line keeps its own ask). Returns {names,
 *  structuralCount, rest}: `names` is the merged, first-named list for
 *  dropPresentNames, `rest` the unmatched findings for the caller's
 *  classifyFindings (its cascades and unclassified feed the line). Pure. */
export function mergeNames({analysis, findings, classPaths}) {
  const byFileFindings = new Map();
  for (const f of findings) {
    const list = byFileFindings.get(f.file) ?? [];
    list.push(f);
    byFileFindings.set(f.file, list);
  }
  const objectOfBase = new Map([...classPaths.keys()]
    .map((b) => [b, nameFromAbapFile(b.replace(/\..*$/, ""))]));
  const unknownsOf = new Map(analysis.objects.map((o) => [o.object, o.unknowns]));
  const isStructural = (f) => {
    const us = unknownsOf.get(objectOfBase.get(f.file) ?? "");
    return us !== undefined &&
      us.some((u) => Math.abs(u.line - f.line) <= 2 && f.message.toUpperCase().includes(u.name) === true);
  };
  const names = [];
  const seen = new Set();
  for (const o of analysis.objects) {
    for (const u of o.unknowns) {
      if (seen.has(u.name) === true) continue;
      seen.add(u.name);
      const near = (byFileFindings.get(u.file ?? "") ?? []).find((f) => Math.abs(f.line - u.line) <= 2);
      names.push({name: u.name, kind: requestKindOf(u.name, u),
        finding: near?.raw ?? `structural: ${u.name} (${u.via ?? u.kind})`,
        ...(near?.message !== undefined ? {message: near.message} : {})});
    }
  }
  const rest = findings.filter((f) => isStructural(f) === false);
  return {names, structuralCount: findings.length - rest.length, rest};
}

/** the record the seam reads (H5x-2's six sections plus FIX-1's `errors`:
 *  one {file, error} entry per island object whose analysis or planning
 *  threw -- the object stays in the build, "red, unknown cause"), assembled
 *  from the walk's last decision and the stubs -- written before every
 *  revalidation (the build's exclude_filter must see an exclusion at once)
 *  and at the end of the walk. */
export function writeClosureRecord(out, {stubRecords, excludedRecords, waits, errors = []}) {
  const excluded = {};
  for (const r of excludedRecords) {
    if (r.level !== "definition" && (r.level !== "cascade" || r.excluded !== true)) continue;
    const kind = r.kind === "INTF" ? "INTF" : "CLAS";
    excluded[kind] = [...new Set([...(excluded[kind] ?? []), r.object])];
  }
  writeFileSync(join(out, "closure-stubs.json"), JSON.stringify({
    roots: excludedRecords.filter((r) => r.level === "definition"),
    cascades: excludedRecords.filter((r) => r.level === "cascade"),
    cycles: excludedRecords.filter((r) => r.level === "cycle"),
    stubs: stubRecords,
    waits,
    errors,
    excluded,
  }, null, 2) + "\n");
}

/** the objects whose definition names are still pending: the next
 *  request's asks, and the audit of why a decision blocked ({object,
 *  names}). Pure. */
export function waitsOf(analysisObjects, pendingAtFixedPoint) {
  const waits = [];
  for (const o of analysisObjects) {
    const names = [...new Set(o.unknowns
      .filter((u) => u.level === "definition" &&
        pendingAtFixedPoint(u.name, requestKindOf(u.name, u)) === true)
      .map((u) => u.name))].sort();
    if (names.length > 0) waits.push({object: o.object, names});
  }
  return waits;
}

// ------------------------------------------------- source rewrites -------

// the token offsets of one statement's tokens over the source, as
// [start, end) character offsets (the stub pass cuts the same way)
const offsetOf = (source, at) => {
  const lines = source.split("\n");
  let offset = 0;
  for (let i = 0; i < at.row - 1; i++) offset += lines[i].length + 1;
  return offset + at.col - 1;
};

const applyCuts = (source, cuts) => {
  let out = source;
  for (const [start, end] of [...cuts].sort((a, b) => b[0] - a[0])) {
    let s = start;
    let e = end;
    if (out[e] === " ") e += 1;
    else if (out[s - 1] === " ") s -= 1;
    out = out.slice(0, s) + out.slice(e);
  }
  return out;
};

// one file's parse for the rewrites: a throw leaves the source whole
const parseFile = (source, filename) =>
  new abaplint.Registry().addFile(new abaplint.MemoryFile(filename, source)).parse();

/** the GLOBAL FRIENDS clauses of one class file, with the friend names that
 *  are `gone` (excluded, or answered missing/refused -- the caller's
 *  predicate) cut: a friend that leaves with the test framework costs the
 *  friending class a source rewrite, never its place in the build. A clause
 *  whose every friend is gone loses the whole GLOBAL FRIENDS words. Pure:
 *  the caller writes the source back. */
export function stripFriends(source, filename, goneOf) {
  let reg;
  try {
    reg = parseFile(source, filename);
  } catch {
    return {source, stripped: []};
  }
  const cuts = [];
  const stripped = [];
  for (const file of reg.getFirstObject()?.getABAPFiles() ?? []) {
    for (const st of file.getStatements()) {
      if (st.get().constructor.name !== "ClassDefinition") continue;
      const toks = st.getTokens();
      const up = toks.map((t) => t.getStr().toUpperCase());
      const fr = up.indexOf("FRIENDS");
      if (fr < 0) continue;
      const names = [];
      for (let i = fr + 1; i < toks.length; i++) {
        if (up[i] === ".") break;
        if (/^[A-Z0-9_/#]+$/.test(up[i]) === false) continue;
        names.push({token: toks[i], name: up[i]});
      }
      const gone = names.filter((n) => goneOf(n.name) === true);
      if (gone.length === 0) continue;
      stripped.push(...gone.map((n) => n.name));
      if (gone.length === names.length) {
        const first = up[fr - 1] === "GLOBAL" ? toks[fr - 1] : toks[fr];
        const last = names[names.length - 1].token;
        cuts.push([offsetOf(source, first.getStart()), offsetOf(source, last.getEnd())]);
        continue;
      }
      for (const n of gone) cuts.push([offsetOf(source, n.token.getStart()), offsetOf(source, n.token.getEnd())]);
    }
  }
  if (cuts.length === 0) return {source, stripped: []};
  return {source: applyCuts(source, cuts), stripped};
}

// the signature clause keywords a parameter list is cut between
const CLAUSE_KEYWORDS = new Set(["IMPORTING", "EXPORTING", "CHANGING", "RETURNING", "RECEIVING", "EXCEPTIONS", "RAISING"]);

/** one method's signature-level misses (`cutVars`: the parameter names whose
 *  types are answered-absent or staying lazy) cut out of the METHODS
 *  statement: the parameter's tokens go, and a clause left with no
 *  parameter loses its keyword -- the method compiles without the name, the
 *  way a body stub does for a body. Conservative: a parameter list this
 *  cannot parse cleanly is left whole. Pure: the caller writes the source
 *  back. */
export function cutSignatureParams(source, filename, method, cutVars) {
  let reg;
  try {
    reg = parseFile(source, filename);
  } catch {
    return {source, cut: []};
  }
  const wanted = new Set(cutVars.map((v) => String(v).toUpperCase()));
  const cuts = [];
  const cut = [];
  for (const file of reg.getFirstObject()?.getABAPFiles() ?? []) {
    for (const st of file.getStatements()) {
      if (st.get().constructor.name !== "MethodDef") continue;
      const toks = st.getTokens();
      if (String(toks[1]?.getStr() ?? "").toUpperCase() !== method) continue;
      const up = toks.map((t) => t.getStr().toUpperCase());
      // the clause sections: [keyword, next keyword or final dot)
      for (let k = 2; k < toks.length; k++) {
        if (CLAUSE_KEYWORDS.has(up[k]) === false) continue;
        let b = k + 1;
        while (b < toks.length && up[b] !== "." && CLAUSE_KEYWORDS.has(up[b]) === false) b++;
        // the parameter sub-spans: a parameter starts at k+1 and after
        // every OPTIONAL
        const spans = [];
        let start = k + 1;
        for (let i = k + 1; i < b; i++) {
          if (up[i] === "OPTIONAL" && i + 1 < b) {
            spans.push([start, i + 1]);
            start = i + 1;
          }
        }
        spans.push([start, b]);
        const hit = spans.filter(([s, e]) => toks.slice(s, e).some((t, at) =>
          up[s + at] === "." ? false :
          wanted.has(up[s + at].replace(/^\((.+)\)$/, "$1")) === true ||
          wanted.has(up[s + at]) === true));
        if (hit.length === 0) continue;
        const keep = spans.length - hit.length;
        for (const [s, e] of hit) {
          cuts.push([offsetOf(source, toks[s].getStart()), offsetOf(source, toks[e - 1].getEnd())]);
        }
        if (keep === 0) cuts.push([offsetOf(source, toks[k].getStart()), offsetOf(source, toks[k].getEnd())]);
        for (const [s, e] of hit) {
          for (let i = s; i < e; i++) {
            const bare = up[i].replace(/^\((.+)\)$/, "$1");
            if (wanted.has(bare) === true || wanted.has(up[i]) === true) cut.push(bare === up[i] ? up[i] : bare);
          }
        }
      }
    }
  }
  if (cuts.length === 0) return {source, cut: []};
  return {source: applyCuts(source, cuts), cut: [...new Set(cut)]};
}
