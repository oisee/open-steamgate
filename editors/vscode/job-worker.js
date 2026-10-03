// A separate IPC guard owns the worker PID. Losing the extension host closes
// IPC even after SIGKILL; the guard then reaps its child before exiting.
const {spawn} = require('node:child_process');
const path = require('node:path');
const {EventEmitter} = require('node:events');
function workerEnabled(mode = 'auto', env = {}) {
  return mode !== 'off' && ['file', 'duckdb', 'postgres', 'hana'].includes(env.STG_DB)
    && env.STG_DB_PATH !== ':memory:';
}
function reap(child, graceMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), graceMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}
class JobWorker extends EventEmitter {
  constructor({cwd, env, script = path.join(cwd, 'tools/osd-batch-runs.mjs'), args = ['worker'], log = () => {}, backoffMs = 500, graceMs = 55000}) {
    super(); Object.assign(this, {cwd, env, script, args, log, backoffMs, graceMs});
    this.running = false; this.stopped = true; this.failures = 0;
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false; this.failures = 0; this.launch();
  }
  launch() {
    if (this.stopped) return;
    const child = spawn(process.execPath, [__filename, '--guard', this.script, String(this.graceMs), ...this.args],
      {cwd:this.cwd, env:this.env, detached:process.platform !== 'win32', stdio:['ignore','pipe','pipe','ipc']});
    this.child = child;
    child.stdout.on('data', d => this.log(d.toString()));
    child.stderr.on('data', d => this.log(d.toString()));
    const started = Date.now();
    let workerPid;
    child.on('message', m => {
      if (m?.pid) { workerPid = m.pid; this.running = true; this.emit('state'); }
      if (m === 'reaped') workerPid = undefined;
    });
    child.on('error', e => this.log(`OSD jobs: ${e.message}\n`));
    child.once('exit', async () => {
      // If the guard itself crashed, its child is still ours. Reap by PID
      // before restarting so two workers never overlap.
      if (workerPid) {
        try { process.kill(workerPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') this.log(error.message); }
      }
      this.child = undefined; this.running = false; this.emit('state');
      if (this.stopped) return;
      if (Date.now() - started > 30000) this.failures = 0;
      const wait = Math.min(30000, this.backoffMs * 2 ** Math.min(this.failures++, 10));
      this.log(`OSD jobs: worker exited; restarting in ${wait} ms\n`);
      this.timer = setTimeout(() => this.launch(), wait);
    });
  }
  async stop() {
    this.stopped = true; clearTimeout(this.timer);
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      // The guard must live until it has reaped the actual worker.
      const closed = new Promise(resolve => child.once('exit', resolve));
      if (child.connected) child.disconnect();
      await closed;
    }
    this.running = false;
  }
}
function jobsStatus(running, counts = {}) {
  return !running ? 'OSD jobs: worker stopped' : counts.running || counts.queued
    ? `OSD jobs: running ${counts.running ?? 0}, queued ${counts.queued ?? 0}` : 'OSD jobs: idle';
}
function jobsStatusBar(vscode, context, controller) {
  const output = vscode.window.createOutputChannel('OSD jobs');
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9);
  item.command = 'osd.showJobs'; item.show();
  context.subscriptions.push(output, item, vscode.commands.registerCommand('osd.showJobs', () => output.show(true)));
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    const launcher = controller.launcher;
    try {
      if (!launcher?.jobWorker?.running) { item.text = jobsStatus(false); return; }
      const answer = await fetch(`http://127.0.0.1:${launcher.port}/osd/batch-runs?counts=1`,
        {headers:{Authorization:`Bearer ${launcher.env.OSD_BATCH_READ_TOKEN}`}, signal:AbortSignal.timeout(3000)});
      if (!answer.ok) throw Error(`job counts: HTTP ${answer.status}`);
      item.text = jobsStatus(true, (await answer.json()).counts);
    } catch (error) { item.text = 'OSD jobs: status unavailable'; output.appendLine(error.message); }
    finally { busy = false; }
  };
  controller.jobsOutput = output;
  const timer = setInterval(tick, 2000); tick();
  context.subscriptions.push({dispose:() => clearInterval(timer)});
}
module.exports = {JobWorker, workerEnabled, jobsStatus, jobsStatusBar};
if (require.main === module && process.argv[2] === '--guard') {
  const [script, grace, ...args] = process.argv.slice(3);
  const child = spawn(process.execPath, [script, ...args], {cwd:process.cwd(), env:process.env, stdio:['ignore','inherit','inherit']});
  let stopping;
  const stop = () => { stopping ??= reap(child, Number(grace)); return stopping; };
  for (const signal of ['SIGTERM','SIGINT','SIGHUP']) process.on(signal, stop);
  process.on('disconnect', stop);
  child.once('spawn', () => { if (process.connected) process.send({pid:child.pid}); else stop(); });
  child.once('error', error => { console.error(error.message); process.exitCode = 1; if (process.connected) process.disconnect(); });
  child.once('exit', code => { if (process.connected) process.send('reaped'); process.exitCode = code ?? 1; if (process.connected) process.disconnect(); });
}
