// DSL L2: the optional key range of a rule's driving table (docs/dsl-l2.md,
// "Optional driving-key range"). `range: <for alias>.<field>` gives the
// generated check an `it_range` (a RANGE OF <for table>-<field>, OPTIONAL);
// the query that reads the for table carries `<alias>~<field> IN it_range` as
// one more conjunct of its WHERE (tools/dsl-l2.mjs, `ranged`), so the range is
// tested by the database and never in an ABAP loop. An empty range is every
// row, as Open SQL has it. An example may give a range of its own:
// `range: [{sign: I, option: BT, low: S002, high: S003}]` (sign I, option EQ
// with low, or BT with low and high).

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
export function inRange(rows, type, value, compareValues) {
  if (!rows?.length) return true;
  return rows.some((r) => {
    const low = compareValues(type, value, type, r.low);
    return r.option === "EQ" ? low === 0 : low >= 0 && compareValues(type, value, type, r.high) <= 0;
  });
}
