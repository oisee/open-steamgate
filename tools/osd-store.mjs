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
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync} from "node:fs";
import {spawn} from "node:child_process";
import {basename, dirname, join} from "node:path";
import * as abaplint from "@abaplint/core";
import {Data} from "./osd-data.mjs";

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
  test: "$STG_TEST",
  gen: "$STG_GEN",
};

const DEFAULT_ROOTS = [
  {path: "src", writable: true, library: false},
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

export class ObjectStore {
  constructor(options = {}) {
    this.root = options.root ?? process.cwd();
    this.roots = options.roots ?? DEFAULT_ROOTS;
    this.libs = (options.libs ?? DEFAULT_LIBS).map((p) => ({path: p, writable: false, library: true}));
    this.index = undefined;
    this.parsed = undefined;
  }

  // ---------------------------------------------------------------- index

  #walk(dir, out) {
    let entries;
    try {
      entries = readdirSync(join(this.root, dir));
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
    const base = ROOT_PACKAGES[root.path] ?? "$" + (root.path.split("/").filter((p) => p !== "src" && p !== "." && p !== ".local" && p !== "lars").pop() ?? root.path).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    const inside = file.slice(root.path.length).split("/").filter((p) => p !== "");
    inside.pop();
    const chain = [base];
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
          const objectName = nameOf(name.slice(0, -meta.ext.length));
          const key = `${type} ${objectName}`;
          // ours wins over a library's, src wins over gen
          if (!index.has(key)) {
            const chain = this.#packagesOf(file, root);
            index.set(key, {type, name: objectName, file, root: root.path, writable: root.writable, library: root.library,
                            package: chain[chain.length - 1], packages: chain});
          }
          break;
        }
      }
    }
    this.index = index;
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
      entry = {type, name: String(name).toUpperCase(), file, root: root.path, writable: true, library: false};
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
    writeFileSync(join(this.root, file), source);
    this.parsed = undefined;
    return {...entry, include, file, bytes: Buffer.byteLength(source, "utf8")};
  }

  delete(type, name) {
    const entry = this.find(type, name);
    if (entry === undefined) {
      throw new NotFound(type, name);
    }
    if (entry.writable === false) {
      throw new ReadOnly(type, name);
    }
    for (const suffix of [undefined, ...Object.values(INCLUDES)]) {
      const file = suffix === undefined ? entry.file : entry.file.replace(/\.clas\.abap$/, suffix);
      if (file !== entry.file || suffix === undefined) {
        if (existsSync(join(this.root, file))) {
          unlinkSync(join(this.root, file));
        }
      }
    }
    this.#entries().delete(`${entry.type} ${entry.name}`);
    this.parsed = undefined;
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
      const own = packages.get(entry.package);
      own.objects = own.objects + 1;
    }
    for (const node of packages.values()) {
      node.subpackages.sort();
    }
    return [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // one package: what is under it and what is in it
  package(name) {
    const wanted = String(name).toUpperCase();
    const all = this.packages();
    const node = all.find((p) => p.name === wanted);
    if (node === undefined) {
      throw new NotFound("DEVC", wanted);
    }
    const objects = [];
    for (const entry of this.#entries().values()) {
      if (entry.package === wanted) {
        objects.push({type: entry.type, name: entry.name, library: entry.library, writable: entry.writable});
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

  #devcOf(name) {
    for (const entry of this.#entries().values()) {
      if (entry.type === "DEVC" && entry.package === name) {
        return entry.file;
      }
    }
    return undefined;
  }

  // the rows of the system, for a client that asks for table contents: one
  // place knows about the schema, the seed and the dialect (tools/osd-data.mjs)
  data() {
    if (this.rows === undefined) {
      this.rows = new Data({root: this.root});
    }
    return this.rows;
  }

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
    return registry;
  }

  // the syntax check a write runs; issues of this object only
  check(type, name) {
    const entry = this.find(type, name);
    if (entry === undefined) {
      throw new NotFound(type, name);
    }
    const registry = this.registry();
    const object = registry.getObject(type, entry.name);
    if (object === undefined) {
      return {type, name: entry.name, issues: [{severity: "E", message: `${type} ${entry.name} is not in the registry`, line: 1, column: 1}]};
    }
    const issues = registry.findIssuesObject(object).map((issue) => ({
      severity: "E",
      rule: issue.getKey(),
      message: issue.getMessage(),
      file: issue.getFilename(),
      line: issue.getStart().getRow(),
      column: issue.getStart().getCol(),
    }));
    return {type, name: entry.name, issues};
  }

  // activation is that check over the object and everything that uses it:
  // a local system has no queue, so it either holds or it does not. The
  // verdict comes back at once and the modules are written afterwards,
  // because the façade answers the client with the verdict and the next
  // request is what needs the output.
  activate(type, name) {
    const result = this.check(type, name);
    return {...result, active: result.issues.length === 0};
  }

  // the transpile behind an activation: the modules the runtime loads.
  // Ten seconds over the whole system, so a caller starts it and does not
  // wait; the promise is there for a caller that wants to know. Not to be
  // confused with build( ), which is the index of objects.
  transpile(options = {}) {
    if (this.building !== undefined && options.force !== true) {
      return this.building;
    }
    this.building = new Promise((resolve) => {
      const started = Date.now();
      const child = spawn("npx", ["abap_transpile"], {cwd: this.root, stdio: "pipe"});
      let output = "";
      child.stdout.on("data", (d) => {
        output += d.toString();
      });
      child.stderr.on("data", (d) => {
        output += d.toString();
      });
      child.on("close", (code) => {
        this.building = undefined;
        resolve({
          ok: code === 0,
          ms: Date.now() - started,
          objects: Number(/(\d+) objects written to disk/.exec(output)?.[1] ?? 0),
          output: code === 0 ? undefined : output.slice(-2000),
        });
      });
    });
    return this.building;
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
      const result = command === "check" ? store.check(type, name) : store.activate(type, name);
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
      console.log("usage: osd-store.mjs list [TYPE] | read TYPE NAME | check TYPE NAME | activate TYPE NAME | search TEXT [--source]");
      return 2;
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  process.exit(main(process.argv.slice(2)));
}
