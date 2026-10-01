#!/usr/bin/env node
// A comment where a system refuses to store one.
//
// Measured on A4H (2026-10-01, ADT save of a global class main include): a
// system answers HTTP 400 "The class contains unknown comments which can't be
// stored" (T100 OO_SOURCE_BASED 012) and does NOT save the class when a
// comment line -- `*` in column 1 or `"` after optional blanks -- stands
//
//   - between two methods of the implementation,
//   - between `CLASS ... IMPLEMENTATION.` and the first `METHOD`,
//   - after the last `ENDMETHOD.` and before the implementation's `ENDCLASS.`,
//   - between the definition's `ENDCLASS.` and `CLASS ... IMPLEMENTATION.`.
//
// Accepted, and stored verbatim: comments anywhere in the DEFINITION part, a
// header comment before `CLASS ... DEFINITION`, a trailing comment after the
// final `ENDCLASS.`, comments inside METHOD ... ENDMETHOD., blank lines
// anywhere. abapGit deploys through the same storage, so such a class builds
// and runs here and fails the last mile to a system.
//
// Scope, stated: only the main include (`*.clas.abap`). The local includes
// (`.clas.locals_imp/def/testclasses/macros.abap`) were not measured and are
// not checked. A comment that trails a statement on its own line
// (`ENDMETHOD. " done`) is not a comment *line* and was not measured either;
// it is not reported.
//
// The position of every statement comes from abaplint's parser, so chained
// and multi-line statements, strings holding `"` or `*`, `"!` doc comments,
// pseudo-comments and any keyword case are the parser's business and not a
// regex's.
//
//   node tools/osd-oo-comments.mjs [--fix] [paths...]
//
// Paths are files or folders; without any, src/ and every pack folder.
// Exit 0 clean, 1 with findings (or a file --fix refused), 2 when it could
// not do its job.
import {fileURLToPath} from "node:url";
import {readFileSync, writeFileSync, existsSync, readdirSync, statSync} from "node:fs";
import {basename, join, relative, resolve} from "node:path";
import * as abaplint from "@abaplint/core";
import {packsOf} from "./osd-packs.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const S = abaplint.Statements;

export const MESSAGE = "comment outside a method in the class implementation (a system refuses to store this: OO_SOURCE_BASED 012)";

function statementsOf(name, text) {
  const reg = new abaplint.Registry().addFile(new abaplint.MemoryFile(name, text)).parse();
  return reg.getFirstObject().getABAPFiles()[0].getStatements();
}

/** Comment blocks standing where a system refuses them. Each block is
 *  consecutive full comment lines (blank lines between them do not split it
 *  when only blanks separate two comment lines) with the place to move it. */
export function analyse(text, name = "x.clas.abap") {
  const statements = statementsOf(name, text);
  const lines = text.split("\n");
  // rows covered by a real statement: a comment inside one belongs to it
  const spans = statements.filter((s) => !(s.get() instanceof abaplint.Comment))
    .map((s) => [s.getFirstToken().getRow(), s.getLastToken().getRow()])
    .filter(([a, b]) => b > a);

  let state = "outside"; // outside | def | between | impl | method | after
  const bad = []; // {row, state}
  const methods = []; // {start: METHOD row, end: ENDMETHOD row}
  let open;
  for (const s of statements) {
    const kind = s.get();
    const row = s.getFirstToken().getRow();
    if (kind instanceof abaplint.Comment) {
      const first = lines[row - 1].search(/\S/);
      const full = first === s.getFirstToken().getCol() - 1;
      const inside = spans.some(([a, b]) => row >= a && row <= b);
      if (full && !inside && (state === "between" || state === "impl")) bad.push({row, state});
    } else if (kind instanceof S.ClassDefinition) state = "def";
    else if (kind instanceof S.EndClass) state = state === "def" ? "between" : "after";
    else if (kind instanceof S.ClassImplementation) state = "impl";
    else if (kind instanceof S.MethodImplementation) {
      state = "method";
      open = {start: s.getLastToken().getRow(), end: undefined};
    } else if (kind instanceof S.EndMethod) {
      state = "impl";
      if (open) {
        open.end = row;
        methods.push(open);
        open = undefined;
      }
    }
  }

  // group consecutive comment rows (only blank lines allowed between)
  const blocks = [];
  for (const b of bad) {
    const last = blocks[blocks.length - 1];
    let joined = false;
    if (last && last.state === b.state) {
      joined = true;
      for (let r = last.rows[last.rows.length - 1] + 1; r < b.row; r += 1) {
        if (lines[r - 1].trim() !== "") joined = false;
      }
    }
    if (joined) last.rows.push(b.row);
    else blocks.push({state: b.state, rows: [b.row]});
  }
  for (const block of blocks) {
    const first = block.rows[0];
    const lastRow = block.rows[block.rows.length - 1];
    const following = methods.find((m) => m.start > lastRow);
    const preceding = [...methods].reverse().find((m) => m.end < first);
    block.target = following ? {kind: "after-method-line", row: following.start, method: following}
      : preceding ? {kind: "before-endmethod", row: preceding.end, method: preceding} : undefined;
  }
  return {lines, bad, blocks, methods};
}

export function findings(text, name) {
  return analyse(text, name).bad.map((b) => b.row);
}

/** the text with every refused comment block moved into a method, or an
 *  error string when a file has nowhere to put them */
export function fix(text, name = "x.clas.abap") {
  const {lines, blocks} = analyse(text, name);
  if (blocks.length === 0) return {text};
  if (blocks.some((b) => !b.target)) return {error: "the implementation has no method to move a comment into"};
  const removed = new Set();
  const inserted = new Map(); // insert after this row (1-based; 0 = top)
  const add = (row, more) => inserted.set(row, [...(inserted.get(row) ?? []), ...more]);
  for (const block of blocks) {
    const body = block.rows.map((r) => lines[r - 1]);
    for (let r = block.rows[0]; r <= block.rows[block.rows.length - 1]; r += 1) removed.add(r);
    const {target} = block;
    // body indent: the first code line of the method, else METHOD's own + 2
    const methodRow = target.method.start;
    let indent;
    for (let r = methodRow + 1; r < target.method.end; r += 1) {
      const l = lines[r - 1];
      if (l.trim() !== "" && !/^\s*["*]/.test(l)) {
        indent = l.search(/\S/);
        break;
      }
    }
    indent ??= lines[methodRow - 1].search(/\S/) + 2;
    const quote = body.filter((l) => l.trimStart().startsWith('"') && l.trim() !== "");
    const base = quote.length === 0 ? 0 : Math.min(...quote.map((l) => l.search(/\S/)));
    const moved = body.filter((l) => l.trim() !== "").map((l) => {
      if (l.startsWith("*")) return l; // a `*` comment only counts in column 1
      return " ".repeat(Math.max(0, indent + l.search(/\S/) - base)) + l.trimStart();
    });
    if (target.kind === "after-method-line") add(target.row, moved);
    else add(target.row - 1, moved);
  }
  const out = [];
  const emit = (row) => {
    for (const l of inserted.get(row) ?? []) out.push(l);
  };
  emit(0);
  for (let r = 1; r <= lines.length; r += 1) {
    if (!removed.has(r)) out.push(lines[r - 1]);
    else if (out.length > 0 && out[out.length - 1].trim() === "" && (lines[r] ?? "").trim() === "") {
      // the block leaves two blank lines side by side: drop one
      out.pop();
    }
    emit(r);
  }
  const result = out.join("\n");
  // never delete text: every comment line must still be there, once more
  const had = lines.filter((l) => /^\s*["*]/.test(l)).map((l) => l.trim()).sort();
  const has = result.split("\n").filter((l) => /^\s*["*]/.test(l)).map((l) => l.trim()).sort();
  if (JSON.stringify(had) !== JSON.stringify(has)) return {error: "internal: a comment line would have been lost"};
  return {text: result};
}

const SKIP = ["node_modules", ".git", "build", "gen", "output", "upstream", ".local", "test"];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP.includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.clas\.abap$/.test(entry)) out.push(full);
  }
  return out;
}

/** the main includes under src/ and every pack's ABAP folder, or the paths
 *  given (a named path is read whatever its name says about test/) */
export function filesOf(paths = [], root = ROOT) {
  if (paths.length > 0) {
    return paths.flatMap((p) => {
      const full = resolve(p);
      if (!existsSync(full)) return [];
      if (statSync(full).isDirectory()) {
        const out = [];
        const rec = (d) => {
          for (const e of readdirSync(d).sort()) {
            if (["node_modules", ".git"].includes(e)) continue;
            const f = join(d, e);
            if (statSync(f).isDirectory()) rec(f);
            else if (/\.clas\.abap$/.test(e)) out.push(f);
          }
        };
        rec(full);
        return out;
      }
      return /\.clas\.abap$/.test(full) ? [full] : [];
    });
  }
  const folders = [join(root, "src"), ...packsOf(root).flatMap((p) => p.abap)];
  return [...new Set(folders.flatMap((f) => walk(f)))];
}

if (basename(process.argv[1] ?? "") === "osd-oo-comments.mjs") {
  const args = process.argv.slice(2);
  const doFix = args.includes("--fix");
  const files = filesOf(args.filter((a) => !a.startsWith("--")));
  if (files.length === 0) {
    console.error("osd-oo-comments: no class main include was read -- this is not a pass");
    process.exit(2);
  }
  let count = 0;
  let refused = 0;
  for (const file of files) {
    const rel = relative(process.cwd(), file);
    const text = readFileSync(file, "utf8");
    const found = findings(text, basename(file));
    if (found.length === 0) continue;
    if (doFix) {
      const result = fix(text, basename(file));
      if (result.error) {
        refused += 1;
        console.log(`${rel}: not fixed, ${result.error}`);
        continue;
      }
      writeFileSync(file, result.text);
      console.log(`${rel}: moved ${found.length} comment line(s) into methods`);
      continue;
    }
    for (const row of found) console.log(`${rel}:${row}: ${MESSAGE}`);
    count += found.length;
  }
  if (!doFix) console.log(`\nosd-oo-comments: ${files.length} class main includes, ${count} finding(s)`);
  process.exit(count === 0 && refused === 0 ? 0 : 1);
}
