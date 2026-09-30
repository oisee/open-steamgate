// The versions of an object out of git (docs/backlog/adt.md, "Versions of an
// object, read out of git"): HISTORY follows a rename, REVISION reads an old
// version at the path it had, and a file git does not track says why it has
// no history. The Go host has the same cases (store_history_test.go).
import {expect} from "chai";
import {execFileSync} from "node:child_process";
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {gitObjectHistory, gitObjectRevisionAt} from "../tools/osd-git-history.mjs";
import {sapUserOf} from "../tools/osd-store-destination.mjs";

describe("object versions from git", function () {
  let root;
  const git = (...args) => execFileSync("git", args, {cwd: root, stdio: ["ignore", "pipe", "pipe"]});

  before(() => {
    root = mkdtempSync(join(tmpdir(), "osd-history-"));
    git("init", "-q");
    git("config", "user.name", "Test Author");
    git("config", "user.email", "test@example.invalid");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "zold.prog.abap"), "REPORT zold.\nWRITE 'one'.\n");
    git("add", ".");
    git("commit", "-q", "-m", "first");
    git("mv", "src/zold.prog.abap", "src/znew.prog.abap");
    writeFileSync(join(root, "src", "znew.prog.abap"), "REPORT zold.\nWRITE 'one'.\nWRITE 'two'.\n");
    git("add", ".");
    git("commit", "-q", "-m", "second");
  });

  after(() => rmSync(root, {recursive: true, force: true}));

  it("lists the file's commits across a rename, newest first", () => {
    const history = gitObjectHistory(root, "src/znew.prog.abap");
    expect(history.available).to.equal(true);
    expect(history.entries.map((e) => e.subject)).to.deep.equal(["second", "first"]);
    expect(history.entries[1].path).to.equal("src/zold.prog.abap");
  });

  it("reads an old version at the path it had then", () => {
    const [, first] = gitObjectHistory(root, "src/znew.prog.abap").entries;
    const read = gitObjectRevisionAt(root, "src/znew.prog.abap", first.revision);
    expect(read.path).to.equal("src/zold.prog.abap");
    expect(read.source).to.equal("REPORT zold.\nWRITE 'one'.\n");
    expect(() => gitObjectRevisionAt(root, "src/znew.prog.abap", "0".repeat(40))).to.throw(/not a version/);
  });

  it("says why an untracked file or a tree outside git has no history", () => {
    writeFileSync(join(root, "src", "zloose.prog.abap"), "REPORT zloose.\n");
    expect(gitObjectHistory(root, "src/zloose.prog.abap").reason).to.match(/not tracked/);
    git("add", "src/zloose.prog.abap");
    expect(gitObjectHistory(root, "src/zloose.prog.abap").reason).to.match(/no commit yet/);
    const outside = mkdtempSync(join(tmpdir(), "osd-nogit-"));
    try {
      expect(gitObjectHistory(outside, "x.prog.abap").available).to.equal(false);
    } finally {
      rmSync(outside, {recursive: true, force: true});
    }
  });

  it("names the author as a SAP user, never an e-mail", () => {
    expect(sapUserOf("Alice V.")).to.equal("ALICEV");
    expect(sapUserOf("")).to.equal("UNKNOWN");
    expect(sapUserOf("someone@example.com")).to.not.include("@");
  });
});
