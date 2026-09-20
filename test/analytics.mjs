import {expect} from "chai";
import {startServer} from "./start.mjs";
// the port of the gateway under test: STG_PORT, as test/start.mjs reads it, so sessions do not collide on 3030
const PORT = process.env.STG_PORT ?? 3030;

const S = `http://localhost:${PORT}/sap/opu/odata/sap/ZSTG_SADL_SRV`;

// the analytical cube over the flight facts, the way an Analytical List Page
// asks: $select on dimensions and measures, $orderby, $top, $inlinecount, $filter
describe("analytics: ZC_STG_FLIGHTCUBE through SADL", () => {
  let server;

  before(() => {
    server = startServer(true);
  });

  after(() => {
    server.close();
  });

  it("$metadata marks the cube and its dimensions and measures", async () => {
    const res = await fetch(S + "/$metadata");
    const xml = await res.text();
    expect(xml).to.contain('<EntityType Name="Zc_Stg_Flightcube"');
    expect(xml).to.match(/EntityType Name="Zc_Stg_Flightcube"[^>]*sap:semantics="aggregate"/);
    expect(xml).to.match(/Name="AIRLINE"[^>]*sap:aggregation-role="dimension"/);
    expect(xml).to.match(/Name="REVENUE"[^>]*Type="Edm.Decimal"[^>]*sap:aggregation-role="measure"/);
  });

  it("groups by the selected dimensions and sums the measures", async () => {
    const res = await fetch(S + "/Zc_Stg_FlightcubeSet?$select=AIRLINE,SEATS,REVENUE&$orderby=AIRLINE&$format=json");
    expect(res.status).to.equal(200);
    const rows = (await res.json()).d.results;
    expect(rows.map((r) => r.AIRLINE)).to.deep.equal(["AA", "BA", "LH", "SQ"]);
    // 3 months x (3 + 1) seats, 3 x (420 + 150)
    expect(rows[0].SEATS).to.equal(12);
    expect(Number(rows[0].REVENUE)).to.equal(1710);
  });

  it("filters on a dimension, orders by a measure, pages and counts", async () => {
    const res = await fetch(S + "/Zc_Stg_FlightcubeSet?$select=AIRLINE,FLIGHTMONTH,SEATS&$filter=STATUS eq 'A'&$orderby=SEATS desc,AIRLINE&$top=2&$inlinecount=allpages&$format=json");
    expect(res.status).to.equal(200);
    const d = (await res.json()).d;
    expect(d.results).to.have.length(2);
    expect(d.results.every((r) => r.SEATS === 3)).to.equal(true);
    expect(Number(d.__count)).to.equal(12);
  });
});

describe("analytics: NYC taxi cube through SADL", () => {
  let server;
  before(() => { server = startServer(true); });
  after(() => { server.close(); });

  it("exposes real dimensions and additive measures in the OData metadata", async () => {
    const xml = await (await fetch(S + "/$metadata")).text();
    expect(xml).to.match(/EntityType Name="Zc_Osd_Taxicube"[^>]*sap:semantics="aggregate"/);
    expect(xml).to.match(/Name="BOROUGH"[^>]*sap:aggregation-role="dimension"/);
    expect(xml).to.match(/Name="TRIPS"[^>]*sap:aggregation-role="measure"/);
    expect(xml).to.match(/Name="TIP"[^>]*sap:aggregation-role="measure"/);
  });

  it("groups the four attributed TLC sample rows before sending them to Fiori", async () => {
    const url = S + "/Zc_Osd_TaxicubeSet?$select=BOROUGH,TRIPS,FARE,TIP&$orderby=BOROUGH&$format=json";
    const response = await fetch(url);
    expect(response.status).to.equal(200);
    const rows = (await response.json()).d.results;
    expect(rows.map((row) => row.BOROUGH)).to.deep.equal(["Bronx", "Brooklyn", "Manhattan", "Queens"]);
    expect(rows.reduce((n, row) => n + row.TRIPS, 0)).to.equal(4);
    expect(rows.reduce((n, row) => n + Number(row.FARE), 0)).to.be.closeTo(99.4, 0.001);
  });
});
