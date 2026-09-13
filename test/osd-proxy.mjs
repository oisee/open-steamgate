import {expect} from "chai";
import {ObjectStore} from "../tools/osd-store.mjs";
import {forward, odataProxy, NotForwardable} from "../tools/osd-proxy.mjs";
import express from "express";

// The seam between the listener a client points at and the process that
// actually answers OData. What matters here is not that bytes arrive: it is
// that a client cannot tell there are two processes, because the moment it
// can, the links it follows go to a port that exists only between them.
describe("tools/osd-proxy: the OData front, in another process", () => {
  let runtime;

  before(async function () {
    this.timeout(120000);
    runtime = new ObjectStore().serving({root: process.cwd()});
    await runtime.start();
  });

  after(async () => runtime?.stop());

  // the defect this was written after: fetch() treats Host as forbidden and
  // replaces it with the address it dialled, so every absolute link OData
  // built named the child's ephemeral port
  it("an absolute link names the address the client used, not the child's", async () => {
    const app = express();
    app.use(express.raw({type: "*/*"}));
    app.all("/sap/opu/odata/sap/*", odataProxy(runtime));
    const front = app.listen(0);
    const port = front.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$top=1&$format=json`);
      expect(res.status).to.equal(200);
      const body = await res.text();
      expect(body).to.contain(`localhost:${port}`);
      expect(body, "the child's own port reached the client").to.not.contain(new URL(runtime.url).port);
    } finally {
      front.close();
    }
  });

  it("the answer says which runtime produced it", async () => {
    const app = express();
    app.use(express.raw({type: "*/*"}));
    app.all("/sap/opu/odata/sap/*", odataProxy(runtime));
    const front = app.listen(0);
    try {
      const res = await fetch(`http://localhost:${front.address().port}/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata`);
      expect(res.headers.get("x-osd-generation")).to.equal(String(runtime.generation));
    } finally {
      front.close();
    }
  });

  // forwarding to nothing is an error, not an empty success: the proxy that
  // quietly answers 200 for a runtime that is gone is the false-green again
  it("forwarding with nothing serving refuses rather than invents an answer", async () => {
    const idle = new ObjectStore().serving({root: process.cwd()});
    let thrown;
    await forward(idle, {method: "GET", originalUrl: "/x", headers: {}}, {}).catch((e) => {
      thrown = e;
    });
    expect(thrown).to.be.instanceOf(NotForwardable);
  });
});
