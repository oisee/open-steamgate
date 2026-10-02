// $TMP, the local package of every ABAP system, as a package of this one.
//
// What a real system has, measured on the A4H sandbox (2026-10-02,
// test/fixtures/tmp-package/a4h.json):
//
// - One TDEVC row named $TMP, not one per user: DLVUNIT (software component)
//   LOCAL, PARENTCL empty, PDEVCLASS (transport layer) empty, KORRFLAG
//   empty, delivered by SAP. Its text is "Temporary Objects (never
//   transported!)".
// - An object created in it carries its author (TADIR-AUTHOR, the logged-on
//   user), and needs no transport.
// - The tree of $TMP (repository/nodestructure, no user filter sent) is the
//   logged-on user's: their objects in $TMP and their local packages that
//   hang under $TMP or under nothing. Another user's objects and packages in
//   $TMP are not in it.
// - $TMP CAN be a parent. Sub-packages of $TMP exist on the system and a new
//   one created through ADT with superPackage $TMP was accepted (deleted
//   again). A spike note said otherwise; the system does not agree.
//
// Here a package is a folder (tools/osd-store.mjs), so $TMP is the folder
// TMP_FOLDER, under local/ because local/ is what git ignores: an object of
// $TMP is never transported, and the closest thing to a transport here is a
// commit. It is a layer of the build when it exists (tools/osd-packs.mjs), so
// what is created in it activates and runs like anything else. It never
// leaves for a system: tools/osd-deploy-manifest.mjs and
// tools/osd-abapgit-zip.mjs refuse it, closed rather than open.
//
// Who created an object is not something an abapGit file says, so it is kept
// beside the objects in TMP_AUTHORS, the TADIR of this one package.
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from "node:fs";
import {isAbsolute, join, relative, resolve} from "node:path";

export const TMP_PACKAGE = "$TMP";
export const TMP_FOLDER = "local/tmp";
export const TMP_TEXT = "Temporary Objects (never transported!)";
export const TMP_AUTHORS = "tadir.json";

/** The TDEVC attributes of $TMP as measured on A4H; what the package
 *  document and the refusals below say about it. */
export const TMP_ATTRIBUTES = Object.freeze({
  devclass: TMP_PACKAGE, parentcl: "", pdevclass: "", dlvunit: "LOCAL", korrflag: "",
});

export const isTmpPackage = (name) => String(name ?? "").toUpperCase() === TMP_PACKAGE;

/** the store root that holds $TMP */
export function tmpRoot() {
  return {path: TMP_FOLDER, writable: true, library: false, package: TMP_PACKAGE, tmp: true};
}

/** whether a path (absolute, or relative to `root`) is $TMP or inside it */
export function insideTmp(root, path) {
  const rel = relative(resolve(root, TMP_FOLDER), resolve(root, path));
  return rel === "" || (!isAbsolute(rel) && rel.split(/[\\/]/)[0] !== "..");
}

/** the package object of $TMP, written the first time something goes in */
export function ensureTmp(root) {
  const folder = join(root, TMP_FOLDER);
  mkdirSync(folder, {recursive: true});
  const devc = join(folder, "package.devc.xml");
  if (!existsSync(devc)) {
    writeFileSync(devc, `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DEVC" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DEVC>
    <CTEXT>${TMP_TEXT}</CTEXT>
   </DEVC>
  </asx:values>
 </asx:abap>
</abapGit>
`);
  }
  return folder;
}

/** "TYPE NAME" -> {author, createdAt}, for the objects of $TMP */
export function tmpAuthors(root) {
  try {
    return JSON.parse(readFileSync(join(root, TMP_FOLDER, TMP_AUTHORS), "utf8"));
  } catch {
    return {};
  }
}

export function recordAuthor(root, type, name, author) {
  const all = tmpAuthors(root);
  all[`${type} ${String(name).toUpperCase()}`] = {author: String(author).toUpperCase(), createdAt: new Date().toISOString()};
  writeAuthors(root, all);
}

export function forgetAuthor(root, type, name) {
  const all = tmpAuthors(root);
  const key = `${type} ${String(name).toUpperCase()}`;
  if (all[key] !== undefined) {
    delete all[key];
    writeAuthors(root, all);
  }
}

function writeAuthors(root, all) {
  ensureTmp(root);
  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeFileSync(join(root, TMP_FOLDER, TMP_AUTHORS), JSON.stringify(sorted, undefined, 1) + "\n");
}

/** The object keys ("PROG ZX") of every abapGit file under $TMP. What the
 *  deploy gate refuses by name, so a copy of a $TMP object made somewhere
 *  else does not travel either while the original is still local. */
export function tmpObjectKeys(root) {
  const keys = new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const m = /^(.+?)\.([a-z0-9]+)\.(abap|xml|asddls)$/i.exec(entry);
      if (m !== null && entry !== "package.devc.xml") {
        keys.add(`${m[2].toUpperCase()} ${m[1].replace(/#/g, "/").toUpperCase()}`);
      }
    }
  };
  walk(join(root, TMP_FOLDER));
  return keys;
}
