// The ADT versions feed (tools/adt-versions.mjs) through the facade's own
// router: a program's .../source/main/versions and a class include's
// .../includes/<include>/versions list 00000 (empty without a generation) and one
// version per commit, oldest 00001, and each entry's content URI reads that
// version back. What a client parses is abap-adt-api's reader contract
// (atom:content@src, atom:title, atom:updated, atom:author/atom:name). The
// root and the 00000 entry are checked byte for byte against a raw A4H
// capture (foreman-dell, 2026-09-30); a commit's entry is design, since A4H
// has no transported version to measure.
import {expect} from "chai";
import express from "express";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {adtRouter} from "../tools/adt-facade.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {identity} from "../tools/osd-identity.mjs";

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
    writeFileSync(join(root, "src", "zver_cds.ddls.asddls"), "define view entity ZVER_CDS as select from t000 { mandt }\n");
    git("add", ".");
    git("commit", "-q", "-m", "first");
    writeFileSync(join(root, "src", "zver.prog.abap"), "REPORT zver.\nWRITE 'two'.\n");
    writeFileSync(join(root, "src", "zcl_ver.clas.locals_imp.abap"), "* two\n");
    git("commit", "-q", "-am", "second");
    // An unbuilt working tree has no known active source.
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

  it("lists a program's versions: 00000 the active source, then its commits newest first", async () => {
    const feed = await get("/sap/bc/adt/programs/programs/zver/source/main/versions");
    expect(feed.status).to.equal(200);
    expect(feed.type).to.match(/^application\/atom\+xml/);
    const list = entries(feed.text);
    expect(list.map((e) => e.id)).to.deep.equal(["00000", "00002", "00001"]);
    // 00000 carries no title at all on A4H; a commit carries its subject
    expect(list.map((e) => e.title)).to.deep.equal([undefined, "second", "first"]);
    expect(list[1].author).to.equal("TESTAUTHOR");
    expect(list[1].src).to.match(/^\/sap\/bc\/adt\/programs\/programs\/zver\/source\/main\/versions\/\d{14}\/00002\/content$/);
    for (const e of list) expect(Number.isNaN(Date.parse(e.updated))).to.equal(false);
  });

  it("reads each version back from its content URI, and refuses one that is not listed", async () => {
    const list = entries((await get("/sap/bc/adt/programs/programs/zver/source/main/versions")).text);
    const texts = await Promise.all(list.map((e) => get(e.src)));
    expect(texts.map((t) => t.status)).to.deep.equal([200, 200, 200]);
    expect(texts.map((t) => t.text)).to.deep.equal(["", "REPORT zver.\nWRITE 'two'.\n", "REPORT zver.\nWRITE 'one'.\n"]);
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

  it("dates and signs 00000 by the last commit when clean, by the working tree when edited", async () => {
    const clean = entries((await get("/sap/bc/adt/oo/classes/zcl_ver/includes/main/versions")).text);
    expect(clean[0].author).to.equal("TESTAUTHOR");
    expect(clean[0].updated).to.equal(clean[1].updated);
    const edited = entries((await get("/sap/bc/adt/programs/programs/zver/source/main/versions")).text);
    expect(edited[0].author).to.equal(identity().adt.userName);
  });

  it("gives a class include with no file 00000 only, never the main include's history", async () => {
    const feed = await fetch(new URL("/sap/bc/adt/oo/classes/zcl_ver/includes/testclasses/versions", base));
    expect(feed.headers.get("x-osd-history")).to.match(/no file/);
    const list = entries(await feed.text());
    expect(list.map((e) => e.id)).to.deep.equal(["00000"]);
    expect((await get(list[0].src.replace("/00000/", "/00001/"))).status).to.equal(404);
    expect((await get("/sap/bc/adt/oo/classes/zcl_ver/includes/constructor/versions")).status).to.equal(404);
  });

  it("serves a CDS source's versions at <object>/versions and links them there", async () => {
    const list = entries((await get("/sap/bc/adt/ddic/ddl/sources/zver_cds/versions")).text);
    expect(list.map((e) => e.id)).to.deep.equal(["00000", "00001"]);
    expect((await get(list[1].src)).text).to.include("ZVER_CDS");
    const doc = await fetch(new URL("/sap/bc/adt/ddic/ddl/sources/zver_cds", base),
      {headers: {accept: "application/vnd.sap.adt.ddlSource+xml"}});
    expect(await doc.text()).to.match(/<atom:link href="versions" rel="http:\/\/www\.sap\.com\/adt\/relations\/versions"\/>/);
  });

  it("gives an object git has no history for its active version only, and says why", async () => {
    writeFileSync(join(root, "src", "zloose.prog.abap"), "REPORT zloose.\n");
    const response = await fetch(new URL("/sap/bc/adt/programs/programs/zloose/source/main/versions", base));
    expect(response.status).to.equal(200);
    expect(response.headers.get("x-osd-history")).to.match(/^none: .*not tracked/);
    const list = entries(await response.text());
    expect(list.map((e) => e.id)).to.deep.equal(["00000"]);
    expect((await get(list[0].src)).text).to.equal("");
  });

  it("writes the feed root and the 00000 entry exactly as A4H does", async () => {
    writeFileSync(join(root, "src", "zexact.prog.abap"), "REPORT zexact.\n");
    const at = new Date("2012-10-22T16:13:47Z");
    utimesSync(join(root, "src", "zexact.prog.abap"), at, at);
    const response = await fetch(new URL("/sap/bc/adt/programs/programs/zexact/source/main/versions", base));
    expect(response.headers.get("content-type")).to.equal("application/atom+xml;type=feed");
    // A4H's body for RSPARAM, with the name, the user and the path swapped in
    expect(await response.text()).to.equal('<?xml version="1.0" encoding="utf-8"?>' +
      '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:adtcore="http://www.sap.com/adt/core">' +
      "<atom:title>Version List of ZEXACT (REPS)</atom:title><atom:updated>1970-01-01T10:11:23Z</atom:updated>" +
      `<atom:entry><atom:author><atom:name>${identity().adt.userName}</atom:name></atom:author>` +
      '<atom:content type="text/plain" src="/sap/bc/adt/programs/programs/zexact/source/main/versions/19700101101123/00000/content"/>' +
      "<atom:id>00000</atom:id><atom:updated>2012-10-22T16:13:47Z</atom:updated></atom:entry></atom:feed>");
    const klass = await get("/sap/bc/adt/oo/classes/zcl_ver/includes/main/versions");
    expect(klass.text).to.include("<atom:title>Version List of ZCL_VER (CLAS)</atom:title>");
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
