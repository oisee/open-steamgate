import {expect} from "chai";
import express from "express";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
const base="/sap/bc/adt/core/http/reentranceticket";
const clean=(s) => s.replace(/\?$/,"");
describe("A3b reentrance live Node byte diff",function () {
  this.timeout(120000);
  let root,node,ported,restore;
  const served=[];
  before(async () => {
    root=mkdtempSync(join(tmpdir(),"osd-a3b-"));const store=new ObjectStore({root,libs:[]});
    if(process.env.OSD_ADT_RED === "grammar") {
      const klass=abap.Classes.ZCL_OSD_ADT_REENTRANCE,original=klass.target;
      klass.target=async (args) => {if(args.iv_target.get().includes("127.1")) args.iv_target.set(args.iv_target.get().replace("127.1","127.0.0.1"));return original.call(klass,args);};
      restore=() => {klass.target=original;};
    }
    const mount=async (isAbap) => {
      const app=express();app.set("etag",false);app.use(express.raw({type:"*/*"}));
      const facade=adtRouter({store,data:{},watch:false,logMisses:false,...(isAbap ? {
        abap:abapRunner({handler:abap.Classes.ZCL_OSD_ADT_HANDLER,step:dialogStep}),
        abapServed:(by,req) => served.push(`${by} ${req.method} ${clean(req.originalUrl)}`)} : {})});
      app.use(facade.router);const server=await new Promise((resolve) => {const s=app.listen(0,"127.0.0.1",() => resolve(s));});
      return {server,origin:`http://127.0.0.1:${server.address().port}`};
    };node=await mount(false);ported=await mount(true);
  });
  after(async () => {restore?.();for(const s of [node,ported]) if(s) await new Promise((r) => s.server.close(r));if(root) rmSync(root,{recursive:true,force:true});});
  async function wire(side,path,method,accept) {
    const start=Date.now();const r=await fetch(side.origin+path,{redirect:"manual",method,headers:accept === undefined ? {} : {accept}});
    const location=r.headers.get("location");let ticket;
    if(r.status === 307) {
      expect(r.headers.get("etag")).to.equal(null);
      ticket=new URL(location).searchParams.get("reentrance-ticket");expect(ticket).to.match(/^[A-Za-z0-9_-]{32}$/);
      if(!path.includes("_=")) expect(+new URL(location).searchParams.get("_")).to.be.within(start,Date.now());
    }
    const mask=(s) => {if(s === null) return s;return s.replaceAll(ticket ?? "<no-ticket>","<ticket>").replace(/([?&]|&amp;)_=[0-9]{13}(?=&|#|$|<)/g,"$1_=<time>");};
    const headers=Object.fromEntries(["content-type","content-length","etag","vary","location"].map((h) => [h,mask(r.headers.get(h))]));
    const cookies=r.headers.getSetCookie();
    if(r.status === 307) expect(cookies.at(-1)).to.equal("sap-usercontext=sap-client%3D001; Path=/");
    expect(cookies.filter((c) => c.startsWith("SAP_SESSIONID_"))).to.have.length(1);
    const ids=cookies.slice(0,2).map((c) => /^[^=]+=([0-9a-f]{24});/.exec(c)?.[1]);expect(ids[0]).to.equal(ids[1]);expect(ids[0]).to.be.a("string");
    headers.cookies=cookies.map((c) => c.replace(/=([0-9a-f]{24});/,"=<session>;"));
    headers.tokenPresent=r.headers.has("x-csrf-token");headers.generationPresent=r.headers.has("x-osd-generation");
    return {status:r.status,headers,body:mask(Buffer.from(await r.arrayBuffer()).toString())};
  }
  async function diff(query,method="GET",accept="text/plain",expectedStatus=307,path=base) {
    path += "?"+query;const expected=await wire(node,path,method,accept);served.length=0;
    const actual=await wire(ported,path,method,accept);
    expect(actual).to.deep.equal(expected);expect(actual.status).to.equal(expectedStatus);
    const sent=new URL(node.origin+path).pathname+new URL(node.origin+path).search;
    expect(served).to.deep.equal([`ABAP ${method} ${clean(sent)}`]);return actual;
  }
  const ask=(target,extra="_=12345") => "redirect-url="+encodeURIComponent(target)+(extra ? "&"+extra : "");
  for(const target of ["http://localhost:54321/listener","http://127.0.0.1","http://[::1]:1234/","HTTP://LOCALHOST:0080","https://localhost:443","http://localhost:00000/","http://localhost/?x=%FF&y=%E2%82&z=%E0%80%80&v=%F0%90%80%41","http://localhost/?a=one+two&b=%20&flag&&_=old&_=second&reentrance-ticket=old&reentrance-ticket=second#fragment","http://localhost/a%20b?x=%C3%A9&%5F=old#f'&"]) {
    it(`normalizes ${target}`,async () => {await diff(ask(target));});
  }
  for(const accept of [undefined,"text/html","*/*","application/json","text/plain;q=0.5, text/html","text/html;q=0","text/html;q=0,*/*","text/html,text/plain","text/*;q=0.8,text/plain;q=0.2","text/plain;q=0,text/html;q=0","text/html;level=1,text/plain","text/html;level=1;q=1","text/html;level=*","text/html;q=\"0.7\",text/plain;q=.6bad","*/plain",""]) {
    it(`Accept ${accept}`,async () => {await diff(ask("http://localhost/a?x='&y=2"),"GET",accept);});
  }
  for(const target of ["http://127.1/","http://0x7f000001/","https://example.invalid","http://192.0.2.1/","http://[0:0::1]/"]) {
    it(`refuses nonliteral loopback ${target}`,async () => {await diff(ask(target),"GET","text/plain",400);});
  }
  for(const target of ["not a url","http://localhost:65536/","http://localhost:123456/","http://localhost/a/../b","http://localhost/%2e/","http://localhost/a\\b","http://localhost/%","http://localhost/?x=%","http://localhost/#%","http://user@localhost/","ftp://localhost/","http://localhost/a b"]) {
    it(`refuses invalid URL ${target}`,async () => {await diff(ask(target),"GET","text/plain",400);});
  }
  for(const query of ["","redirect-url=","redirect-url=http://localhost&redirect-url=http://localhost","redirect-url[x]=http://localhost"]) {
    it(`required ${query}`,async () => {await diff(query,"GET","text/plain",400);});
  }
  it("duplicate outer stamp",async () => {await diff(ask("http://localhost/","_=1&_=2"));});
  it("default clock",async () => {await diff(ask("http://localhost/",""));});
  it("HEAD and case/trailing slash",async () => {await diff(ask("http://localhost/"),"HEAD","text/html",307,base.toUpperCase()+"/");});
});
describe("A3b focused ABAP Unit",() => {
  for(const method of ["grammar","query","accept","escaping","clock","subtract_precision"]) it(method,async () => {const {ltcl_reentrance}=await import("../output/zcl_osd_adt_reentrance.clas.testclasses.mjs");const o=new ltcl_reentrance();await o.constructor_();await o.FRIENDS_ACCESS_INSTANCE[method]();});
});
