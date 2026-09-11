import {expect} from "chai";
import {startServer} from "./start.mjs";

const BASE = "http://localhost:3030/sap/opu/odata/sap/ZSTG_DEMO_SRV";

describe("wire", () => {
  let server;

  before(() => {
    server = startServer(true);
  });

  after(() => {
    server.close();
  });

  it("root answers", async () => {
    const res = await fetch("http://localhost:3030/");
    expect(res.status).to.equal(200);
  });

  it("service path reaches the ABAP handler and is honest about being unbuilt", async () => {
    const res = await fetch(BASE + "/TravelSet?$format=json");
    expect(res.status).to.equal(501);
    expect(res.headers.get("content-type")).to.contain("application/json");
    expect(res.headers.get("dataserviceversion")).to.equal("2.0");
    const body = await res.json();
    expect(body.error.code).to.equal("STG/NOT_IMPLEMENTED");
    expect(body.error.message.value).to.contain("/ZSTG_DEMO_SRV/TravelSet");
  });
});
