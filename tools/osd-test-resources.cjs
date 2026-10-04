// Test-only observation of builtin helpers, installed before ESM suite imports.
// Wrappers preserve arguments/results and never close, kill or delete anything.
const fs = require('node:fs');
const cp = require('node:child_process');
const {join, resolve} = require('node:path');
const {createHash} = require('node:crypto');
const {syncBuiltinESMExports} = require('node:module');
const {promisify} = require('node:util');
let owner;
const children = new Set();
const roots = new Map();
exports.setOwner = (file) => { owner = file; };
exports.environmentSnapshot = () => ({...process.env});
// Metadata only on the common path. Do not follow directory symlinks out
// of the checkout, and let errors other than an absent gen root stay red.
exports.genManifest = (root = process.cwd()) => {
  const files = [];
  const walk = (folder, prefix) => {
    for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
      const path = join(folder, entry.name);
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path, name);
      else {
        const stat = fs.lstatSync(path);
        files.push({path: name, size: stat.size, mtimeMs: stat.mtimeMs});
      }
    }
  };
  const folder = join(root, 'gen');
  try { fs.lstatSync(folder); }
  catch (error) { if (error.code === 'ENOENT') return files; throw error; }
  walk(folder, 'gen');
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
};
exports.genDifference = (before, after, root = process.cwd()) => {
  const old = new Map(before.map((entry) => [entry.path, entry]));
  const next = new Map(after.map((entry) => [entry.path, entry]));
  const changes = [];
  for (const path of [...new Set([...old.keys(), ...next.keys()])].sort()) {
    const a = old.get(path);
    const b = next.get(path);
    if (a && b && a.size === b.size && a.mtimeMs === b.mtimeMs) continue;
    // Removed bytes cannot be read after deletion. Their baseline metadata
    // identifies them; hash only the differing files that still exist.
    let sha256;
    let error;
    if (b) {
      const file = join(root, path);
      try {
        const content = fs.lstatSync(file).isSymbolicLink() ? fs.readlinkSync(file) : fs.readFileSync(file);
        sha256 = createHash('sha256').update(content).digest('hex');
      } catch (cause) { error = cause.message; }
    }
    changes.push({path, kind: !a ? 'added' : !b ? 'removed' : 'changed', before: a ?? null, after: b ? {...b, sha256} : null, ...(error ? {error} : {})});
  }
  return changes;
};
exports.resourceStateSnapshot = (file) => ({
  children: [...children].filter((entry) => entry.file === file && entry.child.pid !== undefined && entry.child.exitCode === null && entry.child.signalCode === null)
    .map(({child, command}) => ({pid: child.pid, command})),
  roots: [...roots].filter(([path, fileOwner]) => fileOwner === file && fs.existsSync(path)).map(([path]) => path),
});
exports.install = () => {
  const track = (child, command) => {
    const entry = {child, file: owner, command: String(command)};
    children.add(entry);
    child.once('exit', () => children.delete(entry));
    return child;
  };
  for (const method of ['spawn', 'fork', 'exec', 'execFile']) {
    const original = cp[method];
    const wrapped = function (...args) {
      return track(original.apply(this, args), args[0]);
    };
    const descriptors = Object.getOwnPropertyDescriptors(original);
    const custom = original[promisify.custom];
    if (custom) {
      descriptors[promisify.custom] = {...descriptors[promisify.custom], value: function (...args) {
        // Node resolves exec/execFile to {stdout, stderr}, and puts the
        // ChildProcess on the promise. Keep that contract and track it too.
        const promise = custom.apply(this, args);
        if (promise.child) track(promise.child, args[0]);
        return promise;
      }};
    }
    Object.defineProperties(wrapped, descriptors);
    cp[method] = wrapped;
  }
  const original = fs.mkdtempSync;
  fs.mkdtempSync = function (...args) {
    const cwd = process.cwd();
    const path = original.apply(this, args);
    roots.set(resolve(cwd, String(path)), owner);
    return path;
  };
  const asyncOriginal = fs.mkdtemp;
  fs.mkdtemp = function (...args) {
    const file = owner;
    const cwd = process.cwd();
    const callback = args.pop();
    return asyncOriginal.call(this, ...args, (error, path) => {
      if (!error) roots.set(resolve(cwd, String(path)), file);
      callback(error, path);
    });
  };
  const promiseOriginal = fs.promises.mkdtemp;
  fs.promises.mkdtemp = async function (...args) {
    const file = owner;
    const cwd = process.cwd();
    const path = await promiseOriginal.apply(this, args);
    roots.set(resolve(cwd, String(path)), file);
    return path;
  };
  syncBuiltinESMExports();
};
