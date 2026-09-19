// Does the binder carry what the grammar reads, or does it drop it quietly?
//
// Five clauses were in the second state on 2026-09-19 and every one of them
// was found by a person asking, one at a time:
//
//   GROUP BY      the grouping vanished
//   HAVING        the condition became a WHERE
//   DISTINCT      became the name of a column
//   EXCEPT        lowered as UNION -- the OPPOSITE set
//   s.k           lowered as "S" -- the qualifier instead of the column
//
// Asking one at a time is how the first three were found and also how the
// last two were missed for a day, so the asking is mechanical here. Three
// invariants, each of which needs no expectation written per clause -- an
// expectation is a thing somebody keeps up to date, and nobody does:
//
//   1. **A clause must change the statement.** Lower the body with it and
//      without it. Identical SQL means the clause reached nothing. (GROUP BY.)
//   2. **Alternatives must differ from each other.** UNION, INTERSECT and
//      EXCEPT are three answers; if two of them lower alike, one is wrong.
//      (EXCEPT, INTERSECT.)
//   3. **Every column the body names must appear in the statement.** A
//      qualified `s.k` that lowers without K has lost the column. (s.k.)
//   4. **No keyword of the language may come out as an identifier.** A
//      statement selecting a column called DISTINCT is the parser having
//      taken a keyword for a name. (DISTINCT.)
//   5. **A clause must not become a different clause.** HAVING written as
//      HAVING and the same condition written as WHERE are two programs; if
//      they lower alike, one has been read as the other. (HAVING.)
//
// A clause that is REFUSED by name passes all three: a refusal is a clause
// the binder does not carry and says so, which is the state we want until
// the IR carries it.
//
//   node tools/sqlscript/clause-audit.mjs [--verbose]
import {basename} from "node:path";
import {lex} from "./lexer.mjs";
import {parse} from "./combi.mjs";
import {Body} from "./expressions/index.mjs";
import {toIr} from "./to-ir.mjs";
import {lower} from "../sqlscript-lower.mjs";

/** lower a body, or say why it would not */
export function sqlOf(body, catalogue = {}) {
  try {
    return {sql: lower(toIr(parse(new Body(), lex(body)), {catalogue}).rel, "hana").sql};
  } catch (error) {
    return {refused: String(error.message ?? error).split("\n")[0].slice(0, 90)};
  }
}

/** 1. with the clause and without it -- and they must not be the same statement */
export const OPTIONAL = [
  {clause: "WHERE", with: "RETURN SELECT k FROM src WHERE a > 1;", without: "RETURN SELECT k FROM src;"},
  {clause: "GROUP BY", with: "RETURN SELECT a FROM src GROUP BY a;", without: "RETURN SELECT a FROM src;"},
  {clause: "HAVING", with: "RETURN SELECT a FROM src GROUP BY a HAVING COUNT(*) > 1;",
   without: "RETURN SELECT a FROM src GROUP BY a;"},
  {clause: "DISTINCT", with: "RETURN SELECT DISTINCT k FROM src;", without: "RETURN SELECT k FROM src;"},
  {clause: "ORDER BY", with: "lt = SELECT k FROM src;\n  RETURN SELECT k FROM :lt ORDER BY k;",
   without: "lt = SELECT k FROM src;\n  RETURN SELECT k FROM :lt;"},
  {clause: "LIMIT", with: "lt = SELECT k FROM src;\n  RETURN SELECT k FROM :lt LIMIT 2;",
   without: "lt = SELECT k FROM src;\n  RETURN SELECT k FROM :lt;"},
  {clause: "UNION ALL", with: "RETURN SELECT k FROM src UNION ALL SELECT k FROM other;",
   without: "RETURN SELECT k FROM src UNION SELECT k FROM other;"},
  {clause: "DESC", with: "lt = SELECT k FROM src;\n  RETURN SELECT k FROM :lt ORDER BY k DESC;",
   without: "lt = SELECT k FROM src;\n  RETURN SELECT k FROM :lt ORDER BY k;"},
];

/** 2. one shape, several operators: no two may lower alike */
export const ALTERNATIVES = [
  {family: "set operation", bodies: {
    UNION: "RETURN SELECT k FROM src UNION SELECT k FROM other;",
    INTERSECT: "RETURN SELECT k FROM src INTERSECT SELECT k FROM other;",
    EXCEPT: "RETURN SELECT k FROM src EXCEPT SELECT k FROM other;",
  }},
  {family: "join", bodies: {
    INNER: "RETURN SELECT k FROM src INNER JOIN other ON src.k = other.k;",
    LEFT: "RETURN SELECT k FROM src LEFT OUTER JOIN other ON src.k = other.k;",
    CROSS: "RETURN SELECT k FROM src CROSS JOIN other;",
  }},
  {family: "comparison", bodies: {
    equal: "RETURN SELECT k FROM src WHERE a = 1;",
    notEqual: "RETURN SELECT k FROM src WHERE a <> 1;",
    greater: "RETURN SELECT k FROM src WHERE a > 1;",
    less: "RETURN SELECT k FROM src WHERE a < 1;",
  }},
];

/** 4. keywords that must never appear as an identifier in the output */
export const KEYWORDS = ["DISTINCT", "GROUP", "HAVING", "UNION", "INTERSECT", "EXCEPT", "ORDER",
  "WHERE", "SELECT", "FROM", "JOIN", "LIMIT", "INNER", "OUTER", "CROSS", "LEFT", "RIGHT"];

/** 5. clauses that must not be read as one another */
export const NOT_THE_SAME = [
  {a: "HAVING", b: "WHERE",
   left: "RETURN SELECT a FROM src GROUP BY a HAVING a > 1;",
   right: "RETURN SELECT a FROM src WHERE a > 1 GROUP BY a;"},
];

/** 3. a column the body names has to be in the statement */
export const NAMES = [
  {body: "RETURN SELECT s.k FROM src AS s;", columns: ["K"]},
  {body: "RETURN SELECT s.k, s.a FROM src AS s;", columns: ["K", "A"]},
  {body: "RETURN SELECT src.k FROM src;", columns: ["K"]},
  {body: "RETURN SELECT k, a FROM src;", columns: ["K", "A"]},
  {body: "RETURN SELECT k FROM src WHERE a > 1;", columns: ["K", "A"]},
];

/** keywords of the language that came out of the lowering as identifiers */
export function keywordsTakenAsNames(sql = "") {
  return KEYWORDS.filter((k) => new RegExp(`"${k}"`).test(sql));
}

/** columns the body named that the statement does not mention */
export function missingColumns(sql = "", columns = []) {
  return columns.filter((c) => !new RegExp(`"${c}"`).test(sql));
}

export function audit() {
  const findings = [];

  for (const one of OPTIONAL) {
    const a = sqlOf(one.with);
    const b = sqlOf(one.without);
    // a refusal is an honest answer: the binder does not carry it and says so
    if (a.refused !== undefined) continue;
    if (b.refused !== undefined) continue;
    if (a.sql === b.sql) {
      findings.push({kind: "silently dropped", clause: one.clause,
        why: `the body with ${one.clause} and the body without it lower to the same statement`, sql: a.sql});
    }
  }

  for (const {family, bodies} of ALTERNATIVES) {
    const lowered = Object.entries(bodies).map(([name, body]) => [name, sqlOf(body)])
      .filter(([, one]) => one.refused === undefined);
    for (let i = 0; i < lowered.length; i++) {
      for (let j = i + 1; j < lowered.length; j++) {
        if (lowered[i][1].sql === lowered[j][1].sql) {
          findings.push({kind: "two answers, one statement", clause: `${family}: ${lowered[i][0]} / ${lowered[j][0]}`,
            why: "two operators that mean different things lower identically", sql: lowered[i][1].sql});
        }
      }
    }
  }

  for (const one of NAMES) {
    const lowered = sqlOf(one.body);
    if (lowered.refused !== undefined) continue;
    const missing = missingColumns(lowered.sql, one.columns);
    if (missing.length > 0) {
      findings.push({kind: "column lost", clause: one.body.trim().slice(0, 40),
        why: `the body names ${missing.join(", ")} and the statement does not`, sql: lowered.sql});
    }
  }

  // 4: a keyword that came out as an identifier
  const everyBody = [...OPTIONAL.map((o) => ({label: o.clause, body: o.with})),
    ...ALTERNATIVES.flatMap((f) => Object.entries(f.bodies).map(([n, b]) => ({label: `${f.family}/${n}`, body: b}))),
    ...NAMES.map((n) => ({label: n.body.trim().slice(0, 30), body: n.body}))];
  for (const one of everyBody) {
    const lowered = sqlOf(one.body);
    if (lowered.refused !== undefined) continue;
    const taken = keywordsTakenAsNames(lowered.sql);
    if (taken.length > 0) {
      findings.push({kind: "a keyword became an identifier", clause: one.label,
        why: `${taken.join(", ")} is a keyword of the language and came out as a name`, sql: lowered.sql});
    }
  }

  // 5: one clause read as another
  for (const one of NOT_THE_SAME) {
    const left = sqlOf(one.left);
    const right = sqlOf(one.right);
    if (left.refused !== undefined || right.refused !== undefined) continue;
    if (left.sql === right.sql) {
      findings.push({kind: "one clause read as another", clause: `${one.a} / ${one.b}`,
        why: `${one.a} and ${one.b} are two programs and lower to one statement`, sql: left.sql});
    }
  }

  return findings;
}

if (basename(process.argv[1] ?? "") === "clause-audit.mjs") {
  const findings = audit();
  const checked = OPTIONAL.length + ALTERNATIVES.reduce((n, a) => n + Object.keys(a.bodies).length, 0)
    + NAMES.length + NOT_THE_SAME.length * 2;
  if (process.argv.includes("--verbose")) {
    for (const one of [...OPTIONAL.map((o) => o.with), ...NAMES.map((n) => n.body)]) {
      const r = sqlOf(one);
      console.log((r.refused ? "refused: " + r.refused : r.sql).slice(0, 100));
    }
  }
  console.log(`clause audit: ${checked} bodies, ${findings.length} findings`);
  for (const f of findings) {
    console.log(`\n  ${f.kind}: ${f.clause}`);
    console.log(`    ${f.why}`);
    console.log(`    ${f.sql?.slice(0, 100)}`);
  }
  if (findings.length === 0) {
    console.log("\nA clause the binder refuses BY NAME passes this audit: refusing is the");
    console.log("state we want until the IR carries it. Silence here means no clause is");
    console.log("being read and then thrown away -- not that every clause is supported.");
  }
  process.exit(findings.length === 0 ? 0 : 1);
}
