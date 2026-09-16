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
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, watch, writeFileSync} from "node:fs";
import {packRootsOf} from "./osd-packs.mjs";

import {basename, dirname, join} from "node:path";
import * as abaplint from "@abaplint/core";
import {Data} from "./osd-data.mjs";
import {ServingRuntime} from "./osd-runtime.mjs";
import {RuntimePool} from "./osd-pool.mjs";

// abapGit writes /DEMO/ZREPORT as #demo#zreport; ADT hands us the name
// with its slashes, URL-encoded, and the façade decodes before it gets here
export const fileOf = (name) => name.toLowerCase().replaceAll("/", "#");
export const nameOf = (file) => file.toUpperCase().replaceAll("#", "/");

// the object types wave 1 reads, with the extension abapGit gives them and
// the ADT resource they live under
export const TYPES = {
  CLAS: {ext: ".clas.abap", adt: "oo/classes", source: true},
  INTF: {ext: ".intf.abap", adt: "oo/interfaces", source: true},
  PROG: {ext: ".prog.abap", adt: "programs/programs", source: true},
  FUGR: {ext: ".fugr.xml", adt: "functions/groups", source: false},
  TABL: {ext: ".tabl.xml", adt: "ddic/tables", source: false},
  DTEL: {ext: ".dtel.xml", adt: "ddic/dataelements", source: false},
  DOMA: {ext: ".doma.xml", adt: "ddic/domains", source: false},
  TTYP: {ext: ".ttyp.xml", adt: "ddic/tabletypes", source: false},
  DDLS: {ext: ".ddls.asddls", adt: "ddic/ddl/sources", source: true},
  SRVD: {ext: ".srvd.srvdsrv", adt: "ddic/srvd/sources", source: true},
  VIEW: {ext: ".view.xml", adt: "ddic/views", source: false},
  SHLP: {ext: ".shlp.xml", adt: "ddic/searchhelps", source: false},
  MSAG: {ext: ".msag.xml", adt: "messageclass", source: false},
  DEVC: {ext: ".devc.xml", adt: "packages", source: false},
  // an include is a program without a header; abapGit gives both the same
  // extension, so the two are told apart by what the source starts with
  INCL: {ext: ".prog.abap", adt: "programs/includes", source: true, sameFileAs: "PROG"},
};

// vsp asks for a structure under ddic/structures and for a table under
// ddic/tables, but abapGit writes both as .tabl.xml and the difference is
// TABCLASS inside: INTTAB is a structure, TRANSP and friends are tables
export const STRUCTURE_TABCLASS = "INTTAB";

// a class carries more than one file; ADT calls them includes
export const INCLUDES = {
  main: ".clas.abap",
  definitions: ".clas.locals_def.abap",
  implementations: ".clas.locals_imp.abap",
  macros: ".clas.macros.abap",
  testclasses: ".clas.testclasses.abap",
};

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

const DEFAULT_ROOTS = [
  {path: "src", writable: true, library: false},
  // what was brought in from a repository: objects of the local system that
  // nobody here wrote, so they are not in this repository's git, and our own
  // source wins when a name is in both
  {path: "local", writable: true, library: false, imported: true},
  // ABAP unit test classes are objects of the system too, and the
  // transpiler already builds from here
  {path: "test", writable: true, library: false},
  {path: "gen", writable: false, library: false},
];

// the open-abap clones beside us: a system's worth of standard objects,
// read-only, and the reason a package tree looks inhabited
const DEFAULT_LIBS = [
  ".local/lars/open-abap-core/src",
  ".local/lars/express-icf-shim/src",
  ".local/lars/open-abap-odata/src",
];

// Parsing the system costs seconds and every store of the same tree parses
// the same thing, so the answer is kept per root and dropped the moment
// anything is written. A façade that makes a store per request pays once.
const PARSED = new Map();

const packageWord = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

// The roots as the transpiler lists them: the input_folder of
// abap_transpile.json, in its order, so that the index and the build resolve
// a name to the same file (tools/osd-inputs.mjs: the later root wins in
// both, the way a layer does; a library never wins over a root). A tree
// without the config is read the old way. gen/ is never written by hand,
// and what sits under local/ was imported, not written here.
export function rootsOf(root) {
  let folders;
  try {
    folders = JSON.parse(readFileSync(join(root, "abap_transpile.json"), "utf8")).input_folder;
  } catch {
    return DEFAULT_ROOTS;
  }
  if (Array.isArray(folders) === false || folders.length === 0) {
    return DEFAULT_ROOTS;
  }
  return [...folders.map((path) => ({
    path, writable: path !== "gen", library: false,
    ...(path === "local" || path.startsWith("local/") ? {imported: true} : {}),
  })), ...packRootsOf(root)];
}

export class ObjectStore {
  constructor(options = {}) {
    this.root = options.root ?? process.cwd();
    this.explicitRoots = options.roots !== undefined;
    this.roots = options.roots ?? rootsOf(this.root);
    this.superPackage = options.superPackage === undefined ? SUPER_PACKAGE : options.superPackage;
    this.libs = (options.libs ?? DEFAULT_LIBS).map((p) => ({path: p, writable: false, library: true}));
    this.index = undefined;
    this.parsed = undefined;
    // What has been written and not activated since. A system keeps an
    // inactive version of such an object and says so in its documents; a
    // client that saved and then read the object back unchanged took its
    // own copy for the newer one and showed an empty editor over a save
    // that had succeeded. Written marks it, a clean activation clears it.
    this.inactive = new Set();
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
      for (const file of this.#walk(root.path, [])) {
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
    const entry = this.find(type, name);
    if (entry === undefined) {
      throw new NotFound(type, name);
    }
    if (type === "CLAS" && include !== "main") {
      const suffix = INCLUDES[include];
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

  // a write lands a file; a new object goes to the first writable root
  write(type, name, source, include = "main") {
    const meta = TYPES[type];
    if (meta === undefined) {
      throw new NotSupported(`object type ${type}`);
    }
    let entry = this.find(type, name);
    if (entry !== undefined && entry.writable === false) {
      throw new ReadOnly(type, name);
    }
    if (entry === undefined) {
      const root = this.roots.find((r) => r.writable);
      const file = join(root.path, "osd", fileOf(name) + meta.ext);
      const packages = this.#packagesOf(file, root);
      entry = {type, name: String(name).toUpperCase(), file, root: root.path, writable: true, library: false,
               imported: root.imported === true, package: packages[packages.length - 1], packages};
      this.#entries().set(`${entry.type} ${entry.name}`, entry);
    }
    let file = entry.file;
    if (type === "CLAS" && include !== "main") {
      const suffix = INCLUDES[include];
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
    writeFileSync(join(this.root, file), String(source).replaceAll("\r\n", "\n").replaceAll("\r", "\n"));
    this.inactive.add(`${entry.type} ${entry.name}`);
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
    for (const [suffix, content] of Object.entries(made)) {
      const target = type === "DEVC" ? file : file.slice(0, -meta.ext.length) + suffix;
      writeFileSync(join(this.root, target), content);
    }
    const packages = this.#packagesOf(file, root);
    const entry = {type, name: upper, file, root: root.path, writable: true, library: false,
                   imported: root.imported === true, description,
                   package: type === "DEVC" ? parent : packages[packages.length - 1], packages};
    this.#entries().set(`${type} ${upper}`, entry);
    if (type !== "DEVC") {
      this.inactive.add(`${type} ${upper}`);
    }
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
    this.#entries().delete(`${entry.type} ${entry.name}`);
    this.inactive.delete(`${entry.type} ${entry.name}`);
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
  async publish(options = {}) {
    const transpile = await this.transpile(options);
    if (transpile?.ok === false) {
      return {ok: false, transpile};
    }
    const runtime = this.served;
    if (runtime === undefined || runtime.running === false) {
      return {ok: true, transpile, recycled: false};
    }
    try {
      const recycle = await runtime.recycle();
      return {ok: true, transpile, recycled: true, generation: recycle.generation, ms: recycle.ms};
    } catch (error) {
      // the modules are good and the process that should carry them is not:
      // that is a failure of the activation, not a detail to log quietly
      return {ok: false, transpile, recycled: false, error: error.message};
    }
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

  // a write means the parse is stale, here and for anyone sharing this tree
  #forget() {
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
      for (const file of this.#walk(root.path, [])) {
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
    const issues = registry.findIssuesObject(object).map((issue) => ({
      severity: "E",
      rule: issue.getKey(),
      message: issue.getMessage(),
      file: issue.getFilename(),
      line: issue.getStart().getRow(),
      column: issue.getStart().getCol(),
    }));
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
      const suffix = INCLUDES[include];
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
  // The verdict comes back at once and the modules are written afterwards,
  // because the façade answers the client with the verdict and the next
  // request is what needs the output.
  activate(type, name) {
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
    if (broken.length === 0) {
      this.inactive.delete(`${type} ${String(name).toUpperCase()}`);
    }
    return {...result, active: broken.length === 0, dependents: broken};
  }

  // the transpile behind an activation: the modules the runtime loads.
  // Built to the side and made live by a rename (tools/osd-build.mjs), so a
  // build that fails leaves the live generation exactly as it was — which
  // is the whole reason publish() can promise the truth. The promise is
  // shared: a second caller while one is running gets the same one, and
  // {force: true} rebuilds even when the inputs have not changed.
  transpile(options = {}) {
    if (this.building !== undefined && options.force !== true) {
      return this.building;
    }
    this.building = (async () => {
      const started = Date.now();
      try {
        const {build} = await import("./osd-build.mjs");
        const r = await build({root: this.root, force: options.force === true});
        return {ok: true, ms: Date.now() - started, objects: r.objects, hash: r.hash, cached: r.cached};
      } catch (error) {
        return {ok: false, ms: Date.now() - started, objects: 0, output: String(error.output || error.message).slice(-2000), error: error.message};
      } finally {
        this.building = undefined;
      }
    })();
    return this.building;
  }
}

// what a create writes, per type: the abapGit header and a source skeleton
// (the client's first save replaces the skeleton). Header fields are the
// ones abapGit serializes for a fresh object of the kind.
const abapGitHeader = (serializer, inner) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="${serializer}" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
${inner}
  </asx:values>
 </asx:abap>
</abapGit>
`;
const xmlText = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const textPool = (text) => text === "" ? "" : `
   <TPOOL>
    <item>
     <ID>R</ID>
     <ENTRY>${xmlText(text)}</ENTRY>
     <LENGTH>${String(text).length}</LENGTH>
    </item>
   </TPOOL>`;
const CREATABLE = {
  CLAS: (name, text, source) => ({
    ".clas.abap": source ?? `CLASS ${name.toLowerCase()} DEFINITION PUBLIC CREATE PUBLIC.\n  PUBLIC SECTION.\nENDCLASS.\n\nCLASS ${name.toLowerCase()} IMPLEMENTATION.\nENDCLASS.\n`,
    ".clas.xml": abapGitHeader("LCL_OBJECT_CLAS", `   <VSEOCLASS>
    <CLSNAME>${name}</CLSNAME>
    <LANGU>E</LANGU>
    <DESCRIPT>${xmlText(text)}</DESCRIPT>
    <STATE>1</STATE>
    <CLSCCINCL>X</CLSCCINCL>
    <FIXPT>X</FIXPT>
    <UNICODE>X</UNICODE>
   </VSEOCLASS>`),
  }),
  INTF: (name, text, source) => ({
    ".intf.abap": source ?? `INTERFACE ${name.toLowerCase()} PUBLIC.\nENDINTERFACE.\n`,
    ".intf.xml": abapGitHeader("LCL_OBJECT_INTF", `   <VSEOINTERF>
    <CLSNAME>${name}</CLSNAME>
    <LANGU>E</LANGU>
    <DESCRIPT>${xmlText(text)}</DESCRIPT>
    <EXPOSURE>2</EXPOSURE>
    <STATE>1</STATE>
    <UNICODE>X</UNICODE>
   </VSEOINTERF>`),
  }),
  PROG: (name, text, source) => ({
    ".prog.abap": source ?? `REPORT ${name.toLowerCase()}.\n`,
    ".prog.xml": abapGitHeader("LCL_OBJECT_PROG", `   <PROGDIR>
    <NAME>${name}</NAME>
    <DBAPL>S</DBAPL>
    <SUBC>1</SUBC>
    <FIXPT>X</FIXPT>
    <LDBNAME>D$S</LDBNAME>
    <UCCHECK>X</UCCHECK>
   </PROGDIR>${textPool(text)}`),
  }),
  INCL: (name, text, source) => ({
    ".prog.abap": source ?? `*&---------------------------------------------------------------------*\n*& Include ${name}\n*&---------------------------------------------------------------------*\n`,
    ".prog.xml": abapGitHeader("LCL_OBJECT_PROG", `   <PROGDIR>
    <NAME>${name}</NAME>
    <SUBC>I</SUBC>
    <APPL>S</APPL>
    <FIXPT>X</FIXPT>
    <UCCHECK>X</UCCHECK>
   </PROGDIR>${textPool(text)}`),
  }),
  DDLS: (name, text, source) => ({
    ".ddls.asddls": source ?? `@EndUserText.label: '${String(text).replaceAll("'", "''")}'\ndefine view entity ${name} as select from zosd_test_item\n{\n  key item_id\n}\n`,
    ".ddls.xml": abapGitHeader("LCL_OBJECT_DDLS", `   <DDLS>
    <DDLNAME>${name}</DDLNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <DDTEXT>${xmlText(text)}</DDTEXT>
   </DDLS>`),
  }),
  DEVC: (name, text) => ({
    "package.devc.xml": abapGitHeader("LCL_OBJECT_DEVC", `   <DEVC>
    <CTEXT>${xmlText(text)}</CTEXT>
   </DEVC>`),
  }),
};

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

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  process.exit(main(process.argv.slice(2)));
}
