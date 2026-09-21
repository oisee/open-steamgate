import {expect} from "chai";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {gitObjectRevision, gitObjectState} from "../tools/osd-git-history.mjs";

describe("tools/osd-git-history: read-only object history", () => {
  let root;
  const git = (...args) => execFileSync("git", args, {cwd: root, encoding: "utf8"}).trim();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "osg-git-history-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/zcl_demo.clas.abap"), "CLASS zcl_demo DEFINITION.\nENDCLASS.\n");
    git("init", "--quiet");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "OSG Test");
    git("add", "src/zcl_demo.clas.abap");
    git("commit", "--quiet", "-m", "initial");
  });

  afterEach(() => rmSync(root, {recursive: true, force: true}));

  it("reports branch, exact HEAD, file and a clean tracked source", () => {
    const state = gitObjectState(root, "src/zcl_demo.clas.abap");
    expect(state).to.include({available: true, tracked: true, status: "clean",
      file: "src/zcl_demo.clas.abap"});
    expect(state.branch).to.equal(git("branch", "--show-current"));
    expect(state.head).to.equal(git("rev-parse", "HEAD"));
    expect(state.headShort).to.equal(state.head.slice(0, 12));
    expect(state.diff).to.equal("");
  });

  it("shows the stored file against HEAD without changing the repository", () => {
    writeFileSync(join(root, "src/zcl_demo.clas.abap"),
      "CLASS zcl_demo DEFINITION.\n  PUBLIC SECTION.\nENDCLASS.\n");
    const before = git("rev-parse", "HEAD");
    const state = gitObjectState(root, "src/zcl_demo.clas.abap");
    expect(state.status).to.equal("modified");
    expect(state.diff).to.contain("+  PUBLIC SECTION.");
    expect(git("rev-parse", "HEAD")).to.equal(before);
  });

  it("lists file commits newest first and restores the exact selected blob", () => {
    const first = git("rev-parse", "HEAD");
    const original = "CLASS zcl_demo DEFINITION.\nENDCLASS.\n";
    writeFileSync(join(root, "src/zcl_demo.clas.abap"),
      "CLASS zcl_demo DEFINITION.\n  PUBLIC SECTION.\nENDCLASS.\n");
    git("add", "src/zcl_demo.clas.abap");
    git("commit", "--quiet", "-m", "add public section");

    const state = gitObjectState(root, "src/zcl_demo.clas.abap");
    expect(state.history.map((item) => item.subject)).to.deep.equal(["add public section", "initial"]);
    expect(state.history[0]).to.include.keys("revision", "shortRevision", "author", "authoredAt");
    expect(gitObjectRevision(root, "src/zcl_demo.clas.abap", first)).to.equal(original);
    expect(() => gitObjectRevision(root, "src/zcl_demo.clas.abap", first.slice(0, 12)))
      .to.throw("full 40-character commit SHA");
    writeFileSync(join(root, "README.md"), "unrelated\n");
    git("add", "README.md");
    git("commit", "--quiet", "-m", "unrelated");
    const unrelated = git("rev-parse", "HEAD");
    expect(() => gitObjectRevision(root, "src/zcl_demo.clas.abap", unrelated))
      .to.throw("is not a version");
  });

  it("names detached HEAD and renders an untracked file as an added diff", () => {
    git("checkout", "--quiet", "--detach");
    writeFileSync(join(root, "src/zif_demo.intf.abap"), "INTERFACE zif_demo.\nENDINTERFACE.\n");
    const state = gitObjectState(root, "src/zif_demo.intf.abap");
    expect(state).to.include({branch: "detached", detached: true, tracked: false, status: "untracked"});
    expect(state.diff).to.contain("--- /dev/null");
    expect(state.diff).to.contain("+INTERFACE zif_demo.");
  });

  it("marks a repository without its first commit as unborn", () => {
    rmSync(join(root, ".git"), {recursive: true, force: true});
    git("init", "--quiet");
    const state = gitObjectState(root, "src/zcl_demo.clas.abap");
    expect(state).to.include({available: true, unborn: true, head: "",
      headShort: "unborn", tracked: false, status: "untracked"});
    expect(state.branch).to.be.a("string").and.not.equal("");
  });

  it("does not present ignored source as an untracked diff", () => {
    writeFileSync(join(root, ".gitignore"), "src/zif_ignored.intf.abap\n");
    writeFileSync(join(root, "src/zif_ignored.intf.abap"),
      "INTERFACE zif_ignored.\nENDINTERFACE.\n");
    const state = gitObjectState(root, "src/zif_ignored.intf.abap");
    expect(state).to.include({available: true, tracked: false, status: "ignored"});
    expect(state.diff).to.equal("");
  });

  it("returns an explicit unavailable state outside a Git worktree", () => {
    const outside = mkdtempSync(join(tmpdir(), "osg-no-git-"));
    try {
      expect(gitObjectState(outside, "missing")).to.deep.include({available: false});
    } finally {
      rmSync(outside, {recursive: true, force: true});
    }
  });
});
