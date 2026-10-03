import {l3TableDependencies} from "./helpers/dsl-l3-tables.mjs";
import {expect} from 'chai';
import {readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {modulesOf} from '../tools/osd-transpile.mjs';
import {lowerNarrowSubmit} from '../tools/osd-narrow-submit.mjs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {compileSet, renderSet} from '../tools/dsl-l3.mjs';
import {dialogStep} from '../tools/osd-dialog-step.mjs';
import {daemonHost} from '../tools/osd-daemon-host.mjs';
import {BatchRuns, workQueuedBatch} from '../tools/osd-batch-runs.mjs';
import {drainJobOutbox} from '../tools/osd-job-outbox.mjs';
import {manualClock, installAbapClock} from '../tools/osd-job-scheduler.mjs';
const SET = 'src/l2demo/fleet2.l3.yaml';
const tables = ['pile','stage','work','run','doctor','kill','conf','conf_log','run_conf','budget','event','object','alert','runstat','watch'].map((s) => `zosd_l3_${s}`);
describe('DSL L3 5e: autonomous doctor', function () {
  this.timeout(900000);
  let abap, dir, native, store, clock, restore, client, env, prior, priorContext, classes;
  const cls = () => abap.Classes.ZCL_L3_FLEET2;
  const str = (s) => new abap.types.String().set(s);
  const sql = async (s) => client.execute(s);
  const read = (s, ...args) => native.prepare(s).all(...args);
  async function abandonJobs() {
    // Every preceding invocation has joined its worker; discard only this test fixture's abandoned jobs.
    await sql('DELETE FROM zosd_job_step');
    await sql('DELETE FROM zosd_job_outbox');
    store.db.prepare("UPDATE batch_runs SET state='FAILED' WHERE state IN ('QUEUED','RUNNING','WAITING')").run();
  }
  async function work(limit = 1000) {
    await daemonHost(abap).idle();
    await drainJobOutbox(store);
    for (let i=0; i<limit; i++) {
      const outcome = await workQueuedBatch(process.cwd(), store);
      await daemonHost(abap).idle();
      const drained = await drainJobOutbox(store);
      if (!['completed','failed','step','running'].includes(outcome.kind) && !drained.imported) break;
    }
  }
  async function initialPassFirst() {
    await daemonHost(abap).idle();await drainJobOutbox(store);
    store.db.prepare("UPDATE batch_runs SET queued_at='2000-01-01T00:00:00Z' WHERE state='QUEUED' AND program='ZL3_FLEET2_DOC'").run();
    await work(1);
  }
  const run = (day='20261001', bind='') => dialogStep(() => cls().run({iv_date: new abap.types.Date().set(day), iv_mode: str('P'), iv_bind: str(bind)}));
  async function mutant(name, className, edit, check) {
    const original=abap.Classes[className.toUpperCase()];
    const source=readFileSync(`output/${className}.clas.mjs`,'utf8');
    const changed=edit(source);
    expect(changed,`${name} changes executable code`).not.to.equal(source);
    const folder=join(dir,name);await (await import('node:fs/promises')).mkdir(folder,{recursive:true});
    const outputUrl=pathToFileURL(join(process.cwd(),'output')+'/').href;
    const copy=changed.replace(/(?:from |import\()(["'])\.\/([^"']+)\1/g,(m,q,file)=>m.replace(`${q}./${file}${q}`,`${q}${outputUrl}${file}${q}`));
    const file=join(folder,`${className}.clas.mjs`);writeFileSync(file,copy);
    await import(pathToFileURL(file).href);
    try {await check();} finally {await daemonHost(abap).close();abap.Classes[className.toUpperCase()]=original;}
  }
  async function variantRunner(model, label, check) {
    const rendered=await renderSet(model), {Transpiler, core}=modulesOf(process.cwd());
    const registry=new core.Registry(), deps=new Map();
    const walk=(folder)=> {
      for(const entry of readdirSync(folder,{withFileTypes:true})) {
        const path=join(folder,entry.name);
        if(entry.isDirectory())walk(path);
        else if(/\.(abap|xml)$/.test(entry.name))deps.set(entry.name,path);
      }
    };
    for(const folder of ['.local/lars/open-abap-core/src','.local/lars/open-abap-apc/src','src','gen'])walk(folder);
    for(const path of l3TableDependencies())deps.set(path.split('/').pop(),path);
    deps.set('zif_gg_selection_screen_types.intf.abap','.local/lars/open-abap-gui/framework/zif_gg_selection_screen_types.intf.abap');
    for(const [name,path] of deps)if(!name.startsWith(`${model.class}.`))registry.addDependency(new core.MemoryFile(name,readFileSync(path,'utf8')));
    for(const ext of ['abap','xml']) {
      const name=`${model.class}.clas.${ext}`;
      registry.addFile(new core.MemoryFile(name,lowerNarrowSubmit(rendered.files[name],name,core)));
    }
    const options=JSON.parse(readFileSync('abap_transpile.json','utf8')).options;
    const output=await new Transpiler({...options,unknownTypes:'runtimeError',ignoreSourceMap:true,skip:[],only:(object)=>object.getName().toUpperCase()===model.class.toUpperCase()}).run(registry);
    const own=output.objects.find(o=>o.filename===`${model.class}.clas.mjs`);
    const folder=join(dir,label);mkdirSync(folder,{recursive:true});
    const outputUrl=pathToFileURL(join(process.cwd(),'output')+'/').href;
    const code=own.chunk.getCode().replace(/(?:from |import\()(["'])\.\/([^"']+)\1/g,(m,q,file)=>m.replace(`${q}./${file}${q}`,`${q}${outputUrl}${file}${q}`));
    const file=join(folder,own.filename);writeFileSync(file,code);
    const original=abap.Classes[model.class.toUpperCase()];
    await import(pathToFileURL(file).href);
    try{await check();}finally{await daemonHost(abap).close();abap.Classes[model.class.toUpperCase()]=original;}
  }
  before(async () => {
    await import('./start.mjs');
    // the suite re-initializes the runtime on its own file database; the next suite in the same
    // process gets the context, connections and classes it had (as dsl-l3-harden does)
    prior = globalThis.abap;
    priorContext = {...prior.context, databaseConnections: {...prior.context.databaseConnections}, RFCDestinations: {...prior.context.RFCDestinations}};
    dir = mkdtempSync(join(tmpdir(), 'l3-autodoctor-'));
    env = Object.fromEntries(['STG_DB','STG_DB_PATH','OSD_OPERATIONS_DB'].map((k)=>[k, process.env[k]]));
    process.env.STG_DB='file'; process.env.STG_DB_PATH=join(dir,'business.sqlite'); process.env.OSD_OPERATIONS_DB=join(dir,'operations.sqlite');
    await (await import('../output/init.mjs')).initializeABAP();
    abap=globalThis.abap; client=abap.context.databaseConnections.DEFAULT; classes={...abap.Classes};
    native = new DatabaseSync(process.env.STG_DB_PATH);
    store=new BatchRuns(process.cwd(),process.env);
    clock=manualClock('2026-10-01T00:00:00Z');restore=installAbapClock(abap,clock);
  });
  beforeEach(async () => {
    await daemonHost(abap).close();
    clock.set(Date.parse('2026-10-01T00:00:00Z'));
    await abandonJobs();
    for (const table of tables) await sql(`DELETE FROM ${table}`);
    for (const table of ['ship','voy','crew','cargo']) await sql(`DELETE FROM zosd_l2_${table}`);
    await sql("INSERT INTO zosd_l2_ship (mandt,ship_id,name,status) VALUES ('123','S001','Ship','A')");
    await sql("INSERT INTO zosd_l2_voy (mandt,voyage_id,ship_id,dep_date) VALUES ('123','V00001','S001','20261005')");
  });
  after(async () => {
    if (abap) await daemonHost(abap).close();
    restore?.();store?.close();native?.close();await client?.disconnect();
    if (abap && classes) { for (const key of Object.keys(abap.Classes)) if (!(key in classes)) delete abap.Classes[key]; Object.assign(abap.Classes, classes); }
    if (prior) { Object.assign(prior.context, priorContext); globalThis.abap = prior; }
    for (const [k,v] of Object.entries(env ?? {})) if (v===undefined) delete process.env[k];else process.env[k]=v;
    if(dir)rmSync(dir,{recursive:true,force:true});
  });
  it('mode P starts one daemon per set; messages advance the gate; final run stops it with audit', async () => {
    await run(); await run('20261002');
    expect(daemonHost(abap).instances.size).to.equal(1);
    await initialPassFirst();
    await work();
    expect(read("SELECT status FROM zosd_l3_stage WHERE stage_no=2").map(r=>r.status.trim())).to.deep.equal(['DONE','DONE']);
    expect(read("SELECT status FROM zosd_l3_run").map(r=>r.status.trim())).to.deep.equal(['RELEASED','RELEASED']);
    await clock.advance(10000); await daemonHost(abap).idle();
    expect(daemonHost(abap).instances.size).to.equal(0);
    expect(read("SELECT * FROM zosd_l3_doctor WHERE doc_action='DMN-STOP'")).to.have.length(1);
    expect(daemonHost(abap).errors.map(e=>String(e))).to.deep.equal([]);
  });
  it('aborted jobs heal on tick before stale; manual race audits once', async () => {
    const original=abap.Classes.ZCL_L2_SHIP_BUSY.keys;
    abap.Classes.ZCL_L2_SHIP_BUSY.keys=async()=>{throw new Error('simulated dump');};
    try { await run();await initialPassFirst();await work(); } finally { abap.Classes.ZCL_L2_SHIP_BUSY.keys=original; }
    expect(read("SELECT * FROM zosd_l3_doctor WHERE doc_action='FAILED'")).to.have.length(0);
    await clock.advance(10000);
    await Promise.all([work(),dialogStep(()=>cls().doctor({})),dialogStep(()=>cls().doctor({}))]);
    const failed=read("SELECT * FROM zosd_l3_doctor WHERE doc_action='FAILED'");
    expect(failed).to.have.length(1);
    await Promise.all([dialogStep(()=>cls().doctor({})),dialogStep(()=>cls().doctor({}))]);
    expect(read("SELECT * FROM zosd_l3_doctor WHERE doc_action='FAILED'")).to.have.length(1);
    await clock.advance(60000); await work();
    expect(read("SELECT status FROM zosd_l3_stage WHERE stage_no=2")[0].status.trim()).to.equal('DONE');
  });
  it('the 100-pile twin reaches stage 2 and completes without manual doctor or resume', async () => {
    for (const [name,value] of [['budget.glass','100000'],['retry.max','99'],['retry.backoff','0'],['simulate.time_scale','0']]) {
      const ok = await dialogStep(()=>cls().set_setting({iv_param:str(name),iv_value:str(value),iv_note:str('test policy')}));
      expect(ok.get(),name).to.equal('X');
    }
    await dialogStep(async()=> {
      await sql('DELETE FROM zosd_l2_ship');await sql('DELETE FROM zosd_l2_voy');
      for(let i=0;i<200;i++) {
        const ship=`S${String(i).padStart(3,'0')}`;
        await sql(`INSERT INTO zosd_l2_ship (mandt,ship_id,name,status) VALUES ('123','${ship}','Ship','A')`);
        await sql(`INSERT INTO zosd_l2_voy (mandt,voyage_id,ship_id,dep_date) VALUES ('123','V${String(i).padStart(5,'0')}','${ship}','20261005')`);
      }
    });
    await run('20261001','work=sim');
    await work();
    expect(read('SELECT * FROM zosd_l3_pile WHERE stage_no=1')).to.have.length(100);
    for(let i=0;i<20 && read("SELECT * FROM zosd_l3_run WHERE status='HELD'").length;i++) {await clock.advance(10000);await work();}
    expect(read("SELECT status FROM zosd_l3_stage WHERE stage_no=2")[0].status.trim()).to.equal('DONE');
    expect(read("SELECT * FROM zosd_l3_run WHERE status='HELD'")).to.have.length(0);
    expect(read("SELECT * FROM zosd_l3_doctor WHERE stage_no=1 AND doc_action='FAILED'").length).to.be.greaterThan(20);
  });
  it('daemon jobs keep run-scoped chaos overrides after live settings change', async () => {
    const tune = async (name,value) => {
      expect((await dialogStep(() => cls().set_setting({iv_param:str(name),iv_value:str(value),iv_note:str('chaos snapshot')}))).get()).to.equal('X');
    };
    for (const [name,value] of [['budget.glass','100000'],['retry.max','0'],['simulate.time_scale','0'],
      ['simulate.dump','0'],['simulate.hang','0'],['simulate.slow','0']]) await tune(name,value);
    const first = (await run('20261001','work=sim')).get().run_id.get().trim();
    await tune('simulate.dump','1000');
    await work();
    expect(read('SELECT status FROM zosd_l3_pile WHERE run_id=?',first).map(p=>p.status.trim())).to.satisfy(rows=>rows.length>0 && rows.every(s=>s==='DONE'));
    expect(read("SELECT param_val FROM zosd_l3_run_conf WHERE run_id=? AND param_name='simulate.dump'",first)[0].param_val.trim()).to.equal('0');
    const second = (await run('20261002','work=sim')).get().run_id.get().trim();
    await work();await clock.advance(10000);await work();
    expect(read('SELECT status,attempt FROM zosd_l3_pile WHERE run_id=? AND stage_no=1',second).map(p=>[p.status.trim(),p.attempt])).to.deep.equal([['FAILED',1]]);
    expect(read("SELECT param_val FROM zosd_l3_run_conf WHERE run_id=? AND param_name='simulate.dump'",second)[0].param_val.trim()).to.equal('1000');
    expect(daemonHost(abap).errors.map(e=>String(e))).to.deep.equal([]);
  });
  it('a silent live job stays running before stale and is failed after stale', async () => {
    await run();await daemonHost(abap).idle();await drainJobOutbox(store);
    const pile=read('SELECT * FROM zosd_l3_pile WHERE stage_no=1')[0];
    const claimed=store.claimNext();
    expect(claimed.run.jobName).to.equal(pile.job_name.trim());
    await dialogStep(()=>sql("UPDATE zosd_l3_pile SET status='RUNNING', started='20261001000000' WHERE stage_no=1"));
    await dialogStep(()=>cls().doctor({}));
    expect(read('SELECT status FROM zosd_l3_pile WHERE stage_no=1')[0].status.trim()).to.equal('RUNNING');
    clock.set(Date.parse('2026-10-01T00:16:00Z'));
    await dialogStep(()=>cls().doctor({}));
    expect(read('SELECT status FROM zosd_l3_pile WHERE stage_no=1')[0].status.trim()).to.equal('FAILED');
    expect(read("SELECT * FROM zosd_l3_doctor WHERE reason='JOB-SILENT' AND doc_action='FAILED'")).to.have.length(1);
    expect(store.get(claimed.run.id).state).to.equal('INTERRUPTED');
    expect(read("SELECT * FROM zosd_l3_doctor WHERE doc_action='JOB-ABORT'")).to.have.length(1);
    // Save the old attempt's snapshot, then let the retry claim its row.
    await clock.advance(60000);
    await dialogStep(()=>cls().doctor({}));
    await dialogStep(()=>sql("UPDATE zosd_l3_pile SET status='RUNNING' WHERE stage_no=1"));
    const retry=read('SELECT * FROM zosd_l3_pile WHERE stage_no=1')[0];
    expect(retry.attempt).to.equal(pile.attempt+1);
    expect(retry.job_count).not.to.equal(pile.job_count);
    // Even a late tail called with the complete old row cannot overwrite the retry.
    const row = new abap.types.Structure(Object.fromEntries(Object.entries(retry).map(([key,value])=>
      [key, typeof value==='number' ? new abap.types.Integer().set(value) : new abap.types.String().set(String(value ?? ''))])));
    row.get().attempt.set(pile.attempt);row.get().job_name.set(pile.job_name);row.get().job_count.set(pile.job_count);
    row.get().status.set('DONE');
    await dialogStep(()=>cls().save_pile({is_pile:row,iv_owned:str('X')}));
    expect(read('SELECT * FROM zosd_l3_pile WHERE stage_no=1')[0]).to.deep.equal(retry);
  });
  async function lateAttempt(checkRule = false) {
    await run();await daemonHost(abap).idle();
    await daemonHost(abap).close();
    if (checkRule) await work();
    const pile=read(`SELECT * FROM zosd_l3_pile WHERE stage_no=${checkRule?2:1}`)[0];
    await dialogStep(async()=> {
      await sql("UPDATE zosd_l3_run SET status='HELD'");
      await sql("UPDATE zosd_l3_budget SET state='RUNNING'");
      await sql(`UPDATE zosd_l3_pile SET status='PLANNED' WHERE run_id='${pile.run_id}' AND rule_name='${pile.rule_name}' AND pile_no=${pile.pile_no}`);
    });
    const beforeWork=read('SELECT * FROM zosd_l3_work'), beforeAlerts=read('SELECT * FROM zosd_l3_alert');
    const l2=abap.Classes[checkRule?'ZCL_L2_MAINTENANCE_SHIP':'ZCL_L2_SHIP_BUSY'];
    const method=checkRule?'check':'keys', original=l2[method];
    l2[method]=async(input)=> {
      const result=await original.call(l2,input);
      await sql(`UPDATE zosd_l3_pile SET attempt=attempt+1, job_count='99999999', status='RUNNING' WHERE run_id='${pile.run_id}' AND rule_name='${pile.rule_name}' AND pile_no=${pile.pile_no}`);
      return result;
    };
    let answer, sinkWrites=0;
    const sink=abap.Classes.ZCL_L3_FLEET2_ALERTS_LOG.prototype, put=sink.zif_l3_fleet2_alerts$put;
    sink.zif_l3_fleet2_alerts$put=async function(input){sinkWrites++;return put.call(this,input);};
    try { answer=await dialogStep(()=>cls().run_rule({iv_rule:str(pile.rule_name.trim()),iv_run:str(pile.run_id.trim()),
      iv_date:new abap.types.Date().set('20261001'),iv_pile:new abap.types.Integer().set(pile.pile_no),iv_bind:str('')})); }
    finally {l2[method]=original;sink.zif_l3_fleet2_alerts$put=put;}
    return {sinkWrites,status:answer.get().status.get().trim(), beforeWork,beforeAlerts,
      work:read('SELECT * FROM zosd_l3_work'),alerts:read('SELECT * FROM zosd_l3_alert'),
      pile:read('SELECT * FROM zosd_l3_pile WHERE run_id=? AND rule_name=? AND pile_no=?',pile.run_id,pile.rule_name,pile.pile_no)[0]};
  }
  it('a superseded attempt writes neither filter keys nor alerts nor the pile tail', async()=> {
    const filter=await lateAttempt();
    expect(filter.status).to.equal('STALE-JOB');expect(filter.work).to.deep.equal(filter.beforeWork);
    expect(filter.pile.status.trim()).to.equal('RUNNING');expect(filter.pile.job_count.trim()).to.equal('99999999');
    for(const table of tables)await sql(`DELETE FROM ${table}`);
    await abandonJobs();
    const check=await lateAttempt(true);
    expect(check.status).to.equal('STALE-JOB');expect(check.alerts).to.deep.equal(check.beforeAlerts);expect(check.sinkWrites).to.equal(0);
    expect(check.pile.status.trim()).to.equal('RUNNING');
  });
  async function quietHour(kind,ticks=360) {
    const runId=(await run()).get().run_id.get().trim();
    await initialPassFirst();
    if(kind==='kill') {
      expect((await dialogStep(()=>cls().set_kill({iv_reason:str('operator pause')}))).get()).to.equal('X');
      await daemonHost(abap).idle();
    } else await dialogStep(()=>sql("UPDATE zosd_l3_budget SET state='GLASS'"));
    const count=()=>store.db.prepare("SELECT count(*) n FROM batch_runs WHERE job_name='L3_FLEET2_PASS'").get().n;
    const before=count();
    for(let i=0;i<ticks;i++){await clock.advance(10000);await work();}
    return {runId, passes:count()-before};
  }
  it('kill stops and audits the daemon; an hour submits no passes; clear_kill restarts healing',async()=> {
    const quiet=await quietHour('kill');expect(quiet.passes).to.be.at.most(1);
    expect(daemonHost(abap).instances.size).to.equal(0);
    expect(read("SELECT * FROM zosd_l3_doctor WHERE doc_action='DMN-KILL'")).to.have.length(1);
    await dialogStep(()=>cls().clear_kill({iv_reason:str('operator continue')}));
    await work();await clock.advance(10000);await work();
    expect(read("SELECT * FROM zosd_l3_run WHERE status='HELD'")).to.have.length(0);
  });
  it('GLASS sleeps for an hour without passes; continue_glass resumes healing',async()=> {
    const quiet=await quietHour('glass');expect(quiet.passes).to.be.at.most(1);
    const ok=await dialogStep(()=>cls().continue_glass({iv_run:str(quiet.runId),iv_reason:str('operator continue'),iv_new_glass:new abap.types.Integer().set(10000)}));
    expect(ok.get()).to.equal('X');await work();await clock.advance(10000);await work();
    expect(read("SELECT * FROM zosd_l3_run WHERE status='HELD'")).to.have.length(0);
  });
  async function stoppingRace() {
    const manager=abap.Classes.CL_ABAP_DAEMON_CLIENT_MANAGER;
    const info=manager.get_daemon_info;let saved;
    manager.get_daemon_info=async(input)=> {const result=await info.call(manager,input);if(result.array().length)saved=result.clone();return result;};
    try {
      await run();await daemonHost(abap).idle();
      await dialogStep(()=>cls().start_daemon());
      // The last old run ends, and its daemon decides to stop.
      await dialogStep(()=>sql("UPDATE zosd_l3_run SET status='RELEASED'"));
      await clock.advance(10000);await daemonHost(abap).idle();
    }finally{manager.get_daemon_info=info;}
    expect(saved.array()).to.have.length(1);
    // Retain the stopped instance in GET_DAEMON_INFO, as SAP does until ON_STOP.
    await daemonHost(abap).close();
    await abandonJobs();
    manager.get_daemon_info=async()=>saved;
    try {
      await run('20261002');expect(daemonHost(abap).instances.size).to.equal(0);
      await work();
      expect(read("SELECT status FROM zosd_l3_stage WHERE check_date='20261002' AND stage_no=2")[0].status.trim()).to.equal('DONE');
    }finally{manager.get_daemon_info=info;}
  }
  it('a run started while the old daemon awaits ON_STOP still advances through the job tail',stoppingRace);
  it('RunStat equals an independent oracle over every DONE pile', async () => {
    await run();await work();
    await dialogStep(async()=> {
      const piles=read("SELECT * FROM zosd_l3_pile WHERE status='DONE'");
      for (const [index,pile] of piles.entries()) {
        const ended=index % 2 ? '20261001000111' : '20261001000105';
        await sql(`UPDATE zosd_l3_pile SET started='20261001000059', ended='${ended}' WHERE run_id='${pile.run_id}' AND rule_name='${pile.rule_name}' AND pile_no=${Number(pile.pile_no)}`);
      }
      await cls().doctor({});
    });
    const oracle=()=> {
      const rows=read('SELECT * FROM zosd_l3_pile');
    const done=rows.filter(r=>r.status.trim()==='DONE');
    const epoch=(value)=>{const t=String(value);return Date.parse(`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(8,10)}:${t.slice(10,12)}:${t.slice(12,14)}Z`)/1000;};
    const seconds=done.map(r=>epoch(r.ended)-epoch(r.started)).sort((a,b)=>a-b);
    const stats=read('SELECT * FROM zosd_l3_runstat')[0];
    expect(Number(stats.piles_done)).to.equal(done.length);
    expect(Number(stats.piles_failed)).to.equal(rows.filter(r=>r.status.trim()==='FAILED'||r.status.trim()==='FUSED').length);
    expect(Number(stats.piles_running)).to.equal(rows.filter(r=>r.status.trim()==='RUNNING').length);
    expect(Number(stats.piles_held)).to.equal(rows.filter(r=>r.status.trim()==='HELD').length);
    expect(Number(stats.mean_secs)).to.equal(Number((seconds.reduce((a,b)=>a+b,0)/seconds.length).toFixed(3)));
    const n=seconds.length; expect(Number(stats.median_secs)).to.equal((seconds[Math.floor((n-1)/2)]+seconds[Math.floor(n/2)])/2);
    };
    oracle();
    // Four remaining DONE piles exercise the even median; include each other counter.
    await dialogStep(async()=> {
      const piles=read('SELECT * FROM zosd_l3_pile');
      for (const [index,status] of ['HELD','FAILED','RUNNING'].entries()) {
        const pile=piles[index];
        await sql(`UPDATE zosd_l3_pile SET status='${status}' WHERE run_id='${pile.run_id}' AND rule_name='${pile.rule_name}' AND pile_no=${Number(pile.pile_no)}`);
      }
      await cls().doctor({});
    });
    oracle();
  });
  it('mutants by copy: no start, no notification, no healing, no counting, no self-stop each breaks its assertion', async () => {
    const cases=[
      ['no-start','zcl_l3_fleet2',t=>t.replace('static async start_daemon(INPUT) {','static async start_daemon(INPUT) { return new abap.types.Character(1);'),async()=>{
        await run();expect(daemonHost(abap).instances.size).to.equal(0);
      }],
      ['no-message','zcl_l3_fleet2',t=>t.replace('static async pile_done(INPUT) {','static async pile_done(INPUT) { return;'),async()=>{
        await run();await initialPassFirst();await work();expect(read("SELECT * FROM zosd_l3_runstat")[0].piles_done).to.equal(0);
      }],
      ['no-heal','zcl_l3_fleet2',t=>t.replace("lv_reason.set(abap.CharacterFactory.get(9, 'JOB-ENDED'));","lv_reason.clear();"),async()=>{
        const original=abap.Classes.ZCL_L2_SHIP_BUSY.keys;abap.Classes.ZCL_L2_SHIP_BUSY.keys=async()=>{throw new Error('dump');};
        try {await run();await work();await clock.advance(10000);await work();}finally{abap.Classes.ZCL_L2_SHIP_BUSY.keys=original;}
        expect(read("SELECT * FROM zosd_l3_doctor WHERE doc_action='FAILED'")).to.have.length(0);
      }],
      ['no-count','zcl_l3_fleet2',t=>t.replace('static async count_runs() {','static async count_runs() { return;'),async()=>{
        await run();await work();expect(read('SELECT * FROM zosd_l3_runstat')).to.have.length(0);
      }],
      ['no-stop','zcl_l3_fleet2_dmn',t=>t.replace("if_abap_daemon_context$stop();", "if_abap_daemon_context$get_instance_id();"),async()=>{
        await run();await work();await clock.advance(10000);await daemonHost(abap).idle();expect(daemonHost(abap).instances.size).to.equal(1);
      }],
    ];
    for (const [name,clsName,edit,check] of cases) {
      for(const table of tables) await sql(`DELETE FROM ${table}`);
      await mutant(name,clsName,edit,check);
      // Settle abandoned queued jobs before installing the next mutant.
      await abandonJobs();
    }
  });
  it('P2 mutants by copy: missing sink fence, tail fence, abort, GLASS sleep, kill stop or fallback fail their oracles',async()=> {
    const reset=async()=> {
      await daemonHost(abap).close();
      for(const table of tables)await sql(`DELETE FROM ${table}`);
      await abandonJobs();
      clock.set(Date.parse('2026-10-01T00:00:00Z'));
    };
    await reset();
    await mutant('no-sink-fence','zcl_l3_fleet2',t=>t.replaceAll('if (abap.compare.eq((await this.owns_pile({is_pile: ls_pile, rv_ok: 1})), abap.builtin.abap_false)) {','if (false) {'),async()=> {
      const late=await lateAttempt();expect(late.status).not.to.equal('STALE-JOB');expect(late.work).not.to.deep.equal(late.beforeWork);
    });
    await reset();
    await mutant('no-alert-fence','zcl_l3_fleet2',t=>t.replaceAll('if (abap.compare.eq((await this.owns_pile({is_pile: ls_pile, rv_ok: 1})), abap.builtin.abap_false)) {','if (false) {'),async()=> {
      const late=await lateAttempt(true);expect(late.sinkWrites).to.be.greaterThan(0);
    });
    await reset();
    await mutant('no-tail-fence','zcl_l3_fleet2',t=>t.replace('if (abap.compare.eq(iv_owned, abap.builtin.abap_true) &&', 'if (false &&'),async()=> {
      await run();await daemonHost(abap).idle();
      const pile=read('SELECT * FROM zosd_l3_pile WHERE stage_no=1')[0];
      const row=new abap.types.Structure(Object.fromEntries(Object.entries(pile).map(([key,value])=>
        [key,typeof value==='number'?new abap.types.Integer().set(value):str(String(value??''))])));
      row.get().status.set('DONE');row.get().attempt.set(pile.attempt-1);
      await dialogStep(()=>cls().save_pile({is_pile:row,iv_owned:str('X')}));
      expect(read('SELECT status FROM zosd_l3_pile WHERE stage_no=1')[0].status.trim()).to.equal('DONE');
    });
    await reset();
    await mutant('no-abort','zcl_l3_fleet2',t=>t.replace("await abap.FunctionModules['BP_JOB_ABORT']({exporting: {jobname: ls_pile.get().job_name, jobcount: ls_pile.get().job_count}});",'abap.builtin.sy.get().subrc.set(0);'),async()=> {
      await run();await daemonHost(abap).idle();await drainJobOutbox(store);
      const claimed=store.claimNext(), pile=read('SELECT * FROM zosd_l3_pile WHERE stage_no=1')[0];
      expect(claimed.run.jobName).to.equal(pile.job_name.trim());expect(claimed.run.jobCount).to.equal(pile.job_count.trim());
      await dialogStep(()=>sql("UPDATE zosd_l3_pile SET status='RUNNING', started='20261001000000' WHERE stage_no=1"));
      clock.set(Date.parse('2026-10-01T00:16:00Z'));await dialogStep(()=>cls().doctor({}));
      expect(store.get(claimed.run.id).state).to.equal('RUNNING');
    });
    await reset();
    await mutant('no-glass-sleep','zcl_l3_fleet2',t=>t.replace('if (abap.compare.eq((await this.budget_state({iv_run: ls_run.get().run_id, rv_state: 1})), abap.CharacterFactory.get(5, \'GLASS\'))) {','if (false) {'),async()=> {
      const quiet=await quietHour('glass',3);expect(quiet.passes).to.be.greaterThan(1);
    });
    await reset();
    await mutant('no-kill-stop','zcl_l3_fleet2',t=>t.replace('await this.stop_daemon();','await this.daemon_status();'),async()=> {
      await run();await daemonHost(abap).idle();
      await dialogStep(()=>cls().set_kill({iv_reason:str('operator pause')}));await daemonHost(abap).idle();
      expect(daemonHost(abap).instances.size).to.equal(1);
    });
    await reset();
    await mutant('no-tail-advance','zcl_osd_gui_l3_fleet2',t=>t.replace("await abap.Classes['ZCL_L3_FLEET2'].advance(","await abap.Classes['ZCL_L3_FLEET2'].pile_done("),async()=> {
      let failure;try{await stoppingRace();}catch(error){failure=error;}
      expect(failure?.message).to.include("expected 'WAITING' to equal 'DONE'");
    });
    await reset();
  });
  it('generic BP_JOB_ABORT refuses unknown, foreign and non-running jobs and preserves the business LUW',async()=> {
    await run();await daemonHost(abap).idle();await drainJobOutbox(store);
    const claimed=store.claimNext(), pile=read('SELECT * FROM zosd_l3_pile WHERE stage_no=1')[0];
    expect(claimed.run.jobName).to.equal(pile.job_name.trim());expect(claimed.run.jobCount).to.equal(pile.job_count.trim());
    const abort=()=>abap.FunctionModules.BP_JOB_ABORT({exporting:{jobname:str(pile.job_name.trim()),jobcount:str(pile.job_count.trim())}});
    await dialogStep(async()=> {
      await sql("UPDATE zosd_job_identity SET owner='OTHER' WHERE jobname='"+pile.job_name.trim()+"'");
    });
    let refused;try{await dialogStep(abort);}catch(error){refused=error;}
    expect(String(refused?.classic).toUpperCase()).to.equal('NO_ABORT_AUTHORITY');expect(store.get(claimed.run.id).state).to.equal('RUNNING');
    await dialogStep(()=>sql("UPDATE zosd_job_identity SET owner='"+abap.builtin.sy.get().uname.get().trim()+"' WHERE jobname='"+pile.job_name.trim()+"'"));
    await dialogStep(async()=> {
      await client.beginTransaction();
      await sql("INSERT INTO zosd_l3_kill (mandt,set_name) VALUES ('123','rollback-probe')");
      await abort();
      throw new Error('roll back business LUW');
    }).catch(error=>expect(error.message).to.equal('roll back business LUW'));
    expect(read("SELECT * FROM zosd_l3_kill WHERE set_name='rollback-probe'")).to.have.length(0);
    expect(store.get(claimed.run.id).state).to.equal('INTERRUPTED');
    for(const count of [pile.job_count.trim(),'99999999']) {
      let error;try{await dialogStep(()=>abap.FunctionModules.BP_JOB_ABORT({exporting:{jobname:str(pile.job_name.trim()),jobcount:str(count)}}));}catch(e){error=e;}
      expect(String(error?.classic).toUpperCase()).to.equal(count===pile.job_count.trim()?'JOB_NOT_RUNNING':'JOB_DOES_NOT_EXIST');
    }
  });
  it('a generic worker recognizes an aborted claim and cannot record a late success',async()=> {
    await run();await daemonHost(abap).idle();await drainJobOutbox(store);
    const pile=read('SELECT * FROM zosd_l3_pile WHERE stage_no=1')[0];
    const outcome=await workQueuedBatch(process.cwd(),store,async()=> {
      await dialogStep(()=>abap.FunctionModules.BP_JOB_ABORT({exporting:{jobname:str(pile.job_name.trim()),jobcount:str(pile.job_count.trim())}}));
      return {status:'COMPLETED',lines:[]};
    });
    expect(outcome.kind).to.equal('interrupted');expect(outcome.run.state).to.equal('INTERRUPTED');
    expect(outcome.run.steps[0].state).to.equal('INTERRUPTED');
  });
  it('event release plans waiting jobs and enforces lanes, kill and GLASS before completing both stages', async()=> {
    const model=compileSet(SET);
    model.release_event={"@id":`${model['@id']}/piles`,set_line:model.set_line,lanes:'2'};
    await variantRunner(model,'release-event',async()=> {
      expect((await dialogStep(()=>cls().set_setting({iv_param:str('budget.glass'),iv_value:str('1000'),iv_note:str('release fixture capacity')}))).get()).to.equal('X');
      for(let i=1;i<8;i++) {
        await sql(`INSERT INTO zosd_l2_ship (mandt,ship_id,name,status) VALUES ('123','E${String(i).padStart(3,'0')}','Ship','A')`);
        await sql(`INSERT INTO zosd_l2_voy (mandt,voyage_id,ship_id,dep_date) VALUES ('123','E${String(i).padStart(5,'0')}','E${String(i).padStart(3,'0')}','20261005')`);
      }
      await run();await daemonHost(abap).idle();await drainJobOutbox(store);
      expect(read("SELECT * FROM zosd_l3_pile WHERE reason='EVENT-WAIT'")).to.have.length(4);
      await initialPassFirst();
      expect(read("SELECT * FROM zosd_l3_pile WHERE reason='EVENT-SENT'")).to.have.length(2);
      expect(read("SELECT * FROM zosd_l3_pile WHERE reason='EVENT-WAIT'")).to.have.length(2);
      await dialogStep(()=>sql("UPDATE zosd_l3_budget SET state='GLASS'"));
      await dialogStep(()=>cls().release_events());
      expect(read("SELECT * FROM zosd_l3_pile WHERE reason='EVENT-SENT'")).to.have.length(2);
      await dialogStep(()=>sql("UPDATE zosd_l3_budget SET state='NARROW'"));
      await dialogStep(()=>cls().release_events());
      expect(read("SELECT * FROM zosd_l3_pile WHERE reason='EVENT-SENT'")).to.have.length(2);
      await dialogStep(()=>sql("UPDATE zosd_l3_budget SET state='RUNNING'"));
      await work(1);
      // A set kill suppresses releases after an actual pile frees a lane.
      await dialogStep(()=>sql("INSERT INTO zosd_l3_kill (mandt,set_name) VALUES ('123','fleet2')"));
      await dialogStep(()=>cls().release_events());
      expect(read("SELECT * FROM zosd_l3_pile WHERE status='PLANNED' AND reason='EVENT-SENT'")).to.have.length(1);
      await dialogStep(()=>sql('DELETE FROM zosd_l3_kill'));
      await work();
      for(let i=0;i<8 && read("SELECT * FROM zosd_l3_run WHERE status='HELD'").length;i++){await clock.advance(10000);await work();}
      expect(read("SELECT status FROM zosd_l3_stage WHERE stage_no=2")[0].status.trim(), JSON.stringify(read('SELECT status,reason FROM zosd_l3_pile'))).to.equal('DONE');
    });
  });
  it('SAP_END_OF_JOB releases an exact name/count watcher on success, abort and interruption', async () => {
    const folder=join(dir,'kernel-end');const isolated=new BatchRuns(folder,{OSD_OPERATIONS_DB:join(dir,'kernel-end.sqlite')});
    const uuid=()=>randomUUID().replaceAll('-','');const instance=uuid();
    const intent=(name,count,extra={})=>({intentId:uuid(),sourceDb:join(folder,'business.sqlite'),client:'123',sysid:'OSG',owner:'TESTER',
      jobname:name,jobcount:count,program:'Z_FIRST',generation:'test',sourceInstance:instance,steps:[{number:1,program:'Z_FIRST'}],...extra});
    try {
      for(const [index,status] of ['COMPLETED','FAILED','INTERRUPTED'].entries()) {
        const name=`PILE_${index}`, count=`0000000${index+1}`;
        const parent=isolated.importIntent(intent(name,count)).run;
        const watcher=isolated.importIntent(intent(`WATCH_${index}`,`0000000${index+4}`,{namedEvent:{id:'SAP_END_OF_JOB',param:name.padEnd(32,' ')+count,sourceInstance:instance,seq:isolated.reserveSignalSeq()}})).run;
        expect(watcher.state).to.equal('WAITING');isolated.claimNext();
        if(status==='INTERRUPTED')isolated.interruptQueued(parent.id);else isolated.finishStep(parent.id,1,{status});
        expect(isolated.get(watcher.id).state).to.equal('QUEUED');
        const signal=isolated.db.prepare("SELECT * FROM batch_named_events WHERE event_id='SAP_END_OF_JOB' AND event_param=?").get(name.padEnd(32,' ')+count);
        expect(signal.intent_id).to.match(/^[0-9a-f]{32}$/);
        isolated.claimNext();isolated.finishStep(watcher.id,1,{status:'COMPLETED'});
      }
    }finally{isolated.close();}
  });
  it('manifest validation names the line; job-only retains legacy runner and job bytes', async () => {
    const file=`src/l2demo/zz_autodoctor_${process.pid}.l3.yaml`;
    const text=readFileSync(SET,'utf8');
    try {
      for(const [from,to] of [['tick: 10','tick: 0'],['[daemon]','[daemon, daemon]'],['[daemon]','[unknown]']]) {
        writeFileSync(file,text.replace(from,to));
        expect(()=>compileSet(file)).to.throw(/doctor/).and.match(/:\d+:/);
      }
      const eventOnly=text.replace('[daemon]','[event]').replace('doctor.tick, ','');
      writeFileSync(file,eventOnly);
      const eventLine=eventOnly.split('\n').findIndex(line=>line.includes('doctor: {as: [event]'))+1;
      expect(()=>compileSet(file)).to.throw(new RegExp(`:${eventLine}: doctor.as needs daemon or job`));
      const source=readFileSync('tools/dsl-l3-resilience.mjs','utf8');
      const copied=source.replace('if (!mechanisms.includes("daemon") && !mechanisms.includes("job")) {','if (false) {');
      expect(copied).not.to.equal(source);
      const copy=join(dir,'event-only-validator.mjs');writeFileSync(copy,copied);
      const validationMutant=await import(pathToFileURL(copy).href);
      const accepted=validationMutant.compileResilience({resilience:{doctor:{as:['event']},stale:900,keep:{days:30}}},
        {id:'fixture',set:'fixture',line:()=>eventLine,fail:(line,message)=>{throw new Error(`:${line}: ${message}`);},
          staged:true,sink:{name:'alerts',variants:[{name:'capture',generated:true,class:'z_capture'}]}});
      expect(accepted.doctor.mechanisms).to.deep.equal(['event']);
      writeFileSync(file,text.replace('[daemon]','[job]').replace('doctor.tick, ',''));
      const model=compileSet(file); const rendered=await renderSet(model);
      expect(model.daemon).to.equal(undefined);
      expect(rendered.files[`${model.report}.prog.abap`]).to.include('=>advance(');
      expect(rendered.files[`${model.class}.clas.abap`]).not.to.include('start_daemon');
      expect(rendered.files[`${model.class}.clas.abap`]).to.include("WITH p_mode = 'H'");
      for(const mechanisms of ['[event, job]','[daemon, event, job]']) {
        writeFileSync(file,text.replace('[daemon]',mechanisms));
        const combined=compileSet(file), built=await renderSet(combined);
        expect(built.files[`${combined.class}.clas.abap`]).include("event_id = 'SAP_END_OF_JOB'").and.include('arm_doctor_job( ).');
        expect(built.findings.filter(f=>f.severity==='E')).to.have.length(0);
        if(mechanisms==='[event, job]') {
          expect(built.files[`${combined.class}.clas.abap`]).not.to.include('cl_abap_daemon_client_manager');
          expect(built.files[`${combined.report}.prog.abap`]).not.to.include('pile_done');
        }
      }
      // Compare the periodic-job method to the pre-slice implementation, byte for byte; a shallow
      // clone (CI) has no pre-slice commit, and only this comparison is left out there
      const history=spawnSync('git',['cat-file','-e','28d17e752:src/l2demo/zcl_l3_fleet2.clas.abap']).status===0;
      if(history) {
      const oldRunner=execFileSync('git',['show','28d17e752:src/l2demo/zcl_l3_fleet2.clas.abap'],{encoding:'utf8'});
      const method=(text)=>text.match(/  METHOD schedule_doctor\.[\s\S]*?  ENDMETHOD\./)[0];
      expect(method(rendered.files[`${model.class}.clas.abap`])).to.equal(method(oldRunner));
      const oldJob=execFileSync('git',['show','28d17e752:src/l2demo/zl3_fleet2.prog.abap'],{encoding:'utf8'});
      // Source filenames and the configurable parameter numbering are outside the doctor's tail.
      const tail=(text)=>text.slice(text.indexOf('  WRITE: / ls_rule-rule, ls_rule-status, ls_rule-alerts.'));
      expect(tail(rendered.files[`${model.report}.prog.abap`])).to.equal(tail(oldJob));
      }

    } finally {rmSync(file,{force:true});}
  });
});
