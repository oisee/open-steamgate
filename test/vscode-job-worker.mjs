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
