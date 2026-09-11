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

  it("$metadata", async () => {
    const res = await fetch(BASE + "/$metadata");
    expect(res.status).to.equal(200);
    expect(res.headers.get("content-type")).to.contain("application/xml");
    expect(res.headers.get("dataserviceversion")).to.equal("2.0");
    const xml = await res.text();
    expect(xml).to.contain('<EntityType Name="Travel"');
    expect(xml).to.contain('<EntitySet Name="TravelSet" EntityType="ZSTG_DEMO_SRV.Travel"');
  });

  it("entity set as OData v2 JSON", async () => {
    const res = await fetch(BASE + "/TravelSet?$format=json");
    expect(res.status).to.equal(200);
    const body = await res.json();
    expect(body.d.results).to.have.length(4);
    expect(body.d.results[0].TravelId).to.equal("T0001");
    expect(body.d.results[0].Seats).to.equal(2);
    expect(body.d.results[0].__metadata.uri).to.equal(
      "http://localhost:3030/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0001')");
  });

  it("$top/$skip/$inlinecount", async () => {
    const res = await fetch(BASE + "/TravelSet?$top=2&$skip=1&$inlinecount=allpages");
    const body = await res.json();
    expect(body.d.results.map((r) => r.TravelId)).to.deep.equal(["T0002", "T0003"]);
    expect(body.d.__count).to.equal("2");
  });

  it("single entity by key", async () => {
    const res = await fetch(BASE + "/TravelSet('T0003')");
    expect(res.status).to.equal(200);
    const body = await res.json();
    expect(body.d.Description).to.equal("Aarhus to Odense");
    expect(body.d.__metadata.type).to.equal("ZSTG_DEMO_SRV.Travel");
  });

  it("$filter reaches the DPC as select-options", async () => {
    const res = await fetch(BASE + "/TravelSet?$filter=" + encodeURIComponent("Status eq 'X' or Status eq 'Z'"));
    expect(res.status).to.equal(200);
    const body = await res.json();
    expect(body.d.results.map((r) => r.TravelId)).to.deep.equal(["T0003"]);
  });

  it("$count", async () => {
    const res = await fetch(BASE + "/TravelSet/$count");
    expect(res.status).to.equal(200);
    expect(await res.text()).to.equal("4");
  });

  it("404 with an OData error body", async () => {
    const res = await fetch(BASE + "/TravelSet('NOPE')");
    expect(res.status).to.equal(404);
    const body = await res.json();
    expect(body.error.code).to.equal("STG/ENTITY_NOT_FOUND");
  });

  it("501 for writes, honestly", async () => {
    const res = await fetch(BASE + "/TravelSet", {method: "POST", body: "{}", headers: {"content-type": "application/json"}});
    expect(res.status).to.equal(501);
  });
});
