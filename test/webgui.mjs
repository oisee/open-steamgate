import {expect} from "chai";
import {packsInfo, servicesOf} from "../tools/osd-status.mjs";
import {identity} from "../tools/osd-identity.mjs";
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

// the one row of ZOSD_SYS, through the service that serves it: the other
// source the status bar has to agree with
async function systemRow() {
  const answer = await (await fetch(`http://localhost:${PORT}/sap/opu/odata/sap/ZOSD_STATUS_SRV/SystemSet?$format=json`)).json();
  return answer.d.results[0];
}

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
    // G.1c: what we call ourselves does not carry somebody else's trademark,
    // so the title bar is "Easy Access" with the system beside it, where the
    // real screen puts the system. The comments in the class still say "SAP
    // Easy Access" where they describe the real one, which is a statement of
    // fact and stays true.
    expect(html, "the title bar").to.contain("Easy Access");
    expect(html, "and it is ours, not theirs").to.not.contain("SAP Easy Access");
    expect(html, "the slogan").to.contain("the next level of vaporware");
    // the picture is rain on a surface, not one drop, and it costs no script,
    // no bitmap and no second request
    expect(html, "the scene").to.contain('class="artscene"');
    expect(html, "rings where drops fell").to.contain('<ellipse');
    // still on purpose: a screen somebody works on all day should not move
    expect(html, "no animation at all").to.not.contain("<animate");
    expect(html, "no bitmap").to.not.contain("<img");
    expect(html, "the command field").to.contain('name="okcode"');
    expect(html, "the menu bar").to.contain("Favorites");
    // the image panel on the right, and the bulge in its left edge
    expect(html, "the image panel").to.contain('class="art"');
    expect(html, "the bulge").to.match(/<path d="M118,0 C22,230 22,670 118,900/);
  });

  // The single bead is gone (Alice, 2026-09-18): once the panel became rain
  // on a surface, the one oversized drop beside the wordmark was the only
  // object in the picture that was not part of the scene. What has to stay
  // true is the reason it was drawn rather than loaded.
  it("the panel is drawn, not loaded, and the lone bead is gone", () => {
    expect(page, "the rain scene").to.contain('class="artscene"');
    expect(page, "the bead").to.not.contain('class="artdrop"');
    expect(page, "and its path").to.not.contain('class="bead"');
    // nothing is loaded: no <img>, no SMW0 object, no second request
    expect(page, "not a bitmap").to.not.match(/<img[^>]+class="art/);
    // and the geometric stand-in it replaced is gone
    expect(page).to.not.contain('class="artgate"');
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

  // The menu bar does something, and what it does is read off the tree.
  //
  // Asserting the hrefs against a string typed here would only prove that two
  // literals match; they are asserted against the node the tree itself draws,
  // which is what "reuse its target" means.
  it("puts System > Status where the tree's own status node points", () => {
    const node = /<a class="leaf"[^>]*href="([^"]+)"[^>]*data-node="SM50"/.exec(page);
    expect(node, "the tree has a status node").to.not.equal(null);
    const item = /<a class="mx"[^>]*href="([^"]+)">Status</.exec(page);
    expect(item, "the menu has a Status entry").to.not.equal(null);
    expect(item[1]).to.equal(node[1]);
  });

  it("logs off to the launchpad, which is the favourite the tree carries", () => {
    const node = /<a class="leaf"[^>]*href="([^"]+)"[^>]*data-node="FLP"/.exec(page);
    const item = /<a class="mx"[^>]*href="([^"]+)">Log off</.exec(page);
    expect(item[1]).to.equal(node[1]);
  });

  it("greys what is not wired to anything instead of swallowing the click", () => {
    // every item of the bar is either an anchor or visibly disabled
    const items = page.match(/<(a|span) class="mx[^"]*"[^>]*>/g) ?? [];
    expect(items.length).to.be.greaterThan(10);
    for (const one of items) {
      if (one.startsWith("<span")) {
        expect(one, one).to.contain('aria-disabled="true"');
        expect(one, one).to.contain("mx off");
      } else {
        expect(one, one).to.contain("href=");
      }
    }
    // a top-level entry with nothing live under it says so too
    expect(page).to.match(/<span class="mt off" tabindex="0">Edit<\/span>/);
    expect(page).to.match(/<span class="mt" tabindex="0">System<\/span>/);
  });

  // the splitter is CSS: the tree pane resizes, and the page still has no
  // script on it at all
  it("has a draggable splitter and no JavaScript", () => {
    expect(page, "resize on the tree pane").to.match(/\.tree\{[^}]*resize:horizontal/);
    expect(page, "and the image takes what is left").to.match(/\.art\{flex:1 1 auto/);
    expect(page, "no script").to.not.match(/<script/i);
    expect(page, "no inline handler").to.not.match(/\son[a-z]+=/i);
  });

  // It resized from the first day and nobody could find it: a browser draws
  // the grip 16x16 in the pane's bottom-right corner, down by the node count,
  // and no property stretches it up the edge. So the boundary is drawn. What
  // is asserted here is what a person can see and reach -- a ridge that says
  // col-resize, a notch, the button that hides the picture and the one that
  // brings it back -- and that none of it cost a line of script.
  it("draws the boundary it resizes on, and can hide the picture without a script", () => {
    expect(page, "a ridge that says it can be pulled").to.match(/\.split\{[^}]*cursor:col-resize/);
    expect(page, "with a notch in the middle").to.contain(".split::after");
    expect(page, "the widened grip Blink draws off the scrollbar metrics").to.contain("::-webkit-resizer");
    expect(page, "the button that hides the picture").to.contain('class="splitbtn splithide" href="#nopic"');
    expect(page, "and the one that brings it back").to.contain('class="splitbtn splitshow"');
    // :target does the hiding through a sibling selector, so what matters is
    // that the anchor stands BEFORE the panes - not that it touches them.
    // Asserting the two next to each other broke the moment the width radios
    // were added between them, although the selector still worked: the test
    // was pinning the spelling instead of the property.
    expect(page, "the anchor before the panes").to.match(/<span id="nopic"><\/span>[^]*?<div class="body">/);
    // and the ridge itself moves the boundary when it is clicked, because a
    // col-resize cursor over something that does not resize is the same lie
    // as an enabled-looking button that does nothing
    expect(page, "four widths as radios").to.contain('type="radio" name="w" id="w1" checked');
    expect(page, "each step points at the next").to.contain('class="wstep to2" for="w2"');
    expect(page, "and the last wraps round").to.contain('class="wstep to1" for="w1"');
    expect(page, "a step changes the width").to.match(/#w2:checked~\.body \.tree\{width:\d+%\}/);
    expect(page, "and it hides the picture and widens the tree").to.contain("#nopic:target~.body .art{display:none}");
    expect(page, "the old one-pixel border is gone").to.not.match(/\.tree\{[^}]*border-right:1px/);
    expect(page, "still no script").to.not.match(/<script/i);
  });

  // Help > About: a page of the same class one path below the screen
  it("answers Help > About with the generation, the build and what the system is", async () => {
    expect(page, "the About entry").to.contain('href="/sap/bc/gui/sap/its/webgui/about"');
    const res = await fetch(`${BASE}about`);
    expect(res.status).to.equal(200);
    const html = await res.text();
    const system = await systemRow();
    expect(html, "the generation the facade built").to.contain(system.GenLive);
    expect(html, "what this system is").to.contain("open-steamgate");
    expect(html, "sy, named as sy").to.contain("sy-sysid");
    expect(html, "the work process").to.contain(String(system.Pid).trim());
    expect(html, "back to the screen").to.contain('href="/sap/bc/gui/sap/its/webgui/"');
  });

  // The status bar used to print "OSG (1) 100": an invented session and an
  // invented client. Now it prints what the system says it is, and the test
  // asks the other two sources rather than a string typed here.
  it("prints the system, the work process, the client and the user the rest of the system reports", async () => {
    const system = await systemRow();
    const who = identity();
    const bar = /<span class="dim" id="sysinfo">([^<]*)/.exec(page);
    expect(bar, "the status bar").to.not.equal(null);
    const text = bar[1];
    // the system id: what the status service reports, and what the boot set
    // sy-sysid to, are the same thing
    expect(system.Sid).to.equal(who.sid);
    expect(text, "the system").to.contain(who.sid);
    // the session number SAP prints is a work process here, and it is the
    // process the status tables were written in
    expect(Number(String(system.Pid).trim())).to.be.greaterThan(0);
    expect(text, "the work process").to.contain(`(${String(system.Pid).trim()})`);
    // the client and the user are sy-mandt and sy-uname, set at boot from
    // the one identity; nothing here is 100 or 1
    expect(text, "the client").to.contain(who.client);
    expect(text, "the user").to.contain(who.user);
    expect(text, "no invented session").to.not.contain("(1)");
    expect(text, "no invented client").to.not.contain(" 100 ");
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

  // The third kind of node: something the system runs rather than links to.
  // It runs since backlog G.3 and test/transaction.mjs is where that is
  // tested; what belongs here is that the screen still tells a transaction
  // from a link, and that the one node this class types out -- abapGit, the
  // seat G.4 will sit in -- is honest about what it is.
  it("knows a transaction from a link, and says what abapGit is still missing", async () => {
    const res = await fetch(`${BASE}?okcode=ZABAPGIT`, {redirect: "manual"});
    expect(res.status, "a transaction is entered, not redirected to").to.equal(200);
    const html = await res.text();
    // the status bar, not just the page: the node's own detail is in the tree
    // either way, and asserting the page would pass on a message that said
    // the opposite
    const bar = /<span class="msg" id="msg">([^<]*)/.exec(html)[1];
    expect(bar).to.contain("no zabapgit.tran.xml in this tree");
    expect(bar, "not a lie about something visibly in the menu").to.not.contain("does not exist");
    expect(html).to.contain('data-kind="TRANSACTION"');
  });
});
