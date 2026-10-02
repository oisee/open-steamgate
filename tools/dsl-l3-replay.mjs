// Compile an empirical table into the same integer configuration as sim.
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
const P = [1000,10000,50000,100000,200000,300000,400000,500000,600000,700000,800000,900000,950000,990000,999000];
const O = ['ok','slow','dump','hang'];
export function compileReplay(spec, sim, model, {file, line, fail}) {
  const at = line('simulate/profile');
  let profile;
  try { profile = typeof spec.profile === 'string' ? JSON.parse(readFileSync(resolve(dirname(file), spec.profile), 'utf8')) : spec.profile; }
  catch (e) { fail(at, `simulate.profile: ${e.message}`); }
  if (!profile || (profile.version !== 1 && profile.version !== '1') || profile.set !== model.set || (!Array.isArray(profile.percentiles) || JSON.stringify(profile.percentiles.map(Number)) !== JSON.stringify(P))) fail(at, 'simulate.profile is a version 1 profile of this set with the MINSTD quantile knots');
  const integer = (n,max) => (typeof n === 'number' || (typeof n === 'string' && /^\d+$/.test(n))) && Number.isInteger(+n) && +n >= 0 && +n <= max;
  const table = (xs, max, what) => {
    if (!Array.isArray(xs) || xs.length !== P.length || xs.some((n,i) => !integer(n,max) || (i && +n < +xs[i-1]))) fail(at, `${what}: 15 ordered integer knots within 0..${max}`);
    return xs.map(Number).join(' ');
  };
  const rules = sim.rules.map((node) => {
    const r = model.rules.find((r) => r.name === node.rule);
    const stage = model.stages.find((s) => s.no === r.stage_no);
    const stageData = profile.stages?.[stage.name];
    const d = profile.rules?.[node.rule] ?? stageData;
    if (!d || !integer(d.attempts,2147483647) || +d.attempts < 1) fail(at, `profile has no observations for ${node.rule} or stage ${stage.name}`);
    if (O.some((o) => !integer(d.outcome?.[o],1000000)) || O.reduce((n,o) => n + +d.outcome[o],0) !== 1000000) fail(at, `profile outcomes for ${node.rule} sum to 1000000`);
    if (!integer(d.autoclose,1000000)) fail(at, 'profile autoclose is within 0..1000000');
    const copy = structuredClone(node);
    copy.empirical = true;
    copy.duration = {...copy.duration, dist: 'L', a: '0', b: '0', knots: table(d.duration ?? stageData?.duration,2147483647,'duration'), 'knots@type': {built_in:'STRG'}};
    copy.hits = {...copy.hits, dist: 'Q', a: '0', b: '0', chunks: [{text: table(d.hits ?? stageData?.hits,100000,'hits'), 'text@type': {built_in:'STRG'}}]};
    copy.outcome = {...copy.outcome, ...Object.fromEntries(O.map((o) => [o,String(d.outcome[o])]))};
    copy.slow_factor.value = '1';
    copy.autoclose.value = String(d.autoclose);
    // Every generated table value traces to the profile declaration.
    const trace = (n) => { if (!n || typeof n !== 'object') return; if (n['@id']) { n.set_line = at; n['@id'] = n['@id'].replace('/simulate','/replay'); } for (const v of Object.values(n)) trace(v); };
    trace(copy);
    return copy;
  });
  const work = model.ports.find((p) => p.is_work).variants.find((v) => v.name === 'replay');
  const replay = {...sim, '@id': `${model['@id']}/replay`, set_line: at, rules, work_class: work.class, replay: true};
  model.replay = replay;
  return replay;
}
