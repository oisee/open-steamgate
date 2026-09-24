import {expect} from "chai";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DuckDBInstance} from "@duckdb/node-api";
import {importTaxiTrips, sources} from "../tools/import-nyc-taxi.mjs";
import {benchmarkTaxi, taxiQueryUrl} from "../tools/bench-taxi.mjs";

describe("NYC TLC import", function () {
  this.timeout(30000);

  it("validates the source month before constructing an official URL", () => {
    expect(sources("2025-01").parquet).to.match(/\/yellow_tripdata_2025-01\.parquet$/);
    expect(() => sources("../secret")).to.throw("month must be YYYY-MM");
  });

  it("replaces one client atomically with valid, enriched trip facts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-taxi-import-"));
    const database = join(dir, "taxi.duckdb");
    const parquet = join(dir, "trips.parquet");
    const zones = join(dir, "zones.csv");
    let instance = await DuckDBInstance.create(database);
    let connection = await instance.connect();
    try {
      // the shape a build before the PICKUP_ZONE rename booted: the import
      // migrates it (tools/osd-db-migrate.mjs)
      await connection.run(`CREATE TABLE zosd_taxifact (
        mandt VARCHAR, fact_id VARCHAR PRIMARY KEY, pickup_day VARCHAR,
        pickup_hour INTEGER, borough VARCHAR, zone VARCHAR, payment VARCHAR,
        trips INTEGER, fare DECIMAL(15,2), tip DECIMAL(15,2), distance DECIMAL(15,2))`);
      await connection.run("INSERT INTO zosd_taxifact VALUES ('123','0000000001','20240101',0,'Old','Old','Cash',1,1,0,1)");
      await connection.run(`COPY (
        SELECT TIMESTAMP '2025-01-02 08:30:00' AS tpep_pickup_datetime,
          1 AS PULocationID, 1 AS payment_type, 12.5 AS fare_amount,
          2.5 AS tip_amount, 3.25 AS trip_distance
        UNION ALL
        SELECT TIMESTAMP '2025-01-03 09:00:00', 2, 2, 20.0, 0.0, 5.0
        UNION ALL
        SELECT TIMESTAMP '2025-01-02 08:45:00', 1, 1, 6.0, 1.0, 1.0
        UNION ALL
        SELECT TIMESTAMP '2025-01-04 10:00:00', 2, 2, -1.0, 0.0, 5.0
      ) TO '${parquet}' (FORMAT parquet)`);
      writeFileSync(zones, "LocationID,Borough,Zone,service_zone\n1,Manhattan,Midtown,Yellow Zone\n2,Queens,JFK Airport,Airports\n");
      connection.closeSync();
      instance.closeSync();
      connection = undefined;
      instance = undefined;

      const result = await importTaxiTrips({database, month: "2025-01", parquet, zones});
      expect(result.rows).to.equal(2);
      expect(result.trips).to.equal(3);
      instance = await DuckDBInstance.create(database);
      connection = await instance.connect();
      const read = await connection.runAndReadAll("SELECT pickup_day, pickup_hour, borough, pickup_zone, payment, trips, fare, tip FROM zosd_taxifact ORDER BY pickup_day");
      const rows = read.getRowObjects();
      expect(rows.map((row) => [row.pickup_day, row.pickup_hour, row.borough, row.pickup_zone, row.payment, row.trips]))
        .to.deep.equal([
          ["20250102", 8, "Manhattan", "Midtown", "Card", 2],
          ["20250103", 9, "Queens", "JFK Airport", "Cash", 1],
        ]);
      expect(rows[0].fare.toString()).to.equal("18.50");
      expect(rows[0].tip.toString()).to.equal("3.50");
      connection.closeSync();
      instance.closeSync();
      connection = undefined;
      instance = undefined;

      try {
        await importTaxiTrips({database, month: "2025-02", parquet, zones});
        expect.fail("the wrong month should contain no valid trips");
      } catch (error) {
        expect(error.message).to.equal("no valid trips found for selected month");
      }
      instance = await DuckDBInstance.create(database);
      connection = await instance.connect();
      const preserved = await connection.runAndReadAll("SELECT COUNT(*) AS n FROM zosd_taxifact");
      expect(Number(preserved.getRowObjects()[0].n)).to.equal(2);
    } finally {
      connection?.closeSync();
      instance?.closeSync();
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

describe("NYC taxi analytical benchmark", () => {
  it("keeps OData system-option names literal while escaping filter values", () => {
    const url = taxiQueryUrl("http://localhost:31777", "$filter=BOROUGH eq 'Manhattan'&$select=PICKUPZONE,TRIPS&$orderby=TRIPS desc");
    expect(url).to.include("?$filter=BOROUGH%20eq%20%27Manhattan%27&$select=PICKUPZONE,TRIPS&$orderby=TRIPS%20desc");
    expect(url).to.not.include("%24select");
  });

  it("measures the four breakdowns and default table, refusing a full-table response", async () => {
    let calls = 0;
    const fetcher = async (url) => {
      calls++;
      expect(url).to.include("$select=");
      return new Response(JSON.stringify({d: {results: [{TRIPS: 3}]}}), {status: 200});
    };
    const report = await benchmarkTaxi("http://localhost:31777", fetcher);
    expect(Object.keys(report)).to.have.length(5);
    expect(calls).to.equal(30);
    try {
      await benchmarkTaxi("http://localhost:31777", async () => new Response(
        JSON.stringify({d: {results: Array.from({length: 301}, () => ({}))}}), {status: 200}));
      expect.fail("an unaggregated response should not be a valid benchmark");
    } catch (error) {
      expect(error.message).to.contain("expected an analytical aggregate");
    }
  });
});
