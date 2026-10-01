// DSL L2, slices 2 and 3: what a rule means, computed in JavaScript, and the
// cases derived from it (docs/dsl-l2.md, "Boundaries").
//
// `evaluate(model, rows, params)` interprets the compiled rule over rows the
// way the generated ABAP is meant to: every row of the `for` table that meets
// `when`, then per the rule's kind the rows of its exists clauses that meet
// their `where` (forbid: one alert per match; all: per combination; any: per
// match of each clause; require: one alert when nothing matches). Conditions
// are trees of and / or / not over comparisons. Comparisons use DDIC semantics (CHAR ignores trailing blanks, DATS /
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
  if (type.built_in === "NUMC" && /^[0-9]*$/.test(text)) return text.padStart(type.length ?? 1, "0");
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

// A condition is a tree over the comparisons of its list: {op: "cmp", index}
// names `leaves[index]`; "and" and "or" hold `items`, "not" one `item`. A
// leaf with `constant` set (a mutant of the discriminate guard) is that value.
// Two-valued logic is enough: a field is never NULL here (every row is
// written by an ABAP INSERT, which fills every column, and every join is an
// INNER JOIN), so NOT is plain negation.
function holdsTree(tree, leaves, holds) {
  switch (tree.op) {
    case "cmp": {
      const leaf = leaves[tree.index];
      return leaf.constant !== undefined ? leaf.constant : holds(leaf.cmp);
    }
    case "and": return tree.items.every((item) => holdsTree(item, leaves, holds));
    case "or": return tree.items.some((item) => holdsTree(item, leaves, holds));
    case "not": return !holdsTree(tree.item, leaves, holds);
    default: throw new Error(`condition node ${tree.op}`);
  }
}

// `rows`: {TABLE: [{field: text}]} (names in any case; a field left out is
// initial), `params`: {date: "YYYYMMDD"}. Alerts come in the order the
// generated check returns them:
//   forbid (one exists, or all:)  the `for` key, then each exists key in turn;
//   forbid any:                    clause by clause, each by the `for` key and its own key;
//   require:                       the `for` key.
// `override` ({<clause index>: true | false}) replaces a clause by one that
// always matches (a row of initial values) or never does: the structural
// mutants of the discriminate guard.
export function evaluate(model, rows, params = {}, override = {}) {
  const tables = lower(rows);
  const schema = model.ddic;
  const fieldsOf = (table) => schema[table].fields;
  const valueOf = (table, row, column) => canonical(fieldsOf(table)[column], row[column] ?? initialValue(fieldsOf(table)[column]));
  const ordered = (table) => [...(tables[table] ?? [])].sort((x, y) => {
    for (const key of schema[table].keys) {
      const c = compareValues(fieldsOf(table)[key], valueOf(table, x, key), fieldsOf(table)[key], valueOf(table, y, key));
      if (c) return c;
    }
    return 0;
  });
  const holdsIn = (context) => (cmp) => {
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
    return test(cmp.op, compareValues(cmp.type, a, typeB, b));
  };
  const outer = model.for;
  const whenHolds = (context) => !model.when.tree || holdsTree(model.when.tree, model.when.conditions, holdsIn(context));
  // the rows of a clause that match it for the `for` row in `context`
  const matching = (clause, c, context) => {
    if (override[c] === true) return [{}];
    if (override[c] === false) return [];
    return ordered(clause.table).filter((row) =>
      holdsTree(clause.tree, clause.conditions, holdsIn({...context, [clause.alias]: {table: clause.table, row}})));
  };
  const alertOf = (parts, context) => parts.map((part) => {
    if (part.is_text) return part.value;
    if (part.is_count) return String(context.$count);
    const at = context[part.alias];
    return render(fieldsOf(at.table)[part.column], valueOf(at.table, at.row, part.column));
  }).join("");
  const alerts = [];
  const each = (visit) => {
    for (const o of ordered(outer.table)) {
      const context = {[outer.alias]: {table: outer.table, row: o}};
      if (whenHolds(context)) visit(context);
    }
  };
  if (model.kind === "limit") {
    const clause = model.clauses[0];
    each((context) => {
      const count = matching(clause, 0, context).length;
      if (test(model.threshold.op, Math.sign(count - model.threshold.value))) {
        alerts.push(alertOf(model.alert.parts, {...context, $count: count}));
      }
    });
  } else if (model.kind === "require") {
    const clause = model.clauses[0];
    each((context) => {
      if (!matching(clause, 0, context).length) alerts.push(alertOf(model.alert.parts, context));
    });
  } else if (model.combine === "any") {
    model.clauses.forEach((clause, c) => each((context) => {
      for (const row of matching(clause, c, context)) {
        alerts.push(alertOf(clause.alert.parts, {...context, [clause.alias]: {table: clause.table, row}}));
      }
    }));
  } else {
    each((context) => {
      const walk = (c, ctx) => {
        if (c === model.clauses.length) { alerts.push(alertOf(model.alert.parts, ctx)); return; }
        const clause = model.clauses[c];
        for (const row of matching(clause, c, ctx)) walk(c + 1, {...ctx, [clause.alias]: {table: clause.table, row}});
      };
      walk(0, context);
    });
  }
  return alerts;
}

function test(op, c) {
  switch (op) {
    case "=": return c === 0;
    case "<>": return c !== 0;
    case "<": return c < 0;
    case ">": return c > 0;
    case "<=": return c <= 0;
    case ">=": return c >= 0;
    default: throw new Error(`operator ${op}`);
  }
}

// ---------------------------------------------------------------------------
// derived cases

const clone = (rows) => Object.fromEntries(Object.entries(rows).map(([t, list]) => [t, list.map((r) => ({...r}))]));

// every comparison of the rule: the `when` ones, then each clause's
const leavesOf = (model) => [...model.when.conditions, ...model.clauses.flatMap((c) => c.conditions)];

// "when/1", "forbid/where/2", "forbid/all/2/where/1", "require/where/1": the
// comparison node of the model whose @id ends so
export function conditionOf(model, reference) {
  return leavesOf(model).find((leaf) => leaf["@id"] === `${model["@id"]}/${reference}`);
}

export function allReferences(model) {
  return leavesOf(model).map((leaf) => leaf["@id"].slice(model["@id"].length + 1));
}

// the tree a comparison belongs to: the `when`, or a clause's `where`
function ownerOf(model, cond) {
  const at = model.when.conditions.indexOf(cond);
  if (at >= 0) return {when: true, table: model.for.table, alias: model.for.alias, tree: model.when.tree, leaves: model.when.conditions, index: at, slot: 0};
  for (const clause of model.clauses) {
    const i = clause.conditions.indexOf(cond);
    if (i >= 0) return {when: false, clause, table: clause.table, alias: clause.alias, tree: clause.tree, leaves: clause.conditions, index: i, slot: slotOf(clause)};
  }
  throw new Error(`internal: ${cond.text} is in no condition of the rule`);
}

const INVERT = {"=": "<>", "<>": "=", "<": ">=", ">=": "<", ">": "<=", "<=": ">"};
const LIMIT = 64; // alternatives kept per tree; a rule this wide gets fewer derived cases, never wrong ones

const product = (lists) => lists.reduce((acc, list) => acc.flatMap((a) => list.map((b) => [...a, ...b])).slice(0, LIMIT), [[]]);
const union = (lists) => lists.flat().slice(0, LIMIT);

// The ways a tree can come out `want`: a list of alternatives, each a list
// of comparisons (a negated one with its operator inverted) that together
// force it. Values that satisfy one alternative make the tree `want`.
function alternatives(tree, leaves, want) {
  switch (tree.op) {
    case "cmp": {
      const leaf = leaves[tree.index];
      if (leaf.constant !== undefined) return leaf.constant === want ? [[]] : [];
      return [[want ? leaf.cmp : {...leaf.cmp, op: INVERT[leaf.cmp.op]}]];
    }
    case "not": return alternatives(tree.item, leaves, !want);
    case "and": return want ? product(tree.items.map((x) => alternatives(x, leaves, true))) : union(tree.items.map((x) => alternatives(x, leaves, false)));
    case "or": return want ? union(tree.items.map((x) => alternatives(x, leaves, true))) : product(tree.items.map((x) => alternatives(x, leaves, false)));
    default: throw new Error(`condition node ${tree.op}`);
  }
}

// The alternatives under which the comparison `target` alone decides the
// tree: along its path every sibling under an `and` holds, every sibling
// under an `or` does not; a `not` passes the decision through (and flips it).
function sensitize(tree, leaves, target) {
  if (tree.op === "cmp") return tree.index === target ? [[]] : undefined;
  if (tree.op === "not") return sensitize(tree.item, leaves, target);
  for (const [i, item] of tree.items.entries()) {
    const inner = sensitize(item, leaves, target);
    if (!inner) continue;
    return product([inner, ...tree.items.filter((_, j) => j !== i).map((x) => alternatives(x, leaves, tree.op === "and"))]);
  }
  return undefined;
}

// Gives the fields of `table` that `cmps` constrain values that satisfy them
// (the row's other fields stay); a reason when none does. `cmps` is one
// alternative: comparisons that must all hold.
function solveRow(model, params, rows, alias, table, cmps, keep = false, slot = 0) {
  const row = rows[table][slot];
  const byColumn = new Map();
  for (const cmp of cmps.filter((x) => x.alias === alias)) {
    if (!byColumn.has(cmp.column)) byColumn.set(cmp.column, []);
    byColumn.get(cmp.column).push(cmp);
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
    if (keep) candidates.unshift(row[column]);
    candidates.push(row[column], initialValue(type));
    const ok = (value) => list.every((cmp) => test(cmp.op, compareValues(type, value, cmp.rhs.kind === "field" ? cmp.rhs.type : type, target(cmp))));
    const pick = candidates.find((value) => value !== undefined && ok(value));
    if (pick === undefined) return `no value of ${table}-${column} satisfies ${list.map((c) => c.rhs.kind === "field" ? `${c.op} ${c.rhs.alias}.${c.rhs.column}` : `${c.op} ${target(c)}`).join(" and ")}`;
    row[column] = pick;
  }
  return undefined;
}

// The first alternative that a row of `table` can be made to satisfy.
function solveAlternatives(model, params, rows, alias, table, alts, keep, slot = 0) {
  if (!rows[table]?.[slot]) return undefined;
  let why = "the condition cannot hold";
  for (const alt of alts) {
    const trial = clone(rows);
    why = solveRow(model, params, trial, alias, table, alt, keep, slot);
    if (!why) { rows[table][slot] = trial[table][slot]; return undefined; }
  }
  return why;
}

const treeAlternatives = (tree, leaves) => tree ? alternatives(tree, leaves, true) : [[]];

// every clause row made to match again (keep the values that already do)
function resolveClauses(model, params, rows, except, keep) {
  for (const clause of model.clauses) {
    if (clause === except) continue;
    solveAlternatives(model, params, rows, clause.alias, clause.table, treeAlternatives(clause.tree, clause.conditions), keep, slotOf(clause));
  }
}

// A clause's own row in its table: 0, or 1 for the second of two `any`
// clauses that read one table (each clause gets a row of its own).
const slotOf = (clause) => clause.slot ?? 0;

// whether the rows of every table have different keys (an INSERT of the
// test would refuse two rows with the same one)
function keysDistinct(model, rows) {
  return Object.entries(rows).every(([table, list]) => {
    const {keys, fields} = model.ddic[table];
    const seen = new Set(list.map((row) => JSON.stringify(keys.map((k) => canonical(fields[k], row[k] ?? initialValue(fields[k]))))));
    return seen.size === list.length;
  });
}

// whether every tree of the rule holds: `when` on the `for` row, each
// clause's `where` on that row and the clause's own row
function allHold(model, rows, params) {
  const outer = rows[model.for.table]?.[0];
  if (!outer) return false;
  const probe = {...model, kind: "forbid", combine: "all", clauses: [], alert: {parts: []}};
  if (evaluate(probe, {[model.for.table]: [outer]}, params).length !== 1) return false;
  return model.clauses.every((clause) => {
    const row = rows[clause.table]?.[slotOf(clause)];
    return row !== undefined && evaluate({...probe, clauses: [clause]}, {[model.for.table]: [outer], [clause.table]: [row]}, params).length === 1;
  }) && keysDistinct(model, rows);
}

// One row per table on which every condition holds, so that in the cases only
// the condition under test decides: the first example's first rows when they
// do, else rows generated from the field types. Undefined with a reason when
// the conditions cannot hold together.
function baseRows(model, params, example) {
  const fullRow = (table, given = {}, slot = 0) => {
    const {fields, client} = model.ddic[table];
    const row = {};
    let seed = 1 + 50 * slot;
    for (const [column, type] of Object.entries(fields)) {
      if (column === client) continue;
      row[column] = canonical(type, given[column] ?? defaultValue(type, seed++));
    }
    return row;
  };
  const rowsFrom = (given) => {
    const rows = {[model.for.table]: [fullRow(model.for.table, given?.[model.for.table]?.[0])]};
    for (const clause of model.clauses) {
      rows[clause.table] ??= [];
      rows[clause.table][slotOf(clause)] = fullRow(clause.table, given?.[clause.table]?.[slotOf(clause)], slotOf(clause));
    }
    return rows;
  };
  if (example) {
    const rows = rowsFrom(example);
    if (allHold(model, rows, params)) return {rows};
  }
  const generated = rowsFrom(undefined);
  let why = "no value satisfies the when";
  for (const alt of treeAlternatives(model.when.tree, model.when.conditions)) {
    const rows = clone(generated);
    why = solveRow(model, params, rows, model.for.alias, model.for.table, alt);
    if (why) continue;
    for (const clause of model.clauses) {
      why = solveAlternatives(model, params, rows, clause.alias, clause.table, treeAlternatives(clause.tree, clause.conditions), false, slotOf(clause));
      if (why) break;
    }
    if (!why && allHold(model, rows, params)) return {rows};
    why ??= "generated rows do not make every condition hold";
  }
  return {why};
}

// After a case changed a field, the join equalities that are not under test
// hold again, and the tested value stays: a changed exists field is followed
// by the `for` field of each equality on it; every other exists row then
// follows the `for` row (the other row is adjusted, the value under test is not).
function rejoin(model, rows, except, changedClause, changedColumn) {
  const outer = rows[model.for.table][0];
  const byInner = [], byOuter = [];
  for (const clause of model.clauses) {
    const inner = rows[clause.table]?.[slotOf(clause)];
    if (!inner) continue;
    for (const c of clause.on) {
      if (c === except) continue;
      (clause === changedClause && c.cmp.column === changedColumn ? byInner : byOuter).push([inner, c]);
    }
  }
  for (const [inner, c] of byInner) outer[c.cmp.rhs.column] = inner[c.cmp.column];
  for (const [inner, c] of byOuter) inner[c.cmp.column] = outer[c.cmp.rhs.column];
}

const OPERATORS = ["=", "<>", "<", ">", "<=", ">="];

// the model with one comparison replaced by `leaf` (the tree keeps its shape)
function withCondition(model, cond, leaf) {
  const swap = (list) => list.map((c) => c === cond ? leaf : c);
  return {...model, when: {...model.when, conditions: swap(model.when.conditions)},
    clauses: model.clauses.map((clause) => ({...clause, conditions: swap(clause.conditions)}))};
}

// the variants of a comparison a translation could get wrong: always true
// (dropped from a conjunction), always false (dropped from a disjunction),
// every other operator, the literal or parameter one step either way
function mutantsOf(cond, params) {
  const cmp = cond.cmp;
  const out = [{...cond, constant: true}, {...cond, constant: false},
    ...OPERATORS.filter((op) => op !== cmp.op).map((op) => ({...cond, cmp: {...cmp, op}}))];
  if (cmp.rhs.kind !== "field") {
    const value = cmp.rhs.kind === "literal" ? cmp.rhs.value : params[cmp.rhs.name];
    for (const dir of [-1, 1]) {
      const shifted = isOrdered(cmp.type) ? stepValue(cmp.type, value, dir) : bump(value, dir);
      if (shifted !== undefined) out.push({...cond, cmp: {...cmp, rhs: {kind: "literal", value: shifted}}});
    }
  }
  return out;
}

// A case discriminates when some mutant of the condition it targets gives
// other alerts on its rows than the rule does: otherwise it would pass
// whether the translation of that condition is right or wrong.
export function caseDiscriminates(model, cond, rows, params) {
  const expected = JSON.stringify(evaluate(model, rows, params));
  return mutantsOf(cond, params).some((leaf) => JSON.stringify(evaluate(withCondition(model, cond, leaf), rows, params)) !== expected);
}

// The same for a structural case: some clause replaced by one that always
// matches or by one that never does changes its alerts.
export function structureDiscriminates(model, rows, params) {
  const expected = JSON.stringify(evaluate(model, rows, params));
  return model.clauses.some((_, c) => [true, false].some((value) =>
    JSON.stringify(evaluate(model, rows, params, {[c]: value})) !== expected));
}

// Add matching rows by varying a counted-table key. The interpreter checks
// the resulting count, so a constrained key or a short key cannot fake a case.
export const COUNT_ROW_CAP = 64;

function countTo(model, rows, wanted, params) {
  const clause = model.clauses[0];
  const table = clause.table;
  if (wanted === 0) { rows[table] = []; return true; }
  if (wanted > COUNT_ROW_CAP) return false;
  const count = () => Number(evaluate({...model, threshold: {op: ">", value: 0}, alert: {parts: [{is_count: true}]}}, rows, params)[0] ?? 0);
  if (count() !== 1) return false;
  const base = {...rows[table][0]};
  for (let i = 1; i < wanted; i++) {
    let added = false;
    for (const key of model.ddic[table].keys) {
      const type = model.ddic[table].fields[key];
      for (let seed = i + 100; seed < i + 300; seed++) {
        const value = defaultValue(type, seed);
        const row = {...base, [key]: value};
        rows[table].push(row);
        if (keysDistinct(model, rows) && count() === i + 1) { added = true; break; }
        rows[table].pop();
      }
      if (added) break;
    }
    if (!added) return false;
  }
  return true;
}

export function thresholdDiscriminates(model, rows, params) {
  const expected = JSON.stringify(evaluate(model, rows, params));
  const {op, value} = model.threshold;
  return [{op: op === ">" ? ">=" : ">", value}, {op, value: value - 1}, {op, value: value + 1}]
    .some((threshold) => JSON.stringify(evaluate({...model, threshold}, rows, params)) !== expected);
}

// Every case for the selected conditions, in rule order, then the structural
// cases of the clauses: {method, label, kind, condition, line (the rule line
// of the condition or clause), date, rows, expect, structural}. `example` is
// the raw rows of the first hand-written example, `date` its check date.
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
  const add = (condition, line, suffix, methods, label, rows, structural = false) => {
    if (!keysDistinct(model, rows)) {
      skipped.push({condition: `${label} (${suffix})`, reason: "its rows would share a key"});
      return;
    }
    cases.push({method: methods[suffix], label: `${label}: ${suffix}`, kind: suffix, condition, line, date, rows,
      expect: evaluate(model, rows, params), structural});
  };
  let index = 0;
  for (const reference of references) {
    index++;
    const cond = conditionOf(model, reference);
    const cmp = cond.cmp;
    const owner = ownerOf(model, cond);
    const table = owner.table;
    const type = model.ddic[table].fields[cmp.column];
    const isJoin = !owner.when && owner.clause.on.includes(cond);
    // rows in which this comparison alone decides its tree, and every other
    // tree holds; under require a `when` decides only when no exists row is there
    const start = clone(base.rows);
    if (owner.when && model.kind === "require") for (const clause of model.clauses) start[clause.table] = [];
    const why = solveAlternatives(model, params, start, owner.alias, owner.table, sensitize(owner.tree, owner.leaves, owner.index), true, owner.slot);
    const columnTags = [cmp.column, `${cmp.alias}_${cmp.column}`, `c${index}`];
    if (why) {
      skipped.push({condition: cond.text, reason: `does not isolate ${cond.text}: ${why}`});
      continue;
    }
    if (owner.when) resolveClauses(model, params, start, undefined, true);
    if (model.kind === "limit" && !countTo(model, start, model.threshold.value + (model.threshold.op === ">" ? 1 : 0), params)) {
      skipped.push({condition: cond.text, reason: model.threshold.value + (model.threshold.op === ">" ? 1 : 0) > COUNT_ROW_CAP
        ? `count exceeds the ${COUNT_ROW_CAP}-row derived-case cap` : "cannot make the threshold count with distinct matching keys",
        cap: model.threshold.value + (model.threshold.op === ">" ? 1 : 0) > COUNT_ROW_CAP, case: "all variants"});
      continue;
    }
    const setField = (value) => {
      const rows = clone(start);
      rows[table][owner.slot][cmp.column] = value;
      rejoin(model, rows, cond, owner.clause, cmp.column);
      // a changed value may break the other conditions on another row
      // (m.cnt < n.lvl): keep the tested value and adjust the other rows
      resolveClauses(model, params, rows, owner.when ? undefined : owner.clause, true);
      return rows;
    };
    const reference_value = canonical(type, cmp.rhs.kind === "literal" ? cmp.rhs.value : cmp.rhs.kind === "param" ? params[cmp.rhs.name]
      : start[model.for.table][0][cmp.rhs.column]);
    let variants;
    if (isJoin) variants = [["match", reference_value], ["nomatch", different(type, reference_value)]];
    else if (isOrdered(type)) variants = [["lt", stepValue(type, reference_value, -1)], ["eq", reference_value], ["gt", stepValue(type, reference_value, 1)]];
    else variants = [["eq", reference_value], ["ne", bump(reference_value, 1) ?? bump(reference_value, -1)],
      ...(compareValues(type, "", type, reference_value) === 0 ? [] : [["blank", ""]])];
    const methods = name(cond.text, columnTags, variants.map(([s]) => s), cond.rule_line);
    for (const [suffix, value] of variants) {
      if (value === undefined) { skipped.push({condition: cond.text, reason: `no ${suffix} value: the type has no step that way`}); delete methods[suffix]; continue; }
      const rows = setField(value);
      if (!caseDiscriminates(model, cond, rows, params)) {
        skipped.push({condition: `${cond.text} (${suffix})`, reason: `does not isolate ${cond.text}`});
        delete methods[suffix];
        continue;
      }
      add(reference, cond.rule_line, suffix, methods, cond.text, rows);
    }
  }

  if (model.kind === "limit") {
    const n = model.threshold.value;
    const counts = model.threshold.op === ">" ? [n, n + 1] : [n - 1, n];
    const suffixes = model.threshold.op === ">" ? ["not_over", "over"] : ["below", "at"];
    const methods = name("limit threshold", ["count"], suffixes, model.threshold.rule_line);
    for (let i = 0; i < counts.length; i++) {
      const rows = clone(base.rows);
      if (!countTo(model, rows, counts[i], params)) {
        skipped.push({condition: `limit/${model.threshold.key}`, reason: counts[i] > COUNT_ROW_CAP
          ? `${counts[i]} matching rows exceed the ${COUNT_ROW_CAP}-row derived-case cap`
          : `cannot make ${counts[i]} matching rows with distinct keys`,
          cap: counts[i] > COUNT_ROW_CAP, case: suffixes[i]});
        continue;
      }
      if (!thresholdDiscriminates(model, rows, params)) {
        skipped.push({condition: `limit/${model.threshold.key}`, reason: `${counts[i]} rows do not discriminate the threshold`});
        continue;
      }
      add(`limit/${model.threshold.key}`, model.threshold.rule_line, suffixes[i], methods,
        `${counts[i]} matching rows`, rows, true);
    }
    // Exercise the transition between two joined for rows. The first group
    // exceeds the threshold and the second sits on it, so both clearing the
    // count and detecting the new key matter.
    const over = n + (model.threshold.op === ">" ? 1 : 0);
    const at = Math.max(1, n + (model.threshold.op === ">" ? 0 : -1));
    if (over + at > COUNT_ROW_CAP) {
      skipped.push({condition: `limit/${model.threshold.key}`, reason: `two groups need ${over + at} counted rows, exceeding the ${COUNT_ROW_CAP}-row derived-case cap`,
        cap: true, case: "groups"});
    } else {
      const first = clone(base.rows), second = clone(base.rows);
      let joined = false;
      // The second group must read differently from the first in every field
      // the alert names, or the alert lines cannot tell the groups apart and
      // a mutant that never splits them goes unseen.
      const forAlias = model.for.alias;
      const alerted = model.alert.parts.filter((part) => !part.is_text && !part.is_count && part.alias === forAlias).map((part) => part.column);
      const named = [...new Set(alerted)].filter((column) => !model.ddic[model.for.table].keys.includes(column));
      const counted = model.alert.parts.some((part) => part.is_count);
      const original_row = {...second[model.for.table][0]};
      const apart = () => (alerted.length > 0 || counted) && named.every((column) =>
        compareValues(model.ddic[model.for.table].fields[column], original_row[column], model.ddic[model.for.table].fields[column], second[model.for.table][0][column]) !== 0);
      if (countTo(model, first, over, params)) {
        const outer = second[model.for.table][0];
        for (const key of model.ddic[model.for.table].keys) {
          const type = model.ddic[model.for.table].fields[key];
          const original = outer[key];
          for (let seed = 2; seed < 300 && !joined; seed++) {
            const candidate = defaultValue(type, seed);
            if (compareValues(type, original, type, candidate) === 0) continue;
            Object.assign(outer, original_row);
            outer[key] = candidate;
            for (const column of named) {
              const field = model.ddic[model.for.table].fields[column];
              const value = seed === 2 ? different(field, original_row[column]) : defaultValue(field, seed);
              if (value !== undefined) outer[column] = value;
            }
            for (const on of model.clauses[0].on) {
              if (on.cmp.rhs.kind === "field" && on.cmp.rhs.column === key && on.cmp.op === "=") {
                second[model.clauses[0].table][0][on.cmp.column] = candidate;
              }
            }
            if (countTo(model, second, at, params)) {
              const counted = model.clauses[0].table;
              const freeKey = model.ddic[counted].keys.find((column) =>
                !model.clauses[0].on.some((on) => on.cmp.column === column));
              if (freeKey) {
                const type = model.ddic[counted].fields[freeKey];
                second[counted].forEach((row, i) => { row[freeKey] = defaultValue(type, 500 + i); });
              }
              const rows = clone(first);
              rows[model.for.table].push(outer);
              rows[counted].push(...second[counted]);
              if (keysDistinct(model, rows) && evaluate(model, rows, params).length ===
                evaluate(model, first, params).length + evaluate(model, second, params).length && apart()) {
                const multi = name("limit groups", ["count"], ["groups"], model.threshold.rule_line);
                add(`limit/${model.threshold.key}`, model.threshold.rule_line, "groups", multi,
                  `${over} and ${at} matching rows in two groups`, rows, true);
                joined = true;
              }
            }
            if (!joined) {
              Object.assign(outer, original_row);
              second[model.clauses[0].table] = base.rows[model.clauses[0].table].map((row) => ({...row}));
            }
          }
          if (joined) break;
        }
      }
      if (!joined) skipped.push({condition: `limit/${model.threshold.key}`, reason: "cannot make two distinct for groups with matching counted rows whose alerts differ"});
    }
    return {cases, skipped};
  }

  // the structural cases of the clauses, each guarded like the others
  const one = model.clauses.length === 1;
  const structural = (condition, line, suffix, methods, label, rows) => {
    if (!structureDiscriminates(model, rows, params)) {
      skipped.push({condition: `${label} (${suffix})`, reason: `does not isolate ${label}`});
      return;
    }
    add(condition, line, suffix, methods, label, rows, true);
  };
  const reference = (clause) => clause["@id"].slice(model["@id"].length + 1);
  const labelOf = (clause) => `exists ${clause.table.toUpperCase()} as ${clause.alias}`;
  const baseCount = evaluate(model, base.rows, params).length;
  // two rows of a clause for one for row: the second differs in a key field,
  // by a value that still satisfies the whole where, so one alert more
  const twoRows = (clause) => {
    const inner = model.ddic[clause.table];
    for (const key of inner.keys) {
      const type = inner.fields[key];
      const first = base.rows[clause.table][slotOf(clause)][key];
      const candidates = [different(type, first), stepValue(type, first, -1), stepValue(type, first, 1), bump(first, 1), bump(first, -1)];
      for (const next of candidates) {
        if (next === undefined || compareValues(type, next, type, first) === 0) continue;
        const rows = clone(base.rows);
        rows[clause.table].push({...rows[clause.table][slotOf(clause)], [key]: next});
        if (keysDistinct(model, rows) && evaluate(model, rows, params).length === baseCount + 1) return rows;
      }
    }
    return undefined;
  };
  if (model.kind === "require") {
    const clause = model.clauses[0];
    const methods = name(`exists ${clause.table}`, ["exists"], ["zero", "one"], clause.exists_line);
    const zero = clone(base.rows);
    zero[clause.table] = [];
    structural(reference(clause), clause.exists_line, "zero", methods, labelOf(clause), zero);
    structural(reference(clause), clause.exists_line, "one", methods, labelOf(clause), clone(base.rows));
    return {cases, skipped};
  }
  const any = model.combine === "any";
  model.clauses.forEach((clause, c) => {
    const tags = one ? ["exists"] : [clause.alias, `exists${c + 1}`, `x${c + 1}`];
    const suffixes = any ? ["only", "two"] : ["zero", "two"];
    const methods = name(`exists ${clause.table}`, tags, suffixes, clause.exists_line);
    const rows = clone(base.rows);
    if (any) {
      // only this clause's row: the other clauses' rows go, a table they share
      // with this clause keeps this clause's row
      for (const other of model.clauses) {
        if (other !== clause) rows[other.table] = other.table === clause.table ? [base.rows[clause.table][slotOf(clause)]] : [];
      }
    } else {
      rows[clause.table] = [];
    }
    structural(reference(clause), clause.exists_line, suffixes[0], methods, labelOf(clause), rows);
    const two = twoRows(clause);
    if (!two) skipped.push({condition: labelOf(clause), reason: "does not isolate the exists: no second row with another key value satisfies the whole where (one alert more)"});
    else structural(reference(clause), clause.exists_line, "two", methods, labelOf(clause), two);
  });
  if (any) {
    const methods = name("every exists", ["exists"], ["zero"], model.clauses[0].exists_line);
    const rows = clone(base.rows);
    for (const clause of model.clauses) rows[clause.table] = [];
    structural("forbid/any", model.clauses[0].exists_line, "zero", methods, "no exists row", rows);
  }
  return {cases, skipped};
}
