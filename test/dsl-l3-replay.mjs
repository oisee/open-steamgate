import {expect} from 'chai';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
import {compileSet,renderSet} from '../tools/dsl-l3.mjs';
import {profileRun,observations} from '../tools/dsl-l3-profile.mjs';
import {configOf,draw,sinkSafety} from '../tools/dsl-l3-sim.mjs';
import {loadGenerated} from '../tools/dsl-l3-load.mjs';
import {driveClock,replayJobs,whatif} from '../tools/dsl-l3-whatif.mjs';
import {manualClock,installAbapClock} from '../tools/osd-job-scheduler.mjs';
import {dialogStep} from '../tools/osd-dialog-step.mjs';
import {BatchRuns} from '../tools/osd-batch-runs.mjs';

const SET = 'src/l2demo/fleet2.l3.yaml';
const model = compileSet(SET);
const str = (s) => new globalThis.abap.types.String().set(String(s));
describe('DSL L3 replay: a twin of one night', function () {
  this.timeout(900000);
  let scratch,sourceProfile,dbPath,abap,client,store,restoreClock,priorContext,priorClasses,priorEnv;
  const manifest = (doc,name) => {
    for (const stage of doc.stages) for (const r of stage.rules) if (!r.rule.startsWith('/')) r.rule = resolve(dirname(SET),r.rule);
    const file = join(scratch,`${name}.l3.yaml`);
    writeFileSync(file,yaml.dump(doc,{noRefs:true}));
    return file;
  };
  const doc = () => yaml.load(readFileSync(SET,'utf8'),{schema:yaml.FAILSAFE_SCHEMA});
  before(async () => {
    scratch = mkdtempSync(join(tmpdir(),'dsl-l3-replay-test-'));
    await import('./start.mjs');
    abap = globalThis.abap;
    priorContext = {...abap.context,databaseConnections:{...abap.context.databaseConnections}};
    priorClasses = {...abap.Classes};
    priorEnv = {...process.env};
    dbPath = join(scratch,'night.sqlite');
    process.env.STG_DB = 'file'; process.env.STG_DB_PATH = dbPath;
    process.env.OSD_OPERATIONS_DB = join(scratch,'operations.sqlite');
    const {initializeABAP} = await import('../output/init.mjs');
    await initializeABAP();
    client = abap.context.databaseConnections.DEFAULT;
    const native = client.db;
    await client.execute([...['run','pile','stage','work','doctor','alert','event','budget','object','conf','conf_log','run_conf','kill'].map((s) => `DELETE FROM zosd_l3_${s}`),'DELETE FROM zosd_l2_ship']);
    const insert = native.prepare("INSERT INTO zosd_l2_ship (mandt,ship_id,name,status) VALUES ('123', ?, 'Replay ship', 'A')");
    for (let i = 0; i < 48; i++) insert.run(`R${String(i).padStart(3,'0')}`);
    const variant = doc();
    variant.simulate = {seed:'42',time_scale:'1',allow_sink:['log'],default:{duration:{dist:'uniform',min:'10',max:'30'},outcome:{ok:'0.88',slow:'0.04',dump:'0.06',hang:'0.02'},slow_factor:'3',hits:{dist:'fixed',value:'1'},autoclose:'0.4'},stages:{candidates:{duration:{dist:'fixed',value:'5'},outcome:{ok:'1'},keep:'1'}}};
    variant.simulate.profiles = doc().simulate.profiles; // the committed set's chaos profiles: its settings class keeps its shape
    const simModel = compileSet(manifest(variant,'night'));
    const {files} = await renderSet(simModel);
    await loadGenerated(files,[model.simulate.work_class],join(scratch,'sim-modules'),simModel);
    const conf = abap.Classes[model.settings.class.toUpperCase()];
    for (const [name,value] of [['budget.glass','100000'],['simulate.time_scale','1000000'],['retry.backoff','0']]) {
      expect((await dialogStep(() => conf.set_setting({iv_param:str(name),iv_value:str(value),iv_note:str('replay proof')}))).get()).to.equal('X');
    }
    const clock = manualClock(Date.parse('2099-10-01T22:00:00Z'));
    restoreClock = installAbapClock(abap,clock);
    store = new BatchRuns(process.cwd(),process.env);
    const night = await replayJobs(simModel,clock,store,{bind:'work=sim,close=sim'});
    expect(night.glass).to.equal(false);
    sourceProfile = profileRun(simModel,{run:night.run,db:dbPath});
    restoreClock(); restoreClock = undefined; store.close(); store = undefined;
    Object.assign(abap.Classes,priorClasses);
  });
  after(async () => {
    restoreClock?.(); store?.close(); await client?.disconnect();
    if (abap) { Object.assign(abap.context,priorContext); for (const k of Object.keys(abap.Classes)) if (!(k in priorClasses)) delete abap.Classes[k]; Object.assign(abap.Classes,priorClasses); }
    for (const k of Object.keys(process.env)) if (!(k in priorEnv)) delete process.env[k];
    Object.assign(process.env,priorEnv);
    if (scratch) rmSync(scratch,{recursive:true,force:true});
  });
  const empirical = () => { const d = doc(); d.simulate.profile = sourceProfile; return compileSet(manifest(d,'profile')); };

  it('the replay clock advances waits, without letting watcher ticks race ordinary async work', async () => {
    const clock = manualClock(0), ticks = [];
    const tick = () => { ticks.push(clock.now()); clock.setTimer(tick,10); };
    clock.setTimer(tick,10);
    await driveClock(clock, async () => {
      await new Promise((r) => setTimeout(r,30));
      expect(clock.now(), 'SQL work does not advance simulated time').to.equal(0);
      await new Promise((r) => clock.setTimer(r,25,{wait:true}));
    });
    expect(clock.now()).to.equal(25);
    expect(ticks).to.deep.equal([10,20]);
  });
  it('profiles a 5d sim night deterministically, retaining retries, exact attempt rows and settings', () => {
    const p = profileRun(model,{run:sourceProfile.run,db:dbPath});
    expect(p).to.deep.equal(sourceProfile);
    expect(p.samples.length).to.be.greaterThan(p.source.piles.length);
    expect(p.samples.some((s) => s.outcome === 'dump')).to.equal(true);
    expect(p.samples.some((s) => s.outcome === 'hang')).to.equal(true);
    expect(p.samples.every((s) => !s.censored)).to.equal(true);
    expect(p.source.doctor.filter((r) => r.doc_action === 'WORK').every((r) => r.check_date === '20991001' && r.stage_no > 0)).to.equal(true);
    expect(p.settings['budget.glass']).to.equal('100000');
    expect(Object.keys(p.stages)).to.deep.equal(['candidates','checks']);
    const cli = spawnSync('node',['tools/dsl-l3.mjs','profile',SET,'--run',p.run,'--db',dbPath],{encoding:'utf8',maxBuffer:20*1024*1024});
    expect(cli.status,cli.stderr).to.equal(0);
    expect(JSON.parse(cli.stdout)).to.deep.equal(p);
  });
  function distributionProblems(m) {
    const problems = [];
    for (const node of m.replay.rules) {
      const d = sourceProfile.rules[node.rule], config = configOf(node);
      const samples = Array.from({length:10000},(_,pile) => draw(config,{run:'same-night',rule:node.rule,pile,attempt:1,seed:42,scale:1000000,stale:900}));
      for (const o of ['ok','slow','dump','hang']) {
        const frequency = samples.filter((s) => s.outcome.toLowerCase() === o).length/samples.length;
        if (Math.abs(frequency-d.outcome[o]/1000000) > 0.025) problems.push(`${node.rule}: ${o} frequency`);
      }
      const observed = sourceProfile.samples.filter((s) => s.rule === node.rule);
      // A 15-knot table interpolates through at most a 10% quantile gap.
      // Check CDF distance (plus 2.5 points for the finite draw sample), so
      // one rare long hang cannot make a sound empirical table fail on mean.
      for (const value of new Set(observed.flatMap((s) => [s.duration-1,s.duration]))) {
        const measured = observed.filter((s) => s.duration <= value).length/observed.length;
        const replayed = samples.filter((s) => s.duration <= value).length/samples.length;
        if (Math.abs(replayed-measured) > 0.125) problems.push(`${node.rule}: duration CDF at ${value}`);
      }
      const hits = observed.reduce((n,s) => n+s.hits,0)/observed.length;
      if (Math.abs(samples.reduce((n,s) => n+s.hits,0)/samples.length-hits) > 0.15) problems.push(`${node.rule}: hits mean`);
    }
    return problems;
  }
  it('renders separate sim and replay constants, records the replay recipe, and retains the legacy real-binding fallback', async () => {
    const m = empirical(), {files} = await renderSet(m);
    expect(m.simulate.rules.find((r) => r.rule === 'ship-cargo-limit').slow_factor.value).to.equal('5');
    expect(m.replay.rules.find((r) => r.rule === 'ship-cargo-limit').slow_factor.value).to.equal('1');
    expect(files[`${m.replay.work_class}.clas.abap`]).to.include('rv_text = |RPL ');
    expect(files[`${m.class}.clas.abap`]).to.include("CONCATENATE 'rpl256:'").and.include('rv_bind = `work=real`.');
    expect(JSON.parse(files[`${m.class}.clas.trace.json`]).replay_overlay).to.deep.equal(['recipes/l3-replay/overlay.json']);
    expect(JSON.parse(files[`${m.ports_class}.clas.trace.json`]).replay_overlay).to.deep.equal(['recipes/l3-replay/overlay.json']);
  });
  it('the profile reproduces measured outcome frequencies within 2.5 percentage points, duration CDF within 12.5 points, hits within 0.15', () => {
    expect(distributionProblems(empirical())).to.deep.equal([]);
  });
  it('loads a relative profile with no simulated distributions and uses a measured stage for an unobserved rule', () => {
    const p = structuredClone(sourceProfile), d = doc();
    delete p.rules['ship-cargo-limit'];
    writeFileSync(join(scratch,'knots.json'),JSON.stringify(p));
    d.simulate = {profile:'knots.json',allow_sink:['log'],profiles:d.simulate.profiles};
    const m = compileSet(manifest(d,'relative'));
    expect(configOf(m.replay.rules.find((r) => r.rule === 'ship-cargo-limit')).knots).to.equal(p.stages.checks.duration.join(' '));
    p.set = 'other'; d.simulate.profile = p;
    expect(() => compileSet(manifest(d,'wrong-set'))).to.throw(/profile of this set/);
    p.set = sourceProfile.set; p.stages.checks.duration[1] = -1;
    expect(() => compileSet(manifest(d,'invalid-knots'))).to.throw(/ordered integer knots/);
  });
  it('generated ABAP replay draws equal the JavaScript twin across rules, seeds, scales and retries', async () => {
    const m = empirical(), {files} = await renderSet(m);
    const name = m.replay.work_class.toUpperCase(), old = abap.Classes[name];
    await loadGenerated(files,[m.replay.work_class],join(scratch,'draw-modules'),m);
    try {
      for (const node of m.replay.rules) for (const attempt of [1,2,3]) for (const seed of [1,42,2147483646]) for (const scale of [0,333333,1000000]) {
        const input = {run:'0123456789ABCDEF0123456789ABCDEF',rule:node.rule,pile:7,attempt,seed,scale,stale:900};
        const pile = new abap.types.Structure({run_id:new abap.types.Character(32),rule:new abap.types.Character(60),pile_no:new abap.types.Integer(),attempt:new abap.types.Integer(),seed:new abap.types.Integer(),scale:new abap.types.Integer(),stale:new abap.types.Integer()});
        for (const [k,v] of Object.entries(input)) pile.get()[{run:'run_id',pile:'pile_no'}[k] ?? k].set(v);
        const keys = ['R001','R002'], table = new abap.types.Table(new abap.types.String());
        for (const key of keys) table.append(str(key));
        const filter = node.rule === 'ship-busy';
        const got = (await abap.Classes[name].draw({is_pile:pile,it_keys:table,iv_filter:new abap.types.Character(1).set(filter ? 'X' : '')})).get();
        expect({outcome:got.outcome.get().trim(),duration:got.duration.get(),wait:got.wait.get(),hits:got.hits.get(),keys:got.keys.array().map((k) => k.get())}).to.deep.equal(draw(configOf(node),input,keys,{filter}));
      }
    } finally { if (old) abap.Classes[name] = old; else delete abap.Classes[name]; }
  });
  it('mutant: drawing sim distributions instead of the empirical profile is detected', () => {
    const m = empirical();
    m.replay.rules = m.simulate.rules;
    expect(distributionProblems(m).length).to.be.greaterThan(0);
  });
  it('mutant: a profiler ignoring doctor retries loses the earlier outcomes', async () => {
    const text = readFileSync('tools/dsl-l3-profile.mjs','utf8');
    const from = "source.doctor.filter((r) => r.rule_name === p.rule_name && r.pile_no === p.pile_no)";
    expect(text).to.include(from);
    const mutant = text.replace(from,'[]').replace('Math.max(retries.length, Math.max(0, p.attempt - 1 - stalePlans))','0')
      .replace("'./dsl-l3-sim.mjs'", JSON.stringify(pathToFileURL(resolve('tools/dsl-l3-sim.mjs')).href));
    const file = join(scratch,'profile-mutant.mjs'); writeFileSync(file,mutant);
    const {observations: broken} = await import(pathToFileURL(file).href);
    const got = broken(sourceProfile.source);
    expect(got.length).to.be.lessThan(sourceProfile.samples.length);
    expect(got.filter((s) => s.outcome === 'dump').length).to.be.lessThan(sourceProfile.samples.filter((s) => s.outcome === 'dump').length);
  });
  it('old retries are retained as censored observations without inventing their durations', () => {
    const pile = {...sourceProfile.source.piles.find((p) => p.attempt > 1),status:'DONE',attempt:2};
    const samples = observations({piles:[pile],doctor:[{rule_name:pile.rule_name,pile_no:pile.pile_no,doc_action:'RESUBMIT',reason:'RETRY'}]});
    expect(samples).to.have.length(2);
    expect(samples[0]).to.include({outcome:'dump',duration:null,censored:true});
  });
  it('a stale plan resubmitted before it did any work is not an inferred failed attempt', () => {
    const pile = {...sourceProfile.source.piles[0],status:'DONE',attempt:2};
    const samples = observations({piles:[pile],doctor:[{rule_name:pile.rule_name,pile_no:pile.pile_no,doc_action:'RESUBMIT',reason:'STALE-PLAN'}]});
    expect(samples).to.have.length(1);
    expect(samples[0].outcome).to.equal('ok');
  });
  it('an unfinished pile contributes earlier failed attempts without inventing an unfinished outcome', () => {
    const pile = {...sourceProfile.source.piles[0],status:'PLANNED',attempt:2};
    const samples = observations({piles:[pile],doctor:[{rule_name:pile.rule_name,pile_no:pile.pile_no,doc_action:'RESUBMIT',reason:'RETRY'}]});
    expect(samples).to.have.length(1);
    expect(samples[0]).to.include({outcome:'dump',duration:null,censored:true});
    expect(observations({piles:[{...pile,attempt:1}],doctor:[]})).to.deep.equal([]);
  });
  it('the compiler refuses replay on a production sink without allow_sink', () => {
    const d = doc(); d.simulate.profile = sourceProfile; d.simulate.allow_sink = []; d.bindings.work = 'replay';
    expect(() => compileSet(manifest(d,'unsafe'))).to.throw(/production variant/);
  });
  async function refusalProblems(mutant = false) {
    const d = doc(); d.simulate.profile = sourceProfile; d.simulate.allow_sink = [];
    const m = compileSet(manifest(d,'guarded'));
    const {files} = await renderSet(m);
    const factory = `${m.ports_class}.clas.abap`;
    if (mutant) {
      const from = "IF lv_sink = 'log'.";
      expect(files[factory]).to.include(from);
      files[factory] = files[factory].replace(from,"IF lv_sink = 'disabled'.");
    }
    const old = abap.Classes[m.ports_class.toUpperCase()];
    await loadGenerated(files,[m.ports_class],join(scratch,mutant ? 'unguarded' : 'guarded'),m);
    try {
      const reasons = [];
      for (const bind of ['work=replay','close=replay']) {
        let reason;
        try { await abap.Classes[m.ports_class.toUpperCase()].check({iv_bind:str(bind)}); }
        catch (e) { reason = e.reason?.get?.() ?? e.message; }
        reasons.push(reason ?? 'allowed');
      }
      return reasons;
    } finally { abap.Classes[m.ports_class.toUpperCase()] = old; }
  }
  it('the runtime factory refuses replay on an unallowed sink and chance autoclose without synthetic work', async () => {
    const reasons = await refusalProblems();
    expect(reasons[0]).to.match(/production sink/);
    expect(reasons[1]).to.match(/only beside work=sim/);
    expect(sinkSafety({bindings:{work:'replay',alerts:'log'},sink:{name:'alerts',variants:[{name:'log',is_log:true}]},allow:[]})).to.equal('log');
  });
  it('mutant: removing runtime replay sink safety allows the refused binding', async () => {
    expect((await refusalProblems(true))[0]).to.equal('allowed');
  });
  it('two actual replays with identical settings are deterministic, and lowered glass triggers the real governor', async () => {
    const profile = join(scratch,'profile.json'); writeFileSync(profile,JSON.stringify(sourceProfile));
    const same = await whatif(SET,{db:dbPath,profile,settings:{}});
    expect(same.baseline).to.deep.equal(same.variant);
    expect(same.baseline.glass).to.equal(false);
    const cli = spawnSync('node',['tools/dsl-l3.mjs','whatif',SET,'--db',dbPath,'--profile',profile,'--setting','budget.glass=1'],{encoding:'utf8',maxBuffer:20*1024*1024,timeout:180000});
    expect(cli.status,cli.stderr).to.equal(0);
    const changed = JSON.parse(cli.stdout);
    expect(changed.baseline).to.deep.equal(same.baseline);
    expect(changed.variant.glass).to.equal(true);
    expect(changed.difference.glass).to.equal('false -> true');
    expect(profileRun(model,{run:sourceProfile.run,db:dbPath})).to.deep.equal(sourceProfile);
  });
});
