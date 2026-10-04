// Test-only observation of builtin helpers, installed before ESM suite imports.
// Wrappers preserve arguments/results and never close, kill or delete anything.
const fs = require('node:fs');
const cp = require('node:child_process');
const {resolve} = require('node:path');
const {syncBuiltinESMExports} = require('node:module');
const {promisify} = require('node:util');
let owner;
const children = new Set();
const roots = new Map();
exports.setOwner = (file) => { owner = file; };
exports.environmentSnapshot = () => ({...process.env});
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
