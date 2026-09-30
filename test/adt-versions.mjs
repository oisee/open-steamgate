// The ADT versions feed (tools/adt-versions.mjs) through the facade's own
// router: a program's .../source/main/versions and a class include's
// .../includes/<include>/versions list 00000 (the working tree) and one
// version per commit, oldest 00001, and each entry's content URI reads that
// version back. What a client parses is abap-adt-api's reader contract
// (atom:content@src, atom:title, atom:updated, atom:author/atom:name); the
// feed XML itself is not yet checked against a raw A4H capture.
import {expect} from "chai";
import express from "express";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {adtRouter} from "../tools/adt-facade.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

describe("tools/adt-facade: versions of an object out of git", function () {
  this.timeout(30000);
  let root;
  let server;
  let base;
  const git = (...args) => execFileSync("git", args, {cwd: root, stdio: ["ignore", "pipe", "pipe"]});
  const get = async (path) => {
    const response = await fetch(new URL(path, base));
    return {status: response.status, type: response.headers.get("content-type") ?? "", text: await response.text()};
  };
  const entries = (feed) => [...feed.matchAll(/<atom:entry>([\s\S]*?)<\/atom:entry>/g)].map(([, e]) => ({
    id: /<atom:id>(.*?)<\/atom:id>/.exec(e)?.[1],
    title: /<atom:title>(.*?)<\/atom:title>/.exec(e)?.[1],
    author: /<atom:name>(.*?)<\/atom:name>/.exec(e)?.[1],
    updated: /<atom:updated>(.*?)<\/atom:updated>/.exec(e)?.[1],
    src: /<atom:content type="text\/plain" src="(.*?)"\/>/.exec(e)?.[1],
  }));

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-adt-versions-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"]}));
    git("init", "-q");
    git("config", "user.name", "Test Author");
    git("config", "user.email", "test@example.invalid");
    writeFileSync(join(root, "src", "zver.prog.abap"), "REPORT zver.\nWRITE 'one'.\n");
    writeFileSync(join(root, "src", "zcl_ver.clas.abap"), "CLASS zcl_ver DEFINITION. ENDCLASS.\nCLASS zcl_ver IMPLEMENTATION. ENDCLASS.\n");
    writeFileSync(join(root, "src", "zcl_ver.clas.locals_imp.abap"), "* one\n");
    git("add", ".");
    git("commit", "-q", "-m", "first");
    writeFileSync(join(root, "src", "zver.prog.abap"), "REPORT zver.\nWRITE 'two'.\n");
    writeFileSync(join(root, "src", "zcl_ver.clas.locals_imp.abap"), "* two\n");
    git("commit", "-q", "-am", "second");
    // an edit not committed: the active version is the working tree
    writeFileSync(join(root, "src", "zver.prog.abap"), "REPORT zver.\nWRITE 'three'.\n");
    const app = express();
    app.use(adtRouter({store: new ObjectStore({root, libs: []}), data: {}, logMisses: false}).router);
    server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    rmSync(root, {recursive: true, force: true});
  });

  it("lists a program's versions: 00000 the working tree, then its commits newest first", async () => {
    const feed = await get("/sap/bc/adt/programs/programs/zver/source/main/versions");
    expect(feed.status).to.equal(200);
    expect(feed.type).to.match(/^application\/atom\+xml/);
    const list = entries(feed.text);
    expect(list.map((e) => e.id)).to.deep.equal(["00000", "00002", "00001"]);
    expect(list.map((e) => e.title)).to.deep.equal(["", "second", "first"]);
    expect(list[1].author).to.equal("TESTAUTHOR");
    expect(list[1].src).to.match(/^\/sap\/bc\/adt\/programs\/programs\/zver\/source\/main\/versions\/\d{14}\/00002\/content$/);
    for (const e of list) expect(Number.isNaN(Date.parse(e.updated))).to.equal(false);
  });

  it("reads each version back from its content URI, and refuses one that is not listed", async () => {
    const list = entries((await get("/sap/bc/adt/programs/programs/zver/source/main/versions")).text);
    const texts = await Promise.all(list.map((e) => get(e.src)));
    expect(texts.map((t) => t.status)).to.deep.equal([200, 200, 200]);
    expect(texts.map((t) => /WRITE '(\w+)'/.exec(t.text)[1])).to.deep.equal(["three", "two", "one"]);
    const missing = await get(list[0].src.replace("/00000/", "/00009/"));
    expect(missing.status).to.equal(404);
  });

  it("keeps a class's versions per include", async () => {
    const main = entries((await get("/sap/bc/adt/oo/classes/zcl_ver/includes/main/versions")).text);
    expect(main.map((e) => e.id)).to.deep.equal(["00000", "00001"]);
    const imp = entries((await get("/sap/bc/adt/oo/classes/zcl_ver/includes/implementations/versions")).text);
    expect(imp.map((e) => e.id)).to.deep.equal(["00000", "00002", "00001"]);
    expect((await get(imp[2].src)).text).to.equal("* one\n");
  });

  it("gives an object git has no history for its active version only, and says why", async () => {
    writeFileSync(join(root, "src", "zloose.prog.abap"), "REPORT zloose.\n");
    const response = await fetch(new URL("/sap/bc/adt/programs/programs/zloose/source/main/versions", base));
    expect(response.status).to.equal(200);
    expect(response.headers.get("x-osd-history")).to.match(/^none: .*not tracked/);
    const list = entries(await response.text());
    expect(list.map((e) => e.id)).to.deep.equal(["00000"]);
    expect((await get(list[0].src)).text).to.equal("REPORT zloose.\n");
  });

  it("links the feed from the program and from every class include", async () => {
    const program = await fetch(new URL("/sap/bc/adt/programs/programs/zver", base),
      {headers: {accept: "application/vnd.sap.adt.programs.programs.v3+xml"}});
    expect(await program.text()).to.match(/<atom:link href="source\/main\/versions" rel="http:\/\/www\.sap\.com\/adt\/relations\/versions"\/>/);
    const klass = await fetch(new URL("/sap/bc/adt/oo/classes/zcl_ver", base),
      {headers: {accept: "application/vnd.sap.adt.oo.classes.v4+xml"}});
    expect(await klass.text()).to.match(/<atom:link href="includes\/main\/versions" rel="http:\/\/www\.sap\.com\/adt\/relations\/versions"/);
  });
});
