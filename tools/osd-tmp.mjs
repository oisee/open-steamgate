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
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync} from "node:fs";
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

/** "TYPE NAME" -> {author, createdAt}, for the objects of $TMP. `{}` when
 *  nothing was recorded yet; `null` when the record exists and cannot be
 *  read, which the store answers by showing nobody anything (fail closed):
 *  an unreadable ownership record is not a licence to show every user's
 *  objects to everyone. Said loudly, once per reading. */
export function tmpAuthors(root) {
  const file = join(root, TMP_FOLDER, TMP_AUTHORS);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch (e) {
    console.error(`osd-tmp: ${join(TMP_FOLDER, TMP_AUTHORS)} cannot be read (${e.message}); `
      + `no object of ${TMP_PACKAGE} is shown to anyone until it is repaired or removed`);
    return null;
  }
}

export function recordAuthor(root, type, name, author) {
  const all = readForUpdate(root);
  all[`${type} ${String(name).toUpperCase()}`] = {author: String(author).toUpperCase(), createdAt: new Date().toISOString()};
  writeAuthors(root, all);
}

export function forgetAuthor(root, type, name) {
  const all = readForUpdate(root);
  const key = `${type} ${String(name).toUpperCase()}`;
  if (all[key] !== undefined) {
    delete all[key];
    writeAuthors(root, all);
  }
}

// a broken record is not overwritten with a fresh one: that would make the
// loss of everybody's ownership permanent
function readForUpdate(root) {
  const all = tmpAuthors(root);
  if (all === null) {
    throw new Error(`${join(TMP_FOLDER, TMP_AUTHORS)} cannot be read; repair or remove it before changing ${TMP_PACKAGE}`);
  }
  return all;
}

// temp file + rename: an interrupted write leaves the old record or the new
// one, never a truncated file
function writeAuthors(root, all) {
  ensureTmp(root);
  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const file = join(root, TMP_FOLDER, TMP_AUTHORS);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, JSON.stringify(sorted, undefined, 1) + "\n");
  renameSync(temp, file);
}

/** every file under $TMP, relative to its folder, sorted; the deploy gate
 *  names the objects in them (tools/osd-deploy-manifest.mjs localObjectKeys) */
export function tmpFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry !== TMP_AUTHORS && !entry.endsWith(".tmp")) out.push(full);
    }
  };
  walk(join(root, TMP_FOLDER));
  return out;
}

/** OSD_TMP=off leaves $TMP out of the layers and the store: what a preview
 *  or any other published build runs with (scripts/build-preview.mjs) */
export const tmpDisabled = (env = process.env) => String(env.OSD_TMP ?? "").toLowerCase() === "off";

// ------------------------------------------------------------ names
//
// SAP's character set for repository names: A-Z, 0-9 and _, an optional
// /NAMESPACE/ in front, and for a local package a leading $. Anything else --
// a dot, a slash outside a namespace, a space -- is not a name, and a name
// here becomes a path, so the check is also what keeps a create inside its
// folder.
const OBJECT_NAME = /^(\/[A-Z0-9_]{1,10}\/)?[A-Z0-9_]{1,40}$/;
const PACKAGE_NAME = /^(\$|\/[A-Z0-9_]{1,10}\/)?[A-Z0-9_]{1,30}$/;

export function nameProblem(type, name) {
  const upper = String(name ?? "");
  if (upper !== upper.toUpperCase()) return `${type} ${name}: a repository name is upper case`;
  const ok = type === "DEVC" ? PACKAGE_NAME.test(upper) && upper.length <= 30 : OBJECT_NAME.test(upper);
  return ok ? undefined : `${type} "${name}" is not a repository name (A-Z, 0-9, _${type === "DEVC" ? ", a leading $" : ""}, an optional /NAMESPACE/)`;
}

// ------------------------------------------------------------ the generation

/** The modules of a transpiled generation that came from $TMP: a preview
 *  that carries one publishes a local object. `keys` are "TYPE NAME". */
export function tmpModulesIn(outputDir, keys) {
  let files;
  try {
    files = new Set(readdirSync(outputDir));
  } catch {
    return [];
  }
  const found = [];
  for (const key of keys) {
    const [type, ...rest] = key.split(" ");
    const stem = rest.join(" ").toLowerCase().replace(/\//g, "#");
    if (files.has(`${stem}.${type.toLowerCase()}.mjs`)) found.push(key);
  }
  return found.sort();
}

/** The transpiler files every object under devclass $TMP. Here that is the
 *  package of a few objects only, so the TADIR rows it hands over are
 *  rewritten: $TMP for an object of $TMP (`keys`, "TYPE NAME"), empty --
 *  "not known to the build" -- for the rest. ABAP that asks TADIR whether an
 *  object is local (zcl_stg_segw_repo) then gets a true answer. */
export function tadirWithTmp(statements, keys) {
  const re = /^(\s*INSERT INTO "tadir" \([^)]*\)\s*VALUES \('R3TR', '([^']*)', '([^']*)', )'\$TMP'/;
  return statements.map((statement) => {
    const m = re.exec(statement);
    if (m === null) return statement;
    const key = `${m[2].toUpperCase()} ${m[3].toUpperCase()}`;
    return statement.replace(re, `$1'${keys.has(key) ? TMP_PACKAGE : ""}'`);
  });
}
