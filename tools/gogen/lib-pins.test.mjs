// tools/gogen/lib-pins.mjs: a library clone off its libs.lock.json pin, or
// with uncommitted changes, is named; strict mode refuses it.
import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {checkLibPins, libDrift} from "./lib-pins.mjs";

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], {encoding: "utf8"}).trim();

function clone(home, folder, files) {
  const dir = join(home, ".local", "lars", folder);
  mkdirSync(dir, {recursive: true});
  git(dir, "init", "-q");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  git(dir, "add", ".");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c");
  return {dir, head: git(dir, "rev-parse", "HEAD")};
}

test("a clone on its pin passes; off the pin or dirty it is named, and strict refuses", () => {
  const home = mkdtempSync(join(tmpdir(), "lib-pins-"));
  try {
    const core = clone(home, "open-abap-core", {"a.txt": "1"});
    const gui = clone(home, "open-abap-gui", {"b.txt": "1"});
    const lock = (coreRef, guiRef) => writeFileSync(join(home, "libs.lock.json"), JSON.stringify({
      transpiler: {repo: "o/t", ref: "0".repeat(40)},
      libraries: [{folder: "open-abap-core", repo: "o/c", ref: coreRef}, {folder: "open-abap-gui", repo: "o/g", ref: guiRef}],
    }));
    lock(core.head, gui.head);
    assert.deepEqual(libDrift(home), []);

    lock(core.head, "1".repeat(40));
    assert.deepEqual(libDrift(home), [`open-abap-gui is at ${gui.head.slice(0, 8)}, libs.lock.json pins 11111111`]);
    const said = [];
    checkLibPins(home, {say: (line) => said.push(line), strict: false});
    assert.equal(said.length, 2);
    assert.throws(() => checkLibPins(home, {say: () => {}, strict: true}), /OSABAP_STRICT_PINS/);

    lock(core.head, gui.head);
    writeFileSync(join(core.dir, "a.txt"), "2");
    assert.deepEqual(libDrift(home), [`open-abap-core has changes over its pin ${core.head.slice(0, 8)} (edited or untracked files)`]);
    git(core.dir, "checkout", "-q", "--", "a.txt");
    // a new class file osabap would compile counts as a change too
    writeFileSync(join(core.dir, "zcl_new.clas.abap"), "");
    assert.equal(libDrift(home).length, 1);
    rmSync(join(core.dir, "zcl_new.clas.abap"));

    // a plain folder inside a git repository is not answered by that repository
    git(home, "init", "-q");
    rmSync(gui.dir, {recursive: true, force: true});
    mkdirSync(gui.dir, {recursive: true});
    assert.deepEqual(libDrift(home), [`open-abap-gui is not a git clone of its own; libs.lock.json pins ${gui.head.slice(0, 8)}`]);

    // strict: an unreadable lock is an error, not a pass
    writeFileSync(join(home, "libs.lock.json"), "{");
    assert.deepEqual(libDrift(home), []);
    assert.throws(() => libDrift(home, undefined, {strict: true}));
  } finally {
    rmSync(home, {recursive: true, force: true});
  }
});
