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
// - a name whose object is already in the island -- by file name for the
//   code kinds (.clas.abap OR .intf.abap of the base), by the XML present
//   for the DDIC kinds -- is never asked and never deferred: its finding is
//   a cascade of that object's own findings.
// - a method keeps its body only while a DDIC name of that method is still
//   pending in THIS iteration's request -- not asked yet, its object
//   neither present nor excluded this run, the dumper's answer neither
//   missing nor a merge refusal. Nameless cascade-only findings,
//   present-only names, resolved-but-still-failing names and dead names all
//   stub (fix round 1: round 0's keep-branch kept a DPC_EXT full of
//   nameless member cascades red forever); a nameless stub's raise carries
//   its finding's text, and its findings are the framework work list --
//   framework-gaps.json beside the stubs.
// - a class or interface whose findings sit outside every METHOD ...
//   ENDMETHOD body (no stub can reach them) is excluded from the build when
//   NONE of their names is still pending -- the decision is the definition
//   findings' alone (a stub beside it is moot), taken in a round that
//   applied no method stub -- unless it is a registered service's own class
//   -- the MPC/DPC pairs the gen/hana-segw facts or the island's
//   *.iwsv.xml / *.iwmo.xml name -- where the run fails instead: the
//   service itself cannot be stubbed out.
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

/** the raise text of a stub whose findings name nothing (S-3, fix round
 *  1): the first finding's message -- so the exception says why even with
 *  no name, and a GET never reads "needs ''". A quote is doubled for the
 *  ABAP literal; the text is capped like the names list. Pure. */
export function stubReasonText(finding) {
  const text = String(finding?.message ?? finding ?? "").replace(/'/g, "''");
  return text.length > 193 ? `${text.slice(0, 190)}...` : text;
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
    stubs.push({...block, missing, missingKinds, finding: inside[0].raw, reason: stubReasonText(inside[0])});
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
    // S-3 (fix round 1): a stub whose findings name nothing raises with the
    // finding's text, so a GET never reads "needs ''"
    const text = stub.missing.length > 0 ? stubNamesText(stub.missing) : stub.reason;
    const body = `\n${indent}  RAISE EXCEPTION TYPE zcx_osd_not_activated EXPORTING missing = '${text}'.\n${indent}`;
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
// under (the request's own kinds, DOMA not among them). A CODE kind is
// checked as .clas.abap OR .intf.abap (fix round 1, M-1.4): the classified
// kind of a ZIF_ name is the name-prefix heuristic's `clas`, and presence
// by the one suffix asked every customer interface again every round.
const FILE_SUFFIXES = {
  clas: [".clas.abap", ".intf.abap"],
  intf: [".intf.abap", ".clas.abap"],
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
// findings exclude the file when NONE of their names is still pending --
// nothing this iteration's request can still bring. Present objects, merge
// refusals (state.refused, not state.missing), resolved-but-still-failing
// names, missing names, objects this run already excluded and nameless
// findings are all answered: the file falls out of the build (fix round 1:
// round 0 required every name answered MISSING, which no definition-level
// finding on the bed ever was). A registered service's own class throws
// instead.
function exclusionOf(unmatched, {basename, asked, missingOf, refusedOf, presentFile, excludedObjects, registered}) {
  const names = classifyFindings(unmatched).names;
  const waiting = names.some((n) => pendingOf(n.name, n.kind, {asked, missingOf, refusedOf, presentFile, excludedObjects}));
  if (waiting === true) return undefined;
  const object = nameFromAbapFile(basename.replace(/\..*$/, ""));
  if (registered.has(object) === true) {
    const error = new Error(`hana-closure: ${object} is a registered service's own class (gen/hana-segw or the island's *.iwsv.xml / *.iwmo.xml): its findings are definition-level, and the service itself cannot be excluded from the build -- the run fails: ${unmatched.map((f) => f.raw).join(" | ")}`);
    error.guard = true;
    throw error;
  }
  return {object, findings: unmatched.map((f) => f.raw)};
}

/** the framework-gaps.json list from the loop's accumulation map: one entry
 *  per distinct nameless finding text, the quoted member beside it where
 *  the shape has one, sorted by finding text, each used_by sorted by file,
 *  line, method. Pure. */
export function frameworkGapList(gapFindings) {
  const byUse = (a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.method < b.method ? -1 : 1);
  return [...gapFindings.values()]
    .map((entry) => ({...entry, used_by: [...entry.used_by].sort(byUse)}))
    .sort((a, b) => a.finding < b.finding ? -1 : a.finding > b.finding ? 1 : 0);
}

// a name is still PENDING when this iteration's request can still bring it:
// not asked yet, its object neither present in the island nor excluded this
// run, the dumper's answer neither missing nor refused. (A name the dumper
// was asked for always has its answer by the time a stub round runs -- the
// pending round is executed before the walk continues.) The stub rule, the
// eager list and the exclusion decision all read this one predicate.
function pendingOf(name, kind, {asked, missingOf, refusedOf, presentFile, excludedObjects}) {
  return asked(name) === false && presentFile(name, kind) === false &&
    missingOf(name) === false && refusedOf(name) === false &&
    excludedObjects.has(name) === false;
}

// the quoted member token of a nameless finding, where the shape has one --
// the method, attribute or component the text says is missing. A Variable
// cascade's quoted token is the local variable, not the member: no token is
// extracted there, the finding text is the record. Pure.
const memberOf = (message) => {
  const m = /^(?:Method (?:or attribute )?|Attribute (?:or constant )?|Component )"([^"]+)"/.exec(String(message ?? ""));
  return m === null ? undefined : m[1];
};

/** one pass of the lazy-activation loop over ONE island file (H5x-1):
 *  which of the file's method stubs to apply, what their names defer and
 *  what they ask eagerly, and whether the file itself is definition-level
 *  excluded. `missingOf(name)` says the dumper answered missing for a name,
 *  `asked(name)` says it was requested at all, `refusedOf(name)` says the
 *  merge refused it (fix round 1), `islandFiles` is the island's basename
 *  set, `excludedObjects` the objects excluded this run, `registered` the
 *  registered service's own classes. Returns {source, stubs, unmatched,
 *  eager, deferred, nameless, exclude} -- `source` is the rewritten source
 *  when stubs were applied (the caller writes it back), `nameless` carries
 *  one entry per finding of a stubbed method that names nothing (the
 *  framework work list: {finding, member?, line, method}, sorted), and
 *  `exclude` is {object, findings} when the file falls out of the build --
 *  then the stubs are moot and `source` is left as it stands. Pure. */
export function planStubPass({source, findings, basename, missingOf = () => false, asked = () => false, refusedOf = () => false, islandFiles = new Set(), excludedObjects = new Set(), registered = new Set(), deferDdic = false}) {
  try {
    methodBlocks(source, basename);
  } catch {
    // a file that does not parse is left whole: its findings stay in the
    // request, the way they always have -- a parse error is not a
    // definition-level finding
    return {unparseable: true, source, stubs: [], unmatched: findings, eager: [], deferred: [], nameless: [], exclude: undefined};
  }
  const result = stubBodies(source, findings, basename);
  const presentFile = (name, kind) => objectFilePresent(name, kind, islandFiles) === true;
  const pending = (name, kind) => pendingOf(name, kind, {asked, missingOf, refusedOf, presentFile, excludedObjects});
  const present = (name, kind) => presentFile(name, kind) === true && excludedObjects.has(name) === false;
  const exclude = result.unmatched.length > 0
    ? exclusionOf(result.unmatched, {basename, asked, missingOf, refusedOf, presentFile, excludedObjects, registered})
    : undefined;
  if (exclude !== undefined) {
    // the file leaves the build: the decision is the definition findings'
    // alone (fix round 1, M-1.3), and the method stubs beside it are moot
    return {source, stubs: [], unmatched: result.unmatched, eager: [], deferred: [], nameless: [], exclude};
  }
  const kept = [];
  const keptFindings = [];
  const deferred = [];
  const eager = [];
  const nameless = [];
  let dropped = 0;
  for (const stub of result.stubs) {
    const inside = findings.filter((f) => f.line > stub.headerEnd.row && f.line < stub.endStart.row);
    const byName = new Map(classifyFindings(inside).names.map((n) => [n.name, n]));
    const forName = (nk) => ({
      name: nk.name, kind: nk.kind,
      finding: byName.get(nk.name)?.finding ?? stub.finding,
      ...(byName.get(nk.name)?.message !== undefined ? {message: byName.get(nk.name).message} : {}),
    });
    const collectNameless = () => {
      for (const f of inside) {
        if (classifyFindings([f]).names.length > 0) continue;
        const member = memberOf(f.message);
        nameless.push({finding: f.message, ...(member !== undefined ? {member} : {}), line: f.line, method: stub.method});
      }
    };
    const code = stub.missingKinds.filter((nk) => isCodeKind(nk.kind) === true);
    const ddic = stub.missingKinds.filter((nk) => isCodeKind(nk.kind) === false);
    if (deferDdic === true) {
      // --defer-ddic: round 3's behaviour -- every name of a stubbed
      // method is lazy, even the dictionary's
      kept.push(stub);
      keptFindings.push(...inside);
      if (stub.missing.length === 0) collectNameless();
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
        if (pending(nk.name, nk.kind) === true) eager.push(forName(nk));
      }
      continue;
    }
    if (ddic.some((nk) => pending(nk.name, nk.kind) === true)) {
      // a dictionary name this iteration's request can still bring: the
      // body stays one more round, the finding rejoins the classification
      dropped += 1;
      continue;
    }
    // nothing is pending: nameless cascades, present-only names,
    // resolved-but-still-failing and dead names alike -- the body goes
    // (fix round 1, M-1.1: round 0's keep-branch kept the bed's DPC_EXT
    // red forever on nameless member cascades)
    kept.push(stub);
    keptFindings.push(...inside);
    if (stub.missing.length === 0) collectNameless();
  }
  let outSource = result.source;
  if (dropped > 0) {
    // re-run the stubbing over the kept findings only, so a method the
    // dumper can still answer keeps its body byte for byte
    outSource = stubBodies(source, keptFindings, basename).source;
  }
  nameless.sort((a, b) => a.finding < b.finding ? -1 : a.finding > b.finding ? 1 : 0);
  return {source: outSource, stubs: kept, unmatched: result.unmatched, eager, deferred, nameless, exclude};
}
