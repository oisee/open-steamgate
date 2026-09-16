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
import {createRequire} from "node:module";
import {execFileSync, spawnSync} from "node:child_process";
import {existsSync, lstatSync, mkdirSync, openSync, closeSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync} from "node:fs";
import {basename, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {describeBuild} from "./osd-transpiler.mjs";

// the tools this build runs before the transpiler, in the order the old npm
// script ran them; each writes its part of gen/ and says so
const GENERATORS = [
  ["osd-transpiler.mjs"],
  ["osd-inputs.mjs"],
  ["cds2ddic.mjs"],
  ["stg-compile.mjs", "--all"],
  ["segw-registry.mjs"],
  ["segw-shlp.mjs"],
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
  const require = createRequire(join(root, "package.json"));
  const {TranspilerConfig} = require("@abaplint/transpiler-cli/build/config.js");
  const before = process.cwd();
  try {
    process.chdir(root);
    return TranspilerConfig.find(undefined);
  } finally {
    process.chdir(before);
  }
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
  const folders = (config.input_folder ?? []).map((f) => join(root, f)).filter(existsSync);
  const libs = (config.libs ?? []).map((l) => l.folder).filter((f) => f !== undefined && f !== "").map((f) => join(root, f));
  return {folders, libs, config: layout(root).config};
}

export function hashOf(root, inputs = inputsOf(root)) {
  const h = createHash("sha256");
  h.update("transpiler\0").update(String(describeBuild(root))).update("\0");
  h.update("config\0").update(readFileSync(inputs.config)).update("\0");
  for (const dir of [...inputs.folders, ...inputs.libs]) {
    const files = existsSync(dir) ? walk(dir).sort() : [];
    h.update(`dir ${relative(root, dir)} ${files.length}\0`);
    for (const f of files) {
      h.update(relative(root, f)).update("\0").update(readFileSync(f)).update("\0");
    }
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

function transpilerBin(root) {
  const local = join(root, "node_modules", ".bin", "abap_transpile");
  return existsSync(local) ? [local, []] : ["npx", ["abap_transpile"]];
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
  const inputs = inputsOf(root, config);
  const hash = hashOf(root, inputs);
  const target = join(paths.byInput, hash);

  if (options.force !== true && existsSync(join(target, "manifest.json"))) {
    log(`generation ${hash} is already built`);
    if (options.switch !== false && liveHash(root) !== hash) {
      switchTo(root, hash, log);
    }
    const manifest = JSON.parse(readFileSync(join(target, "manifest.json"), "utf8"));
    return {ok: true, hash, cached: true, live: liveHash(root) === hash, ms: Date.now() - started, objects: manifest.objects};
  }

  const unlock = lock(paths);
  const tmp = join(paths.tmp, `${hash}.${process.pid}`);
  let output = "";
  try {
    rmSync(tmp, {recursive: true, force: true});
    mkdirSync(join(tmp, "output"), {recursive: true});
    // the same config, aimed at this build's own directory. The path is
    // root-relative because the transpiler joins it to its working directory
    const own = {...config, output_folder: relative(root, join(tmp, "output"))};
    writeFileSync(join(tmp, "abap_transpile.json"), JSON.stringify(own, null, 2));

    for (const [script, ...args] of GENERATORS) {
      log(`${script} ${args.join(" ")}`.trim());
      output += run(process.execPath, [join(TOOLS, script), ...args], root);
    }
    const [bin, pre] = transpilerBin(root);
    log("abap_transpile");
    output += run(bin, [...pre, relative(root, join(tmp, "abap_transpile.json"))], root);
    const objects = Number(/(\d+) objects written to disk/.exec(output)?.[1] ?? 0);

    const manifest = {
      hash,
      builtAt: new Date().toISOString(),
      ms: Date.now() - started,
      objects,
      transpiler: describeBuild(root),
      inputs: {folders: inputs.folders.map((f) => relative(root, f)), libs: inputs.libs.map((f) => relative(root, f))},
    };
    writeFileSync(join(tmp, "manifest.json"), JSON.stringify(manifest, null, 2));
    linkRoots(root, tmp, config, log);

    mkdirSync(paths.byInput, {recursive: true});
    if (existsSync(target)) {
      // a build of the same inputs finished while this one ran (force, or a
      // race the lock did not cover); theirs is as good as ours
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

async function main(args) {
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
    const r = await build({root, force: args.includes("--force"), switch: !args.includes("--no-switch"), log: say});
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
