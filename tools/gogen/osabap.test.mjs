// Focused end-to-end check for the native report host. It intentionally uses
// the local open-abap-gui/core checkouts, just like osabap.mjs itself.
import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const builder = join(here, "osabap.mjs");
const binary = join(here, ".out", "osabap");

execFileSync(process.execPath, [builder], {stdio: "inherit"});

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
