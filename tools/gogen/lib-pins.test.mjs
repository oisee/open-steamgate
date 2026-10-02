import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {checkLibPins, libDrift} from "./lib-pins.mjs";

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], {encoding: "utf8"}).trim();

test("osabap refuses drift and names the sync command", () => {
  const home = mkdtempSync(join(tmpdir(), "lib-pins-"));
  try {
    git(home, "init", "-q"); // a checkout: the pin gate applies only there (tools/osd-lib-path.mjs)
    const dir = join(home, ".local/lars/open-abap-core");
    mkdirSync(dir, {recursive: true});
    git(dir, "init", "-q");
    writeFileSync(join(dir, "a.txt"), "one");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "one");
    const ref = git(dir, "rev-parse", "HEAD");
    writeFileSync(join(home, "libs.lock.json"), JSON.stringify({
      transpiler: {repo: "t/t", ref: "0".repeat(40)},
      libraries: [{folder: "open-abap-core", repo: "t/c", ref}],
    }));
    assert.deepEqual(libDrift(home), []);
    writeFileSync(join(home, "libs.lock.json"), JSON.stringify({
      transpiler: {repo: "t/t", ref: "0".repeat(40)},
      libraries: [{folder: "open-abap-core", repo: "t/c", ref: "1".repeat(40)}],
    }));
    assert.match(libDrift(home)[0], /--sync/);
    assert.throws(() => checkLibPins(home), /--sync/);
  } finally { rmSync(home, {recursive: true, force: true}); }
});
