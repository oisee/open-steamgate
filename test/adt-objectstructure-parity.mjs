import {expect} from "chai";
import express from "express";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ObjectStore} from "../tools/osd-store.mjs";
import {structureOf, objectStructureDocument} from "../tools/adt-documents.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {adtAbap} from "./helpers/adt-abap.mjs";
import {remoteForTest} from "./helpers/adt-remote.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {readRequestXML} from "../tools/adt-request-xml.mjs";
import {files, name} from "./fixtures/objectstructure/source.mjs";
import {expected} from "./fixtures/objectstructure/expected.mjs";

const path = `/sap/bc/adt/oo/classes/${name.toLowerCase()}/objectstructure`;
const ordered = node => ({...node, extra: Object.entries(node.extra ?? {}).map(([name, value]) => ({name, value})),
  links: node.links ?? [], children: (node.children ?? []).map(ordered)});
const xmlFacts = xml => {
  const elements = readRequestXML(xml).elements;
  const visit = e => {
    const attributes = Object.fromEntries(e.attributes.filter(a => a.local !== "base").map(a => [a.local, a.value]));
    const direct = elements.filter(c => c.parent === elements.indexOf(e) + 1);
    return {...attributes, links: direct.filter(c => c.local === "link").map(c => {
      const a = Object.fromEntries(c.attributes.map(a => [a.local, a.value]));
      return {...a, rel: a.rel.replace("http://www.sap.com/adt/relations/source/", "")};
    }), children: direct.filter(c => c.local === "objectStructureElement").map(visit)};
  };
  return visit(elements[0]);
};
const expectedFacts = node => {
  const {extra, children, links, ...attributes} = node;
  return {...attributes, ...extra, links: links ?? [], children: (children ?? []).map(expectedFacts)};
};

for (const location of ["pack", "layer"]) describe(`A4H 7.58 objectstructure: ${location}`, function () {
  this.timeout(120000);
  let root, store, remote;
  const servers = {};
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-structure-parity-"));
    mkdirSync(join(root, "src"));
    const input = location === "pack" ? "packs/fixture/src" : "layer/src";
    mkdirSync(join(root, input), {recursive: true});
    if (location === "pack") writeFileSync(join(root, "packs/fixture/osd-pack.json"), JSON.stringify({name: "fixture", abap: ["src"]}));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: location === "pack" ? ["src"] : ["src", input]}));
    writeFileSync(join(root, "abaplint.jsonc"), JSON.stringify({syntax: {version: "v702"}, rules: {}}));
    for (const [file, source] of Object.entries(files)) writeFileSync(join(root, input, file), source);
    store = new ObjectStore({root, libs: []});
    if (process.env.OSD_ADT_ONE_RUNTIME === "1") remote = await remoteForTest();
    const runner = remote ? abapRunner({remote}) : await adtAbap();
    for (const front of ["Node", "ABAP"]) {
      const app = express(); app.set("etag", false);
      app.use(adtRouter({store, watch: false, logMisses: false, ...(front === "ABAP" ? {abap: runner} : {})}).router);
      servers[front] = await new Promise(resolve => {const s = app.listen(0, "127.0.0.1", () => resolve(s));});
    }
  });
  after(async () => {
    for (const server of Object.values(servers)) await new Promise(resolve => server.close(resolve));
    await remote?.stop();
    if (root) rmSync(root, {recursive: true, force: true});
  });
  it("structureOf and STORE OUTLINE match every measured coordinate and attribute", async () => {
    expect(structureOf(store, "CLAS", name)).to.deep.equal(expected);
    const answer = await new StoreDestination({store}).execute({iv_command: "PARSE", iv_json: JSON.stringify({kind: "OUTLINE", type: "CLAS", name})});
    expect(answer.EV_ERROR).to.equal("");
    expect(JSON.parse(answer.EV_JSON)).to.deep.equal({found: true, ...ordered(expected)});
  });
  for (const accept of ["application/vnd.sap.adt.objectstructure.v2+xml", "application/vnd.sap.adt.objectstructure+xml", "application/xml", "*/*"])
    it(`Node and served-by ABAP bytes, Accept ${accept}`, async () => {
      const bodies = [];
      for (const front of ["Node", "ABAP"]) {
        const response = await fetch(`http://127.0.0.1:${servers[front].address().port}${path}`, {headers: {accept}});
        expect(response.status).to.equal(200);
        if (front === "ABAP") expect(response.headers.get("x-osd-served-by")).to.equal("ABAP");
        const version = ["application/xml", "application/vnd.sap.adt.objectstructure+xml"].includes(accept) ? "" : ".v2";
        expect(response.headers.get("content-type")).to.equal(`application/vnd.sap.adt.objectstructure${version}+xml; charset=utf-8`);
        bodies.push(await response.text());
      }
      expect(bodies[0]).to.equal(objectStructureDocument(expected, {base: path}));
      expect(bodies[1]).to.equal(bodies[0]);
      expect(xmlFacts(bodies[0])).to.deep.equal(expectedFacts(expected));
      expect(bodies[0]).not.to.include("sourceUri");
      expect(bodies[0]).not.to.include('adtcore:type="CLAS/I"');
    });
  it("method block links select the complete signature and body from the owning include", () => {
    const sourceFor = href => files["zcl_outline_parity_fix.clas" + (href.startsWith("./source/main") ? "" :
      href.startsWith("./includes/implementations") ? ".locals_imp" : ".testclasses") + ".abap"];
    const slice = (source, href) => {
      const [, l, c, endL, endC] = /#start=(\d+),(\d+);end=(\d+),(\d+)/.exec(href).map(Number);
      const lines = source.split("\n");
      return lines.slice(l - 1, endL).map((line, i) => line.slice(i === 0 ? c : 0,
        l + i === endL ? endC + 1 : undefined)).join("\n");
    };
    const visit = node => {
      if (["CLAS/OM", "CLAS/OLD"].includes(node.type)) for (const link of node.links.filter(l => l.rel.endsWith("Block"))) {
        const selected = slice(sourceFor(link.href), link.href);
        expect(selected).to.match(link.rel === "definitionBlock" ? /^(CLASS-)?METHODS / : /^METHOD /);
        expect(selected).to.match(link.rel === "definitionBlock" ? /\.$/ : /ENDMETHOD\.$/);
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(structureOf(store, "CLAS", name));
  });
});
