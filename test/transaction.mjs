import {expect} from "chai";
import {transactions} from "../tools/osd-tran-registry.mjs";
import {startServer} from "./start.mjs";
// the port of the gateway under test: STG_PORT, as test/start.mjs reads it, so sessions do not collide on 3030
const PORT = process.env.STG_PORT ?? 3030;

// A transaction node that actually runs, and a conversation that survives the
// request it started in (backlog G.3, docs/webgui.md).
//
// The three things being tested are three different things and the tests are
// kept apart accordingly:
//
//   the registry   a transaction is a *.tran.xml of the layers, and whether
//                  it can be entered here is decided from what it names
//   the running    ZOSD_NOTE draws through cl_gui_html_viewer and the screen
//                  puts that where the tree is, keeping its own chrome
//   the session    what was typed in the first request is there in the
//                  second, two browsers do not see each other, and an id
//                  this system does not have is refused rather than quietly
//                  started over
//
// The browser is played by hand here, the way test/sapevent.mjs plays it;
// test/e2e/transaction.spec.mjs lets Chromium do it.
const BASE = `http://localhost:${PORT}/sap/bc/gui/sap/its/webgui/`;

// The document inside the HTML viewer's sandboxed iframe, with the attribute
// escaping taken off. What the document escaped itself stays escaped, because
// that is the document: a note typed with an "&" in it is "&amp;" in there,
// and the browser is the one that turns it back.
//
// undefined when there is no frame at all, which is a real answer: a screen
// that refused to run a transaction has a tree in that pane and no viewer.
function frameDocument(page) {
  const match = /srcdoc="([^"]*)"/.exec(page);
  if (match === null) {
    return undefined;
  }
  return match[1]
    .replaceAll("&quot;", "\"")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

const statusBar = (page) => /<span class="msg" id="msg">([^<]*)/.exec(page)?.[1] ?? "";
const notes = (doc) => [...doc.matchAll(/<li data-note="\d+">([^<]*)</g)].map((m) => m[1]);
const session = (doc) => /name="osdsid" value="([^"]*)"/.exec(doc)?.[1];
const control = (doc) => /name="gg_control" value="([^"]*)"/.exec(doc)?.[1];
const draft = (doc) => /id="note" value="([^"]*)"/.exec(doc)?.[1] ?? "";

// what the browser posts when a button of the notepad's form is pressed: the
// form's own fields, the transport's hidden ones, and the action in the url
// of the form or of the button that carries a formaction
async function press(doc, note, button = "add") {
  const form = /<form[^>]*action="([^"]*)"[^>]*>/.exec(doc);
  const side = new RegExp(`id="${button}"[^>]*formaction="([^"]*)"`).exec(doc);
  const url = new URL(side?.[1] ?? form[1], BASE);
  const body = new URLSearchParams({
    note,
    osdsid: session(doc),
    gg_control: control(doc),
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {"content-type": "application/x-www-form-urlencoded"},
    body: body.toString(),
  });
  const page = await res.text();
  return {res, page, doc: frameDocument(page)};
}

// entering a transaction from the command field, which is how a person does it
async function enter(tcode) {
  const page = await (await fetch(`${BASE}?okcode=${encodeURIComponent(tcode)}`)).text();
  const doc = frameDocument(page);
  expect(doc, `${tcode} drew nothing: ${statusBar(page)}`).to.not.equal(undefined);
  return {page, doc};
}

describe("webgui: a transaction node that runs, and keeps its session", () => {
  let server;

  before(() => {
    server = startServer(true);
  });

  after(() => {
    server.close();
  });

  // ------------------------------------------------------------- the registry

  // the list is derived from the tran objects of the layers, not typed out,
  // and the assertion is against the generator rather than against a string
  it("has a node for every transaction the *.tran.xml objects declare", async () => {
    const page = await (await fetch(BASE)).text();
    const declared = transactions([process.cwd() + "/src", process.cwd() + "/gen"]);
    expect(declared.length, "at least the notepad and a refused one").to.be.greaterThan(1);
    for (const one of declared) {
      expect(page, one.tcode).to.contain(`data-node="${one.tcode}"`);
      if (one.runnable) {
        expect(page, `${one.tcode} is entered by its own code`).to.contain(`?okcode=${one.tcode}"`);
      } else {
        // a transaction that cannot be entered here carries the reason where
        // the others carry their class, rather than being hidden
        expect(page, `${one.tcode} says why not`).to.contain(one.reason);
      }
    }
  });

  it("still knows a transaction from a link, and abapGit is still the seat for G.4", async () => {
    const page = await (await fetch(BASE)).text();
    expect(page).to.contain('data-kind="TRANSACTION"');
    expect(page, "the one node this class types out").to.contain("no zabapgit.tran.xml in this tree");
    const res = await fetch(`${BASE}?okcode=ZABAPGIT`, {redirect: "manual"});
    expect(res.status, "a transaction is not a redirect").to.equal(200);
    // and the status bar says what is missing rather than "does not exist",
    // which is what it used to say about a node the menu was showing
    expect(statusBar(await res.text())).to.contain("cannot be started here: no zabapgit.tran.xml in this tree");
  });

  it("refuses a report transaction with the reason, which is measured and not a guess", async () => {
    // fetched rather than entered: a refusal draws no document, so there is
    // no frame for the helper to look for
    const html = await (await fetch(`${BASE}?okcode=ZOSD_TEST_DEMO`)).text();
    expect(statusBar(html)).to.contain("SUBMIT is not implemented by the transpiler");
    // and the screen is the screen: the tree is back where it was
    expect(html).to.contain('<div class="tree" title=');
  });

  it("answers a code that is not a transaction at all the way it always did", async () => {
    const html = await (await fetch(`${BASE}?okcode=ZNOPE`)).text();
    expect(statusBar(html)).to.equal("Transaction ZNOPE does not exist");
  });

  // -------------------------------------------------------------- the running

  it("enters the notepad and puts what it drew where the tree is, keeping the screen", async () => {
    const {page, doc} = await enter("ZOSD_NOTE");
    // the screen is still the screen
    // G.1c: the screen is "Easy Success" now - a name of our own, which is
    // the whole of the rule
    expect(page, "the title bar").to.contain("Easy Success");
    expect(page, "the command field").to.contain('name="okcode"');
    expect(page, "the menu bar").to.contain("Favorites");
    expect(page, "the image panel").to.contain('class="art"');
    // and the left pane is the transaction rather than the tree
    expect(page, "the pane says what is running").to.contain('data-transaction="ZOSD_NOTE - Session notepad"');
    expect(page, "a way back out").to.contain('class="runexit"');
    expect(page, "no tree under a running transaction").to.not.contain('<div class="tree" title=');
    expect(statusBar(page)).to.contain("Session notepad started");

    // the document came through cl_gui_control=>render_html: the viewer's
    // frame, and no sapevent left anywhere in the markup
    expect(page).to.contain('title="HTML viewer"');
    expect(doc, "the notepad's own form").to.contain('id="note-form"');
    expect(doc).to.not.contain('action="sapevent:');
    expect(doc).to.not.contain('formaction="sapevent:');
    // it posts back to the dialog-step path with the session beside it
    expect(doc).to.contain("/sap/bc/gui/sap/its/webgui/tx/?okcode=add");
    expect(session(doc), "the session id travels in the document").to.match(/^[0-9A-F]{32}$/);
    expect(control(doc), "and the viewer it belongs to").to.match(/^GUI-\d+$/);
    expect(notes(doc), "a new session starts empty").to.deep.equal([]);
  });

  // -------------------------------------------------------------- the session

  it("what was typed in the first request is there in the second, and in the third", async () => {
    const first = await enter("ZOSD_NOTE");
    const id = session(first.doc);

    const second = await press(first.doc, "hello from request one");
    expect(second.res.status).to.equal(200);
    expect(notes(second.doc)).to.deep.equal(["hello from request one"]);
    expect(session(second.doc), "the same session, not a new one").to.equal(id);
    expect(statusBar(second.page)).to.contain("1 in this session");

    const third = await press(second.doc, "and from request two");
    expect(notes(third.doc)).to.deep.equal(["hello from request one", "and from request two"]);
    expect(session(third.doc)).to.equal(id);
    expect(statusBar(third.page)).to.contain("2 in this session");
  });

  it("a text with the characters the transport is built from survives the trip", async () => {
    const first = await enter("ZOSD_NOTE");
    // & = % are exactly what the post data is escaped with on the way in
    const typed = "100% & = a note";
    const second = await press(first.doc, typed);
    expect(notes(second.doc)).to.deep.equal(["100% &amp; = a note"]);
  });

  it("a click this transaction has no action for says so instead of redrawing", async () => {
    const first = await enter("ZOSD_NOTE");
    const cleared = await press(first.doc, "kept in the field", "clear");
    expect(statusBar(cleared.page)).to.contain("empty again");
    // Clear puts what was typed back in the field: the state is the state
    expect(draft(cleared.doc)).to.equal("kept in the field");
  });

  it("two sessions do not see each other", async () => {
    const alice = await enter("ZOSD_NOTE");
    const bob = await enter("ZOSD_NOTE");
    expect(session(alice.doc)).to.not.equal(session(bob.doc));

    const alice2 = await press(alice.doc, "a note of the first browser");
    const bob2 = await press(bob.doc, "a note of the second browser");
    expect(notes(alice2.doc)).to.deep.equal(["a note of the first browser"]);
    expect(notes(bob2.doc)).to.deep.equal(["a note of the second browser"]);

    // and going on in the first one still only sees the first one's notes
    const alice3 = await press(alice2.doc, "and another one there");
    expect(notes(alice3.doc)).to.deep.equal(["a note of the first browser", "and another one there"]);
  });

  it("an id this system does not have is refused rather than half-answered", async () => {
    const first = await enter("ZOSD_NOTE");
    const doc = first.doc.replace(session(first.doc), "F".repeat(32));
    const res = await press(doc, "into the void");
    expect(res.res.status).to.equal(200);
    expect(statusBar(res.page)).to.contain("is not open here: it expired, or it was never started");
    // it does not quietly start a fresh transaction, which is how a lost
    // conversation hides: the screen comes back with the tree in it and no
    // viewer at all
    expect(res.doc, "nothing was drawn").to.equal(undefined);
    expect(res.page).to.contain('<div class="tree" title=');
    expect(res.page).to.not.contain('title="HTML viewer"');
  });

  it("a post naming no session at all is refused the same way", async () => {
    const res = await fetch(`${BASE}tx/?okcode=add`, {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded"},
      body: "note=nothing&gg_control=GUI-2",
    });
    expect(res.status).to.equal(200);
    expect(statusBar(await res.text())).to.contain("is not open here");
  });
});
