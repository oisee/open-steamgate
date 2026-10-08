// What the Go host needs to answer DESTINATION 'STORE' over the files of a
// tree (go/objstore): the roots the Node store indexes, in its order,
// the file lists of its libraries, the build's exclusions, and a digest of
// every source file, including immutable archive layers, with retained active
// paths and digests from the generation rather than the current working tree.
//
// Read off the Node ObjectStore itself (tools/osd-store.mjs) rather than off
// abap_transpile.json a second time: the roots, the packs among them and the
// library file lists are its answer, and a second reading would be a second
// answer to the same question.
import {createHash} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {sourceSnapshotPath} from "../osd-source-snapshot.mjs";

export async function storeConfig(root, options = {}) {
  const {ObjectStore, exclusionsOf, INCLUDES, TYPES} = await import(options.storeModule ?? `${root}/tools/osd-store.mjs`);
  const store = options.store ?? new ObjectStore({root});
  const roots = store.roots.map((r) => ({path: r.path, writable: r.writable !== false, library: false,
    imported: r.imported === true, package: r.package ?? "", tmp: r.tmp === true, abapgit: r.abapgit,
    overlay: r.overlay ?? "", overlayOf: r.overlayOf ?? ""}));
  const libs = store.libs.map((r) => ({path: r.path, writable: false, library: true, imported: false, package: "",
    files: r.files ?? []}));
  const excluded = (options.excluded ?? store.excluded ?? exclusionsOf(root)).map((re) => re.source);
  const built = {};
  const active = {};
  const {liveHash} = await import("../osd-build.mjs");
  const hash = liveHash(root);
  for (const slim of store.list()) {
    const entry = store.find(slim.type, slim.name);
    if (entry === undefined || TYPES[entry.type]?.source !== true) continue;
    const includes = entry.type === "CLAS" ? Object.entries(INCLUDES) : [["main", ""]];
    for (const [include, suffix] of includes) {
      const file = entry.type === "CLAS" ? entry.file.replace(/\.clas\.abap$/, suffix) : entry.file;
      if (existsSync(join(root, file))) built[file] = digest(readFileSync(join(root, file)));
      if (hash === undefined) continue;
      // Let Node resolve complete snapshots, shared digest storage and overlays.
      // This also handles edits that happened before emission and empty includes.
      let retained;
      try { retained = store.read(entry.type, entry.name, include, "active"); }
      catch (error) { if (error.code === "NOT_FOUND") continue; throw error; }
      if (retained.empty) continue;
      const proof = digest(retained.source);
      const generation = join("build/by-input", hash);
      const original = entry.overlayOf ? join(entry.overlayOf, file.slice(entry.root.length + 1)) : file;
      const candidates = [
        join(generation, "source", sourceSnapshotPath(file)),
        join("build/inactive/active", sourceSnapshotPath(file)),
        join(generation, "source", sourceSnapshotPath(original)),
        join("build/source-by-digest", proof), file,
      ];
      const path = candidates.find(path => existsSync(join(root, path)) && digest(readFileSync(join(root, path))) === proof);
      if (path === undefined) throw new Error(`no retained active source path for ${file}`);
      built[file] = proof;
      active[file] = path;
    }
  }
  return {roots, libs, excluded, built, active};
}

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
