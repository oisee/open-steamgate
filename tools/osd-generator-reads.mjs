// Preloaded in generator children (node --import, or `osd gen` in a hosted
// binary). One JSON line per source read, before a generator can transform
// or copy the bytes into gen/. Every node:fs road to a file's bytes is
// recorded: read, open, stream, copy, link and rename record the source's
// bytes; a read that cannot be tied to a file (an fd this process cannot
// resolve) is an {"incomplete": true} line. The handshake line, written only
// once the hooks are proven visible to ESM importers, tells the parent this
// child was recorded at all (tools/osd-build-generators.mjs recordedRun):
// a Bun binary ignores syncBuiltinESMExports, so its children never write it.
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {readEntry, sha256} from "./osd-read-record.mjs";

const log = process.env.OSD_GENERATOR_READS;
if (log) {
  const root = resolve(process.env.OSD_ROOT ?? process.cwd());
  const external = JSON.parse(process.env.OSD_READ_EXTERNAL ?? "[]").map(resolve);
  const ignored = JSON.parse(process.env.OSD_READ_EXCLUDE_PREFIXES ?? "[]").map(resolve);
  const promises = fs.promises;
  const o = {...fs};
  const op = {...promises};
  let busy = false;
  const write = line => fs.appendFileSync(log, `${JSON.stringify(line)}\n`);
  const under = (base, path) => { const rel = relative(base, path); return rel !== ".." && !rel.startsWith(`..${sep}`); };
  const watched = (path, projected) => (under(root, path) || external.some(base => under(base, path)))
    && !ignored.some(base => under(base, path))
    && (projected || !/^(gen|build|output|tools|scripts|test|node_modules|\.git|\.local\/ci-artifact)(\/|$)/.test(relative(root, path).split(sep).join("/")));
  const pathOf = file => typeof file === "string" ? file : file instanceof URL ? fileURLToPath(file)
    : file instanceof Uint8Array ? Buffer.from(file).toString() : undefined;
  // the bytes as the generator got them; for a directory (cp), every file under it
  const each = (path, seen = new Set()) => {
    const fd = o.openSync(path, "r");
    try {
      if (!fs.fstatSync(fd).isDirectory()) return [[path, o.readFileSync(fd)]];
    } finally { o.closeSync(fd); }
    const real = fs.realpathSync(path);
    if (seen.has(real)) return [];
    seen.add(real);
    const dir = fs.opendirSync(path);
    const files = [];
    try { for (let entry; (entry = dir.readSync()) !== null;) files.push(...each(join(path, entry.name), seen)); } finally { dir.closeSync(); }
    return files;
  };
  const logged = new Set();
  // node's own sync readers call the public openSync/readSync: the outer call records
  const quiet = call => { if (busy) return call(); busy = true; try { return call(); } finally { busy = false; } };
  const record = (file, bytes, {projected = false, missingOk = false} = {}) => {
    if (busy) return;
    const given = pathOf(file);
    busy = true;
    try {
      if (given === undefined) return write({incomplete: true, path: String(file)});
      const path = resolve(given);
      if (!watched(path, projected)) return;
      if (missingOk) try { fs.accessSync(path); } catch { return; }
      for (const [one, data] of bytes === undefined ? each(path) : [[path, bytes]]) {
        const key = `${one}\0${sha256(data)}`;
        if (!watched(one, projected) || logged.has(key)) continue;
        logged.add(key);
        write(readEntry(root, one, data));
      }
    } catch { write({incomplete: true, path: String(pathOf(file) ?? file)}); } finally { busy = false; }
  };
  // An fd read is attributed to the file the fd names now; one this process
  // cannot name (no /proc) is incomplete. Pipes and sockets are not files.
  const fdSeen = new Map();
  const fdRead = fd => {
    if (busy) return;
    if (typeof fd === "object" && fd !== null && typeof fd.fd === "number") fd = fd.fd;
    let path;
    try { path = fs.readlinkSync(`/proc/self/fd/${fd}`); } catch { return void write({incomplete: true, path: `fd:${fd}`}); }
    if (!path.startsWith("/") || fdSeen.get(fd) === path) return;
    fdSeen.set(fd, path);
    record(path, undefined, {missingOk: true});
  };
  const readable = flags => flags === undefined || flags === null
    || (typeof flags === "string" ? /[r+]/.test(flags) : (flags & 3) !== fs.constants.O_WRONLY);
  const asBytes = (value, options) => Buffer.isBuffer(value) ? value
    : Buffer.from(value, typeof options === "string" ? options : options?.encoding ?? "utf8");
  const callback = args => args.findLastIndex(arg => typeof arg === "function");
  // wrap an fs callback API: `after(args, result)` runs on success
  const viaCallback = (name, after) => {
    fs[name] = (...args) => {
      const at = callback(args);
      if (at >= 0) {
        const done = args[at];
        args[at] = (error, ...rest) => { if (!error) after(args, rest[0]); done(error, ...rest); };
      }
      return o[name](...args);
    };
  };
  const viaPromise = (name, after) => {
    promises[name] = async (...args) => { const value = await op[name](...args); after(args, value); return value; };
  };

  fs.readFileSync = (file, ...args) => {
    if (busy) return o.readFileSync(file, ...args);
    const value = quiet(() => o.readFileSync(file, ...args));
    if (typeof file === "number") { fdRead(file); return value; }
    // the file the view (tools/osd-generator-view.mjs) actually read
    const viewed = globalThis[Symbol.for("osd.generator.readPath")]?.(file) ?? file;
    const given = pathOf(file);
    const actual = pathOf(viewed);
    record(viewed, asBytes(value, args[0]), {projected: given !== undefined && actual !== undefined && resolve(actual) !== resolve(given)});
    return value;
  };
  const opened = (args, fd) => { if (readable(args[1])) record(args[0]); fdSeen.delete(typeof fd === "number" ? fd : fd?.fd); };
  fs.openSync = (...args) => { const fd = o.openSync(...args); opened(args, fd); return fd; };
  for (const name of ["readSync", "readvSync"]) fs[name] = (fd, ...args) => { fdRead(fd); return o[name](fd, ...args); };
  for (const name of ["read", "readv"]) fs[name] = (fd, ...args) => { fdRead(fd); return o[name](fd, ...args); };
  fs.copyFileSync = (src, ...args) => { const value = quiet(() => o.copyFileSync(src, ...args)); record(src); return value; };
  fs.cpSync = (src, ...args) => { const value = quiet(() => o.cpSync(src, ...args)); record(src); return value; };
  fs.linkSync = (src, ...args) => { const value = o.linkSync(src, ...args); record(src); return value; };
  fs.symlinkSync = (target, path, ...args) => {
    const value = o.symlinkSync(target, path, ...args);
    record(resolve(dirname(resolve(pathOf(path) ?? ".")), pathOf(target) ?? ""));
    return value;
  };
  fs.renameSync = (src, ...args) => { record(src, undefined, {missingOk: true}); return o.renameSync(src, ...args); };
  fs.createReadStream = (file, options) => {
    if (options?.fd !== undefined && options.fd !== null) fdRead(options.fd);
    else record(file, undefined, {missingOk: true});
    return o.createReadStream(file, options);
  };
  if (o.openAsBlob) fs.openAsBlob = (file, ...args) => { record(file, undefined, {missingOk: true}); return o.openAsBlob(file, ...args); };
  fs.readFile = (file, ...args) => {
    if (typeof file === "number") fdRead(file);
    const at = callback(args);
    if (at >= 0 && typeof file !== "number") {
      const done = args[at];
      const options = at > 0 ? args[0] : undefined;
      args[at] = (error, value) => { if (!error) record(file, asBytes(value, options)); done(error, value); };
    }
    return o.readFile(file, ...args);
  };
  viaCallback("open", opened);
  viaCallback("copyFile", args => record(args[0]));
  viaCallback("cp", args => record(args[0]));
  viaCallback("link", args => record(args[0]));
  fs.rename = (src, ...args) => { record(src, undefined, {missingOk: true}); return o.rename(src, ...args); };

  promises.readFile = async (file, options) => {
    if (typeof file === "object" && file !== null && typeof file.fd === "number") fdRead(file);
    const value = await op.readFile(file, options);
    if (!(typeof file === "object" && file !== null && typeof file.fd === "number")) record(file, asBytes(value, options));
    return value;
  };
  viaPromise("open", opened);
  viaPromise("copyFile", args => record(args[0]));
  viaPromise("cp", args => record(args[0]));
  viaPromise("link", args => record(args[0]));
  promises.symlink = async (target, path, ...args) => {
    await op.symlink(target, path, ...args);
    record(resolve(dirname(resolve(pathOf(path) ?? ".")), pathOf(target) ?? ""));
  };
  promises.rename = async (src, ...args) => { record(src, undefined, {missingOk: true}); return op.rename(src, ...args); };
  syncBuiltinESMExports();

  // Proven, not assumed: a named import of either module must now see the hooks.
  const named = await import("node:fs");
  const namedPromises = await import("node:fs/promises");
  const visible = Object.keys(fs).every(name => fs[name] === o[name] || named[name] === fs[name])
    && Object.keys(promises).every(name => promises[name] === op[name] || namedPromises[name] === promises[name]);
  if (visible && process.env.OSD_GENERATOR_READS_TOKEN) write({recorder: process.env.OSD_GENERATOR_READS_TOKEN});
  if (!visible) write({incomplete: true, path: "recorder: node:fs hooks are not visible to imports"});
}
