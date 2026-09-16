import {expect} from "chai";
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {MARKER, FetchFailed, describeUnfetched, fetchAll, fetchSource, unfetched} from "../tools/osd-fetch.mjs";
import {packsOf} from "../tools/osd-packs.mjs";

// A pack may fetch a folder instead of carrying it: a repository, a commit
// and a path in it, declared in the manifest, copied by tools/osd-fetch.mjs.
// The repository here is a real one on disk, so the fetch is git's and not
// a stand-in for it; a file URL is what GitHub would be.
describe("tools/osd-fetch: a pack fetches a folder it does not carry", function () {
  this.timeout(30000);
  let root;
  let repo;
  let commit;
  const git = (args, cwd = repo) => execFileSync("git", args, {cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  const write = (base, file, text = "") => {
    mkdirSync(join(base, file, ".."), {recursive: true});
    writeFileSync(join(base, file), text);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "osd-fetch-root-"));
    repo = mkdtempSync(join(tmpdir(), "osd-fetch-repo-"));
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "test@example.invalid"]);
    git(["config", "user.name", "test"]);
    write(repo, "src/zcl_theirs.clas.abap", "CLASS zcl_theirs DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_theirs IMPLEMENTATION.\nENDCLASS.\n");
    write(repo, "src/zcl_theirs.clas.xml", "<abapGit/>");
    write(repo, "src/zcl_theirs.clas.testclasses.abap", "* tests");
    write(repo, "src/zgui.prog.abap", "REPORT zgui.");
    write(repo, "src/sub/zcl_deep.clas.abap", "CLASS zcl_deep DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_deep IMPLEMENTATION.\nENDCLASS.\n");
    write(repo, "README.md", "not part of src");
    git(["add", "."]);
    git(["commit", "-q", "-m", "first"]);
    commit = git(["rev-parse", "HEAD"]);
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"]}));
    write(root, "packs/theirs/osd-pack.json", JSON.stringify({
      abap: ["upstream", "src"],
      sources: [{folder: "upstream", repo: repo, ref: commit, path: "src", exclude: ["\\.testclasses\\.abap$", "^zgui\\."]}],
    }));
    write(root, "packs/theirs/src/zcl_mine.clas.abap", "CLASS zcl_mine DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_mine IMPLEMENTATION.\nENDCLASS.\n");
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
    rmSync(repo, {recursive: true, force: true});
  });

  it("reads the declaration and says the folder is not there yet", () => {
    const [pack] = packsOf(root, {});
    expect(pack.sources.map((s) => [s.folder, s.ref, s.path, s.exclude])).to.deep.equal([["upstream", commit, "src", ["\\.testclasses\\.abap$", "^zgui\\."]]]);
    expect(pack.missing.map((s) => s.folder)).to.deep.equal(["upstream"]);
    // an unfetched folder is not a layer: the pack is smaller than declared, and says so
    expect(pack.abap.map((f) => f.split("/").pop())).to.deep.equal(["src"]);
    expect(unfetched(root, {}).map((m) => `${m.pack}/${m.folder}`)).to.deep.equal(["theirs/upstream"]);
    expect(describeUnfetched(unfetched(root, {}))).to.contain("pack theirs fetches upstream from").and.to.contain("node tools/osd-fetch.mjs");
  });

  it("fetches the path at the commit, minus what is excluded, and the pack is whole", () => {
    const [pack] = packsOf(root, {});
    const answer = fetchSource(pack, pack.sources[0]);
    expect(answer.fetched).to.equal(true);
    expect(answer.commit).to.equal(commit);
    expect(answer.files).to.equal(3);
    const up = join(root, "packs/theirs/upstream");
    expect(existsSync(join(up, "zcl_theirs.clas.abap"))).to.equal(true);
    expect(existsSync(join(up, "sub/zcl_deep.clas.abap"))).to.equal(true);
    expect(existsSync(join(up, "zcl_theirs.clas.testclasses.abap"))).to.equal(false);
    expect(existsSync(join(up, "zgui.prog.abap"))).to.equal(false);
    expect(existsSync(join(up, "README.md"))).to.equal(false);
    expect(existsSync(join(up, ".git"))).to.equal(false);
    // now it is a layer, below the pack's own folder
    const [again] = packsOf(root, {});
    expect(again.missing).to.deep.equal([]);
    expect(again.abap.map((f) => f.split("/").pop())).to.deep.equal(["upstream", "src"]);
    // and the marker says what was fetched
    const marker = JSON.parse(readFileSync(join(root, "packs/theirs", MARKER), "utf8"));
    expect(marker.upstream.commit).to.equal(commit);
    expect(marker.upstream.files).to.equal(3);
  });

  it("does nothing the second time at the same commit, and fetches again when the declaration moves", () => {
    fetchAll(root, {env: {}});
    const [pack] = packsOf(root, {});
    expect(fetchSource(pack, pack.sources[0]).fetched).to.equal(false);
    expect(fetchSource(pack, pack.sources[0], {force: true}).fetched).to.equal(true);
    // the repository moves on, and the manifest is re-pinned to a branch
    write(repo, "src/zcl_new.clas.abap", "CLASS zcl_new DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_new IMPLEMENTATION.\nENDCLASS.\n");
    rmSync(join(repo, "src/sub"), {recursive: true});
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "second"]);
    const second = git(["rev-parse", "HEAD"]);
    write(root, "packs/theirs/osd-pack.json", JSON.stringify({
      abap: ["upstream", "src"],
      sources: [{folder: "upstream", repo: repo, ref: "main", path: "src"}],
    }));
    const [moved] = packsOf(root, {});
    const answer = fetchSource(moved, moved.sources[0]);
    expect(answer.fetched).to.equal(true);
    expect(answer.commit).to.equal(second);
    // replaced whole: what the repository dropped is gone, what it added is there
    expect(existsSync(join(root, "packs/theirs/upstream/sub"))).to.equal(false);
    expect(existsSync(join(root, "packs/theirs/upstream/zcl_new.clas.abap"))).to.equal(true);
    expect(existsSync(join(root, "packs/theirs/upstream/zgui.prog.abap"))).to.equal(true);
  });

  it("refuses a path the repository does not have, and leaves nothing behind", () => {
    write(root, "packs/theirs/osd-pack.json", JSON.stringify({
      sources: [{folder: "upstream", repo: repo, ref: commit, path: "nowhere"}],
    }));
    const [pack] = packsOf(root, {});
    expect(() => fetchSource(pack, pack.sources[0])).to.throw(FetchFailed, "no /nowhere in it");
    expect(existsSync(join(root, "packs/theirs", MARKER))).to.equal(false);
  });
});
