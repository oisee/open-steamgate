# NYC taxi analytical demo

The launchpad's **NYC taxi analytics** tile is a Fiori Elements V2 Analytical
List Page. It has an interactive chart, an analytical table and filters for
pickup day, hour, borough, zone and payment method. Both read the same
`Zc_Osd_TaxicubeSet` OData entity; measures are summed by the dimensions
requested by the page. The four bundled rows are an attributed UI smoke
sample from NYC TLC's January 2025 yellow taxi records. Beside them every
host makes 20000 synthetic groups at start (`FACT_ID` 9000000001 and up,
`OSD_DEMO_ROWS`), the same rows on every runtime: see
[demo-data.md](demo-data.md). An imported month of at least that size is
left alone.
The page starts in compact-filter mode. Each of its five filter fields has
F4 value help backed by the same analytical entity set, which groups by the
requested dimension; no separate lookup table is needed for this demo.

For the large demo, use a **separate DuckDB file**. The raw official Parquet
and taxi-zone lookup are downloaded on demand into `.local/data/nyc-tlc/`;
neither is committed or shipped in the OSD image. Source:
[NYC TLC trip records](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page)
and its [yellow taxi field dictionary](https://www.nyc.gov/assets/tlc/downloads/pdf/data_dictionary_trip_records_yellow.pdf).
TLC says the records are provider-submitted and does not guarantee accuracy.

1. Build this branch and boot an isolated OSD once to create its schema:

   ```sh
   npm run transpile
   STG_SERVE=inline STG_DB=duckdb STG_DB_PATH=.local/db/taxi-demo.duckdb \
     STG_PORT=31577 STG_TLS=0 node test/run.mjs
   ```

2. Stop that OSD process. Import while no server has the DuckDB file open:

   ```sh
   node tools/import-nyc-taxi.mjs --db .local/db/taxi-demo.duckdb --month 2025-01
   ```

   For a smaller rehearsal, add `--limit 100000`. Repeating the import
   replaces that client's prior taxi facts in one transaction; an invalid
   source leaves the old set intact. The default client is the runtime client
   `123`. Only January 2025 has been tested against the official file so far.

3. Start the same OSD command again and open
   `http://localhost:31577/app/taxi/index.html` or the launchpad tile.
   Measure the five OData query shapes, including the actual default table:

   ```sh
   node tools/bench-taxi.mjs http://127.0.0.1:31577
   ```

   To check the complete UI against the imported month, stop that server
   first (DuckDB allows one process to own this writable file), then run:

   ```sh
   OSD_TAXI_FULL=1 STG_DB=duckdb STG_DB_PATH=.local/db/taxi-demo.duckdb \
     STG_PORT=31777 STG_TLS=0 npx playwright test test/e2e/taxi.spec.mjs
   ```

The import filters invalid or extreme monetary and distance values, joins
pickup zone names, and groups trips by day, hour, borough, zone and payment
method. This retains the dimensions the Fiori page can filter or pivot. The
default table groups by borough, zone and payment, with day and hour available
as filters rather than initial columns. The latter would produce 95,156 table
groups from January 2025, and current SADL applies `$top` only after reading
all groups. The default view produces 1,148 groups and still represents all
3,330,984 source trips. On the i7 test host its OData query had a 114 ms median
(five warm runs), versus 12 seconds for the day/hour table. These are
observations, not a Raspberry Pi performance claim. The table is an
analytical fact table: `TRIPS` counts underlying trips, not rows in the
table. It is deliberately not a per-trip drilldown. Tip amounts in TLC data
are most complete for card payments; compare payment methods with that caveat.

The pickup zone is the table field `PICKUP_ZONE`, not `ZONE`: a system
refuses `ZONE` as a reserved word (ANORMALIES zone-reserved-word), and it
refuses the CDS element `Zone` for the same reason, so the cube's element is
`PickupZone` and the OData property is `PICKUPZONE`. A DuckDB
file booted or imported before the rename is migrated when a server opens it
and when the import runs (`tools/osd-db-migrate.mjs`): the column is renamed
in place, the rows stay, and the file's views are made again from the
running build, all in one transaction. Nothing needs to be imported again.
The import tool renames the column itself but cannot remake the views (it
does not have the build's view list), so after an import into an old file
the views still select `zone` until the next server start makes them again;
start the server before reading the cube.
The migration is one way: a build from before the rename cannot read the
file afterwards. A view in the file that the running build does not have (a
deleted CDS view, one made by hand) is named in the log and left as it is;
if it selects `zone`, it no longer works. A kept HANA schema
(`STG_DB=hana`) is not migrated: the boot refuses it and names
`STG_DB_FRESH=1`. The check reads table columns only, and HANA's views are
not remade at boot, so a schema made by a build that had the column rename
but not yet `PickupZone` passes it and fails at its first
`SELECT ... PICKUPZONE`; recreate that one with `STG_DB_FRESH=1` as well.

Adding the DDIC table changes the generated schema. Existing OSD database
volumes need the planned non-destructive migration before this branch can be
used as an upgrade. Build and test with a fresh isolated file; do not point
this prototype at a live stack volume.
