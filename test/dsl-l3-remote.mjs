import {expect} from 'chai';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import yaml from 'js-yaml';
import {compileSet, renderSet, checkSet, explainAlert, SetError, scanGeneratedUnits} from '../tools/dsl-l3.mjs';
import {loadGenerated} from '../tools/dsl-l3-load.mjs';
import {functionModules} from '../tools/osd-fm-registry.mjs';
import {localClient, toJson, fromJson} from '../tools/rfc-replay.mjs';
import {runConvertedBatch} from '../tools/osd-batch-runs.mjs';
import {jobInputJson} from '../tools/osd-job-input.mjs';
import {cockpitService} from '../tools/dsl-l3-cockpit-service.mjs';
const SET = 'src/l2demo/fleet2.l3.yaml';
const source = readFileSync(SET,'utf8');
const trim = (x)=>typeof x === 'string' ? x.trimEnd() : x;
const plain = (x)=>Object.fromEntries(Object.entries(x.get()).filter(([,v])=>!v.array).map(([k,v])=>[k,trim(v.get())]));
const flat = (xml)=>!/<DATATYPE>(?:STRG|RSTR|REF|SSTR)<\/DATATYPE>|REF TO|TYPE (?:ANY|DATA|TABLE)\b/i.test(xml);
describe('DSL L3 remote alert seam', function () {
  this.timeout(900000);
  let dir, abap, client, dialogStep, model, files, baseFiles, prior, env, server, originals, initial, serial=0;
  const str = (s)=>new abap.types.String().set(s);
  const typ = (name)=>abap.DDIC[name.toUpperCase()].type().clone();
  const sql = (...statements)=>dialogStep(async()=>{for(const s of statements) await client.execute(s);});
  const read = (statement,...args)=>{const db=new DatabaseSync(join(dir,'test.sqlite'));try{return db.prepare(statement).all(...args).map((r)=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,trim(v)])));}finally{db.close();}};
  const run = (bind='work=sim,alerts=remote')=>dialogStep(()=>abap.Classes.ZCL_L3_FLEET2.run({iv_date:new abap.types.Date().set('20261003'),iv_mode:new abap.types.Character(1).set('S'),iv_bind:str(bind)}));
  const frozenRun = async(bind)=>{
    await dialogStep(()=>abap.Classes.ZCL_L3_FLEET2_CONF.load({}));
    const uuid=abap.Classes.CL_SYSTEM_UUID, priorCrypto=uuid.CRYPTO;let n=0;
    uuid.CRYPTO={randomUUID:()=>`00000001-0000-4000-8000-${String(++n).padStart(12,'0')}`};
    try{return await run(bind);}finally{uuid.CRYPTO=priorCrypto;}
  };
  const restore = ()=>{Object.assign(abap.Classes,originals.classes);Object.assign(abap.FunctionModules,originals.modules);};
  const copy = async (copied,names)=>loadGenerated(copied,names,join(dir,`copy-${++serial}`),model);
  const call = (header,rows)=>dialogStep(async()=>{
    const answer=typ(model.remote.receipt);
    await localClient().call(model.remote.function,{exporting:{is_header:header,it_rows:rows},importing:{es_result:answer},exceptions:{snapshot_mismatch:3,system_failure:1}});
    return {answer:plain(answer),subrc:abap.builtin.sy.get().subrc.get()};
  });
  const payload = async()=>{
    const snapshot=plain(await dialogStep(()=>abap.Classes.ZCL_L3_FLEET2.snapshot({iv_name:str('ships_ref')})));
    const rule=model.rules.find((r)=>r.name==='maintenance-ship-no-future-voyage');
    const header=typ(model.remote.header), rows=typ(model.remote.rows);
    fromJson(header,{SET_NAME:'fleet2',RUN_ID:'DETECTING',RULE_NAME:rule.name,MODEL_HASH:rule.hash,MODE:'S',CHECK_DATE:'20261003',
      PILE_NO:1,ATTEMPT:1,STAGE_NO:2,RULE_NO:Number(rule.index),SNAP_ID:snapshot.snap_id,CONTENT_HASH:snapshot.content_hash,
      ROW_COUNT:snapshot.row_count,KEY_OFFSET:Number(rule.governed.offset),KEY_LENGTH:Number(rule.governed.length),
      RULE_CLASS:rule.check_class,RULE_FILE:rule.file,RULE_LINE:rule.rule_line??1});
    fromJson(rows,[{ALERT_TEXT:'S001 requires maintenance',OBJECT_KEY:'S001',ALERT_SEQ:1}]);
    return {header,rows};
  };
  before(async()=>{
    const start=await import('./start.mjs');
    dir=mkdtempSync(join(tmpdir(),'l3-remote-'));
    env=Object.fromEntries(['STG_DB','STG_DB_PATH','OSD_OPERATIONS_DB'].map((k)=>[k,process.env[k]]));
    process.env.STG_DB='file';process.env.STG_DB_PATH=join(dir,'test.sqlite');process.env.OSD_OPERATIONS_DB=join(dir,'ops.sqlite');
    prior={...globalThis.abap.context.databaseConnections};
    await (await import('../output/init.mjs')).initializeABAP();
    abap=globalThis.abap;client=abap.context.databaseConnections.DEFAULT;
    ({dialogStep}=await import('../tools/osd-dialog-step.mjs'));
    ({files:baseFiles}=await renderSet(compileSet(SET)));
    const doc=yaml.load(source);
    doc.cockpit=undefined;
    doc.simulate={seed:42,time_scale:0,allow_sink:['log','remote'],default:{duration:{dist:'fixed',value:1},outcome:{ok:1},hits:{dist:'fixed',value:1},autoclose:0},stages:{candidates:{keep:1}}};
    doc.settings.tunable=doc.settings.tunable.filter((k)=>!['simulate.profile'].includes(k));
    doc.resilience.retry.backoff=0;
    for(const stage of doc.stages) for(const rule of stage.rules) rule.rule=join(process.cwd(),'src/l2demo',rule.rule);
    const manifest=join(dir,'fleet2.l3.yaml');writeFileSync(manifest,yaml.dump(doc));
    initial={classes:{...abap.Classes},modules:{...abap.FunctionModules}};
    model=compileSet(manifest);({files}=await renderSet(model));
    await copy(files,[model.class,model.ports_class,model.settings.class,model.simulate.work_class,model.remote.class,model.remote.group]);
    originals={classes:{...abap.Classes},modules:{...abap.FunctionModules}};
    server=start.startServer(true);
  });
  beforeEach(async()=>{
    restore();
    const tables=['zosd_l3_snap','zosd_l3_snapk','zosd_l3_run_snap','zosd_l3_doctor','zosd_l3_run_conf','zosd_l3_run','zosd_l3_stage',
      'zosd_l3_work','zosd_l3_pile','zosd_l3_alert','zosd_l3_budget','zosd_l3_event','zosd_l3_object','zosd_l3_conf','zosd_l3_conf_log',model.remote.receipt,model.remote.link];
    await sql(...tables.map((t)=>`DELETE FROM ${t}`),'DELETE FROM zosd_l2_ship','DELETE FROM zosd_l2_voy',
      "INSERT INTO zosd_l2_ship (mandt,ship_id,name,status) VALUES ('123','S001','Albatross','M')",
      "INSERT INTO zosd_l2_ship (mandt,ship_id,name,status) VALUES ('123','S002','Bluebird','A')",
      "INSERT INTO zosd_l2_voy (mandt,voyage_id,ship_id,dep_date) VALUES ('123','V00001','S001','20261005')",
      "INSERT INTO zosd_l2_voy (mandt,voyage_id,ship_id,dep_date) VALUES ('123','V00002','S002','20261005')");
  });
  after(async()=>{
    if(server) await new Promise((resolve)=>server.close(resolve));
    Object.assign(abap.Classes,initial.classes);Object.assign(abap.FunctionModules,initial.modules);await client?.disconnect?.();if(prior) abap.context.databaseConnections=prior;
    for(const [k,v] of Object.entries(env??{})) {if(v===undefined) delete process.env[k];else process.env[k]=v;}
    rmSync(dir,{recursive:true,force:true});
  });
  it('generates RFC-able DDIC parameters and a remote-enabled, callable function group',()=>{
    const r=model.remote, xml=files[`${r.group}.fugr.xml`];
    expect(xml).to.include('<REMOTE_CALL>R</REMOTE_CALL>');
    for(const name of [r.header,r.row,r.receipt]) expect(flat(files[`${name}.tabl.xml`]),name).to.equal(true);
    const fm=functionModules(['src/l2demo']).find((f)=>f.name===r.function);
    expect(fm).to.include({remote:true,implemented:true,exposed:true});
    expect(fm.parameters.map((p)=>p.type)).to.deep.equal([r.header,r.rows,r.receipt].map((s)=>s.toUpperCase()));
    for(const [name,text] of Object.entries(files)) if(/\.(abap|xml)$/.test(name)) {
      expect(/[^\x00-\x7f]/.test(text),name).to.equal(false);
      expect(text.split('\n').every((s)=>s.length<255),name).to.equal(true);
    }
    // Copies prove both gates reject a broken generated signature.
    expect(flat(files[`${r.row}.tabl.xml`].replace('<DATATYPE>CHAR</DATATYPE>','<DATATYPE>STRG</DATATYPE>'))).to.equal(false);
    expect(xml.replace('<REMOTE_CALL>R</REMOTE_CALL>','<REMOTE_CALL></REMOTE_CALL>')).not.to.include('<REMOTE_CALL>R</REMOTE_CALL>');
  });
  it('remote/NONE and local log produce identical simulated alert rows by key',async()=>{
    const local=await frozenRun('work=sim,alerts=log');expect(plain(local).status).to.equal('DONE');
    const projection=(rows)=>rows.map(({run_id,run_ts,mandt,...r})=>r);
    const expected=projection(read('SELECT * FROM zosd_l3_alert ORDER BY rule_name,pile_no,alert_seq'));
    expect(expected).not.to.have.length(0);
    await sql(...['zosd_l3_run','zosd_l3_stage','zosd_l3_pile','zosd_l3_work','zosd_l3_alert','zosd_l3_budget','zosd_l3_object','zosd_l3_event'].map((t)=>`DELETE FROM ${t}`));
    const remote=await frozenRun();expect(plain(remote).status).to.equal('DONE');
    expect(plain(remote).run_id).to.equal(plain(local).run_id);
    expect(projection(read('SELECT * FROM zosd_l3_alert ORDER BY rule_name,pile_no,alert_seq'))).to.deep.equal(expected);
    const [link]=read(`SELECT * FROM ${model.remote.link} WHERE run_id=?`,plain(remote).run_id);
    expect(link.remote_run).to.have.length(32).and.not.to.equal(link.run_id);
    expect(read('SELECT consumed FROM zosd_l3_budget WHERE run_id=?',link.remote_run)[0].consumed).to.equal(expected.length);
    expect(read('SELECT consumed FROM zosd_l3_budget WHERE run_id=?',link.run_id)[0].consumed).to.equal(0);
  });
  it('snapshot mismatch is refused and audited, and the detecting pile fails SNAP-MISMATCH',async()=>{
    const fm=abap.FunctionModules[model.remote.function];
    abap.FunctionModules[model.remote.function]=async(input)=>{
      const header=input.exporting.is_header.clone();header.get().content_hash.set('bad');
      return fm({...input,exporting:{...input.exporting,is_header:header}});
    };
    await run();
    expect(read('SELECT * FROM zosd_l3_alert')).to.have.length(0);
    const piles=read("SELECT status,reason FROM zosd_l3_pile WHERE stage_no=2 AND run_id NOT IN (SELECT remote_run FROM zl3_fleet2_rlink)");
    expect(piles).not.to.have.length(0);expect(piles.every((p)=>p.status==='FAILED'&&p.reason==='SNAP-MISMATCH')).to.equal(true);
    expect(read("SELECT * FROM zosd_l3_doctor WHERE doc_action='SNAP-MISMATCH'")).to.have.length(piles.length);
  });
  it('a copied dumping receiver maps SYSTEM_FAILURE and the doctor resubmits the piles',async()=>{
    const name=`${model.remote.group}.fugr.${model.remote.function.toLowerCase()}.abap`;
    const mutant={...files,[name]:files[name].replace(`FUNCTION ${model.remote.function.toLowerCase()}.`,`FUNCTION ${model.remote.function.toLowerCase()}.\n  ASSERT 1 = 0.`)};
    await copy(mutant,[model.remote.group]);
    await run();
    const piles=read("SELECT status,reason FROM zosd_l3_pile WHERE stage_no=2 AND run_id NOT IN (SELECT remote_run FROM zl3_fleet2_rlink)");
    expect(piles.every((p)=>p.status==='FAILED'&&p.reason==='RFC-SYSFAIL')).to.equal(true);
    restore();
    await dialogStep(()=>abap.Classes.ZCL_L3_FLEET2.doctor({}));
    expect(read("SELECT * FROM zosd_l3_doctor WHERE doc_action='RESUBMIT' AND reason='RETRY'")).not.to.have.length(0);
  });
  it('communication failure maps RFC-COMM without an invented remote reference',async()=>{
    const prior=abap.context.RFCDestinations.NONE;
    abap.context.RFCDestinations.NONE={call:async(name,sig)=>(()=>{throw new abap.ClassicError({classic:'communication_failure'});})()};
    try {await run();}finally{abap.context.RFCDestinations.NONE=prior;}
    expect(read("SELECT * FROM zosd_l3_pile WHERE stage_no=2 AND run_id NOT IN (SELECT remote_run FROM zl3_fleet2_rlink)").every((p)=>p.status==='FAILED'&&p.reason==='RFC-COMM')).to.equal(true);
    expect(read(`SELECT * FROM ${model.remote.link}`)).to.have.length(0);
  });
  it('calling the same flat payload twice writes only once and returns the durable receipt',async()=>{
    const {header,rows}=await payload();const a=await call(header,rows);
    expect(a.subrc).to.equal(0);expect(a.answer.status).to.equal('DONE');
    const before=read('SELECT * FROM zosd_l3_alert');expect(before).to.have.length(1);
    let writes=0;const update=client.update;client.update=async function(options){if(/zosd_l3_alert/i.test(JSON.stringify(options))) writes++;return update.call(this,options);};
    try {expect(await call(header,rows)).to.deep.equal(a);}finally{client.update=update;}
    expect(writes).to.equal(0);expect(read('SELECT * FROM zosd_l3_alert')).to.deep.equal(before);
    expect(read(`SELECT * FROM ${model.remote.receipt}`)).to.have.length(1);
    expect(read('SELECT consumed FROM zosd_l3_budget')[0].consumed).to.equal(1);
  });
  async function doctorLostReply() {
    const prior=abap.context.RFCDestinations.NONE;let lost=false, first, retried;
    abap.context.RFCDestinations.NONE={call:async(name,sig)=>{
      await localClient().call(name,sig);
      const h=plain(sig.exporting.is_header);
      if(!lost) {
        lost=true;first={header:h,answer:plain(sig.importing.es_result)};
        const error=new abap.ClassicError({classic:'communication_failure'});error.message='reply lost after commit';throw error;
      }
      if(first && h.rule_name===first.header.rule_name && h.pile_no===first.header.pile_no) retried={header:h,answer:plain(sig.importing.es_result)};
    }};
    let writes=0;const update=client.update;
    try {
      const result=plain(await run());
      const before=read('SELECT * FROM zosd_l3_alert');
      await dialogStep(()=>abap.Classes.ZCL_L3_FLEET2.doctor({}));
      const pile=read('SELECT * FROM zosd_l3_pile WHERE run_id=? AND rule_name=? AND pile_no=?',result.run_id,first.header.rule_name,first.header.pile_no)[0];
      expect(pile.status).to.equal('PLANNED');expect(pile.attempt).to.be.greaterThan(first.header.attempt);
      expect(read("SELECT * FROM zosd_l3_doctor WHERE run_id=? AND doc_action='RESUBMIT' AND reason='RETRY'",result.run_id)).not.to.have.length(0);
      client.update=async function(options){if(/zosd_l3_alert/i.test(JSON.stringify(options))) writes++;return update.call(this,options);};
      // Execute the actual report with the selection values the doctor persisted in SUBMIT.
      const step=read(`SELECT s.program,s.input_json FROM zosd_job_step s JOIN zosd_job_outbox o ON s.intent_id=o.intent_id
        WHERE o.jobname=? AND o.jobcount=?`,pile.job_name,pile.job_count)[0];
      expect(step).to.exist;
      const outcome=await runConvertedBatch(process.cwd(),step.program,jobInputJson(step.input_json));
      expect(outcome.status,outcome.detail).to.equal('COMPLETED');
      return {first,retried,before,after:read('SELECT * FROM zosd_l3_alert'),writes};
    } finally {client.update=update;abap.context.RFCDestinations.NONE=prior;}
  }
  it('real doctor retry after a lost reply returns the first receipt without writing again',async()=>{
    const proof=await doctorLostReply();
    expect(proof.retried.header.attempt).to.be.greaterThan(proof.first.header.attempt);
    expect(proof.retried.answer).to.deep.equal(proof.first.answer);
    expect(proof.after).to.deep.equal(proof.before);expect(proof.writes).to.equal(0);
    expect(read(`SELECT * FROM ${model.remote.receipt} WHERE run_id=? AND rule_name=? AND pile_no=?`,
      proof.first.header.run_id,proof.first.header.rule_name,proof.first.header.pile_no)).to.have.length(1);
  });
  it('mutant: attempt-dependent receipt identity fails the real doctor retry contract',async()=>{
    const name=`${model.class}.clas.abap`;
    const text=files[name].replace('    ls_claim-pile_no = is_header-pile_no.', '    ls_claim-pile_no = is_header-pile_no + is_header-attempt * 1000000.');
    expect(text).not.to.equal(files[name]);await copy({...files,[name]:text},[model.class]);
    const proof=await doctorLostReply();expect(proof.writes).to.be.greaterThan(0);
    expect(proof.retried.answer).not.to.deep.equal(proof.first.answer);
  });
  it('replay sources refuse remote alerts for every destination, even with opt-in; a guard copy fails',async()=>{
    const name=`${model.ports_class}.clas.abap`;
    const refusal=async()=>{
      try {await abap.Classes[model.ports_class.toUpperCase()].check({iv_bind:str('ships=capture,alerts=remote'),iv_allow_replay:str('X')});return '';}
      catch(error){return error.reason?.get()??String(error);}
    };
    for(const destination of ['NONE','FAR_SIDE']) {
      await dialogStep(()=>abap.Classes.ZCL_L3_FLEET2_CONF.set_setting({iv_param:str('remote.destination'),iv_value:str(destination),iv_note:str('guard test')}));
      expect(await refusal()).to.match(/every synchronous RFC commits/);
    }
    const text=files[name].replace("IF lv_replay_port IS NOT INITIAL AND variant( iv_port = 'alerts' iv_bind = iv_bind ) = 'remote'.",'IF abap_false = abap_true.');
    expect(text).not.to.equal(files[name]);await copy({...files,[name]:text},[model.ports_class]);
    expect(await refusal()).to.equal('');
  });
  it('the remote client participates in the LUW scan with only its named RFC exempted',()=>{
    const name=`${model.remote.class}.clas.abap`;
    const scan=(text)=>scanGeneratedUnits(model,files[`${model.class}.clas.abap`],[],{[name]:text});
    expect(()=>scan(files[name])).not.to.throw();
    for(const statement of ['COMMIT WORK.',"CALL FUNCTION 'Z_OTHER' DESTINATION lv_dest.","CALL FUNCTION '"+model.remote.function+"' IN BACKGROUND TASK DESTINATION lv_dest."]) {
      const copied=files[name].replace('    CLEAR: answer, failure_text.',`    ${statement}\n    CLEAR: answer, failure_text.`);
      expect(()=>scan(copied)).to.throw(/nothing generated may end/);
      // The old omitted-client scan is killed by these same copies.
      expect(()=>scanGeneratedUnits(model,files[`${model.class}.clas.abap`],[],{})).not.to.throw();
    }
  });
  it('far-side text reaches doctor audit for both RFC failures; MESSAGE-removal copies fail',async()=>{
    const name=`${model.remote.class}.clas.abap`, prior=abap.context.RFCDestinations.NONE;
    try {
      for(const classic of ['system_failure','communication_failure']) {
        const text=classic==='system_failure'?'receiver dump detail':'receiver connection detail';
        abap.context.RFCDestinations.NONE={call:async()=>{const e=new abap.ClassicError({classic});e.message=text;throw e;}};
        await run();
        expect(read('SELECT * FROM zosd_l3_doctor WHERE reason=?',text)).not.to.have.length(0);
        await sql('DELETE FROM zosd_l3_doctor','DELETE FROM zosd_l3_run');
        const copied=files[name].replace(/ MESSAGE lv_msg/g,'');
        await copy({...files,[name]:copied},[model.remote.class]);
        await run();expect(read('SELECT * FROM zosd_l3_doctor WHERE reason=?',text)).to.have.length(0);
        restore();await sql('DELETE FROM zosd_l3_doctor','DELETE FROM zosd_l3_run');
      }
    } finally {abap.context.RFCDestinations.NONE=prior;}
  });
  it('NONE dump isolation anomaly: partial writes persist; rollback copy also destroys caller writes',async()=>{
    const name=`${model.remote.group}.fugr.${model.remote.function.toLowerCase()}.abap`;
    const text=files[name].replace(`FUNCTION ${model.remote.function.toLowerCase()}.`, `FUNCTION ${model.remote.function.toLowerCase()}.\n  DATA ls_partial TYPE zosd_l2_ship.\n  ls_partial-ship_id = 'RCVR'.\n  INSERT zosd_l2_ship FROM ls_partial.\n  ASSERT 1 = 0.`);
    await copy({...files,[name]:text},[model.remote.group]);
    const {header,rows}=await payload();
    const invoke=async(rfc)=>dialogStep(async()=>{
      await client.beginTransaction();
      await client.execute("INSERT INTO zosd_l2_ship (ship_id) VALUES ('CLLR')");
      await rfc.call(model.remote.function,{exporting:{is_header:header,it_rows:rows},importing:{es_result:typ(model.remote.receipt)},exceptions:{system_failure:1}});
      expect(abap.builtin.sy.get().subrc.get()).to.equal(1);
    });
    await invoke(localClient());
    expect(read("SELECT ship_id FROM zosd_l2_ship WHERE ship_id IN ('CLLR','RCVR') ORDER BY ship_id")).to.deep.equal([{ship_id:'CLLR'},{ship_id:'RCVR'}]);
    await sql("DELETE FROM zosd_l2_ship WHERE ship_id IN ('CLLR','RCVR')");
    // Copy the local client's code; adding an unconditional dump rollback loses the caller too.
    const path=join(dir,'rollback-local.mjs');
    const localSource=readFileSync('tools/rfc-replay.mjs','utf8');
    const rollbackSource=localSource.replace('        localFailure(error, signature);','        await globalThis.abap.context.databaseConnections.DEFAULT.rollback();\n        localFailure(error, signature);');
    expect(rollbackSource).not.to.equal(localSource);
    // Preserve imports relative to tools for the copy.
    writeFileSync(path,rollbackSource.replace(/from "(\.\/[^"]+)"/g,(_,p)=>`from "${join(process.cwd(),'tools',p)}"`));
    const rollback=await import(path);await invoke(rollback.localClient());
    expect(read("SELECT ship_id FROM zosd_l2_ship WHERE ship_id IN ('CLLR','RCVR')")).to.have.length(0);
  });
  it('POST /call/<NAME> marshals the flat payload through the existing RFC channel',async()=>{
    const {header,rows}=await payload();
    const response=await fetch(`http://localhost:${process.env.STG_PORT??3030}/sap/bc/osd/rfc/call/${model.remote.function}`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({IMPORTING:{IS_HEADER:toJson(header),IT_ROWS:toJson(rows)}})});
    expect(response.status).to.equal(200);const result=await response.json();
    expect(result.EXPORTING.ES_RESULT.STATUS.trim()).to.equal('DONE');expect(result.EXPORTING.ES_RESULT.REMOTE_RUN.trim()).to.have.length(32);
    expect(read('SELECT * FROM zosd_l3_alert')).to.have.length(1);
  });
  it('receiver uses its own budget and closing policy',async()=>{
    const {header,rows}=await payload();fromJson(rows,[{ALERT_TEXT:'S001 requires maintenance'},{ALERT_TEXT:'S002 requires maintenance'}]);
    await dialogStep(()=>abap.Classes.ZCL_L3_FLEET2_CONF.set_setting({iv_param:str('budget.glass'),iv_value:str('1'),iv_note:str('receiver policy')}));
    const result=await call(header,rows);expect(result.answer.status).to.equal('GLASS');
    expect(read('SELECT * FROM zosd_l3_alert')).to.have.length(0);
    expect(read('SELECT state FROM zosd_l3_budget')[0].state).to.equal('GLASS');
  });
  it('receiver continuation and pile release control subsequent sends',async()=>{
    const {header,rows}=await payload();fromJson(rows,[{ALERT_TEXT:'S001 requires maintenance'},{ALERT_TEXT:'S002 requires maintenance'}]);
    await dialogStep(()=>abap.Classes.ZCL_L3_FLEET2_CONF.set_setting({iv_param:str('budget.glass'),iv_value:str('1'),iv_note:str('receiver glass')}));
    const glass=await call(header,rows);expect(glass.answer.status).to.equal('GLASS');
    const continued=await dialogStep(()=>abap.Classes.ZCL_L3_FLEET2.continue_glass({iv_run:str(glass.answer.remote_run),iv_new_glass:new abap.types.Integer().set(3),iv_reason:str('receiver continuation')}));
    expect(trim(continued.get())).to.equal('X');expect((await call(header,rows)).answer.status).to.equal('DONE');
    header.get().run_id.set('SECOND');
    await dialogStep(()=>abap.Classes.ZCL_L3_FLEET2_CONF.set_setting({iv_param:str('budget.glass'),iv_value:str('3'),iv_note:str('receiver default')}));
    await dialogStep(()=>abap.Classes.ZCL_L3_FLEET2_CONF.set_setting({iv_param:str('budget.per_pile'),iv_value:str('1'),iv_note:str('receiver cap')}));
    const held=await call(header,rows);expect(held.answer.status).to.equal('HELD');
    const released=await dialogStep(()=>abap.Classes.ZCL_L3_FLEET2.release_pile({iv_run:str(held.answer.remote_run),iv_rule:str(plain(header).rule_name),
      iv_pile:new abap.types.Integer().set(1),iv_per_pile:new abap.types.Integer().set(2),iv_reason:str('receiver release')}));
    expect(trim(released.get())).to.equal('X');expect((await call(header,rows)).answer.status).to.equal('DONE');
    expect(read("SELECT * FROM zosd_l3_event WHERE kind='CONTINUE' OR kind='RELEASE'")).to.have.length(2);
  });
  it('receiving closing adapter refunds the receiving budget',async()=>{
    const name=`${model.ports_class}.clas.abap`;
    const mutant={...files,[name]:files[name].replace("rv_variant = 'none'.", "rv_variant = 'maintenance'.")};
    expect(mutant[name]).not.to.equal(files[name]);await copy(mutant,[model.ports_class]);
    const {header,rows}=await payload();const result=await call(header,rows);
    expect(result.answer.closed).to.equal(1);expect(result.answer.open_alerts).to.equal(0);
    expect(read('SELECT reserved,consumed,refunded FROM zosd_l3_budget')[0]).to.deep.equal({reserved:0,consumed:1,refunded:1});
    expect(read('SELECT closed FROM zosd_l3_alert')[0].closed).to.equal('X');
  });
  it('remote metadata appears in RunSet and explain',async()=>{
    expect(cockpitService(compileSet(SET)).doc.entities.Run.properties.RemoteRun).to.include({type:'String(32)',field:'REMOTE_RUN'});
    // Use real detection for explain's rule-version lookup.
    await run('alerts=remote');
    const alert=read('SELECT * FROM zosd_l3_alert')[0];expect(alert).to.exist;
    const key=`fleet2/${alert.rule_name}/${alert.model_hash.replace('sha256:','')}/20261003/${alert.pile_no}/${alert.alert_seq}`;
    const result=await explainAlert(key,{sets:[SET],db:join(dir,'test.sqlite')});expect(result.text).to.include(`remote  ${alert.run_id}`);
  });
  it('destination setting and client-side run-reference persistence work for a separate receiver',async()=>{
    const dest='FLEET_RECEIVER';let calls=0;
    await dialogStep(()=>abap.Classes.ZCL_L3_FLEET2_CONF.set_setting({iv_param:str('remote.destination'),iv_value:str(dest),iv_note:str('receiving system')}));
    abap.context.RFCDestinations[dest]={call:async(name,sig)=>{
      calls++;expect(name).to.equal(model.remote.function);
      const h=plain(sig.exporting.is_header);expect(h.mode).to.equal('S');expect(h.snap_id).to.have.length(32);
      fromJson(sig.importing.es_result,{SET_NAME:h.set_name,RUN_ID:h.run_id,RULE_NAME:h.rule_name,PILE_NO:h.pile_no,ATTEMPT:h.attempt,
        REMOTE_RUN:'FAR_RUN',STATUS:'DONE',ALERTS:sig.exporting.it_rows.array().length});
    }};
    try {
      const result=plain(await run());expect(calls).to.equal(6);
      expect(read(`SELECT * FROM ${model.remote.link}`)).to.have.length(1);expect(read(`SELECT remote_run FROM ${model.remote.link}`)[0].remote_run).to.equal('FAR_RUN');
      const response=await fetch(`http://localhost:${process.env.STG_PORT??3030}/sap/opu/odata/sap/ZL3C_FLEET2_SRV/RunSet?$format=json`);
      expect(response.status).to.equal(200);const data=await response.json();
      expect(data.d.results.find((r)=>r.RunId===result.run_id).RemoteRun).to.equal('FAR_RUN');
      const name=`${model.remote.class}.clas.abap`;
      await copy({...files,[name]:files[name].replace(`    MODIFY ${model.remote.link} FROM ls_link.`, '')},[model.remote.class]);
      await sql(`DELETE FROM ${model.remote.link}`, 'DELETE FROM zosd_l3_run');
      await run();expect(read(`SELECT * FROM ${model.remote.link}`)).to.have.length(0); // The reference assertion goes red.
    } finally {delete abap.context.RFCDestinations[dest];}
  });
  it('a copied failure mapper is killed by the dump outcome assertion',async()=>{
    const module=`${model.remote.group}.fugr.${model.remote.function.toLowerCase()}.abap`, adapter=`${model.remote.class}.clas.abap`;
    await copy({...files,[module]:files[module].replace(`FUNCTION ${model.remote.function.toLowerCase()}.`, `FUNCTION ${model.remote.function.toLowerCase()}.\n  ASSERT 1 = 0.`),
      [adapter]:files[adapter].replace("answer-status = 'RFC-SYSFAIL'", "answer-status = 'RFC-COMM'")},[model.remote.group,model.remote.class]);
    await run();
    const piles=read("SELECT reason FROM zosd_l3_pile WHERE stage_no=2 AND run_id NOT IN (SELECT remote_run FROM zl3_fleet2_rlink)");
    expect(piles).to.have.length(6);expect(piles.every((p)=>p.reason==='RFC-COMM')).to.equal(true); // RFC-SYSFAIL assertion goes red.
  });
  it('validation identifies malformed remote declarations at their manifest line',()=>{
    for(const [from,to,pattern] of [['function: Z_L3_FLEET2_ALERTS','function: bad-name',/function is a Z name/],
      ['destination: remote.destination','destination: "bad destination"',/destination is/],
      ['group: ZL3_FLEET2_RFC','group: '+ 'Z'.repeat(31),/group is a Z name/]]) {
      const bad=source.replace(from,to).replace(/rule: ([a-z_]+\.l2\.yaml)/g,(_,f)=>`rule: ${join(process.cwd(),'src/l2demo',f)}`);
      const manifest=join(dir,`bad-${++serial}.l3.yaml`);writeFileSync(manifest,bad);
      let error;try{compileSet(manifest);}catch(e){error=e;}
      expect(error).to.be.instanceOf(SetError);expect(error.message).to.match(pattern);
      expect(error.line).to.equal(bad.split('\n').findIndex((s)=>s.includes(to))+1);
    }
  });
  it('snapshot bypass and receipt bypass copies are killed by the contract',async()=>{
    const name=`${model.remote.group}.fugr.${model.remote.function.toLowerCase()}.abap`;
    const {header,rows}=await payload();header.get().content_hash.set('bad');
    expect((await call(header,rows)).subrc).to.equal(3);
    await copy({...files,[name]:files[name].replace(' = abap_false.',' = abap_true.')},[model.remote.group]);
    expect((await call(header,rows)).subrc).to.equal(0); // The refusal assertion goes red.
    restore();header.get().content_hash.set(read('SELECT content_hash FROM zosd_l3_snap')[0].content_hash);
    await sql(`DELETE FROM ${model.remote.receipt}`);
    await call(header,rows);
    const runner=`${model.class}.clas.abap`;
    await copy({...files,[runner]:files[runner].replace('      RETURN.\n    ENDIF.\n    SELECT SINGLE * FROM '+model.remote.link,
      '    ENDIF.\n    SELECT SINGLE * FROM '+model.remote.link)},[model.class]);
    let writes=0;const update=client.update;client.update=async function(o){if(/zosd_l3_alert/i.test(JSON.stringify(o))) writes++;return update.call(this,o);};
    try{await call(header,rows);}finally{client.update=update;}
    expect(writes).to.be.greaterThan(0); // The zero-writes assertion goes red.
  });
  it('fresh builds match fleet and fleet2',async()=>{
    expect(await checkSet('src/l2demo/fleet.l3.yaml','src/l2demo')).to.deep.equal([]);
    expect(await checkSet(SET,'src/l2demo')).to.deep.equal([]);
  });
});
