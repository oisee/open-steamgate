// The definition-level exclusion seam (H5x-1). When the closure walk
// (tools/hana-closure.mjs) meets a class or interface whose findings sit
// outside every METHOD ... ENDMETHOD body -- the definition part, which no
// stub can reach -- it records the object in
// gen/hana-closure/closure-stubs.json as
// {level: "definition", file, object, findings} and keeps the file from the
// transpiler through this tree's own exclusion seam: the exclude_filter of
// tools/osd-build.mjs's ownConfig, the same one that keeps hidden and
// inactive files out. The file stays in its layer on disk; only the build
// is kept from it. One reader here -- tools/osd-build.mjs,
// tools/hana-ddic-gen.mjs's validationMessage (the loop's own validate
// channel) and tools/osd-inputs.mjs all read the same record -- and no
// dependency beyond node:fs, so the browser graph osd-inputs sits in stays
// clean.
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

// the record's path: gen/hana-closure/closure-stubs.json by default, the
// loop's --out when the walk ran with one -- OSD_HANA_CLOSURE_OUT is how the
// loop tells the readers it spawns (osd-build, hana-ddic-gen --from-build)
// where its record lives. A human running osd-inputs by hand sets it too.
export const closureStubsFile = (root) =>
  join(process.env.OSD_HANA_CLOSURE_OUT ?? join(root, "gen", "hana-closure"), "closure-stubs.json");

/** the closure-stubs.json records of one tree: [] when the walk has never
 *  run here, the records otherwise -- method stubs ({level: "method"}) and
 *  definition-level exclusions ({level: "definition"}). A file that is not
 *  readable JSON reads as empty: the record is the walk's output, and a
 *  half-written one must not silently hide objects from a build. */
export function closureStubs(root, file = closureStubsFile(root)) {
  if (existsSync(file) === false) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** the definition-level exclusion records of one tree; `file` -- the record
 *  path, for the loop's in-process reads of a non-default --out. */
export function definitionExclusions(root, file = undefined) {
  return closureStubs(root, file).filter((e) => e.level === "definition" && typeof e.file === "string");
}

/** the root-relative file paths kept from the transpiler. */
export function excludedFiles(root, file = undefined) {
  return definitionExclusions(root, file).map((e) => e.file);
}
