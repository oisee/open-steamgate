// Rename a set of abapGit objects by prefix, contents and file names alike.
//
//   node tools/osd-rename.mjs --from ZSTG_ --to ZOSD_004_ --out <dir> <file|dir>...
//
// Why a tool and not a sed: a deployment attempt gets its own package and its
// own names, so a failed import does not poison the next one (Alice,
// 2026-09-19 -- the first attempt left rows in /IWBEP/I_MGW_SRG and the
// second attempt dumped on them). That means every attempt renames the same
// set of objects, and doing it by hand is how one reference gets missed and
// the class does not activate for a reason nobody can see.
//
// It renames **whole identifiers only**. `ZSTG_DEMO` becomes `ZOSD_004_DEMO`
// and `ZSTG_DEMO_BK` becomes `ZOSD_004_DEMO_BK`, but a string that merely
// contains the prefix inside a longer word is left alone -- a rename that
// edits prose or a comment is a rename nobody can review.
import {cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from "node:fs";
import {basename, join} from "node:path";
import {runsAs} from "./osd-main.mjs";
import {KEY_WIDTH} from "./stg-compile.mjs";

/** Every identifier starting with `from`, in either case, becomes `to`. */
export function rename(text, from, to) {
  // Not `\b`: a class name embeds the project, and in ZCL_ZSTG_DEMO_MPC the
  // prefix follows an underscore, which is a word character, so there is no
  // word boundary there and the class would keep its old name while its table
  // changed. The rule is "does not continue a letter or a digit": it renames
  // at the start and after an underscore, and leaves MYZSTG_X alone.
  const re = new RegExp(`(?<![A-Za-z0-9])${from.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}([A-Za-z0-9_]*)`, "gi");
  return text.replace(re, (match, rest) => {
    // keep the case of the original: SAP source is written both ways and a
    // class that says Zcl_ in one place and ZCL_ in another still compiles,
    // but the diff becomes unreadable
    const lower = match[0] === match[0].toLowerCase();
    const out = to + rest;
    return lower ? out.toLowerCase() : out.toUpperCase();
  });
}

/** The abapGit file name carries the object name, so it is renamed too.
 *
 *  Two of these names are **fixed width** and the padding is part of the
 *  name, not decoration: an IWSV is the object padded to 35 plus `0001`,
 *  an IWMO and an IWVB padded to 32. A text rename that makes the object
 *  four characters longer leaves the padding alone and the name comes out
 *  four characters too long, which abapGit reads as an object called
 *  `ZOSD_005_DEMO_SRV 0` and then cannot find the file it just named:
 *
 *    File not found: zosd_005_demo_srv 0.iwsv.xml
 *    This syntax cannot be used for an object name
 *
 *  Measured 2026-09-19 on A4H, one import after the rename tool started
 *  being used for the deployment packages. `test/segw-corpus.mjs` checks
 *  these widths on what the generator writes, and nothing checked what a
 *  rename writes -- so the check was right and it was pointed at the wrong
 *  file. The width lives in stg-compile, once, and is imported here. */
export function renameFile(name, from, to) {
  for (const [ext, width] of Object.entries(KEY_WIDTH)) {
    const m = new RegExp(`^(.+?)\\s*(\\d{4})${ext.replace(/\./g, "\\.")}$`).exec(name);
    if (name.endsWith(ext) && m !== null) {
      return rename(m[1].trimEnd(), from, to).padEnd(width, " ") + m[2] + ext;
    }
  }
  return rename(name, from, to);
}

export function renameAll(inputs, out, from, to) {
  rmSync(out, {recursive: true, force: true});
  mkdirSync(out, {recursive: true});
  const files = [];
  for (const input of inputs) {
    const entries = statSync(input).isDirectory()
      ? readdirSync(input).filter((f) => statSync(join(input, f)).isFile()).map((f) => join(input, f))
      : [input];
    files.push(...entries);
  }
  const written = [];
  for (const f of files) {
    const name = renameFile(basename(f), from, to);
    // a binary would be corrupted by a text rename; none of the abapGit
    // object formats are binary, so anything that is not one is copied
    if (/\.(abap|xml|yaml|json|txt)$/i.test(f)) {
      writeFileSync(join(out, name), rename(readFileSync(f, "utf8"), from, to));
    } else {
      cpSync(f, join(out, name));
    }
    written.push(name);
  }
  return written;
}

if (runsAs("osd-rename.mjs")) {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i < 0 ? undefined : argv[i + 1]; };
  const from = flag("from");
  const to = flag("to");
  const out = flag("out");
  const inputs = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
  if (!from || !to || !out || inputs.length === 0) {
    console.error("usage: osd-rename.mjs --from ZSTG_ --to ZOSD_004_ --out <dir> <file|dir>...");
    process.exit(2);
  }
  const written = renameAll(inputs, out, from, to);
  console.log(`${written.length} files -> ${out}`);
  for (const w of written.sort()) console.log(`  ${w}`);
}
