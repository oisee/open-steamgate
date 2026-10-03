// DSL L2: what a reviewer reads of a compiled rule: its derived cases (`node tools/dsl-l2.mjs
// cases`) and the warning of the 64-row cap. Pure functions of the compiled model.
import {describeSelopt} from "./dsl-l2-selopt.mjs";

// What a reviewer reads: each derived case, its rows, and the alerts the
// interpreter expects of it.
export function describeCases(model) {
  const out = [`${model.where ?? model.source}: ${model.examples.length} example(s), ${model.cases.length} derived case(s)`];
  for (const c of model.cases) {
    out.push("", `${c.method}  [${c.derived.condition}, rule line ${c.rule_line}]  ${c.label}`, `  date ${c.date.value}`);
    for (const arg of c.param_args ?? []) if (arg.is_selopt) out.push(describeSelopt(arg));
    for (const t of c.tables) {
      for (const r of t.rows) out.push(`  ${t.table}: ${r.fields.map((f) => `${f.column}=${JSON.stringify(f.value)}`).join(" ")}`);
    }
    for (const table of new Set(model.clauses.map((clause) => clause.table))) if (!c.tables.some((t) => t.table === table)) out.push(`  ${table}: (no rows)`);
    out.push(c.expect.length ? `  expect: ${c.expect.map((e) => JSON.stringify(e.value)).join("\n          ")}` : "  expect: no alert");
  }
  for (const k of model.skipped ?? []) out.push("", `skipped ${k.condition}: ${k.reason}`);
  return out.join("\n");
}

// Warns exactly when a derived case was skipped for the 64-row cap, naming
// the cases (a threshold of 32 loses the two-group case, 64 a boundary).
export function capWarning(model, file = model.where ?? model.source) {
  const capped = (model.skipped ?? []).filter((item) => item.cap);
  if (model.kind !== "limit" || !capped.length) return undefined;
  const names = capped.map((item) => `${item.condition} (${item.case})`).join(", ");
  return `${file}:${model.threshold.rule_line}: warning: the 64-row cap skips derived cases: ${names}; examples must cover them`;
}
