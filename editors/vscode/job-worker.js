// The supervisor records the worker process group before opening guard IPC.
// Losing the extension host closes IPC even after SIGKILL; the guard drains
// or kills that group and recovers its interrupted operations before exiting.
const {spawn} = require('node:child_process');
const path = require('node:path');
const {EventEmitter} = require('node:events');
function workerEnabled(mode = 'auto', env = {}) {
  return mode !== 'off' && env.STG_DB === 'file'
    && typeof env.STG_DB_PATH === 'string' && env.STG_DB_PATH !== ''
    && env.STG_DB_PATH !== ':memory:';
}
const fs = require('node:fs');
const {pathToFileURL} = require('node:url');
const {randomUUID} = require('node:crypto');
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
}
function signalGroup(pid, signal) {
  try { process.kill(process.platform === 'win32' ? pid : -pid, signal); }
  catch (e) { if (e.code !== 'ESRCH') throw e; }
}
function send(child, message) {
  if (child.connected) child.send(message, () => {}); // disconnect can race this write
}
class JobWorker extends EventEmitter {
  constructor({cwd, env, script = path.join(cwd, 'tools/osd-batch-runs.mjs'), args = ['worker'], log = () => {}, backoffMs = 500, graceMs = 55000}) {
    super(); Object.assign(this, {cwd, env, script, args, log, backoffMs, graceMs});
    this.running = false; this.stopped = true; this.failures = 0;
  }
  acquireLease() {
    if (this.lease || !workerEnabled('auto', this.env)) return true;
    const file = path.resolve(this.cwd, this.env.STG_DB_PATH) + '.worker.lock';
    fs.mkdirSync(path.dirname(file), {recursive:true});
    const token = randomUUID();
    const create = () => {
      try { fs.writeFileSync(file, JSON.stringify({pid:process.pid, token}), {flag:'wx', mode:0o600}); }
      catch (e) { if (e.code === 'EEXIST') return false; throw e; }
      this.lease = {file, token}; return true;
    };
    if (create()) return true;
    // Serialize stale-lock reclamation as well as initial acquisition.
    const reclaim = file + '.reclaim';
    try { fs.mkdirSync(reclaim); } catch (e) { if (e.code === 'EEXIST') return false; throw e; }
    try {
      let owner;
      try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (e) { if (e.code !== 'ENOENT') return false; }
      if (owner && (alive(owner.pid) || (owner.guardPid && alive(owner.guardPid)))) return false;
      // A crashed supervisor/guard pair must not leave a group beside the
      // next window. A retry acquires only once the old worker has gone.
      if (owner?.workerPid && alive(owner.workerPid)) {
        signalGroup(owner.workerPid, 'SIGKILL'); return false;
      }
      fs.rmSync(file, {force:true});
      return create();
    } finally { fs.rmdirSync(reclaim); }
  }
  recordLease(workerPid, guardPid) {
    if (!this.lease) return;
    const {file, token} = this.lease;
    const temp = `${file}.${token}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({pid:process.pid, token, workerPid, guardPid}), {flag:'wx', mode:0o600});
    fs.renameSync(temp, file);
  }
  releaseLease() {
    if (!this.lease) return;
    const {file, token} = this.lease;
    if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.unlinkSync(file);
    this.lease = undefined;
  }
  start() {
    if (!this.stopped || this.closing) return;
    if (!this.acquireLease()) {
      this.otherWindow = true; this.log('OSD jobs: jobs handled by another window\n'); this.emit('state'); return;
    }
    this.otherWindow = false; this.stopped = false; this.failures = 0; this.launch();
  }
  launch() {
    if (this.stopped || this.child) return;
    // Record the PID synchronously before establishing any guard IPC. The
    // actual worker owns its process group, including any descendants.
    const worker = spawn(process.execPath, [this.script, ...this.args],
      {cwd:this.cwd, env:this.env, detached:process.platform !== 'win32', stdio:['ignore','pipe','pipe']});
    this.workerPid = worker.pid;
    this.recordLease(worker.pid);
    const exited = new Promise(resolve => {
      worker.once('exit', resolve);
      worker.once('error', e => { this.log(`OSD jobs: ${e.message}\n`); resolve(); });
    });
    worker.stdout.on('data', d => this.log(d.toString()));
    worker.stderr.on('data', d => this.log(d.toString()));
    const child = spawn(process.execPath, [__filename, '--guard', String(worker.pid), String(this.graceMs), this.script],
      {cwd:this.cwd, env:this.env, stdio:['ignore','ignore','pipe','ipc']});
    this.child = child;
    this.recordLease(worker.pid, child.pid);
    child.stderr.on('data', d => this.log(d.toString()));
    const started = Date.now();
    worker.once('spawn', () => { this.running = true; this.emit('state'); });
    worker.once('exit', () => send(child, 'exited'));
    child.on('error', e => this.log(`OSD jobs: ${e.message}\n`));
    this.closed = new Promise(resolve => child.once('close', async () => {
      // Also reap descendants after a normal exit, before any replacement.
      if (worker.pid) signalGroup(worker.pid, 'SIGKILL');
      await exited;
      try { await this.recoverInterrupted(); }
      catch (e) { this.log(`OSD jobs: recovery failed: ${e.message}\n`); this.stopped = true; }
      this.child = undefined; this.workerPid = undefined;
      this.running = false; this.emit('state'); resolve();
      if (this.stopped) return;
      if (Date.now() - started > 30000) this.failures = 0;
      const wait = Math.min(30000, this.backoffMs * 2 ** Math.min(this.failures++, 10));
      this.log(`OSD jobs: worker exited; restarting in ${wait} ms\n`);
      this.timer = setTimeout(() => this.launch(), wait);
    }));
  }
  async recoverInterrupted(pid = this.workerPid) {
    if (!pid || path.basename(this.script) !== 'osd-batch-runs.mjs' || !workerEnabled('auto', this.env)) return;
    const {BatchRuns} = await import(pathToFileURL(this.script).href);
    const store = new BatchRuns(this.cwd, this.env);
    try {
      const rows = store.db.prepare(`SELECT id FROM batch_runs WHERE state = 'RUNNING'
        AND queued_at IS NOT NULL AND worker_pid = ?
        AND (source_db IS NULL OR source_db = ?)`).all(pid, path.resolve(this.cwd, this.env.STG_DB_PATH));
      for (const row of rows) store.interruptQueued(row.id);
    } finally { store.close(); }
  }
  async stop({refresh = false} = {}) {
    this.stopped = true; clearTimeout(this.timer);
    if (this.child) send(this.child, refresh ? 'refresh' : 'shutdown');
    if (!this.closing) {
      this.closing = (async () => { await this.closed; this.running = false; })();
    }
    await this.closing; this.closing = undefined;
    if (!refresh) this.releaseLease();
  }
}
function jobsStatus(running, counts = {}) {
  return !running ? 'OSD jobs: worker stopped' : counts.running || counts.queued
    ? `OSD jobs: running ${counts.running ?? 0}, queued ${counts.queued ?? 0}` : 'OSD jobs: idle';
}
// Render only reader-facing fields; identities, hashes and selection values stay raw.
function jobsSummary(runs, now = Date.now()) {
  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const time = value => Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : 'unknown';
  const duration = run => {
    const start = Date.parse(run.startedAt);
    const end = run.endedAt ? Date.parse(run.endedAt) : run.state === 'RUNNING' ? now : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return '—';
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };
  const ordered = [...runs].sort((a, b) =>
    (Date.parse(b.queuedAt || b.startedAt) || 0) - (Date.parse(a.queuedAt || a.startedAt) || 0));
  return ordered.map(run => {
    const state = run.state === 'COMPLETED' ? 'DONE' : text(run.state) || 'UNKNOWN';
    const failed = state === 'FAILED' || state === 'INTERRUPTED';
    const counts = [];
    if (run.steps?.length) counts.push(`${run.steps.filter(step => ['DONE', 'COMPLETED'].includes(step.state)).length}/${run.steps.length} steps done`);
    if (Number.isFinite(run.outputBytes)) counts.push(`${run.outputBytes} output bytes`);
    const reason = failed ? ` | Reason: ${text(run.detail) || text(run.resultStatus) || 'No reason recorded'}` : '';
    return `${failed ? '! ' : ''}${text(run.jobName) || text(run.program) || 'Unnamed job'} | ${state} | ` +
      `Start: ${run.startedAt ? time(run.startedAt) : 'not started'} | Duration: ${duration(run)}` +
      (run.queuedAt ? ` | Queued: ${time(run.queuedAt)}` : '') +
      (counts.length ? ` | ${counts.join(', ')}` : '') + reason;
  }).join('\n') || 'No jobs recorded.';
}
function jobsStatusBar(vscode, context, controller) {
  const output = vscode.window.createOutputChannel('OSD jobs');
  const raw = vscode.window.createOutputChannel('OSD jobs raw log');
  let disposed = false, summaryShown = false, summaryBusy = false;
  const refreshSummary = async () => {
    if (disposed || summaryBusy) return;
    summaryBusy = true;
    const launcher = controller.launcher;
    let summary;
    try {
      if (!workerEnabled(launcher?.jobsWorkerMode, launcher?.env)) {
        summary = 'Jobs unavailable: enable the worker with a file SQLite database.';
      } else {
        const answer = await fetch(`http://127.0.0.1:${launcher.port}/osd/batch-runs?limit=200`,
          {headers:{Authorization:`Bearer ${launcher.env.OSD_BATCH_READ_TOKEN}`}, signal:AbortSignal.timeout(3000)});
        if (disposed) return;
        if (!answer.ok) throw Error(`HTTP ${answer.status}`);
        summary = 'OSD jobs — latest 200 runs, newest first\nShow raw job log: command palette or What is running?\n\n' +
          jobsSummary((await answer.json()).runs);
      }
    } catch (error) { summary = `Job summary unavailable: ${error.message}. Use Show raw job log for worker diagnostics.`; }
    finally { summaryBusy = false; }
    if (disposed || controller.launcher !== launcher) return;
    output.clear(); output.appendLine(summary);
  };
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9);
  item.command = 'osd.openJobsPanel';
  context.subscriptions.push(output, raw, item,
    vscode.commands.registerCommand('osd.showJobs', async () => {
      if (disposed) return;
      summaryShown = true; await refreshSummary(); if (!disposed) output.show(true);
    }),
    vscode.commands.registerCommand('osd.showRawJobLog', () => { if (!disposed) raw.show(true); }));
  const sessions = new Set(controller.debugSessions ?? []);
  const isSystemSession = (session) => {
    const port = controller.debuggerState?.systemPort ?? controller.launcher?.inspectPort;
    if (!port) return false;
    for (let current = session; current; current = current.parentSession) {
      if (current.name === `OSD: ABAP (${port})` ||
          (current.configuration?.request === 'attach' && current.configuration.port === port)) return true;
    }
    return false;
  };
  const debugging = () => [vscode.debug?.activeDebugSession, ...sessions].some(isSystemSession);
  let busy = false, misses = 0, firstMiss, lastKnown, observedLauncher;
  const resetMisses = () => { misses = 0; firstMiss = undefined; };
  const tick = async () => {
    if (disposed || busy) return;
    busy = true;
    const launcher = controller.launcher;
    let panelCounts, pollHealth = 'unavailable';
    if (launcher !== observedLauncher) {
      observedLauncher = launcher; lastKnown = undefined; resetMisses();
    }
    try {
      if (!workerEnabled(launcher?.jobsWorkerMode, launcher?.env)) { item.hide(); return; }
      item.show();
      item.tooltip = 'Open jobs panel';
      if (!launcher?.jobWorker?.otherWindow && !launcher?.jobWorker?.running) { resetMisses(); lastKnown = undefined; item.text = jobsStatus(false); item.backgroundColor = undefined; return; }
      const answer = await fetch(`http://127.0.0.1:${launcher.port}/osd/job-counts`,
        {headers:{Authorization:`Bearer ${launcher.env.OSD_BATCH_READ_TOKEN}`}, signal:AbortSignal.timeout(3000)});
      if (disposed) return;
      if (!answer.ok) throw Error(`job counts: HTTP ${answer.status}`);
      const counts = (await answer.json()).counts;
      panelCounts = counts; pollHealth = 'healthy';
      if (!disposed && controller.launcher === launcher && workerEnabled(launcher.jobsWorkerMode, launcher.env)) {
        item.text = launcher.jobWorker.otherWindow
          ? `OSD jobs: other window · ${counts.running ?? 0} running, ${counts.queued ?? 0} queued`
          : jobsStatus(launcher.jobWorker.running, counts);
        lastKnown = item.text; resetMisses();
        item.backgroundColor = undefined;
      }
    } catch (error) {
      if (disposed || controller.launcher !== launcher || !workerEnabled(launcher.jobsWorkerMode, launcher.env)) return;
      const paused = error.name === 'TimeoutError' && debugging();
      pollHealth = paused ? 'paused' : 'busy';
      // The engine serializes requests: even a normal first classrun can
      // outlast this poll. Require sustained failures before claiming an outage.
      if (paused) resetMisses();
      else { firstMiss ??= Date.now(); misses++; }
      const unavailable = !paused && misses >= 3 && Date.now() - firstMiss >= 15000;
      item.text = paused ? 'OSD jobs: paused (debugger)'
        : unavailable ? 'OSD jobs: status unavailable' : lastKnown ?? 'OSD jobs: busy';
      item.backgroundColor = unavailable ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
      if (unavailable) raw.appendLine(error.message);
    }
    finally { busy = false; if (!disposed) await controller.jobsPanelTick?.(panelCounts, pollHealth); if (!disposed && pollHealth === 'healthy' && summaryShown) await refreshSummary(); }
  };
  if (vscode.debug?.onDidStartDebugSession) context.subscriptions.push(
    vscode.debug.onDidStartDebugSession(session => sessions.add(session)));
  if (vscode.debug?.onDidTerminateDebugSession) context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession(session => { sessions.delete(session); tick(); }));
  controller.jobsOutput = raw;
  const off = controller.onDidChange(tick);
  const timer = setInterval(tick, 2000); tick();
  context.subscriptions.push({dispose:() => { disposed = true; clearInterval(timer); off.dispose(); }});
  return tick;
}
module.exports = {JobWorker, workerEnabled, jobsStatus, jobsStatusBar, jobsSummary};
if (require.main === module && process.argv[2] === '--guard') {
  const [pidText, grace, script] = process.argv.slice(3);
  const pid = Number(pidText);
  let stopping = false, finished = false, timer;
  const stop = (deadline) => {
    if (finished) return;
    if (!stopping) { stopping = true; signalGroup(pid, 'SIGTERM'); }
    if (deadline && !timer) timer = setTimeout(() => signalGroup(pid, 'SIGKILL'), Number(grace));
  };
  const finish = async () => {
    if (finished) return;
    finished = true; clearTimeout(timer); clearInterval(poll);
    signalGroup(pid, 'SIGKILL');
    // If the supervisor died it cannot repair the operations store itself.
    if (!process.connected) {
      try { await new JobWorker({cwd:process.cwd(), env:process.env, script}).recoverInterrupted(pid); }
      catch (error) { console.error(`OSD jobs: recovery failed: ${error.message}`); process.exitCode = 1; }
    }
    if (process.connected) process.disconnect();
  };
  const poll = setInterval(() => { if (!alive(pid)) finish(); }, 25);
  process.on('message', m => {
    if (m === 'exited') finish();
    else stop(m !== 'refresh');
  });
  process.on('disconnect', () => stop(true));
  for (const signal of ['SIGTERM','SIGINT','SIGHUP']) process.on(signal, () => stop(true));
}
