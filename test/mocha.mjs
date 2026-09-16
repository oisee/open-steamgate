import {expect} from "chai";
import {startServer} from "./start.mjs";
// the port of the gateway under test: STG_PORT, as test/start.mjs reads it, so sessions do not collide on 3030
const PORT = process.env.STG_PORT ?? 3030;

const BASE = `http://localhost:${PORT}/sap/opu/odata/sap/ZSTG_DEMO_SRV`;

describe("wire", () => {
  let server;

  before(() => {
    server = startServer(true);
  });

  after(() => {
    server.close();
  });

  // The front door is the launchpad: every app and every demo the system
  // serves is a tile on it, the UI5 ones as components and the ABAP-written
  // pages as plain URLs, which is the honest shape — a tile points at a
  // service and what is behind it need not be UI5 to belong on the page.
  it("root is the launchpad, and the launchpad names what this system serves", async () => {
    const res = await fetch(`http://localhost:${PORT}/`, {redirect: "manual"});
    expect(res.status).to.equal(302);
    expect(res.headers.get("location")).to.equal("/app/flp.html");
    const page = await (await fetch(`http://localhost:${PORT}/app/flp.html`)).text();
    for (const tile of ["Travels", "Bookings", "Flight analytics", "SEGW", "Vivid Vibes", "Zork"]) {
      expect(page, tile).to.contain(tile);
    }
    expect(page, "the demo behind its tile").to.contain("../sap/bc/zo4d_demo");
    expect(page, "zork behind its tile").to.contain("../sap/bc/zork");
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
      `http://localhost:${PORT}/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0001')`);
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

  it("deep insert: a travel with its bookings in one POST", async () => {
    const headers = {"content-type": "application/json", "x-csrf-token": "open-steamgate"};
    let res = await fetch(BASE + "/TravelSet", {method: "POST", headers, body: JSON.stringify({
      TravelId: "T0700", Description: "Deep over the wire", Status: "A", Seats: 1,
      to_Bookings: [{BookingId: "B001", Customer: "Barbara Liskov"}],
    })});
    expect(res.status).to.equal(201);
    const body = await res.json();
    expect(body.d.to_Bookings.results[0].Customer).to.equal("Barbara Liskov");
    res = await fetch(BASE + "/TravelSet('T0700')/to_Bookings");
    expect((await res.json()).d.results).to.have.length(1);
    await fetch(BASE + "/TravelSet('T0700')", {method: "DELETE", headers});
  });

  it("media entity: the picture of a travel over the wire", async () => {
    // $metadata says the type has a stream, the JSON says where it is
    const meta = await (await fetch(`${BASE}/$metadata`)).text();
    expect(meta).to.contain('<EntityType Name="Photo" m:HasStream="true"');
    const photo = await (await fetch(`${BASE}/PhotoSet('T0001')?$format=json`)).json();
    expect(photo.d.__metadata.media_src).to.equal(`${BASE}/PhotoSet('T0001')/$value`);
    expect(photo.d.FileName).to.equal("t0001.png");

    // the bytes themselves, with their content type
    const res = await fetch(`${BASE}/PhotoSet('T0001')/$value`);
    expect(res.status).to.equal(200);
    expect(res.headers.get("content-type")).to.equal("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).to.equal(930);
    expect([...bytes.slice(0, 8)]).to.deep.equal([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // and the travel points at it, so Fiori Elements can show it
    const travel = await (await fetch(`${BASE}/TravelSet('T0003')?$format=json`)).json();
    expect(travel.d.PhotoUrl).to.equal("../sap/opu/odata/sap/ZSTG_DEMO_SRV/PhotoSet('T0003')/$value");
  });

  it("function imports", async () => {
    let res = await fetch(BASE + "/TravelCount?Status='A'");
    expect(res.status).to.equal(200);
    expect((await res.json()).d.TravelCount).to.equal(3);

    res = await fetch(BASE + "/CancelTravel?TravelId='T0009'", {method: "POST", headers: {"x-csrf-token": "open-steamgate"}});
    expect(res.status).to.equal(200);
    expect((await res.json()).d.Status).to.equal("X");
    // put the seed row back for the tests that follow
    res = await fetch(BASE + "/TravelSet('T0009')", {method: "PUT", headers: {"content-type": "application/json", "x-csrf-token": "open-steamgate"}, body: JSON.stringify({Description: "Other client, must not leak", Status: "A", Seats: 9})});
    expect(res.status).to.equal(204);
  });

  it("SADL service over CDS views: read, navigate, aggregate", async () => {
    const S = `http://localhost:${PORT}/sap/opu/odata/sap/ZSTG_SADL_SRV`;
    let res = await fetch(S + "/$metadata");
    expect(res.status).to.equal(200);
    const xml = await res.text();
    expect(xml).to.contain('<EntitySet Name="Zc_Stg_TravelcubeSet"');
    expect(xml).to.contain('sap:semantics="aggregate"');
    expect(xml).to.contain('Term="com.sap.vocabularies.UI.v1.LineItem"');

    res = await fetch(S + "/Zc_Stg_TravelSet?$filter=STATUS eq 'A'&$orderby=TRAVELID desc");
    expect(res.status).to.equal(200);
    expect((await res.json()).d.results.map((r) => r.TRAVELID)).to.deep.equal(["T0009", "T0002", "T0001"]);

    res = await fetch(S + "/Zc_Stg_TravelSet('T0001')/TO_BOOKINGS");
    expect((await res.json()).d.results.map((r) => r.BOOKINGID)).to.deep.equal(["B001", "B002"]);

    res = await fetch(S + "/Zc_Stg_TravelcubeSet?$select=STATUS,SEATS&$orderby=STATUS");
    const rows = (await res.json()).d.results.map((r) => [r.STATUS, r.SEATS]);
    expect(rows).to.deep.equal([["A", 12], ["X", 4]]);
  });

  it("virtual elements: a CDS field an ABAP class calculates after the read", async () => {
    const S = `http://localhost:${PORT}/sap/opu/odata/sap/ZSTG_SADL_SRV`;
    // the model says they exist and that the database cannot order or filter by them
    const xml = await (await fetch(S + "/$metadata")).text();
    expect(xml).to.contain('<Property Name="OCCUPANCY" Type="Edm.String" Nullable="true" MaxLength="12" sap:unicode="false" sap:label="Occupancy" sap:creatable="false" sap:updatable="false" sap:sortable="false" sap:filterable="false"/>');
    expect(xml).to.contain('<Property Name="FREESEATS" Type="Edm.Int32"');

    // zcl_stg_travel_calc fills them: occupancy from the row, free seats from
    // the bookings of that travel (T0001 has 2 seats and 2 bookings)
    const rows = (await (await fetch(S + "/Zc_Stg_TravelSet?$format=json")).json()).d.results;
    expect(rows.map((r) => [r.TRAVELID, r.OCCUPANCY, r.FREESEATS])).to.deep.equal([
      ["T0001", "20% of 10", 0],
      ["T0002", "10% of 10", 0],
      ["T0003", "40% of 10", 4],
      ["T0009", "90% of 10", 9],
    ]);
    const one = (await (await fetch(S + "/Zc_Stg_TravelSet('T0003')?$format=json")).json()).d;
    expect(one.OCCUPANCY).to.equal("40% of 10");
    expect(one.FREESEATS).to.equal(4);

    // and SADL refuses what it cannot do, instead of failing in SQL
    for (const query of ["$filter=OCCUPANCY eq 'x'", "$orderby=FREESEATS"]) {
      const res = await fetch(`${S}/Zc_Stg_TravelSet?${query}`);
      expect(res.status).to.equal(400);
      expect((await res.json()).error.message.value).to.contain("is a virtual element");
    }
  });

  it("@OData.publish: a CDS view is a service, without SEGW", async () => {
    const S = `http://localhost:${PORT}/sap/opu/odata/sap/ZC_STG_TRAVEL_CDS`;
    // the annotation on the view generated the model, the registration
    // objects and the classes; the registry serves them like any other service
    const doc = await (await fetch(S + "/")).json();
    expect(doc.d.EntitySets).to.deep.equal(["Zc_Stg_TravelSet"]);

    const xml = await (await fetch(S + "/$metadata")).text();
    expect(xml).to.contain('<EntityType Name="Zc_Stg_Travel"');
    expect(xml).to.contain('<EntitySet Name="Zc_Stg_TravelSet"');

    const rows = (await (await fetch(S + "/Zc_Stg_TravelSet?$format=json&$filter=STATUS eq 'A'")).json()).d.results;
    expect(rows.map((r) => r.TRAVELID)).to.deep.equal(["T0001", "T0002", "T0009"]);
    // the virtual elements of the view are part of the published service too
    expect(rows[0].OCCUPANCY).to.equal("20% of 10");

    // the cube views are published as well
    const cube = await (await fetch(`http://localhost:${PORT}/sap/opu/odata/sap/ZC_STG_FLIGHTCUBE_CDS/`)).json();
    expect(cube.d.EntitySets).to.deep.equal(["Zc_Stg_FlightcubeSet"]);
  });

  it("writes through a CDS projection: @ObjectModel.writeEnabled", async () => {
    const S = `http://localhost:${PORT}/sap/opu/odata/sap/ZC_STG_TRAVEL_CDS`;
    const write = {"content-type": "application/json", "x-csrf-token": "open-steamgate"};

    // the view is a projection of one table field for field, so SADL writes
    // through it: the row lands in ZSTG_DEMO
    let res = await fetch(S + "/Zc_Stg_TravelSet", {method: "POST", headers: write,
      body: JSON.stringify({TRAVELID: "T0700", DESCRIPTION: "Through the projection", STATUS: "A", SEATS: 3})});
    expect(res.status).to.equal(201);

    const demo = await (await fetch(`${BASE}/TravelSet('T0700')?$format=json`)).json();
    expect(demo.d.Description).to.equal("Through the projection");

    res = await fetch(S + "/Zc_Stg_TravelSet('T0700')", {method: "PUT", headers: write,
      body: JSON.stringify({DESCRIPTION: "Renamed", STATUS: "X", SEATS: 5})});
    expect(res.status).to.equal(204);
    const after = (await (await fetch(S + "/Zc_Stg_TravelSet('T0700')?$format=json")).json()).d;
    expect([after.DESCRIPTION, after.STATUS, after.SEATS]).to.deep.equal(["Renamed", "X", 5]);
    // the virtual element is recalculated on the way out
    expect(after.OCCUPANCY).to.equal("50% of 10");

    res = await fetch(S + "/Zc_Stg_TravelSet('T0700')", {method: "DELETE", headers: write});
    expect(res.status).to.equal(204);
    expect((await fetch(`${BASE}/TravelSet('T0700')`)).status).to.equal(404);

    // a view that did not ask for writes, and an analytical one, are refused
    // by the model, before any DPC method is looked for
    res = await fetch(`http://localhost:${PORT}/sap/opu/odata/sap/ZC_STG_FLIGHTCUBE_CDS/Zc_Stg_FlightcubeSet`,
      {method: "POST", headers: write, body: "{}"});
    expect(res.status).to.equal(405);
    expect((await res.json()).error.message.value).to.contain("is not creatable");

    res = await fetch(`http://localhost:${PORT}/sap/opu/odata/sap/ZSTG_SADL_SRV/Zc_Stg_TravelSet('T0001')`,
      {method: "DELETE", headers: write});
    expect(res.status).to.equal(405);
    expect((await fetch(`${BASE}/TravelSet('T0001')`)).status).to.equal(200);
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
    expect(res.headers.get("location")).to.equal(`http://localhost:${PORT}/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0200')`);
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
