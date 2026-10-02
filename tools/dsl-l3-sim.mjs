// DSL L3, slice 5d: a simulated twin of the work of a pile (docs/dsl-l3.md,
// "Simulated twin: the work as a port"). The work of a pile (the L2 check, or
// a filter's keys( )) becomes a port, `work`, with two generated variants:
// `real`, the runner's own static calls of the L2 classes, and `sim`, which
// draws an outcome (ok, slow, dump, hang), a duration and its hits from a
// stream that is a pure function of (seed, run, rule, pile, attempt), and acts
// it out for real inside the job: WAIT UP TO, an abnormal end, synthetic hits
// over the pile's own keys. The gates, the doctor, the retries, the governor,
// the schedule and the events stay the real generated code.
//
// This file is the compiler of `simulate:` and the JavaScript twin of the
// generated sim class: the same generator (MINSTD by Schrage's method, which
// never leaves INT4), the same mixing, the same integer thresholds and the
// same quantile tables, so a test computes what the ABAP draws. Every number
// the ABAP needs at run time is an integer the compiler computed; the run
// time does no floating point. tools/dsl-l3.mjs calls this; it knows the set
// language and nothing of any domain.

export const SIM_KEYS = ["seed", "time_scale", "allow_sink", "default", "rules", "stages"];
export const FIELDS = ["duration", "outcome", "slow_factor", "hits", "autoclose", "keep"];
// the order of the outcome thresholds: u below ok is OK, below ok + slow SLOW, ...
export const OUTCOMES = ["ok", "slow", "dump", "hang"];
export const WORK_PORT = "work";
// MINSTD, Park and Miller: x' = 16807 x mod (2^31 - 1), by Schrage's method
export const MODULUS = 2147483647;
const MULTIPLIER = 16807, SCHRAGE_Q = 127773, SCHRAGE_R = 2836;
export const MILLION = 1000000;
// what a character of the stream's text mixes in: its position here plus one, 0 when absent
export const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_.:|";
// the lognormal's knots: the quantiles at these per-million points, interpolated between
export const PERCENTILES = [1000, 10000, 50000, 100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000, 950000, 990000, 999000];
// the standard normal's quantiles at PERCENTILES (six decimals), and the one at 0.95
const NORMAL = [-3.090232, -2.326348, -1.644854, -1.281552, -0.841621, -0.524401, -0.253347, 0, 0.253347, 0.524401, 0.841621, 1.281552, 1.644854, 2.326348, 3.090232];
const Z95 = 1.644854;
const MAX_SECONDS = 604800; // a week: the longest duration a manifest names
const MAX_DRAWN = 31536000; // a year: the longest a lognormal's tail is drawn
const MAX_POISSON = 100;
const INT4 = {built_in: "INT4"};
const CHAR = (length) => ({built_in: "CHAR", length});
const STRG = {built_in: "STRG"};
// what a field is when nothing names it
const BUILTIN = {duration: {dist: "fixed", value: "0"}, outcome: {ok: "1"}, slow_factor: "1", hits: {dist: "fixed", value: "0"}, autoclose: "0", keep: "1"};

// ---------------------------------------------------------------------------
// the generator, exactly as the generated class computes it

export function step(x) {
  const hi = Math.floor(x / SCHRAGE_Q), lo = x % SCHRAGE_Q;
  const t = MULTIPLIER * lo - SCHRAGE_R * hi;
  return t <= 0 ? t + MODULUS : t;
}

// the stream of one text: the seed, then each character mixed in and stepped
export function start(seed, text) {
  let h = seed % MODULUS;
  if (h <= 0) h = 1;
  for (const ch of String(text)) {
    const code = ALPHABET.indexOf(ch) + 1;
    const room = MODULUS - code;
    h = h >= room ? h - room : h + code;
    if (h === 0) h = 1;
    h = step(h);
  }
  return {state: h, next() { this.state = step(this.state); return this.state % MILLION; }};
}

export const pileText = ({run, rule, pile, attempt}) => `${String(run).trim()}|${String(rule).trim()}|${pile}|${attempt}`;
export const closeText = ({run, rule, key}) => `${String(run).trim()}|${String(rule).trim()}|${String(key).trim()}|close`;

const big = (n) => BigInt(n);
const scaled = (value, u, span) => Number((big(value) * big(u)) / big(span)); // both non-negative: floor

function duration(config, u) {
  if (config.dist === "F") return config.dur_a;
  if (config.dist === "U") return config.dur_a + scaled(config.dur_b - config.dur_a + 1, u, MILLION);
  const knots = config.knots.split(" ").map(Number);
  if (u <= PERCENTILES[0]) return knots[0];
  if (u >= PERCENTILES.at(-1)) return knots.at(-1);
  for (let i = 1; i < PERCENTILES.length; i++) {
    if (u < PERCENTILES[i]) return knots[i - 1] + scaled(knots[i] - knots[i - 1], u - PERCENTILES[i - 1], PERCENTILES[i] - PERCENTILES[i - 1]);
  }
  return knots.at(-1);
}

function hits(config, u) {
  if (config.hits === "F") return config.hits_a;
  if (config.hits === "U") return config.hits_a + scaled(config.hits_b - config.hits_a + 1, u, MILLION);
  const cdf = config.cdf.split(" ").map(Number);
  const k = cdf.findIndex((c) => u < c);
  return k < 0 ? cdf.length - 1 : k;
}

// One pile's draw: outcome, the simulated seconds it takes, the wall seconds it
// waits, its hit count and the keys it answers (a filter's kept keys, or a
// check's sampled ones, sorted). `keys` are the pile's keys, sorted and unique.
export function draw(config, {run, rule, pile, attempt, seed, scale, stale}, keys = [], {filter = false} = {}) {
  const stream = start(seed, pileText({run, rule, pile, attempt}));
  const u0 = stream.next();
  const outcome = u0 < config.ok ? "OK" : u0 < config.ok + config.slow ? "SLOW" : u0 < config.ok + config.slow + config.dump ? "DUMP" : "HANG";
  const base = duration(config, stream.next());
  const count = hits(config, stream.next());
  let chosen;
  if (filter) {
    chosen = keys.filter(() => stream.next() < config.keep);
  } else {
    const pool = [...keys];
    const k = Math.min(count, pool.length);
    for (let i = 0; i < k; i++) {
      const j = i + scaled(pool.length - i, stream.next(), MILLION);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    chosen = pool.slice(0, k).sort();
  }
  let seconds = outcome === "SLOW" ? base * config.slow_factor : outcome === "DUMP" ? Math.floor(base / 2)
    : outcome === "HANG" ? stale + Math.floor(stale / 2) : base;
  seconds = Math.min(seconds, MODULUS);
  const wait = Number((big(seconds) * big(scale) + big(MILLION / 2)) / big(MILLION));
  return {outcome, duration: seconds, wait, hits: count, keys: chosen};
}

// whether the chance autoclose closes one alert
export const closes = (config, {seed, run, rule, key}) => start(seed, closeText({run, rule, key})).next() < config.autoclose;

// the text of a simulated alert: SIM, the rule's literal prefix, the key padded
// to its width (so the governor finds it four characters further on)
export const alertText = (config, {pile, attempt}, key) => `SIM ${config.prefix}${String(key).padEnd(config.key_length, " ")}: simulated hit, pile ${pile}, attempt ${attempt}`;

// ---------------------------------------------------------------------------
// the compiler of `simulate:`

const millionths = (raw, {at, fail, what, max = MILLION}) => {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(raw ?? ""));
  const value = m ? Number(m[1]) * MILLION + Number((m[2] ?? "").padEnd(6, "0")) : NaN;
  if (!m || m[1].length > 4 || value > max) fail(at, `${what} is a number from 0 to ${max / MILLION} with at most six decimals, not ${JSON.stringify(raw)}`);
  return value;
};
const whole = (raw, {at, fail, what, min, max}) => {
  if (!/^\d{1,10}$/.test(String(raw ?? "")) || Number(raw) < min || Number(raw) > max) fail(at, `${what} is a whole number from ${min} to ${max}, not ${JSON.stringify(raw)}`);
  return Number(raw);
};

// A field of a rule's simulation: the rule's own, else its stage's, else the
// default's, else the built-in. `sets` is {rules, stages, default, builtin},
// each field an object {value, at}.
export const precedence = (sets, rule, stage, name) => sets.rules[rule]?.[name] ?? sets.stages[stage]?.[name] ?? sets.default[name] ?? sets.builtin[name];

// The compile-time half of the safety rule: a default binding of work to sim
// with a production sink variant (log, or a hand-written class) bound is
// refused unless simulate.allow_sink names that variant.
export function sinkSafety({bindings, sink, allow}) {
  const work = bindings[WORK_PORT];
  const bound = sink.variants.find((v) => v.name === bindings[sink.name]);
  if (work === "sim" && bound && (bound.is_log || bound.hand) && !allow.includes(bound.name)) return bound.name;
  return undefined;
}

// `simulate:` against the compiled set: the per-rule configuration (rule >
// stage > default, field by field), the work port's node, the safety data the
// factory checks at run time, and the nodes every generated line traces to.
export function compileSimulate(doc, model, all, {line, fail, bindings}) {
  const spec = doc.simulate;
  const at = line("simulate");
  const id = `${model["@id"]}/simulate`;
  const map = (value, key, what) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(line(key), `${key.replace(/\//g, ".")} is ${what}`);
    return value;
  };
  map(spec, "simulate", "a mapping of seed, time_scale, allow_sink, default, rules and stages");
  for (const key of Object.keys(spec)) if (!SIM_KEYS.includes(key)) fail(line(`simulate/${key}`), `unknown key ${key} in simulate (${SIM_KEYS.join(", ")})`);
  if (!model.staged || !model.resilience) fail(at, "simulate needs stages and resilience: a simulated pile dumps and hangs so that the gates, the doctor and its retries are what is exercised");
  const node = (key, extra) => ({"@id": `${id}/${key}`, set_line: line(spec[key] === undefined ? "simulate" : `simulate/${key}`), ...extra});
  const seed = node("seed", {value: String(whole(spec.seed ?? "1", {at: line("simulate/seed"), fail, what: "simulate.seed", min: 1, max: MODULUS - 1})), "value@type": INT4});
  const scale = node("time_scale", {value: String(millionths(spec.time_scale ?? "1", {at: line("simulate/time_scale"), fail, what: "simulate.time_scale (wall seconds per simulated second)"})), "value@type": INT4});
  const sink = model.sink;
  const allow = spec.allow_sink === undefined ? [] : spec.allow_sink;
  if (!Array.isArray(allow) || allow.some((v) => typeof v !== "string")) fail(line("simulate/allow_sink"), "simulate.allow_sink is a list of variant names of the alert sink");
  for (const name of allow) if (!sink.variants.some((v) => v.name === name)) fail(line("simulate/allow_sink"), `simulate.allow_sink names ${name}, which is not a variant of sink ${sink.name} (${sink.variants.map((v) => v.name).join(", ")})`);
  const unsafe = sinkSafety({bindings, sink, allow});
  if (unsafe) fail(line(`bindings/${WORK_PORT}`), `work is bound to sim and sink ${sink.name} to ${unsafe}, a production variant; a simulated run writes there only when simulate.allow_sink names it`);
  for (const port of model.ports) {
    if (bindings[port.name] === "sim" && port.name !== WORK_PORT && bindings[WORK_PORT] !== "sim") fail(line(`bindings/${port.name}`), `${port.name} is bound to sim, which closes alerts by chance; a sim variant is bound only beside work: sim`);
  }

  // one field of a field set: its parsed value and the line it came from
  const field = (name, raw, key) => {
    const fat = line(key);
    const sub = (k) => line(`${key}/${k}`);
    const only = (value, keys) => { for (const k of Object.keys(value)) if (!keys.includes(k)) fail(sub(k), `unknown key ${k} in ${name} (${keys.join(", ")})`); return value; };
    if (name === "duration" || name === "hits") {
      const value = map(raw, key, `{dist: ${name === "duration" ? "fixed|uniform|lognormal" : "fixed|uniform|poisson"}, ...}`);
      const dists = name === "duration" ? {fixed: ["value"], uniform: ["min", "max"], lognormal: ["median", "p95"]} : {fixed: ["value"], uniform: ["min", "max"], poisson: ["mean"]};
      if (!dists[value.dist]) fail(sub("dist"), `${name}.dist is ${Object.keys(dists).join(", ")}, not ${JSON.stringify(value.dist)}`);
      only(value, ["dist", ...dists[value.dist]]);
      const max = name === "duration" ? MAX_SECONDS : 100000;
      const num = (k, min = 0) => whole(value[k], {at: sub(value[k] === undefined ? "dist" : k), fail, what: `${name}.${k}`, min, max});
      if (value.dist === "fixed") return {kind: "F", a: num("value"), b: 0};
      if (value.dist === "uniform") {
        const a = num("min"), b = num("max");
        if (a > b) fail(sub("max"), `${name}.max is at least ${name}.min (${a}), not ${b}`);
        return {kind: "U", a, b};
      }
      if (value.dist === "lognormal") {
        const median = num("median", 1), p95 = num("p95", 1);
        if (p95 < median) fail(sub("p95"), `duration.p95 is at least the median (${median}), not ${p95}`);
        const sigma = Math.log(p95 / median) / Z95;
        const knots = NORMAL.map((z) => Math.min(MAX_DRAWN, Math.max(0, Math.round(median * Math.exp(sigma * z)))));
        return {kind: "L", a: median, b: p95, knots: knots.join(" ")};
      }
      const mean = millionths(value.mean, {at: sub("mean"), fail, what: "hits.mean", max: MAX_POISSON * MILLION}) / MILLION;
      if (!(mean > 0)) fail(sub("mean"), "hits.mean is above 0");
      return {kind: "P", a: 0, b: 0, cdf: poissonTable(mean).join(" ")};
    }
    if (name === "outcome") {
      const value = only(map(raw, key, `{${OUTCOMES.join(", ")}}: probabilities that sum to 1`), OUTCOMES);
      const ppm = Object.fromEntries(OUTCOMES.map((o) => [o, value[o] === undefined ? 0 : millionths(value[o], {at: sub(o), fail, what: `outcome.${o}`})]));
      const sum = OUTCOMES.reduce((n, o) => n + ppm[o], 0);
      if (sum !== MILLION) fail(fat, `the outcome probabilities sum to 1, these to ${sum / MILLION}`);
      return ppm;
    }
    if (name === "slow_factor") return whole(raw, {at: fat, fail, what: "slow_factor", min: 1, max: 1000});
    return millionths(raw, {at: fat, fail, what: name});
  };
  // a field set: default, or one rule's or one stage's overrides
  const fieldSet = (raw, key) => {
    const value = map(raw, key, `a mapping of ${FIELDS.join(", ")}`);
    for (const k of Object.keys(value)) if (!FIELDS.includes(k)) fail(line(`${key}/${k}`), `unknown key ${k} in ${key.replace(/\//g, ".")} (${FIELDS.join(", ")})`);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, {value: field(k, v, `${key}/${k}`), at: line(`${key}/${k}`)}]));
  };
  const defaults = spec.default === undefined ? {} : fieldSet(spec.default, "simulate/default");
  const named = (key, names, what) => {
    const sets = spec[key] === undefined ? {} : map(spec[key], `simulate/${key}`, `a mapping of ${what} names to fields`);
    return Object.fromEntries(Object.entries(sets).map(([name, raw]) => {
      if (!names.includes(name)) fail(line(`simulate/${key}/${name}`), `simulate.${key} names ${name}, which is not a ${what} of the set (${names.join(", ")})`);
      return [name, fieldSet(raw, `simulate/${key}/${name}`)];
    }));
  };
  const ruleSets = named("rules", model.rules.map((r) => r.name), "rule");
  const stageSets = named("stages", model.stages.map((s) => s.name), "stage");
  const builtin = Object.fromEntries(FIELDS.map((k) => [k, {value: field(k, BUILTIN[k], "simulate"), at}]));

  const sets = {rules: ruleSets, stages: stageSets, default: defaults, builtin};
  const rules = model.rules.map((r) => {
    const stage = model.stages.find((s) => s.no === r.stage_no);
    const pick = (name) => precedence(sets, r.name, stage.name, name);
    const entry = all.find((e) => e.compiled.rule === r.name);
    const {prefix, length} = keyLayout(entry.compiled);
    const f = (name, extra) => ({"@id": `${id}/rule/${r.name}/${name}`, set_line: pick(name).at, ...extra});
    const d = pick("duration").value, h = pick("hits").value, o = pick("outcome").value;
    const config = {
      "@id": `${id}/rule/${r.name}`, set_line: ruleSets[r.name] ? line(`simulate/rules/${r.name}`) : at,
      rule: r.name, "rule@type": CHAR(60),
      duration: f("duration", {dist: d.kind, "dist@type": CHAR(1), a: String(d.a), "a@type": INT4, b: String(d.b), "b@type": INT4,
        ...(d.knots ? {knots: d.knots, "knots@type": STRG} : {})}),
      outcome: f("outcome", Object.fromEntries(OUTCOMES.flatMap((k) => [[k, String(o[k])], [`${k}@type`, INT4]]))),
      slow_factor: f("slow_factor", {value: String(pick("slow_factor").value), "value@type": INT4}),
      hits: f("hits", {dist: h.kind, "dist@type": CHAR(1), a: String(h.a), "a@type": INT4, b: String(h.b), "b@type": INT4,
        ...(h.cdf ? {chunks: chunks(h.cdf).map((text) => ({text, "text@type": STRG}))} : {})}),
      autoclose: f("autoclose", {value: String(pick("autoclose").value), "value@type": INT4}),
      keep: f("keep", {value: String(pick("keep").value), "value@type": INT4}),
      layout: {"@id": `${id}/rule/${r.name}`, set_line: at, prefix, "prefix@type": STRG, length: String(length), "length@type": INT4},
    };
    // the runner's lines about this rule's simulation trace to simulate: what
    // they name of the rule is copied here, so they resolve it in this node
    r.sim = {"@id": id, set_line: at, stage_no: r.stage_no, ...(r.range ? {range: {"@id": id, set_line: at}} : {}),
      ...(r.governed ? {offset: r.governed.offset, sim_offset: String(Number(r.governed.offset) + 4)} : {})};
    return config;
  });
  // a stage's sim_keys reads the stage's source port; a copy of it here, so those lines trace to simulate:
  for (const stage of model.stages) if (stage.piles) stage.piles.sim = {"@id": id, set_line: at, no: stage.no, ports_class: model.ports_class, source: {...stage.piles.source}};
  const work = model.ports.find((p) => p.name === WORK_PORT);
  const production = sink.variants.filter((v) => v.is_log || v.hand);
  const simOnly = model.ports.filter((p) => p.variants.some((v) => v.sim_only)).map((p) => ({port: p.name, "port@type": CHAR(30)}));
  const blocked = production.filter((v) => !allow.includes(v.name)).map((v) => ({name: v.name, "name@type": CHAR(30)}));
  const sim = {"@id": id, set_line: at, seed, scale, ports_class: model.ports_class, exception: model.exception,
    sink: {name: sink.name, "name@type": CHAR(30)}, work_class: work.variants.find((v) => v.name === "sim").class, work_iface: work.iface,
    blocked, ...(blocked.length ? {guarded: {"@id": id, set_line: at}} : {}),
    ...(simOnly.length ? {sim_only: simOnly} : {}), rules,
    percentiles: PERCENTILES.join(" "), "percentiles@type": STRG, alphabet: ALPHABET, "alphabet@type": STRG};
  for (const port of model.ports) if (port.name === WORK_PORT || port.variants.some((v) => v.sim_only)) port.sim = sim;
  return sim;
}

// P(K <= k) of a Poisson in millionths, rounded, until it reaches a million
function poissonTable(mean) {
  const out = [];
  let logp = -mean, cdf = 0;
  for (let k = 0; k < 10000; k++) {
    if (k > 0) logp += Math.log(mean) - Math.log(k);
    cdf += Math.exp(logp);
    const ppm = Math.min(MILLION, Math.round(cdf * MILLION));
    out.push(ppm);
    if (ppm >= MILLION) break;
  }
  out[out.length - 1] = MILLION;
  return out;
}

// a long table as literals of at most 200 characters, cut between numbers
function chunks(text) {
  const out = [];
  let rest = text;
  while (rest.length > 200) {
    const cut = rest.lastIndexOf(" ", 200);
    out.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  out.push(rest);
  return out;
}

// where the rule's driving key sits in its alert: the literal text before it
// and the key's width (a governed rule's object key is read there)
function keyLayout(rule) {
  const parts = rule.alert?.parts ?? [];
  const index = parts.findIndex((p) => !p.is_text && p.alias === rule.range?.alias && p.column === rule.range?.field);
  if (index < 0 || parts.slice(0, index).some((p) => !p.is_text)) return {prefix: "", length: Number(rule.range?.type?.length ?? 0)};
  return {prefix: parts.slice(0, index).map((p) => p.value).join(""), length: Number(parts[index]["@type"]?.length ?? 0)};
}

// The work port a set with simulate: has: injected when the manifest does not
// declare it, bound to real unless the manifest binds it.
export function simPorts(doc, portDocs, bindingDocs, {line, fail}) {
  const declared = portDocs[WORK_PORT];
  const work = Object.entries(portDocs).find(([, def]) => def?.kind === "work");
  if (doc.simulate === undefined) {
    if (work) fail(line(`ports/${work[0]}/kind`), "a work port comes with simulate:, which configures its sim variant");
    return {};
  }
  if (work && work[0] !== WORK_PORT) fail(line(`ports/${work[0]}`), `the work port is named ${WORK_PORT}`);
  if (declared !== undefined && declared?.kind !== "work") fail(line(`ports/${WORK_PORT}`), `port ${WORK_PORT} is the work of a pile in a set with simulate: (kind: work)`);
  const injected = {port: declared === undefined, binding: bindingDocs[WORK_PORT] === undefined};
  if (injected.port) portDocs[WORK_PORT] = {kind: "work", variants: {real: "generated", sim: "generated"}};
  if (injected.binding) bindingDocs[WORK_PORT] = "real";
  return injected;
}

// what a variant of a work port, or a sim variant of an autoclose port, is
export function simVariant({kind, vname, generated, simulate, at, fail}) {
  if (kind === "work") {
    if (!generated) fail(at, `the variants of the work port are generated (real, sim); ${vname} cannot be a class of its own`);
    return {is_inline: vname === "real", is_sim: vname === "sim"};
  }
  if (generated && vname === "sim") {
    if (!simulate) fail(at, "a sim variant comes with simulate:, which gives its probabilities");
    return {is_sim: true, sim_only: true};
  }
  return {};
}

// The twin's view of a rule's compiled configuration (a node of model.simulate.rules)
export const configOf = (node) => ({
  dist: node.duration.dist, dur_a: Number(node.duration.a), dur_b: Number(node.duration.b), knots: node.duration.knots ?? "",
  ok: Number(node.outcome.ok), slow: Number(node.outcome.slow), dump: Number(node.outcome.dump), hang: Number(node.outcome.hang),
  slow_factor: Number(node.slow_factor.value), hits: node.hits.dist, hits_a: Number(node.hits.a), hits_b: Number(node.hits.b),
  cdf: (node.hits.chunks ?? []).map((c) => c.text).join(""), autoclose: Number(node.autoclose.value), keep: Number(node.keep.value),
  prefix: node.layout.prefix, key_length: Number(node.layout.length),
});

// What the orchestration does with one pile, as the twin sees it: attempts
// from 1 until one ends normally (OK or SLOW), at most retryMax + 1 of them;
// DONE at that attempt, else FAILED at the last.
export function predictPile(config, ctx, keys, {filter = false, retryMax}) {
  const attempts = [];
  for (let attempt = 1; attempt <= retryMax + 1; attempt++) {
    const d = draw(config, {...ctx, attempt}, keys, {filter});
    attempts.push(d);
    if (d.outcome === "OK" || d.outcome === "SLOW") return {status: "DONE", attempt, final: d, attempts};
  }
  return {status: "FAILED", attempt: retryMax + 1, final: attempts.at(-1), attempts};
}
