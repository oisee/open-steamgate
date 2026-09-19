// Two generations, compared byte for byte (backlog B.9).
//
// A generation is addressed by the hash of its inputs, and the point of that
// is that a name means one set of bytes. `--force` broke it quietly: it built
// again and replaced the directory, so a consumer pinned to `<hash>` saw
// different content under an unchanged name. B.9's own wording is the rule --
// a forced build should **build, compare and report**, or publish under a
// name of its own, and never both keep the name and change the bytes.
//
// What may legitimately differ is named, with the reason, the way the
// response and SQL sieves name theirs. Nothing else is allowed to.
import {readFileSync, readdirSync, statSync, existsSync} from "node:fs";
import {createHash} from "node:crypto";
import {join, relative} from "node:path";

/** fields of manifest.json that are about the BUILD and not about its output */
export const MANIFEST_VOLATILE = {
  ms: "how long the build took, which is the machine and the moment",
  builtAt: "when it ran",
};

function walk(dir, root = dir, out = []) {
  for (const e of readdirSync(dir, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = join(dir, e.name);
    if (e.isDirectory()) walk(path, root, out);
    else if (e.isSymbolicLink()) continue;              // a link is not content
    else out.push(relative(root, path));
  }
  return out;
}

/** the manifest with the volatile fields removed, so what is left is the output */
function stableManifest(text) {
  try {
    const m = JSON.parse(text);
    for (const key of Object.keys(MANIFEST_VOLATILE)) delete m[key];
    return JSON.stringify(m, null, 2);
  } catch {
    return text;
  }
}

/**
 * @returns {{same: boolean, files: number, onlyInA: string[], onlyInB: string[],
 *            differing: string[], collapsed: string[]}}
 */
export function compareGenerations(a, b) {
  if (!existsSync(a) || !existsSync(b)) {
    return {same: false, files: 0, onlyInA: [], onlyInB: [], differing: [], missing: !existsSync(a) ? a : b};
  }
  const left = new Set(walk(a));
  const right = new Set(walk(b));
  const onlyInA = [...left].filter((f) => !right.has(f));
  const onlyInB = [...right].filter((f) => !left.has(f));
  const differing = [];
  const collapsed = new Set();
  for (const file of left) {
    if (!right.has(file)) continue;
    let x = readFileSync(join(a, file));
    let y = readFileSync(join(b, file));
    if (x.equals(y)) continue;
    if (file === "manifest.json") {
      // the only file allowed to differ, and only in named fields
      const sx = stableManifest(x.toString("utf8"));
      const sy = stableManifest(y.toString("utf8"));
      if (sx === sy) {
        collapsed.add(`manifest.json: ${Object.keys(MANIFEST_VOLATILE).join(", ")}`);
        continue;
      }
    }
    differing.push(file);
  }
  return {
    same: onlyInA.length === 0 && onlyInB.length === 0 && differing.length === 0,
    files: left.size,
    onlyInA, onlyInB, differing,
    collapsed: [...collapsed],
  };
}

/**
 * What a build rewrote under `gen/` -- which is not what a generation holds.
 *
 * A generation directory carries `output/` (the transpiled modules) and the
 * manifest, and **no `gen/`**: the generated ABAP is an input to the
 * transpile, not part of its result. So `compareGenerations` answers "which
 * modules changed", and the question a screen asks after activating a CDS
 * view is "which OBJECTS were regenerated" -- a different population, one
 * hop away (osg-osd-i7 asked which of the two this machinery gives;
 * measured rather than remembered, it gives the first).
 *
 * Why the question is worth answering at all: activating a **class** writes
 * one file. Activating a plain CDS view writes **three** -- the DDIC view
 * under the CDS name, the same under the SQL view name, and the source
 * class. Activating a view with `@OData.publish` writes **fourteen**,
 * because the YAML goes through `stg-compile` and a whole service comes out:
 * MPC, MPC_EXT, DPC, DPC_EXT with their XML, IWSV, IWMO. A screen that says
 * "activated" and lists nothing hides that it has just rewritten a service
 * nobody opened.
 */
export function snapshotOf(dir) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  const walk = (at) => {
    for (const e of readdirSync(at, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(at, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(path);
      else out.set(relative(dir, path), createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16));
    }
  };
  walk(dir);
  return out;
}

/** @returns {{written: string[], removed: string[], unchanged: number}} */
export function changedSince(before, dir) {
  const after = snapshotOf(dir);
  const written = [];
  let unchanged = 0;
  for (const [path, hash] of after) {
    if (before.get(path) === hash) unchanged += 1;
    else written.push(path);
  }
  const removed = [...before.keys()].filter((path) => !after.has(path));
  return {written: written.sort(), removed: removed.sort(), unchanged};
}
