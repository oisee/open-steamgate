// An empirical twin from durable L3 rows. Older audits retain only the last
// attempt's timestamps: missing durations are censored, never fabricated.
import {DatabaseSync} from 'node:sqlite';
import {MILLION, OUTCOMES, PERCENTILES} from './dsl-l3-sim.mjs';

export const stampSeconds = (stamp) => {
  const s = String(stamp).padStart(14, '0');
  if (!/^\d{14}$/.test(s) || Number(s) === 0) return undefined;
  const seconds = Date.parse(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}Z`) / 1000;
  return Number.isFinite(seconds) ? seconds : undefined;
};
export function quantiles(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  return PERCENTILES.map((p) => sorted[Math.max(0, Math.ceil(p * sorted.length / MILLION) - 1)] ?? 0);
}
const normalize = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k,v]) => [k, typeof v === 'string' ? v.trimEnd() : v])));
export function readRun(model, run, db) {
  if (!run || !db) throw new Error('profile needs --run and --db');
  const handle = new DatabaseSync(db, {readOnly: true});
  try {
    handle.exec('BEGIN');
    const rows = (table, order) => normalize(handle.prepare(`SELECT * FROM ${table} WHERE run_id = ? ORDER BY ${order}`).all(run));
    const source = {
      piles: rows('zosd_l3_pile', 'stage_no, rule_name, pile_no'),
      doctor: rows('zosd_l3_doctor', 'seq'), events: rows('zosd_l3_event', 'seq'),
      settings: rows('zosd_l3_run_conf', 'param_name'), stages: rows('zosd_l3_stage', 'stage_no'),
      alerts: rows('zosd_l3_alert', 'rule_name, pile_no, alert_seq'), work: rows('zosd_l3_work', 'worklist, key_value'),
    };
    if (!source.piles.length || source.piles.some((p) => p.set_name !== model.set)) throw new Error(`run ${run} has no pile profile for set ${model.set}`);
    return source;
  } finally { handle.close(); }
}

export function observations(source) {
  const samples = [];
  for (const p of source.piles) {
    const audit = source.doctor.filter((r) => r.rule_name === p.rule_name && r.pile_no === p.pile_no);
    const work = audit.filter((r) => r.doc_action === 'WORK');
    if (work.length) {
      for (const r of work) {
        const m = /^(OK|SLOW|DUMP|HANG)\s+(\d+)\s+(\d+)$/.exec(r.reason);
        if (!m) throw new Error(`invalid WORK audit ${r.seq}`);
        samples.push({rule: p.rule_name, stage: p.stage_no, pile: p.pile_no, outcome: m[1].toLowerCase(), duration: +m[2], hits: +m[3], censored: false, exact: true});
      }
      continue;
    }
    // RESUBMIT RETRY records an earlier failed attempt; FAILED followed by
    // RESUBMIT is the same failure. STALE-PLAN is a submit, not failed work.
    const retries = audit.filter((r) => r.doc_action === 'RESUBMIT' && r.reason === 'RETRY');
    const failures = audit.filter((r) => r.doc_action === 'FAILED');
    const stalePlans = audit.filter((r) => r.doc_action === 'RESUBMIT' && r.reason === 'STALE-PLAN').length;
    for (let i = 0; i < Math.max(retries.length, Math.max(0, p.attempt - 1 - stalePlans)); i++) {
      const reason = failures[i]?.reason ?? 'RETRY';
      samples.push({rule: p.rule_name, stage: p.stage_no, pile: p.pile_no,
        outcome: /GONE|NO-JOB|STALE/.test(reason) ? 'hang' : 'dump', duration: null, hits: null, censored: true});
    }
    if (!['DONE','FAILED'].includes(p.status)) continue;
    const start = stampSeconds(p.started), end = stampSeconds(p.ended);
    const duration = start !== undefined && end !== undefined && end >= start ? end-start : null;
    samples.push({rule: p.rule_name, stage: p.stage_no, pile: p.pile_no,
      outcome: p.status === 'DONE' ? 'ok' : /GONE|NO-JOB|STALE/.test(p.reason) ? 'hang' : 'dump',
      duration, hits: p.status === 'DONE' ? p.alerts : null, censored: duration === null});
  }
  // Old rows have no explicit slow outcome. Infer it from the successful
  // attempts above twice their group's median (the rule, not the whole fleet).
  for (const rule of new Set(samples.map((s) => s.rule))) {
    const group = samples.filter((s) => s.rule === rule && s.outcome === 'ok' && !s.censored && !s.exact);
    const median = quantiles(group.map((s) => s.duration))?.[7] ?? 0;
    if (median > 0) for (const s of group) if (s.duration > 2 * median) s.outcome = 'slow';
  }
  return samples;
}
function distribution(samples, autoclose) {
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, samples.filter((s) => s.outcome === o).length]));
  const outcome = Object.fromEntries(OUTCOMES.map((o) => [o,Math.floor(counts[o]*MILLION/samples.length)]));
  const remainders = [...OUTCOMES].sort((a,b) => (counts[b]*MILLION % samples.length)-(counts[a]*MILLION % samples.length));
  const missing = MILLION-Object.values(outcome).reduce((a,b) => a+b,0);
  for (let i = 0; i < missing; i++) outcome[remainders[i]]++;
  return {attempts: samples.length, duration_observations: samples.filter((s) => s.duration !== null).length,
    hits_observations: samples.filter((s) => s.hits !== null).length, censored: samples.filter((s) => s.censored).length,
    duration: quantiles(samples.flatMap((s) => s.duration === null ? [] : [s.duration])),
    hits: quantiles(samples.flatMap((s) => s.hits === null ? [] : [s.hits])), outcome, counts, autoclose};
}
export function profileRun(model, {run, db, source = readRun(model, run, db)} = {}) {
  const samples = observations(source);
  if (!samples.length) throw new Error('run has no observed work');
  const share = (rows) => rows.length ? Math.floor(rows.filter((r) => r.closed === 'X').length*MILLION/rows.length) : 0;
  const rules = {};
  for (const r of model.rules) {
    const group = samples.filter((s) => s.rule === r.name);
    if (group.length) rules[r.name] = distribution(group, share(source.alerts.filter((a) => a.rule_name === r.name)));
  }
  const stages = {};
  for (const s of model.stages ?? [{name: "all", no: "0"}]) {
    const group = samples.filter((x) => x.stage === +s.no);
    if (group.length) stages[s.name] = distribution(group, share(source.alerts.filter((a) => +(model.rules.find((r) => r.name === a.rule_name)?.stage_no ?? 0) === +s.no)));
  }
  return {version: 1, duration_unit: 'clock_seconds', set: model.set, run: run ?? source.piles[0].run_id, percentiles: PERCENTILES,
    settings: Object.fromEntries(source.settings.map((r) => [r.param_name, r.param_val])),
    autoclose: share(source.alerts), rules, stages, samples, source,
    inference: 'WORK audit is exact; older successful rows over twice the rule median are slow; vanished jobs are hang, other failures dump. Missing earlier durations/hits are censored; unfinished work without a WORK audit contributes only its recorded earlier attempts.'};
}
