import {expect} from 'chai';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import express from 'express';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BatchRuns} from '../tools/osd-batch-runs.mjs';
import {batchMonitorHandler} from '../tools/osd-batch-monitor.mjs';
const require = createRequire(import.meta.url);
const {registerJobsView, phase} = require('../editors/vscode/jobs-view.js');
const token = 'synthetic_test_token_01234567890123456789';
const id = randomUUID();
const run = {id, jobName:'DEMO_JOB', jobCount:'12000000', user:'DEMO', program:'DEMO_REPORT', state:'RUNNING',
  queuedAt:'2026-10-01T00:00:00Z', startedAt:'2026-10-01T00:00:01Z',
  steps:[{number:1, program:'DEMO_REPORT', variant:'TEST'}], namedEvent:{id:'DEMO_EVENT',param:'test'},
  log:[{at:'2026-10-01T00:00:01Z', severity:'I',event:'STEP_STARTED',step:1,text:'Report step started'}]};
function fakeVscode() {
  const commands = new Map(), providers = new Map(), messages = [], shown = [], output = [];
  class Emitter { constructor() { this.e = new EventEmitter(); this.event = fn => { this.e.on('change',fn); return {dispose:()=>this.e.off('change',fn)}; }; } fire(value) { this.e.emit('change',value); } dispose() { this.e.removeAllListeners(); } }
  const vscode = {StatusBarAlignment:{Left:1},ThemeColor:class {constructor(name){this.name=name;}},EventEmitter:Emitter, Uri:{parse:text=>({toString:()=>text})},
    commands:{registerCommand:(name, fn)=>{commands.set(name,fn);return {dispose(){}};},executeCommand:(...args)=>shown.push(args)},
    window:{registerTreeDataProvider:(name,p)=>{providers.set(name,p);return {dispose(){}};},showInformationMessage:async text=>messages.push(text),
      showTextDocument:async doc=>shown.push(doc),showInputBox:async()=>inputs.shift(),createOutputChannel:()=>({append:s=>output.push(s),appendLine:s=>output.push(s),clear(){},show(){},dispose(){}}),
      createStatusBarItem:()=>{const item={show(){},hide(){},dispose(){}};providers.set('statusBar',item);return item;}},
    workspace:{registerTextDocumentContentProvider:(scheme,p)=>{providers.set(scheme,p);return {dispose(){}};},openTextDocument:async uri=>({uri,text:providers.get('osd-job').provideTextDocumentContent(uri)})},
    env:{clipboard:{writeText:async text=>shown.push(text)}}};
  let inputs = []; return {vscode,commands,providers,messages,shown,output,setInputs:values=>{inputs=values;}};
}
const until = async fn => { for (let i=0;i<100;i++) { if (fn()) return; await new Promise(r=>setTimeout(r,10)); } throw Error('timeout'); };
describe('VS Code read-only jobs panel', function() {
  let server, ui, controller, context, provider, requests, runs, status, failOutput;
  beforeEach(async () => {
    requests=[]; runs=[structuredClone(run)]; status=200; failOutput=false; ui=fakeVscode();
    server=createServer((req,res)=>{
      requests.push({url:req.url, authorization:req.headers.authorization});
      const url=new URL(req.url,'http://localhost'); res.setHeader('content-type','application/json');
      if (req.headers.authorization !== `Bearer ${token}`) {res.writeHead(401);res.end('{}');return;}
      if (status !== 200) {res.writeHead(status);res.end(JSON.stringify({error:{message:token}}));return;}
      if (url.searchParams.get('output')) {
        if(failOutput) {res.writeHead(404);res.end('{}');return;}
        res.end(JSON.stringify({output:{lines:['saved WRITE output']}}));return;
      }
      if (url.pathname === '/osd/job-counts') {res.end(JSON.stringify({counts:{running:1,queued:0}}));return;}
      res.end(JSON.stringify(url.searchParams.has('id') ? {run:runs.find(r=>r.id===url.searchParams.get('id'))} : {runs}));
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    controller={launcher:{state:'running',port:server.address().port,env:{OSD_BATCH_READ_TOKEN:token}},onDidChange:fn=>{controller.change=fn;return {dispose(){}};}};
    context={subscriptions:[]};provider=registerJobsView(ui.vscode,context,controller);await until(()=>!provider.busy);
  });
  afterEach(async()=>{context.subscriptions.forEach(d=>d.dispose());await new Promise(r=>server.close(r));});
  async function job() {return (await provider.getChildren({group:'active'}))[0];}
  it('groups statuses and orders newest first with key tooltips',async()=>{
    runs.push({...run,id:'older',queuedAt:'2026-09-01T00:00:00Z'});await provider.refresh();
    expect((await provider.getChildren()).map(n=>n.group)).to.deep.equal(['active']);
    expect((await provider.getChildren({group:'active'})).map(n=>n.id)).to.deep.equal([id,'older']);
    expect((await job()).tooltip).to.include('JOBNAME: DEMO_JOB').and.include('JOBCOUNT: 12000000');
    expect(['RESERVED','WAITING','READY','RUNNING','COMPLETED','FAILED','INTERRUPTED'].map(state=>phase({state})))
      .to.deep.equal(['scheduled','released','ready','active','finished','cancelled/aborted','cancelled/aborted']);
    expect(phase({state:'SCHEDULED'})).to.equal('scheduled');expect(phase({state:'RELEASED'})).to.equal('released');
  });
  it('fetches detail and shows steps, variants, user, condition and duration',async()=>{
    const children=await provider.getChildren(await job());
    expect(children[0].label).to.include('DEMO_REPORT').and.include('Variant TEST').and.include('User DEMO');
    expect(children[1].label).to.equal('Start: Event DEMO_EVENT (test)');expect(children[2].label).to.match(/^Duration: \d+s$/);
    expect(requests.at(-1).url).to.include(`id=${id}`);
  });
  it('filters name, user and inclusive dates and clears with empty fields',async()=>{
    ui.setInputs(['demo','DEMO','2026-10-01','2026-10-01']);await ui.commands.get('osd.filterJobs')();expect(await provider.getChildren()).to.have.length(1);
    ui.setInputs(['other','','','']);await ui.commands.get('osd.filterJobs')();expect((await provider.getChildren())[0].label).to.equal('No jobs match the filter');
    ui.setInputs(['','','','']);await ui.commands.get('osd.filterJobs')();expect((await provider.getChildren())[0].group).to.equal('active');
  });
  it('opens log and saved output through the read-only content provider and copies the key',async()=>{
    const node=await job();await ui.commands.get('osd.openJobLog')(node);await ui.commands.get('osd.openJobOutput')(node);await ui.commands.get('osd.copyJobKey')(node);
    expect(ui.shown[0].uri.toString()).to.equal(`osd-job:${id}/log`);expect(ui.shown[0].text).to.include('STEP_STARTED step 1: Report step started');
    expect(ui.shown[1].text).to.equal('saved WRITE output');expect(ui.shown[2]).to.equal('DEMO_JOB/12000000');
    expect(requests.at(-1).url).to.include('output=1');
  });
  it('does not invent a retained job key for legacy report runs',async()=>{
    await ui.commands.get('osd.copyJobKey')({run:{id,program:'DEMO_REPORT'}});
    expect(ui.shown).to.have.length(0);expect(ui.messages[0]).to.include('No retained JOBNAME/JOBCOUNT');
  });
  it('reports missing saved output explicitly',async()=>{
    failOutput=true;await provider.open(await job(),'output');expect(ui.messages[0]).to.equal('No saved output is available for this job.');expect(ui.shown).to.have.length(0);
  });
  for (const code of [401,404]) it(`handles HTTP ${code} as an empty state with Start system`,async()=>{
    status=code;await provider.refresh();const nodes=await provider.getChildren();expect(nodes).to.have.length(1);expect(nodes[0].command.command).to.equal('osd.start');expect(nodes[0].label).to.include(code===401?'authorization':'disabled');
  });
  it('clears the tree on stop and focuses the panel from its command',async()=>{
    controller.launcher.state='stopped';await provider.refresh();expect((await provider.getChildren())[0].label).to.equal('System is not running');
    await ui.commands.get('osd.openJobsPanel')();expect(ui.shown[0]).to.deep.equal(['osdJobs.focus']);
  });
  it('ignores a pending list response after the system stops',async()=>{
    let finish;provider.request=()=>new Promise(resolve=>{finish=resolve;});
    const pending=provider.refresh();controller.launcher.state='stopped';await provider.refresh();
    finish({runs:[run]});await pending;
    expect((await provider.getChildren())[0].label).to.equal('System is not running');
  });
  it('refreshes active jobs from the shared poll and stops fetching for finished jobs',async()=>{
    runs[0].state='COMPLETED';await controller.jobsPanelTick();expect((await provider.getChildren())[0].group).to.equal('finished');
    const count=requests.length;await controller.jobsPanelTick({running:0,queued:0});expect(requests).to.have.length(count);
    await controller.jobsPanelTick({running:1});expect(requests).to.have.length(count+1);
  });
  it('uses the status poll for active refresh and opens the panel from the jobs item',async()=>{
    const {jobsStatusBar}=require('../editors/vscode/job-worker.js');
    Object.assign(controller.launcher,{jobsWorkerMode:'auto',jobWorker:{running:true}});
    Object.assign(controller.launcher.env,{STG_DB:'file',STG_DB_PATH:'/tmp/synthetic-jobs.db'});
    const tick=jobsStatusBar(ui.vscode,context,controller);
    await until(()=>requests.filter(r=>r.url.startsWith('/osd/batch-runs?limit')).length >= 2 && !provider.busy);
    runs[0].state='COMPLETED';await tick();
    expect((await provider.getChildren())[0].group).to.equal('finished');
    expect(ui.providers.get('statusBar').command).to.equal('osd.openJobsPanel');
    status=500;await tick();expect(ui.providers.get('statusBar').backgroundColor).to.equal(undefined);
    expect(JSON.stringify(ui.output)).not.to.include(token);
  });
  it('retains jobs on missed/busy polls and never surfaces bearer or server errors',async()=>{
    status=500;await provider.refresh();expect((await provider.getChildren())[0].group).to.equal('active');await provider.open(await job(),'log');
    expect(JSON.stringify([ui.messages,ui.shown,ui.output,await provider.getChildren()])).not.to.include(token);
    expect(requests.every(r=>!r.url.includes(token) && r.authorization===`Bearer ${token}`)).to.equal(true);
    expect((await provider.getChildren(await job()))[0].label).to.include('unavailable');
  });
});
describe('Jobs panel real saved-run API contract',function(){
  it('adds owner/conditions/log without paths and verifies saved output SHA-256',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'jobs-panel-api-'));const env={OSD_BATCH_READ_TOKEN:token};const store=new BatchRuns(dir,env);
    let server;
    try {
      const saved=store.start({program:'DEMO_REPORT',input:[],generation:'test'});store.finish(saved.id,{status:'COMPLETED',lines:['verified WRITE']});
      store.db.prepare(`UPDATE batch_runs SET source_owner='DEMO', after_named_id='DEMO_EVENT', after_named_param='test', source_db='/private/path' WHERE id=?`).run(saved.id);
      store.db.prepare(`INSERT INTO batch_job_log VALUES (?,1,NULL,'2026-10-01T00:00:00Z','JOB_COMPLETED','I','Job completed')`).run(saved.id);
      const app=express();app.get('/osd/batch-runs',batchMonitorHandler(dir,env));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
      const get=async query=>fetch(`http://127.0.0.1:${server.address().port}/osd/batch-runs?${query}`,{headers:{Authorization:`Bearer ${token}`}});
      const list=await (await get('limit=200')).json();expect(list.runs[0].user).to.equal('DEMO');expect(list.runs[0].namedEvent.id).to.equal('DEMO_EVENT');expect(JSON.stringify(list)).not.to.include('/private/path');
      const detail=await (await get(`id=${saved.id}`)).json();expect(detail.run.log[0].text).to.equal('Job completed');
      expect((await (await get(`id=${saved.id}&output=1`)).json()).output.lines).to.deep.equal(['verified WRITE']);
      writeFileSync(join(store.artifacts,`${saved.id}.json`),'tampered');expect((await get(`id=${saved.id}&output=1`)).status).to.equal(500);
    } finally {if(server)await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true,force:true});}
  });
});
