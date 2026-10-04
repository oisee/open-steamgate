import {expect} from "chai";
import {readFileSync} from "node:fs";
import "./start.mjs";
import {readRequestXML} from "../tools/adt-request-xml.mjs";
const corpus = JSON.parse(readFileSync(new URL("./fixtures/adt-request-xml-corpus.json", import.meta.url)));
const normalize = elements => elements.map(e => ({uri:e.uri,local:e.local,parent:e.parent,text:e.text,
  attributes:[...e.attributes].sort((a,b) => JSON.stringify([a.uri,a.local]).localeCompare(JSON.stringify([b.uri,b.local])))}));
export async function abapXML(body) {
  const cls = abap.Classes.ZCL_OSD_ADT_REQUEST_XML;
  const iv_body = new abap.types.XString().set(body.toString("hex").toUpperCase());
  if (!cls.parse) {await cls.read({iv_body}); return undefined;}
  const result = await cls.parse({iv_body});
  return result.array().map(e => {
    const row = e.get();
    return {uri:row.uri.get(),local:row.local.get(),parent:row.parent.get(),text:row.text.get(),
      attributes:row.attributes.array().map(a => {const r=a.get();return {uri:r.uri.get(),local:r.local.get(),value:r.value.get()};})};
  });
}
describe("ADT XML common acceptance corpus", function () {
  this.timeout(30000);
  for (const c of corpus) it(c.name, async () => {
    const bytes = Buffer.from(c.bytes,"hex"), results = {};
    for (const [front,reader] of [["node",b => readRequestXML(b).elements],["abap",abapXML]]) {
      try {results[front] = {verdict:"accept",elements:await reader(bytes)};}
      catch {results[front] = {verdict:"refuse"};}
    }
    expect(results.node.verdict,"Node verdict").to.equal(c.verdict);
    expect(results.abap.verdict,"ABAP verdict").to.equal(c.verdict);
    expect(results.abap.verdict,"reader disagreement").to.equal(results.node.verdict);
    if (c.verdict === "accept") {
      for (const front of ["node","abap"]) expect(normalize(results[front].elements),front).to.deep.equal(normalize(c.expected));
    }
  });
});

// Preview calls ANSWER without a Sessions adapter. Admission must still run.
import {previewAdtAnswer} from "../web/preview-continuations.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
describe("ADT XML preview admission", () => {
  const root='<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values/></asx:abap>';
  const refused = {
    duplicate:root.replace('xmlns:asx=','xmlns:asx="http://www.sap.com/abapxml" xmlns:asx='),
    reserved:root.replace('<asx:values','<asx:values xmlns:xml="urn:wrong"'),
    undeclaration:root.replace('<asx:values','<asx:values xmlns:q=""'),
    xmlnsURI:root.replace('<asx:values','<asx:values xmlns:q="http://www.w3.org/2000/xmlns/"'),
    control:root.replace('<asx:values','<asx:values x="\u0001"'),
    nullReference:root.replace('<asx:values','<asx:values x="&#0;"'),
    declaration:'<?xml junk?>'+root,
    attributeName:root.replace('<asx:values','<asx:values xmlns:q="u" q:a:b="x"'),
    namespaceName:root.replace('<asx:values','<asx:values xmlns:a:b="u"'),
    NBSP:'\u00a0'+root, PI:'<? ?>'+root, trailing:root+'tail', DOCTYPE:'<!DOCTYPE r>'+root,
  };
  it("accepts a legal nodestructure envelope without a session adapter",async () => {
    const result=await dialogStep(() => previewAdtAnswer(abap.Classes.ZCL_OSD_ADT_HANDLER,
      {method:"POST",path:"/sap/bc/adt/repository/nodestructure",body:Buffer.from(root)}));
    expect(result.status,new TextDecoder().decode(result.body)).to.equal(200);
  });
  for (const [name,xml] of Object.entries(refused)) it(name, async () => {
    const result=await dialogStep(() => previewAdtAnswer(abap.Classes.ZCL_OSD_ADT_HANDLER,
      {method:"POST",path:"/sap/bc/adt/repository/nodestructure",body:Buffer.from(xml)}));
    expect(result.status,new TextDecoder().decode(result.body)).to.equal(400);
    expect(new TextDecoder().decode(result.body)).to.include("ExceptionInvalidXML");
    expect(result.headers.get("set-cookie")).to.equal(null);
    expect(result.headers.get("x-csrf-token")).to.equal(null);
  });
});
