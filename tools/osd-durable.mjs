// Writes that survive a crash in the order they were made.
//
// The inactive-object bookkeeping (ObjectStore, tools/osd-store.mjs) orders
// its steps so that a process killed between any two leaves a state the next
// start recovers. An order is only an order on disk when each step is
// durable before the next starts: the file's bytes (fsync of the file) and
// its name in the directory (fsync of the directory, after a create, a
// rename or a remove). One place does both, so no step forgets one.
//
// What this does not cover, said rather than implied: a power loss is not
// simulated by any test here (the tests inject a crash between steps, which
// is a killed process), and a disk or file system that acknowledges an fsync
// it has not done defeats it. On Windows a directory cannot be opened for an
// fsync (EPERM/EISDIR); NTFS journals the metadata of a rename itself, so
// the directory step is skipped there and only the file is flushed.
import {closeSync, copyFileSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync} from "node:fs";
import {dirname} from "node:path";

// a test's view of the steps, in order: ["write", path] / ["fsync-dir", dir] ...
let trace;
export function traceDurable(fn) {
  trace = fn;
}

/** fsync a directory, so a name created, renamed or removed in it lasts */
export function fsyncDir(dir) {
  trace?.("fsync-dir", dir);
  let fd;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch (error) {
    // Windows: a directory is not opened for this, and NTFS needs it not
    if (!["EPERM", "EISDIR", "EINVAL", "EBADF", "EACCES", "ENOENT"].includes(error.code)) throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function fsyncFile(path) {
  const fd = openSync(path, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** a whole file, flushed, and its name in its directory */
export function writeDurable(path, data) {
  trace?.("write", path);
  const fd = openSync(path, "w");
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  fsyncDir(dirname(path));
}

/** a copy, flushed, and its name in its directory */
export function copyDurable(from, to) {
  trace?.("copy", to);
  copyFileSync(from, to);
  fsyncFile(to);
  fsyncDir(dirname(to));
}

/** a rename that is durable once this returns */
export function renameDurable(from, to) {
  trace?.("rename", to);
  renameSync(from, to);
  fsyncDir(dirname(to));
}

/** a remove that is durable once this returns */
export function removeDurable(path) {
  trace?.("remove", path);
  rmSync(path, {force: true});
  fsyncDir(dirname(path));
}

/** a folder and every parent it had to create, each name durable */
export function mkdirDurable(dir) {
  const first = mkdirSync(dir, {recursive: true});
  if (first === undefined) return;
  for (let d = dir; ; d = dirname(d)) {
    fsyncDir(dirname(d));
    if (d === first || dirname(d) === d) break;
  }
}
