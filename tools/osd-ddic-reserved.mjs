#!/usr/bin/env node
// A table field a system refuses to activate: one named by a reserved word.
//
// Measured on A4H: "ZONE is a reserved word (choose another field name)"
// (2026-09-24, with HANDLER, SECTION and PARAMETER, ANORMALIES
// zone-reserved-word), LABEL (the R3 lift probe) and "RULE is a reserved word"
// for ZOSD_L3_ALERT (2026-10-01). Each of them built and ran here and failed
// the last mile, so the names are checked where the tree is, the way
// tools/osd-oo-comments.mjs checks the comments a system refuses to store.
//
// The list is tools/ddic-reserved-words.json: SQL reserved words from public
// lists (the SQL standard, ODBC, SAP HANA, Microsoft SQL Server, Oracle,
// Db2), each part with its source. A system's own list is its dictionary
// table TRESE; that is system content and never goes into a tracked file.
// Where a private copy exists (.local/a4h-ddic/trese.json, found the way the
// leak scan finds its identifier list, or OSD_DDIC_TRESE), the check also
// reads it and prints *counts* only -- how many of its words the public list
// does not cover, and how many fields of the tree it names that the public
// list does not -- never a word, because this output gets pasted -- and a
// field it names that neither the public list nor `accepted` covers fails the
// run. A list it cannot read is reported by path and error name only.
//
// What is read: every `*.tabl.xml` (tables and structures, DD03P FIELDNAME)
// under src/, every pack's ABAP folders, and gen/ when a build has written
// it (cds2ddic and the other generators). Objects outside the customer
// namespace (TBTCJOB, CROSS, ...) are SAP's own definitions mirrored here
// and are not checked: a system already has them. A finding passes only when
// the list's `accepted` names the word with a measurement, or `allow` names
// the table field with a reason.
//
//   node tools/osd-ddic-reserved.mjs [paths...]
//
// Exit 0 clean, 1 with findings, 2 when it could not do its job.
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync, readdirSync, statSync} from "node:fs";
import {basename, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {packsOf} from "./osd-packs.mjs";
import {sapNameRule} from "./osd-deploy-manifest.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const LIST = join(ROOT, "tools", "ddic-reserved-words.json");

/** the public list: words (with the parts naming each), accepted words, allowed fields */
export function loadList(file = LIST) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const words = new Map();
  for (const part of doc.parts ?? []) {
    if (!part.name || !part.source || !Array.isArray(part.words)) throw new Error(`${file}: a part needs name, source and words`);
    for (const w of part.words) words.set(w.toUpperCase(), [...(words.get(w.toUpperCase()) ?? []), part.name]);
  }
  for (const m of doc.measured_refused ?? []) {
    words.set(m.word.toUpperCase(), [...(words.get(m.word.toUpperCase()) ?? []), "measured"]);
  }
  const KINDS = ["system-has-it", "structure", "unmeasured"];
  const reasoned = (entries, key) => new Map((entries ?? []).map((e) => {
    if (!e[key] || !e.why) throw new Error(`${file}: every ${key === "word" ? "accepted" : "allow"} entry needs ${key} and why`);
    if (key === "field" && !KINDS.includes(e.kind)) throw new Error(`${file}: allow ${e.field} needs a kind (${KINDS.join(", ")})`);
    return [e[key].toUpperCase(), {why: e.why, kind: e.kind}];
  }));
  return {words, accepted: reasoned(doc.accepted, "word"), allow: reasoned(doc.allow, "field"),
    refused: new Set((doc.measured_refused ?? []).map((m) => m.word.toUpperCase()))};
}

/** {table, tabclass, fields} of one abapGit TABL file */
export function tableOf(text) {
  const table = /<TABNAME>([^<]*)<\/TABNAME>/.exec(text)?.[1]?.trim().toUpperCase();
  const tabclass = /<TABCLASS>([^<]*)<\/TABCLASS>/.exec(text)?.[1]?.trim() ?? "";
  const fields = [];
  for (const block of text.matchAll(/<DD03P>([\s\S]*?)<\/DD03P>/g)) {
    const name = /<FIELDNAME>([^<]*)<\/FIELDNAME>/.exec(block[1])?.[1]?.trim().toUpperCase();
    // .INCLUDE / .APPEND rows name a structure, not a column
    if (name && !name.startsWith(".")) fields.push(name);
  }
  return {table, tabclass, fields};
}

/** findings of one table against the list: [{table, field, parts}] */
export function check(text, list) {
  const {table, fields} = tableOf(text);
  if (!table || sapNameRule(table) !== undefined) return [];
  const out = [];
  for (const field of fields) {
    const parts = list.words.get(field);
    if (!parts) continue;
    const key = `${table}-${field}`;
    if (list.allow.has(key)) continue;
    if (list.accepted.has(field) && !list.refused.has(field)) continue;
    out.push({table, field, parts});
  }
  return out;
}

const SKIP = ["node_modules", ".git", "build", "output", ".local", "fixtures"];
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  if (!statSync(dir).isDirectory()) return dir.endsWith(".tabl.xml") ? [...out, dir] : out;
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP.includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".tabl.xml")) out.push(full);
  }
  return out;
}

/** the table files of src/, the packs and gen/, or of the paths given */
export function filesOf(paths = [], root = ROOT) {
  if (paths.length > 0) return [...new Set(paths.flatMap((p) => walk(resolve(p))))];
  const folders = [join(root, "src"), ...packsOf(root).flatMap((p) => p.abap), join(root, "gen")];
  return [...new Set(folders.flatMap((f) => walk(f)))];
}

/** the private copy of a system's TRESE, if this checkout has one */
export function localListPath(root = ROOT, env = process.env) {
  let common;
  try {
    const dir = execFileSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
    common = resolve(dir, "..");
  } catch { /* not a git checkout */ }
  return [env.OSD_DDIC_TRESE, join(root, ".local", "a4h-ddic", "trese.json"),
    common && join(common, ".local", "a4h-ddic", "trese.json")].find((p) => p && existsSync(p));
}

/** counts only: never a word of the local list */
export function localCounts(localWords, list, tables) {
  const local = new Set(localWords.map((w) => String(w).toUpperCase()));
  const uncovered = [...local].filter((w) => !list.words.has(w)).length;
  let fields = 0;
  for (const {table, fields: names} of tables) {
    if (!table || sapNameRule(table) !== undefined) continue;
    for (const f of names) if (local.has(f) && !list.words.has(f) && !list.accepted.has(f) && !list.allow.has(`${table}-${f}`)) fields++;
  }
  return {size: local.size, uncovered, fields};
}

if (basename(process.argv[1] ?? "") === "osd-ddic-reserved.mjs") {
  const args = process.argv.slice(2);
  let list;
  try { list = loadList(); } catch (e) {
    console.error(`osd-ddic-reserved: ${e.message}`);
    process.exit(2);
  }
  const files = filesOf(args.filter((a) => !a.startsWith("--")));
  if (files.length === 0) {
    console.error("osd-ddic-reserved: no table was read -- this is not a pass");
    process.exit(2);
  }
  const tables = [];
  let count = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    tables.push(tableOf(text));
    for (const f of check(text, list)) {
      console.log(`${relative(process.cwd(), file)}: ${f.table}-${f.field}: ${f.field} is a reserved word (${f.parts.join(", ")}); `
        + "a system refuses to activate the table (\"choose another field name\")");
      count++;
    }
  }
  // an allow entry no field of the tree needs any more: said, and a failure
  // when the whole tree was read, so the list cannot outlive its reasons
  if (args.filter((a) => !a.startsWith("--")).length === 0) {
    const present = new Set(tables.flatMap(({table, fields}) => fields.map((f) => `${table}-${f}`)));
    for (const key of list.allow.keys()) {
      if (!present.has(key)) {
        console.log(`tools/ddic-reserved-words.json: allow ${key} names no field of the tree; remove the entry`);
        count++;
      }
    }
  }
  const kinds = {};
  for (const {kind} of list.allow.values()) kinds[kind] = (kinds[kind] ?? 0) + 1;
  console.log(`\nosd-ddic-reserved: ${files.length} tables and structures, ${list.words.size} reserved words, `
    + `${list.allow.size} allowed field(s) (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ") || "none"}), ${count} finding(s)`);
  // The local list is a system's own and is never printed: neither its words
  // nor a parse error, whose message quotes the input (as the leak scan
  // treats its identifier list). A field it names that neither the public
  // list nor a measured acceptance covers fails the run, by count only.
  const local = localListPath();
  if (local) {
    let words;
    try {
      words = JSON.parse(readFileSync(local, "utf8")).words;
      if (!Array.isArray(words)) throw new TypeError("no words array");
    } catch (e) {
      console.error(`osd-ddic-reserved: ${local} could not be read (${e?.name ?? "Error"}); its content is not printed`);
      process.exit(2);
    }
    const c = localCounts(words, list, tables);
    console.log(`osd-ddic-reserved: local system list: ${c.size} words, ${c.uncovered} of them not in the public list; `
      + `${c.fields} field(s) of the tree it names that neither the public list nor a measured acceptance covers`);
    count += c.fields;
  }
  process.exit(count === 0 ? 0 : 1);
}
