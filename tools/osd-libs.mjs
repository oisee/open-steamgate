#!/usr/bin/env node
// The library folders this tree reads, materialised from the config.
//
//   node tools/osd-libs.mjs           clone whatever is missing
//   node tools/osd-libs.mjs --check   say what is missing, clone nothing
//
// The library list comes from abap_transpile.json and its pinned repositories
// and refs come from libs.lock.json. The transpiler can fall back to a URL for
// a generic build, but the object store reads each folder from disk, so this
// command materialises and verifies the complete locked closure.
//
// On a workstation every folder is cloned, so the two agree and nobody
// notices. On a clean runner four of the six were missing, and the store's
// registry had no `/IWBEP/` and no APC family -- which came back as twelve
// failures that looked like twelve different things: "RAISE, unknown class
// /iwbep/cx_mgw_busi_exception", a check run that never reached `processed`,
// an activation that never reported `activationExecuted="true"`. Every one
// of them was this.
//
// The list is the config's, not a second one in a workflow file. A pair
// obliged to agree and maintained in two places is a defect deferred to its
// first divergence -- which is the sentence already written in
// osd-store.mjs, about the same list.
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readdirSync, statSync} from "node:fs";
import {dirname, join} from "node:path";
import {runsAs} from "./osd-main.mjs";
import {librariesFromLock} from "./osd-lock.mjs";

export function libraries(root = ".") {
  return librariesFromLock(root).libraries.map((lib) => ({...lib, at: lib.path}));
}

/** The library folders absent or empty on disk. */
export function missing(root = ".") {
  return libraries(root).filter((lib) => directoryHasContent(lib.at) === false);
}

function directoryHasContent(path) {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

function git(cwd, args) {
  return execFileSync("git", args, {cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function currentCommit(path) {
  try {
    return git(path, ["rev-parse", "HEAD"]);
  } catch {
    return undefined;
  }
}

function ensurePinnedClone(lib) {
  if (existsSync(lib.at)) {
    const actual = currentCommit(lib.at);
    if (actual === lib.ref) return false;
    let modified = false;
    if (actual !== undefined) {
      try {
        modified = git(lib.at, ["status", "--porcelain"]).length > 0;
      } catch {
        modified = true;
      }
    } else {
      modified = directoryHasContent(lib.at);
    }
    const state = actual === undefined ? "not a Git clone" : `at ${actual}`;
    throw new Error(`${lib.folder}: existing checkout is ${state}, expected ${lib.ref}${modified ? " and has local changes" : ""}; left untouched`);
  }

  mkdirSync(dirname(lib.at), {recursive: true});
  mkdirSync(lib.at, {recursive: false});
  try {
    git(process.cwd(), ["init", "--quiet", lib.at]);
    git(lib.at, ["remote", "add", "origin", lib.url]);
    git(lib.at, ["fetch", "--quiet", "--depth", "1", "origin", lib.ref]);
    git(lib.at, ["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
    const actual = currentCommit(lib.at);
    if (actual !== lib.ref) throw new Error(`${lib.folder}: fetched ${actual}, expected ${lib.ref}`);
    return true;
  } catch (error) {
    throw new Error(`${lib.folder}: could not clone ${lib.repo} at ${lib.ref}: ${String(error.stderr ?? error.message).trim()}`);
  }
}

export function materialise(root = ".", say = () => {}) {
  const cloned = [];
  for (const lib of libraries(root)) {
    if (existsSync(lib.at)) {
      const actual = currentCommit(lib.at);
      if (actual !== lib.ref) {
        // Do not move an existing checkout, even if it is clean: it may be a
        // worktree or a developer's source tree. Report the mismatch clearly.
        ensurePinnedClone(lib);
      }
      say(`osd-libs: ${lib.folder} already at ${lib.ref.slice(0, 12)}; left untouched`);
      continue;
    }
    say(`osd-libs: ${lib.folder} <- ${lib.url} @ ${lib.ref}`);
    ensurePinnedClone(lib);
    cloned.push(lib.folder);
  }
  return cloned;
}

if (runsAs("osd-libs.mjs")) {
  const root = process.cwd();
  if (process.argv.includes("--check")) {
    const gone = missing(root);
    for (const lib of gone) {
      console.log(`missing: ${lib.folder} (${lib.repo} at ${lib.ref})`);
    }
    const wrong = libraries(root).filter((lib) => directoryHasContent(lib.at) && currentCommit(lib.at) !== lib.ref);
    for (const lib of wrong) {
      const actual = currentCommit(lib.at);
      console.log(`wrong ref: ${lib.folder} is ${actual ?? "not a Git clone"}, expected ${lib.ref}; left untouched`);
    }
    console.log(`${libraries(root).length} libraries, ${gone.length} missing, ${wrong.length} at a different ref`);
    process.exit(gone.length === 0 && wrong.length === 0 ? 0 : 1);
  }
  const cloned = materialise(root, (m) => console.log(m));
  console.log(cloned.length === 0
    ? "osd-libs: every library folder is already there"
    : `osd-libs: cloned ${cloned.length}`);
}
