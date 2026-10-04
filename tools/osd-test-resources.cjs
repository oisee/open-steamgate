// Test-only observation of builtin helpers, installed before ESM suite imports.
// Wrappers preserve arguments/results and never close, kill or delete anything.
const fs = require('node:fs');
const cp = require('node:child_process');
const {isAbsolute, join, relative, resolve, sep} = require('node:path');
const {createHash} = require('node:crypto');
const {syncBuiltinESMExports} = require('node:module');
const {promisify} = require('node:util');
let owner;
const children = new Set();
const roots = new Map();
exports.setOwner = (file) => { owner = file; };
exports.environmentSnapshot = () => ({...process.env});
// Cache the most recent (absolute path, type, size, mtimeMs, ctimeMs, ino) version. Snapshots
// retain its digest even when the cache advances, so a rewrite can be
// compared with bytes that no longer exist. Unchanged versions need no reads.
// A write changes ctime even if utimes restores mtime; ino covers replacements.
const digests = new Map();
const nodeType = (stat) => stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'other';
const digest = (file, stat) => {
  const type = nodeType(stat);
  const cached = digests.get(file);
  if (cached && cached.type === type && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs &&
      cached.ctimeMs === stat.ctimeMs && cached.ino === stat.ino) return cached.sha256;
  if (type === 'other') throw new Error('Unobserved node: unsupported type');
  const content = stat.isSymbolicLink() ? fs.readlinkSync(file) : fs.readFileSync(file);
  const sha256 = createHash('sha256').update(type).update('\0').update(content).digest('hex');
  digests.set(file, {type, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, sha256});
  return sha256;
};
// Follow named directory roots only inside the checkout. Nested symlinks are
// observed as links, without traversal. Unobservable roots carry explicit errors.
const inside = (root, path) => {
  const name = relative(root, path);
  return name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name);
};
const manifests = ['osd-pack.json', 'abap_transpile.json', 'libs.lock.json'];
// Root discovery is independent of build inputs, enabled packs and OSD_PACKS.
// Every immediate pack directory is observed, including newly created packs.
const namedRoots = (name, root, checkout) => {
  if (name === 'gen') return ['gen'];
  if (name !== 'tree') throw new Error(`Unknown isolation manifest: ${name}`);
  const paths = ['src', ...manifests];
  const packs = join(root, 'packs');
  // Observe the container link too, and never enumerate an external container.
  let stat;
  try { stat = fs.lstatSync(packs); }
  catch (error) { if (error.code === 'ENOENT') return paths; throw error; }
  if (stat.isSymbolicLink()) paths.push('packs');
  // Let walk() report broken/unresolvable container links as unobserved roots.
  try {
    if (!inside(checkout, fs.realpathSync(packs)) || !fs.statSync(packs).isDirectory()) return paths;
  } catch (error) { if (stat.isSymbolicLink()) return paths; throw error; }
  for (const entry of fs.readdirSync(packs, {withFileTypes: true})) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const prefix = `packs/${entry.name}`;
    if (entry.isSymbolicLink()) paths.push(prefix);
    paths.push(`${prefix}/src`, ...manifests.map((file) => `${prefix}/${file}`));
  }
  return paths;
};
exports.manifest = (name, root = process.cwd()) => {
  const files = [];
  const checkout = fs.realpathSync(root);
  const walk = (path, name, namedRoot = false) => {
    let stat;
    try { stat = fs.lstatSync(path); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const entry = {path: name, type: nodeType(stat), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino};
    let directory = stat.isDirectory();
    if (namedRoot) {
      try {
        if (!inside(checkout, fs.realpathSync(path))) throw new Error('resolves outside checkout');
        directory = fs.statSync(path).isDirectory();
      } catch (error) {
        entry.error = `Unobserved root: ${error.message}`;
        files.push(entry);
        return;
      }
    }
    // A pack/container link is recorded here; only its named src/manifests walk.
    const linkOnly = namedRoot && (name === 'packs' || /^packs\/[^/]+$/.test(name));
    if (directory && !linkOnly) {
      if (stat.isSymbolicLink() && name !== 'gen') {
        entry.sha256 = digest(resolve(path), stat);
        files.push(entry);
      }
      for (const entry of fs.readdirSync(path)) walk(join(path, entry), `${name}/${entry}`);
    } else {
      try { entry.sha256 = digest(resolve(path), stat); }
      catch (error) { entry.error = error.message; }
      files.push(entry);
    }
  };
  for (const path of namedRoots(name, root, checkout)) walk(join(root, path), path, true);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
};
exports.manifestDifference = (before, after) => {
  const old = new Map(before.map((entry) => [entry.path, entry]));
  const next = new Map(after.map((entry) => [entry.path, entry]));
  const changes = [];
  for (const path of [...new Set([...old.keys(), ...next.keys()])].sort()) {
    const a = old.get(path);
    const b = next.get(path);
    const error = a?.error ?? b?.error;
    // Builds and fixtures can rewrite identical bytes. Metadata invalidates
    // the digest cache; identity includes node type as well as content.
    if (a && b && !error && a.type === b.type && a.sha256 === b.sha256) continue;
    changes.push({path, kind: !a ? 'added' : !b ? 'removed' : 'changed', before: a ?? null, after: b ?? null, ...(error ? {error} : {})});
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
