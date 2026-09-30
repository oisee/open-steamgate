// Focused end-to-end check for the native report host. It intentionally uses
// the local open-abap-gui/core checkouts, just like osabap.mjs itself.
import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {delimiter, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const builder = join(here, "osabap.mjs");
const binary = join(here, ".out", "osabap");

execFileSync(process.execPath, [builder], {stdio: "inherit"});
execFileSync("go", ["test", "-tags", "nodatabase", "./cmd/osabap"], {
  cwd: join(here, "go"), stdio: "inherit",
});

const run = (args, input) => spawnSync(binary, args, {encoding: "utf8", input});

test("positionals and repeatable select-option flags", () => {
  const result = run(["Alice", "--s-tag", "alpha", "--s-tag", "beta"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Hello Alice\nTags 2\n");
});

test("named flags and JSON ranges use the same report lifecycle", () => {
  const ranges = ["one", {low: "a", high: "z"}, {sign: "E", option: "CP", low: "tmp*"}];
  const result = run(["--name", "Bob", "--loud", "--params", JSON.stringify({S_TAG: ranges})]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Hello BOB\nTags 3\n");
});

test("no arguments presents the selection screen", () => {
  const result = run([], "Cara\nyes\nred,green\n");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ZHELLO . selection screen/);
  assert.match(result.stdout, /Hello CARA\nTags 2\n$/);
});

test("unknown options fail instead of becoming report input", () => {
  const result = run(["--unknown"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown option --unknown/);
});

test("help describes dataset grants", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  for (const flag of ["--allow-read", "--allow-write", "--dataset-home", "--dataset-audit"]) {
    assert.ok(result.stdout.includes(flag), flag);
  }
});

test("native frontend reads environment and copies a text file", () => {
  const dir = mkdtempSync(join(tmpdir(), "osabap-frontend-"));
  try {
    const input = join(dir, "input.txt");
    const output = join(dir, "output.txt");
    writeFileSync(input, "one\ntwo\n");
    execFileSync(process.execPath, [builder, join(here, "apps", "io", "zio.prog.abap")], {stdio: "inherit"});
    const result = spawnSync(binary, ["--input", input, "--output", output], {
      encoding: "utf8", env: {...process.env, OSABAP_TEST_ENV: "works"},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Copied 2 lines 8 bytes\nEnv works\n");
    assert.equal(readFileSync(output, "utf8"), "one\ntwo\n");
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("native DATASET copy obeys read, write and path grants", () => {
  const dir = mkdtempSync(join(tmpdir(), "osabap-dataset-"));
  try {
    const inputDir = join(dir, "in");
    const outputDir = join(dir, "out");
    mkdirSync(inputDir);
    mkdirSync(outputDir);
    const input = join(inputDir, "source.txt");
    const output = join(outputDir, "copy.txt");
    const audit = join(outputDir, "audit.ndjson");
    const content = "one\ntwo\n";
    writeFileSync(input, content);
    execFileSync(process.execPath, [builder, join(here, "apps", "dataset", "zdataset.prog.abap")], {stdio: "inherit"});

    const allowed = run(["--allow-read", inputDir, "--allow-write", outputDir, "--dataset-audit", audit, "--input", input, "--output", output]);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.match(allowed.stdout, /Copied\s+2 lines, at byte\s+8/);
    assert.match(allowed.stdout, /Head 6F6E65\s+3/);
    assert.equal(readFileSync(output, "utf8"), content);
    assert.match(readFileSync(audit, "utf8"), /"allowed":true/);
    rmSync(output);

    const escapedAudit = join(dir, "escaped-audit.ndjson");
    const auditOutsideRoot = run(["--allow-read", inputDir, "--allow-write", outputDir,
      "--dataset-audit", escapedAudit, "--input", input, "--output", output]);
    assert.equal(auditOutsideRoot.status, 0, auditOutsideRoot.stderr);
    assert.equal(existsSync(escapedAudit), false);
    rmSync(output);

    const linkedAudit = join(outputDir, "linked-audit.ndjson");
    symlinkSync(escapedAudit, linkedAudit);
    const auditViaLink = run(["--allow-read", inputDir, "--allow-write", outputDir,
      "--dataset-audit", linkedAudit, "--input", input, "--output", output]);
    assert.equal(auditViaLink.status, 0, auditViaLink.stderr);
    assert.equal(existsSync(escapedAudit), false);
    rmSync(output);

    const joinedRoots = run(["--allow-read", `${outputDir}${delimiter}${inputDir}`, "--allow-write", outputDir,
      "--input", input, "--output", output]);
    assert.equal(joinedRoots.status, 1);
    assert.match(joinedRoots.stderr, /one directory per flag/);
    assert.equal(existsSync(output), false);

    const denied = spawnSync(binary, ["--input", input, "--output", output], {
      encoding: "utf8", env: {...process.env, OSD_DATASET_READ: inputDir, OSD_DATASET_WRITE: outputDir},
    });
    assert.equal(denied.status, 0, denied.stderr);
    assert.match(denied.stdout, /^Refused Permission denied/);
    assert.equal(existsSync(output), false);

    const wrongReadRoot = run(["--allow-read", outputDir, "--allow-write", outputDir,
      "--input", input, "--output", output]);
    assert.equal(wrongReadRoot.status, 0, wrongReadRoot.stderr);
    assert.match(wrongReadRoot.stdout, /^Refused Permission denied/);
    assert.equal(existsSync(output), false);

    const readOnly = run(["--allow-read", inputDir, "--input", input, "--output", output]);
    assert.equal(readOnly.status, 0, readOnly.stderr);
    assert.match(readOnly.stdout, /Refused/);
    assert.equal(existsSync(output), false);

    const escaped = join(dir, "escape.txt");
    const escape = run(["--allow-read", inputDir, "--allow-write", outputDir, "--dataset-home", outputDir,
      "--input", input, "--output", "../escape.txt"]);
    assert.equal(escape.status, 0, escape.stderr);
    assert.match(escape.stdout, /Refused/);
    assert.equal(existsSync(escaped), false);

    const unicode = "one\nGrüße 世界\n\nlast\n";
    writeFileSync(input, unicode);
    const unicodeCopy = run(["--allow-read", inputDir, "--allow-write", outputDir,
      "--input", input, "--output", output]);
    assert.equal(unicodeCopy.status, 0, unicodeCopy.stderr);
    assert.equal(readFileSync(output, "utf8"), unicode);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// A report with a table of its own (apps/notes: ZNOTES beside the report):
// its rows live in the SQLite file --db names, created with the report's
// tables when missing; without --db it refuses and names the flag; the file
// alone holds the rows once the command ends; a file laid out by another
// build of the table is refused rather than used. The report is built from
// a copy, so the tracked table is never edited.
test("a report's own table lives in the --db file", () => {
  const dir = mkdtempSync(join(tmpdir(), "osabap-db-"));
  try {
    const app = join(dir, "notes");
    cpSync(join(here, "apps", "notes"), app, {recursive: true});
    const report = join(app, "znotes.prog.abap");
    execFileSync(process.execPath, [builder, report], {stdio: "inherit"});
    const help = run(["--help"]);
    assert.match(help.stdout, /--db FILE .*ZNOTES/);

    const without = run(["--add", "hello"]);
    assert.equal(without.status, 1);
    assert.match(without.stderr, /znotes keeps its rows in tables \(ZNOTES\): run it with --db FILE/);

    const file = join(dir, "notes.db");
    const first = run(["--db", file, "--add", "hello"]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, "1 hello\n1 notes\n");
    // a second run of the command finds the first run's row
    const second = run(["--db", file, "--add", "second note"]);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, "1 hello\n2 second note\n2 notes\n");

    // the file alone is the data: no -wal left behind, and a copy of just
    // the file reads back every row
    assert.equal(existsSync(`${file}-wal`), false);
    const copy = join(dir, "copy.db");
    cpSync(file, copy);
    const fromCopy = run(["--db", copy, "--add", "third"]);
    assert.equal(fromCopy.status, 0, fromCopy.stderr);
    assert.equal(fromCopy.stdout, "1 hello\n2 second note\n3 third\n3 notes\n");

    const odd = run(["--db", join(dir, "we?ird.db"), "--add", "x"]);
    assert.equal(odd.status, 1);
    assert.match(odd.stderr, /a file name with \?, # or % is not accepted/);

    // the same table with a longer TEXT: the file was laid out by another build
    const tabl = join(app, "znotes.tabl.xml");
    writeFileSync(tabl, readFileSync(tabl, "utf8").replace("<LENG>000080</LENG>", "<LENG>000120</LENG>").replace("<INTLEN>000160</INTLEN>", "<INTLEN>000240</INTLEN>"));
    execFileSync(process.execPath, [builder, report], {stdio: "inherit"});
    const drifted = run(["--db", file, "--add", "x"]);
    assert.equal(drifted.status, 1);
    assert.match(drifted.stderr, /seeded by another build/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("a report without tables refuses --db", () => {
  execFileSync(process.execPath, [builder], {stdio: "inherit"});
  const result = run(["Alice", "--db", join(tmpdir(), "osabap-never.db")]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--db: ZHELLO has no tables of its own/);
});
