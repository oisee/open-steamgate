#!/usr/bin/env node
// osd run [--lib <folder>]... <report.prog.abap> [--] [arguments...]
//
// F8 on a report: build it with osabap (tools/gogen/osabap.mjs) into a
// native command and run that command with the arguments as given. The
// report's selection screen is its command line: host flags take one dash
// (-db FILE, -allow-read DIR, -help), report options two (--name or
// --p-name), and with no arguments a terminal presents the selection screen.
//
// Every argument after the report goes to the command untouched; one bare
// `--` right after the report is osd's and is dropped, so that `osd run x
// -- -help` reaches the report rather than osd. A build is kept under
// .local/osd-run/<hash>, the hash taken over what the build reads: the
// report and the objects beside it, every --lib folder, and the compiler
// itself (tools/gogen and the open-abap-core it compiles against, by size
// and time). The same source runs the kept command without a build.
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";
import {compiled, toolCommand} from "./osd-host.mjs";

const root = resolve(import.meta.dirname, "..");

export function parseRunArgs(args) {
  const libs = [];
  let i = 0;
  for (; i < args.length; i++) {
    if (args[i] === "--lib") {
      if (!args[i + 1] || args[i + 1].startsWith("-")) throw new Error("osd run: --lib needs a folder");
      libs.push(resolve(args[++i]));
      continue;
    }
    break;
  }
  const report = args[i];
  if (report === undefined || !/\.prog\.abap$/i.test(report)) {
    throw new Error("osd run: name a report, <name>.prog.abap");
  }
  let rest = args.slice(i + 1);
  if (rest[0] === "--") rest = rest.slice(1);
  return {libs, report: resolve(report), args: rest};
}

// the files a build reads, sorted, with what makes each one different
function* walk(dir, filter) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".out" || entry.name === "node_modules" || entry.name === ".git") continue;
      yield* walk(full, filter);
    } else if (filter(entry.name)) {
      yield full;
    }
  }
}

export function buildHash({report, libs}) {
  const hash = createHash("sha256");
  const content = (file) => hash.update(`${file}\0`).update(readFileSync(file)).update("\0");
  const stamp = (file) => {
    const s = statSync(file);
    hash.update(`${file}\0${s.size}\0${s.mtimeMs}\0`);
  };
  const abap = (name) => /\.(abap|xml)$/i.test(name);
  // the report's own folder holds its classes and dictionary (osabap.mjs)
  for (const file of walk(dirname(report), (name) => abap(name) && !name.includes(".testclasses."))) {
    if (dirname(file) === dirname(report)) content(file);
  }
  for (const lib of libs) for (const file of walk(lib, abap)) content(file);
  // osabap writes its generated zz_*.go and zz_*.json beside the host; those
  // are output, not input
  for (const file of walk(join(root, "tools", "gogen"), (name) => /\.(mjs|go|mod|sum)$/.test(name) && !name.startsWith("zz_"))) stamp(file);
  for (const file of walk(join(root, ".local", "lars", "open-abap-core", "src"), abap)) stamp(file);
  for (const file of walk(join(root, ".local", "lars", "open-abap-gui"), (name) => /\.(abap|mjs)$/i.test(name))) stamp(file);
  hash.update(`go:${process.env.GOOS ?? ""}/${process.env.GOARCH ?? ""}`);
  return hash.digest("hex").slice(0, 32);
}

// one build at a time: osabap writes its Go module in place
function withLock(file, fn) {
  mkdirSync(dirname(file), {recursive: true});
  const deadline = Date.now() + 15 * 60 * 1000;
  let fd;
  for (;;) {
    try {
      fd = openSync(file, "wx");
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // a lock older than the deadline belongs to a build that died
      if (Date.now() - statSync(file, {throwIfNoEntry: false})?.mtimeMs > 15 * 60 * 1000) {
        rmSync(file, {force: true});
        continue;
      }
      if (Date.now() > deadline) throw new Error(`osd run: another build holds ${file}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    rmSync(file, {force: true});
  }
}

export function binaryFor({report, libs}, {log = (line) => console.error(line)} = {}) {
  const exe = process.platform === "win32" || process.env.GOOS === "windows" ? "osabap.exe" : "osabap";
  const kept = join(root, ".local", "osd-run", buildHash({report, libs}), basename(report).replace(/\.prog\.abap$/i, ""), exe);
  if (existsSync(kept)) return kept;
  return withLock(join(root, ".local", "osd-run", ".lock"), () => {
    if (existsSync(kept)) return kept;
    log(`osd run: building ${basename(report)}`);
    const [command, ...args] = toolCommand(join(root, "tools", "gogen", "osabap.mjs"), [report, ...libs.flatMap((lib) => ["--lib", lib])]);
    // the build talks on stderr: stdout is the report's own output
    const built = spawnSync(command, args, {cwd: root, stdio: ["ignore", 2, 2]});
    if (built.status !== 0) throw new Error(`osd run: the build of ${basename(report)} failed`);
    mkdirSync(dirname(kept), {recursive: true});
    const temp = `${kept}.${process.pid}`;
    copyFileSync(join(root, "tools", "gogen", ".out", exe), temp);
    renameSync(temp, kept);
    return kept;
  });
}

export function main(args) {
  let run;
  try {
    // osabap is a checkout's tool (Go, the gogen sources, open-abap-core),
    // not part of the bundle
    if (compiled) throw new Error("osd run: build reports from a checkout: node bin/osd.mjs run <report.prog.abap>");
    run = parseRunArgs(args);
    if (!existsSync(run.report)) throw new Error(`osd run: no such report ${run.report}`);
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const bin = binaryFor(run);
  const result = spawnSync(bin, run.args, {stdio: "inherit"});
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
