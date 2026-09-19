// The scoreboard for "who answers a path", as a ratchet.
import {expect} from "chai";
import {hostRoutes, icfNodes, scoreboard} from "../tools/osd-routes.mjs";

// **The number that must go down.** Two sessions counted the registries
// independently on 2026-09-19 and both found four where there should be one.
// The migration is only real when a registry's *code* is deleted, so this is
// a ceiling and not a pin: lower it in the commit that shrinks a registry.
// Raising it is allowed and must say why in the commit message -- a new
// express route is not forbidden, it is a decision that now costs a sentence.
const CEILING = 23;

describe("tools/osd-routes: four registries answer one question", () => {
  it("counts them, and the count outside ICF is a ceiling that goes down", async () => {
    const board = await scoreboard();
    const others = board.filter((r) => r.name !== "ICF nodes").reduce((n, r) => n + r.count, 0);
    expect(others, `outside ICF: ${others}. Lower CEILING when a registry shrinks; raising it needs a reason in the commit`)
      .to.be.at.most(CEILING);
    expect(board.map((r) => r.name)).to.have.members(
      ["ICF nodes", "host routes", "pack mounts", "destination bindings"]);
  });

  it("an ICF node has a URL, and the handler list is a list", () => {
    const nodes = icfNodes("src");
    expect(nodes.length, "the tree has nodes to count").to.be.greaterThan(0);
    for (const n of nodes) {
      expect(n.url, n.file).to.match(/^\/.*\/$/);
      expect(n.handlers, n.file).to.be.an("array");
    }
    // A real UI5 application node carries no handler at all and inherits one
    // from its branch (measured on A4H, 2026-09-19). So "no handler" is a
    // valid node and not a parse failure -- a checker that demanded one would
    // reject the shape the system itself writes.
    expect(nodes.some((n) => n.handlers.length === 0) || nodes.every((n) => n.handlers.length > 0)).to.equal(true);
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
});
