// The inventory of "who answers a path", and the drift check over it.
import {expect} from "chai";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {drift, hostRoutes, icfNodes, scoreboard, servedBy} from "../tools/osd-routes.mjs";
import {SAP_DELIVERED, WORKS_IN, declaredNodes, deliveredAt, nodes} from "../tools/osd-nodes.mjs";

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
    // the other direction: a declaration naming a host file that does not
    // implement its handler. Built rather than hoped for, because this check
    // is the one that keeps the inventory from naming things nothing answers
    const dir = mkdtempSync(join(tmpdir(), "osd-nodes-"));
    mkdirSync(join(dir, "src", "icf"), {recursive: true});
    writeFileSync(join(dir, "abap_transpile.json"), JSON.stringify({input_folder: ["src"]}));
    writeFileSync(join(dir, "empty-host.mjs"), "// a host with no hostNodes table at all\n");
    writeFileSync(join(dir, "src", "icf", "nodes.json"), JSON.stringify({
      "/nowhere": {type: "HOST", host: join(dir, "empty-host.mjs"), handler: "nobody", text: "declared and unimplemented"},
    }));
    const {unclaimed} = await drift({at: dir, hosts: [], proxies: false});
    expect(unclaimed.map((n) => n.path)).to.deep.equal(["/nowhere"]);
    rmSync(dir, {recursive: true, force: true});
  });

  it("a node's type says where it works, and the preview is a different promise", async () => {
    const all = nodes(".", {proxies: false});
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
    const all = nodes(".", {proxies: false});
    // **The two questions are not one.** `type` is what implements the node
    // -- an ABAP class, a function of this host, another system. `travels`
    // is whether the NODE is a SAP object, and that is exactly whether it
    // was declared in a *.sicf.xml. Keeping them apart is what lets the
    // OData front say the true thing about itself: its handler is ABAP and
    // its node is not an object yet, which is a gap somebody should close
    // rather than a wording to argue about.
    // and there is exactly one exception, which is a second reason and not
    // a second flag: a node that would REPLACE a delivered one is a SAP
    // object and still must not leave.
    for (const n of all) {
      expect(n.travels, `${n.path} travels iff it is a SAP object that replaces nothing`)
        .to.equal(/\.(sicf|sapc)\.xml$/.test(n.source ?? "") && n.shadows === undefined);
    }
    expect(all.filter((n) => n.type === "HOST").every((n) => n.travels === false)).to.equal(true);
    const odata = all.find((n) => n.path === "/sap/opu/odata/sap");
    expect(odata.type, "the front is an ABAP class behind the shim").to.equal("ABAP");
    expect(odata.travels, "and its node is not an object yet").to.equal(false);
    expect(odata.mountedElsewhere, "a node attached by code of its own must say why")
      .to.have.length.greaterThan(20);
    for (const n of declaredNodes(".")) {
      expect(n.text, `${n.path} must say what it is`).to.have.length.greaterThan(10);
      expect(n.implementedIn, `${n.path} must name the file that serves it`).to.match(/\.mjs$/);
    }
  });

  it("a node that would replace a delivered one does not travel", async () => {
    // **The hazard, named.** OSD answers on the real paths on purpose -- it
    // is a doppelganger and the same URL is the point. What must not happen
    // is the OBJECT travelling: `ICFSERVICE` is keyed by the node, abapGit
    // writes the row, and an import would take a system's own WebGUI or UI5
    // repository away from it. Three of this tree's *.sicf.xml sit on such
    // a path today.
    const all = nodes(".", {proxies: false});
    const shadowing = all.filter((n) => n.shadows !== undefined);
    expect(shadowing.map((n) => n.path).sort()).to.deep.equal(
      ["/sap/bc/gui/sap/its/webgui", "/sap/bc/gui/sap/its/webgui/sapevent", "/sap/bc/ui5_ui5/sap"]);
    for (const n of shadowing) {
      expect(n.travels, `${n.path} must not transport`).to.equal(false);
      expect(n.shadows, `${n.path} must say what it would replace`).to.have.length.greaterThan(30);
    }
    // **A child of a delivered node is not the same thing.** That is how a
    // Fiori application and a push channel reach a system at all -- measured
    // on A4H -- and flagging it would flag the thing that works.
    expect(deliveredAt("/sap/bc/ui5_ui5/sap/zosd_008_app")).to.equal(undefined);
    const channel = all.find((n) => n.path === "/sap/bc/apc/sap/zstg_apc_demo");
    expect(channel.shadows, "a push channel under SAP's apc node is normal").to.equal(undefined);
    expect(channel.travels).to.equal(true);
    for (const reason of Object.values(SAP_DELIVERED)) {
      expect(reason, "each entry says how it is known").to.have.length.greaterThan(30);
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
    const nameless = hostRoutes().filter((r) => r.path === "(no path: middleware)");
    expect(nameless.length).to.be.greaterThan(1);
    expect(nameless.some((r) => r.kind === "plumbing"), "express.raw is not a route").to.equal(true);
    // The façade's own `app.use(facade.router)` is not in this list any
    // more: it is registered from the registry, under the node
    // /sap/bc/adt, so the scan no longer sees a path list to judge.
    const all = nodes(".", {proxies: false});
    expect(all.find((n) => n.path === "/sap/bc/adt")?.handler).to.equal("adt-facade");
    // the one registration that is a route and is neither a node nor a
    // mount: it decorates every answer with the generation that produced it
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
