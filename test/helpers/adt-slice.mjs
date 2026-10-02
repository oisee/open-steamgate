import {expect} from "chai";
import express from "express";
import "../start.mjs";
import {adtRouter} from "../../tools/adt-facade.mjs";
import {abapRunner} from "../../tools/adt-abap-front.mjs";
import {dialogStep} from "../../tools/osd-dialog-step.mjs";

export async function sliceFronts(store) {
  const served = [];
  const mount = async (ported) => {
    const app = express();
    app.set("etag", false);
    app.use(express.raw({type:"*/*"}));
    const facade = adtRouter({store, data:{}, watch:false, logMisses:false,
      ...(ported ? {abap:abapRunner({handler:abap.Classes.ZCL_OSD_ADT_HANDLER,step:dialogStep}),
        abapServed:(by,req) => served.push(`${by} ${req.method} ${req.originalUrl}`)} : {})});
    app.use(facade.router);
    const server = await new Promise((resolve) => { const s = app.listen(0,"127.0.0.1",() => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const warm = await fetch(base+"/sap/bc/adt/slice/warm",{headers:{"x-csrf-token":"fetch"}});
    await warm.arrayBuffer();
    const auth = {cookie:warm.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),"x-csrf-token":warm.headers.get("x-csrf-token")};
    return {server,base,auth,facade};
  };
  const node = await mount(false), ported = await mount(true);
  async function wire(side,path,method,body,headers) {
    const res = await fetch(side.base+path,{method,headers:{...side.auth,...headers},...(body === undefined ? {} : {body})});
    return {status:res.status,headers:Object.fromEntries(["content-type","content-length","etag","location"].map((h) => [h,res.headers.get(h)])),body:Buffer.from(await res.arrayBuffer())};
  }
  return {
    async diff(path,method="GET",body,headers={}) {
      const expected = await wire(node,path,method,body,headers);
      served.length = 0;
      const actual = await wire(ported,path,method,body,headers);
      expect(actual.body.toString()).to.equal(expected.body.toString());
      expect(actual).to.deep.equal(expected);
      expect(served).to.deep.equal([`ABAP ${method} ${path}`]);
      return expected;
    },
    async close() { for (const side of [node,ported]) await new Promise((r) => side.server.close(r)); },
  };
}
