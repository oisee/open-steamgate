// --require this module. Serial root afterAll is run-wide, not file-wide.
// Mocha emits pre/post-require around each awaited file import. Give each
// file its own suite, including its root hooks, before execution starts.
const Mocha = require('mocha');
const {relative, resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const resources = require('./osd-test-resources.cjs');
const allowances = require('./osd-test-isolation-allow.json');
resources.install();
let current;
const costs = [];
const fileChecks = [];
const intentional = new Map();
exports.allowGenerationMismatch = (reason) => {
  if (!current || typeof reason !== 'string' || !reason.trim()) throw new Error('allowGenerationMismatch needs a running file and a reason');
  intentional.set(current, reason);
};
const moduleOf = (name) => import(pathToFileURL(resolve(__dirname, name)).href);
const hooks = ['_beforeAll', '_beforeEach', '_afterEach', '_afterAll'];
const emit = Mocha.Suite.prototype.emit;
Mocha.Suite.prototype.emit = function (event, ...args) {
  if (!this.root || !['pre-require', 'post-require'].includes(event)) return emit.call(this, event, ...args);
  const file = relative(process.cwd(), args[1]).replaceAll('\\', '/');
  if (event === 'pre-require') {
    if (args[2]?.options?.parallel || args[2]?.options?.isWorker) throw new Error('osd-test-isolation requires serial mocha');
    resources.setOwner(file);
    this.osdLoading = {file, env: resources.environmentSnapshot(), suites: this.suites.length, tests: this.tests.length, onlySuites: this._onlySuites.length, onlyTests: this._onlyTests.length,
      hooks: Object.fromEntries(hooks.map((key) => [key, this[key].length]))};
    return emit.call(this, event, ...args);
  }
  const result = emit.call(this, event, ...args);
  const loading = this.osdLoading;
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
  wrapper.beforeAll('isolation baseline', async function () {
    this.timeout(30000);
    const began = process.hrtime.bigint();
    current = file;
    resources.setOwner(file);
    const {generationStateSnapshot} = await moduleOf('osd-build.mjs');
    before = {env: resources.environmentSnapshot(), generation: generationStateSnapshot(undefined, {hashTree: false})};
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
      try { await new Promise((resolve, reject) => hook.run((error) => error ? reject(error) : resolve())); }
      catch (error) { cleanupErrors.push(error.message); }
    }
    this.runnable(detector);
    this.timeout(30000);
    const started = process.hrtime.bigint();
    const [{dialogStateSnapshot}, {generationStateSnapshot}, {servingStateSnapshot}] = await Promise.all([
      moduleOf('osd-dialog-step.mjs'), moduleOf('osd-build.mjs'), moduleOf('osd-runtime.mjs')]);
    let generation;
    try { generation = generationStateSnapshot(); }
    catch (error) { generation = {root: process.cwd(), error: error.message}; }
    const after = {dialog: dialogStateSnapshot(), generation,
      serving: servingStateSnapshot(), resources: resources.resourceStateSnapshot(file), env: resources.environmentSnapshot()};
    const ownedPids = new Set(after.resources.children.map(({pid}) => pid));
    after.serving = after.serving.filter(({pid}) => ownedPids.has(pid));
    const violations = [];
    if (after.dialog.held || after.dialog.waiting || after.dialog.open.length) violations.push(['dialog', {before: {held: false, waiting: 0, open: []}, after: after.dialog}]);
    if ((after.generation.error || after.generation.live !== after.generation.tree || (before?.generation.live && after.generation.live === null)) && !intentional.has(file)) violations.push(['generation', {before: before?.generation, after: after.generation}]);
    if (after.resources.children.length || after.serving.length) violations.push(['children', {before: [], after: {tracked: after.resources.children, serving: after.serving}}]);
    if (after.resources.roots.length) violations.push(['temporary-roots', {before: [], after: after.resources.roots}]);
    const envDiff = {};
    for (const key of new Set([...Object.keys(before?.env ?? loading.env), ...Object.keys(loading.env), ...Object.keys(after.env)])) {
      const imported = loading.env[key] !== registrationEnv[key];
      if (!before && !imported) continue; // no execution: only import-time edits belong to this file
      const expected = imported ? loading.env[key] : before.env[key];
      if (expected !== after.env[key]) envDiff[key] = {before: expected ?? null, after: after.env[key] ?? null};
    }
    if (Object.keys(envDiff).length) violations.push(['environment', envDiff]);
    const failures = cleanupErrors.map((message) => `${file}: after hook failed: ${message}`);
    for (const [invariant, diff] of violations) {
      // Environment values may contain credentials: only key names/presence
      // and whether the value changed are printed.
      const evidence = invariant === 'environment' ? Object.fromEntries(Object.entries(diff).map(([key, value]) => [key, {before: value.before === null ? 'absent' : 'set', after: value.after === null ? 'absent' : 'set', changed: true}])) : diff;
      const message = `test-isolation: ${file}: ${invariant}: ${JSON.stringify(evidence)}`;
      const allowance = allowances[file]?.[invariant];
      const allowed = invariant === 'environment'
        ? allowance && Object.keys(diff).every((key) => typeof allowance[key] === 'string' && allowance[key].trim())
        : typeof allowance === 'string' && allowance.trim();
      if (allowed) console.error(`${message} TEMPORARY ALLOW: ${JSON.stringify(allowance)}`);
      else { console.error(message); failures.push(message); }
    }
    if (intentional.has(file)) console.error(`test-isolation: ${file}: intentional generation mismatch: ${intentional.get(file)}`);
    const ms = baselineMs + Number(process.hrtime.bigint() - started) / 1e6;
    costs.push(ms);
    console.log(`test-isolation: checked ${file} in ${ms.toFixed(3)} ms`);
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
  async afterAll() {
    this.timeout(0);
    const missed = [];
    // Mocha omits a suite with no selected tests entirely. Its import may
    // still have changed the process; inspect it without running its cleanup.
    for (const entry of fileChecks.filter((entry) => !entry.checked())) {
      try { await new Promise((resolve, reject) => entry.hook.run((error) => error ? reject(error) : resolve())); }
      catch (error) { missed.push(error); }
    }
    const sorted = [...costs].sort((a, b) => a - b);
    const median = sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : 0;
    console.log(`test-isolation: ${costs.length} files checked; ${(costs.reduce((sum, ms) => sum + ms, 0)).toFixed(3)} ms total; median ${median.toFixed(3)} ms/file`);
    if (missed.length) {
      const error = new Error(missed.map((error) => error.message).join('\n'));
      error.code = 'OSD_TEST_ISOLATION';
      throw error;
    }
  },
};
