// DSL L2: the optional key range of a rule's driving table (docs/dsl-l2.md,
// "Optional driving-key range"). `range: <for alias>.<field>` gives the
// generated check an `it_range` (a RANGE OF <for table>-<field>, OPTIONAL);
// the query that reads the for table carries `<alias>~<field> IN it_range` as
// one more conjunct of its WHERE (tools/dsl-l2.mjs, `ranged`), so the range is
// tested by the database and never in an ABAP loop. An empty range is every
// row, as Open SQL has it. An example may give a range of its own:
// `range: [{sign: I, option: BT, low: S002, high: S003}]` (sign I, option EQ
// with low, or BT with low and high).

import {inSelection} from "./dsl-l2-selopt.mjs";

const RANGE_KEYS = ["sign", "option", "low", "high"];

// the rule's `range:` line, read against the for source: undefined without one
export function compileRange({doc, outer, id, line, failAt, need}) {
  if (doc.range === undefined) return undefined;
  const value = need(doc.range, "range", "<for alias>.<field>");
  const match = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/.exec(value);
  if (!match || match[1] !== outer.alias) failAt(line("range"))(`range must name a field of the for alias ${outer.alias}`);
  const field = outer.info.fields.get(match[2]);
  if (!field || field.literal.resolved === false) failAt(line("range"))(`range field ${value} is not a resolved field of ${outer.table}`);
  const range = {"@id": `${id}/range`, rule_line: line("range"), alias: outer.alias, field: match[2], table: outer.table.toLowerCase(),
    source: `${outer.alias}~${match[2]}`};
  // the field's type, for the examples' values; not part of the model
  Object.defineProperty(range, "type", {value: field.literal});
  return range;
}

// an example's own range: [] when it gives none (every row)
export function exampleRange({example, base, range, exampleId, line, failAt, need, misfit, table}) {
  if (example.range === undefined) return [];
  if (!range) failAt(line(`${base}/range`))("an example range needs a range: line in the rule");
  return need(example.range, `${base}/range`, "a list of select-option rows", "list").map((entry, n) => {
    const at = `${base}/range/${n}`;
    need(entry, at, "a mapping with sign, option, low and, for BT, high", "map");
    for (const key of Object.keys(entry)) if (!RANGE_KEYS.includes(key)) failAt(line(`${at}/${key}`))(`unknown range key ${key} (${RANGE_KEYS.join(", ")})`);
    if (entry.sign !== "I" || !["EQ", "BT"].includes(entry.option)) failAt(line(at))("a range row is sign I with option EQ or BT");
    if (entry.option === "EQ" && entry.high !== undefined) failAt(line(`${at}/high`))("an EQ range row has no high");
    for (const key of entry.option === "BT" ? ["low", "high"] : ["low"]) {
      if (typeof entry[key] !== "string" || misfit(entry[key], range.type)) failAt(line(`${at}/${key}`))(`range ${key} must fit ${table}-${range.field}`);
    }
    return {"@id": `${exampleId}/range/${n + 1}`, rule_line: line(at), sign: entry.sign, "sign@type": {built_in: "CHAR", length: 1},
      option: entry.option, "option@type": {built_in: "CHAR", length: 2}, low: entry.low, "low@type": range.type,
      ...(entry.high !== undefined ? {high: entry.high, "high@type": range.type} : {})};
  });
}

// the interpreter's reading of the same range: does `value` (of `type`) lie in it
export function inRange(rows, type, value) {
  return inSelection(rows, type, value);
}

// ---------------------------------------------------------------------------
// keys: true (docs/dsl-l2.md, "Keys"): a rule with a range: may also hand back
// the driving keys it flags, `keys( iv_date, it_range, <params> ) RETURNING
// rt_keys` (a RANGE OF the range field, I EQ, sorted, one row per key). It is
// the check's own query with the key field only, DISTINCT; an L3 filter stage
// fills a worklist with it (docs/dsl-l3.md, "Stages, filters and a schedule").

const STRG = {built_in: "STRG"};

// the rule's `keys:` line: undefined without one (or with keys: false)
export function compileKeys({doc, range, kind, id, line, failAt}) {
  if (doc.keys === undefined) return undefined;
  if (doc.keys !== "true" && doc.keys !== "false") failAt(line("keys"))(`keys is true or false, not ${JSON.stringify(doc.keys)}`);
  if (doc.keys === "false") return undefined;
  if (!range) failAt(line("keys"))("keys: true needs a range: line; the keys are values of the range field");
  if (kind === "limit") failAt(line("keys"))("keys: true is for a forbid: or require: rule; a limit: rule decides its threshold in ABAP over the ordered rows, so its keys are not one SELECT DISTINCT");
  return {"@id": `${id}/keys`, rule_line: line("keys"), table: range.table, field: range.field, source: range.source};
}

// the interpreter's keys: the alert of every flagged row replaced by its
// driving key, so every kind of rule answers through the one evaluator
export function ruleKeys(model, rows, params, evaluate, compareValues) {
  const part = {alias: model.for.alias, column: model.range.field};
  const swap = (owner) => owner?.alert ? {...owner, alert: {...owner.alert, parts: [part]}} : owner;
  const type = model.range.type ?? model.ddic[model.range.table].fields[model.range.field];
  return [...new Set(evaluate({...swap(model), clauses: model.clauses.map(swap)}, rows, params))]
    .sort((a, b) => compareValues(type, a, type, b));
}

// what a test of a keys rule asserts about keys( ): `given` (an example's
// expect_keys, checked against the interpreter here) or the interpreter's own answer
export function keysCheck({model, keys, rows, params, given, at, line, failAt, evaluate, compareValues, testId, label}) {
  if (!keys) {
    if (given !== undefined) failAt(line(at))("expect_keys needs keys: true in the rule");
    return undefined;
  }
  const got = ruleKeys(model, rows, params, evaluate, compareValues);
  if (given !== undefined) {
    if (!Array.isArray(given) || given.some((k) => typeof k !== "string")) failAt(line(at))("expect_keys is a list of key values");
    if (JSON.stringify(given) !== JSON.stringify(got)) failAt(line(at))(`expect_keys ${JSON.stringify(given)}, but the rule flags ${JSON.stringify(got)} (sorted, each once)`);
  }
  const ruleLine = given !== undefined ? line(at) : keys.rule_line;
  return {"@id": `${testId}/keys`, rule_line: ruleLine, call: `${model.class}=>keys`, label: `${label} (keys)`, "label@type": STRG,
    values: got.map((value, k) => ({"@id": `${testId}/keys/${k + 1}`, rule_line: ruleLine, value, "value@type": model.range.type}))};
}
