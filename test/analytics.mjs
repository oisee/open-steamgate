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

  it("keeps the four attributed TLC sample rows beside the synthetic ones", async () => {
    // the synthetic facts are FACT_ID 9000000001 and up (ZCL_OSD_DEMO_DATA);
    // everything below is sample or imported data and is never touched
    const url = S + "/Zc_Osd_TaxicubeSet?$select=BOROUGH,TRIPS,FARE,TIP&$filter=FACTID lt '9000000000'&$orderby=BOROUGH&$format=json";
    const response = await fetch(url);
    expect(response.status).to.equal(200);
    const rows = (await response.json()).d.results;
    expect(rows.map((row) => row.BOROUGH)).to.deep.equal(["Bronx", "Brooklyn", "Manhattan", "Queens"]);
    expect(rows.reduce((n, row) => n + row.TRIPS, 0)).to.equal(4);
    expect(rows.reduce((n, row) => n + Number(row.FARE), 0)).to.be.closeTo(99.4, 0.001);
  });

  it("serves the synthetic month with a plausible shape", async () => {
    // the host started with the default size (tools/osd-demo-data.mjs):
    // 20000 synthetic groups, the same on every host for the same seed
    const count = await (await fetch(S + "/Zc_Osd_TaxicubeSet/$count?$filter=FACTID ge '9000000000'")).text();
    expect(Number(count)).to.equal(20000);
    const url = S + "/Zc_Osd_TaxicubeSet?$select=BOROUGH,TRIPS,FARE,TIP,DISTANCE&$filter=FACTID ge '9000000000'&$format=json";
    const rows = (await (await fetch(url)).json()).d.results;
    const by = Object.fromEntries(rows.map((row) => [row.BOROUGH.trim(), row]));
    const trips = rows.reduce((n, row) => n + row.TRIPS, 0);
    expect(trips).to.be.greaterThan(50000);
    expect(Object.keys(by).sort()).to.deep.equal(["Bronx", "Brooklyn", "EWR", "Manhattan", "N/A", "Queens", "Staten Island", "Unknown"]);
    // Manhattan dominates, as it does in the TLC's yellow-cab records
    expect(by.Manhattan.TRIPS / trips).to.be.within(0.8, 0.95);
    // the airports make Queens trips long and dear
    const perTrip = (b, m) => Number(by[b][m]) / by[b].TRIPS;
    expect(perTrip("Queens", "DISTANCE")).to.be.greaterThan(3 * perTrip("Manhattan", "DISTANCE"));
    expect(perTrip("Manhattan", "FARE")).to.be.within(8, 20);
    // tips mostly on card, next to none on cash
    const pay = (await (await fetch(S + "/Zc_Osd_TaxicubeSet?$select=PAYMENT,TRIPS,FARE,TIP&$filter=FACTID ge '9000000000'&$format=json")).json()).d.results;
    const p = Object.fromEntries(pay.map((row) => [row.PAYMENT.trim(), row]));
    expect(Number(p.Card.TIP) / Number(p.Card.FARE)).to.be.within(0.12, 0.22);
    expect(Number(p.Cash.TIP) / Number(p.Cash.FARE)).to.be.below(0.01);
    expect(p.Card.TRIPS / trips).to.be.within(0.6, 0.85);
    // night low, evening peak
    const hours = (await (await fetch(S + "/Zc_Osd_TaxicubeSet?$select=PICKUPHOUR,TRIPS&$filter=FACTID ge '9000000000'&$format=json")).json()).d.results;
    const h = Object.fromEntries(hours.map((row) => [row.PICKUPHOUR, row.TRIPS]));
    expect(h[18]).to.be.greaterThan(5 * h[4]);
  });
});
