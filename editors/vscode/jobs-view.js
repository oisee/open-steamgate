// Read-only saved-run browser. Credentials stay in the launcher and headers.
const GROUPS = ['scheduled', 'released', 'ready', 'active', 'finished', 'cancelled/aborted'];
const phase = run => ({RESERVED:'scheduled', SCHEDULED:'scheduled', WAITING:'released', RELEASING:'released',
  RELEASED:'released', QUEUED:'ready', READY:'ready', RUNNING:'active', COMPLETED:'finished',
  FAILED:'cancelled/aborted', INTERRUPTED:'cancelled/aborted', CANCELLED:'cancelled/aborted', ABORTED:'cancelled/aborted'})[run.state] ?? 'scheduled';
const time = run => Date.parse(run.queuedAt || run.startedAt) || 0;
function startCondition(run) {
  if (run.schedule?.start) {
    const stamp = run.schedule.start;
    const text = /^\d{14}$/.test(stamp) ? `${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)} ${stamp.slice(8,10)}:${stamp.slice(10,12)}:${stamp.slice(12)}` : stamp;
    return `At ${text}`;
  }
  if (run.namedEvent) return `Event ${run.namedEvent.id}${run.namedEvent.param ? ` (${run.namedEvent.param})` : ''}`;
  if (run.afterEvent) return `After ${run.afterEvent.jobname}/${run.afterEvent.jobcount}`;
  return 'Immediate';
}
function duration(run) {
  const start = Date.parse(run.startedAt), end = run.endedAt ? Date.parse(run.endedAt) : run.state === 'RUNNING' ? Date.now() : NaN;
  return Number.isFinite(start) && Number.isFinite(end) ? `${Math.max(0, Math.floor((end - start) / 1000))}s` : 'Not started';
}
class JobsView {
  constructor(vscode, controller) {
    this.vscode = vscode; this.controller = controller; this.runs = []; this.filter = {};
    this.events = new vscode.EventEmitter(); this.onDidChangeTreeData = this.events.event;
    this.empty = 'System is not running';
  }
  getTreeItem(node) { return node; }
  node(label, children = false) { return {label, collapsibleState: children ? 1 : 0}; }
  async request(query, launcher = this.controller.launcher) {
    if (launcher?.state !== 'running' || !launcher.env?.OSD_BATCH_READ_TOKEN) throw {status:404};
    const response = await fetch(`http://127.0.0.1:${launcher.port}/osd/batch-runs?${new URLSearchParams(query)}`,
      {headers:{Authorization:`Bearer ${launcher.env.OSD_BATCH_READ_TOKEN}`}, signal:AbortSignal.timeout(3000)});
    // Never surface server messages or fetch errors: they can carry credentials.
    if (!response.ok) throw {status:response.status};
    return response.json();
  }
  async refresh() {
    if (this.disposed) return;
    const launcher = this.controller.launcher, token = launcher?.env?.OSD_BATCH_READ_TOKEN;
    if (launcher !== this.observed || token !== this.token) { this.runs = []; this.observed = launcher; this.token = token; }
    if (launcher?.state !== 'running') {
      this.runs = []; this.empty = 'System is not running'; this.events.fire(); return;
    }
    if (this.busy) return;
    this.busy = true;
    try {
      const answer = await this.request({limit:200}, launcher);
      if (this.disposed || this.controller.launcher !== launcher || launcher.state !== 'running' || launcher.env?.OSD_BATCH_READ_TOKEN !== token) return;
      this.runs = answer.runs.filter(run => run.state !== 'DELETED').sort((a,b) => time(b)-time(a) || b.id.localeCompare(a.id));
      this.empty = 'No saved jobs';
    } catch (error) {
      if (this.disposed || this.controller.launcher !== launcher || launcher.state !== 'running' || launcher.env?.OSD_BATCH_READ_TOKEN !== token) return;
      if ([401,404].includes(error.status)) { this.runs = []; this.empty = error.status === 401 ? 'Jobs API authorization unavailable' : 'Jobs API is disabled'; }
      else if (!this.runs.length) this.empty = 'Jobs API is busy or paused; retrying';
    } finally { this.busy = false; if (!this.disposed) this.events.fire(); }
  }
  poll(counts) {
    if (counts?.running || counts?.queued || this.runs.some(run => ['active','ready','released'].includes(phase(run))) || !this.runs.length) return this.refresh();
  }
  async getChildren(node) {
    if (node?.run) {
      let run;
      try { ({run} = await this.request({id:node.run.id})); }
      catch { return [this.node("Job details unavailable; refresh to retry")]; }
      return [...(run.steps?.length ? run.steps : [{number:1, program:run.program}]).map(step =>
        this.node(`Step ${step.number}: ${step.program}${step.variant ? ` · Variant ${step.variant}` : ''} · User ${step.user || run.user || 'not recorded'}`)),
        this.node(`Start: ${startCondition(run)}`), this.node(`Duration: ${duration(run)}`)];
    }
    const filtered = this.runs.filter(run => (!this.filter.name || (run.jobName || run.program || '').toLowerCase().includes(this.filter.name.toLowerCase()))
      && (!this.filter.user || (run.user || '').toLowerCase().includes(this.filter.user.toLowerCase()))
      && (!this.filter.from || time(run) >= Date.parse(this.filter.from))
      && (!this.filter.to || time(run) < Date.parse(this.filter.to) + 86400000));
    if (node?.group) return filtered.filter(run => phase(run) === node.group).map(run => ({...this.node(run.jobName || run.program || 'Unnamed job', true), run,
      id:run.id, contextValue:'osd-job', description:`${run.jobCount || ''} · ${run.user || 'not recorded'}`,
      tooltip:`JOBNAME: ${run.jobName || '(not recorded)'}\nJOBCOUNT: ${run.jobCount || '(not recorded)'}\n${run.state}`}));
    if (!this.runs.length) return [{...this.node(this.empty), command:{command:'osd.start', title:'Start system'}, contextValue:'osd-jobs-empty'}];
    if (!filtered.length) return [this.node('No jobs match the filter')];
    return GROUPS.filter(group => filtered.some(run => phase(run) === group)).map(group => ({...this.node(group, true), group}));
  }
  async setFilter() {
    const next = {};
    for (const [key, prompt] of [['name','Job name contains'], ['user','User contains'], ['from','From date (YYYY-MM-DD, inclusive)'], ['to','To date (YYYY-MM-DD, inclusive)']]) {
      const value = await this.vscode.window.showInputBox({prompt, value:this.filter[key] || '',
        validateInput: value => ['from','to'].includes(key) && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) ? 'Enter a valid YYYY-MM-DD date' : undefined});
      if (value === undefined) return;
      next[key] = value.trim();
    }
    if (next.from && next.to && next.from > next.to) { await this.vscode.window.showInformationMessage('From date must precede to date.'); return; }
    this.filter = next; this.events.fire();
  }
  async open(node, kind) {
    if (!node?.run) return;
    const launcher = this.controller.launcher, token = launcher?.env?.OSD_BATCH_READ_TOKEN;
    try {
      const answer = await this.request(kind === 'output' ? {id:node.run.id, output:1} : {id:node.run.id}, launcher);
      if (this.disposed || this.controller.launcher !== launcher || launcher.state !== 'running' || launcher.env?.OSD_BATCH_READ_TOKEN !== token) return;
      const content = kind === 'log' ? (answer.run.log?.map(row => `${row.at} ${row.severity} ${row.event} ${row.step ? `step ${row.step}: ` : ''}${row.text}`).join('\n') || 'No technical log recorded.')
        : (answer.output.lines?.join('\n') || answer.output.terminal || JSON.stringify(answer.output, null, 2));
      const uri = this.vscode.Uri.parse(`osd-job:${node.run.id}/${kind}`);
      this.documents.set(uri.toString(), content);
      this.documentEvents.fire(uri);
      await this.vscode.window.showTextDocument(await this.vscode.workspace.openTextDocument(uri), {preview:false});
    } catch (error) {
      await this.vscode.window.showInformationMessage(kind === 'output' && error.status === 404 ? 'No saved output is available for this job.'
        : `Job ${kind} is unavailable${error.status ? ` (HTTP ${error.status})` : '; system busy or paused'}.`);
    }
  }
  dispose() { this.disposed = true; this.token = undefined; this.events.dispose(); this.documentEvents?.dispose(); this.documents?.clear(); }
}
function registerJobsView(vscode, context, controller) {
  const provider = new JobsView(vscode, controller);
  provider.documents = new Map(); provider.documentEvents = new vscode.EventEmitter();
  const register = (name, fn) => context.subscriptions.push(vscode.commands.registerCommand(name, fn));
  context.subscriptions.push(provider, vscode.window.registerTreeDataProvider('osdJobs', provider),
    vscode.workspace.registerTextDocumentContentProvider('osd-job', {onDidChange:provider.documentEvents.event,
      provideTextDocumentContent:uri => provider.documents.get(uri.toString()) || ''}));
  const safely = fn => async (...args) => { try { return await fn(...args); } catch { await vscode.window.showInformationMessage('Jobs API is busy or unavailable. Refresh to retry.'); } };
  register('osd.openJobsPanel', () => vscode.commands.executeCommand('osdJobs.focus'));
  register('osd.refreshJobs', safely(() => provider.refresh()));
  register('osd.filterJobs', () => provider.setFilter());
  register('osd.openJobLog', node => provider.open(node, 'log'));
  register('osd.openJobOutput', node => provider.open(node, 'output'));
  register('osd.copyJobKey', node => {
    if (!node?.run) return;
    if (!node.run.jobName || !node.run.jobCount) return vscode.window.showInformationMessage('No retained JOBNAME/JOBCOUNT key is recorded for this run.');
    return vscode.env.clipboard.writeText(`${node.run.jobName}/${node.run.jobCount}`);
  });
  controller.jobsPanelTick = counts => provider.poll(counts);
  context.subscriptions.push(controller.onDidChange(() => { void provider.refresh(); }), {dispose:() => { delete controller.jobsPanelTick; }});
  void provider.refresh();
  return provider;
}
module.exports = {JobsView, registerJobsView, phase, startCondition};
