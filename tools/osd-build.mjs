// A generation: the transpiled system, built to the side, named by what
// went into it, made live by renaming a link.
//
// Why this exists: `npm run transpile` used to do `rm -rf output` and then
// build into the hole. A build that failed left the hole. The process that
// was serving survived, because its modules were already loaded, and the
// next recycle or restart did not, because there was nothing left to load.
// So a bad save could quietly turn a working system into one that would not
// come back up, and nobody found out until it did not.
//
// Here a build never touches anything that is live. It goes into a
// directory of its own under build/tmp, and only a complete one is renamed
// into build/by-input/<hash>, where <hash> is the sha256 of every input:
// the files in the input folders, the library trees, the config, and which
// transpiler did the work. The same inputs give the same name, so a rebuild
// with nothing changed costs nothing, and a transpiler upgrade is a new
// generation, as it should be. `build/live` is a symlink to the generation
// that serves, and `output/` at the root is a symlink to `build/live/output`,
// so the runtime child, which reads OSD_ROOT/output and nothing else, is
// switched by one rename and knows nothing about any of this.
//
// Measured before deciding: hashing every input by content is 105 ms for
// this tree and 170 ms for the largest library, so the hash is computed on
// every build and nobody has to reason about mtimes or commits. A
// generation is 44 MB; keeping the last few is cheap. docs/generations.md
// is the design this implements.
import {createHash} from "node:crypto";
import {compareGenerations} from "./osd-generation-diff.mjs";
import {execFileSync, spawnSync} from "node:child_process";
import {existsSync, lstatSync, mkdirSync, openSync, closeSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync} from "node:fs";
import {basename, dirname, join, relative, resolve, resolve as resolvePath} from "node:path";
import {fileURLToPath} from "node:url";
import {describeBuild} from "./osd-transpiler.mjs";
import {describeDuplicates, excludePatterns, layers} from "./osd-inputs.mjs";
import {transpile} from "./osd-transpile.mjs";
import {inputFoldersOf} from "./osd-packs.mjs";
import {describeUnfetched, unfetched} from "./osd-fetch.mjs";
import {toolCommand} from "./osd-host.mjs";

// the tools this build runs before the transpiler, in the order the old npm
// script ran them; each writes its part of gen/ and says so
const GENERATORS = [
  ["osd-transpiler.mjs"],
  ["osd-inputs.mjs"],
  ["cds2ddic.mjs"],
  ["stg-compile.mjs", "--all"],
  ["segw-registry.mjs"],
  ["segw-shlp.mjs"],
  // AMDP: the bodies the transpiler cannot compile become routed calls, and
  // the SQLScript is put aside for HANA (docs/amdp-in-hana.md). Before the
  // function-module registry, because the modules it writes are what that
  // registry has to see.
  ["amdp-gen.mjs"],
  // and then the CDS table functions are checked against the methods that
  // implement them: the `returns` list is the authority and a mismatch fails
  // the build, because filling columns by position quietly is worse than not
  // building at all
  ["amdp-tablefunc.mjs"],
  ["osd-fm-registry.mjs"],
  ["osd-tran-registry.mjs"],
];

const TOOLS = fileURLToPath(new URL(".", import.meta.url));

export function layout(root) {
  const build = join(root, "build");
  return {
    root,
    build,
    byInput: join(build, "by-input"),
    tmp: join(build, "tmp"),
    live: join(build, "live"),
    lock: join(build, ".lock"),
    output: join(root, "output"),
    config: join(root, "abap_transpile.json"),
  };
}

// the config as the transpiler reads it: its own loader, because the file
// carries comments the JSON parser refuses, and it is the transpiler's file
export function loadConfig(root) {
  // the CLI's loader does exactly this (transpiler-cli/build/config.js:
  // parse the file when there is one, defaults when there is not), and it
  // was the last thing in the build path that reached the CLI package —
  // from inside a binary through the tree's node_modules, which is where
  // the SP4 binary first fell over
  const file = layout(root).config;
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, "utf8"));
  }
  return {
    input_folder: "src",
    input_filter: [],
    output_folder: "output",
    libs: [{url: "https://github.com/open-abap/open-abap-core"}],
    write_unit_tests: true,
    write_source_map: true,
    options: {ignoreSyntaxCheck: false, addFilenames: true, addCommonJS: true, unknownTypes: "compileError"},
  };
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, {withFileTypes: true});
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") {
      continue;
    }
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      walk(p, out);
    } else if (e.isFile()) {
      out.push(p);
    }
  }
  return out;
}

// what a generation is made of, and the hash that names it
export function inputsOf(root, config = loadConfig(root)) {
  const folders = inputFoldersOf(root, config).map((f) => join(root, f)).filter(existsSync);
  const libs = (config.libs ?? []).map((l) => l.folder).filter((f) => f !== undefined && f !== "").map((f) => join(root, f));
  return {folders, libs, config: layout(root).config};
}

// What the transpiler and the generators read, and nothing else: a mocha
// test or a note beside the ABAP is not an input, and a hash that counted
// it would spend ten seconds building the same output again after an edit
// to a .mjs. Everything in an input folder counts except these.
const NOT_AN_INPUT = /\.(mjs|cjs|js|ts|py|md|txt|log|lock|snap)$/i;

/**
 * The modules that decide what `gen/` will contain: the generators and
 * everything they import, transitively.
 *
 * **`gen/` used to be in the hash as a stand-in for these, and a stand-in
 * written by the build is a self-reference.** `NOT_AN_INPUT` excludes
 * `.mjs`, so a generator's own code was not an input while its output was --
 * the hash watched the representative and not the thing represented. The
 * cost was visible: two builds of a fresh tree, with no edit between them,
 * produced two different generation names, because the first wrote `gen/`
 * and the second hashed it (measured 2026-09-19, and osg-osd-i7 measured the
 * same from the other side).
 *
 * So the representative goes and the thing represented arrives. 27 of the 92
 * modules in `tools/` are in the closure, which is why it is computed rather
 * than approximated by "all of them": editing a tool that no generator
 * reaches should not rename every generation.
 */
export function generatorClosure(toolsDir = TOOLS, generators = GENERATORS) {
  const seen = new Set();
  const walk = (file) => {
    const abs = resolvePath(file);
    if (seen.has(abs) || !existsSync(abs)) return;
    seen.add(abs);
    const text = readFileSync(abs, "utf8");
    for (const m of text.matchAll(/from\s+"(\.[^"]+)"/g)) walk(join(dirname(abs), m[1]));
    for (const m of text.matchAll(/import\("(\.[^"]+)"\)/g)) walk(join(dirname(abs), m[1]));
  };
  for (const [script] of generators) walk(join(toolsDir, script));
  return [...seen].sort();
}

/** the generators, in order, writing into the working `gen/` as they always do */
export function runGenerators(root, log = () => {}) {
  let output = "";
  for (const [script, ...args] of GENERATORS) {
    log(`${script} ${args.join(" ")}`.trim());
    const [cmd, ...argv] = toolCommand(join(TOOLS, script), args);
    output += run(cmd, argv, root);
  }
  return output;
}

/** what `gen/` holds right now, by content: 196 files, milliseconds */
export function genHash(root) {
  const dir = join(root, "gen");
  if (!existsSync(dir)) return "";
  const h = createHash("sha256");
  for (const f of walk(dir).sort()) {
    h.update(relative(root, f)).update("\0").update(readFileSync(f)).update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

export function hashOf(root, inputs = inputsOf(root)) {
  const h = createHash("sha256");
  h.update("transpiler\0").update(String(describeBuild(root))).update("\0");
  // the rule that decides a name held by two inputs is part of what the
  // output is: a generation built under another rule is another generation
  h.update("layers\0later-wins\0");
  h.update("config\0").update(readFileSync(inputs.config)).update("\0");
  for (const dir of [...inputs.folders, ...inputs.libs]) {
    // **`gen/` is an OUTPUT and is left out.** It is written by this build
    // from the folders above and the generators below, so hashing it made
    // the name a function of the tree AND of how many times the tree had
    // been built. What decides its content is hashed instead.
    if (relative(root, dir) === "gen") continue;
    const files = existsSync(dir) ? walk(dir).filter((f) => !NOT_AN_INPUT.test(f)).sort() : [];
    h.update(`dir ${relative(root, dir)} ${files.length}\0`);
    for (const f of files) {
      h.update(relative(root, f)).update("\0").update(readFileSync(f)).update("\0");
    }
  }
  // the generators and their transitive imports: the thing `gen/` stood for
  const closure = generatorClosure();
  h.update(`generators ${closure.length}\0`);
  for (const f of closure) {
    h.update(relative(root, f)).update("\0").update(readFileSync(f)).update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

// one build at a time: the generators write gen/ at the root, and two of
// them at once would race over it. A stale lock from a process that died is
// taken over, not obeyed.
function lock(paths) {
  mkdirSync(paths.build, {recursive: true});
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(paths.lock, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try {
          unlinkSync(paths.lock);
        } catch {
          // already gone
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      const pid = Number(readFileSync(paths.lock, "utf8"));
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
      if (alive) {
        const e = new Error(`a build is already running (pid ${pid})`);
        e.code = "BUSY";
        throw e;
      }
      unlinkSync(paths.lock);
    }
  }
  throw new Error("could not take the build lock");
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {cwd, encoding: "utf8", maxBuffer: 64 << 20});
  const output = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.status !== 0) {
    const e = new Error(`${basename(cmd)} ${args.join(" ")} exited ${r.status ?? r.signal}`);
    e.code = "FAILED";
    e.output = output;
    throw e;
  }
  return output;
}


// The transpiled modules reach outside output/ for one thing: the setup
// hook the config names as "../test/setup.mjs" (and whatever else a config
// may point at with "../"). Node resolves a relative import from the real
// path of the importing file, not through the symlink at the root, so from
// build/by-input/<hash>/output that path lands beside the generation, where
// nothing is. A relative symlink per such directory makes the generation
// self-contained in the way the old output/ was by accident of sitting at
// the root. Idempotent, and run on switch as well as on build, so a
// generation made before this existed gets its links the first time it
// goes live.
export function linkRoots(root, generation, config = loadConfig(root), log = () => {}) {
  const wanted = new Set();
  const setup = config.options?.setup?.filename;
  if (typeof setup === "string") {
    const m = /^\.\.\/([^/]+)/.exec(setup);
    if (m) {
      wanted.add(m[1]);
    }
  }
  const out = join(generation, "output");
  for (const f of existsSync(out) ? readdirSync(out).filter((n) => n.endsWith(".mjs")).slice(0, 4000) : []) {
    const text = readFileSync(join(out, f), "utf8");
    for (const m of text.matchAll(/["'`]\.\.\/([^/"'`]+)\//g)) {
      wanted.add(m[1]);
    }
  }
  for (const name of wanted) {
    // a string that merely looks like a path ("../sap/bc/…" in a literal)
    // names nothing at the root, and a link to nothing is worse than none
    if (!existsSync(join(root, name)) || !statSync(join(root, name)).isDirectory()) {
      wanted.delete(name);
      continue;
    }
    const link = join(generation, name);
    const target = relative(generation, join(root, name));
    let kind;
    try {
      kind = lstatSync(link);
    } catch {
      kind = undefined;
    }
    if (kind === undefined) {
      symlinkSync(target, link);
      log(`${basename(generation)}/${name} -> ${target}`);
    }
  }
  return [...wanted];
}

export function liveHash(root) {
  // a store that is not over a tree (a test's stand-in) has no generation
  if (root === undefined || root === null || root === "") {
    return undefined;
  }
  const paths = layout(root);
  try {
    return basename(readlinkSync(paths.live));
  } catch {
    return undefined;
  }
}

export function generations(root) {
  const paths = layout(root);
  if (!existsSync(paths.byInput)) {
    return [];
  }
  const live = liveHash(root);
  return readdirSync(paths.byInput)
    .map((hash) => {
      try {
        const manifest = JSON.parse(readFileSync(join(paths.byInput, hash, "manifest.json"), "utf8"));
        return {...manifest, hash, live: hash === live};
      } catch {
        return undefined;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.builtAt).localeCompare(String(b.builtAt)));
}

// point live at a generation, and output at live. Two renames, each atomic;
// nothing between them is a state a reader can see as "no output".
export function switchTo(root, hash, log = () => {}) {
  const paths = layout(root);
  const target = join(paths.byInput, hash);
  if (!existsSync(join(target, "output"))) {
    const e = new Error(`generation ${hash} is not built`);
    e.code = "NOT_BUILT";
    throw e;
  }
  linkRoots(root, target, undefined, log);
  const tmpLink = paths.live + ".tmp";
  try {
    unlinkSync(tmpLink);
  } catch {
    // nothing to remove
  }
  symlinkSync(join("by-input", hash), tmpLink);
  renameSync(tmpLink, paths.live);

  // output/ at the root: a symlink to build/live/output. A real directory
  // there is what every tree had before this existed; it is moved aside once
  // and reclaimed by gc, never deleted underneath a process that may still
  // be loading from it.
  let kind;
  try {
    kind = lstatSync(paths.output);
  } catch {
    kind = undefined;
  }
  if (kind !== undefined && !kind.isSymbolicLink()) {
    const aside = join(paths.build, `legacy-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    renameSync(paths.output, aside);
    log(`output/ was a directory: moved to ${relative(root, aside)}`);
    kind = undefined;
  }
  if (kind === undefined) {
    symlinkSync(join("build", "live", "output"), paths.output);
  }
  log(`live -> ${hash}`);
  return hash;
}

// the build: hash, then either the cached generation or a fresh one to the
// side, then the switch. Every failure leaves live untouched.
export async function build(options = {}) {
  const root = resolve(options.root ?? process.env.OSD_ROOT ?? process.cwd());
  const log = options.log ?? (() => {});
  const paths = layout(root);
  const started = Date.now();
  const config = loadConfig(root);
  // the layers, resolved before anything else (tools/osd-inputs.mjs): the
  // same file name twice inside one folder is a refusal naming both files,
  // never a guess, and it is refused before a lock is taken or a generator
  // runs; an object an earlier layer hides is said, and hidden below
  // a pack that fetches a folder and has not: a smaller system than the
  // manifest describes, refused before it is built (tools/osd-fetch.mjs)
  const missing = unfetched(root);
  if (missing.length > 0) {
    const e = new Error(`the build refuses: ${describeUnfetched(missing)}`);
    e.code = "UNFETCHED";
    e.missing = missing;
    throw e;
  }
  const stack = layers(root, config);
  if (stack.duplicates.length > 0) {
    const e = new Error(`the build refuses: ${describeDuplicates(stack.duplicates)}`);
    e.code = "DUPLICATE";
    e.duplicates = stack.duplicates;
    throw e;
  }
  for (const {object, winner, hidden} of stack.overridden) {
    log(`overridden: ${object}: ${hidden.join(", ")} hidden by ${winner}`);
  }
  const inputs = inputsOf(root, config);
  const hash = hashOf(root, inputs);
  const target = join(paths.byInput, hash);

  if (options.force !== true && existsSync(join(target, "manifest.json"))) {
    const manifest = JSON.parse(readFileSync(join(target, "manifest.json"), "utf8"));
    // **A cache hit must not leave `gen/` holding somebody else's edit.**
    // The generation is reused because the INPUTS match; `gen/` is an output
    // and is written by the generators, which a cache hit skips. If what is
    // on disk is not what this generation was made from, the generators run
    // again -- the transpile still does not.
    if (manifest.gen !== undefined && manifest.gen !== genHash(root)) {
      log(`generation ${hash} is already built, but gen/ has drifted from it -- regenerating`);
      const unlockAgain = lock(paths);
      try {
        runGenerators(root, log);
      } finally {
        unlockAgain();
      }
    } else {
      log(`generation ${hash} is already built`);
    }
    if (options.switch !== false && liveHash(root) !== hash) {
      switchTo(root, hash, log);
    }
    return {ok: true, hash, cached: true, live: liveHash(root) === hash, ms: Date.now() - started, objects: manifest.objects};
  }

  const unlock = lock(paths);
  const tmp = join(paths.tmp, `${hash}.${process.pid}`);
  let output = "";
  try {
    rmSync(tmp, {recursive: true, force: true});
    mkdirSync(join(tmp, "output"), {recursive: true});
    // the same config, aimed at this build's own directory. The path is
    // root-relative because the transpiler joins it to its working directory.
    // The transpiler is handed the winner of every name only: a class in two
    // inputs is "already defined" to it, not an override, so the files an
    // earlier layer hides are kept from it here
    const own = {
      ...config,
      // the packs are layers of this build, so the transpiler is handed them
      // with the tree's own folders (backlog E.2)
      input_folder: inputFoldersOf(root, config),
      output_folder: relative(root, join(tmp, "output")),
      exclude_filter: [...(config.exclude_filter ?? []), ...excludePatterns(stack.hidden)],
    };
    writeFileSync(join(tmp, "abap_transpile.json"), JSON.stringify(own, null, 2));

    output += runGenerators(root, log);
    // the transpile itself is a library call in this process (N3,
    // tools/osd-transpile.mjs): no node_modules/.bin, no second process,
    // no parsing a count out of its output
    log("transpile");
    const made = await transpile({root, config: own, log: (m) => { output += m + "\n"; }});
    const objects = made.objects;

    const manifest = {
      hash,
      builtAt: new Date().toISOString(),
      ms: Date.now() - started,
      objects,
      transpiler: describeBuild(root),
      inputs: {folders: inputs.folders.map((f) => relative(root, f)), libs: inputs.libs.map((f) => relative(root, f))},
      // What `gen/` held when this generation was made. `gen/` is an OUTPUT
      // and is out of the hash (it used to be in it, which made the name
      // self-referential) -- and taking it out removed an accidental
      // protection: a cache hit skips the generators, so `gen/` on disk can
      // be left holding a previous edit's output while `src/` says
      // otherwise. Measured: edit a view, build, restore the source, build
      // again -- the second build reuses the generation and three files
      // under `gen/` still hold the edit (2026-09-19). The served system is
      // right; the working tree is not, and the next thing to read `gen/`
      // believes it.
      gen: genHash(root),
      overridden: stack.overridden,
    };
    writeFileSync(join(tmp, "manifest.json"), JSON.stringify(manifest, null, 2));
    // **The generation's own copy of the config described the process that
    // made it.** `output_folder` held the build's tmp path, pid and all, so
    // two builds of one generation differed in exactly one of 2249 files --
    // and the difference was a process id. An artefact addressed by the hash
    // of its inputs must not carry the number of the process that wrote it.
    // Nothing reads this copy after the build (every reader takes the root's
    // one), so it is rewritten to describe ITSELF: the output is at `output`,
    // relative to the generation (2026-09-19, B.9).
    writeFileSync(join(tmp, "abap_transpile.json"),
      JSON.stringify({...own, output_folder: "output"}, null, 2));
    linkRoots(root, tmp, config, log);

    mkdirSync(paths.byInput, {recursive: true});
    if (existsSync(target) && options.force === true) {
      // **Build, compare, report -- never both keep the name and change the
      // bytes** (backlog B.9). A generation is addressed by the hash of its
      // inputs so that a name means one set of bytes; a forced build that
      // replaced the directory gave a consumer pinned to `<hash>` different
      // content under an unchanged name, which is the thing immutability was
      // for.
      const verdict = compareGenerations(target, tmp);
      if (verdict.same) {
        log(`generation ${hash} rebuilt byte for byte: ${verdict.files} files` +
          (verdict.collapsed.length > 0 ? `, after ${verdict.collapsed.join("; ")}` : ""));
        rmSync(tmp, {recursive: true, force: true});
      } else if (options.replace === true) {
        // asked for, in so many words. Two renames rather than a remove and
        // a rename, so there is no moment at which the live link points at
        // nothing.
        const changed = [...verdict.differing, ...verdict.onlyInA, ...verdict.onlyInB];
        log(`generation ${hash} REPLACED, ${changed.length} files differ: ${changed.slice(0, 5).join(", ")}`);
        const replaced = `${target}.replaced.${process.pid}`;
        renameSync(target, replaced);
        renameSync(tmp, target);
        rmSync(replaced, {recursive: true, force: true});
      } else {
        // The interesting case, and it is a FINDING rather than a nuisance:
        // the same inputs produced different output, so the transpiler or the
        // builder changed under them. Saying so is the point; overwriting
        // would hide it.
        const changed = [...verdict.differing, ...verdict.onlyInA, ...verdict.onlyInB];
        rmSync(tmp, {recursive: true, force: true});
        const error = new Error(
          `generation ${hash} is NOT reproducible: ${changed.length} of ${verdict.files} files differ ` +
          `(${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", …" : ""}). The same inputs gave ` +
          "different output, so the transpiler or the builder changed under them -- which is a finding, " +
          "not a nuisance. Nothing was overwritten: a name that keeps its bytes is what a generation is " +
          "for. Pass --replace to take the new bytes under the same name anyway.");
        error.notReproducible = {hash, changed, files: verdict.files};
        throw error;
      }
    } else if (existsSync(target)) {
      // a build of the same inputs finished while this one ran (a race the
      // lock did not cover); theirs is as good as ours
      rmSync(tmp, {recursive: true, force: true});
    } else {
      renameSync(tmp, target);
    }
    if (options.switch !== false) {
      switchTo(root, hash, log);
    }
    return {ok: true, hash, cached: false, live: liveHash(root) === hash, ms: manifest.ms, objects, output: options.verbose ? output : undefined};
  } catch (error) {
    rmSync(tmp, {recursive: true, force: true});
    error.output = (error.output ?? "") || output;
    throw error;
  } finally {
    unlock();
  }
}

// keep the live generation and the newest N; drop the rest, every leftover
// tmp, and the directories moved aside by the first switch
export function gc(root, options = {}) {
  const paths = layout(root);
  const keep = options.keep ?? 5;
  const live = liveHash(root);
  const removed = [];
  const all = generations(root).reverse(); // newest first
  for (const g of all.slice(keep)) {
    if (g.hash === live) {
      continue;
    }
    rmSync(join(paths.byInput, g.hash), {recursive: true, force: true});
    removed.push(g.hash);
  }
  if (existsSync(paths.tmp)) {
    for (const e of readdirSync(paths.tmp)) {
      rmSync(join(paths.tmp, e), {recursive: true, force: true});
      removed.push(`tmp/${e}`);
    }
  }
  if (existsSync(paths.build)) {
    for (const e of readdirSync(paths.build)) {
      if (e.startsWith("legacy-")) {
        rmSync(join(paths.build, e), {recursive: true, force: true});
        removed.push(e);
      }
    }
  }
  return removed;
}

export async function main(args) {
  const root = process.env.OSD_ROOT ?? process.cwd();
  const say = (m) => console.log(`osd-build: ${m}`);
  const cmd = args.find((a) => !a.startsWith("--")) ?? "build";
  if (cmd === "list") {
    const all = generations(root);
    if (all.length === 0) {
      say("no generations yet");
    }
    for (const g of all) {
      say(`${g.live ? "*" : " "} ${g.hash}  ${g.builtAt}  ${g.objects} objects  ${g.ms} ms`);
    }
    return 0;
  }
  if (cmd === "switch") {
    const hash = args[args.indexOf("switch") + 1];
    switchTo(root, hash, say);
    return 0;
  }
  if (cmd === "gc") {
    const at = args.indexOf("--keep");
    const removed = gc(root, {keep: at >= 0 ? Number(args[at + 1]) : undefined});
    say(removed.length === 0 ? "nothing to remove" : `removed ${removed.join(", ")}`);
    return 0;
  }
  if (cmd === "hash") {
    say(hashOf(root));
    return 0;
  }
  try {
    const r = await build({root, force: args.includes("--force"), replace: args.includes("--replace"),
      switch: !args.includes("--no-switch"), log: say});
    say(`${r.cached ? "reused" : "built"} ${r.hash} in ${r.ms} ms, ${r.objects} objects${r.live ? ", live" : ""}`);
    return 0;
  } catch (error) {
    say(`${error.code ?? "FAILED"}: ${error.message}`);
    if (error.output) {
      console.error(String(error.output).slice(-3000));
    }
    say("live generation untouched");
    return 1;
  }
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
