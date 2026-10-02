// Governor compilation is separate from the set language and emits nothing
// for manifests without governor. Ratios are exact integer basis points in
// settings and persisted runs (0.7 in YAML is 7000 in application data).
export function compileGovernor(doc, model, rules, {line, fail}) {
  const at = line("governor");
  const bad = (reason) => fail(at, reason);
  const map = (value, keys, name) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) bad(`${name} is a mapping`);
    for (const k of Object.keys(value)) if (!keys.includes(k)) bad(`unknown ${name} key ${k}`);
    return value;
  };
  const spec = map(doc.governor, ["budget", "funnel"], "governor");
  if (!model.staged || !model.resilience) bad("governor needs stages and resilience for gates, resume and the doctor");
  const budget = map(spec.budget, ["glass", "counts", "warn", "narrow_at", "per_pile"], "governor.budget");
  const funnel = map(spec.funnel, ["group_by", "autoclose"], "governor.funnel");
  if (budget.counts !== "open") bad("governor counts: open is the only mode; created is future");
  if (funnel.group_by !== "object") bad("governor group_by: object is per rule; object_all_rules is future");
  const whole = (raw, name, min) => {
    if (!/^\d+$/.test(String(raw)) || +raw < min || +raw > 2147483647) bad(`${name} must be an INT4 >= ${min}`);
    return String(+raw);
  };
  const ratio = (raw, name) => {
    if (!/^(?:0\.\d{1,4}|1(?:\.0{1,4})?)$/.test(String(raw)) || +raw <= 0) bad(`${name} must be > 0 and <= 1 with at most four decimal places`);
    return String(Math.round(+raw * 10000));
  };
  const glass = whole(budget.glass, "budget.glass", 1);
  const warn = ratio(budget.warn ?? "0.7", "budget.warn");
  const narrow = ratio(budget.narrow_at ?? "0.8", "budget.narrow_at");
  if (+warn > +narrow) bad("budget.warn must be <= budget.narrow_at");
  const autoclose = funnel.autoclose;
  const port = typeof autoclose === "string" && autoclose.startsWith("port:")
    ? model.ports.find((p) => p.name === autoclose.slice(5) && p.is_autoclose) : undefined;
  if (autoclose !== "none" && !port) bad("autoclose is none or port:<an autoclose port>");
  const node = {"@id": `${model["@id"]}/governor`, set_line: at, glass, warn, narrow_at: narrow,
    exception: model.exception, ports_class: model.ports_class,
    per_pile: whole(budget.per_pile ?? "0", "budget.per_pile", 0),
    ...(port ? {autoclose_port: port.name, "autoclose_port@type": {built_in: "CHAR", length: 30}, autoclose_iface: port.iface} : {})};
  // Existing L2 checks return rendered alert rows. Carry the declared driving
  // field from a fixed literal prefix; never guess by splitting at whitespace.
  // Refuse ambiguous layouts, instead of silently budgeting a display string.
  for (const entry of rules.filter((r) => r.enabled && !model.stages[r.s].filter)) {
    const rule = entry.compiled;
    const parts = rule.alert?.parts ?? [];
    const index = parts.findIndex((p) => !p.is_text && p.alias === rule.range?.alias && p.column === rule.range?.field);
    if (index < 0 || parts.slice(0, index).some((p) => !p.is_text)) bad(`rule ${rule.rule} must carry its range key after a literal prefix in alert:`);
    const type = parts[index]["@type"];
    if (!["CHAR", "NUMC"].includes(type?.built_in) || +type.length > 40) bad(`rule ${rule.rule} needs a character driving key of at most 40 characters`);
    const target = model.rules.find((r) => r.name === rule.rule);
    target.governed = {...node, rule_no: target.index, offset: String(parts.slice(0, index).reduce((n, p) => n + p.value.length, 0)), length: String(type.length)};
  }
  return node;
}

// An opt-in recipe overlay keeps the legacy template and its trace line
// numbers byte-stable. Each checked anchor applies exactly once; a template
// edit that invalidates one fails loudly instead of dropping safety code.
export function governorTemplate(template, patches) {
  for (const patch of patches) {
    const before = patch.before.join(""), after = patch.after.join("");
    if (template.split(before).length !== 2) throw new Error("governor recipe anchor must occur exactly once");
    template = template.replace(before, after);
  }
  return template;
}
