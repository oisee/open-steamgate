import {expect} from "chai";
import {startServer} from "./start.mjs";

const S = "http://localhost:3030/sap/opu/odata/sap/ZSTG_SADL_SRV";

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
