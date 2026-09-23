// What the AMDP corpus actually uses, counted in two corpora rather than one.
//
// The frequency half of docs/sqlscript-surface.md. Its input is abapGit ZIPs
// exported from a sandbox into .local/ (never tracked: they are somebody
// else's source), and its output is a table of construct against how often it
// occurs -- separately for the teaching corpus and the working one, because
// mixing them produces a histogram that is confident and wrong in whichever
// direction the corpus happens to lean (docs/sqlscript-corpus.md).
//
// It counts **bodies**, not lines: a construct that appears nine times in one
// method is one body, because what we need to know is how many bodies we
// would fail to translate, not how enthusiastic an author was.
import {readFileSync, readdirSync, mkdirSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join} from "node:path";
import {teachingPackages} from "./sqlscript/corpus-config.mjs";

/** the teaching packages, named in the gitignored .local/corpus-names.json (corpus content stays local) */
let teaching;
const isTeaching = (pkg) => (teaching ??= teachingPackages())(pkg);

// Packages written to teach or to test the compiler. They cover the corners of
// the language on purpose, so they over-represent rare constructs exactly as
// much as generated code under-represents them.

// One entry is one row of the table. The pattern runs against the SQLScript
// body with comments stripped; `ref` points into the surface list.
const CONSTRUCTS = [
  ["table variable assigned from a SELECT", /^\s*[a-z_][\w]*\s*=\s*SELECT\b/im, "A 3.1"],
  ["INNER JOIN", /\bINNER\s+JOIN\b/i, "A 3.2.4"],
  ["LEFT/RIGHT OUTER JOIN", /\b(LEFT|RIGHT)\s+OUTER\s+JOIN\b/i, "A 3.2.4"],
  ["CROSS JOIN", /\bCROSS\s+JOIN\b/i, "A 3.2.4"],
  ["WHERE", /\bWHERE\b/i, "A 3.2.5"],
  ["GROUP BY", /\bGROUP\s+BY\b/i, "A 3.2.7"],
  ["HAVING", /\bHAVING\b/i, "A 3.2.8"],
  ["ORDER BY", /\bORDER\s+BY\b/i, "A 3.2.9"],
  ["WITH (common table expression)", /\bWITH\s+[a-z_][\w]*\s+AS\s*\(/i, "A 3.2.6"],
  ["UNION / UNION ALL", /\bUNION(\s+ALL)?\b/i, "A 3.2.10"],
  ["INTERSECT / EXCEPT", /\b(INTERSECT|EXCEPT)\b/i, "A 3.2.10"],
  ["scalar subquery / IN (SELECT", /\bIN\s*\(\s*SELECT\b/i, "A 3.2.11"],
  ["INSERT ... VALUES", /\bINSERT\s+INTO\b[\s\S]{0,400}?\bVALUES\b/i, "A 5.1"],
  ["INSERT ... SELECT", /\bINSERT\s+INTO\b[\s\S]{0,400}?\bSELECT\b/i, "A 5.1"],
  ["UPDATE", /\bUPDATE\s+[:\w]/i, "A 5.2"],
  ["UPSERT / REPLACE", /\b(UPSERT|REPLACE)\s+[:\w]/i, "A 5.3"],
  ["MERGE INTO", /\bMERGE\s+INTO\b/i, "A 5.4"],
  ["DELETE", /\bDELETE\s+FROM\b/i, "A 5.5"],
  ["TRUNCATE TABLE", /\bTRUNCATE\s+TABLE\b/i, "A 5.6"],
  ["DECLARE scalar variable", /\bDECLARE\s+[a-z_][\w]*\s+(?!CURSOR|TABLE)[A-Z]/i, "B 6.1.1"],
  ["DECLARE TABLE variable", /\bDECLARE\s+[a-z_][\w]*\s+TABLE\b/i, "B 6.1.2"],
  ["session variable", /\bSESSION_CONTEXT\s*\(|\bSET\s+'[A-Z_]+'\s*=/i, "B 6.1.3"],
  ["temporary table", /\b(LOCAL\s+)?TEMPORARY\s+TABLE\b|#\w+/i, "B 6.1.4"],
  ["IF / ELSE", /\bIF\b[\s\S]{0,200}?\bTHEN\b/i, "B 6.2"],
  ["FOR loop", /\bFOR\s+[a-z_][\w]*\s+IN\b/i, "B 6.3"],
  ["WHILE loop", /\bWHILE\b[\s\S]{0,120}?\bDO\b/i, "B 6.3"],
  ["BREAK / CONTINUE", /\b(BREAK|CONTINUE)\b/i, "B 6.3"],
  ["cursor", /\bDECLARE\s+CURSOR\s+[a-z_][\w]*\b|\bOPEN\s+[a-z_][\w]*\s*;/i, "B 6.4"],
  ["array", /\bARRAY_AGG\s*\(|\bUNNEST\s*\(|\bCARDINALITY\s*\(|\bARRAY\s*\(/i, "B 6.5"],
  ["COMMIT / ROLLBACK", /\b(COMMIT|ROLLBACK)\b/i, "B 6.6"],
  ["dynamic SQL", /\bEXEC\b|\bEXECUTE\s+IMMEDIATE\b|\bAPPLY_FILTER\s*\(/i, "B 6.7"],
  ["exceptions", /\bSIGNAL\b|\bRESIGNAL\b|\bEXIT\s+HANDLER\b|\bDECLARE\s+CONDITION\b/i, "B 6.8"],
  ["calculation engine (CE_) operator", /\bCE_[A-Z_]+\s*\(/i, "C 3.3.1"],
  ["MAP_MERGE", /\bMAP_MERGE\s*\(/i, "C 3.3.2"],
  ["MAP_REDUCE", /\bMAP_REDUCE\s*\(/i, "C 3.3.3"],
  ["calls another procedure (CALL)", /\bCALL\s+[":\w]/i, "D 8.1.6"],
];

// SQL keywords that look like a function call and are not one
const NOT_A_FUNCTION = new Set(["IF", "IN", "ON", "AS", "OR", "AND", "NOT", "SELECT", "FROM", "WHERE",
  "VALUES", "WHEN", "THEN", "ELSE", "END", "CASE", "BY", "SET", "DO", "FOR", "WHILE", "RETURN",
  "DECLARE", "TABLE", "USING", "INTO", "ORDER", "GROUP", "UNION", "ALL", "DISTINCT", "WITH", "EXISTS",
  // keywords that are followed by a bracket and are not calls
  "JOIN", "OVER", "EXCEPT", "INTERSECT", "HINT", "LEFT", "RIGHT", "FULL", "CROSS", "INNER", "OUTER",
  "PARTITION", "WINDOW", "FILTER", "ARRAY", "ROW", "LATERAL", "UNNEST", "RETURNS", "LANGUAGE",
  // a type name in a CAST is not a function either, though it is worth knowing it is used
  "NVARCHAR", "VARCHAR", "DECIMAL", "INTEGER", "BIGINT", "SMALLINT", "VARBINARY", "NCLOB", "CLOB",
  "TIMESTAMP", "SECONDDATE", "DATE", "TIME", "DOUBLE", "REAL", "BOOLEAN", "TINYINT"]);

function bodiesOf(source) {
  // A method whose body is SQLScript: everything between the declaration that
  // says so and its ENDMETHOD. Taken by position, not by re-parsing, because
  // SQLScript is not ABAP and nothing here should try to read it as ABAP.
  const out = [];
  const re = /METHOD\s+[\w~]+\s+BY\s+DATABASE\s+(PROCEDURE|FUNCTION)\b[\s\S]*?\.\s*([\s\S]*?)ENDMETHOD\s*\./gi;
  for (const m of source.matchAll(re)) {
    out.push({kind: m[1].toUpperCase(), body: m[2]});
  }
  return out;
}

const strip = (body) => body
  .replace(/\/\*[\s\S]*?\*\//g, " ")      // block comment
  .replace(/^\s*--.*$/gm, " ")            // line comment
  .replace(/--.*$/gm, " ");

function classesIn(zip, dir) {
  mkdirSync(dir, {recursive: true});
  execFileSync("unzip", ["-o", "-q", zip, "-d", dir]);
  const found = [];
  const walk = (d) => {
    for (const e of readdirSync(d, {withFileTypes: true})) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith(".clas.abap")) found.push(join(d, e.name));
    }
  };
  walk(dir);
  return found;
}

const root = process.argv[2] ?? ".local/a4h-export";
const scratch = process.env.OSD_SCRATCH ?? "/tmp/amdp-corpus";
const zips = readdirSync(root).filter((f) => f.endsWith(".zip"));
if (zips.length === 0) {
  console.error(`no exports in ${root} -- see docs/sqlscript-corpus.md`);
  process.exit(2);
}

const corpora = {teaching: [], working: []};
const functions = {teaching: new Map(), working: new Map()};
let classesWithAmdp = 0;

for (const zip of zips) {
  const pkg = zip.replace(/\.zip$/, "");
  const which = isTeaching(pkg) ? "teaching" : "working";
  const dir = join(scratch, pkg);
  for (const file of classesIn(join(root, zip), dir)) {
    const source = readFileSync(file, "utf8");
    const bodies = bodiesOf(source);
    if (bodies.length === 0) continue;
    classesWithAmdp += 1;
    for (const b of bodies) {
      const text = strip(b.body);
      corpora[which].push({pkg, file, kind: b.kind, text});
      for (const m of text.matchAll(/\b([A-Z][A-Z0-9_]{2,})\s*\(/g)) {
        if (NOT_A_FUNCTION.has(m[1])) continue;
        if (m[1].endsWith("_")) continue;   // a name prefix caught mid-identifier, not a call
        const seen = functions[which];
        seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
      }
    }
  }
}

const pct = (n, of) => of === 0 ? "-" : `${Math.round((n / of) * 100)}%`;
const T = corpora.teaching.length, W = corpora.working.length;
console.log(`# AMDP bodies: ${T} teaching, ${W} working, from ${classesWithAmdp} classes in ${zips.length} packages`);
console.log("");
console.log("| construct | ref | working | teaching |");
console.log("| --- | --- | ---: | ---: |");
const rows = CONSTRUCTS.map(([name, re, ref]) => {
  const w = corpora.working.filter((b) => re.test(b.text)).length;
  const t = corpora.teaching.filter((b) => re.test(b.text)).length;
  return {name, ref, w, t};
}).sort((a, b) => b.w - a.w || b.t - a.t);
for (const r of rows) {
  console.log(`| ${r.name} | ${r.ref} | ${r.w} (${pct(r.w, W)}) | ${r.t} (${pct(r.t, T)}) |`);
}

// The question the frequency table does not answer (fable-osd, 2026-09-18).
// A body needs **all** of its constructs at once, so implementing the three
// commonest can translate exactly zero bodies -- each one trips over its own
// fourth. The curve that means something is cumulative and counted in bodies.
const NEVER = ["XMLTABLE", "HIERARCHY"];      // no portable form at all
const setOf = (b) => new Set(CONSTRUCTS.filter(([, re]) => re.test(b.text)).map(([n]) => n));
const unportable = (b) => NEVER.some((f) => new RegExp(`\\b${f}\\s*\\(`, "i").test(b.text));

for (const which of ["working", "teaching"]) {
  const bodies = corpora[which].map((b) => ({...b, needs: setOf(b), ceiling: unportable(b)}));
  const reachable = bodies.filter((b) => b.ceiling === false);
  console.log("");
  console.log(`## ${which}: how many bodies are covered **completely**, as constructs are added`);
  console.log("");
  console.log(`${bodies.length} bodies; ${bodies.length - reachable.length} can never be covered (${NEVER.join(", ")}) -- a ceiling, not a backlog item`);
  console.log("");
  console.log("| after adding | bodies fully covered | of the reachable |");
  console.log("| --- | ---: | ---: |");
  // greedy: at each step take the construct that completes the most bodies
  const have = new Set();
  const left = new Set(CONSTRUCTS.map(([n]) => n));
  const covered = () => reachable.filter((b) => [...b.needs].every((n) => have.has(n))).length;
  let step = 0;
  console.log(`| (nothing) | ${covered()} | ${pct(covered(), reachable.length)} |`);
  while (left.size > 0 && step < 14) {
    let best = null, bestGain = -1;
    for (const cand of left) {
      have.add(cand);
      const gain = covered();
      have.delete(cand);
      if (gain > bestGain) { bestGain = gain; best = cand; }
    }
    have.add(best);
    left.delete(best);
    step += 1;
    console.log(`| ${step}. ${best} | ${bestGain} | ${pct(bestGain, reachable.length)} |`);
    if (bestGain === reachable.length) break;
  }
  // the cheapest work available right now: bodies one construct short
  const missingOne = new Map();
  for (const b of reachable) {
    const missing = [...b.needs].filter((n) => have.has(n) === false);
    if (missing.length !== 1) continue;
    missingOne.set(missing[0], (missingOne.get(missing[0]) ?? 0) + 1);
  }
  const next = [...missingOne.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log("");
  console.log(`after those ${step}, the bodies blocked by exactly one more construct: ` +
    (next.length === 0 ? "(none)" : next.map(([n, c]) => `${n} unlocks ${c}`).join("; ")));
}

console.log("");
console.log("## Built-in functions, by the bodies that use them");
const top = (map, limit) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
console.log(`working: ${top(functions.working, 25).map(([f, n]) => `${f} ${n}`).join(", ")}`);
console.log(`teaching: ${top(functions.teaching, 25).map(([f, n]) => `${f} ${n}`).join(", ")}`);
const onlyTeaching = [...functions.teaching.keys()].filter((f) => functions.working.has(f) === false);
console.log(`only in the teaching corpus (${onlyTeaching.length}): ${onlyTeaching.slice(0, 40).join(", ")}`);
const onlyWorking = [...functions.working.keys()].filter((f) => functions.teaching.has(f) === false);
console.log(`only in the working corpus (${onlyWorking.length}): ${onlyWorking.slice(0, 40).join(", ")}`);
