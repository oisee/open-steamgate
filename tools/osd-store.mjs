// The object store of OSD, the off-stack doppelgänger: what sits behind
// the ADT façade. A client asks for an object by type and name; this finds
// the file, reads it, writes it, checks it and activates it. The façade
// above never touches the file system, this never parses HTTP.
//
// What an object is here: a file, the way abapGit names it, in this
// repository (src/, gen/) or in a library beside it (.local/lars/*, the
// open-abap clones), which is how OSD has a system's worth of content
// without anyone typing it. A library object is read-only, ours is not.
//
// What activation is: abaplint's syntax and semantic check over the whole
// registry, because a class that compiles alone can still break the system
// it is part of. The check returns the same shape for a write and for an
// activation, since the façade reports both the same way.
import {closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, watch, writeFileSync, writeSync} from "node:fs";
import {createHash} from "node:crypto";
import {CREATABLE} from "./osd-store-create.mjs";
import {ddlsIssues} from "./osd-store-ddls.mjs";
import {entityOf} from "./ddls-entity.mjs";
import {inputFoldersOf, packRootsOf} from "./osd-packs.mjs";
import {libraryFiles} from "./osd-inputs.mjs";
import {hashOf, inputsOf, loadConfig, normalPath} from "./osd-build.mjs";
import {transpileIssues, withoutHostPaths} from "./osd-build-issues.mjs";
import {copyDurable, mkdirDurable, removeDurable, renameDurable, writeDurable} from "./osd-durable.mjs";

import {basename, dirname, join, relative, resolve} from "node:path";
import * as abaplint from "@abaplint/core";
import {Data} from "./osd-data.mjs";
import {ServingRuntime} from "./osd-runtime.mjs";
import {RuntimePool} from "./osd-pool.mjs";
import {runsAs} from "./osd-main.mjs";

// a process that has taken this many warm swaps, or has been quiet this long
// after one, is replaced by one started on the live generation: every swap
// leaves its old module instances in the module map, and the start-up's own
// work (the init script's rows) is only done by a start
const WARM_SWAPS = Number(process.env.OSD_WARM_SWAPS ?? 25);
const WARM_QUIET_MS = Number(process.env.OSD_WARM_QUIET_MS ?? 60000);
// ... or whose heap has grown this much since its first swap
const WARM_HEAP_MB = Number(process.env.OSD_WARM_HEAP_MB ?? 512);
// how long after a cold build the registry waits before it is primed again
const WARM_REPRIME_MS = Number(process.env.OSD_WARM_REPRIME_MS ?? 5000);
// how long a publish waits for a runtime changing hands (a recycle, a
// start) before it answers that it is still changing rather than hang
const TRANSITION_MS = Number(process.env.OSD_TRANSITION_MS ?? 60000);

import {fileOf, nameOf, TYPES, STRUCTURE_TABCLASS, INCLUDES} from "./osd-store-types.mjs";
export {fileOf, nameOf, TYPES, STRUCTURE_TABCLASS, INCLUDES} from "./osd-store-types.mjs";

// A package is a folder. abapGit's PREFIX logic names the folders of a
// repository after the package they hold, so a tree that came from a system
// carries the names, and a tree that did not, like ours, gets them from the
// layout: the root's own name, then one segment per folder below it. When
// real content arrives with its package.devc.xml files, the names and the
// texts come from those and nothing above this changes.
const ROOT_PACKAGES = {
  src: "$STG",
  local: "$OSD",
  test: "$STG_TEST",
  gen: "$STG_GEN",
};

// A folder that is a package of its own rather than a child of the root
// above it. The demo package lives inside src but is not part of $STG.
const FOLDER_PACKAGES = {
  "src/zosd_test": "$ZOSD_TEST",
};

// A package above all of ours, if one is wanted. It was tried as $Z and
// taken out again the same day: one more level to click through, in the
// system library and in the favourites alike, bought nothing a person
// wanted. null means the roots are the roots.
const SUPER_PACKAGE = null;

// the open-abap clones beside us: a system's worth of standard objects,
// read-only, and the reason a package tree looks inhabited
// The libraries, as the BUILD reads them -- folder, `files` patterns and
// `exclude_filter` of each entry in abap_transpile.json, resolved by the one
// body in tools/osd-inputs.mjs.
//
// It used to be a hand-written list of three folders while the config
// configured six, and everything compiled and ran: only the **check** was
// wrong, because the registry it builds could not see `open-abap-apc`,
// `abapgit` or `open-abap-gui`. A class extending one of their classes was
// reported broken -- `Super class "cl_apc_wsp_ext_stateful_base" not found or
// contains errors` -- by an editor that had just been handed to somebody to
// use (2026-09-19, Alice, on two classes at once). A pair obliged to agree,
// maintained in two places, is a defect deferred to its first divergence.
//
// The path of a root is kept as `<folder>/src` where the file lives under it,
// because a library object's package is derived from its path and moving the
// root up a level would rename every one of them.
function libraryRoots(root) {
  const byPath = new Map();
  for (const {folder, files} of libraryFiles(root)) {
    const base = folder.replace(/^\//, "");
    for (const full of files) {
      const file = relative(root, full);
      const src = base + "/src";
      const path = file.startsWith(src + "/") ? src : base;
      if (byPath.has(path) === false) {
        byPath.set(path, {path, writable: false, library: true, files: []});
      }
      byPath.get(path).files.push(file);
    }
  }
  return [...byPath.values()];
}

// Parsing the system costs seconds and every store of the same tree parses
// the same thing, so the answer is kept per root and dropped the moment
// anything is written. A façade that makes a store per request pays once.
const PARSED = new Map();

const packageWord = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

// The roots as the transpiler lists them: the input_folder of
// abap_transpile.json, in its order, so that the index and the build resolve
// a name to the same file (tools/osd-inputs.mjs: the later root wins in
// both, the way a layer does; a library never wins over a root). A tree
// without the config uses the build's fallback. gen/ is never written by hand,
// and what sits under local/ was imported, not written here.
/** The exclusions that mean "this is not an object of this system".
 *
 *  The gap this closed: `gen/segw-editor/` (the SEGW editor's "Save to gen/"
 *  button wrote it, until that was removed on 2026-09-25) was left out of
 *  the build on purpose, and the store indexed it anyway -- so the ADT façade and the cross reference described
 *  objects the system does not contain. Measured on this tree, which had
 *  been used: four such classes (fable-osd found the symptom in
 *  `test/osd-xref.mjs`, which named one of them).
 *
 *  **It is a named list rather than a rule read off `exclude_filter`, and
 *  that is the finding.** Three attempts at inferring which entries meant
 *  "not ours" were wrong in three different directions: all of them removed
 *  13 CDS views, because `\.ddls\.` is there to stop the transpiler reading
 *  a file it cannot compile; folder-shaped ones removed the program in
 *  `test/fixtures/` that the ADT tests read. The build's question is "can
 *  the transpiler read this file", the store's is "is this an object of the
 *  system", and no amount of looking at the pattern turns one into the
 *  other. It is intent, so it is stated.
 *
 *  `test/store-exclusions.mjs` checks that every entry is also in
 *  `exclude_filter`, so the two cannot drift into disagreeing. */
export function exclusionsOf(root) {
  try {
    const config = JSON.parse(readFileSync(join(root, "abap_transpile.json"), "utf8"));
    return (config.not_in_system ?? []).map((pattern) => new RegExp(pattern));
  } catch {
    return [];
  }
}

export function rootsOf(root, env = process.env) {
  const config = loadConfig(root);
  const packs = new Map(packRootsOf(root, env).map((pack) => [pack.path, pack]));
  return inputFoldersOf(root, config, env).map((path) => packs.get(path) ?? ({
    path, writable: path !== "gen", library: false,
    ...(path === "local" || path.startsWith("local/") ? {imported: true} : {}),
  }));
}

export class ObjectStore {
  constructor(options = {}) {
    this.root = options.root ?? process.cwd();
    this.explicitRoots = options.roots !== undefined;
    this.roots = options.roots ?? rootsOf(this.root);
    // the build's exclusions are the store's too, from the same file
    this.excluded = options.excluded ?? exclusionsOf(this.root);
    this.superPackage = options.superPackage === undefined ? SUPER_PACKAGE : options.superPackage;
    this.libs = options.libs === undefined
      ? libraryRoots(this.root)
      : options.libs.map((p) => ({path: p, writable: false, library: true}));
    this.index = undefined;
    this.parsed = undefined;
    // What has been written and not activated since. A system keeps an
    // inactive version of such an object and says so in its documents; a
    // client that saved and then read the object back unchanged took its
    // own copy for the newer one and showed an empty editor over a save
    // that had succeeded. Written marks it, a clean activation clears it.
    this.inactive = new Set();
    // **And an inactive object is not built.** The saved version is the
    // file, because the tree is the working area every other editor shares;
    // the version that was active before the first save after an activation
    // is kept beside the build (`build/inactive/active/<file>`), and the
    // build takes that one, or leaves the object out when it never had one
    // (#overlay). The set and the copies survive a restart in
    // `build/inactive/`, which is gitignored with the rest of build/.
    this.inactiveDir = join("build", "inactive");
    // what every cold build of this store is also given (a test's tree of a
    // few objects has nothing to generate: {generators: false})
    this.buildOptions = options.build ?? {};
    // a test's crash: the named step throws, leaving the disk as a process
    // killed there would (#crash)
    this.crashAt = options.crashAt;
    this.#loadInactive();
  }

  #crash(point) {
    if (this.crashAt === point) {
      const error = new Error(`crashed at ${point}`);
      error.code = "CRASH";
      throw error;
    }
  }

  // The set as saved: per object, its files and the digest of what was
  // saved in them. The order of every step is the recoverable one:
  //   a save:       active copy, then the set (with the digest the save will
  //                 have), then the source -- a crash before the source
  //                 leaves an object inactive whose file is still active;
  //   an activation: the set, then the copies -- a crash between leaves a
  //                 copy nobody owns, which the next start removes;
  //   a delete:     the files, then the set, then the copies.
  // The set is replaced atomically (temp, fsync, rename), so no crash
  // truncates it. A file that no longer hashes to its digest was changed
  // outside (a checkout, another editor): it stays inactive, with its
  // active copy, until somebody activates it; nothing claims an activation
  // that did not happen. An object whose files are all gone is gone.
  #loadInactive() {
    const file = join(this.root, this.inactiveDir, "inactive.json");
    let saved;
    try {
      saved = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT" && existsSync(file)) {
        // unreadable, and not by a crash of ours (the replace is atomic): kept
        // aside, and every active copy kept
        console.log(`inactive: ${file} is unreadable (${error.message}); kept aside, the set is read off the active copies`);
        try {
          renameSync(file, `${file}.unreadable-${Date.now()}`);
        } catch {
          // read-only
        }
      }
      // **Fail closed.** No set, or none that can be read, while active
      // copies exist: every object with a copy is inactive -- a copy is made
      // only for one -- and what its saved files should hold is unknown, so
      // it is "changed outside, inactive until activated". An empty set here
      // built the saved source of a broken class at the next publication.
      this.#recoverFromCopies();
      return;
    }
    let changed = false;
    for (const [key, record = {}] of Object.entries(saved.inactive ?? {})) {
      const files = Array.isArray(record.files) ? record.files : [];
      if (files.length > 0 && !files.some((f) => existsSync(join(this.root, f)))) {
        changed = true;
        continue;
      }
      const digest = this.#digestOf(files);
      const outside = record.outside === true || (record.digest !== undefined && digest !== record.digest);
      if (outside !== (record.outside === true) || digest !== record.digest) changed = true;
      this.inactive.add(key);
      this.#saved.set(key, {files, digest, ...(outside ? {outside: true} : {})});
    }
    if (changed) this.#saveInactive();
    this.#dropOrphanCopies();
  }

  // the set read off build/inactive/active: each copy names a file of the
  // tree, the file names its object. A copy whose object is gone is kept
  // (nothing is removed on a guess) and builds nothing (#overlay).
  #recoverFromCopies() {
    const folder = join(this.root, this.inactiveDir, "active");
    if (!existsSync(folder)) return;
    const copies = new Set(walkFiles(folder).map((f) => relative(folder, f).split("\\").join("/")));
    if (copies.size === 0) return;
    this.#keepOrphans = true;
    for (const entry of this.#entries().values()) {
      const files = this.#filesOfEntry(entry);
      if (!files.some((f) => copies.has(f.split("\\").join("/")))) continue;
      const key = `${entry.type} ${entry.name}`;
      this.inactive.add(key);
      this.#saved.set(key, {files, digest: this.#digestOf(files), outside: true});
    }
    if (this.inactive.size > 0) this.#saveInactive();
  }

  #saved = new Map();
  #keepOrphans = false;

  // a copy that no saved object owns: what a crash between an activation's
  // set and its copies leaves behind
  #dropOrphanCopies() {
    if (this.#keepOrphans) return;
    const folder = join(this.root, this.inactiveDir, "active");
    if (!existsSync(folder)) return;
    const owned = new Set([...this.#saved.values()].flatMap((r) => r.files.map((f) => resolve(this.root, this.#snapshotOf(f)))));
    for (const file of walkFiles(folder)) {
      if (!owned.has(resolve(file))) removeDurable(file);
    }
  }

  // Whether `file` (relative to the root) belongs to an object that is
  // inactive and still holds exactly the version saved through this store:
  // an ADT save (or create) waiting for its activation. The dev loop
  // (tools/osd-dev.mjs) never builds such a file -- a save is not an
  // activation, and building it there was a cold build and a recycle per
  // create and per PUT, besides the activation's (vsp-i7, 0.6.1511: 21
  // recycles), and would have made a saved-only version live.
  // This is the persistent inactive set, not a record of the write: it
  // ends with the activation, the delete, or bytes that differ from the
  // saved version (`outside`, which the dev loop builds like any change).
  // So the same bytes again -- another editor, a checkout, a watcher event
  // that comes late -- are that same inactive source, and wait for it to be
  // activated, however long.
  savedInactive(file) {
    const wanted = join(String(file));
    for (const key of this.inactive) {
      const record = this.#saved.get(key);
      if (record === undefined || record.outside === true || !record.files.some((f) => join(f) === wanted)) continue;
      return this.#digestOf(record.files) === record.digest;
    }
    return false;
  }

  #digestOf(files, override = new Map()) {
    const hash = createHash("sha256");
    for (const file of files) {
      hash.update(file).update("\0");
      if (override.has(file)) hash.update(override.get(file));
      else if (existsSync(join(this.root, file))) hash.update(readFileSync(join(this.root, file)));
      hash.update("\0");
    }
    return hash.digest("hex");
  }

  #saveInactive() {
    const dir = join(this.root, this.inactiveDir);
    for (const key of [...this.#saved.keys()]) {
      if (!this.inactive.has(key)) this.#saved.delete(key);
    }
    if (this.inactive.size === 0 && !existsSync(dir)) return;
    mkdirDurable(dir);
    const inactive = Object.fromEntries([...this.#saved.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const target = join(dir, "inactive.json");
    const temp = `${target}.${process.pid}.tmp`;
    // the bytes, flushed; then the name, flushed: durable once this returns
    writeDurable(temp, JSON.stringify({inactive}, null, 1) + "\n");
    this.#crash("save:before-rename");
    renameDurable(temp, target);
    this.#crash("save:after-rename");
  }

  // every file of one object in the tree: the source, a class's includes,
  // the abapGit header beside it
  #filesOfEntry(entry) {
    const meta = TYPES[entry.type];
    const files = [entry.file];
    if (entry.type === "CLAS") {
      files.push(...Object.values(INCLUDES).map((suffix) => entry.file.replace(/\.clas\.abap$/, suffix)));
    }
    if (meta !== undefined && entry.type !== "DEVC" && (meta.ext.endsWith(".abap") || meta.ext.endsWith(".asddls"))) {
      files.push(entry.file.slice(0, -meta.ext.length) + meta.ext.replace(/\.(abap|asddls)$/, ".xml"));
    }
    return [...new Set(files)];
  }

  #snapshotOf(file) {
    return join(this.inactiveDir, "active", file);
  }

  #hasCopy(entry) {
    return this.#filesOfEntry(entry).some((file) => existsSync(join(this.root, this.#snapshotOf(file))));
  }

  // the active version of an object, copied aside before its first save
  // after an activation overwrites it
  #keepActive(entry) {
    const key = `${entry.type} ${entry.name}`;
    if (this.inactive.has(key)) return;
    for (const file of this.#filesOfEntry(entry)) {
      if (!existsSync(join(this.root, file))) continue;
      const copy = join(this.root, this.#snapshotOf(file));
      mkdirDurable(dirname(copy));
      copyDurable(join(this.root, file), copy);
      this.#crash("keep:after-copy");
    }
  }

  #dropActiveCopy(entry) {
    for (const file of this.#filesOfEntry(entry)) {
      const copy = join(this.root, this.#snapshotOf(file));
      if (existsSync(copy)) removeDurable(copy);
    }
  }

  // the intent, before the bytes: the set says the object is inactive and
  // what its files will hold once `pending` (file -> text) is written
  #markInactive(entry, pending = new Map()) {
    const key = `${entry.type} ${entry.name}`;
    const files = this.#filesOfEntry(entry);
    this.inactive.add(key);
    this.#saved.set(key, {files, digest: this.#digestOf(files, pending)});
    this.#saveInactive();
  }

  #markActive(type, name) {
    const key = `${type} ${String(name).toUpperCase()}`;
    if (!this.inactive.has(key)) return;
    const entry = this.find(type, name);
    this.inactive.delete(key);
    // the removal is durable (#saveInactive returns after the rename and
    // its directory are flushed) before any copy goes
    this.#saveInactive();
    this.#crash("activate:before-copies");
    if (entry !== undefined) this.#dropActiveCopy(entry);
  }

  // The inactive objects as one build takes them (tools/osd-build.mjs
  // activeOverlay): every file of an inactive object is excluded, and its
  // last active version comes from build/inactive/active when there is one.
  // The objects THIS publication activates (`activating`, a set of
  // "TYPE NAME") are built with their saved version instead -- that is what
  // activating them means -- so their copies are excluded. Another
  // publication's objects are not this one's: each build is given its own.
  // undefined when there is nothing to keep out.
  overlay(activating = new Set()) {
    const kept = [];
    const copied = [];
    const unused = [];
    const owned = new Set();
    for (const key of this.inactive) {
      const [type, ...rest] = key.split(" ");
      const entry = this.find(type, rest.join(" "));
      if (entry === undefined) continue;
      const mine = activating.has(key);
      for (const file of this.#filesOfEntry(entry)) {
        const copy = this.#snapshotOf(file);
        const hasCopy = existsSync(join(this.root, copy));
        if (mine) {
          if (hasCopy) unused.push(resolve(this.root, copy));
          continue;
        }
        if (existsSync(join(this.root, file))) kept.push(resolve(this.root, file));
        if (hasCopy) {
          copied.push(copy);
          owned.add(resolve(this.root, copy));
        }
      }
    }
    // no copy is an input: the tree's own inactive files are all there is
    // to leave out, and nothing at all is the build as it always was --
    // which keeps an ordinary save-then-activate on the warm path
    if (copied.length === 0) return kept.length === 0 ? undefined : {exclude: kept.sort()};
    // a copy nobody inactive owns any more (an object deleted under us) is
    // not an input either
    const folder = join(this.root, this.inactiveDir, "active");
    for (const file of walkFiles(folder)) {
      if (!owned.has(resolve(file))) unused.push(resolve(file));
    }
    return {exclude: [...new Set([...kept, ...unused])].sort(), folder: join(this.inactiveDir, "active")};
  }

  // The registry as the build of `activating` would see the system: every
  // other inactive object as its active copy, or absent when it never had
  // one, for the length of one call. What a precheck says about a dependent
  // is then what the build will say, not what an unactivated save says
  // (#withSource's borrowing, for several files).
  #withOverlay(activating, fn) {
    const registry = this.registry();
    const swapped = [];
    for (const key of this.inactive) {
      if (activating.has(key)) continue;
      const [type, ...rest] = key.split(" ");
      const entry = this.find(type, rest.join(" "));
      if (entry === undefined) continue;
      for (const file of this.#filesOfEntry(entry)) {
        if (!/\.(abap|xml|asddls)$/.test(file)) continue;
        const name = "/" + file;
        const before = registry.getFileByName(name);
        const copy = join(this.root, this.#snapshotOf(file));
        if (existsSync(copy)) {
          const replacement = new abaplint.MemoryFile(name, readFileSync(copy, "utf8"));
          if (before === undefined) registry.addFile(replacement);
          else registry.updateFile(replacement);
          swapped.push({name, before, replacement});
        } else if (before !== undefined) {
          registry.removeFile(before);
          swapped.push({name, before, replacement: undefined});
        }
      }
    }
    if (swapped.length === 0) return fn(registry);
    try {
      registry.parse();
      return fn(registry);
    } finally {
      for (const {before, replacement} of swapped.reverse()) {
        if (before === undefined) registry.removeFile(replacement);
        else if (replacement === undefined) registry.addFile(before);
        else registry.updateFile(before);
      }
      registry.parse();
    }
  }

  // the inactive objects, for the ADT inactive-objects feed
  inactiveObjects() {
    return [...this.inactive].sort().map((key) => {
      const [type, ...rest] = key.split(" ");
      const name = rest.join(" ");
      const entry = this.find(type, name);
      return {type, name, package: entry?.package, file: entry?.file};
    });
  }

  // the config changed under us (an import listed its folder as an input):
  // the roots are read again, unless a caller chose them
  reroot() {
    if (this.explicitRoots === false) {
      this.roots = rootsOf(this.root);
    }
    this.index = undefined;
    this.#forget();
    return this.roots;
  }

  // the state of one object as its documents report it
  stateOf(entry) {
    let changedAt;
    try {
      changedAt = statSync(join(this.root, entry.file)).mtime.toISOString().replace(/\.\d{3}Z$/, "Z");
    } catch {
      changedAt = undefined;
    }
    return {changedAt, version: this.inactive.has(`${entry.type} ${entry.name}`) ? "inactive" : "active"};
  }

  // An activation checks one source revision. A save can arrive while the
  // build is running, including from another editor writing to the worktree.
  #sourceRevision(type, name) {
    const entry = this.find(type, name);
    if (entry === undefined) return undefined;
    return this.#revisionOf(entry, (file) => existsSync(join(this.root, file))
      ? createHash("sha256").update(readFileSync(join(this.root, file))).digest("hex") : "");
  }

  // a revision is the files of an object and the digest of each: the same
  // whether it is read off the disk or off the digests a build read
  // (tools/osd-build.mjs hashOf), so a completion compares like with like
  #revisionOf(entry, digestOf) {
    const files = entry.type === "CLAS"
      ? Object.values(INCLUDES).map((suffix) => entry.file.replace(/\.clas\.abap$/, suffix))
      : [entry.file];
    const hash = createHash("sha256");
    for (const file of files) hash.update(file).update("\0").update(digestOf(file)).update("\0");
    return hash.digest("hex");
  }

  #builtRevision(key, digests) {
    const [type, ...rest] = key.split(" ");
    const entry = this.find(type, rest.join(" "));
    if (entry === undefined) return undefined;
    return this.#revisionOf(entry, (file) => digests.get(normalPath(join(this.root, file))) ?? "");
  }

  // ---------------------------------------------------------------- index

  #walk(dir, out) {
    let entries;
    try {
      // sorted, so two walks of one tree index it the same way
      entries = readdirSync(join(this.root, dir)).sort();
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git") {
        continue;
      }
      const relative = join(dir, entry);
      if (statSync(join(this.root, relative)).isDirectory()) {
        this.#walk(relative, out);
      } else {
        // the build's exclusions, matched the way the transpiler matches them
        // -- against the path with a leading slash
        if (this.excluded.some((re) => re.test("/" + relative))) {
          continue;
        }
        out.push(relative);
      }
    }
    return out;
  }

  // the chain of packages a file sits in: the root's package, then one per
  // folder below it. The chain is the hierarchy; the name is only its last
  // link joined up, so a name that happens to hold an underscore does not
  // invent a parent that is not there.
  #packagesOf(file, root) {
    const own = Object.keys(FOLDER_PACKAGES).find((folder) => file.startsWith(folder + "/"));
    const bases = own !== undefined ? [FOLDER_PACKAGES[own]]
      // a pack says which package it is (tools/osd-packs.mjs)
      : root.package !== undefined ? [root.package]
      : ROOT_PACKAGES[root.path] !== undefined ? [ROOT_PACKAGES[root.path]]
      // an imported repository is a package of its own under the one that
      // holds every import: local/o4d is $OSD_O4D under $OSD, as it was
      // when local/ was one root rather than one root per repository
      : root.path.startsWith("local/") ? [ROOT_PACKAGES.local, `${ROOT_PACKAGES.local}_${packageWord(root.path.slice("local/".length))}`]
      : ["$" + packageWord(root.path.split("/").filter((p) => p !== "src" && p !== "." && p !== ".local" && p !== "lars").pop() ?? root.path)];
    const inside = file.slice((own ?? root.path).length).split("/").filter((p) => p !== "");
    inside.pop();
    const chain = [...bases];
    for (const folder of inside) {
      chain.push(`${chain[chain.length - 1]}_${folder.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`);
    }
    return chain;
  }

  // every object of every root, by type and name
  build() {
    const index = new Map();
    for (const root of [...this.roots, ...this.libs]) {
      // a library brings the file list the BUILD reads; a root is walked
      for (const file of root.files ?? this.#walk(root.path, [])) {
        const name = basename(file);
        for (const [type, meta] of Object.entries(TYPES)) {
          if (!name.endsWith(meta.ext) || meta.sameFileAs !== undefined) {
            continue;
          }
          const chain = this.#packagesOf(file, root);
          // abapGit calls every package file package.devc.xml and lets the
          // folder say which package it is, so the object is named after the
          // folder rather than after the file
          const objectName = type === "DEVC" && name === "package.devc.xml"
            ? chain[chain.length - 1]
            : nameOf(name.slice(0, -meta.ext.length));
          const key = `${type} ${objectName}`;
          // a later root wins over an earlier one, the way the build resolves
          // the same list (tools/osd-inputs.mjs); a library is not a layer,
          // so it fills only what no root has
          if (root.library !== true || !index.has(key)) {
            // a package is an object of the package above it, the way a
            // system holds it, so its own folder is not also its home
            const own = type === "DEVC" && objectName === chain[chain.length - 1];
            const home = own && chain.length > 1 ? chain.slice(0, -1)
              // a root package's own object goes to the package above every
              // root, when there is one; a root holds no object of itself
              : own && this.superPackage ? [this.superPackage]
              : chain;
            index.set(key, {type, name: objectName, file, root: root.path, writable: root.writable, library: root.library,
                            imported: root.imported === true, package: home[home.length - 1], packages: home});
          }
          break;
        }
      }
    }
    this.index = index;
    // the index was rebuilt because files changed under us and we do not
    // know which, an import being the reason this exists. The parse
    // describes the system as it was, so it goes: a check against a parse
    // that predates the objects it is checking is the worst kind of fast.
    this.#forget();
    return index;
  }

  #ddlsEntities() {
    const entries = this.#entries();
    if (this.ddlsEntityIndex === undefined || this.ddlsEntityIndexOf !== entries) {
      // as the folder dictionary does: two sources defining one entity are
      // not valid on a system, so neither is taken
      const byEntity = new Map();
      const twice = new Set();
      for (const entry of entries.values()) {
        if (entry.type !== "DDLS") continue;
        let entity;
        try { entity = entityOf(readFileSync(join(this.root, entry.file), "utf8")); } catch { entity = undefined; }
        if (entity === undefined || entity === String(entry.name).toUpperCase()) continue;
        if (byEntity.has(entity)) twice.add(entity);
        byEntity.set(entity, entry);
      }
      for (const entity of twice) byEntity.delete(entity);
      this.ddlsEntityIndex = byEntity;
      this.ddlsEntityIndexOf = entries;
    }
    return this.ddlsEntityIndex;
  }

  #entries() {
    if (this.index === undefined) {
      this.build();
    }
    return this.index;
  }

  // ----------------------------------------------------------- the seam

  // every object, or every object of a type
  list(type) {
    const out = [];
    for (const entry of this.#entries().values()) {
      if (type === undefined || entry.type === type) {
        out.push({type: entry.type, name: entry.name, library: entry.library, writable: entry.writable});
      }
    }
    return out.sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name));
  }

  /** Package and source layer for a declaration path that is not itself an
   *  indexed ADT object (such as a *.tran.xml). */
  locationOf(file) {
    const relativeFile = String(file).replaceAll("\\", "/");
    const root = this.roots.filter((candidate) => relativeFile.startsWith(`${candidate.path}/`))
      .sort((a, b) => a.path.length - b.path.length).at(-1);
    if (!root) return undefined;
    return {package: this.#packagesOf(relativeFile, root).at(-1), layer: root.path};
  }

  find(type, name) {
    const key = String(name).toUpperCase();
    const direct = this.#entries().get(`${type} ${key}`);
    if (direct !== undefined) {
      return direct;
    }
    // an include is a program on disk, a structure is a table
    if (type === "INCL") {
      const program = this.#entries().get(`PROG ${key}`);
      return program === undefined ? undefined : {...program, type: "INCL"};
    }
    if (type === "STRU") {
      const table = this.#entries().get(`TABL ${key}`);
      if (table === undefined) {
        return undefined;
      }
      return readFileSync(join(this.root, table.file), "utf8").includes(`<TABCLASS>${STRUCTURE_TABCLASS}</TABCLASS>`)
        ? {...table, type: "STRU"}
        : undefined;
    }
    return undefined;
  }

  exists(type, name) {
    return this.find(type, name) !== undefined;
  }

  // the source of an object, or of one of a class's includes
  // Which includes a class actually has on disk.
  //
  // A client builds the class's file list from this: against a real system a
  // class appears as a folder holding .clas.abap beside .clas.locals_def.abap
  // and its siblings, and a class document that lists only main gets a single
  // flat file. Reporting an include that is not there would be worse — a file
  // in the tree that opens empty.
  classIncludes(name) {
    const entry = this.find("CLAS", name);
    if (entry === undefined) {
      return [];
    }
    const present = [];
    for (const [include, suffix] of Object.entries(INCLUDES)) {
      if (include === "main") {
        continue;
      }
      if (existsSync(join(this.root, entry.file.replace(/\.clas\.abap$/, suffix)))) {
        present.push(include);
      }
    }
    return present;
  }

  read(type, name, include = "main") {
    // a DDLS may be read by the entity it defines, when that is not its
    // object name (FOR TABLE FUNCTION names the entity). Only a read: a
    // write or a delete resolves its target by object name, never by entity,
    // or it would land in another object's file (foreman-dell, 2026-09-23)
    const entry = this.find(type, name)
      ?? (String(type).toUpperCase() === "DDLS" ? this.#ddlsEntities().get(String(name).toUpperCase()) : undefined);
    if (entry === undefined) {
      throw new NotFound(type, name);
    }
    if (type === "CLAS" && include !== "main") {
      // own keys only: "constructor" or "toString" is no include
      const suffix = Object.hasOwn(INCLUDES, include) ? INCLUDES[include] : undefined;
      if (suffix === undefined) {
        throw new NotFound(type, `${name} include ${include}`);
      }
      const file = entry.file.replace(/\.clas\.abap$/, suffix);
      if (!existsSync(join(this.root, file))) {
        return {...entry, include, source: "", empty: true};
      }
      return {...entry, include, file, source: readFileSync(join(this.root, file), "utf8")};
    }
    return {...entry, include, source: readFileSync(join(this.root, entry.file), "utf8")};
  }

  // a write lands a file; a new object goes to the first writable root unless
  // a caller with a specific layer (the notebook scratch pack) names one
  write(type, name, source, include = "main", options = {}) {
    const meta = TYPES[type];
    if (meta === undefined) {
      throw new NotSupported(`object type ${type}`);
    }
    const requestedRoot = options.root === undefined ? undefined : this.roots.find((candidate) =>
      resolve(this.root, candidate.path) === resolve(this.root, String(options.root)));
    if (options.root !== undefined && (requestedRoot === undefined || requestedRoot.writable !== true)) {
      throw new Error(`write target root ${options.root} is not a writable object-store root`);
    }
    let entry = this.find(type, name);
    if (entry !== undefined && entry.writable === false) {
      throw new ReadOnly(type, name);
    }
    if (entry !== undefined && requestedRoot !== undefined &&
        resolve(this.root, entry.root) !== resolve(this.root, requestedRoot.path)) {
      throw new Error(`${type} ${name} already belongs to ${entry.root}, not ${requestedRoot.path}`);
    }
    if (entry === undefined) {
      const root = requestedRoot ?? this.roots.find((r) => r.writable);
      const file = join(root.path, "osd", fileOf(name) + meta.ext);
      const packages = this.#packagesOf(file, root);
      entry = {type, name: String(name).toUpperCase(), file, root: root.path, writable: true, library: false,
               imported: root.imported === true, package: packages[packages.length - 1], packages};
      this.#entries().set(`${entry.type} ${entry.name}`, entry);
    }
    let file = entry.file;
    if (type === "CLAS" && include !== "main") {
      const suffix = Object.hasOwn(INCLUDES, include) ? INCLUDES[include] : undefined;
      if (suffix === undefined) {
        throw new NotSupported(`class include ${include}`);
      }
      file = entry.file.replace(/\.clas\.abap$/, suffix);
    }
    mkdirSync(join(this.root, dirname(file)), {recursive: true});
    // One line ending, the repository's. An editor on Windows sends CRLF,
    // and a save that wrote it as it came turned a one-line comment into a
    // sixty-three-line diff with no comment in it. A system stores source
    // by line, not by terminator, and so does this tree.
    const text = String(source).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    // the active copy, then the intent, then the bytes (#loadInactive)
    this.#keepActive(entry);
    this.#crash("write:before-intent");
    this.#markInactive(entry, new Map([[file, Buffer.from(text, "utf8")]]));
    this.#crash("write:before-source");
    writeFileSync(join(this.root, file), text);
    this.#forget();
    return {...entry, ...this.stateOf(entry), include, file, bytes: Buffer.byteLength(source, "utf8")};
  }

  // A new object, in the folder of the package it is asked for. The two
  // files are the ones abapGit would write: the source and the header
  // beside it, so a repository made here is one abapGit can pull, and an
  // object made by abapGit is one this finds. The source is a skeleton the
  // client overwrites on its first save, which is what every ADT client
  // does after a create; a caller that has the source hands it in.
  //
  // The folder comes from the package and not the other way round: a
  // package here IS a folder (#packagesOf), so an object of $ZOSD_TEST_SRC
  // lands in src/zosd_test/src/, and a new package is a new folder under
  // its parent's, named after the last link of its name. A package whose
  // name does not continue its parent's cannot be a folder, and is refused
  // rather than misfiled.
  create(type, name, options = {}) {
    const meta = TYPES[type];
    if (meta === undefined || CREATABLE[type] === undefined) {
      throw new NotSupported(`creating an object of type ${type}`);
    }
    const upper = String(name).toUpperCase();
    if (this.find(type, upper) !== undefined) {
      throw new Conflict(type, upper);
    }
    const parent = String(options.package ?? "").toUpperCase();
    const home = this.find("DEVC", parent);
    if (parent === "" || home === undefined) {
      throw new NotFound("DEVC", parent === "" ? "(no package named)" : parent);
    }
    if (home.writable === false) {
      throw new ReadOnly("DEVC", parent);
    }
    const folder = dirname(home.file);
    const root = this.roots.find((r) => folder === r.path || folder.startsWith(r.path + "/"));
    const description = String(options.description ?? "");
    let file;
    if (type === "DEVC") {
      if (!upper.startsWith(parent + "_") || upper.length === parent.length + 1) {
        throw new NotSupported(`a package under ${parent} is named ${parent}_<FOLDER>; ${upper}`);
      }
      file = join(folder, upper.slice(parent.length + 1).toLowerCase(), "package.devc.xml");
    } else {
      file = join(folder, fileOf(upper) + meta.ext);
    }
    if (existsSync(join(this.root, file))) {
      throw new Conflict(type, upper);
    }
    mkdirSync(join(this.root, dirname(file)), {recursive: true});
    const made = CREATABLE[type](upper, description, options.source);
    const writes = Object.entries(made).map(([suffix, content]) =>
      [type === "DEVC" ? file : file.slice(0, -meta.ext.length) + suffix, content]);
    // filed the way build() files it, so the entry a create makes is the
    // entry the next rebuild makes: a package sits in the package above it,
    // and its own chain stops there
    const chain = this.#packagesOf(file, root);
    const packages = type === "DEVC" ? chain.slice(0, -1) : chain;
    const entry = {type, name: upper, file, root: root.path, writable: true, library: false,
                   imported: root.imported === true, description,
                   package: packages[packages.length - 1], packages};
    // the intent first: a crash before the files leaves a set naming files
    // that are all absent, which the next start drops (#loadInactive)
    if (type !== "DEVC") {
      this.#markInactive(entry, new Map(writes.map(([target, content]) => [target, Buffer.from(String(content), "utf8")])));
    }
    for (const [target, content] of writes) {
      writeFileSync(join(this.root, target), content);
    }
    this.#entries().set(`${type} ${upper}`, entry);
    this.#forget();
    return {...entry, ...this.stateOf(entry), created: true};
  }

  // The disk is the other editor. A file that appears, changes or goes
  // under a writable root (a git checkout, an abapGit pull, an editor that
  // is not ADT) is noticed here, and the next request rebuilds the index
  // and the registry rather than answering from what was true at start.
  // Coarse on purpose: any change forgets everything, because the walk is
  // milliseconds and the parse is what the next check pays anyway.
  // persistent:false so a store in a test does not keep the process alive.
  watch() {
    if (this.watchers !== undefined) {
      return this;
    }
    this.watchers = [];
    for (const root of this.roots.filter((r) => r.writable)) {
      try {
        const watcher = watch(join(this.root, root.path), {recursive: true, persistent: false}, (event, file) => {
          if (file === undefined || /\.(abap|xml|asddls|json)$/.test(file) === false) {
            return;
          }
          this.index = undefined;
          this.#forget();
          for (const listener of this.listeners ?? []) {
            listener({event, file: join(root.path, String(file)), root: root.path});
          }
        });
        watcher.on("error", () => {});
        this.watchers.push(watcher);
      } catch {
        // a file system without recursive watching answers as before: from
        // the index built at start
      }
    }
    return this;
  }

  // who wants to know when the disk changed: the dev loop, which turns a
  // save in any editor into a check, a build and a recycle. The watcher
  // itself only invalidates; what to do about a change is the caller's.
  onChange(listener) {
    this.listeners = [...(this.listeners ?? []), listener];
    return () => {
      this.listeners = (this.listeners ?? []).filter((l) => l !== listener);
    };
  }

  unwatch() {
    for (const w of this.watchers ?? []) {
      w.close();
    }
    this.watchers = undefined;
  }

  delete(type, name) {
    const entry = this.find(type, name);
    if (entry === undefined) {
      throw new NotFound(type, name);
    }
    if (entry.writable === false) {
      throw new ReadOnly(type, name);
    }
    const meta = TYPES[type];
    const files = [entry.file];
    if (type === "CLAS") {
      files.push(...Object.values(INCLUDES).map((suffix) => entry.file.replace(/\.clas\.abap$/, suffix)));
    }
    if (type === "DEVC") {
      // a package goes only once it is empty: its objects are not deleted
      // by implication, the way a real system refuses to delete a package
      // that still has content
      const inside = [...this.#entries().values()].filter((e) => e.type !== "DEVC" ? e.package === entry.name : e.package === entry.name && e.name !== entry.name);
      if (inside.length > 0) {
        throw new NotSupported(`deleting ${entry.name} while it still holds ${inside.length} object(s)`);
      }
    } else if (meta.ext.endsWith(".abap") || meta.ext.endsWith(".asddls")) {
      // the abapGit header beside the source
      files.push(entry.file.slice(0, -meta.ext.length) + meta.ext.replace(/\.(abap|asddls)$/, ".xml"));
    }
    for (const file of files) {
      if (existsSync(join(this.root, file))) {
        unlinkSync(join(this.root, file));
      }
    }
    // the files, then the set, then the copies (#loadInactive)
    this.#entries().delete(`${entry.type} ${entry.name}`);
    if (this.inactive.delete(`${entry.type} ${entry.name}`)) this.#saveInactive();
    this.#dropActiveCopy(entry);
    this.#forget();
    return {type: entry.type, name: entry.name, deleted: true};
  }

  // name or source matches, the way ADT's search and a grep over the tree do
  search(query, options = {}) {
    const needle = String(query).toUpperCase();
    const out = [];
    for (const entry of this.#entries().values()) {
      if (options.type !== undefined && entry.type !== options.type) {
        continue;
      }
      let hit = entry.name.includes(needle);
      if (hit === false && options.source === true && TYPES[entry.type].source === true) {
        hit = readFileSync(join(this.root, entry.file), "utf8").toUpperCase().includes(needle);
      }
      if (hit === true) {
        out.push({type: entry.type, name: entry.name, library: entry.library});
        if (out.length >= (options.max ?? 100)) {
          break;
        }
      }
    }
    return out;
  }

  // --------------------------------------------------- check and activate

  // ------------------------------------------------------------ packages

  // every package of the system, parent first, with what is in it
  packages() {
    const packages = new Map();
    const ensure = (name, parent) => {
      if (packages.has(name) === false) {
        packages.set(name, {name, parent, description: this.#packageText(name), objects: 0, subpackages: [], library: true});
      }
      return packages.get(name);
    };
    for (const entry of this.#entries().values()) {
      // every link of the chain exists, even a folder that holds only folders
      entry.packages.forEach((name, at) => {
        const node = ensure(name, at === 0 ? undefined : entry.packages[at - 1]);
        if (entry.library === false) {
          node.library = false;
        }
        if (at > 0) {
          const parent = packages.get(entry.packages[at - 1]);
          if (parent.subpackages.includes(name) === false) {
            parent.subpackages.push(name);
          }
        }
      });
      // A package object is the package, even when nothing sits in it yet.
      // Its own chain stops at its parent (build() files a package under
      // the package above it), so a package folder that holds only its
      // package.devc.xml -- what a create makes -- was named by no chain at
      // all and vanished from the tree, the search and nodestructure on the
      // first rebuild after the create, while find() still knew it.
      if (entry.type === "DEVC" && entry.name !== entry.package) {
        const node = ensure(entry.name, entry.package);
        if (entry.library === false) {
          node.library = false;
        }
        const parent = packages.get(entry.package);
        if (parent !== undefined && parent.subpackages.includes(entry.name) === false) {
          parent.subpackages.push(entry.name);
        }
      }
      // a root package's own object is the package, not something in it
      if (entry.type === "DEVC" && entry.name === entry.package) {
        continue;
      }
      const own = packages.get(entry.package);
      own.objects = own.objects + 1;
    }
    // everything that had no package above it now has the super-package
    const tops = [...packages.values()]
      .filter((node) => node.parent === undefined && node.name !== this.superPackage).map((node) => node.name);
    // and not on an empty system: a super-package over nothing is a package
    // that holds nothing, which is not what "no packages" means
    if (this.superPackage !== null && this.superPackage !== undefined && tops.length > 0) {
      const top = ensure(this.superPackage, undefined);
      top.library = false;
      top.description = "Packages served by this system";
      for (const name of tops) {
        packages.get(name).parent = this.superPackage;
        top.subpackages.push(name);
      }
    }
    for (const node of packages.values()) {
      node.subpackages.sort();
    }
    return [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // the top of the tree: what a client sees when it has not named a package
  // yet. A system answers this for the node its clients call the system
  // library, and without it a tree has no root to open, which is what
  // "Unable to resolve nonexistent file" means on the other end.
  //
  // Not called roots(): this.roots is the folders the store reads from, and
  // a method of that name is silently shadowed by the field, which is how
  // the registry cache broke once already.
  rootPackages() {
    return this.packages().filter((node) => node.parent === undefined);
  }

  // one package: what is under it and what is in it. An empty name is the
  // root, because that is what a client asks for first.
  package(name) {
    const wanted = String(name ?? "").toUpperCase();
    if (wanted === "") {
      return {
        name: "",
        parent: undefined,
        description: "the packages of this system",
        library: false,
        subpackages: this.rootPackages().map((node) => node.name),
        objects: [],
      };
    }
    const all = this.packages();
    const node = all.find((p) => p.name === wanted);
    if (node === undefined) {
      throw new NotFound("DEVC", wanted);
    }
    const objects = [];
    for (const entry of this.#entries().values()) {
      if (entry.package === wanted && !(entry.type === "DEVC" && entry.name === wanted)) {
        objects.push({type: entry.type, name: entry.name, library: entry.library, writable: entry.writable,
          version: this.stateOf(entry).version});
      }
    }
    return {
      ...node,
      objects: objects.sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name)),
    };
  }

  // the text of a package: a real one carries it in package.devc.xml, and
  // until content arrives the folder speaks for itself
  #packageText(name) {
    const file = this.#devcOf(name);
    if (file !== undefined) {
      const text = /<CTEXT>([^<]*)<\/CTEXT>/.exec(readFileSync(join(this.root, file), "utf8"));
      if (text !== null) {
        return text[1];
      }
    }
    return undefined;
  }

  // a package object is named after the package it describes
  #devcOf(name) {
    const entry = this.#entries().get(`DEVC ${name}`);
    return entry === undefined ? undefined : entry.file;
  }

  // the rows of the system, for a client that asks for table contents: one
  // place knows about the schema, the seed and the dialect (tools/osd-data.mjs)
  data() {
    if (this.rows === undefined) {
      this.rows = new Data({root: this.root});
    }
    return this.rows;
  }

  // the serving runtime, the process that answers OData (tools/osd-runtime.mjs
  // and tools/osd-serve.mjs). This only hands the supervisor over; whoever
  // owns the listener decides when to start it, because starting a process
  // is not something a store should do behind a caller's back.
  serving(options = {}) {
    if (this.served === undefined) {
      // more than one work process when asked for one (OSD_WORKERS,
      // tools/osd-pool.mjs): the pool behaves as a runtime for everything
      // that used one, and offers next() to whoever pins a session
      const size = Math.max(1, Number(options.workers ?? process.env.OSD_WORKERS ?? 1));
      this.served = size > 1
        ? new RuntimePool({root: this.root, size, ...options})
        : new ServingRuntime({root: this.root, ...options});
    }
    return this.served;
  }

  // activation, finished rather than promised: the modules are written and
  // then the process that serves them is replaced, because Node pins a
  // module graph and the old process would go on answering with the old
  // code. A caller that awaits this can tell a client the truth, which is
  // what a real system's activation does.
  //
  // Recycling is skipped when nothing is serving, so a command line or a
  // test suite pays only for the transpile.
  //
  // One activation at a time per store. A save has two activators -- the
  // dev loop (tools/osd-dev.mjs) and the ADT façade's own activation
  // (tools/adt-facade.mjs) -- and side by side they shared one build and
  // both swapped from its base, or the second swapped from a base the
  // first had already replaced: refused, and the process recycled
  // (vsp-i7, 2026-10-02). In line, the second builds on what the first
  // made live: the same source is a no-op on that generation, a later edit
  // a build and a swap of its own. Every caller needs this, so it is here.
  //
  // In line is not in turn, though: a caller whose tree is the one already
  // queued or in flight takes THAT publish's answer, its load included,
  // instead of building the same thing again behind it. A queued publish has
  // not read the tree yet, so it reads this caller's too; one in flight is
  // joined when its build named the generation by the same hash the tree
  // has now (sourceKey()). Two activators of one save are then one build and
  // one swap, and both answers wait for the swap and carry its ms.
  //
  // Each publication carries its own activation (`activate`, the objects it
  // builds with their saved version), and is joined only by a caller with
  // the same set over the same tree: two activations of different objects
  // are two builds, so one's broken save never enters the other's.
  async publish(options = {}) {
    const activating = new Set([...(options.activate ?? [])].map((o) => `${o.type} ${String(o.name).toUpperCase()}`));
    const set = [...activating].sort().join("\n");
    const forced = options.force === true || options.replace === true;
    if (!forced) {
      if (this.#queued !== undefined && this.#queued.set === set) return this.#queued.promise;
      const running = this.#running;
      if (running !== undefined && running.forced !== true && running.set === set) {
        // the name first: what the tree is now, before waiting on anything
        const key = await this.sourceKey(activating);
        const built = await running.built.catch(() => undefined);
        if (key !== undefined && built?.ok !== false && built?.hash === key) return running.promise;
        if (this.#queued !== undefined && this.#queued.set === set) return this.#queued.promise;
      }
    }
    const entry = {forced, set};
    entry.built = new Promise((resolve, reject) => {
      entry.resolveBuilt = resolve;
      entry.rejectBuilt = reject;
    });
    entry.built.catch(() => undefined);
    entry.promise = this.#publishing.then(() => {
      if (this.#queued === entry) this.#queued = undefined;
      this.#running = entry;
      return this.#publish({...options, activating}, entry);
    }).finally(() => {
      if (this.#running === entry) this.#running = undefined;
      entry.rejectBuilt(new Error("the publish ended before its build"));
    });
    if (!forced) this.#queued = entry;
    this.#publishing = entry.promise.catch(() => undefined);
    return entry.promise;
  }

  #publishing = Promise.resolve();
  // the publish waiting for its turn (not forced), and the one in its turn
  #queued = undefined;
  #running = undefined;

  // the name a build of the tree as it is now would give its generation:
  // the hash of the inputs (tools/osd-build.mjs hashOf), the same one a warm
  // build names its generation by. undefined when the tree cannot be named,
  // and then nothing is joined.
  async sourceKey(activating = new Set()) {
    try {
      return hashOf(this.root, inputsOf(this.root), {overlay: this.overlay(activating)});
    } catch {
      return undefined;
    }
  }

  async #publish(options, entry = {}) {
    let transpile;
    try {
      transpile = await this.transpile(options);
    } finally {
      entry.resolveBuilt?.(transpile);
    }
    if (transpile?.ok === false) {
      return {ok: false, transpile};
    }
    let runtime = this.served;
    // a runtime changing hands (a catch-up recycle, a start; for a pool, any
    // of its work processes) is waited for before its generation is read or
    // loaded into: answering now would say "active" while no process serves
    // the code, and the one coming up may have read the live generation
    // before this build switched it
    // -- but not for ever: a recycle that never settles is answered as one
    const deadline = Date.now() + this.transitionMs;
    for (let changing = runtime?.recycling ?? runtime?.starting; changing !== undefined;
      changing = runtime?.recycling ?? runtime?.starting) {
      const waited = await this.#bounded(changing.catch(() => undefined), "a runtime changing hands", deadline);
      if (waited.late) return {ok: false, transpile, recycled: false, error: waited.error};
      runtime = this.served;
    }
    if (runtime === undefined || runtime.running !== true) {
      return {ok: true, transpile, recycled: false};
    }
    // nothing to load: the process already serves the generation this build
    // named (a no-op warm build, a cached cold one), so no swap and no
    // recycle -- a recycle of unchanged code ends every session for nothing.
    // Said how THIS process got it: by a swap (its ms), or by a load at its
    // start, which must not read as a swap (a recycle after a refused swap,
    // a catch-up recycle, a process that came up on the live generation
    // after this build switched it). A load is the process's only while its
    // epoch is the one serving. A forced build replaces the generation's
    // files under the same name, and is always loaded.
    // For a pool, every work process: one a partial recycle left on the old
    // generation is loaded (swapped or recycled), not reported as served.
    const members = Array.isArray(runtime.runtimes) ? runtime.runtimes : [runtime];
    if (options.force !== true && options.replace !== true && (transpile.warm === true || transpile.cached === true) &&
        members.every((m) => m.running === true && m.generation === transpile.hash)) {
      const last = this.lastLoad?.generation === transpile.hash && this.lastLoad.epoch === runtime.epoch
        ? this.lastLoad : undefined;
      const how = last?.why !== undefined ? {why: `the runtime was recycled onto it: ${last.why}`}
        : last?.hot === true ? {swapMs: last.ms}
          : {why: "the serving process was started on it"};
      return {ok: true, transpile, recycled: false, hot: false, generation: transpile.hash, ...how};
    }
    // a warm build is loaded into the process that serves, not a new one
    // (tools/osd-hot.mjs); when that cannot be done, the recycle below does
    let why;
    if (transpile.warm === true && (transpile.hostHeld ?? []).length === 0) {
      try {
        const swap = await runtime.hot({generation: transpile.hash, from: transpile.from,
          modules: transpile.modules, verified: transpile.unverified !== true});
        this.lastLoad = {generation: transpile.hash, epoch: runtime.epoch, hot: true, ms: swap.ms};
        // the swap limit or the heap: the catch-up recycle is part of this
        // activation, and its answer is the load that recycle made
        const after = this.#afterSwap(transpile.hash, swap);
        const waited = after === undefined ? undefined : await this.#bounded(after, "the catch-up recycle");
        const caught = waited === undefined ? undefined : waited.late ? {ok: false, error: waited.error} : waited.value;
        if (caught !== undefined) {
          if (caught.ok !== true) return {ok: false, transpile, recycled: false, error: caught.error};
          return {ok: true, transpile, recycled: true, generation: caught.generation, ms: caught.ms,
            why: `the swap (${swap.ms} ms) was followed by a catch-up recycle after ${caught.why}`};
        }
        return {ok: true, transpile, recycled: false, hot: true, generation: transpile.hash, ms: swap.ms, swaps: swap.swaps};
      } catch (error) {
        console.log(`warm: the swap was refused, recycling instead: ${error.message}`);
        why = `the swap was refused: ${error.message}`;
      }
    }
    if (transpile.warm === true && (transpile.hostHeld ?? []).length > 0) {
      console.log(`warm: ${transpile.hostHeld.join(", ")} is held by the serving process itself, recycling instead of swapping`);
      why = `${transpile.hostHeld.join(", ")} is held by the serving process itself`;
    }
    try {
      const bounded = await this.#bounded(runtime.recycle(), "the recycle");
      if (bounded.late) return {ok: false, transpile, recycled: false, error: bounded.error};
      const recycle = bounded.value;
      this.#cleanHot();
      if (this.warmState !== undefined) this.warmState.heapBase = undefined;
      // a warm build loaded by a recycle says why, so no answer reports it as a swap
      this.lastLoad = {generation: recycle.generation, epoch: runtime.epoch, why};
      return {ok: true, transpile, recycled: true, generation: recycle.generation, ms: recycle.ms, ...(why === undefined ? {} : {why})};
    } catch (error) {
      // the modules are good and the process that should carry them is not:
      // that is a failure of the activation, not a detail to log quietly
      return {ok: false, transpile, recycled: false, error: error.message};
    }
  }

  // A runtime changing hands -- a recycle already underway, the one this
  // publish asks for, the catch-up a swap brings -- is waited for for as
  // long as it is starting and says so, and is late once it has said
  // nothing for transitionMs (OSD_TRANSITION_MS): silence, not slowness,
  // the rule the runtime's own boot already keeps (tools/osd-runtime.mjs,
  // `timeout` of silence, `bootTimeout` in all, after which it gives the
  // boot up itself and the recycle rejects). A fixed limit turned a boot
  // that was slow and correct into a failed activation: vsp-i7 on 0.6.1511
  // measured a boot of more than 60 s under load (the generation 6.6 s, the
  // cross-reference 21.6 s, the registrations after them) and every 60-s
  // wait for it answered "still changing hands". A transition with no boot
  // to hear from (a stop, a supervisor that never settles) is late after
  // transitionMs as before, so the chain still moves on. {late: false,
  // value} or {late: true, error}; a rejection is the caller's.
  async #bounded(promise, what, deadline = Date.now() + this.transitionMs) {
    const late = Symbol("late");
    const started = Date.now();
    for (;;) {
      let timer;
      const value = await Promise.race([
        promise,
        new Promise((done) => {
          timer = setTimeout(() => done(late), Math.max(0, deadline - Date.now()));
          timer.unref?.();
        }),
      ]).finally(() => clearTimeout(timer));
      if (value !== late) return {late: false, value};
      // what the boot said while this process was busy itself (a prime
      // holds it for seconds) is still queued: let it land before reading
      await new Promise((r) => setImmediate(r));
      const heard = this.#heard();
      if (heard !== undefined && heard + this.transitionMs > Date.now()) {
        deadline = heard + this.transitionMs;
        continue;
      }
      break;
    }
    // whatever it settles to later is nobody's answer, and not unhandled
    Promise.resolve(promise).catch(() => undefined);
    return {late: true, error: `the runtime is still changing hands after ${Date.now() - started} ms, ` +
      `${this.transitionMs} ms of it without a word (${what}); nothing was loaded`};
  }

  // when a runtime (or any work process of a pool) that is booting last said
  // anything; undefined when none is booting
  #heard() {
    const runtime = this.served;
    const members = Array.isArray(runtime?.runtimes) ? runtime.runtimes : runtime === undefined ? [] : [runtime];
    let at;
    for (const m of members) {
      const h = m?.booting?.heard;
      if (typeof h === "number" && (at === undefined || h > at)) at = h;
    }
    return at;
  }

  // ---- the warm compile (tools/osd-warm.mjs, docs/warm-compile.md) --------
  //
  // On with OSD_WARM=1. The registry is primed in the background after a
  // cold build, and a save it may build (a content edit of a class or an
  // interface) becomes a build of the objects it reaches and a swap in the
  // serving process. Anything else is the cold build, and after it the
  // registry is primed again.

  warm() {
    if (this.warmState === undefined) {
      const on = (process.env.OSD_WARM ?? "") === "1";
      this.warmState = {on, compiler: undefined, priming: undefined, reason: on ? "not primed yet" : "OSD_WARM is not 1",
        verifying: undefined, next: undefined, last: undefined, timer: undefined};
    }
    return this.warmState;
  }

  // What a client shows about the warm build (the VS Code extension's
  // "warming up"): off, priming, primed, or cold with the reason it is
  // cold, and what the process serving has taken.
  warmStatus() {
    const w = this.warm();
    const c = w.compiler;
    const state = w.on !== true ? "off" : w.priming !== undefined ? "priming" : c?.primed === true ? "primed" : "cold";
    return {
      state,
      reason: state === "primed" || state === "priming" ? undefined : w.reason,
      generation: c?.primed === true ? c.hash : undefined,
      unverified: c === undefined ? [] : [...c.unverified],
      swaps: this.served?.swaps ?? 0,
      copies: c?.copies ?? 0,
      lastVerify: w.last,
    };
  }

  // Every CLAS/INTF whose file on disk no longer hashes to what the warm
  // registry was primed or last built from -- what "Rebuild (warm)"
  // (editors/vscode) activates in one call, so a person never has to name
  // the object themselves. Reuses the warm compiler's own digests
  // (tools/osd-warm.mjs WarmCompiler#prime / #build), which are exactly the
  // per-file hashes the live generation was built from: no second bookkeeping.
  // undefined when the registry is not primed, which is the caller's cue to
  // fall back to a cold rebuild rather than guess at a list this has no way
  // to check.
  changedObjects() {
    const w = this.warm();
    const c = w.compiler;
    if (c?.primed !== true) return undefined;
    const out = [];
    for (const entry of this.#entries().values()) {
      if (entry.type !== "CLAS" && entry.type !== "INTF") continue;
      const file = resolve(this.root, entry.file);
      let hash;
      try {
        hash = createHash("sha256").update(readFileSync(file)).digest("hex");
      } catch {
        continue;
      }
      if (c.digests.get(file) !== hash) {
        // `base`: the lowercase file stem uriOf() (editors/vscode/lib.js)
        // needs to build the object's own ADT uri -- the same shape
        // adtObjectOf() derives from a file name, namespace `#ns#` form
        // included, so activateMany() can be handed this list as is.
        const base = basename(entry.file).replace(/\.(clas|intf)\.abap$/i, "");
        out.push({type: entry.type, name: entry.name, base});
      }
    }
    return out;
  }

  // prime in the background; a failure leaves every build cold and says why
  warmUp() {
    const w = this.warm();
    if (w.on !== true) return undefined;
    if (w.priming !== undefined) return w.priming;
    // the warm registry primes on the tree as saved; while some of it is
    // inactive and kept out of the build, it would prime on what is not live.
    // The next cold build schedules another try.
    if (this.overlay() !== undefined) {
      w.reason = `${this.inactive.size} inactive object(s) are kept out of the build`;
      return undefined;
    }
    // not while the runtime changes hands: the prime holds this process for
    // seconds (11 s on vsp-i7, 17-30 s here under load), and a boot the
    // supervisor cannot hear meanwhile is a recycle that reads as that much
    // slower -- the reprime five seconds after a cold build landed in the
    // middle of that build's recycle every time. Not as `priming` either: a
    // build awaits that, and must not wait on a transition through it.
    const changing = this.served?.recycling ?? this.served?.starting;
    if (changing !== undefined) {
      return changing.catch(() => undefined).then(() => this.warmUp());
    }
    w.priming = (async () => {
      const {WarmCompiler} = await import("./osd-warm.mjs");
      w.compiler ??= new WarmCompiler({root: this.root, log: (m) => console.log(m)});
      try {
        const r = await w.compiler.prime();
        w.reason = undefined;
        return r;
      } catch (error) {
        w.reason = error.message;
        console.log(`warm: builds stay cold: ${error.message}`);
        return undefined;
      } finally {
        w.priming = undefined;
      }
    })();
    return w.priming;
  }

  // after a swap: compare the generation with a cold transpile of the same
  // inputs, and once the process has been swapped into for long enough,
  // replace it with one started on the live generation
  #afterSwap(hash, swap = {}) {
    const w = this.warm();
    w.heapBase ??= swap.heap;
    const grown = (swap.heap ?? 0) - (w.heapBase ?? 0);
    if (w.compiler?.unverified.has(hash)) {
      w.next = hash;
      this.#verifyNext();
    }
    const runtime = this.served;
    clearTimeout(w.timer);
    // the limits are reached by a swap, so the recycle is the swap's
    // publish's to await (undefined when nothing is recycled)
    if ((runtime?.swaps ?? 0) >= this.warmSwapLimit) {
      return this.#catchUp(`${runtime.swaps} swaps`);
    } else if (grown > WARM_HEAP_MB * 1024 * 1024) {
      return this.#catchUp(`a heap ${Math.round(grown / 1048576)} MB larger than at the first swap`);
    } else {
      w.timer = setTimeout(() => {
        // the live generation is compared once the saves have stopped, if
        // the comparison of it was cut short by the next save
        const live = this.served?.generation;
        if (live !== undefined && w.compiler?.unverified.has(live)) {
          w.next = live;
          this.#verifyNext();
        }
        this.#catchUp("quiet");
      }, WARM_QUIET_MS);
      w.timer.unref?.();
    }
    return undefined;
  }

  // the swap count that brings a catch-up recycle (OSD_WARM_SWAPS); a test lowers it
  warmSwapLimit = WARM_SWAPS;
  // how long a publish waits for a runtime changing hands (OSD_TRANSITION_MS)
  transitionMs = TRANSITION_MS;

  #verifyNext() {
    const w = this.warm();
    if (w.verifying !== undefined || w.next === undefined) return;
    const hash = w.next;
    w.next = undefined;
    w.verifying = w.compiler.verify(hash).then(async (result) => {
      w.last = {hash, ...result, at: new Date().toISOString()};
      if (result.verdict === "same") {
        console.log(`warm: ${hash} verified against a cold transpile (${result.files} files, ${result.ms} ms)`);
        this.served?.verified?.(hash);
      } else if (result.verdict === "differs") {
        // the warm build and the cold one disagree: the cold one is the
        // truth, so it replaces the generation and the process, and the
        // registry is primed again from it
        console.log(`warm: ${hash} DIFFERS from a cold transpile in ${result.count} files (${result.differing.slice(0, 5).join(", ")}); rebuilding cold`);
        // the note beside it keeps the generation from ever being a cache
        // hit, whatever the tree is by the time the cold build runs
        try {
          const side = join(this.root, "build", "by-input", `${hash}.warm.json`);
          writeFileSync(side, JSON.stringify({...JSON.parse(readFileSync(side, "utf8")), verified: false, differs: result.differing}, null, 2));
        } catch {
          // no note: nothing a cold build would take as its own
        }
        w.compiler.drop();
        await this.publish({force: true, replace: true});
      } else {
        console.log(`warm: ${hash} not verified: ${result.verdict} ${result.why ?? result.output ?? ""}`);
      }
    }).finally(() => {
      w.verifying = undefined;
      this.#verifyNext();
    });
  }

  async #catchUp(why) {
    const runtime = this.served;
    if (runtime === undefined || runtime.running !== true || (runtime.swaps ?? 0) === 0) return undefined;
    try {
      const r = await runtime.recycle();
      this.#cleanHot();
      this.warm().heapBase = undefined;
      // the process now serving loaded its generation at its start
      this.lastLoad = {generation: r.generation, epoch: runtime.epoch, why: `a catch-up recycle after ${why}`};
      console.log(`warm: recycled after ${why} (${r.ms} ms)`);
      return {ok: true, generation: r.generation, ms: r.ms, why};
    } catch (error) {
      console.log(`warm: the catch-up recycle failed: ${error.message}`);
      return {ok: false, error: `the catch-up recycle after ${why} failed: ${error.message}`};
    }
  }

  // the swapped copies, once no process carries them
  #cleanHot() {
    rmSync(join(this.root, "build", "hot"), {recursive: true, force: true});
  }

  // the test run of an object (tools/osd-unit.mjs). It needs the parse and
  // the runtime, both of which live here, so the façade asks the store for
  // it rather than assembling one. Imported when first asked for, because
  // the runner imports the store back.
  async unit() {
    if (this.tests === undefined) {
      const {UnitRun} = await import("./osd-unit.mjs");
      this.tests = new UnitRun(this);
    }
    return this.tests;
  }

  // ADT's F9, "Run as ABAP Application (Console)" (tools/osd-classrun.mjs):
  // a class implementing IF_OO_ADT_CLASSRUN, run against the runtime this
  // store already has -- no detached child, because a classrun IS a run of
  // the application and shares the connection every other request does.
  async classrun() {
    if (this.classruns === undefined) {
      const {ClassRun} = await import("./osd-classrun.mjs");
      this.classruns = new ClassRun(this);
    }
    return this.classruns;
  }

  // a write means the parse is stale, here and for anyone sharing this tree
  #forget() {
    this.ddlsEntityIndex = undefined;
    this.parsed = undefined;
    PARSED.delete(this.root);
  }

  // Why a write throws the whole parse away, when abaplint can be told what
  // changed instead.
  //
  // The fast path works and is wrong. Telling the registry about the file
  // and parsing again takes twenty milliseconds where a full parse takes
  // four seconds, and the object that changed is checked correctly
  // afterwards. Its callers are not: abaplint reparses the object whose
  // file moved and leaves the results it already has for everything else,
  // so a class that renames a method its callers use comes back clean from
  // a caller's check that a full parse fails. Measured on exactly the case
  // activation exists to catch, the one that used to answer with an empty
  // success.
  //
  // So a write costs four seconds of reparse at the next check, and an
  // activation pays it once. That is the honest price of knowing what the
  // system contains, and the transpile after it costs more anyway.
  // the parsed system, for whoever needs more than an object: the
  // cross-reference derives from the same parse the check runs on
  registry(configPath = "abaplint.jsonc") {
    return this.#build_registry(configPath);
  }

  // the whole registry, so a check sees the system and not one file
  #build_registry(configPath = "abaplint.jsonc") {
    if (this.parsed !== undefined) {
      return this.parsed;
    }
    const shared = PARSED.get(this.root);
    if (shared !== undefined) {
      this.parsed = shared;
      return shared;
    }
    const text = readFileSync(join(this.root, configPath), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    const config = JSON.parse(text);
    const registry = new abaplint.Registry(new abaplint.Config(JSON.stringify({
      global: {files: "/**/*.*"},
      syntax: config.syntax,
      rules: {parser_error: true, check_syntax: true, unknown_types: true, implement_methods: true},
    })));
    // everything, not only what the index calls an object: a class needs its
    // local includes, and a type pool is not an ADT object but the check
    // still needs it
    for (const root of [...this.roots, ...this.libs]) {
      for (const file of root.files ?? this.#walk(root.path, [])) {
        if (/\.(abap|xml|asddls)$/.test(file) === false) {
          continue;
        }
        registry.addFile(new abaplint.MemoryFile("/" + file, readFileSync(join(this.root, file), "utf8")));
      }
    }
    registry.parse();
    this.parsed = registry;
    PARSED.set(this.root, registry);
    return registry;
  }

  // the syntax check a write runs; issues of this object only.
  //
  // With {source} the given text stands in for the file for this one check
  // and nothing on disk changes: what an editor asks before it saves, and
  // what a client asks about an object it has not created yet. The answer
  // has the same shape either way, because the caller is the same code.
  check(type, name, options = {}) {
    const entry = this.find(type, name);
    if (entry === undefined && options.source === undefined) {
      throw new NotFound(type, name);
    }
    if (options.source === undefined) {
      return this.#issues(this.registry(), type, entry.name);
    }
    const target = this.#fileFor(type, name, entry, options.include ?? "main");
    return this.#withSource(target.file, options.source, (registry) => this.#issues(registry, type, target.name));
  }


  // the issues of one object, in the shape the façade returns
  #issues(registry, type, name) {
    // an include is a program to abaplint: the registry files it as PROG,
    // and asking for INCL finds nothing and calls a clean include broken
    const object = registry.getObject(TYPES[type]?.sameFileAs ?? type, name);
    if (object === undefined) {
      return {type, name, issues: [{severity: "E", message: `${type} ${name} is not in the registry`, line: 1, column: 1}]};
    }
    // **A CDS view was checked by nobody.** `findIssuesObject` answers `[]`
    // for a DDLS whatever it contains: measured on `ZC_OSD_PACK` mangled to
    // `definnnne vieeew` and on one selecting from a table that does not
    // exist -- both "no issues", and `npm run lint` agreed, 0 of 416. The
    // build then failed naming a CONSUMER (`zcl_zosd_status_dpc:43`, "ZC_OSD_PACK
    // not found") and never the file somebody had just edited. For a screen
    // with a Check button that is the worst of the three: it says fine, and
    // Activate fails somewhere else (2026-09-19).
    //
    // The generator already reads these, and its refusals are named. So the
    // check asks it: "the check passed" now means "the thing that has to
    // read this can", which is what activation will need anyway.
    const extra = type === "DDLS" ? ddlsIssues(registry, object) : [];
    const issues = [...extra, ...registry.findIssuesObject(object).map((issue) => ({
      severity: "E",
      rule: issue.getKey(),
      message: issue.getMessage(),
      file: issue.getFilename(),
      line: issue.getStart().getRow(),
      column: issue.getStart().getCol(),
    }))];
    return {type, name, issues};
  }

  // which file a source belongs in: the object's own, the class include the
  // caller named, or the one a write would create for an object that is not
  // there yet
  #fileFor(type, name, entry, include) {
    const meta = TYPES[type];
    if (meta === undefined) {
      throw new NotSupported(`object type ${type}`);
    }
    let file = entry?.file;
    if (file === undefined) {
      const root = this.roots.find((r) => r.writable);
      file = join(root.path, "osd", fileOf(name) + meta.ext);
    }
    if (type === "CLAS" && include !== "main") {
      const suffix = Object.hasOwn(INCLUDES, include) ? INCLUDES[include] : undefined;
      if (suffix === undefined) {
        throw new NotSupported(`class include ${include}`);
      }
      file = file.replace(/\.clas\.abap$/, suffix);
    }
    return {name: entry?.name ?? String(name).toUpperCase(), file};
  }

  // the given text stands in for one file, for the length of one call. The
  // shared parse is borrowed rather than rebuilt, because rebuilding it is
  // seconds and a human is waiting; the file goes back in a finally, and
  // nothing between the two lines is asynchronous, so no other caller can
  // see the substitution. abaplint reparses only what the swap dirtied.
  #withSource(file, source, fn) {
    const registry = this.registry();
    const filename = "/" + file;
    const before = registry.getFileByName(filename);
    const replacement = new abaplint.MemoryFile(filename, source);
    try {
      if (before === undefined) {
        registry.addFile(replacement);
      } else {
        registry.updateFile(replacement);
      }
      registry.parse();
      return fn(registry);
    } finally {
      if (before === undefined) {
        registry.removeFile(replacement);
      } else {
        registry.updateFile(before);
      }
      registry.parse();
    }
  }

  // the objects whose source names this one, which is who an activation can
  // break. An over-approximation on purpose: a mention in a comment or a
  // string counts, so the list is longer than the truth and never shorter,
  // and a healthy object costs one check to clear. The cheap direction to be
  // wrong in — the expensive one is telling a client a rename was fine.
  dependents(type, name) {
    const needle = String(name).toUpperCase();
    const word = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const out = [];
    for (const object of this.registry().getObjects()) {
      if (object.getType() === type && object.getName().toUpperCase() === needle) {
        continue;
      }
      for (const file of object.getFiles()) {
        if (word.test(file.getRaw())) {
          out.push({type: object.getType(), name: object.getName()});
          break;
        }
      }
    }
    return out;
  }

  // activation is that check over the object AND everything that uses it: a
  // local system has no queue, so it either holds or it does not. Checking
  // the object alone is the false green this whole thing exists to catch —
  // rename a method its callers use and the object is still self-consistent,
  // while the system it lives in no longer compiles. A real system refuses
  // that activation, so this one does too, and it says which caller broke.
  //
  // This is only the check verdict. The inactive mark is cleared separately,
  // after publication succeeds; a failed build is not an activation.
  //
  // The check sees the system the build will make (#withOverlay): the
  // objects activated together (`options.activating`, "TYPE NAME"s; this one
  // when none are named) as saved, every other inactive object as its active
  // copy or absent. A saved, unactivated, broken dependent no longer holds
  // back an edit its active version accepts.
  activate(type, name, options = {}) {
    const self = `${type} ${String(name).toUpperCase()}`;
    const activating = new Set([self, ...[...(options.activating ?? [])].map((o) =>
      typeof o === "string" ? o : `${o.type} ${String(o.name).toUpperCase()}`)]);
    return this.#withOverlay(activating, () => this.#activateChecked(type, name));
  }

  #activateChecked(type, name) {
    const result = this.check(type, name);
    if (result.issues.length > 0) {
      return {...result, active: false, dependents: []};
    }
    // the order matters: a candidate is only a dependent if its own check
    // fails. That is what makes the over-approximation above safe — a name
    // mentioned in a comment produces a candidate, the candidate checks
    // clean, and nothing is refused over it. A wasted check, not a wrong
    // verdict.
    const broken = [];
    for (const dependent of this.dependents(type, name)) {
      // straight off the registry, not through find(): a dependent may be of
      // a type the store does not index (an IWPR naming the class it maps),
      // and it is in the registry by construction, so it is checked there
      const checked = this.#issues(this.registry(), dependent.type, dependent.name);
      if (checked.issues.length > 0) {
        broken.push(checked);
      }
    }
    return {...result, active: broken.length === 0, dependents: broken,
      revision: broken.length === 0 ? this.#sourceRevision(type, name) : undefined};
  }

  // what a warm build's check stands for (tools/osd-warm.mjs): the
  // transpiler checks the objects a change reaches while it builds them, and
  // refuses to build when one is broken, so the activation is the revision
  // taken before that build -- completed only if it is still the one on disk
  warmActivation(type, name) {
    return {type, name, active: true, issues: [], dependents: [], warm: true, revision: this.#sourceRevision(type, name)};
  }

  // Complete only the exact revision that passed the check. An editor may
  // save again while publish() awaits its build or runtime recycle.
  completeActivation(result, built = undefined) {
    return this.completeActivations([result], built);
  }

  // `built` is what the build read of each object ("TYPE NAME" -> revision,
  // the publication's transpile.built): an object is promoted only when the
  // checked revision is the one that was built AND the one on disk now. A
  // save between the check and the build's read, restored before the
  // completion, otherwise promoted the checked bytes over a live build of
  // others and dropped the active copy. Without `built` (no build ran: a
  // façade whose activation does not transpile) the disk is compared alone.
  completeActivations(results, built = undefined) {
    // An ADT request may activate several objects. Do not mark the first
    // active if a later one was saved again during the same build.
    const key = (result) => `${result.type} ${String(result.name).toUpperCase()}`;
    if (results.some((result) => result.active !== true || result.revision === undefined ||
        (built !== undefined && built[key(result)] !== result.revision) ||
        result.revision !== this.#sourceRevision(result.type, result.name))) return false;
    for (const result of results) {
      this.#markActive(result.type, result.name);
    }
    return true;
  }

  // the transpile behind an activation: the modules the runtime loads.
  // Built to the side and made live by a rename (tools/osd-build.mjs), so a
  // build that fails leaves the live generation exactly as it was — which
  // is the whole reason publish() can promise the truth. The promise is
  // shared: a second caller while one is running gets the same one, and
  // {force: true} rebuilds even when the inputs have not changed.
  transpile(options = {}) {
    // the objects this build activates: its own, never another caller's
    const activating = options.activating instanceof Set ? options.activating : new Set();
    const set = [...activating].sort().join("\n");
    if (this.building !== undefined && options.force !== true && this.buildingSet === set) {
      return this.building;
    }
    // a forced build, or one of another activation, waits for the one in
    // flight rather than running beside it
    const before = this.building;
    this.buildingSet = set;
    this.building = (async () => {
      await before?.catch(() => undefined);
      const started = Date.now();
      const w = this.warm();
      // read once, at the start of the build, so the build and its name agree
      const overlay = this.overlay(activating);
      // what this build read of the objects it activates: the revision a
      // completion must match, not the bytes on disk when it completes
      const built = (read) => {
        if (read === undefined) return undefined;
        const digests = new Map([...read].map(([file, digest]) => [normalPath(file), digest]));
        return Object.fromEntries([...activating].map((key) => [key, this.#builtRevision(key, digests)]));
      };
      if (w.on === true && overlay !== undefined && w.compiler !== undefined) {
        // the warm registry holds the tree as saved, inactive objects
        // included; a build that must leave some out is a cold one
        w.reason = `${this.inactive.size} inactive object(s) are kept out of the build`;
        w.compiler.drop?.();
        w.compiler = undefined;
      }
      if (w.on === true && options.force !== true && overlay === undefined) {
        await w.priming;
        if (w.compiler?.primed === true) {
          try {
            const r = await w.compiler.build();
            return {ok: true, ms: Date.now() - started, objects: r.objects, hash: r.hash, cached: r.cached, warm: true,
              built: built(w.compiler.digests),
              modules: r.modules, hostHeld: r.hostHeld, from: r.from, stale: r.stale, steps: r.steps,
              closure: r.closure, unverified: w.compiler.unverified.has(r.hash)};
          } catch (error) {
            if (error.code !== "NOT_WARM") {
              // `check`: the transpiler refused the change; anything else
              // (BUSY, a disk that failed) is a build that did not happen
              return {ok: false, ms: Date.now() - started, objects: 0, warm: true, check: error.check === true,
                issues: error.issues, output: withoutHostPaths(String(error.output || error.message).slice(-2000), this.root),
                error: withoutHostPaths(error.message, this.root)};
            }
            w.reason = error.message;
            w.compiler.drop();
            console.log(`warm: a cold build: ${error.message}`);
          }
        }
      }
      // a comparison of a warm generation the tree has left would end
      // inconclusive, and meanwhile it is a second cold transpile beside
      // this one (WarmCompiler#cancelVerify)
      if (w.compiler?.verifying !== undefined) w.compiler.cancelVerify(await this.sourceKey());
      try {
        const {build} = await import("./osd-build.mjs");
        const r = await build({...this.buildOptions, root: this.root, force: options.force === true, replace: options.replace === true, overlay});
        return {ok: true, ms: Date.now() - started, objects: r.objects, hash: r.hash, cached: r.cached, built: built(r.digests)};
      } catch (error) {
        // the transpiler's refusal names each object and line; the rest of
        // the log is for the host's console and never for a client: it
        // carries absolute paths of the machine that built it
        const issues = transpileIssues(error.message);
        console.log(`build failed: ${String(error.message).slice(0, 2000)}${error.output ? `\n${String(error.output).slice(-2000)}` : ""}`);
        return {ok: false, ms: Date.now() - started, objects: 0, check: issues.length > 0, issues,
          output: withoutHostPaths(String(error.output || error.message).slice(-2000), this.root),
          error: withoutHostPaths(String(error.message).split("\n")[0], this.root)};
      } finally {
        // a cold build is a new start for the warm registry, primed once the
        // saves have stopped for a while: the prime holds this process for
        // its 8-9 s, and a burst of cold saves would pay it each time
        if (w.on === true && w.compiler?.primed !== true) {
          clearTimeout(w.reprime);
          w.reprime = setTimeout(() => this.warmUp(), WARM_REPRIME_MS);
          w.reprime.unref?.();
        }
      }
    })();
    const building = this.building;
    building.finally(() => {
      if (this.building === building) this.building = undefined;
    });
    return building;
  }
}

export class Conflict extends Error {
  constructor(type, name) {
    super(`${type} ${name} already exists`);
    this.code = "CONFLICT";
    this.objectType = type;
    this.objectName = name;
  }
}

export class NotFound extends Error {
  constructor(type, name) {
    super(`${type} ${name} does not exist`);
    this.code = "NOT_FOUND";
    this.objectType = type;
    this.objectName = name;
  }
}

export class ReadOnly extends Error {
  constructor(type, name) {
    super(`${type} ${name} comes from a library and cannot be changed here`);
    this.code = "READ_ONLY";
    this.objectType = type;
    this.objectName = name;
  }
}

export class NotSupported extends Error {
  constructor(what) {
    super(`${what} is not supported`);
    this.code = "NOT_SUPPORTED";
  }
}

// the command line, so the store can be looked at without a façade
function main(args) {
  const store = new ObjectStore();
  const [command, type, name] = args;
  switch (command) {
    case "list": {
      const objects = store.list(type);
      const counts = new Map();
      for (const o of objects) {
        counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
      }
      console.log(`${objects.length} objects: ${[...counts].sort().map(([t, n]) => `${t} ${n}`).join(", ")}`);
      return 0;
    }
    case "read":
      process.stdout.write(store.read(type, name).source);
      return 0;
    case "check":
    case "activate": {
      // check TYPE NAME --source file.abap answers for a file that is not
      // the object's own, the way an editor asks before it saves
      const at = args.indexOf("--source");
      const source = at < 0 ? undefined : readFileSync(args[at + 1], "utf8");
      const result = command === "check" ? store.check(type, name, {source}) : store.activate(type, name);
      console.log(JSON.stringify(result, undefined, 1));
      return result.issues.length === 0 ? 0 : 1;
    }
    case "search": {
      for (const hit of store.search(type, {source: name === "--source"})) {
        console.log(`${hit.type} ${hit.name}${hit.library ? " (library)" : ""}`);
      }
      return 0;
    }
    default:
      console.log("usage: osd-store.mjs list [TYPE] | read TYPE NAME | check TYPE NAME [--source FILE] | activate TYPE NAME | search TEXT [--source]");
      return 2;
  }
}

if (runsAs("osd-store.mjs")) {
  process.exit(main(process.argv.slice(2)));
}

// every file under a folder, for the copies of active versions
function walkFiles(dir, out = []) {
  for (const e of readdirSync(dir, {withFileTypes: true})) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}
