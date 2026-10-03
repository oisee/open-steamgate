// Run both experiments through the generated ABAP orchestration, the durable
// jobs facade and a manual clock, on disposable copies of the source SQLite DB.
import {DatabaseSync, backup} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import yaml from 'js-yaml';
import {compileSet,renderSet} from './dsl-l3.mjs';
import {profileRun,stampSeconds} from './dsl-l3-profile.mjs';
import {loadGenerated} from './dsl-l3-load.mjs';
import {daemonHost} from './osd-daemon-host.mjs';
import {dialogStep} from './osd-dialog-step.mjs';
import {manualClock,installAbapClock} from './osd-job-scheduler.mjs';
import {BatchRuns,workQueuedBatch} from './osd-batch-runs.mjs';
import {drainJobOutbox} from './osd-job-outbox.mjs';

export async function driveClock(clock, work) {
  let done = false;
  const result = Promise.resolve().then(work).finally(() => { done = true; });
  // Attach a handler immediately, so a work failure cannot become unhandled
  // while the timer pump is moving its clock.
  result.catch(() => {});
  let seen;
  while (!done) {
    await new Promise((r) => setTimeout(r,1));
    // A watcher tick is not a reason to move time while the job is doing SQL.
    const next = clock.pending({waitOnly:true})[0];
    if (next === undefined || done) { seen = undefined; continue; }
    if (next !== seen) { seen = next; continue; }
    seen = undefined;
    await clock.advance(Math.max(0,next-clock.now()));
  }
  return result;
}
export async function replayJobs(model, clock, store, {bind = 'work=replay,close=replay', date = '20991001', runPrefix = '0A1647A0', passes = 500} = {}) {
  const abap = globalThis.abap, runner = abap.Classes[model.class.toUpperCase()];
  const str = (s) => new abap.types.String().set(s);
  const uuid = abap.Classes.CL_SYSTEM_UUID, was = uuid.CRYPTO;
  let n = 0, result;
  uuid.CRYPTO = {randomUUID: () => `${runPrefix}-0000-4000-8000-${String(++n).padStart(12,'0')}`};
  try { result = await dialogStep(() => runner.run({iv_date:new abap.types.Date().set(date), iv_mode:new abap.types.Character(1).set('P'), iv_bind:str(bind)})); }
  finally { uuid.CRYPTO = was; }
  const run = result.get().run_id.get().trim();
  if (result.get().status.get().trim() !== 'SUBMITTED') throw new Error(`replay start: ${result.get().status.get()}`);
  const db = abap.context.databaseConnections.DEFAULT.db;
  for (let pass = 0; pass < passes; pass++) {
    await daemonHost(abap)?.idle();
    await drainJobOutbox(store);
    for (;;) {
      const job = await driveClock(clock,() => workQueuedBatch(process.cwd(),store));
      await daemonHost(abap)?.idle();
      if (!['completed','failed','step','running'].includes(job.kind)) {
        if ((await drainJobOutbox(store)).imported) continue;
        break;
      }
    }
    const lock = db.prepare('SELECT status FROM zosd_l3_run WHERE run_id = ?').get(run);
    const glass = db.prepare("SELECT COUNT(*) AS n FROM zosd_l3_event WHERE run_id = ? AND kind = 'GLASS'").get(run).n > 0;
    if (lock?.status === 'RELEASED' || glass) return {run, end_time:new Date(clock.now()).toISOString(),
      piles_failed:db.prepare("SELECT COUNT(*) AS n FROM zosd_l3_pile WHERE run_id = ? AND status = 'FAILED'").get(run).n,
      alerts_open:db.prepare("SELECT COUNT(*) AS n FROM zosd_l3_alert WHERE run_id = ? AND closed <> 'X'").get(run).n, glass};
    const backoff = +(db.prepare("SELECT param_val FROM zosd_l3_conf WHERE set_name = ? AND param_name = 'retry.backoff'").get(model.set)?.param_val ?? model.resilience.retry.backoff);
    const due = db.prepare("SELECT attempt, ended FROM zosd_l3_pile WHERE run_id = ? AND status = 'FAILED'").all(run)
      .map((p) => ((stampSeconds(p.ended) ?? clock.now()/1000)+Math.min(604800,backoff*2**Math.max(0,p.attempt-1)))*1000)
      .filter((t) => t > clock.now());
    clock.set(Math.max(clock.now()+60000,due.length ? Math.min(...due) : clock.now()));
    await dialogStep(() => runner.doctor({}));
  }
  throw new Error(`replay ${run} did not settle within ${passes} doctor passes`);
}

export async function whatif(file,{run,db,profile:profileFile,settings = {}}) {
  const original = compileSet(file);
  const profile = profileFile ? JSON.parse(readFileSync(profileFile,'utf8')) : profileRun(original,{run,db});
  const scratch = mkdtempSync(join(tmpdir(),'dsl-l3-whatif-'));
  const beforeEnv = {...process.env}, priorAbap = globalThis.abap;
  const priorClasses = priorAbap ? {...priorAbap.Classes} : undefined;
  const priorContext = priorAbap ? {...priorAbap.context, databaseConnections:{...priorAbap.context.databaseConnections}} : undefined;
  let client, restoreClock, store;
  try {
    const doc = yaml.load(readFileSync(file,'utf8'),{schema:yaml.FAILSAFE_SCHEMA});
    for (const stage of doc.stages) for (const r of stage.rules) r.rule = resolve(dirname(file),r.rule);
    doc.simulate ??= {};
    doc.simulate.profile = profile;
    doc.simulate.time_scale = '1';
    const manifest = join(scratch,'replay.l3.yaml');
    writeFileSync(manifest,yaml.dump(doc,{noRefs:true}));
    const model = compileSet(manifest);
    if (!model.settings) throw new Error('whatif needs tunable settings');
    for (const name of Object.keys(settings)) if (!model.settings.entries.some((e) => e.name === name)) throw new Error(`whatif setting ${name} is not tunable`);
    // Snapshot once, including WAL, so both experiments read the same input.
    const source = new DatabaseSync(db,{readOnly:true});
    try { await backup(source,join(scratch,'source.sqlite')); } finally { source.close(); }
    const {initializeABAP} = await import('../output/init.mjs');
    const {files} = await renderSet(model);
    const names = [model.replay.work_class, ...model.ports.filter((p) => p.is_autoclose).flatMap((p) => p.variants.filter((v) => v.is_replay).map((v) => v.class)),model.ports_class,model.class];
    const results = [];
    for (let i = 0; i < 2; i++) {
      const sourceCopy = new DatabaseSync(join(scratch,'source.sqlite'),{readOnly:true});
      try { await backup(sourceCopy,join(scratch,`business${i}.sqlite`)); } finally { sourceCopy.close(); }
      process.env.STG_DB = 'file'; process.env.STG_DB_PATH = join(scratch,`business${i}.sqlite`);
      process.env.OSD_OPERATIONS_DB = join(scratch,`operations${i}.sqlite`);
      await initializeABAP();
      const abap = globalThis.abap;
      client = abap.context.databaseConnections.DEFAULT;
      if (i === 0) await loadGenerated(files,names,join(scratch,'modules'),model);
      const conf = abap.Classes[model.settings.class.toUpperCase()];
      const str = (s) => new abap.types.String().set(String(s));
      // Experiments have their own plans and job intents, no source-night lock.
      await client.execute([...['job_outbox','job_step','job_identity', 'l3_run','l3_pile','l3_stage','l3_work','l3_doctor','l3_alert','l3_event','l3_budget','l3_object','l3_conf','l3_conf_log','l3_run_conf','l3_kill'].map((s) => `DELETE FROM zosd_${s}`)]);
      for (const [name,value] of Object.entries({...profile.settings,...(model.settings.simulate_time_scale ? {"simulate.time_scale":"1000000"} : {}),...(i ? settings : {})})) {
        if (!model.settings.entries.some((e) => e.name === name)) continue;
        const accepted = await dialogStep(() => conf.set_setting({iv_param:str(name),iv_value:str(value),iv_note:str('replay what-if')}));
        if (accepted.get() !== 'X') throw new Error(`whatif refused ${name}=${value}`);
      }
      const opened = stampSeconds(profile.source?.stages?.find((s) => +s.stage_no === 1)?.opened);
      const clock = manualClock(opened === undefined ? Date.parse('2099-10-01T22:00:00Z') : opened*1000);
      restoreClock = installAbapClock(abap,clock);
      store = new BatchRuns(process.cwd(),process.env);
      const close = model.ports.find((p) => p.is_autoclose);
      const bind = `work=replay${close?.variants.some((v) => v.is_replay) ? `,${close.name}=replay` : ''}`;
      results.push(await replayJobs(model,clock,store,{bind, date:profile.source?.piles?.[0]?.check_date ?? '20991001'}));
      await daemonHost(abap)?.close();
      restoreClock(); restoreClock = undefined;
      store.close(); store = undefined;
      await client.disconnect(); client = undefined;
    }
    const [baseline,variant] = results;
    return {baseline,variant,settings,difference:{end_seconds:(Date.parse(variant.end_time)-Date.parse(baseline.end_time))/1000,
      piles_failed:variant.piles_failed-baseline.piles_failed, alerts_open:variant.alerts_open-baseline.alerts_open,
      glass:`${baseline.glass} -> ${variant.glass}`}};
  } finally {
    await daemonHost(globalThis.abap)?.close();
    restoreClock?.(); store?.close(); await client?.disconnect();
    for (const key of Object.keys(process.env)) if (!(key in beforeEnv)) delete process.env[key];
    Object.assign(process.env,beforeEnv);
    if (priorAbap) { Object.assign(priorAbap.context,priorContext); for (const key of Object.keys(priorAbap.Classes)) if (!(key in priorClasses)) delete priorAbap.Classes[key]; Object.assign(priorAbap.Classes,priorClasses); }
    globalThis.abap = priorAbap;
    rmSync(scratch,{recursive:true,force:true});
  }
}
