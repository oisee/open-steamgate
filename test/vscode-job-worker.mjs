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
    for (const db of ['file','duckdb','postgres','hana']) expect(workerEnabled('auto', {STG_DB:db, STG_DB_PATH:'/tmp/jobs.db'})).to.equal(true);
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
