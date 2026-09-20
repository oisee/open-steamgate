// The inventory of "who answers a path", and the drift check over it.
import {expect} from "chai";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {drift, hostRoutes, icfNodes, scoreboard, servedBy} from "../tools/osd-routes.mjs";
import {WORKS_IN, declaredNodes, nodes} from "../tools/osd-nodes.mjs";

// **This used to be a ratchet on the number of express routes that rival the
// ICF tree, and the number was the wrong one.** Alice's third correction:
// what the host serves can stay served by the host -- it only has to be
// declared. The ADT facade is meant to be JavaScript; A4H has ADT and the
// facade imitates it. So "12 rivals to migrate" was work nobody wanted done.
//
// What replaces it is drift, in both directions, the way `npm run parked`
// complains about a branch nothing explains AND an entry naming a branch
// that is gone. Both numbers must be zero, and a new express route makes the
// first one go red the moment it is written without a node beside it.
describe("tools/osd-routes: one inventory, and what nothing explains", () => {
  it("every express registration is explained by a declared node", async () => {
    const {unexplained} = await drift();
    expect(unexplained.map((r) => `${r.host}:${r.line} ${r.path}`),
      "declare it in src/icf/nodes.json and map it in SERVED_BY").to.deep.equal([]);
  });

  it("and every declared HOST node is served by one", async () => {
    const {unclaimed} = await drift();
    expect(unclaimed.map((n) => n.path),
      "the inventory names these and nothing answers on them").to.deep.equal([]);
  });

  // **The half that makes the two above worth running.** A check that has
  // only ever been green is a check whose red is untested -- the defect
  // class this repository has paid for twice (`some(none) || every(some)`,
  // and a suite that passed against a stale bundle). So the red is
  // constructed here, in both directions.
  it("an undeclared route is found: the check goes red on purpose", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-routes-"));
    const host = join(dir, "start.mjs");
    writeFileSync(host, 'app.get("/a-path-nobody-declared", (req, res) => res.end());\n');
    const {unexplained} = await drift({hosts: [host]});
    expect(unexplained.map((r) => r.path)).to.deep.equal(["/a-path-nobody-declared"]);
  });

  it("a node nothing serves is found too", async () => {
    // no hosts at all: every HOST node the inventory carries is then
    // unclaimed, which is the other direction of the same question
    const {unclaimed} = await drift({hosts: []});
    expect(unclaimed.length, "with no host read, every HOST node is unserved").to.be.greaterThan(5);
    expect(unclaimed.every((n) => n.type === "HOST")).to.equal(true);
  });

  it("a node's type says where it works, and the preview is a different promise", async () => {
    const all = await nodes(".", {proxies: false});
    for (const n of all) {
      expect(WORKS_IN[n.type], `${n.path} has a type the table knows`).to.not.equal(undefined);
      expect(n.worksIn, n.path).to.be.an("array");
    }
    // ABAP runs everywhere the ABAP runs; a JavaScript host has no browser
    const abap = all.find((n) => n.path === "/sap/bc/osd/status");
    expect(abap.type).to.equal("ABAP");
    expect(abap.worksIn).to.include("preview");
    const host = all.find((n) => n.path === "/osd/dumps");
    expect(host.type).to.equal("HOST");
    expect(host.worksIn, "process state never reaches the browser preview").to.not.include("preview");
  });

  it("travelling follows from where a node is declared, not from a flag", async () => {
    const all = await nodes(".", {proxies: false});
    // a SAP object travels; an entry in nodes.json is this host's own and
    // cannot, because on a system that object does not exist
    expect(all.filter((n) => n.type === "ABAP").every((n) => n.travels)).to.equal(true);
    expect(all.filter((n) => n.type === "HOST").every((n) => n.travels === false)).to.equal(true);
    for (const n of declaredNodes(".")) {
      expect(n.text, `${n.path} must say what it is`).to.have.length.greaterThan(10);
      expect(n.implementedIn, `${n.path} must name the file that serves it`).to.match(/\.mjs$/);
    }
  });

  it("an ICF node has a URL, and the handler list is a list", () => {
    const found = icfNodes("src");
    expect(found.length, "the tree has nodes to count").to.be.greaterThan(0);
    for (const n of found) {
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
    const se16 = found.find((n) => n.url.includes("/osd/se16/"));
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

  it("a registration with no literal path is a rival, not nothing", () => {
    // app.use(facade.router) -- the ADT facade -- used to be called
    // "plumbing" and no row counted plumbing, so the largest rival was
    // invisible. Body parsing still is plumbing; a router is not, and it is
    // now explained by one node, /sap/bc/adt, instead of thirteen rows.
    const all = hostRoutes();
    const nameless = all.filter((r) => r.path === "(no path: middleware)");
    expect(nameless.length).to.be.greaterThan(1);
    expect(nameless.some((r) => r.kind === "rival"), "a mounted router is a rival").to.equal(true);
    expect(nameless.some((r) => r.kind === "plumbing"), "express.raw is not").to.equal(true);
    expect(servedBy("test/start.mjs", "(no path: middleware)").node).to.equal("/sap/bc/adt");
    // and the one registration that is neither: it decorates every answer
    expect(servedBy("tools/osd-serve.mjs", "(no path: middleware)").wrapper)
      .to.have.length.greaterThan(10);
  });

  it("the scoreboard counts nodes by type and says what is unwired", async () => {
    const board = await scoreboard();
    expect(board.byType.ABAP, "the tree's own nodes").to.be.greaterThan(10);
    expect(board.byType.HOST, "declared, not migrated").to.be.greaterThan(0);
    expect(board.wiring.length, "the tree's own mount is not a route of its own").to.be.greaterThan(0);
  });
});
