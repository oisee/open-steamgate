// DSL L2: range parameters (docs/dsl-l2.md, "Slice 8"). A parameter of `range: true` is a
// selection table of its type; a condition says `field in $name` or `field not in $name`.
// This module holds what the compiler (tools/dsl-l2.mjs, tools/dsl-l2-params.mjs), the
// interpreter and the case derivation (tools/dsl-l2-eval.mjs) share about such a table:
// its rows, how Open SQL reads them, the comparison on it, the mutants of that comparison
// and the values a derived case tries.
import {compareValues} from "./dsl-l2-values.mjs";

const RANGE_KEYS = ["sign", "option", "low", "high"];
const SIGNS = ["I", "E"];
const OPTIONS = ["EQ", "BT"];
const CHAR1 = {built_in: "CHAR", length: 1};
const CHAR2 = {built_in: "CHAR", length: 2};
const INVERT = {"IN": "NOT IN", "NOT IN": "IN"};

// Open SQL's reading of a selection table: a value is in it when it meets some I row (every
// value, when there is no I row) and no E row; an empty table is every value. `NOT IN` is the
// negation of the whole, so against an empty table it holds for no value.
export function inSelection(rows, type, value) {
  if (!rows?.length) return true;
  const meets = (r) => {
    const low = compareValues(type, value, type, r.low);
    return r.option === "EQ" ? low === 0 : low >= 0 && compareValues(type, value, type, r.high) <= 0;
  };
  const included = rows.filter((r) => r.sign !== "E");
  return (included.length === 0 || included.some(meets)) && !rows.some((r) => r.sign === "E" && meets(r));
}

// a range row node (or a row) as the plain SELECT-OPTIONS row
export const plainRow = (node) => ({sign: node.sign, option: node.option, low: node.low, ...(node.high !== undefined ? {high: node.high} : {})});

// `field in $range` / `field not in $range` for the field value `value`. `rhs.exclusions_ignored`
// and `rhs.empty_is_none` are the mutants of the discriminate guard: a translation that drops the
// E rows, and one that reads an empty table as no value.
export function holdsRange(cmp, value, params) {
  let rows = params[cmp.rhs.name] ?? [];
  if (cmp.rhs.exclusions_ignored) rows = rows.filter((r) => r.sign !== "E");
  const inside = !rows.length && cmp.rhs.empty_is_none ? false : inSelection(rows, cmp.type, value);
  return cmp.op === "IN" ? inside : !inside;
}

// the variants of a comparison a translation could get wrong: the range ignored (always true,
// always false), in turned into not in and back, the E rows dropped, an empty table read as no value
export function rangeMutants(cond) {
  const cmp = cond.cmp;
  return [{...cond, constant: true}, {...cond, constant: false}, {...cond, cmp: {...cmp, op: INVERT[cmp.op]}},
    {...cond, cmp: {...cmp, rhs: {...cmp.rhs, exclusions_ignored: true}}}, {...cond, cmp: {...cmp, rhs: {...cmp.rhs, empty_is_none: true}}}];
}

// The values a derived case tries for a range comparison: [suffix, value, given] for a value in the
// table, one outside it, the table emptied for this case (with a value the full table did not hold)
// and an E row added for the value that was in. `given` is the table the case sets for itself.
export function rangeVariants({name, rows, type, current, around, fallbacks, canonical}) {
  const bounds = rows.flatMap((r) => [r.low, ...(r.high === undefined ? [] : [r.high])]);
  const pool = [...bounds.flatMap(around), current, ...fallbacks].map((v) => v === undefined ? v : canonical(type, v));
  const pick = (want) => pool.find((v) => v !== undefined && inSelection(rows, type, v) === want);
  const member = pick(true), other = pick(false);
  return [["in", member], ["out", other], ...(rows.length ? [["empty", other ?? member, {name, rows: []}]] : []),
    ...(member !== undefined ? [["excl", member, {name, rows: [...rows, {sign: "E", option: "EQ", low: member}]}]] : [])];
}

// `value` at `path`: [{sign, option, low, high?}] and the same as L1 nodes. Rows are given as
// {sign, option, low, high}, or as bare values, each I EQ; sign I or E, option EQ or BT.
export function selectRows({value, path, nodeId, line, failAt, need, misfit, type, text}) {
  need(value, path, "a list of rows ({sign, option, low, high}) or of values (each I EQ)", "list");
  const rows = [], nodes = [];
  value.forEach((entry, n) => {
    const at = `${path}/${n}`;
    let row;
    if (typeof entry === "string") row = {sign: "I", option: "EQ", low: entry};
    else {
      need(entry, at, "a value or a mapping with sign, option, low and, for BT, high", "map");
      for (const key of Object.keys(entry)) if (!RANGE_KEYS.includes(key)) failAt(line(`${at}/${key}`))(`unknown range key ${key} (${RANGE_KEYS.join(", ")})`);
      row = {sign: entry.sign ?? "I", option: entry.option ?? "EQ", low: entry.low, ...(entry.high !== undefined ? {high: entry.high} : {})};
    }
    if (!SIGNS.includes(row.sign)) failAt(line(`${at}/sign`))(`unknown sign ${JSON.stringify(row.sign)} (${SIGNS.join(" or ")})`);
    if (!OPTIONS.includes(row.option)) failAt(line(`${at}/option`))(`unknown option ${JSON.stringify(row.option)} (${OPTIONS.join(" or ")})`);
    if (row.option === "EQ" && row.high !== undefined) failAt(line(`${at}/high`))("an EQ range row has no high");
    for (const key of row.option === "BT" ? ["low", "high"] : ["low"]) {
      if (typeof row[key] !== "string") failAt(line(`${at}/${key}`))(`a range row needs ${key}, a value`);
      const why = misfit(row[key], type);
      if (why) failAt(line(`${at}/${key}`))(`range ${key} must fit ${text}: ${why}`);
    }
    if (row.option === "BT" && compareValues(type, row.low, type, row.high) > 0) failAt(line(`${at}/high`))(`range row is BT from ${row.low} to ${row.high}: low is above high, which matches nothing`);
    rows.push(row);
    nodes.push(rowNode(`${nodeId}/${n + 1}`, line(at), row, type));
  });
  return {rows, nodes};
}

const rowNode = (id, ruleLine, row, type) => ({"@id": id, rule_line: ruleLine, sign: row.sign, "sign@type": CHAR1, option: row.option, "option@type": CHAR2,
  low: row.low, "low@type": type, ...(row.high !== undefined ? {high: row.high, "high@type": type} : {})});

// an argument of a test method that passes a range parameter: the call names `var`, the method builds it from `rows`
const argNode = (id, ruleLine, parameter, rows) => ({"@id": id, rule_line: ruleLine, ref: parameter.ref, is_selopt: true,
  var: `lt_p_${parameter.name}`, row: parameter.row, selopt_type: parameter.selopt_type, rows});

// an example's value for a range parameter: its own rows (an argument of its test methods), else the rule's default
export function exampleSelopt({parameter, given, at, exampleId, line, failAt, need, misfit, typeText}) {
  if (given === undefined) return {rows: (parameter.default_rows ?? []).map(plainRow)};
  const chosen = selectRows({value: given, path: at, nodeId: `${exampleId}/param/${parameter.name}`, line, failAt, need, misfit, type: parameter.type,
    text: typeText(parameter.type)});
  return {rows: chosen.rows, arg: argNode(`${exampleId}/param/${parameter.name}`, line(at), parameter, chosen.nodes)};
}

// the argument of a derived case that sets a range parameter for itself
export function caseSelopt({parameter, id, ruleLine, rows}) {
  const argId = `${id}/param/${parameter.name}`;
  return argNode(argId, ruleLine, parameter, rows.map((row, n) => rowNode(`${argId}/${n + 1}`, ruleLine, row, parameter.type)));
}

// `field in $name`, `field not in $name`: the comparison's L1 node. `fieldOf` resolves the field, `fail` raises at the comparison's line.
export function inComparison({left, op, right, written, params, current, fieldOf, scope, fail, nodeId, ruleLine, typeText}) {
  if (!(left.kind === "field" && left.alias === current.alias)) fail(`${written} must name a field of ${current.alias} on the left of ${op.toLowerCase()}`);
  if (right.name === "date") fail(`${written}: $date is a date, not a range`);
  const parameter = params.get(right.name);
  if (!parameter.is_selopt) fail(`${written}: $${right.name} is not a range parameter (declare it with range: true)`);
  const type = fieldOf(left, scope, fail).field.literal;
  if (type.built_in !== parameter.type.built_in || type.length !== parameter.type.length || type.decimals !== parameter.type.decimals) {
    fail(`${left.text} is ${typeText(type)}, $${right.name} is a range of ${typeText(parameter.type)}`);
  }
  const column = fieldOf(left, scope, fail).field.column;
  return {"@id": nodeId, rule_line: ruleLine, column, op, "@type": type, text: written, lhs: `${left.alias}~${column}`,
    is_literal: false, ref: parameter.use, sref: parameter.use, param_line: parameter.rule_line,
    cmp: {alias: left.alias, column, op, type, rhs: {kind: "range", name: right.name}}};
}

// the reviewer's line for a range argument of a case
export const describeSelopt = (arg) => `  $${arg.ref.slice(3)}: ${arg.rows.length ? arg.rows.map((r) => `${r.sign} ${r.option} ${r.low}${r.high ? `..${r.high}` : ""}`).join(", ") : "(empty table)"}`;
