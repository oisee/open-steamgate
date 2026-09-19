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
