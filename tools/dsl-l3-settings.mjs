// Tunable L3 defaults. The compiler preserves all non-tunable values as constants.
import {CHAOS_SETTINGS} from "./dsl-l3-sim.mjs";
const INT4 = 2147483647;
// settings no job step carries: read live from the settings table by their one reader
const LIVE_ONLY = ["piles.lanes", "remote.destination"];
const integerRanges = {INT1: [0n, 255n], INT2: [-32768n, 32767n], INT4: [-2147483648n, 2147483647n],
  INT8: [-9223372036854775808n, 9223372036854775807n]};
const characterTypes = new Set(["CHAR", "CLNT", "LANG", "CUKY", "UNIT", "ACCP", "NUMC", "DATS", "TIMS"]);
// one value of a list setting, as a regular expression: no comma, no blank (the list is "M,X")
const listElement = (type) => type.built_in === "DATS" ? "[0-9]{8}" : type.built_in === "TIMS" ? "[0-9]{6}"
  : type.built_in === "NUMC" ? `[0-9]{1,${type.length ?? 1}}` : `[^, ]{1,${type.length ?? 1}}`;
const numeric = [
  ["budget.glass", (m) => m.governor?.glass, 1, INT4],
  ["budget.warn", (m) => m.governor?.warn, 1, 10000],
  ["budget.narrow_at", (m) => m.governor?.narrow_at, 1, 10000],
  ["budget.per_pile", (m) => m.governor?.per_pile, 0, INT4],
  // the operator's cap on the lanes of event release; 0 = none, the computed lanes stand
  ["piles.lanes", (m) => m.release_event?.lanes, 0, 9999],
  ["doctor.tick", (m) => m.resilience?.doctor?.tick, 1, 3600],
  ["retry.max", (m) => m.resilience?.retry?.max, 0, 99],
  ["retry.backoff", (m) => m.resilience?.retry?.backoff, 0, 86400],
  ["stale", (m) => m.resilience?.stale?.seconds, 60, 99 * 3600],
  ["fuses.max_alerts", (m) => m.resilience?.fuses?.max_alerts?.count, 1, INT4],
  ["keep.days", (m) => m.resilience?.keep?.days, 1, 9999],
  // the simulated twin: its seed, and its time scale in wall millionths per simulated second
  ["simulate.seed", (m) => m.simulate?.seed?.value, 1, INT4 - 1],
  ["simulate.time_scale", (m) => m.simulate?.scale?.value, 0, 1000000],
  // chaos (slice 6c): per-mille shares of the outcomes and the autoclose, the mean of the hits; -1 = not set,
  // the profile's (or the manifest's) value stands. The three outcomes together may not exceed 1000.
  ["simulate.dump", (m) => (m.simulate ? -1 : undefined), -1, 1000],
  ["simulate.hang", (m) => (m.simulate ? -1 : undefined), -1, 1000],
  ["simulate.slow", (m) => (m.simulate ? -1 : undefined), -1, 1000],
  ["simulate.hits_mean", (m) => (m.simulate ? -1 : undefined), -1, 100],
  ["simulate.autoclose", (m) => (m.simulate ? -1 : undefined), -1, 1000],
];
// What a run is planned and fused with belongs to the run: the fuse, the pile
// sizes and the set's parameters are read from the run's snapshot whenever the
// run is worked again (a job, the doctor, collect( )). The rest (retry budget,
// backoff, staleness, retention, the schedule) is the operator's policy of the
// moment and is read fresh once per pass.
export const runScoped = (name) => name.startsWith("budget.") || name.startsWith("simulate.") || name === "fuses.max_alerts" || /^piles\.([a-z0-9_]+\.)?size$/.test(name) || name.startsWith("params.");
export function compileSettings(doc, model, {line, fail}) {
  if (doc.settings === undefined) return undefined;
  const spec = doc.settings;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) fail(line("settings"), "settings is {tunable: [names], bounds: {name: {min, max}}}");
  for (const k of Object.keys(spec)) if (!["tunable", "bounds"].includes(k)) fail(line(`settings/${k}`), `unknown settings key ${k}`);
  if (!Array.isArray(spec.tunable) || !spec.tunable.length) fail(line("settings/tunable"), "settings.tunable is a nonempty list");
  const bounds = spec.bounds ?? {};
  if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)) fail(line("settings/bounds"), "settings.bounds is a mapping");
  const available = new Map();
  const lossy_reasons = new Map();
  if (model.remote) available.set("remote.destination", {defaultValue: "NONE", kind: "C", min: 1, max: 32});
  for (const [name, value, min, max] of numeric) {
    const defaultValue = value(model);
    if (defaultValue !== undefined) available.set(name, {defaultValue: String(defaultValue), min, max, kind: "N"});
  }
  // a setting with a list of values: the profile of the simulated twin, `default` or one the manifest names
  if (model.simulate?.profile_names) available.set("simulate.profile", {defaultValue: "default", kind: "C", min: 1, max: 20,
    values: ["default", ...model.simulate.profile_names]});
  if (model.piles) available.set("piles.size", {defaultValue: String(model.piles.size), min: 1, max: INT4, kind: "N"});
  for (const stage of model.stages ?? []) if (stage.piles) available.set(`piles.${stage.name}.size`, {defaultValue: String(stage.piles.size), min: 1, max: INT4, kind: "N"});
  if (model.schedule) available.set("schedule.every", {defaultValue: model.schedule.every, kind: "P", min: 1, max: 999});
  for (const p of model.params ?? []) {
    if (p.is_selopt) {
      // a range is tunable as a list of values ("M,X": each an I EQ row), the form a settings row holds in 40 characters;
      // a default with BT or E rows is the manifest's (and the API's), not the operator's
      const rows = p.default_rows ?? [];
      const type = p.elem_type;
      if (rows.some((r) => r.sign !== "I" || r.option !== "EQ")) continue;
      const text = rows.map((r) => r.low).join(",");
      const built = type?.built_in;
      if (!type || !characterTypes.has(built) || text.length > 40) continue;
      // the list must round-trip: a value with the separator or a blank (or a blank value) would come back as other rows
      const lossy = rows.find((r) => !new RegExp(`^${listElement(type)}$`).test(r.low));
      if (lossy) { lossy_reasons.set(`params.${p.name}`, `the default of ${p.name} holds ${JSON.stringify(lossy.low)}, which a list of values cannot carry (a value is not blank and has no comma or blank); keep the parameter out of settings.tunable`); continue; }
      available.set(`params.${p.name}`, {defaultValue: text, kind: "C", min: 0, max: 40, list: true, element: listElement(type), built, rangeOf: p.type_name});
      continue;
    }
    if (p.default === undefined) continue;
    const built = p["default@type"]?.built_in;
    if (integerRanges[built]) {
      const [min, max] = integerRanges[built];
      available.set(`params.${p.name}`, {defaultValue: String(p.default), kind: "N", min, max,
        valueType: p.type_name});
    } else if (characterTypes.has(built)) {
      available.set(`params.${p.name}`, {defaultValue: String(p.default), kind: "C", min: 0,
        max: Number(p["default@type"]?.length ?? 40), valueType: p.type_name, built});
    }
  }
  const seen = new Set();
  // a job step carries at most 20 selection values: the chaos settings are not among them, the pile job reads
  // them from its run's snapshot, so they take no selection field; nor does a setting only read live
  // (LIVE_ONLY: piles.lanes at every release pass; remote.destination at every send, so a retry can use a repaired destination)
  let screenNo = 0;
  const entries = spec.tunable.map((name, i) => {
    const at = line(`settings/tunable/${i}`);
    if (lossy_reasons.has(name)) fail(at, lossy_reasons.get(name));
    if (typeof name !== "string" || !available.has(name)) fail(at, `unknown or unavailable tunable ${JSON.stringify(name)}; available: ${[...available.keys()].join(", ")}`);
    if (seen.has(name)) fail(at, `tunable ${name} is listed twice`);
    seen.add(name);
    if (name.length > 30) fail(at, `tunable ${name} exceeds PARAM_NAME CHAR 30`);
    const base = available.get(name);
    const bound = bounds[name] ?? {};
    if (!bound || typeof bound !== "object" || Array.isArray(bound) || Object.keys(bound).some((k) => !["min", "max"].includes(k))) fail(line(`settings/bounds/${name}`), `bounds for ${name} are {min, max}`);
    // a fuse tunable up to INT4 can be tuned off: the manifest names its ceiling
    if (name === "fuses.max_alerts" && bound.max === undefined) fail(line(`settings/bounds/${name}`), `${name} is tunable only with bounds: {max: n}; without a ceiling the fuse can be tuned off`);
    const integerParam = typeof base.min === "bigint";
    const integer = (raw) => /^-?[0-9]+$/.test(String(raw)) ? BigInt(raw) : undefined;
    const min = bound.min === undefined ? base.min : integerParam ? integer(bound.min) : Number(bound.min);
    const max = bound.max === undefined ? base.max : integerParam ? integer(bound.max) : Number(bound.max);
    if (min === undefined || max === undefined || (!integerParam && (!Number.isInteger(min) || !Number.isInteger(max)))
      || min < base.min || max > base.max || min > max) fail(line(`settings/bounds/${name}`), `${name} bounds must lie within ${base.min}..${base.max}`);
    if (base.kind === "N" && (integerParam ? BigInt(base.defaultValue) < min || BigInt(base.defaultValue) > max
      : +base.defaultValue < min || +base.defaultValue > max)) fail(at, `DSL default of ${name} is outside its bounds`);
    if (base.kind === "C" && (base.defaultValue.length < min || base.defaultValue.length > max)) fail(at, `DSL default of ${name} is outside its bounds`);
    if (base.kind === "P" && (+base.defaultValue.slice(0, -1) < min || +base.defaultValue.slice(0, -1) > max)) fail(at, `DSL default of ${name} is outside its bounds`);
    const field = name.replace(/\./g, "_");
    return {"@id": `${model["@id"]}/setting/${name}`, set_line: at, name, "name@type": {built_in: "CHAR", length: 30},
      field, ...(CHAOS_SETTINGS.includes(name) ? {chaos: true, unscreened: true} : LIVE_ONLY.includes(name) ? {live: true, unscreened: true} : {screen: `s_${++screenNo}`}), default: base.defaultValue, "default@type": {built_in: "CHAR", length: 40},
      kind: base.kind, min: String(min), max: String(max), numeric: base.kind === "N", period: base.kind === "P", char: base.kind === "C",
      value_type: base.valueType, digit_text: !base.list && base.built === "NUMC", date_text: !base.list && base.built === "DATS",
      time_text: !base.list && base.built === "TIMS", scoped: runScoped(name),
      ...(base.list ? {list: true, range_of: base.rangeOf, list_regex: `^(${base.element}(,${base.element})*)?$`, "list_regex@type": {built_in: "STRG"}} : {}),
      ...(base.values ? {pattern: `^(${base.values.join("|")})$`, "pattern@type": {built_in: "STRG"}, values: base.values.join(", ")} : {})};
  });
  for (const name of Object.keys(bounds)) if (!seen.has(name)) fail(line(`settings/bounds/${name}`), `bounds names non-tunable ${name}`);
  const has = (name) => seen.has(name);
  const chaosOutcomes = entries.filter((e) => ["simulate.dump", "simulate.hang", "simulate.slow"].includes(e.name));
  for (const param of model.params ?? []) if (has(`params.${param.name}`)) param.tunable = true;
  for (const stage of model.stages ?? []) if (stage.piles && has(`piles.${stage.name}.size`)) {
    stage.piles.tunable_size = true;
    stage.piles.settings_field = `piles_${stage.name}_size`;
  }
  return {"@id": `${model["@id"]}/settings`, set_line: line("settings"), entries, has_scoped: entries.some((e) => e.scoped),
    has_list: entries.some((e) => e.list), class: `zcl_l3_${model.set}_conf`, report: `zl3_${model.set}_conf`,
    ...(model.governor ? {budget_glass: has("budget.glass"), budget_warn: has("budget.warn"),
      budget_narrow_at: has("budget.narrow_at"), budget_per_pile: has("budget.per_pile")} : {}),
    pile_lanes: has("piles.lanes"), doctor_tick: has("doctor.tick"), retry_max: has("retry.max"), retry_backoff: has("retry.backoff"), stale: has("stale"),
    max_alerts: has("fuses.max_alerts"), keep_days: has("keep.days"),
    ...(model.simulate ? {simulate_seed: has("simulate.seed"), simulate_time_scale: has("simulate.time_scale")} : {}),
    ...(chaosOutcomes.length ? {chaos_sum: true, chaos_outcomes: chaosOutcomes} : {}),
    schedule_every: has("schedule.every"), pile_size: has("piles.size"),
    params: entries.filter((e) => e.name.startsWith("params.")).map((e) => ({...e, param: e.name.slice(7)})),
    stages: (model.stages ?? []).map((s) => ({no: s.no, field: `piles_${s.name}_size`, tunable: has(`piles.${s.name}.size`)}))};
}
