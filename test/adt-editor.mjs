import {expect} from "chai";
import express from "express";
import {fileURLToPath} from "node:url";
import {adtRouter} from "../tools/adt-facade.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

describe("ADT editor follows typed property documents to their sources", () => {
  let server, base;
  before(async () => {
    const store = new ObjectStore({
      root: fileURLToPath(new URL("./fixtures/adt-editor/", import.meta.url)),
      roots: [{path: ".", package: "$EDITOR", writable: false}], libs: [],
    });
    const app = express();
    app.use(express.raw({type: "*/*"}));
    app.use(adtRouter({store, data: {}, logMisses: false}).router);
    await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  for (const [path, root, mime, source] of [
    ["programs/programs/zdemo_editor", "program:abapProgram", "programs.programs.v3+xml", "REPORT zdemo_editor."],
    ["ddic/ddl/sources/zdemo_editor", "ddl:ddlSource", "adt.ddlSource+xml", "define view entity ZDemo_Editor"],
  ]) {
    it(`${path}: base resource is properties and its source link opens text`, async () => {
      const url = base + "/sap/bc/adt/" + path;
      const res = await fetch(url);
      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type").toLowerCase()).to.contain(mime.toLowerCase());
      const xml = await res.text();
      expect(xml).to.contain(`<${root} `);
      expect(xml).to.contain('<adtcore:packageRef ');
      const relative = /abapsource:sourceUri="([^"]+)"/.exec(xml)?.[1];
      expect(relative).to.equal("source/main");
      const content = await fetch(new URL(relative, url + "/"));
      expect(content.status).to.equal(200);
      expect(content.headers.get("content-type")).to.contain("text/plain");
      expect(await content.text()).to.contain(source);
      const packageUri = /adtcore:uri="([^"]+)"/.exec(xml)?.[1];
      expect((await fetch(new URL(packageUri, base))).status).to.equal(200);
    });
  }
  it("program objectstructure remains a separate representation", async () => {
    const response = await fetch(base + "/sap/bc/adt/programs/programs/zdemo_editor/objectstructure");
    expect(response.status).to.equal(200);
    expect(await response.text()).to.contain("<abapsource:objectStructureElement");
  });
  it("an absent program remains a 404", async () => {
    expect((await fetch(base + "/sap/bc/adt/programs/programs/absent")).status).to.equal(404);
  });
});
