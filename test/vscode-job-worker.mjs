import {expect} from 'chai';
import {createRequire} from 'node:module';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
const require = createRequire(import.meta.url);
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await pause(20); } throw Error('timed out'); }
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
describe('VS Code job worker supervision', function () {
  this.timeout(15000);
  let dir, worker;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'job-supervisor-')); });
  afterEach(async () => { await worker?.stop(); worker = undefined; rmSync(dir, {recursive:true, force:true}); });
  it('classifies shared and memory databases and off overrides on', () => {
    const {workerEnabled, jobsStatus} = require('../editors/vscode/job-worker.js');
    expect(jobsStatus(false)).to.equal('OSD jobs: worker stopped');
    expect(jobsStatus(true, {running:0,queued:0})).to.equal('OSD jobs: idle');
    expect(jobsStatus(true, {running:2,queued:3})).to.equal('OSD jobs: running 2, queued 3');
    expect(workerEnabled('auto', {STG_DB:'file', STG_DB_PATH:'/tmp/jobs.db'})).to.equal(true);
    for (const mode of ['auto', 'on']) {
      for (const db of ['duckdb','postgres','hana','sqlite']) expect(workerEnabled(mode, {STG_DB:db, STG_DB_PATH:'/tmp/jobs.db'}), `${mode} ${db}`).to.equal(false);
      for (const dbPath of [undefined, '', ':memory:']) expect(workerEnabled(mode, {STG_DB:'file', STG_DB_PATH:dbPath})).to.equal(false);
    }
    expect(workerEnabled('on', {STG_DB:'file', STG_DB_PATH:':memory:'})).to.equal(false);
    expect(workerEnabled('auto', {STG_DB:'sqlite'})).to.equal(false);
    expect(workerEnabled('off', {STG_DB:'file'})).to.equal(false);
  });
  it('inherits the exact env and cwd, restarts after death, and cancels restart on stop', async () => {
    const {JobWorker} = require('../editors/vscode/job-worker.js');
    const script = join(dir, 'fake.cjs');
    writeFileSync(script, `console.log(JSON.stringify({pid:process.pid,cwd:process.cwd(),db:process.env.STG_DB_PATH,packs:process.env.OSD_PACKS,sid:process.env.OSD_SID})); setInterval(()=>{},100);`);
    const lines = [];
    worker = new JobWorker({cwd:dir, env:{...process.env, STG_DB:'file', STG_DB_PATH:join(dir,'db'), OSD_PACKS:'packs', OSD_SID:'TST'}, script, backoffMs:30, log:s => { try { lines.push(JSON.parse(s)); } catch {} }});
    worker.start();
    await until(() => lines.length === 1);
    expect(lines[0]).to.include({cwd:dir, db:join(dir,'db'),packs:'packs',sid:'TST'});
    process.kill(lines[0].pid, 'SIGKILL');
    await until(() => lines.length === 2);
    await worker.stop();
    expect(alive(lines[1].pid)).to.equal(false);
    await pause(100);
    expect(lines).to.have.length(2);
    expect(worker.running).to.equal(false);
    worker.start();
    await until(() => lines.length === 3);
    process.kill(worker.child.pid, 'SIGKILL');
    await until(() => lines.length === 4);
    expect(alive(lines[2].pid)).to.equal(false);
    await worker.stop();
    expect(alive(lines[3].pid)).to.equal(false);
  });
  it('reloads on serving generation changes after an active job finishes, and stop wins a pending reload', async () => {
    const {JobWorker} = require('../editors/vscode/job-worker.js');
    const {Launcher} = require('../editors/vscode/launcher.js');
    const script = join(dir, 'active.cjs');
    writeFileSync(script, `console.log('ready'); process.on('SIGTERM',()=>setTimeout(()=>{console.log('finished');process.exit(0);},100)); setInterval(()=>{},100);`);
    const lines = [];
    worker = new JobWorker({cwd:dir,env:process.env,script,graceMs:2000,log:s=>lines.push(s.trim())});
    const launcher = new Launcher({osdHome:dir,storageDir:join(dir,'storage')});
    launcher.jobWorker = worker; launcher.state = 'running'; launcher.generation = 'old';
    worker.start();
    await until(()=>lines.length === 1);
    const first = worker.child.pid;
    await launcher.refreshJobsGeneration({ready:false,generation:'new'});
    expect(worker.child.pid).to.equal(first);
    await launcher.refreshJobsGeneration({ready:true,generation:'new'});
    await until(()=>lines.length === 3);
    expect(lines).to.deep.equal(['ready','finished','ready']);
    expect(worker.child.pid).not.to.equal(first);
    const second = worker.child.pid;
    await launcher.refreshJobsGeneration({ready:true,generation:'new'});
    expect(worker.child.pid).to.equal(second);
    const changing = launcher.refreshJobsGeneration({ready:true,generation:'newer'});
    await launcher.stop(); await changing;
    await pause(100);
    expect(lines).to.deep.equal(['ready','finished','ready','finished']);
    expect(worker.running).to.equal(false);
  });
  it('coalesces twelve refreshes and drains beyond the shutdown grace', async () => {
    const {JobWorker} = require('../editors/vscode/job-worker.js');
    const {Launcher} = require('../editors/vscode/launcher.js');
    const script = join(dir, 'refresh.cjs');
    writeFileSync(script, `console.log('ready '+process.pid); process.on('SIGTERM',()=>setTimeout(()=>{console.log('finished');process.exit(0)},150));setInterval(()=>{},100);`);
    const pids = []; let finished = 0, launches = 0;
    worker = new JobWorker({cwd:dir, env:process.env, script, graceMs:30,
      log:s => { if (s.startsWith('ready')) pids.push(Number(s.split(' ')[1])); if (s.includes('finished')) finished++; }});
    const launch = worker.launch.bind(worker);
    worker.launch = () => { launches++; launch(); };
    const launcher = new Launcher({osdHome:dir,storageDir:dir});
    launcher.state = 'running'; launcher.generation = 'old'; launcher.jobWorker = worker;
    worker.start(); await until(() => pids.length === 1);
    await Promise.all(Array.from({length:12}, (_, i) => launcher.refreshJobsGeneration({ready:true,generation:String(i)})));
    await until(() => pids.length === 2);
    expect(finished).to.equal(1);
    expect(launches).to.equal(2);
    await launcher.stop();
    expect(pids.filter(alive)).to.deep.equal([]);
  });
  it('leases a database to one window, and releases it on shutdown', async () => {
    const {JobWorker} = require('../editors/vscode/job-worker.js');
    const script = join(dir, 'lease.cjs');
    writeFileSync(script, `console.log('ready');setInterval(()=>{},100);`);
    const env = {...process.env, STG_DB:'file', STG_DB_PATH:join(dir,'db')};
    worker = new JobWorker({cwd:dir, env, script});
    const second = new JobWorker({cwd:dir, env, script});
    try {
      worker.start(); await until(() => worker.running);
      second.start();
      expect(second.otherWindow).to.equal(true);
      expect(second.child).to.equal(undefined);
      await second.stop(); // cannot release the first window's lease
      second.start(); expect(second.child).to.equal(undefined);
      await worker.stop(); second.start();
      await until(() => second.running);
      expect(second.otherWindow).to.equal(false);
    } finally { await second.stop(); }
  });
  it('reclaims a lease whose owning process no longer exists', async () => {
    const {JobWorker} = require('../editors/vscode/job-worker.js');
    const script = join(dir, 'lease.cjs');
    const db = join(dir, 'db');
    writeFileSync(script, `setInterval(()=>{},100);`);
    writeFileSync(db + '.worker.lock', JSON.stringify({pid:2147483647,token:'stale'}));
    worker = new JobWorker({cwd:dir,env:{...process.env,STG_DB:'file',STG_DB_PATH:db},script});
    worker.start(); await until(() => worker.running);
    expect(worker.otherWindow).to.equal(false);
    await worker.stop();
  });
  it('marks a killed job interrupted and lets a later job claim', async () => {
    const {JobWorker} = require('../editors/vscode/job-worker.js');
    const {BatchRuns} = await import('../tools/osd-batch-runs.mjs');
    const env = {...process.env, STG_DB:'file', STG_DB_PATH:join(dir,'db'), OSD_OPERATIONS_DB:join(dir,'ops.sqlite')};
    const store = new BatchRuns(dir, env);
    // Use the real module name so supervisor recovery follows the production path.
    const script = join(dir, 'osd-batch-runs.mjs');
    const moduleURL = new URL('../tools/osd-batch-runs.mjs', import.meta.url).href;
    writeFileSync(script, `import {BatchRuns} from ${JSON.stringify(moduleURL)}; export {BatchRuns}; import {pathToFileURL} from 'node:url'; if (pathToFileURL(process.argv[1]).href === import.meta.url) {const store = new BatchRuns(process.cwd(),process.env);store.claimNext();store.close();process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},100);}`);
    const run = store.enqueue({program:'ZGG_EX_012',generation:'test'});
    const next = store.enqueue({program:'ZGG_EX_012',generation:'test'});
    let ready = false;
    worker = new JobWorker({cwd:dir,env,script,graceMs:30,log:s => { if (s.includes('ready')) ready = true; }});
    try {
      worker.start(); await until(() => ready); await worker.stop();
      expect(store.get(run.id).state).to.equal('INTERRUPTED');
      expect(store.claimNext().run.id).to.equal(next.id);
    } finally { store.close(); }
  });
  it('kills an unresponsive worker by PID after the shutdown grace', async () => {
    const {JobWorker} = require('../editors/vscode/job-worker.js');
    const script = join(dir,'stubborn.cjs');
    writeFileSync(script, `process.on('SIGTERM',()=>{}); console.log(process.pid); setInterval(()=>{},100);`);
    let pid;
    worker = new JobWorker({cwd:dir,env:process.env,script,graceMs:50,log:s => { pid = Number(s.trim()); }});
    worker.start();
    await until(() => pid > 0);
    await worker.stop();
    expect(alive(pid)).to.equal(false);
  });
  it('reaps the worker when the extension host is killed', async () => {
    const script = join(dir, 'fake.cjs');
    writeFileSync(script, 'console.log(process.pid); setInterval(()=>{},100);');
    const hostScript = join(dir,'host.cjs');
    const module = require.resolve('../editors/vscode/job-worker.js');
    writeFileSync(hostScript, `const {JobWorker}=require(${JSON.stringify(module)}); new JobWorker({cwd:${JSON.stringify(dir)},env:process.env,script:${JSON.stringify(script)},log:s=>process.stdout.write(s)}).start();`);
    const host = spawn(process.execPath,[hostScript],{stdio:['ignore','pipe','pipe']});
    let pid;
    host.stdout.on('data',d => { pid = Number(d.toString().trim()); });
    try { await until(() => pid > 0); process.kill(host.pid,'SIGKILL'); await until(() => !alive(pid)); }
    finally { if (alive(host.pid)) process.kill(host.pid,'SIGKILL'); if (pid && alive(pid)) process.kill(pid,'SIGKILL'); }
  });
});


describe('VS Code jobs status poll grace and debugging', () => {
  let savedFetch, savedInterval, savedClearInterval, tick, start, end, item, subscriptions, api, controller, messages, savedNow, now;
  beforeEach(() => {
    savedNow = Date.now; now = 0; Date.now = () => now;
    savedFetch = globalThis.fetch;
    savedInterval = globalThis.setInterval;
    savedClearInterval = globalThis.clearInterval;
    globalThis.setInterval = fn => { tick = fn; return 1; };
    globalThis.clearInterval = () => {};
    item = {show() {}, dispose() {}};
    messages = [];
    subscriptions = [];
    api = {
      StatusBarAlignment: {Left: 1},
      ThemeColor: class { constructor(id) { this.id = id; } },
      window: {
        createOutputChannel: () => ({appendLine: message => messages.push(message), show() {}, dispose() {}}),
        createStatusBarItem: () => item,
      },
      commands: {registerCommand: () => ({dispose() {}})},
      debug: {
        onDidStartDebugSession: fn => { start = fn; return {dispose() {}}; },
        onDidTerminateDebugSession: fn => { end = fn; return {dispose() {}}; },
      },
    };
    controller = {launcher: {port: 8080, inspectPort: 9480, env: {}, jobWorker: {running: true}}};
    globalThis.fetch = async () => { throw Error('worker unavailable'); };
  });
  afterEach(() => {
    for (const subscription of subscriptions) subscription.dispose();
    Date.now = savedNow;
    globalThis.fetch = savedFetch;
    globalThis.setInterval = savedInterval;
    globalThis.clearInterval = savedClearInterval;
  });
  const install = async () => {
    require('../editors/vscode/job-worker.js').jobsStatusBar(api, {subscriptions}, controller);
    await new Promise(resolve => setImmediate(resolve));
  };
  it('shows a neutral timeout for an already active system session and recovers after termination', async () => {
    const session = {name: 'OSD: ABAP (9480)'};
    api.debug.activeDebugSession = session;
    globalThis.fetch = async () => { throw new DOMException('timed out', 'TimeoutError'); };
    await install();
    expect(item.text).to.equal('OSD jobs: paused (debugger)');
    expect(item.backgroundColor).to.equal(undefined);
    expect(messages).to.deep.equal([]);
    globalThis.fetch = async () => ({ok: true, json: async () => ({counts: {running: 0, queued: 0}})});
    api.debug.activeDebugSession = undefined;
    end(session);
    await new Promise(resolve => setImmediate(resolve));
    expect(item.text).to.equal('OSD jobs: idle');
    expect(item.backgroundColor).to.equal(undefined);
  });
  it('tracks system sessions even when another session is focused; repeated timeouts stay paused', async () => {
    await install();
    expect(item.backgroundColor).to.equal(undefined);
    const session = {name: 'custom attach', configuration: {request: 'attach', port: 9480}};
    start(session);
    api.debug.activeDebugSession = {name: 'unrelated'};
    globalThis.fetch = async (_url, options) => {
      expect(options.signal).to.be.instanceOf(AbortSignal);
      throw new DOMException('timed out', 'TimeoutError');
    };
    await tick();
    expect(item.text).to.equal('OSD jobs: paused (debugger)');
    expect(item.backgroundColor).to.equal(undefined);
    for (const time of [7500, 15000, 60000]) { now = time; await tick(); }
    expect(item.text).to.equal('OSD jobs: paused (debugger)');
    expect(item.backgroundColor).to.equal(undefined);
    expect(messages).to.deep.equal([]);
    globalThis.fetch = async () => ({ok: false, status: 503});
    end(session);
    await new Promise(resolve => setImmediate(resolve));
    expect(item.text).to.equal('OSD jobs: busy');
    expect(item.backgroundColor).to.equal(undefined);
  });
  for (const [label, fail] of [
    ['connection reset', async () => { throw new TypeError('fetch failed', {cause: Object.assign(Error('reset'), {code: 'ECONNRESET'})}); }],
    ['socket hang-up', async () => { throw Error('socket hang up'); }],
    ['HTTP 503', async () => ({ok: false, status: 503})],
    ['HTTP 404', async () => ({ok: false, status: 404})],
    ['parse error', async () => ({ok: true, json: async () => { throw new SyntaxError('invalid JSON'); }})],
  ]) {
    it(`counts ${label} as misses with an active attach session`, async () => {
      api.debug.activeDebugSession = {configuration: {request: 'attach', port: 9480, restart: true}};
      globalThis.fetch = fail;
      await install();
      now = 15000; await tick(); // Enough time, but only two misses.
      expect(item.text).to.equal('OSD jobs: busy');
      expect(item.backgroundColor).to.equal(undefined);
      await tick();
      expect(item.text).to.equal('OSD jobs: status unavailable');
      expect(item.backgroundColor.id).to.equal('statusBarItem.errorBackground');
      expect(messages).to.have.length(1);
    });
  }
  it('uses the grace outside this system and clears the background on success or worker stop', async () => {
    api.debug.activeDebugSession = {name: 'OSD: ABAP (9481)'};
    await install();
    expect(item.text).to.equal('OSD jobs: busy');
    expect(item.backgroundColor).to.equal(undefined);
    globalThis.fetch = async () => ({ok: true, json: async () => ({counts: {running: 2, queued: 1}})});
    await tick();
    expect(item.text).to.equal('OSD jobs: running 2, queued 1');
    expect(item.backgroundColor).to.equal(undefined);
    globalThis.fetch = async () => { throw Error('failed'); };
    await tick();
    controller.launcher.jobWorker.running = false;
    await tick();
    expect(item.text).to.equal('OSD jobs: worker stopped');
    expect(item.backgroundColor).to.equal(undefined);
  });
  it('keeps the last counts through a timed-out first classrun without a debugger', async () => {
    globalThis.fetch = async () => ({ok: true, json: async () => ({counts: {running: 2, queued: 1}})});
    await install();
    globalThis.fetch = async () => { throw new DOMException('timed out', 'TimeoutError'); };
    now = 3000; await tick();
    expect(item.text).to.equal('OSD jobs: running 2, queued 1');
    expect(item.backgroundColor).to.equal(undefined);
    expect(messages).to.deep.equal([]);
    now = 4400;
    globalThis.fetch = async () => ({ok: true, json: async () => ({counts: {running: 0, queued: 0}})});
    await tick();
    expect(item.text).to.equal('OSD jobs: idle');
  });
  it('requires both three consecutive misses and fifteen seconds, and success resets the grace', async () => {
    await install();
    now = 1000; await tick();
    now = 2000; await tick();
    expect(item.backgroundColor).to.equal(undefined);
    now = 14999; await tick();
    expect(item.backgroundColor).to.equal(undefined);
    now = 15000; await tick();
    expect(item.text).to.equal('OSD jobs: status unavailable');
    expect(item.backgroundColor.id).to.equal('statusBarItem.errorBackground');
    globalThis.fetch = async () => ({ok: true, json: async () => ({counts: {running: 0, queued: 0}})});
    await tick();
    globalThis.fetch = async () => { throw Error('dead system'); };
    now = 20000; await tick();
    now = 40000; await tick(); // Enough time, but only two misses.
    expect(item.text).to.equal('OSD jobs: idle');
    expect(item.backgroundColor).to.equal(undefined);
    await tick();
    expect(item.backgroundColor.id).to.equal('statusBarItem.errorBackground');
    controller.launcher.jobWorker.running = false; await tick();
    expect(item.text).to.equal('OSD jobs: worker stopped');
    controller.launcher.jobWorker.running = true; await tick();
    expect(item.text).to.equal('OSD jobs: busy');
    expect(item.backgroundColor).to.equal(undefined);
  });
  it('turns an unreachable system red after sustained connection refusals with an active attach session', async () => {
    api.debug.activeDebugSession = {configuration: {request: 'attach', port: 9480, restart: true}};
    const {createServer} = await import('node:http');
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    controller.launcher.port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = savedFetch;
    await install();
    // Wait for the real connection refusal (install only yields one event turn).
    await until(() => item.text === 'OSD jobs: busy');
    now = 7500; await tick();
    expect(item.backgroundColor).to.equal(undefined);
    now = 15000; await tick();
    expect(item.text).to.equal('OSD jobs: status unavailable');
    expect(item.backgroundColor.id).to.equal('statusBarItem.errorBackground');
    expect(messages).to.have.length(1);
  });

});
