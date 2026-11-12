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
import {readdirSync} from "node:fs";
import {join} from "node:path";
import * as abaplint from "@abaplint/core";
import {classifyFindings} from "./hana-closure.mjs";

// the island class files a stub may rewrite: gen/hana-src/**/*.clas.abap
// and the locals includes beside them (a class compiles as a whole, so the
// local implementations stub like the class's own methods). Basename ->
// every match's path -- the validation reports bare basenames, and a
// basename both an island layer and src/ carry is the island's (the later
// layer wins the build), so the stub targets the gen/hana-src copy and
// never the tree's own src/ file.
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
      else if (/\.clas\.(?:locals_imp\.)?abap$/.test(entry.name) === true) {
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
