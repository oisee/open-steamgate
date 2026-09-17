import {expect} from "chai";
import {packsInfo, servicesOf} from "../tools/osd-status.mjs";
import {startServer} from "./start.mjs";
// the port of the gateway under test: STG_PORT, as test/start.mjs reads it, so sessions do not collide on 3030
const PORT = process.env.STG_PORT ?? 3030;

// SAP Easy Access, served by ZCL_OSD_WEBGUI at the path the real ITS webgui
// answers on. Two things are worth a test here and they are different things:
// that the screen is there, and that what is on it is this system rather than
// a list somebody typed out. The second is checked against the same functions
// the facade takes its snapshot with (tools/osd-status.mjs), so a service
// added anywhere in the tree has to appear in the menu or this fails.
const BASE = `http://localhost:${PORT}/sap/bc/gui/sap/its/webgui/`;

describe("webgui: SAP Easy Access", () => {
  let server;
  let page;

  before(async () => {
    server = startServer(true);
    page = await (await fetch(BASE)).text();
  });

  after(() => {
    server.close();
  });

  it("answers on the ITS webgui path, as the Easy Access screen", async () => {
    const res = await fetch(BASE);
    expect(res.status).to.equal(200);
    expect(res.headers.get("content-type")).to.contain("text/html");
    const html = await res.text();
    expect(html, "the title bar").to.contain("SAP Easy Access");
    expect(html, "the command field").to.contain('name="okcode"');
    expect(html, "the menu bar").to.contain("Favorites");
    // the image panel on the right, and the bulge in its left edge
    expect(html, "the image panel").to.contain('class="art"');
    expect(html, "the bulge").to.match(/<path d="M118,0 C22,230 22,670 118,900/);
  });

  it("without the path's trailing slash too, the way express serves the node", async () => {
    const res = await fetch(`http://localhost:${PORT}/sap/bc/gui/sap/its/webgui`);
    expect(res.status).to.equal(200);
  });

  // the tree is the inventory, not a copy of it
  it("has a node for every OData service the registry declares", () => {
    const odata = servicesOf(process.cwd()).filter((one) => one.kind === "ODATA");
    expect(odata.length).to.be.greaterThan(4);
    for (const one of odata) {
      const name = one.path.split("/").pop();
      expect(page, name).to.contain(`data-node="${name}"`);
      expect(page, `${name} points at itself`).to.contain(`href="${one.path}/"`);
    }
  });

  it("has a node for every ICF service and every push channel", () => {
    const found = servicesOf(process.cwd());
    for (const one of found.filter((s) => s.kind === "ICF")) {
      expect(page, one.path).to.contain(`href="${one.path}"`);
    }
    for (const one of found.filter((s) => s.kind === "APC")) {
      // a websocket has no page; the node names the class that answers it
      expect(page, one.path).to.contain(one.handler);
    }
    // the screen itself is an ICF service of this system, and says so
    expect(page).to.contain("ZCL_OSD_WEBGUI");
  });

  it("has a node for every Fiori app, at the intent its manifest declares", () => {
    const apps = servicesOf(process.cwd()).filter((one) => one.kind === "APP");
    expect(apps.length).to.be.greaterThan(3);
    for (const one of apps) {
      expect(page, one.text).to.contain(`href="${one.path}"`);
      expect(page, one.text).to.contain(one.text);
    }
  });

  it("has a node for every content pack", () => {
    for (const one of packsInfo(process.cwd())) {
      expect(page, one.name).to.contain(`data-node="${one.name.toUpperCase()}"`);
    }
  });

  // the command field is the second way in, and it is resolved on the server
  // against the same list the tree is built from
  it("takes an ok-code to where clicking the node goes", async () => {
    const res = await fetch(`${BASE}?okcode=ZSTG_DEMO_SRV`, {redirect: "manual"});
    expect(res.status).to.equal(302);
    expect(res.headers.get("location")).to.equal("/sap/opu/odata/sap/ZSTG_DEMO_SRV/");
  });

  it("takes the name a node is called by, and strips /n the way SAP does", async () => {
    const res = await fetch(`${BASE}?okcode=%2FnSystem+status`, {redirect: "manual"});
    expect(res.status).to.equal(302);
    expect(res.headers.get("location")).to.equal("/app/flp.html#System-status");
  });

  it("answers an unknown code with the message SAP puts in the status bar", async () => {
    const html = await (await fetch(`${BASE}?okcode=ZNOPE`)).text();
    expect(html).to.contain("Transaction ZNOPE does not exist");
  });

  // the third kind of node: something the system runs rather than links to.
  // One entry, and it is honest about not being one yet (docs/webgui.md).
  it("knows a transaction from a link, and says the transaction is not runnable yet", async () => {
    const res = await fetch(`${BASE}?okcode=ZABAPGIT`, {redirect: "manual"});
    expect(res.status).to.equal(200);
    const html = await res.text();
    expect(html).to.contain("ZABAPGIT is not runnable yet");
    expect(html).to.contain('data-kind="TRANSACTION"');
  });
});
