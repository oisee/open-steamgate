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

  it("navigation and $expand", async () => {
    let res = await fetch(BASE + "/TravelSet('T0001')/to_Bookings");
    expect(res.status).to.equal(200);
    let body = await res.json();
    expect(body.d.results.map((b) => b.BookingId)).to.deep.equal(["B001", "B002"]);
    expect(body.d.results[0].FlightDate).to.match(/^\/Date\(\d+\)\/$/);

    res = await fetch(BASE + "/TravelSet?$expand=to_Bookings&$top=1");
    body = await res.json();
    expect(body.d.results[0].to_Bookings.results).to.have.length(2);
    expect(body.d.results[0].to_Bookings.results[1].Customer).to.equal("Grace Hopper");

    res = await fetch(BASE + "/BookingSet(TravelId='T0002',BookingId='B001')?$expand=to_Travel");
    body = await res.json();
    expect(body.d.to_Travel.Description).to.equal("Copenhagen to Aarhus");

    res = await fetch(BASE + "/TravelSet('T0002')");
    body = await res.json();
    expect(body.d.to_Bookings.__deferred.uri).to.equal(BASE + "/TravelSet('T0002')/to_Bookings");
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

  it("$batch with a retrieve part and a changeset", async () => {
    const crlf = "\r\n";
    const body = [
      "--b", "Content-Type: application/http", "Content-Transfer-Encoding: binary", "",
      "GET TravelSet?$top=2&$inlinecount=allpages HTTP/1.1", "Accept: application/json", "", "",
      "--b", "Content-Type: multipart/mixed; boundary=cs", "",
      "--cs", "Content-Type: application/http", "Content-Transfer-Encoding: binary", "",
      "POST TravelSet HTTP/1.1", "Content-Type: application/json", "", JSON.stringify({TravelId: "T0400", Description: "via batch", Seats: 1}),
      "--cs", "Content-Type: application/http", "Content-Transfer-Encoding: binary", "",
      "DELETE TravelSet('T0400') HTTP/1.1", "", "",
      "--cs--", "", "--b--", "",
    ].join(crlf);
    const res = await fetch(BASE + "/$batch", {method: "POST", headers: {"content-type": "multipart/mixed; boundary=b", "x-csrf-token": "open-steamgate"}, body});
    expect(res.status).to.equal(202);
    expect(res.headers.get("content-type")).to.match(/^multipart\/mixed; boundary=batchresponse_stg_/);
    const text = await res.text();
    expect(text).to.contain("HTTP/1.1 200 OK");
    expect(text).to.contain('"__count":"2"');
    expect(text).to.contain("HTTP/1.1 201 Created");
    expect(text).to.contain("HTTP/1.1 204 No Content");
    expect((text.match(/--batchresponse_stg_\d+--/g) || []).length).to.equal(1);
  });

  it("CSRF token fetch is answered", async () => {
    const res = await fetch(BASE + "/", {headers: {"x-csrf-token": "Fetch"}});
    expect(res.status).to.equal(200);
    expect(res.headers.get("x-csrf-token")).to.equal("open-steamgate");
  });

  it("POST, PUT, DELETE round trip through the DPC", async () => {
    const headers = {"content-type": "application/json", "x-csrf-token": "open-steamgate"};
    let res = await fetch(BASE + "/TravelSet", {method: "POST", headers, body: JSON.stringify({TravelId: "T0200", Description: "Wire created", Status: "A", Seats: 1})});
    expect(res.status).to.equal(201);
    expect(res.headers.get("location")).to.equal("http://localhost:3030/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0200')");
    expect((await res.json()).d.Description).to.equal("Wire created");

    res = await fetch(BASE + "/TravelSet('T0200')", {method: "PUT", headers, body: JSON.stringify({d: {Description: "Wire updated", Status: "X", Seats: 2}})});
    expect(res.status).to.equal(204);

    res = await fetch(BASE + "/TravelSet('T0200')");
    const body = await res.json();
    expect(body.d.Description).to.equal("Wire updated");
    expect(body.d.Seats).to.equal(2);

    res = await fetch(BASE + "/TravelSet('T0200')", {method: "DELETE", headers});
    expect(res.status).to.equal(204);
    res = await fetch(BASE + "/TravelSet('T0200')");
    expect(res.status).to.equal(404);

    res = await fetch(BASE + "/TravelSet", {method: "POST", headers, body: JSON.stringify({TravelId: "T0001"})});
    expect(res.status).to.equal(400);
    expect((await res.json()).error.code).to.equal("STG/BUSINESS");
  });
});
