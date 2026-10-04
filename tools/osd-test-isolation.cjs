// --require this module. Serial root afterAll is run-wide, not file-wide.
// Mocha emits pre/post-require around each awaited file import. Give each
// file its own suite, including its root hooks, before execution starts.
const Mocha = require('mocha');
const {basename, delimiter, join, relative, resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const {existsSync, readFileSync, readdirSync} = require('node:fs');
const {createHash} = require('node:crypto');
const resources = require('./osd-test-resources.cjs');
const allowances = require('./osd-test-isolation-allow.json');
const moduleOf = (name) => import(pathToFileURL(resolve(__dirname, name)).href);
// Fail closed on malformed exceptions, even when their file is not selected.
for (const [file, entries] of Object.entries(allowances)) {
  for (const [invariant, entry] of Object.entries(entries)) {
    if (!entry || !['reason', 'owner', 'backlog'].every((key) => typeof entry[key] === 'string' && entry[key].trim())) {
      throw new Error(`test-isolation: ${file}: ${invariant}: allowance requires reason, owner and backlog`);
    }
    if (invariant === 'temporary-roots' && (!Array.isArray(entry.roots) || !entry.roots.length || !entry.roots.every(({prefix, maxCount}) => typeof prefix === 'string' && prefix.length && Number.isInteger(maxCount) && maxCount > 0))) {
      throw new Error(`test-isolation: ${file}: invalid root identity/count`);
    }
    if (invariant === 'generation' && (!['restored-inputs', 'added-inputs'].includes(entry.drift?.kind) || !Number.isInteger(entry.drift.maxCount) || entry.drift.maxCount < 1)) throw new Error(`test-isolation: ${file}: invalid originating drift`);
    if (invariant === 'gen' && (!Array.isArray(entry.files) || !entry.files.length || !entry.files.every(({path, prefix, maxCount}) => {
      const identity = path ?? prefix;
      return (path === undefined) !== (prefix === undefined) && typeof identity === 'string' && identity.startsWith('gen/') && !identity.includes('..') && !identity.includes('\\') && identity !== 'gen/' && (!prefix || prefix.endsWith('/')) && Number.isInteger(maxCount) && maxCount > 0 && (!path || maxCount === 1);
    }))) throw new Error(`test-isolation: ${file}: invalid gen path/prefix/count`);
    if (!['temporary-roots', 'generation', 'gen'].includes(invariant)) throw new Error(`test-isolation: ${file}: unsupported allowance invariant ${invariant}`);
  }
}
const originalEnv = resources.environmentSnapshot();
const importKeys = new Set();
let lastGeneration;
let generationOrigin;
let activeDrift;
let generationBaseline;
let proofMs = 0;
const openSteps = new Set();
resources.install();
const dialogReady = moduleOf('osd-dialog-step.mjs').then(({registerDialogObserver}) => {
  registerDialogObserver({
    open(token) { openSteps.add(token); },
    snapshot() {
      for (const token of openSteps) if (token.done) openSteps.delete(token);
      return [...openSteps].map((token) => ({what: token.what ?? null, dialog: token.dialog}));
    },
  });
});
// Inactive metadata is evidence for drift allowances below; the generation
// invariant itself attributes a change in the live/tree pair.
const sameGeneration = (a, b) => a && b && !a.error && !b.error && a.root === b.root && a.live === b.live && a.tree === b.tree;
const envDifference = (expected, actual, keys = new Set([...Object.keys(expected), ...Object.keys(actual)])) =>
  Object.fromEntries([...keys].filter((key) => expected[key] !== actual[key]).map((key) => [key, {before: expected[key] === undefined ? 'absent' : 'set', after: actual[key] === undefined ? 'absent' : 'set', changed: true}]));
const inputSnapshot = async (inputs) => {
  const {hashOf} = await moduleOf('osd-build.mjs');
  const digests = new Map();
  const tree = hashOf(process.cwd(), inputs, {digests});
  return {tree, digests};
};
// The persisted active view uses the same copy layout as ObjectStore.overlay.
// Read it without constructing a store (its recovery can write to disk).
const inactiveViewSnapshot = () => {
  const root = process.cwd();
  const folder = join(root, 'build/inactive/active');
  const metadata = join(root, 'build/inactive/inactive.json');
  const text = existsSync(metadata) ? readFileSync(metadata, 'utf8') : '';
  const entries = text ? Object.values(JSON.parse(text).inactive ?? {}) : [];
  const kept = new Set();
  const owned = new Set();
  for (const entry of entries) {
    if (!Array.isArray(entry.files)) throw new Error('Invalid inactive generation view');
    for (const file of entry.files) {
      if (existsSync(join(root, file))) kept.add(resolve(root, file));
      const copy = join(folder, file);
      if (existsSync(copy)) owned.add(resolve(copy));
    }
  }
  const copies = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path); else copies.push(path);
    }
  };
  walk(folder);
  copies.sort();
  const digest = createHash('sha256').update(text);
  for (const path of copies) digest.update(relative(folder, path)).update('\0').update(readFileSync(path)).update('\0');
  const exclude = [...kept, ...copies.filter((path) => !owned.has(resolve(path)))];
  const overlay = owned.size ? {exclude, folder: 'build/inactive/active'} : kept.size ? {exclude: [...kept]} : undefined;
  return {signature: digest.digest('hex'), overlay};
};
const changedInputs = (before, after) => [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path));
// Called by an originating fixture while its known edited inputs are still
// present. A hash proof ties that specific edit to the generation left live.
exports.observeGenerationDrift = async ({pack} = {}) => {
  const started = process.hrtime.bigint();
  try {
    const entry = allowances[current]?.generation;
    if (entry?.drift.kind !== 'restored-inputs' || !generationBaseline || generationBaseline.tree !== generationBaseline.beforeTree) throw new Error('No restored-inputs exception for the running file');
    const {generationStateSnapshot, hashOf, inputsOf} = await moduleOf('osd-build.mjs');
    let inputs;
    if (pack !== undefined) {
      if (!entry.drift.packSuffix || !resolve(pack).replaceAll('\\', '/').endsWith(entry.drift.packSuffix)) throw new Error('Unrecognized generation pack');
      const {inputFoldersOf, packAt, packsOf} = await moduleOf('osd-packs.mjs');
      const fixturePack = packAt(process.cwd(), resolve(pack));
      if (!fixturePack || fixturePack.name !== 'notebook-scratch' || fixturePack.order !== 10000 || fixturePack.data || fixturePack.ddic || fixturePack.webapp || fixturePack.tiles.length) throw new Error('Unrecognized generation pack contents');
      inputs = inputsOf(process.cwd());
      const env = {...process.env, OSD_PACKS: [process.env.OSD_PACKS, resolve(pack)].filter(Boolean).join(delimiter)};
      const config = JSON.parse(readFileSync(inputs.config, 'utf8'));
      const folders = inputFoldersOf(process.cwd(), config, env).map((folder) => join(process.cwd(), folder)).filter(existsSync);
      const packFiles = packsOf(process.cwd(), env).map((item) => join(item.dir, 'osd-pack.json'))
        .filter((path) => inputs.packFiles.includes(path) || path === join(fixturePack.dir, 'osd-pack.json'));
      inputs = {...inputs, folders, packFiles};
    }
    const snapshot = await inputSnapshot(inputs);
    const state = generationStateSnapshot(undefined, {hashTree: false});
    const changed = changedInputs(generationBaseline.digests, snapshot.digests);
    const drift = entry.drift;
    const matches = changed.length > 0 && changed.length <= drift.maxCount && changed.every((path) =>
      drift.paths?.includes(relative(process.cwd(), path).replaceAll('\\', '/')) || drift.pathSuffixes?.some((suffix) => path.replaceAll('\\', '/').endsWith(suffix)));
    // Replacing exactly the observed edits with baseline digests must name
    // the original tree. This also rejects unrelated config/generator drift.
    const restoredTree = pack === undefined ? hashOf(process.cwd(), undefined, {substitute: generationBaseline.digests}) : hashOf(process.cwd());
    const contentMatches = changed.every((path) => {
      if (drift.contentDigest) return snapshot.digests.get(path) === drift.contentDigest;
      if (!drift.restoreContent) return false;
      const text = readFileSync(path, 'utf8');
      const restored = text.replace(new RegExp(drift.restoreContent.pattern), drift.restoreContent.replacement);
      return restored !== text && createHash('sha256').update(restored).digest('hex') === generationBaseline.digests.get(path);
    });
    const inactive = inactiveViewSnapshot();
    const sameInactive = inactive.signature === generationBaseline.inactive.signature;
    const liveMatches = state.live === snapshot.tree || (sameInactive && inactive.overlay && hashOf(process.cwd(), inputs, {overlay: inactive.overlay}) === state.live);
    if (!matches || !contentMatches || !sameInactive || restoredTree !== generationBaseline.tree || !liveMatches) throw new Error(`test-isolation: ${current}: unrecognized originating generation drift: ${JSON.stringify({identity: matches, content: contentMatches, restoredTree, baselineTree: generationBaseline.tree, sameInactive, live: state.live, tree: snapshot.tree, changed: changed.map((path) => relative(process.cwd(), path).replaceAll('\\', '/'))})}`);
    activeDrift = {live: state.live, tree: generationBaseline.tree, inactive: inactive.signature};
  } finally { proofMs += Number(process.hrtime.bigint() - started) / 1e6; }
};
let current;
const costs = [];
const genCosts = [];
let genDiffMs = 0;
const genSnapshot = () => {
  const started = process.hrtime.bigint();
  const manifest = resources.genManifest();
  genCosts.push({ms: Number(process.hrtime.bigint() - started) / 1e6, files: manifest.length});
  return manifest;
};
const genDifference = (before, after) => {
  const started = process.hrtime.bigint();
  try { return resources.genDifference(before, after); }
  catch (error) { return [{error: error.message}]; }
  finally { genDiffMs += Number(process.hrtime.bigint() - started) / 1e6; }
};
const fileChecks = [];
const intentional = new Map();
exports.allowGenerationMismatch = (reason) => {
  if (!current || typeof reason !== 'string' || !reason.trim()) throw new Error('allowGenerationMismatch needs a running file and a reason');
  intentional.set(current, reason);
};
const hooks = ['_beforeAll', '_beforeEach', '_afterEach', '_afterAll'];
const emit = Mocha.Suite.prototype.emit;
Mocha.Suite.prototype.emit = function (event, ...args) {
  if (!this.root || !['pre-require', 'post-require'].includes(event)) return emit.call(this, event, ...args);
  const file = relative(process.cwd(), args[1]).replaceAll('\\', '/');
  if (event === 'pre-require') {
    if (args[2]?.options?.parallel || args[2]?.options?.isWorker) throw new Error('osd-test-isolation requires serial mocha');
    resources.setOwner(file);
    this.osdLoading = {file, gen: genSnapshot(), env: resources.environmentSnapshot(), suites: this.suites.length, tests: this.tests.length, onlySuites: this._onlySuites.length, onlyTests: this._onlyTests.length,
      hooks: Object.fromEntries(hooks.map((key) => [key, this[key].length]))};
    return emit.call(this, event, ...args);
  }
  const result = emit.call(this, event, ...args);
  const loading = this.osdLoading;
  const importGenChanges = genDifference(loading.gen, genSnapshot());
  const suites = this.suites.splice(loading.suites);
  const tests = this.tests.splice(loading.tests);
  const fileHooks = Object.fromEntries(hooks.map((key) => [key, this[key].splice(loading.hooks[key])]));
  const wrapper = Mocha.Suite.create(this, file);
  wrapper.file = args[1];
  wrapper._onlySuites = this._onlySuites.splice(loading.onlySuites);
  wrapper._onlyTests = this._onlyTests.splice(loading.onlyTests);
  for (const suite of suites) { suite.parent = wrapper; Object.setPrototypeOf(suite.ctx, wrapper.ctx); wrapper.suites.push(suite); }
  for (const test of tests) { test.parent = wrapper; test.ctx = wrapper.ctx; wrapper.tests.push(test); }
  let before;
  let baselineMs = 0;
  const registrationEnv = resources.environmentSnapshot();
  for (const key of new Set([...Object.keys(loading.env), ...Object.keys(registrationEnv)])) {
    if (loading.env[key] !== registrationEnv[key]) importKeys.add(key);
  }
  wrapper.beforeAll('isolation baseline', async function () {
    this.timeout(30000);
    const began = process.hrtime.bigint();
    current = file;
    resources.setOwner(file);
    await dialogReady;
    const {generationStateSnapshot} = await moduleOf('osd-build.mjs');
    before = {gen: genSnapshot(), env: resources.environmentSnapshot(), generation: generationStateSnapshot()};
    generationBaseline = allowances[file]?.generation && before.generation.live !== null ? await inputSnapshot() : undefined;
    if (generationBaseline) generationBaseline.beforeTree = before.generation.tree;
    if (allowances[file]?.generation?.drift.kind === 'restored-inputs' || lastGeneration?.inactive !== undefined) {
      const inactive = inactiveViewSnapshot();
      before.generation.inactive = inactive.signature;
      if (generationBaseline) generationBaseline.inactive = inactive;
    }
    activeDrift = undefined;
    proofMs = 0;
    baselineMs = Number(process.hrtime.bigint() - began) / 1e6;
  });
  for (const key of hooks.filter((key) => key !== '_afterAll')) {
    for (const hook of fileHooks[key]) { hook.parent = wrapper; hook.ctx = wrapper.ctx; wrapper[key].push(hook); }
  }
  let checked = false;
  wrapper.afterAll('process invariants', async function () {
    checked = true;
    const detector = this.runnable();
    // User hooks keep their own Mocha timeouts; their total duration must
    // not consume the detector's separate snapshot budget.
    this.timeout(0);
    const cleanupErrors = [];
    for (const hook of before ? fileHooks._afterAll : []) {
      hook.parent = wrapper; hook.ctx = wrapper.ctx;
      const onError = (error) => cleanupErrors.push(error.message);
      hook.on('error', onError);
      try { await new Promise((resolve, reject) => hook.run((error) => error ? reject(error) : resolve())); }
      catch (error) { cleanupErrors.push(error.message); }
      finally { hook.removeListener('error', onError); }
      const signalled = hook.error();
      if (signalled) cleanupErrors.push(signalled.message);
    }
    this.runnable(detector);
    this.timeout(30000);
    const started = process.hrtime.bigint();
    const [{dialogStateSnapshot}, {generationStateSnapshot}, {servingStateSnapshot}] = await Promise.all([
      moduleOf('osd-dialog-step.mjs'), moduleOf('osd-build.mjs'), moduleOf('osd-runtime.mjs')]);
    let generation;
    try {
      generation = generationStateSnapshot();
      if (allowances[file]?.generation?.drift.kind === 'restored-inputs' || lastGeneration?.inactive !== undefined) generation.inactive = inactiveViewSnapshot().signature;
    }
    catch (error) { generation = {root: process.cwd(), error: error.message}; }
    const after = {dialog: dialogStateSnapshot(), generation,
      serving: servingStateSnapshot(), resources: resources.resourceStateSnapshot(file), env: resources.environmentSnapshot()};
    const ownedPids = new Set(after.resources.children.map(({pid}) => pid));
    after.serving = after.serving.filter(({pid}) => ownedPids.has(pid));
    const violations = [];
    const genChanges = [...importGenChanges, ...(before ? genDifference(before.gen, genSnapshot()) : [])];
    if (genChanges.length) violations.push(['gen', genChanges]);
    if (after.dialog.held || after.dialog.waiting || after.dialog.open.length) violations.push(['dialog', {before: {held: false, waiting: 0, open: []}, after: after.dialog}]);
    const inherited = sameGeneration(lastGeneration, before?.generation ?? after.generation);
    const unchanged = sameGeneration(before?.generation ?? lastGeneration, after.generation);
    const generationBad = after.generation.error || after.generation.live !== after.generation.tree || (before?.generation.live && after.generation.live === null);
    // A file owns changes across its boundary, including fresh drift from an
    // already stale baseline. A mismatch it merely inherited is setup state.
    if (generationBad && !unchanged && (!intentional.has(file) || after.generation.error || after.generation.live === null)) {
      violations.push(['generation', {before: before?.generation, after: after.generation, ...(inherited ? {previousOrigin: generationOrigin} : {})}]);
    }
    if (generationBad && !unchanged) generationOrigin = file;
    if (!generationBad) generationOrigin = undefined;
    if (after.resources.children.length || after.serving.length) violations.push(['children', {before: [], after: {tracked: after.resources.children, serving: after.serving}}]);
    if (after.resources.roots.length) violations.push(['temporary-roots', {before: [], after: after.resources.roots}]);
    const expectedEnv = {...(before?.env ?? originalEnv)};
    for (const key of importKeys) {
      if (originalEnv[key] === undefined) delete expectedEnv[key];
      else expectedEnv[key] = originalEnv[key];
    }
    const envDiff = envDifference(expectedEnv, after.env, before ? undefined : importKeys);
    if (Object.keys(envDiff).length) violations.push(['environment', envDiff]);
    const failures = cleanupErrors.map((message) => `${file}: after hook failed: ${message}`);
    for (const [invariant, diff] of violations) {
      // Environment values may contain credentials: only key names/presence
      // and whether the value changed are printed.
      const message = `test-isolation: ${file}: ${invariant}: ${JSON.stringify(diff)}`;
      const allowance = allowances[file]?.[invariant];
      let allowed = false;
      if (invariant === 'gen' && allowance && diff.every(({path, error}) => typeof path === 'string' && !error)) {
        const paths = [...new Set(diff.map(({path}) => path))];
        // Every path must fit an identity; every matching identity must stay
        // within its own bound, even when identities overlap.
        allowed = paths.every((path) => allowance.files.some((entry) => entry.path === path || (entry.prefix && path.startsWith(entry.prefix)))) &&
          allowance.files.every((entry) => paths.filter((path) => entry.path === path || (entry.prefix && path.startsWith(entry.prefix))).length <= entry.maxCount);
      }
      if (invariant === 'temporary-roots' && allowance) {
        const counts = new Map(allowance.roots.map(({prefix}) => [prefix, 0]));
        allowed = after.resources.roots.every((path) => {
          const identity = allowance.roots.find(({prefix}) => basename(path).startsWith(prefix));
          if (!identity) return false;
          counts.set(identity.prefix, counts.get(identity.prefix) + 1);
          return counts.get(identity.prefix) <= identity.maxCount;
        });
      }
      if (invariant === 'generation' && allowance && before && generationBaseline?.tree === before.generation.tree && !after.generation.error && after.generation.live !== null) {
        if (allowance.drift.kind === 'restored-inputs') {
          allowed = activeDrift?.live === after.generation.live && activeDrift?.tree === after.generation.tree && activeDrift?.inactive === after.generation.inactive;
        } else if (generationBaseline && after.generation.live === before.generation.live) {
          const snapshot = await inputSnapshot();
          const changed = changedInputs(generationBaseline.digests, snapshot.digests);
          const drift = allowance.drift;
          allowed = changed.length > 0 && changed.length <= drift.maxCount && changed.every((path) => {
            const name = relative(process.cwd(), path).replaceAll('\\', '/');
            return !generationBaseline.digests.has(path) && snapshot.digests.has(path) && drift.paths.includes(name);
          });
          if (allowed) {
            const {hashOf} = await moduleOf('osd-build.mjs');
            allowed = hashOf(process.cwd(), undefined, {overlay: {exclude: changed}}) === generationBaseline.tree;
          }
        }
      }
      if (allowed) console.error(`${message} TEMPORARY ALLOW: ${JSON.stringify(allowance)}`);
      else { console.error(message); failures.push(message); }
    }
    if (intentional.has(file)) console.error(`test-isolation: ${file}: intentional generation mismatch: ${intentional.get(file)}`);
    const ms = baselineMs + proofMs + Number(process.hrtime.bigint() - started) / 1e6;
    costs.push(ms);
    console.log(`test-isolation: checked ${file} in ${ms.toFixed(3)} ms`);
    lastGeneration = after.generation;
    generationBaseline = undefined;
    activeDrift = undefined;
    current = undefined;
    resources.setOwner(undefined);
    intentional.delete(file);
    if (failures.length) { const error = new Error(failures.join('\n')); if (violations.length) error.code = 'OSD_TEST_ISOLATION'; throw error; }
  });
  const finalHook = wrapper._afterAll.at(-1);
  fileChecks.push({file, checked: () => checked, hook: finalHook});
  return result;
};
exports.mochaHooks = {
  async beforeAll() {
    this.timeout(30000);
    const {generationStateSnapshot} = await moduleOf('osd-build.mjs');
    lastGeneration = generationStateSnapshot();
    // Restored CI artifacts can name a different generation from this tree
    // (the hash includes linked toolchain paths). Report that once, without
    // assigning it to a file or changing the live link or any build inputs.
    if (lastGeneration.live !== lastGeneration.tree) {
      console.error(`test-isolation: run-setup: generation: ${JSON.stringify(lastGeneration)}`);
    }
  },
  async afterAll() {
    this.timeout(0);
    const missed = [];
    // Mocha omits a suite with no selected tests entirely. Its import may
    // still have changed the process; inspect it without running its cleanup.
    for (const entry of fileChecks.filter((entry) => !entry.checked())) {
      try { await new Promise((resolve, reject) => entry.hook.run((error) => error ? reject(error) : resolve())); }
      catch (error) { missed.push(error); }
    }
    const finalEnvDiff = envDifference(originalEnv, resources.environmentSnapshot());
    if (Object.keys(finalEnvDiff).length) {
      const message = `test-isolation: run-end: environment: ${JSON.stringify(finalEnvDiff)}`;
      console.error(message);
      missed.push(new Error(message));
    }
    const sorted = [...costs].sort((a, b) => a - b);
    const median = sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : 0;
    console.log(`test-isolation: ${costs.length} files checked; ${(costs.reduce((sum, ms) => sum + ms, 0)).toFixed(3)} ms total; median ${median.toFixed(3)} ms/file`);
    const genSorted = genCosts.map(({ms}) => ms).sort((a, b) => a - b);
    const genMedian = genSorted.length ? (genSorted[Math.floor((genSorted.length - 1) / 2)] + genSorted[Math.floor(genSorted.length / 2)]) / 2 : 0;
    console.log(`test-isolation: gen manifests: ${genCosts.length} boundaries; ${genCosts.at(0)?.files ?? 0} files at start; ${genCosts.reduce((sum, {ms}) => sum + ms, 0).toFixed(3)} ms total; median ${genMedian.toFixed(3)} ms/boundary`);
    console.log(`test-isolation: gen comparison/hash: ${genDiffMs.toFixed(3)} ms; gen observation total: ${(genDiffMs + genCosts.reduce((sum, {ms}) => sum + ms, 0)).toFixed(3)} ms`);
    if (missed.length) {
      const error = new Error(missed.map((error) => error.message).join('\n'));
      error.code = 'OSD_TEST_ISOLATION';
      throw error;
    }
  },
};
