#!/usr/bin/env node
// The library folders this tree reads, materialised from the config.
//
//   node tools/osd-libs.mjs           clone whatever is missing
//   node tools/osd-libs.mjs --check   say what is missing, clone nothing
//
// **Two readers of `abap_transpile.json` disagree about what a missing
// folder means, and only one of them says so.** The transpiler falls back to
// the `url` and clones into a temporary directory for the length of a build
// (`loadLibs` in osd-transpile.mjs), so a build on a clean machine works.
// The object store does not: it reads `lib.folder` off the disk, and a
// folder that is not there is simply a library the registry does not have
// (`libraryRoots` in osd-store.mjs).
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
import {existsSync, mkdirSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {runsAs} from "./osd-main.mjs";

export function libraries(root = ".") {
  const file = join(root, "abap_transpile.json");
  const config = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  return (config.libs ?? []).map((lib) => ({
    url: lib.url,
    folder: lib.folder,
    at: lib.folder === undefined || lib.folder === "" ? undefined : join(root, lib.folder.replace(/^\//, "")),
  }));
}

/** The ones the store would not see. A library with no folder at all is not
 *  missing -- nothing reads it off the disk -- and one with no url cannot be
 *  fetched, which is a different problem and says so. */
export function missing(root = ".") {
  return libraries(root).filter((l) => l.at !== undefined && existsSync(l.at) === false);
}

export function materialise(root = ".", say = () => {}) {
  const cloned = [];
  for (const lib of missing(root)) {
    if (lib.url === undefined || lib.url === "") {
      throw new Error(`${lib.folder} is not there and the config gives no url to clone it from: `
        + `either clone it by hand or add a url in abap_transpile.json`);
    }
    mkdirSync(dirname(lib.at), {recursive: true});
    say(`osd-libs: ${lib.folder} <- ${lib.url}`);
    execFileSync("git", ["clone", "--quiet", "--depth", "1", "--", lib.url, lib.at], {stdio: "pipe"});
    cloned.push(lib.folder);
  }
  return cloned;
}

if (runsAs("osd-libs.mjs")) {
  const root = process.cwd();
  if (process.argv.includes("--check")) {
    const gone = missing(root);
    for (const lib of gone) {
      console.log(`missing: ${lib.folder}${lib.url ? `  (${lib.url})` : "  -- and no url to clone it from"}`);
    }
    console.log(`${libraries(root).length} libraries, ${gone.length} not on disk`);
    process.exit(gone.length === 0 ? 0 : 1);
  }
  const cloned = materialise(root, (m) => console.log(m));
  console.log(cloned.length === 0
    ? "osd-libs: every library folder is already there"
    : `osd-libs: cloned ${cloned.length}`);
}
