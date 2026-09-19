import {expect} from "chai";
import {readFileSync} from "node:fs";
import {startServer} from "./start.mjs";

// The editor screen (backlog G.8, /sap/bc/osd/edit/): pick an object, change
// its source, check it, activate it -- in a browser, with no JavaScript.
//
// The seam under it has its own suite (`test/store-destination.mjs`). What
// is asserted here is what only a running screen can say, and the first of
// them is the defect that made the screen useless on its first run: a form
// posted to it arrived with **no form fields**, because the shim fills them
// from the query string alone, so every button silently answered the object
// list as though nobody had typed anything (ANORMALIES
// `posted-form-has-no-fields`). Nothing in the destination's tests could
// have caught that -- it happens before ABAP is reached.
const PORT = process.env.STG_PORT ?? 3030;
const BASE = `http://localhost:${PORT}/sap/bc/osd/edit/`;
const OBJECT = "ZCL_OSD_ST05";
const FILE = "src/webgui/zcl_osd_st05.clas.abap";

const post = (body) => fetch(BASE, {
  method: "POST",
  headers: {"content-type": "application/x-www-form-urlencoded"},
  body: new URLSearchParams(body).toString(),
});

describe("the editor", function () {
  this.timeout(180000);
  let server;
  before(() => {
    server = startServer(true);
  });
  after(() => server?.close());

  it("lists the objects of the tree, with the file each one lives in", async () => {
    const page = await (await fetch(`${BASE}?q=OSD_ST05`)).text();
    expect(page, "the screen").to.contain("Editor");
    expect(page, "the object").to.contain(OBJECT);
    expect(page, "and where it is, which is the answer to 'where does an edit land'")
      .to.contain(FILE);
    expect(page, "a count of what matched").to.match(/\d+ shown of \d+ objects/);
  });

  it("opens one object with its source in the box", async () => {
    const page = await (await fetch(`${BASE}?type=CLAS&name=${OBJECT}`)).text();
    expect(page, "the text area").to.contain('<textarea name="src"');
    expect(page, "holding the source as it is on disk").to.contain("CLASS zcl_osd_st05 DEFINITION");
    expect(page, "and the file it came from").to.contain(FILE);
  });

  it("checks the source it was POSTED, which is the form-body gap this screen found", async () => {
    // the whole round trip: a body of 20-odd kilobytes reaches the screen,
    // the screen reaches the store, the store parses the system and answers
    const source = readFileSync(FILE, "utf8");
    const page = await (await post({type: "CLAS", name: OBJECT, do: "check", src: source})).text();
    expect(page, "the screen did not fall back to its object list, which is what an empty name does")
      .to.not.match(/\d+ shown of \d+ objects/);
    expect(page, "it holds").to.contain("the system still compiles");
  });

  it("names the line of a source that does not compile, and writes nothing", async () => {
    const before = readFileSync(FILE, "utf8");
    const broken = before.replace("METHOD esc.", "METHOD esc. DATA lv_x TYPE i. lv_x = no_such_method( ).");
    const page = await (await post({type: "CLAS", name: OBJECT, do: "check", src: broken})).text();
    expect(page, "the verdict").to.contain("issue(s)");
    expect(page, "the message, as the parser wrote it").to.contain("no_such_method");
    expect(page, "and the object it belongs to, because an activation is refused by a caller as often as by the object")
      .to.contain(OBJECT);
    expect(readFileSync(FILE, "utf8"), "a check does not write").to.equal(before);
  });

  it("keeps what the person typed after a save, rather than reading the file back", async () => {
    // a round trip that silently replaced the text would hide a write that
    // did not happen. The source here is the file's own, so the save is a
    // no-op on disk and the assertion is about the box.
    const source = readFileSync(FILE, "utf8");
    const page = await (await post({type: "CLAS", name: OBJECT, do: "save", src: source})).text();
    expect(page, "saved").to.contain("Saved.");
    expect(page, "and the box still holds it").to.contain("CLASS zcl_osd_st05 DEFINITION");
    expect(readFileSync(FILE, "utf8"), "and the file is what it was").to.equal(source);
  });

  it("ships no JavaScript, like the rest of these screens", async () => {
    const page = await (await fetch(`${BASE}?type=CLAS&name=${OBJECT}`)).text();
    expect(page.toLowerCase(), "a screen that is a form and a link needs none")
      .to.not.contain("<script");
    expect(page.toLowerCase(), "nor an inline handler").to.not.match(/\son\w+=/);
  });
});
