// abapGit in a box, the half that matters: a repository's objects become
// objects of OSD.
//
// On a system, abapGit's deserialise hands each file to a serialiser class
// per object type, 325 of them, which then call SAP's own APIs to create
// the object. OSD needs none of that, because here an object already *is* a
// file in abapGit's format: deserialise is a write, serialise is a read.
// So this reads a repository the way abapGit reads one, `.abapgit.xml` for
// the starting folder and the folder logic included, and writes what it
// finds into the store.
//
// Where the files come from is the swappable half. A folder that someone
// already cloned works today; a URL is cloned with git; and when abapGit's
// own git layer is transpiled (109 files, no issues against open-abap-core)
// the fetch moves inside and OSD needs no git binary at all.
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {ObjectStore, TYPES, nameOf} from "./osd-store.mjs";

export const ABAPGIT_XML = ".abapgit.xml";

// what abapGit puts in .abapgit.xml, and what it means when it is missing
export function repositoryConfig(folder) {
  const file = join(folder, ABAPGIT_XML);
  if (existsSync(file) === false) {
    return {startingFolder: "/src/", folderLogic: "PREFIX", masterLanguage: "E", declared: false};
  }
  const text = readFileSync(file, "utf8");
  const value = (tag) => (new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text) ?? [])[1];
  return {
    startingFolder: value("STARTING_FOLDER") ?? "/src/",
    folderLogic: (value("FOLDER_LOGIC") ?? "PREFIX").toUpperCase(),
    masterLanguage: value("MASTER_LANGUAGE") ?? "E",
    declared: true,
  };
}

// every file of the source folder, deepest last so a package is created
// before what it holds
function walk(folder, prefix = "", out = []) {
  for (const entry of readdirSync(folder).sort()) {
    if (entry === ".git" || entry === "node_modules") {
      continue;
    }
    const path = join(folder, entry);
    if (statSync(path).isDirectory()) {
      walk(path, prefix === "" ? entry : `${prefix}/${entry}`, out);
    } else {
      out.push({path, relative: prefix === "" ? entry : `${prefix}/${entry}`});
    }
  }
  return out;
}

// a file name in abapGit's shape: <name>.<type>.<extension>
export function objectOf(fileName) {
  for (const [type, meta] of Object.entries(TYPES)) {
    if (meta.sameFileAs !== undefined) {
      continue;
    }
    if (fileName.endsWith(meta.ext)) {
      return {type, name: nameOf(fileName.slice(0, -meta.ext.length))};
    }
  }
  return undefined;
}

// the extensions an object's other files carry: a class is five files, a
// function group is one per module, and every object may have its XML
const OWNED = /\.(clas|intf|prog|fugr|tabl|dtel|doma|ttyp|view|shlp|msag|ddls|srvd|enho|xslt|w3mi|smim|devc)\./;

export function ownerOf(fileName) {
  return OWNED.test(fileName) ? fileName.split(".")[0].toUpperCase() : undefined;
}

export class Import {
  constructor(store = new ObjectStore()) {
    this.store = store;
  }

  // a folder someone checked out; the repository's own layout is read, not assumed
  fromFolder(folder, options = {}) {
    const config = repositoryConfig(folder);
    const source = join(folder, config.startingFolder.replace(/^\/|\/$/g, ""));
    if (existsSync(source) === false) {
      throw new NotARepository(folder, config.startingFolder);
    }
    const target = options.target ?? join("local", options.name ?? basename(folder).toLowerCase());
    const written = [];
    const skipped = [];
    const packages = new Set();

    for (const file of walk(source)) {
      const name = basename(file.relative);
      if (name === "package.devc.xml" || name.endsWith(".devc.xml")) {
        // a package is a folder here, so its file rides along and its text
        // is read from it later
        this.#copy(file, target, written);
        packages.add(file.relative.split("/").slice(0, -1).join("/"));
        continue;
      }
      const object = objectOf(name);
      if (object === undefined) {
        // a file that is not an object's main file still belongs to one: a
        // class carries its XML, its local includes and its test classes,
        // and a function group its includes. Anything that belongs to
        // nothing (a readme, a licence) is left behind.
        const owner = ownerOf(name);
        if (owner === undefined) {
          skipped.push({file: file.relative, why: "belongs to no object"});
        } else {
          this.#copy(file, target, written);
        }
        continue;
      }
      if (options.types !== undefined && options.types.includes(object.type) === false) {
        skipped.push({file: file.relative, why: `type ${object.type} was not asked for`});
        continue;
      }
      const existing = this.store.find(object.type, object.name);
      if (existing !== undefined && existing.imported === false && options.overwrite !== true) {
        skipped.push({file: file.relative, why: `${object.type} ${object.name} is ours already`});
        continue;
      }
      this.#copy(file, target, written, object);
    }

    this.store.build();
    return {
      folder,
      config,
      target,
      written: written.length,
      objects: written.filter((w) => w.type !== undefined).length,
      packages: packages.size,
      skipped,
    };
  }

  // a repository nobody has yet: git fetches it, and this is the half that
  // abapGit's own git layer replaces once it is transpiled
  fromGit(url, options = {}) {
    const clone = mkdtempSync(join(tmpdir(), "osd-clone-"));
    try {
      execFileSync("git", ["clone", "--depth", "1", ...(options.branch ? ["--branch", options.branch] : []), url, clone], {stdio: "pipe"});
      const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], {cwd: clone, encoding: "utf8"}).trim();
      const result = this.fromFolder(clone, {name: options.name ?? url.split("/").pop().replace(/\.git$/, "").toLowerCase(), ...options});
      return {...result, url, commit: head};
    } finally {
      rmSync(clone, {recursive: true, force: true});
    }
  }

  #copy(file, target, written, object) {
    const to = join(target, file.relative);
    mkdirSync(join(this.store.root, to).replace(/\/[^/]*$/, ""), {recursive: true});
    writeFileSync(join(this.store.root, to), readFileSync(file.path));
    written.push({file: to, ...object});
  }
}

export class NotARepository extends Error {
  constructor(folder, startingFolder) {
    super(`${folder} has no ${startingFolder} to read: not an abapGit repository`);
    this.code = "NOT_A_REPOSITORY";
  }
}

function main(args) {
  const where = args.find((a) => a.startsWith("-") === false);
  if (where === undefined) {
    console.log("usage: osd-import.mjs <folder|git url> [--types CLAS,INTF] [--overwrite] [--name <folder under local/>]");
    return 2;
  }
  const at = (flag) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };
  const options = {
    types: at("--types")?.split(","),
    overwrite: args.includes("--overwrite"),
    name: at("--name"),
    branch: at("--branch"),
  };
  const store = new ObjectStore();
  const before = store.list().length;
  const importer = new Import(store);
  const result = /^https?:|^git@/.test(where) ? importer.fromGit(where, options) : importer.fromFolder(where, options);
  const after = store.list().length;
  console.log(`${result.objects} objects from ${result.folder}${result.commit ? ` at ${result.commit}` : ""}`);
  console.log(`  starting folder ${result.config.startingFolder}, folder logic ${result.config.folderLogic}${result.config.declared ? "" : " (assumed, no .abapgit.xml)"}`);
  console.log(`  the system went from ${before} to ${after} objects`);
  if (result.skipped.length > 0) {
    const why = new Map();
    for (const s of result.skipped) {
      why.set(s.why, (why.get(s.why) ?? 0) + 1);
    }
    console.log(`  skipped ${result.skipped.length}: ${[...why].map(([w, n]) => `${n} ${w}`).join(", ")}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  process.exit(main(process.argv.slice(2)));
}
