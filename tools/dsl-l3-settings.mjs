// Tunable L3 defaults. The compiler preserves all non-tunable values as constants.
const INT4 = 2147483647;
const numeric = [
  ["retry.max", (m) => m.resilience?.retry?.max, 0, 99],
  ["retry.backoff", (m) => m.resilience?.retry?.backoff, 0, 86400],
  ["stale", (m) => m.resilience?.stale?.seconds, 60, 99 * 3600],
  ["fuses.max_alerts", (m) => m.resilience?.fuses?.max_alerts?.count, 1, INT4],
  ["keep.days", (m) => m.resilience?.keep?.days, 1, 9999],
];
export function compileSettings(doc, model, {line, fail}) {
  if (doc.settings === undefined) return undefined;
  const spec = doc.settings;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) fail(line("settings"), "settings is {tunable: [names], bounds: {name: {min, max}}}");
  for (const k of Object.keys(spec)) if (!["tunable", "bounds"].includes(k)) fail(line(`settings/${k}`), `unknown settings key ${k}`);
  if (!Array.isArray(spec.tunable) || !spec.tunable.length) fail(line("settings/tunable"), "settings.tunable is a nonempty list");
  const bounds = spec.bounds ?? {};
  if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)) fail(line("settings/bounds"), "settings.bounds is a mapping");
  const available = new Map();
  for (const [name, value, min, max] of numeric) {
    const defaultValue = value(model);
    if (defaultValue !== undefined) available.set(name, {defaultValue: String(defaultValue), min, max, kind: "N"});
  }
  if (model.piles) available.set("piles.size", {defaultValue: String(model.piles.size), min: 1, max: INT4, kind: "N"});
  for (const stage of model.stages ?? []) if (stage.piles) available.set(`piles.${stage.name}.size`, {defaultValue: String(stage.piles.size), min: 1, max: INT4, kind: "N"});
  if (model.schedule) available.set("schedule.every", {defaultValue: model.schedule.every, kind: "P", min: 1, max: 999});
  for (const p of model.params ?? []) {
    if (p.default === undefined) continue;
    const built = p["default@type"]?.built_in;
    const kind = ["INT1", "INT2", "INT4", "INT8", "DEC", "NUMC"].includes(built) ? "N" : "C";
    available.set(`params.${p.name}`, {defaultValue: String(p.default), kind, min: kind === "N" ? 0 : 0,
      max: kind === "N" ? INT4 : Number(p["default@type"]?.length ?? 40)});
  }
  const seen = new Set();
  const entries = spec.tunable.map((name, i) => {
    const at = line(`settings/tunable/${i}`);
    if (typeof name !== "string" || !available.has(name)) fail(at, `unknown or unavailable tunable ${JSON.stringify(name)}; available: ${[...available.keys()].join(", ")}`);
    if (seen.has(name)) fail(at, `tunable ${name} is listed twice`);
    seen.add(name);
    if (name.length > 30) fail(at, `tunable ${name} exceeds PARAM_NAME CHAR 30`);
    const base = available.get(name);
    const bound = bounds[name] ?? {};
    if (!bound || typeof bound !== "object" || Array.isArray(bound) || Object.keys(bound).some((k) => !["min", "max"].includes(k))) fail(line(`settings/bounds/${name}`), `bounds for ${name} are {min, max}`);
    const min = bound.min === undefined ? base.min : Number(bound.min);
    const max = bound.max === undefined ? base.max : Number(bound.max);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < base.min || max > base.max || min > max) fail(line(`settings/bounds/${name}`), `${name} bounds must lie within ${base.min}..${base.max}`);
    if (base.kind === "N" && (+base.defaultValue < min || +base.defaultValue > max)) fail(at, `DSL default of ${name} is outside its bounds`);
    if (base.kind === "C" && (base.defaultValue.length < min || base.defaultValue.length > max)) fail(at, `DSL default of ${name} is outside its bounds`);
    if (base.kind === "P" && (+base.defaultValue.slice(0, -1) < min || +base.defaultValue.slice(0, -1) > max)) fail(at, `DSL default of ${name} is outside its bounds`);
    const field = name.replace(/\./g, "_");
    return {"@id": `${model["@id"]}/setting/${name}`, set_line: at, name, "name@type": {built_in: "CHAR", length: 30},
      field, screen: `s_${i + 1}`, default: base.defaultValue, "default@type": {built_in: "CHAR", length: 40},
      kind: base.kind, min: String(min), max: String(max), numeric: base.kind === "N", period: base.kind === "P", char: base.kind === "C"};
  });
  for (const name of Object.keys(bounds)) if (!seen.has(name)) fail(line(`settings/bounds/${name}`), `bounds names non-tunable ${name}`);
  const has = (name) => seen.has(name);
  for (const param of model.params ?? []) if (has(`params.${param.name}`)) param.tunable = true;
  for (const stage of model.stages ?? []) if (stage.piles && has(`piles.${stage.name}.size`)) {
    stage.piles.tunable_size = true;
    stage.piles.settings_field = `piles_${stage.name}_size`;
  }
  return {"@id": `${model["@id"]}/settings`, set_line: line("settings"), entries,
    class: `zcl_l3_${model.set}_conf`, report: `zl3_${model.set}_conf`,
    retry_max: has("retry.max"), retry_backoff: has("retry.backoff"), stale: has("stale"),
    max_alerts: has("fuses.max_alerts"), keep_days: has("keep.days"),
    schedule_every: has("schedule.every"), pile_size: has("piles.size"),
    params: entries.filter((e) => e.name.startsWith("params.")).map((e) => ({...e, param: e.name.slice(7)})),
    stages: (model.stages ?? []).map((s) => ({no: s.no, field: `piles_${s.name}_size`, tunable: has(`piles.${s.name}.size`)}))};
}
