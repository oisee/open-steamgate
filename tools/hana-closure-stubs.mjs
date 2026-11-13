// The lazy-activation step of the closure (H5c round 3), beside the loop:
// abaplint's parser in, stub bodies out. tools/hana-closure.mjs stays the
// loop -- this file is its own package so the size budget stays honest --
// and takes the classifier back from it: a load-time cycle of function
// declarations only, every call happens at runtime.
//
// A class compiles as a whole or not at all. --stub-unresolved uses that:
// the body of every island method whose findings do not resolve is
// replaced by the stub raise of zcx_osd_not_activated, so the service
// activates with what resolves and the island grows only on a real miss.
//
// H5x-1 adds three decisions the loop makes per file and per method, all
// here so the loop stays the loop:
// - a DDIC-kind name (tabl/dtel/doma, and the kind-less `ddic` triple) a
//   would-be-stubbed method names is not deferred but eagerly requested:
//   a DDIC closure is cheap and pulls no code, and a stub over a table
//   that exists costs a miss-rerun cycle per method at GET time. Only a
//   code kind (clas/intf/fugr/prog) stays lazy. A method is stubbed when
//   the dumper answered missing for one of its DDIC names (the stub
//   records the gap) or a code-kind name remains; while the dumper can
//   still answer, the body stays. --defer-ddic keeps round 3's behaviour.
// - a name whose object is already in the island -- by file name for
//   CLAS/INTF, by the XML present for the DDIC kinds -- is never asked and
//   never deferred: its finding is a cascade of that object's own findings.
// - a class or interface whose findings sit outside every METHOD ...
//   ENDMETHOD body (no stub can reach them) is excluded from the build,
//   unless it is a registered service's own class -- the MPC/DPC pairs the
//   gen/hana-segw facts or the island's *.iwsv.xml / *.iwmo.xml name --
//   where the run fails instead: the service itself cannot be stubbed out.
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import * as abaplint from "@abaplint/core";
import {classifyFindings, nameFromAbapFile} from "./hana-closure.mjs";

// the island class and interface files a stub pass may rewrite or exclude:
// gen/hana-src/**/*.clas.abap, the locals includes beside them, and the
// *.intf.abap files (an interface is never stubbed -- it has no method
// bodies -- but its definition-level findings are what gets excluded).
// Basename -> every match's path -- the validation reports bare basenames,
// and a basename both an island layer and src/ carry is the island's (the
// later layer wins the build), so the stub targets the gen/hana-src copy
// and never the tree's own src/ file.
export function islandClassPaths(root) {
  const map = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, {withFileTypes: true});
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (/\.(?:clas(?:\.locals_imp)?|intf)\.abap$/.test(entry.name) === true) {
        const paths = map.get(entry.name) ?? [];
        paths.push(join(dir, entry.name));
        map.set(entry.name, paths);
      }
    }
  };
  walk(join(root, "gen", "hana-src"));
  return map;
}

/** the METHOD ... ENDMETHOD blocks of one class file, by source position:
 *  abaplint's parser, never a regex over ABAP (the house rule; the same
 *  approach tools/amdp-extract.mjs cuts AMDP bodies with). `headerEnd` is
 *  the position just past the header's closing dot, `endStart` the
 *  ENDMETHOD's first character -- a body is the text between them, a
 *  finding is in it when its line is strictly between the two rows. A
 *  `.clas.locals_imp.abap` parses as the class's second file, its blocks
 *  carry the local class's name. Pure. */
export function methodBlocks(source, filename = "zcl_stub.clas.abap") {
  const reg = new abaplint.Registry().addFile(new abaplint.MemoryFile(filename, source)).parse();
  const blocks = [];
  for (const file of reg.getFirstObject()?.getABAPFiles() ?? []) {
    let impl;
    let open;
    for (const st of file.getStatements()) {
      const kind = st.get().constructor.name;
      if (kind === "ClassImplementation") {
        impl = String(st.getTokens()[1]?.getStr() ?? "").toUpperCase();
      } else if (kind === "MethodImplementation" && open === undefined) {
        open = st;
      } else if (kind === "EndMethod" && open !== undefined) {
        const headerEnd = open.getEnd();
        const endStart = st.getStart();
        blocks.push({
          className: impl ?? "",
          method: String(open.getTokens()[1]?.getStr() ?? "").toUpperCase(),
          headerEnd: {row: headerEnd.getRow(), col: headerEnd.getCol()},
          endStart: {row: endStart.getRow(), col: endStart.getCol()},
        });
        open = undefined;
      }
    }
  }
  return blocks;
}

/** the missing names of one stub, comma-joined, ~200 characters at most --
 *  the text travels in the exception and says exactly what the method
 *  waits for; a list that does not fit ends in ", ...". Pure. */
export function stubNamesText(names) {
  const parts = [];
  let length = 0;
  for (const name of names) {
    const add = (parts.length === 0 ? 0 : 2) + name.length;
    if (parts.length > 0 && length + add > 193) break;
    parts.push(name);
    length += add;
  }
  return parts.length === names.length ? parts.join(", ") : `${parts.join(", ")}, ...`;
}

/** lazy activation, the stubbing step (round 3): map the findings of ONE
 *  island class file onto the METHOD ... ENDMETHOD blocks abaplint parsed
 *  out of it, and give every method that carries a finding the stub body
 *  (`RAISE EXCEPTION TYPE zcx_osd_not_activated EXPORTING missing = ...`,
 *  indented inside the method). Findings outside any body -- the
 *  definition part: attributes, signatures, types, the MPC's types -- come
 *  back in `unmatched`: they cannot be stubbed, so their names stay in the
 *  request. A file that does not parse is left whole, all its findings
 *  unmatched. Per method: `missing` are the classified names first-named
 *  (a cascade finding adds none) and `missingKinds` carries each name with
 *  its classification kind, for the request's `deferred`. Pure: the caller
 *  writes the source back. */
export function stubBodies(source, findings, filename = "zcl_stub.clas.abap") {
  let blocks;
  try {
    blocks = methodBlocks(source, filename);
  } catch {
    return {source, stubs: [], unmatched: findings};
  }
  const stubs = [];
  const matched = new Set();
  for (const block of blocks) {
    const inside = findings.filter((f) => f.line > block.headerEnd.row && f.line < block.endStart.row);
    if (inside.length === 0) continue;
    const missing = [];
    const missingKinds = [];
    for (const finding of inside) {
      for (const n of classifyFindings([finding]).names) {
        if (missing.includes(n.name) === false) {
          missing.push(n.name);
          missingKinds.push({name: n.name, kind: n.kind});
        }
      }
    }
    stubs.push({...block, missing, missingKinds, finding: inside[0].raw});
    for (const finding of inside) matched.add(finding);
  }
  if (stubs.length === 0) return {source, stubs: [], unmatched: findings};
  const lines = source.split("\n");
  const offsetOf = (at) => {
    let offset = 0;
    for (let i = 0; i < at.row - 1; i++) offset += lines[i].length + 1;
    return offset + at.col - 1;
  };
  let out = source;
  for (const stub of [...stubs].sort((a, b) => offsetOf(b.headerEnd) - offsetOf(a.headerEnd))) {
    const indent = (/^[ \t]*/.exec(lines[stub.endStart.row - 1] ?? "") ?? [""])[0];
    const body = `\n${indent}  RAISE EXCEPTION TYPE zcx_osd_not_activated EXPORTING missing = '${stubNamesText(stub.missing)}'.\n${indent}`;
    out = out.slice(0, offsetOf(stub.headerEnd)) + body + out.slice(offsetOf(stub.endStart));
  }
  return {source: out, stubs, unmatched: findings.filter((f) => matched.has(f) === false)};
}

// ------------------------------------------------------------- H5x-1 ------

// the classification kinds that name code, and the kinds that name the
// dictionary. Only the code kinds stay lazy under --stub-unresolved; every
// DDIC kind -- including the kind-less `ddic` triple -- is eager.
const CODE_KINDS = new Set(["clas", "intf", "fugr", "prog"]);
export const isCodeKind = (kind) => CODE_KINDS.has(kind) === true;

/** an object name to the abapGit file base it stages as: the namespace
 *  escaped as #ns#, lower case -- tools/hana-ddic-map.mjs abapGitFileName's
 *  one rule, read backwards. Pure. */
export function abapBaseOf(name) {
  return String(name ?? "").replace(/\/([^/]+)\//, "#$1#").toLowerCase();
}

// the island file suffixes an object of each classified kind stages as; a
// kind-less `ddic` name is checked against every kind the request asks it
// under (the request's own kinds, DOMA not among them)
const FILE_SUFFIXES = {
  clas: [".clas.abap"],
  intf: [".intf.abap"],
  tabl: [".tabl.xml"],
  dtel: [".dtel.xml"],
  doma: [".doma.xml"],
  ttyp: [".ttyp.xml"],
  shlp: [".shlp.xml"],
  ddic: [".tabl.xml", ".dtel.xml", ".ttyp.xml", ".shlp.xml"],
};

/** whether the island holds an object of this name and kind: the file its
 *  abapGit name stages as is among the island's basenames. Pure. */
export function objectFilePresent(name, kind, islandFiles) {
  const base = abapBaseOf(name);
  return (FILE_SUFFIXES[kind] ?? []).some((suffix) => islandFiles.has(`${base}${suffix}`));
}

/** H5x-1's presence rule over a classified name list: a name whose object
 *  is in the island -- or excluded from the build this run -- is dropped,
 *  never requested and never a gap, and counted: its finding is a cascade
 *  of that object's own findings, and asking the dumper for a name the
 *  island already holds is what asked three times for one interface on the
 *  bed. Pure. */
export function dropPresentNames(names, islandFiles, excludedObjects = new Set()) {
  let present = 0;
  const kept = names.filter((n) => {
    if (excludedObjects.has(n.name) === true) return false;
    if (objectFilePresent(n.name, n.kind, islandFiles) === true) {
      present += 1;
      return false;
    }
    return true;
  });
  return {names: kept, present};
}

/** the island's registered service classes: the MPC/DPC pairs the
 *  gen/hana-segw facts (tools/hana-segw-gen.mjs's from-dump.json) and the
 *  *.iwsv.xml / *.iwmo.xml files in the island name -- the same fields
 *  tools/segw-registry.mjs reads (SRH CLASS_NAME -> DPC, OHD CLASS_NAME ->
 *  MPC) -- each with its non-_EXT twin. A definition-level finding in one
 *  of these is the service itself: the run fails, it is never excluded. */
export function registeredServiceClasses(root) {
  const names = new Set();
  const add = (name) => {
    const upper = String(name ?? "").trim().toUpperCase();
    if (upper === "") return;
    names.add(upper);
    if (/(?:_DPC|_MPC)_EXT$/.test(upper) === true) names.add(upper.replace(/_EXT$/, ""));
  };
  try {
    const facts = JSON.parse(readFileSync(join(root, "gen", "hana-segw", "from-dump.json"), "utf8"));
    for (const entry of facts.services ?? []) {
      add(entry.dpc);
      add(entry.mpc);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const tag = (xml, name) => {
    const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
    return m === null ? "" : m[1].trim();
  };
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, {withFileTypes: true});
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (/\.iwsv\.xml$/i.test(entry.name) === true) {
        const xml = readFileSync(join(dir, entry.name), "utf8");
        const head = /<_-IWBEP_-I_MGW_SRH>[\s\S]*?<\/_-IWBEP_-I_MGW_SRH>/.exec(xml)?.[0] ?? xml;
        add(tag(head, "CLASS_NAME"));
      } else if (/\.iwmo\.xml$/i.test(entry.name) === true) {
        const xml = readFileSync(join(dir, entry.name), "utf8");
        const head = /<_-IWBEP_-I_MGW_OHD>[\s\S]*?<\/_-IWBEP_-I_MGW_OHD>/.exec(xml)?.[0] ?? xml;
        add(tag(head, "CLASS_NAME"));
      }
    }
  };
  walk(join(root, "gen", "hana-src"));
  return names;
}

// the definition-level exclusion decision for ONE file: its unmatched
// findings name objects, and the object is excluded when every one of them
// is dead -- asked and answered missing by the dumper, or an object this
// run already excluded (its dependents fall out the same way). A live name
// may still resolve, and a nameless cascade names nothing to wait for:
// neither excludes. A registered service's own class throws instead.
function exclusionOf(unmatched, {basename, missingOf, present, excludedObjects, registered}) {
  const names = classifyFindings(unmatched).names;
  const allDead = names.length > 0 && names.every((n) =>
    (missingOf(n.name) === true || excludedObjects.has(n.name) === true) && present(n.name, n.kind) === false);
  if (allDead === false) return undefined;
  const object = nameFromAbapFile(basename.replace(/\..*$/, ""));
  if (registered.has(object) === true) {
    const error = new Error(`hana-closure: ${object} is a registered service's own class (gen/hana-segw or the island's *.iwsv.xml / *.iwmo.xml): its findings are definition-level, and the service itself cannot be excluded from the build -- the run fails: ${unmatched.map((f) => f.raw).join(" | ")}`);
    error.guard = true;
    throw error;
  }
  return {object, findings: unmatched.map((f) => f.raw)};
}

/** one pass of the lazy-activation loop over ONE island file (H5x-1):
 *  which of the file's method stubs to apply, what their names defer and
 *  what they ask eagerly, and whether the file itself is definition-level
 *  excluded. `missingOf(name)` says the dumper answered missing for a name,
 *  `asked(name)` says it was requested at all, `islandFiles` is the
 *  island's basename set, `excludedObjects` the objects excluded this run,
 *  `registered` the registered service's own classes. Returns
 *  {source, stubs, unmatched, eager, deferred, exclude} -- `source` is the
 *  rewritten source when stubs were applied (the caller writes it back),
 *  `exclude` is {object, findings} when the file falls out of the build.
 *  Pure. */
export function planStubPass({source, findings, basename, missingOf, asked, islandFiles, excludedObjects, registered, deferDdic = false}) {
  try {
    methodBlocks(source, basename);
  } catch {
    // a file that does not parse is left whole: its findings stay in the
    // request, the way they always have -- a parse error is not a
    // definition-level finding
    return {unparseable: true, source, stubs: [], unmatched: findings, eager: [], deferred: [], exclude: undefined};
  }
  const result = stubBodies(source, findings, basename);
  const present = (name, kind) =>
    objectFilePresent(name, kind, islandFiles) === true && excludedObjects.has(name) === false;
  const dead = (name, kind) => missingOf(name) === true && present(name, kind) === false;
  const kept = [];
  const keptFindings = [];
  const deferred = [];
  const eager = [];
  let dropped = 0;
  for (const stub of result.stubs) {
    const inside = findings.filter((f) => f.line > stub.headerEnd.row && f.line < stub.endStart.row);
    const byName = new Map(classifyFindings(inside).names.map((n) => [n.name, n]));
    const forName = (nk) => ({
      name: nk.name, kind: nk.kind,
      finding: byName.get(nk.name)?.finding ?? stub.finding,
      ...(byName.get(nk.name)?.message !== undefined ? {message: byName.get(nk.name).message} : {}),
    });
    const code = stub.missingKinds.filter((nk) => isCodeKind(nk.kind) === true);
    const ddic = stub.missingKinds.filter((nk) => isCodeKind(nk.kind) === false);
    if (deferDdic === true) {
      // --defer-ddic: round 3's behaviour -- every name of a stubbed
      // method is lazy, even the dictionary's
      kept.push(stub);
      keptFindings.push(...inside);
      for (const nk of stub.missingKinds) {
        if (present(nk.name, nk.kind) === false) deferred.push(forName(nk));
      }
      continue;
    }
    if (code.length > 0) {
      // a code-kind name remains: the method is stubbed, the code names
      // stay deferred (lazy, grows on the miss), and its DDIC names are
      // asked from the dumper in this iteration -- eager, not deferred
      kept.push(stub);
      keptFindings.push(...inside);
      for (const nk of code) {
        if (present(nk.name, nk.kind) === false) deferred.push(forName(nk));
      }
      for (const nk of ddic) {
        if (present(nk.name, nk.kind) === false && missingOf(nk.name) === false && asked(nk.name) === false) eager.push(forName(nk));
      }
      continue;
    }
    if (ddic.length > 0 && ddic.every((nk) => dead(nk.name, nk.kind) === true)) {
      // the dumper answered missing for every DDIC name the method waits
      // for: the method can never resolve, the stub records the gap (the
      // names stay gaps -- the island cannot grow into them)
      kept.push(stub);
      keptFindings.push(...inside);
      continue;
    }
    // the dumper can still answer (the names are unasked or resolved since)
    // or every name is present and the findings are its cascades: the body
    // stays, the findings rejoin the classification
    dropped += 1;
  }
  let outSource = result.source;
  if (dropped > 0) {
    // re-run the stubbing over the kept findings only, so a method the
    // dumper can still answer keeps its body byte for byte
    outSource = stubBodies(source, keptFindings, basename).source;
  }
  const exclude = result.stubs.length === 0 && result.unmatched.length > 0
    ? exclusionOf(result.unmatched, {basename, missingOf, present, excludedObjects, registered})
    : undefined;
  return {source: outSource, stubs: kept, unmatched: result.unmatched, eager, deferred, exclude};
}
