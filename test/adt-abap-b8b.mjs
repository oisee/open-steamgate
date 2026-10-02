// B8b gate: real Node and ABAP fronts over one store, with ETags disabled
// as in production. A route falling back to Node must fail this gate.
import {expect} from "chai";
import express from "express";
import {mkdtempSync, rmSync, mkdirSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

const at = (side) => `http://127.0.0.1:${side.server.address().port}`;

async function wire(side, path, options = {}) {
  const res = await fetch(at(side) + path, options);
  const headers = Object.fromEntries(["content-type", "content-length", "etag", "location"].map((h) => [h, res.headers.get(h)]));
  // Each facade mints its own session; compare cookie order/attributes after
  // checking the random identifier's format and the two cookies' agreement.
  const cookies = res.headers.getSetCookie();
  const ids = cookies.map((c) => /^[^=]+=([0-9a-f]{24});/.exec(c)?.[1]);
  if (cookies.length) {
    expect(ids.every((id) => id !== undefined)).to.equal(true);
    expect(new Set(ids).size).to.equal(1);
  }
  headers["set-cookie"] = cookies.map((c) => c.replace(/=([0-9a-f]{24});/, "=<session>;"));
  expect(res.headers.get("x-osd-miss")).to.equal(null);
  return {status: res.status, headers, body: Buffer.from(await res.arrayBuffer())};
}

describe("ADT B8b: DDIC Node diff", function () {
  this.timeout(60000);
  let root, node, ported;
  const served = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-b8b-"));
    mkdirSync(join(root, "src"));
    mkdirSync(join(root,"local/tmp"), {recursive:true});
    const dtel = (name, tags) => writeFileSync(join(root, name.startsWith("/") ? "local/tmp" : "src", name.toLowerCase().replaceAll("/", "#") + ".dtel.xml"), `<abapGit><DD04V><ROLLNAME>${name}</ROLLNAME>${tags}</DD04V><I18N><DDTEXT>Wrong later text</DDTEXT></I18N></abapGit>`);
    const tag = (name, value) => `<${name}>${value}</${name}>`;
    dtel("ZD_DOMAIN", `<DOMNAME>ZDOMAIN</DOMNAME><DDTEXT>Grüße &amp; &lt; &gt; &quot; ' &amp;#39;</DDTEXT>`);
    dtel("ZD_CHAR", `<DATATYPE>CHAR</DATATYPE><LENG>000015</LENG>`);
    for (const ref of ["C", "I", "X"]) dtel("ZD_REF_" + ref, `<REFKIND>R</REFKIND><REFTYPE>${ref}</REFTYPE>`);
    dtel("ZD_DICT", `<REFKIND>D</REFKIND>`);
    dtel("ZD_NAN", `<LENG>x1</LENG><SCRLEN1>000000</SCRLEN1><SCRLEN2>bad</SCRLEN2><SCRLEN3>000004</SCRLEN3><HEADLEN>000000</HEADLEN>`);
    dtel("ZD_FLAGS", ["NOHISTORY", "LOGFLAG", "LTRFLDDIS", "BIDICTRLC"].map((n) => tag(n,"X")).join(""));
    dtel("/DEMO/ZDTEL", `<DOMNAME>ZDOMAIN</DOMNAME>`);
    const field = (name, kind, extra = "") => `<DD03P><FIELDNAME>${name}</FIELDNAME><DATATYPE>${kind}</DATATYPE><LENG>000015</LENG><DECIMALS>000002</DECIMALS>${extra}</DD03P>`;
    const table = (name, fields, extra = "") => writeFileSync(join(root,"src",name.toLowerCase()+".tabl.xml"), `<abapGit><DD02V><TABNAME>${name}</TABNAME><DDTEXT>O'Brien Grüße</DDTEXT><MAINFLAG>X</MAINFLAG>${extra}</DD02V><DD03P_TABLE>${fields}</DD03P_TABLE></abapGit>`);
    table("ZT_FIELDS", field("KEY","CHAR","<KEYFLAG>X</KEYFLAG><NOTNULL>X</NOTNULL>") + ["DEC", "INT4", "RSTR", "STRG", "SSTR", "CURR", "DF16_DEC"].map((k) => field("F_"+k,k)).join("") + field("ELEMENT","","<ROLLNAME>ZD_CHAR</ROLLNAME>") + field("UNKNOWN", "") + field(".INCLUDE","CHAR") + field("","CHAR"));
    table("ZT_EMPTY", ""); table("ZT_STRUCT", field("F","NUMC"), "<TABCLASS>INTTAB</TABCLASS>");
    const store = new ObjectStore({root, libs: []});
    store.write("TABL", "ZT_FIELDS", store.read("TABL", "ZT_FIELDS").source);
    const mount = async (isAbap) => {
      const app = express();
      app.set("etag", false);
      app.use(express.raw({type: "*/*"}));
      const facade = adtRouter({store, data: {}, watch: false, logMisses: false,
        ...(isAbap ? {abap: abapRunner({handler: abap.Classes.ZCL_OSD_ADT_HANDLER, step: dialogStep}),
          abapServed: (by, req) => served.push(`${by} ${req.method} ${req.originalUrl}`)} : {})});
      app.use(facade.router);
      const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
      const warm = await fetch(`http://127.0.0.1:${server.address().port}/sap/bc/adt/b8b/warmup`, {headers: {"x-csrf-token": "fetch"}});
      await warm.arrayBuffer();
      return {server, facade, auth: {cookie: warm.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
        "x-csrf-token": warm.headers.get("x-csrf-token")}};
    };
    // A runnable red proof: mutate the actual ABAP renderer, then replay the same diff.
    const method = process.env.OSD_ADT_RED;
    if (["data_element", "table_document", "table_source"].includes(method)) {
      const klass = abap.Classes.ZCL_OSD_ADT_DDIC;
      const original = klass[method];
      klass[method] = async (...args) => {
        const result = await original.apply(klass,args);
        result.set(result.get()+"\n");
        return result;
      };
    }
    node = await mount(false);
    ported = await mount(true);
  });
  after(async () => {
    for (const side of [node, ported]) if (side) await new Promise((resolve) => side.server.close(resolve));
    if (root) rmSync(root, {recursive: true, force: true});
  });
  const paths = ["ZD_DOMAIN", "ZD_CHAR", "ZD_REF_C", "ZD_REF_I", "ZD_REF_X", "ZD_DICT", "ZD_NAN", "ZD_FLAGS", "%2Fdemo%2Fzdtel", "ZNope"].map((n) => "/sap/bc/adt/ddic/dataelements/" + n)
    .concat(["ZT_FIELDS", "ZT_EMPTY", "ZT_STRUCT", "ZNope", "parser"].flatMap((n) => ["/sap/bc/adt/ddic/tables/" + n, "/sap/bc/adt/ddic/tables/" + n + "/source/main"]));
  for (const path of paths) for (const method of ["GET", "HEAD"]) it(`${method} ${path} bytes and ABAP ownership`, async () => {
    const ask = (side) => ({method, headers: side.auth});
    const expected = await wire(node, path, ask(node));
    served.length = 0;
    expect(await wire(ported, path, ask(ported))).to.deep.equal(expected);
    expect(served).to.deep.equal([`ABAP ${method} ${path}`]);
    expect(expected.status).to.equal(/ZNope|\/parser$/.test(path) || path.includes("parser/source") ? 404 : 200);
    if (path.endsWith("ZT_FIELDS") && method === "GET") {
      expect(expected.body.toString()).to.include('adtcore:version="active"').and.include("1970-01-01T00:00:00Z");
    }
  });
  for (const suffix of ["", "/source/main"]) for (const kind of ["bare", "weak", "list", "star"]) it(`table conditional ${suffix} ${kind}`, async () => {
    const path = "/sap/bc/adt/ddic/tables/ZT_FIELDS" + suffix;
    const tag = (await wire(node,path,{headers:node.auth})).headers.etag;
    const none = {bare:tag,weak:`W/"${tag}"`,list:`"other", W/"${tag}"`,star:"*"}[kind];
    const ask = (side) => ({headers:{...side.auth,"if-none-match":none}});
    served.length = 0;
    const actual = await wire(ported,path,ask(ported));
    expect(actual).to.deep.equal(await wire(node,path,ask(node)));
    expect(actual.status).to.equal(kind === "star" ? 200 : 304);
    expect(served).to.deep.equal([`ABAP GET ${path}`]);
  });
});
