// DSL L2, slice 2: what a rule means, computed in JavaScript, and the cases
// derived from it (docs/dsl-l2.md, "Boundaries").
//
// `evaluate(model, rows, params)` interprets the compiled rule over rows the
// way the generated ABAP is meant to: every row of the `for` table that meets
// `when`, every row of the `exists` table that meets `where`, one alert per
// pair. Comparisons use DDIC semantics (CHAR ignores trailing blanks, DATS /
// TIMS / NUMC compare as digit strings, INT and DEC numerically). The
// generated test class then checks that the ABAP says the same, on every
// derived case and every hand-written example; the agreement is the proof.
//
// The compiler's own word list stays empty of any domain: tables, fields and
// values arrive in the model.

export const INTEGERS = new Set(["INT1", "INT2", "INT4", "INT8"]);
export const PACKED = new Set(["DEC", "CURR", "QUAN"]);
export const INT_RANGE = {INT1: [0n, 255n], INT2: [-32768n, 32767n], INT4: [-2147483648n, 2147483647n],
  INT8: [-9223372036854775808n, 9223372036854775807n]};

// the way a type compares: char (blank-insensitive text), digits (DATS, TIMS,
// NUMC), int, dec
export function kindOf(type) {
  const b = type.built_in;
  if (INTEGERS.has(b)) return "int";
  if (PACKED.has(b)) return "dec";
  if (b === "DATS" || b === "TIMS" || b === "NUMC") return "digits";
  return "char";
}

// the text of a value as the field would hold it: 12.5 in a DEC 5,2 is 12.50,
// 007 in an INT is 7
export function canonical(type, text) {
  const kind = kindOf(type);
  if (kind === "int") return String(BigInt(text));
  if (kind === "dec") return formatDecimal(scaled(text, type.decimals ?? 0), type.decimals ?? 0);
  return text;
}

export const isOrdered = (type) => kindOf(type) !== "char";

export function initialValue(type) {
  const b = type.built_in;
  if (b === "DATS") return "00000000";
  if (b === "TIMS") return "000000";
  if (b === "NUMC") return "0".repeat(type.length ?? 1);
  if (INTEGERS.has(b)) return "0";
  if (PACKED.has(b)) return (type.decimals ?? 0) > 0 ? `0.${"0".repeat(type.decimals)}` : "0";
  return "";
}

function scaled(text, decimals) {
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  const n = BigInt(whole + fraction.padEnd(decimals, "0").slice(0, decimals));
  return negative ? -n : n;
}

function sign(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// -1, 0, 1: a compared with b under the DDIC rules of their types
export function compareValues(typeA, a, typeB, b) {
  const kind = kindOf(typeA);
  if (kind === "int") return sign(BigInt(a), BigInt(b));
  if (kind === "dec") {
    const decimals = Math.max(typeA.decimals ?? 0, typeB.decimals ?? 0);
    return sign(scaled(a, decimals), scaled(b, decimals));
  }
  if (kind === "digits" && typeA.built_in === "NUMC") {
    const length = Math.max(typeA.length ?? 0, typeB.length ?? 0);
    return sign(a.padStart(length, "0"), b.padStart(length, "0"));
  }
  return sign(a.replace(/ +$/, ""), b.replace(/ +$/, ""));
}

// how a value prints in an alert (what `&&` makes of the field)
export function render(type, value) {
  const kind = kindOf(type);
  if (kind === "char") return value.replace(/ +$/, "");
  if (kind === "int") return String(BigInt(value));
  if (kind === "dec") return formatDecimal(scaled(value, type.decimals ?? 0), type.decimals ?? 0);
  return value;
}

function formatDecimal(n, decimals) {
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(decimals + 1, "0");
  const text = decimals > 0 ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
  return negative ? `-${text}` : text;
}

// ---------------------------------------------------------------------------
// calendar arithmetic (proleptic Gregorian; days since 1970-01-01)

function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [y + (m <= 2 ? 1 : 0), m, d];
}

// one day on a DATS text, or undefined for a text that is no calendar date
// and for a step out of 0001-01-01 .. 9999-12-31
function stepDate(text, dir) {
  if (!/^[0-9]{8}$/.test(text)) return undefined;
  const y = Number(text.slice(0, 4)), m = Number(text.slice(4, 6)), d = Number(text.slice(6, 8));
  if (y < 1 || m < 1 || m > 12 || d < 1) return undefined;
  const days = daysFromCivil(y, m, d);
  const [cy, cm, cd] = civilFromDays(days);
  if (cy !== y || cm !== m || cd !== d) return undefined; // e.g. 20260231
  const [ny, nm, nd] = civilFromDays(days + dir);
  if (ny < 1 || ny > 9999) return undefined;
  return `${String(ny).padStart(4, "0")}${String(nm).padStart(2, "0")}${String(nd).padStart(2, "0")}`;
}

function stepTime(text, dir) {
  if (!/^[0-9]{6}$/.test(text)) return undefined;
  const h = Number(text.slice(0, 2)), m = Number(text.slice(2, 4)), s = Number(text.slice(4, 6));
  if (h > 23 || m > 59 || s > 59) return undefined;
  const total = h * 3600 + m * 60 + s + dir;
  if (total < 0 || total > 86399) return undefined;
  const two = (n) => String(n).padStart(2, "0");
  return `${two(Math.floor(total / 3600))}${two(Math.floor(total / 60) % 60)}${two(total % 60)}`;
}

// One step of a type from a value: a day, a second, 1, or 10^-decimals;
// undefined when the step leaves the type (255 + 1 for INT1, 99991231 + 1).
export function stepValue(type, text, dir) {
  const b = type.built_in;
  if (b === "DATS") return stepDate(text, dir);
  if (b === "TIMS") return stepTime(text, dir);
  if (b === "NUMC") {
    if (!/^[0-9]+$/.test(text)) return undefined;
    const n = BigInt(text) + BigInt(dir);
    if (n < 0n || n >= 10n ** BigInt(type.length ?? 1)) return undefined;
    return n.toString().padStart(type.length ?? 1, "0");
  }
  if (INTEGERS.has(b)) {
    const n = BigInt(text) + BigInt(dir);
    const [low, high] = INT_RANGE[b];
    return n < low || n > high ? undefined : n.toString();
  }
  if (PACKED.has(b)) {
    const decimals = type.decimals ?? 0;
    const n = scaled(text, decimals) + BigInt(dir);
    if ((n < 0n ? -n : n).toString().length > (type.length ?? 0)) return undefined;
    return formatDecimal(n, decimals);
  }
  return undefined;
}

const ORDER = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// A different text of the same length: the last character one place along.
export function bump(text, dir) {
  if (text === "") return dir > 0 ? "A" : undefined;
  const last = text.at(-1);
  const at = ORDER.indexOf(last);
  let next;
  if (at >= 0) next = ORDER[at + dir];
  else {
    const c = String.fromCharCode(last.charCodeAt(0) + dir);
    next = /[ -~]/.test(c) && c !== "'" && c !== "`" ? c : undefined;
  }
  return next === undefined ? undefined : text.slice(0, -1) + next;
}

// a value that is not `text`: one step along if the type has one, else a
// different character
export function different(type, text) {
  if (isOrdered(type)) return stepValue(type, text, 1) ?? stepValue(type, text, -1);
  return bump(text, 1) ?? bump(text, -1);
}

// a type-correct value to fill a field with, `seed` making keys differ
export function defaultValue(type, seed = 1) {
  const b = type.built_in;
  if (b === "DATS") return "20260101";
  if (b === "TIMS") return "120000";
  if (b === "NUMC") return String(seed).padStart(type.length ?? 1, "0").slice(-(type.length ?? 1));
  if (INTEGERS.has(b)) return b === "INT1" ? String(seed % 256) : String(seed);
  if (PACKED.has(b)) {
    const decimals = type.decimals ?? 0;
    return formatDecimal(BigInt(seed) * 10n ** BigInt(decimals), decimals);
  }
  if (b === "RAW") return "AB";
  const length = b === "STRG" || type.length === undefined ? 8 : type.length;
  return ("A" + String(seed).padStart(Math.max(length - 1, 0), "0")).slice(0, Math.max(length, 1));
}

// ---------------------------------------------------------------------------
// the interpreter

const lower = (rows) => Object.fromEntries(Object.entries(rows).map(([table, list]) => [table.toLowerCase(), list]));

// `rows`: {TABLE: [{field: text}]} (names in any case; a field left out is
// initial), `params`: {date: "YYYYMMDD"}. Alerts come in the order the
// generated check returns them: the `for` key, then the `exists` key.
export function evaluate(model, rows, params = {}) {
  const tables = lower(rows);
  const schema = model.ddic;
  const fieldsOf = (table) => schema[table].fields;
  const valueOf = (table, row, column) => row[column] ?? initialValue(fieldsOf(table)[column]);
  const ordered = (table) => [...(tables[table] ?? [])].sort((x, y) => {
    for (const key of schema[table].keys) {
      const c = compareValues(fieldsOf(table)[key], valueOf(table, x, key), fieldsOf(table)[key], valueOf(table, y, key));
      if (c) return c;
    }
    return 0;
  });
  const holds = (cmp, context) => {
    const left = context[cmp.alias];
    const a = valueOf(left.table, left.row, cmp.column);
    let b, typeB = cmp.type;
    if (cmp.rhs.kind === "literal") b = cmp.rhs.value;
    else if (cmp.rhs.kind === "param") {
      b = params[cmp.rhs.name];
      if (b === undefined) throw new Error(`no value for parameter $${cmp.rhs.name}`);
    } else {
      const right = context[cmp.rhs.alias];
      b = valueOf(right.table, right.row, cmp.rhs.column);
      typeB = cmp.rhs.type;
    }
    const c = compareValues(cmp.type, a, typeB, b);
    switch (cmp.op) {
      case "=": return c === 0;
      case "<>": return c !== 0;
      case "<": return c < 0;
      case ">": return c > 0;
      case "<=": return c <= 0;
      case ">=": return c >= 0;
      default: throw new Error(`operator ${cmp.op}`);
    }
  };
  const outer = model.for, inner = model.forbid;
  const alerts = [];
  for (const o of ordered(outer.table)) {
    const context = {[outer.alias]: {table: outer.table, row: o}};
    if (!model.when.conditions.every((c) => holds(c.cmp, context))) continue;
    for (const i of ordered(inner.table)) {
      context[inner.alias] = {table: inner.table, row: i};
      if (!model.forbid.conditions.every((c) => holds(c.cmp, context))) continue;
      alerts.push(model.alert.parts.map((part) => {
        if (part.is_text) return part.value;
        const at = context[part.alias];
        return render(fieldsOf(at.table)[part.column], valueOf(at.table, at.row, part.column));
      }).join(""));
    }
  }
  return alerts;
}

// ---------------------------------------------------------------------------
// derived cases

const clone = (rows) => Object.fromEntries(Object.entries(rows).map(([t, list]) => [t, list.map((r) => ({...r}))]));

// "when/1" or "forbid/where/2": the condition node of the model
export function conditionOf(model, reference) {
  const m = /^(?:(when)|forbid\/(where))\/([0-9]+)$/.exec(reference);
  if (!m) return undefined;
  const list = m[1] ? model.when.conditions : model.forbid.conditions;
  return list[Number(m[3]) - 1];
}

export function allReferences(model) {
  return [...model.when.conditions.map((_, i) => `when/${i + 1}`), ...model.forbid.conditions.map((_, i) => `forbid/where/${i + 1}`)];
}

function alertsOf(model, rows, params) {
  return evaluate(model, rows, params);
}

// One row per table that satisfies every condition, so that in the cases
// only the condition under test decides: the first example's first rows when
// they do, else rows generated from the field types. Undefined with a reason
// when the conditions cannot hold together.
function baseRows(model, params, example) {
  const fullRow = (table, given = {}) => {
    const {fields, client} = model.ddic[table];
    const row = {};
    let seed = 1;
    for (const [column, type] of Object.entries(fields)) {
      if (column === client) continue;
      row[column] = given[column] ?? defaultValue(type, seed++);
    }
    return row;
  };
  const outer = model.for, inner = model.forbid;
  if (example) {
    const rows = {[outer.table]: [fullRow(outer.table, example[outer.table]?.[0])],
      [inner.table]: [fullRow(inner.table, example[inner.table]?.[0])]};
    if (alertsOf(model, rows, params).length === 1) return {rows};
  }
  const rows = {[outer.table]: [fullRow(outer.table)], [inner.table]: [fullRow(inner.table)]};
  const solve = (alias, table, conditions) => {
    const row = rows[table][0];
    const byColumn = new Map();
    for (const c of conditions.filter((x) => x.cmp.alias === alias)) {
      if (!byColumn.has(c.cmp.column)) byColumn.set(c.cmp.column, []);
      byColumn.get(c.cmp.column).push(c.cmp);
    }
    for (const [column, list] of byColumn) {
      const type = model.ddic[table].fields[column];
      const target = (cmp) => cmp.rhs.kind === "literal" ? cmp.rhs.value : cmp.rhs.kind === "param" ? params[cmp.rhs.name]
        : rows[model.for.table][0][cmp.rhs.column] ?? initialValue(cmp.rhs.type);
      const candidates = [];
      for (const cmp of list) {
        const v = target(cmp);
        candidates.push(v, isOrdered(type) ? stepValue(type, v, 1) : bump(v, 1), isOrdered(type) ? stepValue(type, v, -1) : bump(v, -1));
      }
      candidates.push(row[column], initialValue(type));
      const ok = (value) => list.every((cmp) => {
        const c = compareValues(type, value, cmp.rhs.kind === "field" ? cmp.rhs.type : type, target(cmp));
        return {"=": c === 0, "<>": c !== 0, "<": c < 0, ">": c > 0, "<=": c <= 0, ">=": c >= 0}[cmp.op];
      });
      const pick = candidates.find((value) => value !== undefined && ok(value));
      if (pick === undefined) return `no value of ${table}-${column} satisfies ${list.map((c) => c.rhs.kind === "field" ? `${c.op} ${c.rhs.alias}.${c.rhs.column}` : `${c.op} ${target(c)}`).join(" and ")}`;
      row[column] = pick;
    }
    return undefined;
  };
  const why = solve(outer.alias, outer.table, model.when.conditions) ?? solve(inner.alias, inner.table, model.forbid.conditions);
  if (why) return {why};
  if (alertsOf(model, rows, params).length !== 1) return {why: "generated rows do not make the rule fire exactly once"};
  return {rows};
}

// After a case changed a field, the join equalities that are not under test
// hold again: the inner field takes the outer field's value.
function rejoin(model, rows, except) {
  for (const c of model.forbid.conditions) {
    if (c === except || c.cmp.rhs.kind !== "field" || c.cmp.op !== "=") continue;
    rows[model.forbid.table][0][c.cmp.column] = rows[model.for.table][0][c.cmp.rhs.column];
  }
}

// Every case for the selected conditions, in rule order:
// {method, label, kind, condition, line (the rule line of the condition),
//  date, rows, expect}. `examples` are the raw rows of the hand-written
// examples (table -> rows of the first), `date` the check date of the first.
export function deriveCases(model, references, {date, example, reserved = new Set()}) {
  const params = {date};
  const base = baseRows(model, params, example);
  if (base.why) return {cases: [], skipped: [{condition: "(all)", reason: base.why}]};
  const cases = [], skipped = [];
  const taken = new Set(reserved);
  const name = (condition, tagCandidates, suffixes, condLine) => {
    for (const tag of tagCandidates) {
      const methods = suffixes.map((s) => `b_${tag}_${s}`);
      if (methods.every((m) => m.length <= 30 && !taken.has(m))) {
        methods.forEach((m) => taken.add(m));
        return Object.fromEntries(suffixes.map((s, i) => [s, methods[i]]));
      }
    }
    throw new Error(`cannot name the cases of ${condition} (line ${condLine}) within 30 characters`);
  };
  const add = (condition, line, suffix, methods, label, rows) => {
    cases.push({method: methods[suffix], label: `${label}: ${suffix}`, kind: suffix, condition, line, date, rows,
      expect: alertsOf(model, rows, params)});
  };
  let index = 0;
  for (const reference of references) {
    index++;
    const cond = conditionOf(model, reference);
    const cmp = cond.cmp;
    const table = cmp.alias === model.for.alias ? model.for.table : model.forbid.table;
    const type = model.ddic[table].fields[cmp.column];
    const isJoin = cmp.rhs.kind === "field" && cmp.op === "=";
    const setField = (value) => {
      const rows = clone(base.rows);
      rows[table][0][cmp.column] = value;
      rejoin(model, rows, cond);
      return rows;
    };
    const reference_value = canonical(type, cmp.rhs.kind === "literal" ? cmp.rhs.value : cmp.rhs.kind === "param" ? params[cmp.rhs.name]
      : base.rows[model.for.table][0][cmp.rhs.column]);
    const columnTags = [cmp.column, `${cmp.alias}_${cmp.column}`, `c${index}`];
    let variants;
    if (isJoin) variants = [["match", reference_value], ["nomatch", different(type, reference_value)]];
    else if (isOrdered(type)) variants = [["lt", stepValue(type, reference_value, -1)], ["eq", reference_value], ["gt", stepValue(type, reference_value, 1)]];
    else variants = [["eq", reference_value], ["ne", bump(reference_value, 1) ?? bump(reference_value, -1)],
      ...(compareValues(type, "", type, reference_value) === 0 ? [] : [["blank", ""]])];
    const methods = name(cond.text, columnTags, variants.map(([s]) => s), cond.rule_line);
    for (const [suffix, value] of variants) {
      if (value === undefined) { skipped.push({condition: cond.text, reason: `no ${suffix} value: the type has no step that way`}); delete methods[suffix]; continue; }
      add(reference, cond.rule_line, suffix, methods, cond.text, setField(value));
    }
  }
  // two structural cases of the exists
  const existsTags = ["exists"];
  const structural = name(`exists ${model.forbid.table}`, existsTags, ["zero", "two"], model.forbid.exists_line);
  const zero = clone(base.rows);
  zero[model.forbid.table] = [];
  add("forbid", model.forbid.exists_line, "zero", structural, `exists ${model.forbid.table.toUpperCase()} as ${model.forbid.alias}`, zero);
  const two = clone(base.rows);
  const fixed = new Set(model.forbid.conditions.filter((c) => c.cmp.op === "=").map((c) => c.cmp.column));
  const inner = model.ddic[model.forbid.table];
  const key = inner.keys.find((k) => !fixed.has(k));
  const second = {...two[model.forbid.table][0]};
  const next = key === undefined ? undefined : different(inner.fields[key], second[key]);
  if (next === undefined) skipped.push({condition: `exists ${model.forbid.table}`, reason: "every key field of the exists table is fixed by an equality; no second row"});
  else {
    second[key] = next;
    two[model.forbid.table].push(second);
    add("forbid", model.forbid.exists_line, "two", structural, `exists ${model.forbid.table.toUpperCase()} as ${model.forbid.alias}`, two);
  }
  return {cases, skipped};
}
