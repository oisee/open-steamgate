// The scoreboard for "who answers a path", as a ratchet.
import {expect} from "chai";
import {hostRoutes, icfNodes, needs, rivalCount, scoreboard} from "../tools/osd-routes.mjs";

// **The number that must go down.** Two sessions counted the registries
// independently on 2026-09-19 and both found four where there should be one.
// The migration is only real when a registry's *code* is deleted, so this is
// a ceiling and not a pin: lower it in the commit that shrinks a registry.
// Raising it is allowed and must say why in the commit message -- a new
// express route is not forbidden, it is a decision that now costs a sentence.
//
// It was 23, then 12, and is 15. Twenty-three counted the ICF mount itself
// and the middleware decorating paths that are already nodes, which are not
// rivals. Twelve then hid three registrations whose path is not a string
// literal -- including `app.use(facade.router)`, the ADT facade, which is 59
// router registrations of its own: the tool called them "plumbing" and no
// row counted plumbing, so the largest rival in the tree was invisible to
// the instrument built to find rivals. Fifteen is what is there.
//
// Both corrections came from adversarial review rather than from the tool,
// which is the argument for having one.
const CEILING = 14;

describe("tools/osd-routes: four registries answer one question", () => {
  it("counts them, and the count outside ICF is a ceiling that goes down", async () => {
    const board = await scoreboard();
    // **Counted without the destination bindings**, because those come from
    // `.local/destinations.json`, which is gitignored: locally the total is
    // one higher than on a runner, so a ceiling including them is slack by
    // exactly one on CI and would not catch the next express route. A
    // ratchet whose number depends on an untracked credential file is not a
    // ratchet. Found by an adversarial review.
    const tracked = board.filter((r) => r.name !== "destination bindings");
    const others = rivalCount(tracked);
    expect(others, `outside ICF: ${others}. Lower CEILING when a registry shrinks; raising it needs a reason in the commit`)
      .to.be.at.most(CEILING);
    expect(board.map((r) => r.name)).to.have.members(
      ["ICF nodes", "host routes (rival)", "host routes (mount/wrapper)", "pack mounts", "destination bindings"]);
    // the wiring row must never count against the proposal
    expect(board.find((r) => r.name.includes("mount/wrapper")).count,
      "the tree's own mount is not a rival registry").to.be.greaterThan(0);
  });

  it("an ICF node has a URL, and the handler list is a list", () => {
    const nodes = icfNodes("src");
    expect(nodes.length, "the tree has nodes to count").to.be.greaterThan(0);
    for (const n of nodes) {
      expect(n.url, n.file).to.match(/^\/.*\/$/);
      expect(n.handlers, n.file).to.be.an("array");
    }
    // A real UI5 application node carries no handler at all and inherits one
    // from its branch (measured on A4H, 2026-09-19), so "no handler" is a
    // valid node. The first version of this assertion was
    // `some(none) || every(some)`, which is true of every possible input --
    // a test that cannot go red, in a suite added the same night as the rule
    // against them. Found by an adversarial review. What it should say is
    // that the parser reads the handler that IS there:
    const se16 = nodes.find((n) => n.url.includes("/osd/se16/"));
    expect(se16, "the se16 node is in the tree").to.not.equal(undefined);
    expect(se16.handlers, "a node's handler is read, not guessed").to.deep.equal(["ZCL_OSD_SE16"]);
  });

  it("reads every host, because three hosts disagreeing is the defect", () => {
    const routes = hostRoutes();
    const hosts = new Set(routes.map((r) => r.host));
    expect(hosts.size, "at least the two express hosts are read").to.be.greaterThan(1);
    for (const r of routes) {
      expect(r.method).to.match(/^(all|use|get|post|put|delete)$/);
      expect(r.line).to.be.greaterThan(0);
    }
  });

  it("every rival carries a declared verdict with a reason, and none is unjudged", () => {
    // The verdict used to be guessed from source text and was wrong in both
    // directions -- `status\b` matched `res.status(500)`, a twelve-line
    // window picked up the next route's `express.static`. It is declared
    // now, so being wrong is something somebody wrote and can be argued
    // with. The test the guess could not pass: a route nobody has judged is
    // an error rather than a default.
    const rivals = hostRoutes().filter((r) => r.kind === "rival");
    expect(rivals.length).to.be.greaterThan(0);
    const unjudged = rivals.filter((r) => r.judged === false);
    expect(unjudged.map((r) => `${r.host}:${r.line} ${r.path}`),
      "add each to VERDICTS with a reason").to.deep.equal([]);
    for (const r of rivals) {
      expect(r.needs, `${r.path}`).to.be.oneOf(["pure", "fs", "state"]);
      expect(r.because, `${r.path} must say why`).to.have.length.greaterThan(10);
    }
    // and the one the guess hid is gone: POST /osd/status is an ICF node
    // now (/sap/bc/osd/status/, ZCL_OSD_STATUS_HTTP), so it is not a rival
    // any more and the ceiling came down with it
    expect(rivals.find((r) => r.path === "/osd/status"), "migrated to a node").to.equal(undefined);
    expect(icfNodes("src").some((n) => n.url === "/sap/bc/osd/status/"), "and the node is there").to.equal(true);
  });

  it("a registration with no literal path is a rival, not nothing", () => {
    // app.use(facade.router) -- the ADT facade -- used to be called
    // "plumbing" and no row counted plumbing, so the largest rival was
    // invisible. Body parsing still is plumbing; a router is not.
    const all = hostRoutes();
    const nameless = all.filter((r) => r.path === "(no path: middleware)");
    expect(nameless.length).to.be.greaterThan(1);
    expect(nameless.some((r) => r.kind === "rival"), "a mounted router is a rival").to.equal(true);
    expect(nameless.some((r) => r.kind === "plumbing"), "express.raw is not").to.equal(true);
  });
});
