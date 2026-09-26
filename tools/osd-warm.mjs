// The warm compile: one abaplint registry kept for as long as the process
// lives, so a save costs the objects it reaches and not the tree.
//
// A cold build (tools/osd-build.mjs) runs the generators and transpiles every
// object: ~11 s on this tree. Most saves are an edit to one method of one
// class, which changes that class and whatever reads it, and nothing a
// generator reads. For those, this keeps the registry of the live generation,
// replaces the changed file, and has the transpiler build only the objects the
// change reaches -- the edited ones and, transitively, their readers, taken
// from abaplint's scope references. The transpiler needs three changes for
// that, all proposed upstream (abaplint/transpiler#1898): the temporary names
// numbered per object (#1899), `only` (#1900), and a second run over the
// same registry that checks the chosen objects rather than everything
// (#1921). Without them `probe()` says so and every build stays cold.
//
// The generation it makes is an ordinary one: the live generation's files,
// hard-linked, with the rebuilt modules and the scripts written over them,
// named by the same hash of the inputs a cold build would give it and
// switched to the same way. Whether its bytes are a cold transpile's is not
// assumed: verify() transpiles the same inputs cold in a child process and
// compares, and until that has passed the generation is "warm-unverified".
// verify() runs no generators, so it checks this build against today's
// gen/, not the rule below against the generators.
//
// What is warm is decided file by file, and anything else is cold -- the
// generators read the tree too, and a change they would see has to reach
// them (see warmRule below).
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync} from "node:fs";
import {basename, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {generatorIdentity, hashOf, inputsOf, layout, liveHash, lock, linkRoots, ownConfig, prepare, rootsWanted, switchTo} from "./osd-build.mjs";
import {describeBuild} from "./osd-transpiler.mjs";
import {runsAs} from "./osd-main.mjs";
import {hostModules, toolCommand} from "./osd-host.mjs";
import {isBinaryFilename, listFiles, loadLibs, modulesOf, outputFiles, readAll} from "./osd-transpile.mjs";
import {warmVerdict} from "./osd-hot.mjs";

export {warmVerdict};

// the tools folder, the way osd-build.mjs finds its generators: a binary
// runs `<binary> gen osd-warm.mjs` and only the basename matters there
const TOOLS = fileURLToPath(new URL(".", import.meta.url));

export class NotWarm extends Error {
  constructor(reason) {
    super(reason);
    this.code = "NOT_WARM";
  }
}

// ---------------------------------------------------------------------------
// the rule: which changed file may be built warm
//
// The generators of a cold build (osd-build.mjs GENERATORS) read the tree,
// and a change one of them would see must go through them. What they read of
// an ABAP source, found by reading each of them (2026-09-25):
//   - amdp-gen: every class with an AMDP body, and every interface as a type
//     source for those bodies;
//   - osd-tran-registry: whether a class names the transaction contract in
//     an INTERFACES line, and a report's source;
//   - cds2ddic, stg-compile, segw-*, osd-bsp-registry, osd-fm-registry:
//     other object types (DDLS, TABL, IWSV, WAPA, FUGR, YAML), and which
//     class files exist.
// So an edit is warm when it changes the content of a class or interface
// that already exists, outside gen/, with no AMDP body before or after, the
// same INTERFACES lines, and -- for an interface -- no AMDP class naming it.
// A new or removed file, any other object type, a library, the config, a
// page or a generator is cold. test/warm.mjs pins the generator list this
// was read against, so a new generator makes somebody read this again.
export const GENERATORS_READ = [
  "osd-transpiler.mjs", "osd-inputs.mjs", "osd-ddic-binary.mjs", "cds2ddic.mjs", "stg-compile.mjs",
  "segw-registry.mjs", "segw-shlp.mjs", "osd-bsp-registry.mjs", "amdp-gen.mjs", "amdp-tablefunc.mjs",
  "osd-fm-registry.mjs", "osd-tran-registry.mjs",
];

const SOURCE = /\.(clas(\.(locals_imp|locals_def|testclasses|macros))?\.abap|intf\.abap)$/i;
const AMDP = /BY\s+DATABASE\s+(PROCEDURE|FUNCTION)/i;
// every INTERFACES statement, the chained form (`INTERFACES: a, b.`) too,
// as the words it names; a changed addition counts as a change
const interfacesOf = (text) => [...text.matchAll(/^\s*INTERFACES\b\s*:?([^.]*)\./gim)]
  .flatMap((m) => m[1].split(/[\s,]+/).filter(Boolean).map((w) => w.toUpperCase())).sort().join(",");

/** why a content edit may not be built warm, or undefined when it may */
export function warmRule({path, before, after, amdpText = ""}) {
  const name = basename(path);
  if (path.split(sep).includes("gen")) {
    return `${name}: a generated file`;
  }
  if (!SOURCE.test(name)) {
    return `${name}: not the source of a class or an interface`;
  }
  if (AMDP.test(before) || AMDP.test(after)) {
    return `${name}: an AMDP body (amdp-gen reads it)`;
  }
  if (interfacesOf(before) !== interfacesOf(after)) {
    return `${name}: its INTERFACES lines changed (osd-tran-registry reads them)`;
  }
  if (/\.intf\.abap$/i.test(name)) {
    const intf = name.replace(/\.intf\.abap$/i, "");
    if (new RegExp(`\\b${intf.replace(/[^a-z0-9_]/gi, "\\$&")}\\b`, "i").test(amdpText)) {
      return `${name}: an AMDP class names it (amdp-gen reads it as a type source)`;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// the import graph of a generation: which module imports which, by the
// specifiers the transpiler writes ("./x.clas.mjs"). A module a rebuild does
// not replace keeps its binding to the old instance of anything it imported,
// so a warm build refuses unless every importer of a rebuilt module is
// rebuilt as well -- the scope references are the plan, this is the check.
const SCRIPTS = new Set(["init.mjs", "_init.mjs", "index.mjs", "_unit_open.mjs", "_top.mjs"]);

export function importsOf(text) {
  const out = [];
  for (const m of text.matchAll(/\bimport\(\s*"(\.\/[^"]+\.mjs)"\s*\)|\bfrom\s+"(\.\/[^"]+\.mjs)"/g)) {
    out.push(decodeURIComponent((m[1] ?? m[2]).slice(2)));
  }
  return out;
}

/** why a set of rebuilt modules may not be swapped in: a module left in place imports one */
export function importerRefusal(importers, rebuiltFiles) {
  const rebuilt = new Set(rebuiltFiles);
  for (const m of rebuilt) {
    // the scripts are written by every build and loaded by no swap: the
    // process keeps the ones it started with, as their importers do
    if (SCRIPTS.has(m)) continue;
    for (const importer of importers.get(m) ?? []) {
      if (!rebuilt.has(importer)) {
        return `${importer} imports ${m} and is not rebuilt with it`;
      }
    }
  }
  return undefined;
}

export function importersOf(dir) {
  const importers = new Map();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".mjs") || SCRIPTS.has(file)) continue;
    for (const target of importsOf(readFileSync(join(dir, file), "utf8"))) {
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(file);
    }
  }
  return importers;
}

// ---------------------------------------------------------------------------

/** whether this transpiler can build some objects of a registry kept across runs */
export async function probe(Transpiler, core) {
  const clas = (name, body) => new core.MemoryFile(`${name}.clas.abap`, `CLASS ${name} DEFINITION PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS m.
ENDCLASS.
CLASS ${name} IMPLEMENTATION.
  METHOD m.
    ${body}
  ENDMETHOD.
ENDCLASS.`);
  const reg = new core.Registry();
  reg.addFile(clas("zcl_warm_a", "DATA x TYPE i."));
  reg.addFile(clas("zcl_warm_b", "DATA y TYPE i."));
  await new Transpiler({ignoreSyntaxCheck: false}).run(reg);
  const kept = reg.getObject("CLAS", "ZCL_WARM_A").syntaxResult;
  const only = await new Transpiler({ignoreSyntaxCheck: false, only: (o) => o.getName() === "ZCL_WARM_B"}).run(reg);
  if (only.objects.length !== 1) return "the transpiler has no `only` option (abaplint/transpiler#1900)";
  if (kept === undefined || reg.getObject("CLAS", "ZCL_WARM_A").syntaxResult !== kept) {
    return "a second run checks the whole registry again (abaplint/transpiler#1921)";
  }
  return undefined;
}

const key = (o) => o.getType() + " " + o.getName();
const warmDiffers = (generationDir) => {
  try {
    return JSON.parse(readFileSync(`${generationDir}.warm.json`, "utf8")).differs !== undefined;
  } catch {
    return false;
  }
};
const statKey = (file) => {
  try {
    const st = statSync(file);
    return `${st.size}:${st.mtimeMs}:${st.ino}`;
  } catch {
    return "absent";
  }
};

// The modules tools/osd-serve.mjs imports itself and holds for the life of
// the process: a swap cannot reach its bindings, so a build that rebuilds one
// is recycled rather than swapped. test/warm.mjs keeps this list and the
// imports of osd-serve.mjs the same.
export const HOST_HELD = ["init.mjs", "cl_express_icf_shim.clas.mjs", "zcl_stg_segw_registry.clas.mjs",
  "zcl_stg_shlp_registry.clas.mjs", "zcl_apc_host.clas.mjs", "zcl_osd_status.clas.mjs", "zcl_osd_demo_data.clas.mjs"];

export class WarmCompiler {
  constructor(options = {}) {
    this.root = resolve(options.root ?? process.cwd());
    this.log = options.log ?? (() => {});
    this.modules = options.modules;
    // generations this made that verify() has not yet compared with a cold
    // transpile of the same inputs
    this.unverified = new Set();
    // the same, on disk beside the generation (<hash>.warm.json), so a warm
    // generation found again later is still known to be unchecked
    this.swaps = 0;
  }

  get primed() {
    return this.reg !== undefined;
  }

  // Load the live generation's inputs into a registry and transpile them
  // once, which is what makes the next save cheap. Refuses unless the tree
  // on disk is the live generation's and the result reproduces its files.
  async prime() {
    const started = Date.now();
    this.reg = undefined;
    const root = this.root;
    const loaded = this.modules ?? hostModules() ?? modulesOf(root);
    const {Transpiler, core, plugin} = loaded;
    // a checkout's transpiler can be relinked under a running process; a
    // binary's is inside it
    this.transpilerFile = loaded.where === undefined ? undefined : join(loaded.where, "package.json");
    this.transpilerStat = this.transpilerFile === undefined ? undefined : statKey(this.transpilerFile);
    if (plugin !== undefined) {
      throw new NotWarm("a transpiler plugin is installed, and `only` is ignored with one");
    }
    const missing = await probe(Transpiler, core);
    if (missing !== undefined) {
      throw new NotWarm(missing);
    }
    const live = liveHash(root);
    if (live === undefined) {
      throw new NotWarm("there is no live generation to start from");
    }
    const {config, stack} = prepare(root);
    // the libraries are pinned clones and most of the inputs; a watcher per
    // library lets a build reuse their walk until something moves in one
    this.#watchLibraries(inputsOf(root, config).libs);
    const transpiler = String(describeBuild(root));
    const digests = new Map();
    const hash = hashOf(root, inputsOf(root, config), {digests, folders: this.folders, transpiler});
    if (hash !== live) {
      throw new NotWarm(`the tree is not the live generation (${hash} on disk, ${live} live); a cold build comes first`);
    }
    const paths = layout(root);
    // the output folder the source maps are relative to: the same depth as a
    // cold build's build/tmp/<hash>.<pid>/output, so the paths come out alike
    const own = ownConfig(root, config, stack, join(paths.tmp, "warm", "output"));
    if ((config.libs ?? []).some((l) => l.folder === undefined || l.folder === "" || !existsSync(root + l.folder))) {
      throw new NotWarm("a library is cloned from its URL rather than read from a folder");
    }
    const {wanted} = listFiles(root, own);
    const read = await readAll(wanted, resolve(root, own.output_folder));
    this.files = new Map(wanted.map((path, i) => [path, read[i]]));
    const libs = await loadLibs(root, own);
    const reg = new core.Registry();
    for (const f of this.files.values()) reg.addFile(new core.MemoryFile(f.filename, f.contents));
    for (const l of libs) reg.addDependency(new core.MemoryFile(l.filename, l.contents));
    const settings = {...own.options};
    if (own.write_source_map !== true) settings.ignoreSourceMap = true;
    const output = await new Transpiler(settings).run(reg);

    // the premise, checked rather than assumed: this registry gives the live
    // generation's bytes
    const liveOut = join(paths.byInput, live, "output");
    const differing = outputFiles(output, own, liveOut, [...this.files.values()])
      .filter((f) => !existsSync(f.path) || readFileSync(f.path, isBinaryFilename(f.path) ? "latin1" : "utf8") !== f.contents)
      .map((f) => basename(f.path));
    if (differing.length > 0) {
      throw new NotWarm(`a full run of the kept registry differs from the live generation in ${differing.length} files (${differing.slice(0, 3).join(", ")})`);
    }

    this.Transpiler = Transpiler;
    this.core = core;
    this.config = config;
    this.own = own;
    this.settings = settings;
    this.hash = live;
    this.identity = {config: readFileSync(layout(root).config, "utf8"), transpiler, generators: generatorIdentity(root)};
    this.amdpText = [...this.files.values()].filter((f) => AMDP.test(f.contents)).map((f) => f.contents).join("\n");
    this.pending = new Set();
    // a file's text in the registry, where it differs from the last
    // generation's (an edit the transpiler refused)
    this.held = new Map();
    this.digests = digests;
    this.reg = reg;
    this.#index();
    this.importers = importersOf(liveOut);
    this.wanted = rootsWanted(join(paths.byInput, live), config);
    this.log(`warm: primed ${this.files.size} files in ${Date.now() - started} ms`);
    return {ms: Date.now() - started, files: this.files.size, objects: output.objects.length};
  }

  // A library folder's walk is kept for as long as its watcher has heard
  // nothing. A folder whose watcher cannot be set up, or reports an error,
  // is walked every time, which is only slower.
  #watchLibraries(libs) {
    this.close();
    this.folders = new Map();
    this.watchers = [];
    const kept = new Set();
    for (const dir of libs) {
      try {
        const w = watch(dir, {recursive: true, persistent: false}, () => this.folders.delete(dir));
        w.on("error", () => {
          kept.delete(dir);
          this.folders.delete(dir);
        });
        this.watchers.push(w);
        kept.add(dir);
      } catch {
        // walked every time
      }
    }
    // only the watched folders are kept; the rest is forgotten after each use
    const folders = this.folders;
    const set = folders.set.bind(folders);
    folders.set = (dir, entries) => (kept.has(dir) ? set(dir, entries) : folders);
  }

  // What an edit of this object would rebuild: the object and, transitively,
  // everything that reads it, from the reverse index -- without building.
  // What the tests of an edit are (B1) is this list filtered to the classes
  // that carry tests. undefined when the registry is not primed or does not
  // hold the object.
  closureOf(type, name) {
    if (!this.primed) return undefined;
    const obj = this.reg.getObject(type, name);
    if (obj === undefined) return undefined;
    return [...this.#closure([obj])].map((o) => ({type: o.getType(), name: o.getName()}));
  }

  // Who reads this object directly, from the reverse index the last build
  // left: fresher than the seeded cross-reference, which a swap does not
  // reseed. undefined when the registry is not primed or does not hold it.
  readersOf(type, name) {
    if (!this.primed) return undefined;
    const obj = this.reg.getObject(type, name);
    if (obj === undefined) return undefined;
    return [...(this.readers.get(key(obj)) ?? [])].map((o) => ({type: o.getType(), name: o.getName()}));
  }

  // The issues the checked registry holds for these objects, with the line
  // and column of each, for a client that shows them on the dependent's own
  // file rather than as one "activation failed"
  #issuesOf(objects) {
    const out = [];
    for (const o of objects) {
      const issues = this.reg.findIssuesObject(o).map((i) => ({
        message: i.getMessage(), key: i.getKey(), severity: String(i.getSeverity?.() ?? "Error"),
        file: i.getFilename(), line: i.getStart().getRow(), column: i.getStart().getCol(),
      }));
      if (issues.length > 0) out.push({type: o.getType(), name: o.getName(), issues});
    }
    return out;
  }

  // forget the registry; the next build is cold, and prime() starts again
  drop() {
    this.reg = undefined;
    this.close();
  }

  close() {
    for (const w of this.watchers ?? []) w.close();
    this.watchers = [];
  }

  // who reads whom, from the scope references abaplint resolved
  #index(only) {
    const core = this.core;
    if (this.owner === undefined || only === undefined) {
      this.owner = new Map();
      for (const o of this.reg.getObjects()) for (const f of o.getFiles()) this.owner.set(f.getFilename(), o);
      this.reads = new Map();
      this.readers = new Map();
    }
    const objects = only === undefined ? [...this.reg.getObjects()] : only;
    for (const o of objects) {
      if (!(o instanceof core.ABAPObject)) continue;
      for (const t of this.reads.get(key(o)) ?? []) this.readers.get(t)?.delete(o);
      const reads = new Set();
      const top = new core.SyntaxLogic(this.reg, o).run().spaghetti?.getTop();
      const stack = top === undefined ? [] : [top];
      while (stack.length > 0) {
        const n = stack.pop();
        for (const r of n.getData().references) {
          const t = this.owner.get(r.resolved?.getFilename?.());
          if (t !== undefined && t !== o) reads.add(key(t));
        }
        stack.push(...n.getChildren());
      }
      this.reads.set(key(o), reads);
      for (const t of reads) {
        if (!this.readers.has(t)) this.readers.set(t, new Set());
        this.readers.get(t).add(o);
      }
    }
  }

  #closure(objects) {
    const set = new Set(objects);
    const todo = [...objects];
    while (todo.length > 0) {
      for (const r of this.readers.get(key(todo.pop())) ?? []) {
        if (!set.has(r)) {
          set.add(r);
          todo.push(r);
        }
      }
    }
    return set;
  }

  // what changed on disk since the registry was last brought in line with it,
  // and whether all of it may be built warm; throws NotWarm with the reason
  #changes() {
    const root = this.root;
    const {config, stack} = prepare(root);
    // the transpiler that builds this is the one loaded when it was primed;
    // one relinked on disk since would name a generation it did not build
    if (this.transpilerFile !== undefined && statKey(this.transpilerFile) !== this.transpilerStat) {
      throw new NotWarm("the transpiler on disk changed since the registry was primed");
    }
    const transpiler = this.identity.transpiler;
    const digests = new Map();
    const hash = hashOf(root, inputsOf(root, config), {digests, folders: this.folders, transpiler});
    // what the digests say changed, and what the registry holds ahead of the
    // generation (an edit refused, since reverted: the same digest again)
    const changed = [...new Set([...[...digests.keys()].filter((p) => this.digests.get(p) !== digests.get(p)), ...this.held.keys()])];
    for (const p of this.digests.keys()) {
      if (!digests.has(p)) throw new NotWarm(`${relative(root, p)} is gone`);
    }
    const identity = {config: readFileSync(layout(root).config, "utf8"), transpiler, generators: generatorIdentity(root)};
    for (const k of Object.keys(identity)) {
      if (identity[k] !== this.identity[k]) throw new NotWarm(`the ${k} changed`);
    }
    if (stack.duplicates.length > 0) throw new NotWarm("duplicates");
    const {wanted} = listFiles(root, this.own);
    const now = new Set(wanted);
    for (const path of wanted) if (!this.files.has(path)) throw new NotWarm(`${relative(root, path)} is new`);
    for (const path of this.files.keys()) if (!now.has(path)) throw new NotWarm(`${relative(root, path)} is gone`);
    const edits = [];
    for (const path of changed) {
      const known = this.files.get(path);
      if (known === undefined) {
        throw new NotWarm(`${relative(root, path)} changed, and it is not a source the transpiler reads`);
      }
      // the bytes the generation is named by are the bytes it is built from:
      // read once, and refused when a save landed between the hash and here
      const bytes = readFileSync(path);
      if (createHash("sha256").update(bytes).digest("hex") !== digests.get(path)) {
        throw new NotWarm(`${relative(root, path)} changed while it was read`);
      }
      const after = bytes.toString("utf8");
      // what the registry holds may be ahead of the last generation: an edit
      // the transpiler refused stays in it, and a revert of that edit is a
      // change to the registry although it is none to the generation
      const held = this.held.get(path) ?? known.contents;
      if (after === known.contents && after === held) continue;
      const reason = warmRule({path: relative(root, path), before: known.contents, after, amdpText: this.amdpText});
      if (reason !== undefined) throw new NotWarm(reason);
      edits.push({path, file: known, after, held});
    }
    return {hash, edits, digests, transpiler};
  }

  // The build: the edited objects and their readers, into a generation of
  // the new inputs' name, under the build lock from the first read to the
  // switch. Throws NotWarm when the change is not one this may build (the
  // caller builds cold, and drops the registry); throws an Error with
  // `check: true` and `output` when the transpiler refuses the change, and
  // then nothing is switched and the registry keeps the edit to build with
  // the next save. What this knows about the tree -- the files' contents, the
  // digests, the live hash -- changes only once the new generation is live.
  async build() {
    const started = Date.now();
    if (!this.primed) throw new NotWarm("not primed");
    const root = this.root;
    const paths = layout(root);
    // a cold build holding the lock is refused with BUSY and nothing changed
    const unlock = lock(paths);
    let settled = false;
    try {
      const from = liveHash(root);
      if (from !== this.hash) {
        throw new NotWarm(`the live generation moved under the warm registry (${from}, not ${this.hash})`);
      }
      const marks = [];
      const mark = (what) => marks.push([what, Date.now()]);
      mark("start");
      const {hash, edits, digests, transpiler} = this.#changes();
      mark("changes");
      const changed = [];
      for (const {path, file, after, held} of edits) {
        if (after !== held) {
          this.reg.updateFile(new this.core.MemoryFile(file.filename, after));
          this.held.set(path, after);
        }
        changed.push(this.owner.get(file.filename));
      }
      const commit = () => {
        for (const {path, file, after} of edits) {
          file.contents = after;
          this.held.delete(path);
        }
        this.digests = digests;
        this.pending = new Set();
      };
      const stale = this.#closure([...changed, ...this.pending]);
      if (hash === from && stale.size === 0) {
        commit();
        settled = true;
        return {ok: true, hash, cached: true, warm: true, live: true, ms: Date.now() - started, modules: [], hostHeld: [], stale: 0, from};
      }
      const names = new Set([...stale].map(key));
      let output;
      try {
        output = await new this.Transpiler({...this.settings, only: (o) => names.has(key(o))}).run(this.reg);
      } catch (error) {
        // the registry holds the edit and the rest stays as it was, so the
        // next save sees this file as changed again and builds all of it
        this.pending = stale;
        error.check = true;
        error.output = String(error.message);
        error.issues = this.#issuesOf([...stale]);
        settled = true;
        throw error;
      }
      mark("transpile");
      this.#index([...stale]);
      mark("index");

      // the modules this replaces, and the check that nothing else holds one
      const liveOut = join(paths.byInput, from, "output");
      const written = outputFiles(output, this.own, liveOut, [...this.files.values()]);
      // the modules a serving process loads: not the scripts, and not the test
      // classes, which only a unit run imports
      const modules = written.map((f) => basename(f.path))
        .filter((f) => f.endsWith(".mjs") && !SCRIPTS.has(f) && !f.endsWith(".testclasses.mjs"));
      const refusal = importerRefusal(this.importers, written.map((f) => basename(f.path)));
      if (refusal !== undefined) throw new NotWarm(refusal);
      mark("outputs");

      const target = join(paths.byInput, hash);
      // a generation a cold transpile was found to differ from is never
      // taken again: it is built anew (it cannot be the live one here, which
      // the store has rebuilt cold)
      if (hash !== from && warmDiffers(target)) {
        rmSync(target, {recursive: true, force: true});
        rmSync(`${target}.warm.json`, {force: true});
      }
      let cached = existsSync(join(target, "manifest.json"));
      // the roots the modules name: the live generation's, and whatever a
      // rebuilt module names that it did not
      const wanted = new Set(this.wanted);
      for (const f of written) {
        for (const m of f.contents.matchAll(/["'`]\.\.\/([^/"'`]+)\//g)) wanted.add(m[1]);
      }
      if (!cached) {
        const tmp = join(paths.tmp, `${hash}.${process.pid}.warm`);
        try {
          rmSync(tmp, {recursive: true, force: true});
          mkdirSync(join(tmp, "output"), {recursive: true});
          const replaced = new Set(written.map((f) => basename(f.path)));
          for (const f of readdirSync(liveOut)) {
            if (!replaced.has(f)) linkSync(join(liveOut, f), join(tmp, "output", f));
          }
          for (const f of written) {
            writeFileSync(join(tmp, "output", basename(f.path)), f.contents, isBinaryFilename(f.path) ? {encoding: "latin1"} : undefined);
          }
          linkSync(join(paths.byInput, from, "abap_transpile.json"), join(tmp, "abap_transpile.json"));
          // the manifest a cold build of these inputs writes: the same fields in
          // the same order, so the comparison in verify() is of the output
          const manifest = JSON.parse(readFileSync(join(paths.byInput, from, "manifest.json"), "utf8"));
          writeFileSync(join(tmp, "manifest.json"), JSON.stringify({
            hash, builtAt: new Date().toISOString(), ms: Date.now() - started, objects: manifest.objects,
            transpiler, inputs: manifest.inputs, gen: manifest.gen, overridden: manifest.overridden,
          }, null, 2));
          linkRoots(root, tmp, this.config, undefined, {wanted});
          mkdirSync(paths.byInput, {recursive: true});
          // the note first: a generation must never be on disk under its name
          // without saying that nobody has compared it yet
          writeFileSync(`${target}.warm.json`, JSON.stringify({hash, from, builtAt: new Date().toISOString(), verified: false}, null, 2));
          renameSync(tmp, target);
        } catch (error) {
          rmSync(tmp, {recursive: true, force: true});
          throw error;
        }
      }
      mark("generation");
      if (warmVerdict(target) === false) this.unverified.add(hash);
      switchTo(root, hash, undefined, {wanted});
      mark("switch");
      commit();
      this.hash = hash;
      this.wanted = wanted;
      for (const m of written.map((f) => basename(f.path)).filter((f) => f.endsWith(".mjs") && !SCRIPTS.has(f))) {
        const text = readFileSync(join(target, "output", m), "utf8");
        for (const set of this.importers.values()) set.delete(m);
        for (const t of importsOf(text)) {
          if (!this.importers.has(t)) this.importers.set(t, new Set());
          this.importers.get(t).add(m);
        }
      }
      // the init script's order is the order modules can be loaded in
      const init = readFileSync(join(target, "output", "init.mjs"), "utf8");
      const order = new Map(importsOf(init).map((m, i) => [m, i]));
      modules.sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || a.localeCompare(b));
      mark("importers");
      settled = true;
      const steps = Object.fromEntries(marks.slice(1).map(([w, t], i) => [w, t - marks[i][1]]));
      return {ok: true, hash, cached, warm: true, live: true, ms: Date.now() - started, objects: this.files.size,
        modules, hostHeld: modules.filter((m) => HOST_HELD.includes(m)), stale: stale.size, from, steps,
        closure: [...stale].map((o) => ({type: o.getType(), name: o.getName()}))};
    } finally {
      unlock();
      // anything that went wrong after the registry took the edit, other than
      // the transpiler's refusal, leaves nothing this can trust: prime again
      if (!settled && this.reg !== undefined) {
        this.drop();
      }
    }
  }

  // Compare a generation this made with a cold transpile of the same inputs,
  // in a child process so nobody waits for it. Inconclusive when the tree
  // changed while it ran.
  verify(hash) {
    return new Promise((done) => {
      const [cmd, ...args] = toolCommand(join(TOOLS, "osd-warm.mjs"), ["verify", hash]);
      const child = spawn(cmd, args, {cwd: this.root, env: {...process.env, OSD_ROOT: this.root}, stdio: ["ignore", "pipe", "pipe"]});
      this.verifying = child;
      let out = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { out += d; });
      child.on("exit", (code) => {
        this.verifying = undefined;
        let result;
        try {
          result = JSON.parse(out.trim().split("\n").pop());
        } catch {
          result = {verdict: "failed", code, output: out.slice(-2000)};
        }
        if (result.verdict === "same") {
          this.unverified.delete(hash);
          const side = join(layout(this.root).byInput, `${hash}.warm.json`);
          if (existsSync(side)) writeFileSync(side, JSON.stringify({...JSON.parse(readFileSync(side, "utf8")), verified: true, verifiedAt: new Date().toISOString()}, null, 2));
        }
        done(result);
      });
    });
  }
}

// the verify child: a cold transpile of the tree into a scratch folder,
// compared with the generation of the same name
async function verifyMain(hash) {
  const root = resolve(process.env.OSD_ROOT ?? process.cwd());
  const paths = layout(root);
  const {compareGenerations} = await import("./osd-generation-diff.mjs");
  const {transpile} = await import("./osd-transpile.mjs");
  const {config, stack} = prepare(root);
  if (hashOf(root, inputsOf(root, config)) !== hash) {
    return {verdict: "inconclusive", why: "the tree is not that generation any more"};
  }
  const tmp = join(paths.tmp, `${hash}.${process.pid}.verify`);
  try {
    rmSync(tmp, {recursive: true, force: true});
    mkdirSync(join(tmp, "output"), {recursive: true});
    const started = Date.now();
    await transpile({root, config: ownConfig(root, config, stack, join(tmp, "output"))});
    if (hashOf(root, inputsOf(root, config)) !== hash) {
      return {verdict: "inconclusive", why: "the tree changed while it was compared"};
    }
    const v = compareGenerations(join(paths.byInput, hash, "output"), join(tmp, "output"));
    const differing = [...v.differing, ...v.onlyInA, ...v.onlyInB];
    return {verdict: differing.length === 0 ? "same" : "differs", files: v.files, differing: differing.slice(0, 20),
      count: differing.length, ms: Date.now() - started};
  } finally {
    rmSync(tmp, {recursive: true, force: true});
  }
}

if (runsAs("osd-warm.mjs") && process.argv[2] === "verify") {
  verifyMain(process.argv[3]).then((r) => {
    console.log(JSON.stringify(r));
    process.exit(0);
  }, (error) => {
    console.log(JSON.stringify({verdict: "failed", output: String(error?.stack ?? error)}));
    process.exit(1);
  });
}
