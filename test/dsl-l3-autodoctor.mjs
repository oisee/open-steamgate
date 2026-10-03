import {expect} from 'chai';
import {readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {modulesOf} from '../tools/osd-transpile.mjs';
import {lowerNarrowSubmit} from '../tools/osd-narrow-submit.mjs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
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
  let abap, dir, native, store, clock, restore, client, env;
  const cls = () => abap.Classes.ZCL_L3_FLEET2;
  const str = (s) => new abap.types.String().set(s);
  const sql = async (s) => client.execute(s);
  const read = (s, ...args) => native.prepare(s).all(...args);
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
    dir = mkdtempSync(join(tmpdir(), 'l3-autodoctor-'));
    env = Object.fromEntries(['STG_DB','STG_DB_PATH','OSD_OPERATIONS_DB'].map((k)=>[k, process.env[k]]));
    process.env.STG_DB='file'; process.env.STG_DB_PATH=join(dir,'business.sqlite'); process.env.OSD_OPERATIONS_DB=join(dir,'operations.sqlite');
    await (await import('../output/init.mjs')).initializeABAP();
    abap=globalThis.abap; client=abap.context.databaseConnections.DEFAULT;
    native = new DatabaseSync(process.env.STG_DB_PATH);
    store=new BatchRuns(process.cwd(),process.env);
    clock=manualClock('2026-10-01T00:00:00Z');restore=installAbapClock(abap,clock);
  });
  beforeEach(async () => {
    await daemonHost(abap).close();
    clock.set(Date.parse('2026-10-01T00:00:00Z'));
    for (const table of tables) await sql(`DELETE FROM ${table}`);
    for (const table of ['ship','voy','crew','cargo']) await sql(`DELETE FROM zosd_l2_${table}`);
    await sql("INSERT INTO zosd_l2_ship (mandt,ship_id,name,status) VALUES ('123','S001','Ship','A')");
    await sql("INSERT INTO zosd_l2_voy (mandt,voyage_id,ship_id,dep_date) VALUES ('123','V00001','S001','20261005')");
  });
  after(async () => {
    if (abap) await daemonHost(abap).close();
    restore?.();store?.close();native?.close();await client?.disconnect();
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
    expect(read("SELECT * FROM zosd_l3_doctor WHERE reason='JOB-SILENT'")).to.have.length(1);
    // End the deliberately silent job so it cannot occupy the next test's slot.
    store.interruptQueued(claimed.run.id);
  });
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
        await run();await initialPassFirst();await work();expect(read("SELECT status FROM zosd_l3_stage WHERE stage_no=2")[0].status.trim()).to.equal('WAITING');
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
      store.db.prepare("UPDATE batch_runs SET state='FAILED' WHERE state IN ('QUEUED','RUNNING','WAITING')").run();
    }
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
      // Compare the periodic-job method to the pre-slice implementation, byte for byte.
      const oldRunner=execFileSync('git',['show','28d17e752:src/l2demo/zcl_l3_fleet2.clas.abap'],{encoding:'utf8'});
      const method=(text)=>text.match(/  METHOD schedule_doctor\.[\s\S]*?  ENDMETHOD\./)[0];
      expect(method(rendered.files[`${model.class}.clas.abap`])).to.equal(method(oldRunner));
      const oldJob=execFileSync('git',['show','28d17e752:src/l2demo/zl3_fleet2.prog.abap'],{encoding:'utf8'});
      // Source filenames and the configurable parameter numbering are outside the doctor's tail.
      const tail=(text)=>text.slice(text.indexOf('  WRITE: / ls_rule-rule, ls_rule-status, ls_rule-alerts.'));
      expect(tail(rendered.files[`${model.report}.prog.abap`])).to.equal(tail(oldJob));

    } finally {rmSync(file,{force:true});}
  });
});
