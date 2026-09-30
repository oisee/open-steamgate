// Focused end-to-end check for the native report host. It intentionally uses
// the local open-abap-gui/core checkouts, just like osabap.mjs itself.
import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
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
    const audit = join(dir, "audit.ndjson");
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
