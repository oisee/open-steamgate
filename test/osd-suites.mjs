// The reporter that says what a run could not look at. Both branches, because
// the branch that matters is the one a runner takes and a workstation never
// does -- and a reporter checked only where everything is present reports on
// the specimen made for it.
import {expect} from "chai";
import {OPTIONAL, reportSkips, listDrift, suitesOnDisk, hasSuites, assignShards, loadSuites, suggestSuiteFragment} from "../tools/osd-suites.mjs";
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";

describe("tools/osd-suites: a run says what it could not see", () => {
  it("names every absent input and why it mattered", () => {
    const said = [];
    const absent = reportSkips([["/nowhere/corpus", "the oracle"], ["/nowhere/two", "the other one"]], (l) => said.push(l));
    expect(absent.map(([p]) => p)).to.deep.equal(["/nowhere/corpus", "/nowhere/two"]);
    expect(said.join("\n")).to.contain("NOT looked at");
    expect(said.join("\n")).to.contain("/nowhere/corpus");
    expect(said.join("\n"), "the reason travels with the path").to.contain("the oracle");
  });

  it("and says so plainly when it saw everything", () => {
    const said = [];
    expect(reportSkips([[".", "this directory, which exists"]], (l) => said.push(l))).to.deep.equal([]);
    expect(said.join("\n")).to.contain("the wide one");
  });

  it("the real list names paths that are not in this repository", () => {
    expect(OPTIONAL.map(([p]) => p)).to.include.members([".local/corpus", ".local/lars"]);
    for (const [, why] of OPTIONAL) {
      expect(why, "every entry says what is lost without it").to.have.length.greaterThan(10);
    }
  });
});

// The list of suites, checked as the hand-kept list it is.
//
// It went ten files out of date without anybody noticing, and the ten all
// passed when run -- so nothing was hiding in them and a green run was simply
// answering a narrower question than it was read as. That is the direction
// drift always takes: the one that reads as progress.
describe("the suite list against the tree", () => {
  it("sorts merged suites alphabetically and refuses duplicates across files and groups", () => {
    const root = mkdtempSync(join(tmpdir(), "osd-suites-"));
    const dir = join(root, "test", "suites.d");
    try {
      mkdirSync(dir, {recursive: true});
      writeFileSync(join(dir, "z.json"), JSON.stringify({files: ["test/a.mjs"], groups: {packaging: ["test/z-package.mjs", "test/a-package.mjs"]}}));
      writeFileSync(join(dir, "a.json"), JSON.stringify({files: ["test/z.mjs"]}));
      expect(loadSuites(root)).to.deep.equal({files: ["test/a.mjs", "test/z.mjs"], groups: {packaging: ["test/a-package.mjs", "test/z-package.mjs"]}});
      writeFileSync(join(dir, "a.json"), JSON.stringify({files: ["test/a-package.mjs"]}));
      expect(() => loadSuites(root)).to.throw("duplicate suite test/a-package.mjs");
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("suggests the most specific feature fragment for new suite files", () => {
    expect(suggestSuiteFragment("test/osd-job-next.mjs")).to.equal("jobs.json");
    expect(suggestSuiteFragment("test/osd-apc-next.mjs")).to.equal("apc-daemons.json");
    expect(suggestSuiteFragment("test/osd-dataset-next.mjs")).to.equal("infra-misc.json");
    expect(suggestSuiteFragment("test/vscode-next.mjs")).to.equal("vscode.json");
    expect(suggestSuiteFragment("test/unclassified-next.mjs")).to.equal("infra-misc.json");
    expect(suggestSuiteFragment("test/tie-next.mjs", {"z.json": ["tie-"], "a.json": ["tie-"]})).to.equal("a.json");
  });

  it("names every file under test/ that has suites in it", () => {
    const {files, groups} = loadSuites();
    const listed = [...files, ...Object.values(groups).flat()];
    const drift = listDrift(suitesOnDisk("test"), listed);
    expect(drift.unlisted, `suites nobody runs: ${drift.unlisted.join(", ")}`).to.deep.equal([]);
    expect(drift.absent, `named but not there: ${drift.absent.join(", ")}`).to.deep.equal([]);
  });

  it("accepts the helper without a describe and lists packaging in its named group", () => {
    expect(hasSuites(readFileSync("test/helpers/vsix.mjs", "utf8"))).to.equal(false);
    const {files, groups} = loadSuites();
    expect(groups.packaging).to.deep.equal(["test/vscode-vsix-packaging.mjs"]);
    expect(files).not.to.include(groups.packaging[0]);
  });

  it("counts a file as a suite by the describe in it, not by a list of exceptions", () => {
    // test/setup.mjs, test/start.mjs, test/run.mjs and test/seed.mjs are
    // harness modules. They drop out because they have no `describe` of their
    // own, which is why the rule needs no exception list -- and an exception
    // list is the thing that drifts.
    expect(hasSuites("describe('x', () => {})")).to.equal(true);
    expect(hasSuites("import x from 'y';\ndescribe('y', () => {})")).to.equal(true);
    expect(hasSuites("export function startServer() {} // a describe( mentioned mid-line"),
      "a mention inside a line is not a suite").to.equal(false);
    expect(hasSuites("  describe('indented, so it is inside something else', () => {})"),
      "and neither is one nested in another block").to.equal(false);
  });

  it("reads the directory through its arguments, so it can be asked about a tree that is not this one", () => {
    const read = (p) => (p === "d/a.mjs" ? "describe('x', () => {})" : "export const x = 1;");
    expect(suitesOnDisk("d", read, () => ["a.mjs", "harness.mjs", "notes.md"])).to.deep.equal(["d/a.mjs"]);
  });

  it("complains in both directions, because one direction is half a checker", () => {
    expect(listDrift(["test/a.mjs"], []).unlisted).to.deep.equal(["test/a.mjs"]);
    expect(listDrift([], ["test/gone.mjs"]).absent).to.deep.equal(["test/gone.mjs"]);
    expect(listDrift(["test/a.mjs"], ["./test/a.mjs"]), "a leading ./ is the same file").to.deep.equal({unlisted: [], absent: []});
  });
});


describe("suite sharding", () => {
  it("partitions the real list into four disjoint shards", () => {
    const files = loadSuites().files;
    const seconds = JSON.parse(readFileSync("test/suite-timings.json", "utf8")).seconds;
    const all = assignShards(files, seconds, 4).flatMap((shard) => shard.files);
    expect(all.slice().sort()).to.deep.equal(files.slice().sort());
    expect(new Set(all).size).to.equal(files.length);
    expect(all).not.to.include("test/vscode-vsix-packaging.mjs");
  });
  it("rejects an unknown group", () => {
    const run = spawnSync(process.execPath, ["tools/osd-suites.mjs", "--group", "missing"], {encoding: "utf8"});
    expect(run.status).to.equal(2);
    expect(run.stderr).to.contain("unknown suite group missing");
  });
  it("covers every file exactly once and assigns unknown files the median weight", () => {
    const files = ["a", "b", "c", "d", "new"];
    const shards = assignShards(files, {a: 20, b: 8, c: 4, d: 2}, 4);
    const all = shards.flatMap((shard) => shard.files);
    expect(all.slice().sort()).to.deep.equal(files.slice().sort());
    expect(new Set(all).size).to.equal(files.length);
    expect(all).to.include("new");
    expect(shards.reduce((sum, shard) => sum + shard.seconds, 0)).to.equal(40);
    expect(assignShards(files.slice().reverse(), {a: 20, b: 8, c: 4, d: 2}, 4).map((s) => s.files.slice().sort()))
      .to.deep.equal(shards.map((s) => s.files.slice().sort()));
  });
});
