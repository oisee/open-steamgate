import {expect} from "chai";
import express from "express";
import {fileURLToPath} from "node:url";
import {mkdtempSync, cpSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {adtRouter} from "../tools/adt-facade.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

describe("ADT editor follows typed property documents to their sources", () => {
  let server, base, fixtureRoot;
  before(async () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "osd-adt-editor-"));
    cpSync(fileURLToPath(new URL("./fixtures/adt-editor/", import.meta.url)), fixtureRoot, {recursive: true});
    const store = new ObjectStore({
      root: fixtureRoot,
      roots: [{path: ".", package: "$EDITOR", writable: true}], libs: [],
    });
    const app = express();
    app.use(express.raw({type: "*/*"}));
    app.use(adtRouter({store, data: {}, logMisses: false}).router);
    await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    rmSync(fixtureRoot, {recursive: true, force: true});
  });

  for (const [path, root, mime, source] of [
    ["programs/programs/zdemo_editor", "program:abapProgram", "programs.programs.v3+xml", "REPORT zdemo_editor."],
    ["ddic/ddl/sources/zdemo_editor", "ddl:ddlSource", "adt.ddlSource+xml", "define view entity ZDemo_Editor"],
    ["oo/interfaces/zif_editor", "intf:abapInterface", "oo.interfaces.v2+xml", "INTERFACE zif_editor PUBLIC."],
  ]) {
    it(`${path}: base resource is properties and its source link opens text`, async () => {
      const url = base + "/sap/bc/adt/" + path;
      const res = await fetch(url);
      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type").toLowerCase()).to.contain(mime.toLowerCase());
      expect(res.headers.get("etag"), "properties must carry the synchronization token").to.be.a("string").and.not.empty;
      const xml = await res.text();
      expect(xml).to.contain(`<${root} `);
      expect(xml).to.contain('<adtcore:packageRef ');
      const relative = /abapsource:sourceUri="([^"]+)"/.exec(xml)?.[1];
      expect(relative).to.equal("source/main");
      const content = await fetch(new URL(relative, url + "/"));
      expect(content.status).to.equal(200);
      expect(content.headers.get("content-type")).to.contain("text/plain");
      expect(content.headers.get("etag"), "source must carry its own synchronization token").to.be.a("string").and.not.empty;
      expect(await content.text()).to.contain(source);
      const packageUri = /adtcore:uri="([^"]+)"/.exec(xml)?.[1];
      expect((await fetch(new URL(packageUri, base))).status).to.equal(200);
    });
  }
  it("returns 304 when an editor already has the current source entity", async () => {
    const url = base + "/sap/bc/adt/oo/interfaces/zif_editor/source/main";
    const first = await fetch(url);
    const etag = first.headers.get("etag");
    expect(etag).to.be.a("string").and.not.empty;
    const cached = await fetch(url, {headers: {"if-none-match": etag}});
    expect(cached.status).to.equal(304);
  });
  it("program objectstructure remains a separate representation", async () => {
    const response = await fetch(base + "/sap/bc/adt/programs/programs/zdemo_editor/objectstructure");
    expect(response.status).to.equal(200);
    expect(await response.text()).to.contain("<abapsource:objectStructureElement");
  });
  it("an absent program remains a 404", async () => {
    expect((await fetch(base + "/sap/bc/adt/programs/programs/absent")).status).to.equal(404);
  });
  it("follows a class include source link with the client's default Accept", async () => {
    const url = base + "/sap/bc/adt/oo/classes/zcl_editor";
    const xml = await (await fetch(url)).text();
    const relative = /class:includeType="testclasses" abapsource:sourceUri="([^"]+)"/.exec(xml)?.[1];
    expect(relative).to.equal("includes/testclasses");
    const response = await fetch(new URL(relative, url + "/"));
    expect(response.status).to.equal(200);
    expect(response.headers.get("content-type")).to.contain("text/plain");
    expect(await response.text()).to.contain("CLASS ltcl_editor");
  });
  it("writes the include using its parent lock without overwriting main source", async () => {
    const url = base + "/sap/bc/adt/oo/classes/zcl_editor";
    const seed = await fetch(base + "/sap/bc/adt/core/discovery", {method: "HEAD"});
    const headers = {
      cookie: seed.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
      "x-csrf-token": seed.headers.get("x-csrf-token"),
      "x-sap-adt-sessiontype": "stateful", "content-type": "text/plain",
    };
    const locked = await fetch(url + "?_action=LOCK&accessMode=MODIFY", {method: "POST", headers});
    expect(locked.status).to.equal(200);
    const handle = /<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(await locked.text())?.[1];
    expect(handle).to.be.a("string").with.length.greaterThan(0);
    const source = "CLASS ltcl_editor DEFINITION FOR TESTING. ENDCLASS.\nCLASS ltcl_editor IMPLEMENTATION. ENDCLASS.\n";
    const put = (suffix, token) => fetch(url + suffix + "?lockHandle=" + encodeURIComponent(token), {method: "PUT", headers, body: source});
    expect((await put("/includes/testclasses", "wrong")).status).to.equal(409);
    expect((await put("/includes/testclasses", handle)).status).to.equal(200);
    expect(await (await fetch(url + "/includes/testclasses")).text()).to.equal(source);
    expect(await (await fetch(url + "/source/main")).text()).to.contain("CLASS zcl_editor DEFINITION");
    expect((await put("/includes/not-an-include", handle)).status).to.equal(404);
    const unlock = await fetch(url + "?_action=UNLOCK&lockHandle=" + encodeURIComponent(handle), {method: "POST", headers});
    expect(unlock.status).to.equal(200);
    expect((await put("/includes/testclasses", handle)).status).to.equal(409);
  });
});
