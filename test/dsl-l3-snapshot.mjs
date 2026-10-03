import {expect} from 'chai';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {compileSet, renderSet, checkSet, explainAlert, SetError} from '../tools/dsl-l3.mjs';
import {loadGenerated} from '../tools/dsl-l3-load.mjs';
import {cockpitService} from '../tools/dsl-l3-cockpit-service.mjs';
import {l3TableNames} from './helpers/dsl-l3-tables.mjs';
const SET = 'src/l2demo/fleet2.l3.yaml';
const text = readFileSync(SET, 'utf8');
const hash = (s) => createHash('sha256').update(s).digest('hex');
const value = (s) => `${s.length}:${s}`;
const trim = (s) => typeof s === 'string' ? s.trimEnd() : s;
const plain = (s) => Object.fromEntries(Object.entries(s.get()).map(([k,v]) => [k,trim(v.get())]));
const tables = ['zosd_l3_snap','zosd_l3_snapk','zosd_l3_run_snap','zosd_l3_doctor','zosd_l3_run_conf',
  'zosd_l3_run','zosd_l3_stage','zosd_l3_work','zosd_l3_pile','zosd_l3_alert','zosd_l3_budget','zosd_l3_event','zosd_l3_object'];
describe('DSL L3 input snapshots', function () {
  this.timeout(900000);
  let dir, dbPath, abap, client, dialogStep, files, model, prior, env;
  const str = (s) => new abap.types.String().set(s);
  const cls = () => abap.Classes.ZCL_L3_FLEET2;
  const exec = (...sql) => dialogStep(async () => {for (const s of sql) await client.execute(s);});
  const read = (sql, ...args) => {const db = new DatabaseSync(dbPath); try {return db.prepare(sql).all(...args);} finally {db.close();}};
  const snap = (name='ships_ref', extra={}) => dialogStep(() => cls().snapshot({iv_name:str(name),...extra}));
  const seed = (rows=[['S002','Bluebird','A'],['S001','Albatross','M']]) => exec('DELETE FROM zosd_l2_ship', ...rows.map(([id,n,s]) =>
    `INSERT INTO zosd_l2_ship (mandt,ship_id,name,status) VALUES ('123','${id}','${n}','${s}')`));
  before(async () => {
    await import('./start.mjs');
    dir = mkdtempSync(join(tmpdir(),'l3-snapshot-')); dbPath=join(dir,'test.sqlite');
    env=Object.fromEntries(['STG_DB','STG_DB_PATH','OSD_OPERATIONS_DB'].map((k)=>[k,process.env[k]]));
    process.env.STG_DB='file'; process.env.STG_DB_PATH=dbPath; process.env.OSD_OPERATIONS_DB=join(dir,'ops.sqlite');
    prior = {...globalThis.abap.context.databaseConnections};
    await (await import('../output/init.mjs')).initializeABAP();
    abap=globalThis.abap; client=abap.context.databaseConnections.DEFAULT;
    ({dialogStep}=await import('../tools/osd-dialog-step.mjs'));
    model=compileSet(SET); ({files}=await renderSet(model));
  });
  beforeEach(async()=>{await exec(...tables.map((t)=>`DELETE FROM ${t}`), 'DELETE FROM zosd_l2_voy', "INSERT INTO zosd_l2_voy (mandt,voyage_id,ship_id,dep_date) VALUES ('123','V00001','S001','20261005')", "INSERT INTO zosd_l2_voy (mandt,voyage_id,ship_id,dep_date) VALUES ('123','V00002','S002','20261005')"); await seed();});
  after(async()=>{await client?.disconnect?.(); if (prior) abap.context.databaseConnections=prior;
    for (const [k,v] of Object.entries(env??{})) {if(v===undefined) delete process.env[k];else process.env[k]=v;} rmSync(dir,{recursive:true,force:true});});
  it('checks both generated sets and the read-only SnapshotSet', async()=>{
    expect(await checkSet(SET,'src/l2demo')).to.deep.equal([]);
    expect(await checkSet('src/l2demo/fleet.l3.yaml','src/l2demo')).to.deep.equal([]);
    const service=cockpitService(model).doc.entities.InputSnapshot;
    expect(service).to.include({set:'SnapshotSet',creatable:false,updatable:false,deletable:false});
    for(const [name,source] of Object.entries(files)) if(name.endsWith('.abap')) {
      expect(/[^\x00-\x7f]/.test(source),name).to.equal(false);
      expect(source.split('\n').every((s)=>s.length<255),name).to.equal(true);
    }
  });
  it('has exact canonical bytes independent of read order and client keys', async()=>{
    const a=plain(await snap());
    expect(a.content_hash).to.equal(hash('4:S0019:Albatross1:M;4:S0028:Bluebird1:A;'));
    await seed([['S001','Albatross','M'],['S002','Bluebird','A']]);
    await exec("UPDATE zosd_l2_ship SET mandt='999'");
    const b=plain(await snap()); expect(b.content_hash).to.equal(a.content_hash);expect(b.snap_id).to.equal(a.snap_id);
    expect(read('SELECT * FROM zosd_l3_snap')).to.have.length(1);expect(read('SELECT * FROM zosd_l3_snapk')).to.have.length(2);
  });
  it('reuses unchanged input and creates an identity for changed content',async()=>{
    const a=plain(await snap());expect(plain(await snap()).snap_id).to.equal(a.snap_id);
    await exec("UPDATE zosd_l2_ship SET status='A' WHERE ship_id='S001'");
    const b=plain(await snap());expect(b.snap_id).not.to.equal(a.snap_id);expect(b.content_hash).not.to.equal(a.content_hash);
    expect(read('SELECT * FROM zosd_l3_snap')).to.have.length(2);
  });
  it('a competing capture between the lookup and insert reuses the unique content row',async()=>{
    const existing=plain(await snap());const select=client.select;let raced=false;
    client.select=async function(options) {
      const result=await select.call(this,options);
      if(!raced && /FROM\s+"?zosd_l3_snap"?\s/i.test(options.select)) {raced=true;return {...result,rows:[]};}
      return result;
    };
    try {expect(plain(await snap()).snap_id).to.equal(existing.snap_id);} finally {client.select=select;}
    expect(raced).to.equal(true);expect(read('SELECT * FROM zosd_l3_snap')).to.have.length(1);
    expect(read('SELECT * FROM zosd_l3_snapk')).to.have.length(2);
  });
  it('an unavailable stored snapshot cannot return an invented identity',async()=>{
    const s=await snap();await exec("UPDATE zosd_l3_snap SET state='BLOCKED'");
    expect(plain(await snap()).snap_id).to.equal('');
    expect(trim((await dialogStep(()=>cls().check_snapshot({is_expected:s}))).get())).to.equal('');
    expect(read("SELECT * FROM zosd_l3_doctor WHERE doc_action='SNAP-MISMATCH'")).to.have.length(1);
  });
  it('trim differs exactly by the excluded key and hashes delimiters without collisions',async()=>{
    const full=plain(await snap()); const excluded=hash(value('S001'));
    const keys=new abap.types.Table(new abap.types.Character(64)); keys.append(new abap.types.Character(64).set(excluded));
    const trimmed=plain(await snap('ships_ref',{it_exclude:keys}));expect(trimmed.row_count).to.equal(1);
    expect(trimmed.content_hash).to.equal(hash('4:S0028:Bluebird1:A;'));
    expect(read('SELECT key_hash FROM zosd_l3_snapk WHERE snap_id=?',trimmed.snap_id).map((r)=>trim(r.key_hash)))
      .to.deep.equal(read('SELECT key_hash FROM zosd_l3_snapk WHERE snap_id=?',full.snap_id).map((r)=>trim(r.key_hash)).filter((k)=>k!==excluded));
    await seed([['S001','a:;b','A']]);expect(plain(await snap()).content_hash).to.equal(hash('4:S0014:a:;b1:A;'));
  });
  it('handshake accepts the stored identity and audits id, hash and count mismatches',async()=>{
    const s=await snap();expect(trim((await dialogStep(()=>cls().check_snapshot({is_expected:s}))).get())).to.equal('X');
    for(const [field,bad] of [['snap_id','missing'],['content_hash','bad'],['row_count',99]]) {
      const expected=s.clone();expected.get()[field].set(bad);
      expect(trim((await dialogStep(()=>cls().check_snapshot({is_expected:expected}))).get())).to.equal('');
      const rows=read("SELECT * FROM zosd_l3_doctor WHERE doc_action='SNAP-MISMATCH'");
      const last=rows.find((r)=>trim(r['expected_'+({snap_id:'id',content_hash:'hash',row_count:'count'}[field])])===bad);
      expect(last).to.exist;expect(trim(last.expected_hash)).to.equal(plain(expected).content_hash);
      expect(Number(last.expected_count)).to.equal(plain(expected).row_count);
    }
    expect(read('SELECT * FROM zosd_l3_doctor')).to.have.length(3);
  });
  it('a run and its settings retain the input identity after reference data changes, including explain',async()=>{
    const r=await dialogStep(()=>cls().run({iv_date:new abap.types.Date().set('20261003'),iv_mode:new abap.types.Character(1).set('S')}));
    const id=trim(r.get().run_id.get()); const recorded=read('SELECT * FROM zosd_l3_run_snap WHERE run_id=?',id)[0];
    expect(recorded).to.exist;expect(Number(recorded.stage_no)).to.equal(2);expect(Number(recorded.row_count)).to.equal(2);
    expect(read('SELECT * FROM zosd_l3_run_conf WHERE run_id=?',id).every((s)=>trim(s.content_hash)===trim(recorded.content_hash))).to.equal(true);
    await exec("UPDATE zosd_l2_ship SET name='Changed' WHERE ship_id='S001'");
    expect(plain(await snap()).content_hash).not.to.equal(trim(recorded.content_hash));
    await dialogStep(()=>cls().record_snapshot({iv_run:str(id),iv_name:str('ships_ref'),iv_stage:new abap.types.Integer().set(2)}));
    expect(read('SELECT * FROM zosd_l3_run_snap WHERE run_id=?',id)[0]).to.deep.equal(recorded);
    const alert=read('SELECT * FROM zosd_l3_alert WHERE run_id=?',id)[0];expect(alert).to.exist;
    const key=`fleet2/${trim(alert.rule_name)}/${trim(alert.model_hash).replace('sha256:','')}/20261003/${alert.pile_no}/${alert.alert_seq}`;
    const explained=await explainAlert(key,{sets:[SET],db:dbPath});expect(explained.text).to.include(trim(recorded.snap_id)).and.include(trim(recorded.content_hash));
  });
  it('repeated mismatches retain the caller run and existing doctor actions',async()=>{
    const s=await snap();s.get().content_hash.set('bad');
    await exec("INSERT INTO zosd_l3_doctor (mandt,run_id,seq,set_name,doc_action) VALUES ('123','CALLER',4,'fleet2','RETRY')");
    for(let i=0;i<2;i++) expect(trim((await dialogStep(()=>cls().check_snapshot({is_expected:s,iv_run:str('CALLER')}))).get())).to.equal('');
    const rows=read("SELECT * FROM zosd_l3_doctor WHERE run_id='CALLER' ORDER BY seq");
    expect(rows.map((r)=>[r.seq,trim(r.doc_action)])).to.deep.equal([[4,'RETRY'],[5,'SNAP-MISMATCH'],[6,'SNAP-MISMATCH']]);
  });
  it('dry runs skip input capture with and without settings',async()=>{
    await dialogStep(()=>cls().run({iv_date:new abap.types.Date().set('20261003'),iv_dry_run:new abap.types.Character(1).set('X')}));
    for(const table of ['zosd_l3_snap','zosd_l3_snapk','zosd_l3_run_snap','zosd_l3_run_conf']) expect(read(`SELECT * FROM ${table}`),table).to.have.length(0);
    const manifest=join(dir,'dry-no-settings.l3.yaml');
    writeFileSync(manifest,text.replace(/^      remote:.*\n/m,'').replace(/^settings:\n(  .*\n|    .*\n)+/m,'').replace(/^  profiles:\n(    .*\n)+/m,'')
      .replace(/rule: ([a-z_]+\.l2\.yaml)/g,(_,file)=>`rule: ${join(process.cwd(),'src/l2demo',file)}`));
    const withoutSettings=compileSet(manifest);
    const rendered=await renderSet(withoutSettings), original=cls();
    await loadGenerated(rendered.files,[withoutSettings.class],join(dir,'dry-no-settings'),withoutSettings);
    try {
      await dialogStep(()=>cls().run({iv_date:new abap.types.Date().set('20261004'),iv_dry_run:new abap.types.Character(1).set('X')}));
      for(const table of ['zosd_l3_snap','zosd_l3_snapk','zosd_l3_run_snap']) expect(read(`SELECT * FROM ${table}`),table).to.have.length(0);
      await dialogStep(()=>cls().run({iv_date:new abap.types.Date().set('20261005'),iv_mode:new abap.types.Character(1).set('S')}));
      expect(read('SELECT * FROM zosd_l3_run_snap')).to.have.length(1);
    } finally {abap.Classes.ZCL_L3_FLEET2=original;}
  });
  it('validates snapshot fields, sources, canonical mode and input with manifest line numbers',()=>{
    const file=join(dir,'invalid.l3.yaml');
    const absolute=text.replace(/rule: ([a-z_]+\.l2\.yaml)/g,(_,f)=>`rule: ${join(process.cwd(),'src/l2demo',f)}`);
    for(const [from,to,message] of [['key: [ship_id]','key: [missing]',/unknown.*field/],['source: ships, key','source: alerts, key',/source port/],
      ['sorted-by-key','read-order',/sorted-by-key/],['input: ships_ref','input: missing',/names no snapshot/],['key: [ship_id]','key: []',/nonempty/]]) {
      writeFileSync(file,absolute.replace(from,to));let error;try{compileSet(file);}catch(e){error=e;}
      expect(error).to.be.instanceOf(SetError);expect(error.message).to.match(message);expect(error.line).to.be.greaterThan(1);
    }
  });
  it('STRIPPED: a set without snapshots renders byte-identical',async()=>{
    const baseline=compileSet('src/l2demo/fleet.l3.yaml');const rendered=await renderSet(baseline);
    for(const [name,source] of Object.entries(rendered.files)) expect(source,name).to.equal(readFileSync(join('src/l2demo',name),'utf8'));
    const stripped=structuredClone(model);
    for(const k of ['snapshots','snapshot_inputs','snapshot_identity']) delete stripped[k];
    const service=cockpitService(stripped).doc;
    expect(service.entities).not.to.have.property('InputSnapshot');
    expect(service.entities.Snapshot.set).to.equal('SnapshotSet');
    expect(service.entities.Snapshot.properties).not.to.have.property('ContentHash');
    expect(service.entities.Doctor.properties.DocAction.type).to.equal('String(12)');
  });
  it('re-keying technical ship ids preserves content hash with a business key and explicit fields',async()=>{
    const m=structuredClone(model);m.cockpit=undefined;
    m.snapshots[0].order='name';m.snapshots[0].keys=[{name:'name',row:'ships_ref'}];m.snapshots[0].fields=[{name:'name',row:'ships_ref'},{name:'status',row:'ships_ref'}];
    const out=await renderSet(m);const original=cls();
    await loadGenerated(out.files,[m.class],join(dir,'rekey'),m);
    try {const a=plain(await snap()); await seed([['T002','Albatross','M'],['T001','Bluebird','A']]);
      expect(plain(await snap()).content_hash).to.equal(a.content_hash);
      expect(a.content_hash).to.equal(hash('9:Albatross1:M;8:Bluebird1:A;'));
    } finally {abap.Classes.ZCL_L3_FLEET2=original;}
  });
  it('a direct table snapshot and set-level input work without settings; empty input has the standard empty hash',async()=>{
    const manifest=join(dir,'table.l3.yaml');
    writeFileSync(manifest,readFileSync('src/l2demo/fleet.l3.yaml','utf8')
      .replace(/rule: ([a-z_]+\.l2\.yaml)/g,(_,f)=>`rule: ${join(process.cwd(),'src/l2demo',f)}`)
      + '\nsnapshots:\n  reference: {source: ZOSD_L2_SHIP, key: [ship_id], canonical: sorted-by-key}\ninput: reference\n');
    const m=compileSet(manifest);const out=await renderSet(m);const original=abap.Classes.ZCL_L3_FLEET;
    await loadGenerated(out.files,[m.class],join(dir,'table'),m);
    try {
      const c=abap.Classes.ZCL_L3_FLEET;
      const s=plain(await dialogStep(()=>c.snapshot({iv_name:str('reference')})));
      expect(s.content_hash).to.equal(hash('4:S0019:Albatross1:M;4:S0028:Bluebird1:A;'));
      const r=await dialogStep(()=>c.run({iv_date:new abap.types.Date().set('20261003'),iv_mode:new abap.types.Character(1).set('S')}));
      expect(read('SELECT * FROM zosd_l3_run_snap WHERE run_id=?',trim(r.get().run_id.get()))[0]).to.include({stage_no:0, snap_id:s.snap_id});
      await seed([]);
      const empty=plain(await dialogStep(()=>c.snapshot({iv_name:str('reference')})));
      expect(empty.row_count).to.equal(0);expect(empty.content_hash).to.equal(hash(''));
    } finally {abap.Classes.ZCL_L3_FLEET=original;}
  });
  it('a lost mismatch audit is never silent: the caller is told and an event row names the run',async()=>{
    const name=`${model.class}.clas.abap`, from='WHERE run_id = ls_audit-run_id.\n    DO 10 TIMES.\n      ls_audit-seq = ls_audit-seq + 1.';
    expect(files[name]).to.include(from);
    const original=cls();
    // a copy whose audit key never moves: every one of the ten inserts collides
    await loadGenerated({...files,[name]:files[name].replace(from,'WHERE run_id = ls_audit-run_id.\n    DO 10 TIMES.\n      ls_audit-seq = 1.')},[model.class],join(dir,'audit-lost'),model);
    try {
      await exec("INSERT INTO zosd_l3_doctor (mandt,run_id,seq,set_name,doc_action) VALUES ('','LOSTRUN',1,'fleet2','OTHER')");
      const s=await snap();s.get().row_count.set(99);
      const lost=new abap.types.Character(1);
      const ok=await dialogStep(()=>cls().check_snapshot({is_expected:s,iv_run:str('LOSTRUN'),ev_audit_lost:lost}));
      expect(trim(ok.get())).to.equal('');
      expect(trim(lost.get())).to.equal('X');
      const events=read("SELECT kind,reason FROM zosd_l3_event WHERE run_id='LOSTRUN'");
      expect(events).to.have.length(1);
      expect(trim(events[0].kind)).to.equal('SNAPAUDLOST');expect(events[0].reason).to.match(/audit lost/);
    } finally {abap.Classes.ZCL_L3_FLEET2=original;}
    // an ordinary audit still lands and is not flagged
    const s=await snap();s.get().row_count.set(99);const flag=new abap.types.Character(1);
    await dialogStep(()=>cls().check_snapshot({is_expected:s,iv_run:str('FINE'),ev_audit_lost:flag}));
    expect(trim(flag.get())).to.equal('');expect(read("SELECT * FROM zosd_l3_doctor WHERE run_id='FINE'")).to.have.length(1);
  });
  it('the cleanup list discovers every snapshot table',()=>{
    expect(l3TableNames()).to.include.members(['zosd_l3_snap','zosd_l3_snapk','zosd_l3_run_snap','zosd_l3_doctor','zosd_l3_event']);
  });
  it('copy mutants: sort, fields, reuse, run record, explain, handshake, audit and trim each kill their oracle',async()=>{
    const edits=[['sort','SORT lt_ships_ref BY ship_id.','" removed',async()=>plain(await snap()).content_hash,hash('4:S0019:Albatross1:M;4:S0028:Bluebird1:A;')],
      ['reuse',"IF sy-subrc = 0.\n      RETURN.\n    ENDIF.\n    rs_snap-set_name", "IF sy-subrc = 0.\n      CLEAR rs_snap-snap_id.\n      RETURN.\n    ENDIF.\n    rs_snap-set_name",async()=>{const a=plain(await snap());return plain(await snap()).snap_id===a.snap_id;},true],
      ['handshake','AND ls_stored-row_count = is_expected-row_count.','AND abap_true = abap_true.',async()=>{const s=await snap();s.get().row_count.set(99);return trim((await dialogStep(()=>cls().check_snapshot({is_expected:s}))).get());},''],
      ['audit','INSERT zosd_l3_doctor FROM ls_audit.','RETURN.',async()=>{const s=await snap();s.get().row_count.set(99);await dialogStep(()=>cls().check_snapshot({is_expected:s}));return read('SELECT * FROM zosd_l3_doctor').length;},1],
      ['audit-run','ls_audit-run_id = iv_run.\n    IF ls_audit-run_id IS INITIAL.','CLEAR ls_audit-run_id.\n    IF ls_audit-run_id IS INITIAL.',async()=>{
        const s=await snap();s.get().row_count.set(99);await dialogStep(()=>cls().check_snapshot({is_expected:s,iv_run:str('CALLER')}));
        return trim(read('SELECT * FROM zosd_l3_doctor')[0].run_id);
      },'CALLER'],
      ['dry-capture','IF lv_dry = abap_false.\n          record_snapshot','IF abap_true = abap_true.\n          record_snapshot',async()=>{
        await dialogStep(()=>cls().run({iv_date:new abap.types.Date().set('20261006'),iv_dry_run:new abap.types.Character(1).set('X')}));
        return read('SELECT * FROM zosd_l3_run_snap').length;
      },0],
      ['record','INSERT zosd_l3_run_snap FROM ls_input.','RETURN.',async()=>{await dialogStep(()=>cls().record_snapshot({iv_run:str('RUN'),iv_name:str('ships_ref'),iv_stage:new abap.types.Integer().set(2)}));return read('SELECT * FROM zosd_l3_run_snap').length;},1],
      ['stale', 'IF sy-subrc = 0.\n      RETURN.\n    ENDIF.\n    ls_snap = snapshot', 'IF sy-subrc = 0.\n      DELETE FROM zosd_l3_run_snap WHERE run_id = iv_run AND stage_no = iv_stage.\n    ENDIF.\n    ls_snap = snapshot', async()=>{
        const args={iv_run:str('STALE'),iv_name:str('ships_ref'),iv_stage:new abap.types.Integer().set(2)};
        await dialogStep(()=>cls().record_snapshot(args));const before=trim(read("SELECT content_hash FROM zosd_l3_run_snap WHERE run_id='STALE'")[0].content_hash);
        await exec("UPDATE zosd_l2_ship SET status='A'");await dialogStep(()=>cls().record_snapshot(args));
        return trim(read("SELECT content_hash FROM zosd_l3_run_snap WHERE run_id='STALE'")[0].content_hash)===before;
      },true],
      ['fields','lv_text = lv_text && \';\'.','lv_text = lv_text && \':\'.',async()=>plain(await snap()).content_hash,hash('4:S0019:Albatross1:M;4:S0028:Bluebird1:A;')],
      ['trim','READ TABLE it_exclude WITH KEY table_line = lv_keyhash TRANSPORTING NO FIELDS.','READ TABLE lt_keys WITH KEY table_line = lv_keyhash TRANSPORTING NO FIELDS.',async()=>{const t=new abap.types.Table(new abap.types.Character(64));t.append(new abap.types.Character(64).set(hash(value('S001'))));return plain(await snap('ships_ref',{it_exclude:t})).row_count;},1]];
    const original=cls();
    for(const [name,from,to,oracle,expected] of edits) {
      await exec(...tables.map((t)=>`DELETE FROM ${t}`));await seed();
      const copy={...files};expect(copy[`${model.class}.clas.abap`],name).to.include(from);
      copy[`${model.class}.clas.abap`]=copy[`${model.class}.clas.abap`].replaceAll(from,to);
      await loadGenerated(copy,[model.class],join(dir,`mutant-${name}`),model);
      try {expect(await oracle(),`mutant ${name} must violate oracle`).not.to.equal(expected);} finally {abap.Classes.ZCL_L3_FLEET2=original;}
    }
    // Mutate the explain implementation by copy; its original imports stay absolute.
    const rule=model.rules.find((r)=>!r.filter); const k=`fleet2/${rule.name}/${rule.hash.replace('sha256:','')}/20261003/1/1`;
    const row={run_id:'RUN',alert_text:'test',snapshots:[{snap_name:'ships_ref',snap_id:'SNAP',content_hash:'HASH',row_count:2,stage_no:2}]};
    const good=await explainAlert(k,{sets:[SET],row});expect(good.text).to.include('snapshot ships_ref: id SNAP');
    const explainFile=join(dir,'explain-mutant.mjs');
    const compiler=readFileSync('tools/dsl-l3.mjs','utf8').replaceAll('...(alertRowFound?.snapshots ?? []).map', '...([]).map')
      .replace('from "js-yaml"', `from "${import.meta.resolve('js-yaml')}"`)
      .replace('createRequire(import.meta.url)', `createRequire("${pathToFileURL(join(process.cwd(),'tools/dsl-l3.mjs')).href}")`)
      .replace(/from "(\.\/[^"\n]+)"/g,(_,f)=>`from "${pathToFileURL(join(process.cwd(),'tools',f)).href}"`);
    writeFileSync(explainFile,compiler);
    const altered=await import(pathToFileURL(explainFile).href);
    expect((await altered.explainAlert(k,{sets:[SET],row})).text).not.to.include('snapshot ships_ref: id SNAP');
    const helperFile=join(dir,'validation-mutant.mjs');
    const helper=readFileSync('tools/dsl-l3-snapshot.mjs','utf8');
    writeFileSync(helperFile,helper.replace("if (spec.canonical !== 'sorted-by-key')", "if (false)"));
    const helperUrl=pathToFileURL(join(process.cwd(),'tools/dsl-l3-snapshot.mjs')).href;
    const validationFile=join(dir,'compiler-validation-mutant.mjs');
    writeFileSync(validationFile,compiler.replace(helperUrl,pathToFileURL(helperFile).href));
    const invalid=join(dir,'canonical.l3.yaml');
    writeFileSync(invalid,text.replace('sorted-by-key','read-order').replace(/rule: ([a-z_]+\.l2\.yaml)/g,(_,f)=>`rule: ${join(process.cwd(),'src/l2demo',f)}`));
    expect(()=>compileSet(invalid)).to.throw(SetError);
    const awaitCompiler=await import(pathToFileURL(validationFile).href);
    expect(()=>awaitCompiler.compileSet(invalid)).not.to.throw();
    const strippedHelper=join(dir,'stripped-helper-mutant.mjs');
    writeFileSync(strippedHelper,helper.replace('  if (!model.snapshots) return text;',''));
    const strippedFile=join(dir,'compiler-stripped-mutant.mjs');
    writeFileSync(strippedFile,compiler.replace(helperUrl,pathToFileURL(strippedHelper).href)
      .replace('if (model.snapshots && template === SET_TEMPLATE)', 'if (template === SET_TEMPLATE)')
      .replace(/import\("(\.\/[^"]+)"\)/g,(_,f)=>`import("${pathToFileURL(join(process.cwd(),'tools',f)).href}")`));
    const mutated=await import(pathToFileURL(strippedFile).href);
    const baseline=compileSet('src/l2demo/fleet.l3.yaml');
    expect((await mutated.renderSet(baseline)).files['zcl_l3_fleet.clas.abap']).not.to.equal(readFileSync('src/l2demo/zcl_l3_fleet.clas.abap','utf8'));

  });
});
