// What the Go host needs to answer DESTINATION 'STORE' over the files of a
// tree (go/abap/store.go): the roots the Node store indexes, in its order,
// the file lists of its libraries, the build's exclusions, and a digest of
// every file of a writable root, which is what "active" means for a binary
// (the file is still what this generation was built from).
//
// Read off the Node ObjectStore itself (tools/osd-store.mjs) rather than off
// abap_transpile.json a second time: the roots, the packs among them and the
// library file lists are its answer, and a second reading would be a second
// answer to the same question.
import {createHash} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

export async function storeConfig(root, options = {}) {
  const {ObjectStore, exclusionsOf, INCLUDES} = await import(options.storeModule ?? `${root}/tools/osd-store.mjs`);
  const store = options.store ?? new ObjectStore({root});
  const roots = store.roots.map((r) => ({path: r.path, writable: r.writable !== false, library: false,
    imported: r.imported === true, package: r.package ?? ""}));
  const libs = store.libs.map((r) => ({path: r.path, writable: false, library: true, imported: false, package: "",
    files: r.files ?? []}));
  const excluded = (options.excluded ?? store.excluded ?? exclusionsOf(root)).map((re) => re.source);
  // the digests of what this generation is built from: every file of an
  // object in a writable root, a class with each of its includes
  const built = {};
  for (const slim of store.list()) {
    const entry = store.find(slim.type, slim.name);
    if (entry === undefined || entry.library === true || entry.writable === false) continue;
    const files = entry.type === "CLAS"
      ? Object.values(INCLUDES).map((suffix) => entry.file.replace(/\.clas\.abap$/, suffix))
      : [entry.file];
    for (const file of files) {
      if (existsSync(join(root, file))) built[file] = createHash("sha256").update(readFileSync(join(root, file))).digest("hex");
    }
  }
  return {roots, libs, excluded, built};
}
