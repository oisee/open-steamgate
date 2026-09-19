// A branch of a whole system: the plumbing, and the two quiet ways it lies.
//
// The worktree half already existed (`tools/osd-worktree.mjs`, which shares
// node_modules, .local/lars and .local/tls by symlink) and was nearly written
// a second time. What W.1 needs on top is small and is all about isolation:
// its own port, its own database file, and knowing when the tree is not
// actually ready to be compared with anything.
//
// Both failures here are quiet rather than loud, which is why they are
// tested:
//
//   a port picked from a range works most of the time, and when it does not,
//   two branches do not error -- they answer each other's requests
//
//   an unbuilt tree LISTENS. It answers 503 to everything, so the first
//   replay against one reported thirteen differences of "200 against 503",
//   which is a true statement about nothing
import {expect} from "chai";
import {existsSync} from "node:fs";
import {safeName, databaseFor, freePort, missingPackages, isBuilt, environmentFor} from "../tools/osd-branch.mjs";

describe("two branches cannot share what makes them one system", () => {
  it("each branch has a database file of its own, named for it", () => {
    const a = databaseFor("alpha");
    const b = databaseFor("beta");
    expect(a).to.not.equal(b);
    expect(a).to.contain("branch-alpha");
  });

  it("a name that is a ref becomes a name that is a path", () => {
    expect(safeName("feature/thing")).to.equal("feature-thing");
    expect(safeName("HEAD~1")).to.equal("HEAD-1");
    expect(safeName("///"), "a name that sanitises to nothing still has to be a directory").to.equal("branch");
  });

  it("a port is asked of the operating system, not guessed from a range", async () => {
    const a = await freePort();
    expect(a).to.be.a("number").and.be.greaterThan(1024);
    // the first version read address() on the line after listen() and
    // destructured null: `listen` is asynchronous and the socket is not open
    // yet. A guess from a range would have worked most of the time, which is
    // worse -- two systems on one port answer each other's requests.
    expect(await freePort()).to.be.a("number");
  });
});

describe("a tree that is not ready says so, instead of answering 503", () => {
  it("a tree with no output/ is not built", () => {
    expect(isBuilt("/nowhere/at/all")).to.equal(false);
  });

  it("and this checkout, which is built, is", () => {
    expect(isBuilt(process.cwd()), "run npm run transpile if this fails").to.equal(existsSync("output/init.mjs"));
  });
});

describe("a shared install is wrong the moment the ref disagrees with it", () => {
  it("names nothing for the checkout we are standing in", () => {
    expect(missingPackages("HEAD"), "HEAD's dependencies are the ones installed here").to.deep.equal([]);
  });
});

describe("the environment is what makes the server the branch's own", () => {
  it("carries the port, the file and nothing shared", () => {
    const env = environmentFor({port: 44429, database: "/tmp/x.sqlite"});
    expect(env.STG_PORT).to.equal("44429");
    expect(env.STG_DB).to.equal("file");
    expect(env.STG_DB_PATH).to.equal("/tmp/x.sqlite");
    expect(env.STG_SQL_TRACE, "a trace is asked for, not assumed").to.equal(undefined);
  });

  it("and takes a trace when one is asked for, which is how the second sieve is fed", () => {
    expect(environmentFor({port: 1, database: "x"}, {trace: "t.ndjson"}).STG_SQL_TRACE).to.equal("t.ndjson");
  });
});

// A tool that promises isolation has to name what it does not isolate, or
// the promise is the wider claim.
describe("what a branch does not isolate is listed, not implied", () => {
  it("names the library clones, which are ONE checkout shared by every worktree", async () => {
    const {NOT_ISOLATED} = await import("../tools/osd-branch.mjs");
    const lars = NOT_ISOLATED.find((one) => one.path === ".local/lars");
    expect(lars, "the sharing that cost a count").to.not.equal(undefined);
    expect(lars.why).to.contain("ONE checkout");
  });

  it("and every entry says why, because a list of exceptions without reasons is a list of excuses", async () => {
    const {NOT_ISOLATED} = await import("../tools/osd-branch.mjs");
    for (const one of NOT_ISOLATED) {
      expect(one.why, one.path).to.be.a("string").and.have.length.greaterThan(20);
    }
  });
});

// **A number must not be able to travel without the state it was taken in.**
//
// Two sessions read the object store 55 seconds apart and got 1140 and 1134.
// Both readings were correct and they were of different systems: the library
// clones are ONE checkout shared by every worktree, and one session had moved
// open-abap-core onto a PR branch twenty upstream commits away, carrying
// exactly the six objects of the difference -- four DTEL, one CLAS, one INTF.
describe("a count is printed with the state it was taken in", () => {
  it("names every library the build reads, and whether it is a clone at all", async () => {
    const {libraryState} = await import("../tools/osd-branch.mjs");
    const state = libraryState();
    expect(state.length, "abap_transpile.json lists six").to.be.greaterThan(1);
    for (const one of state) {
      expect(one.folder).to.be.a("string");
      expect(one.head ?? (one.missing ? "missing" : undefined), one.folder).to.be.a("string");
    }
  });

  // The trap this function fell into in its first minute.
  it("never reports the ENCLOSING repository as a library's state", async () => {
    const {libraryState} = await import("../tools/osd-branch.mjs");
    const {execFileSync} = await import("node:child_process");
    const ours = execFileSync("git", ["rev-parse", "--short", "HEAD"], {encoding: "utf8"}).trim();
    // `git -C` in a plain folder answers about the repository above it,
    // silently. `.local/lars/open-abap-apc` is such a folder, and the first
    // version reported open-steamgate's own HEAD as its library's -- a
    // number travelling with somebody else's state, which is worse than one
    // travelling with none.
    for (const one of libraryState()) {
      expect(one.head, `${one.folder} reported this repository's HEAD`).to.not.equal(ours);
    }
    expect(libraryState().some((one) => one.head === "not a clone"),
      "and the folder that is not a clone says so rather than borrowing a hash").to.equal(true);
  });

  it("the whole state carries a time, a count and the libraries together", async () => {
    const {systemState} = await import("../tools/osd-branch.mjs");
    const state = await systemState();
    expect(state.at).to.match(/^\d{4}-\d{2}-\d{2}T/);
    expect(state.objects).to.be.a("number").and.be.greaterThan(100);
    expect(state.types[0][1], "sorted, commonest first").to.be.greaterThan(1);
    expect(state.libraries, "a count without them is not comparable with anybody else's")
      .to.have.length.greaterThan(1);
  });
});
