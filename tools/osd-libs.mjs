#!/usr/bin/env node
// Materialise locked library commits and keep .local/lars as the public path.
import {execFileSync} from "node:child_process";
import {closeSync, lstatSync, mkdirSync, mkdtempSync, openSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {runsAs} from "./osd-main.mjs";
import {librariesFromLock, libraryPath} from "./osd-lock.mjs";

const git = (cwd, ...args) => execFileSync("git", args, {cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
const exists = (path) => { try { lstatSync(path); return true; } catch { return false; } };
const head = (path) => { try { return git(path, "rev-parse", "HEAD"); } catch { return "missing"; } };
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function libraries(root = ".") {
  const lars = resolve(root, ".local", "lars");
  let shared = lars;
  try { shared = realpathSync(lars); } catch { /* fresh checkout */ }
  const store = dirname(shared);
  return librariesFromLock(root).libraries.map((lib) => ({
    ...lib, at: join(shared, lib.name), pin: join(store, "pins", `${lib.name}@${lib.ref}`),
    dev: join(store, "dev", lib.name), shared: shared !== lars,
  }));
}

export function missing(root = ".") {
  return libraries(root).filter((lib) => !exists(lib.at));
}

function cloneInto(path, lib) {
  git(dirname(path), "init", "--quiet", path);
  git(path, "remote", "add", "origin", lib.url);
  git(path, "fetch", "--quiet", "--depth", "1", "origin", lib.ref);
  git(path, "checkout", "--quiet", "--detach", "FETCH_HEAD");
  if (head(path) !== lib.ref) throw new Error(`${lib.name}: fetched a different commit`);
}

// The exclusive lock covers clone and rename. Other sessions wait for the
// winner and then validate its finished directory; no session removes a peer's
// temporary checkout or treats a half-fetched directory as a pin.
function ensurePin(lib) {
  mkdirSync(dirname(lib.pin), {recursive: true});
  const lock = `${lib.pin}.lock`;
  let fd;
  for (let attempt = 0; attempt < 600; attempt++) {
    try { fd = openSync(lock, "wx"); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (exists(lib.pin)) break;
      pause(100);
    }
  }
  if (fd === undefined && !exists(lib.pin)) throw new Error(`${lib.name}: timed out waiting for ${lock}`);
  try {
    if (!exists(lib.pin)) {
      const temp = mkdtempSync(join(dirname(lib.pin), `.${lib.name}-`));
      try { cloneInto(temp, lib); renameSync(temp, lib.pin); }
      finally { if (exists(temp)) rmSync(temp, {recursive: true, force: true}); }
    }
    if (head(lib.pin) !== lib.ref) throw new Error(`${lib.name}: pin ${lib.pin} has drifted; leave it untouched and inspect it manually`);
  } finally {
    if (fd !== undefined) { closeSync(fd); rmSync(lock, {force: true}); }
  }
}

function pointAtPin(lib) {
  mkdirSync(dirname(lib.at), {recursive: true});
  const lock = `${lib.at}.lock`;
  let fd;
  for (let attempt = 0; attempt < 600; attempt++) {
    try { fd = openSync(lock, "wx"); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      pause(100);
    }
  }
  if (fd === undefined) throw new Error(`${lib.name}: timed out waiting for ${lock}`);
  try {
    if (exists(lib.at) && !lstatSync(lib.at).isSymbolicLink()) {
      if (lib.shared) throw new Error(`${lib.name}: ${lib.at} is shared by worktrees; move it aside manually before syncing`);
      if (exists(lib.dev)) throw new Error(`${lib.name}: cannot move ${lib.at} to ${lib.dev}: destination exists; move it aside manually`);
      mkdirSync(dirname(lib.dev), {recursive: true});
      renameSync(lib.at, lib.dev);
    }
    const target = resolve(lib.pin);
    if (exists(lib.at)) {
      if (resolve(dirname(lib.at), readlinkSync(lib.at)) === resolve(lib.pin)) return;
      rmSync(lib.at); // only our symlink, never a directory
    }
    try { symlinkSync(target, lib.at, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) {
      throw new Error(`${lib.name}: could not create ${lib.at} link (${error.message}); on Windows enable Developer Mode or run in an elevated terminal`);
    }
  } finally { closeSync(fd); rmSync(lock, {force: true}); }
}

/** CI keeps real .local/lars clones for the existing artifact and restore path. */
export function materialise(root = ".", say = () => {}, {ci = process.env.CI === "true", remote = {}} = {}) {
  const made = [];
  for (const lib of libraries(root)) {
    if (remote[lib.name]) lib.url = remote[lib.name];
    if (ci) {
      if (!exists(lib.at)) {
        mkdirSync(dirname(lib.at), {recursive: true});
        const temp = mkdtempSync(join(dirname(lib.at), `.${lib.name}-`));
        try { cloneInto(temp, lib); renameSync(temp, lib.at); }
        finally { if (exists(temp)) rmSync(temp, {recursive: true, force: true}); }
        made.push(lib.name);
      }
    } else {
      ensurePin(lib);
      pointAtPin(lib);
      made.push(lib.name);
    }
    libraryPath(root, lib.name);
    say(`osd-libs: ${lib.name} @ ${lib.ref} via ${lib.at}`);
  }
  return made;
}

export function status(root = ".", say = console.log) {
  for (const lib of libraries(root)) {
    let state;
    try { libraryPath(root, lib.name); state = "ready"; }
    catch (error) { state = error.message; }
    say(`${lib.name}: ${state}`);
  }
}

if (runsAs("osd-libs.mjs")) {
  const root = process.cwd();
  if (process.argv.includes("--status")) status(root);
  else if (process.argv.includes("--check")) {
    for (const lib of libraries(root)) libraryPath(root, lib.name);
    console.log(`${libraries(root).length} libraries at locked commits`);
  } else materialise(root, console.log);
}
