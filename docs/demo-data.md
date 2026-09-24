# Demo data, made by ABAP on every host

Every host starts with the same synthetic month of NYC taxi facts in
`ZOSD_TAXIFACT`, so the taxi Analytical List Page has something to show on
the Pi, in the browser preview and in OSGo without an import. The rows are
made by ABAP, not by a script per host. The same classes run transpiled on
Node, in the service worker, compiled to Go, and on a system. There is no
per-host logic that could drift (CLAUDE.md, "a rule written once, next to its
one caller, does not survive the second caller").

| class | what it does | needs a table |
| --- | --- | --- |
| `ZCL_OSD_DEMO_RANDOM` | Park-Miller minimal standard, `fold` for checksums, weighted picks | no |
| `ZCL_OSD_DEMO_TAXI` | the taxi rows as an internal table, `checksum`, `describe` | no |
| `ZCL_OSD_DEMO_DATA` | `BOOT( knob )` and `ENSURE_TAXI( rows, seed )`: the rows in the table | ZOSD_TAXIFACT |

## How a host calls it

`tools/osd-demo-data.mjs` is the one module the Node hosts call. It passes
`OSD_DEMO_ROWS` to `ZCL_OSD_DEMO_DATA=>BOOT` inside one dialog step
(`tools/osd-dialog-step.mjs`) and logs what the class answered. It never
throws: a host that cannot make the rows starts without them.

| host | when |
| --- | --- |
| `test/start.mjs` (inline) | at module load, after the registries |
| `tools/osd-serve.mjs`, and so the binary's `osd serve` / `osd up` | at start |
| `web/preview-backend.mjs` (service worker) | `startBackend`; `resetBackend` too, once #60's reset fix is in |
| OSGo (`tools/gogen`, branch `ultra/demodata`) | after `boot`, in a dialog step of its own (`go/cmd/osgo/main.go`) |

The knob:

- `OSD_DEMO_ROWS` unset or empty: `C_DEFAULT_ROWS`, 20000.
- `OSD_DEMO_ROWS=0`: no synthetic rows, and any that are there are removed.
- `OSD_DEMO_ROWS=n`: n rows, at most `C_MAX_ROWS` (200000).

The browser preview has no environment, so the build's `OSD_DEMO_ROWS` is
written into `web/generated/seed.mjs`.

## What is synthetic

Synthetic rows are `FACT_ID` 9000000001 and up. The bound
`ZCL_OSD_DEMO_TAXI=>C_SYNTHETIC_MIN` is 9000000000, which is never generated
itself, and `>=` it is the synthetic range. `tools/import-nyc-taxi.mjs`
numbers real facts from 0001000001, and the four bundled sample rows also
sit in that range. A real import would need 8.99 billion groups to reach the
synthetic range. `ENSURE_TAXI` never changes or deletes a row below the
range. When real rows already number at least the size asked for (an
imported month), it adds none and removes any synthetic rows left from an
earlier start, so the cube never counts a month twice.

No `MANDT` is named in the SELECTs or the DELETE, as on a system, where the
logon client is implicit. The transpiler has no implicit client (CLAUDE.md,
"no implicit MANDT"), so on Node they see every client's rows. The rows
written carry `sy-mandt`.

In the cube: `$filter=FACTID ge '9000000000'` is the synthetic part and
`FACTID lt '9000000000'` the rest.

## Idempotent

`ENSURE_TAXI` makes the rows it wants, puts the logon client in them, then
compares them with the synthetic rows present by number and by `CHECKSUM`.
It writes only when they differ. The same size and seed give the same table,
and a second start writes nothing. Another size or seed replaces the
synthetic rows. Should a month ever run out of cells (not below
`C_MAX_ROWS`), the report says how many rows fit.

`CHECKSUM` folds every column of a row: the key, the client, day, hour,
trips, cents of fare and tip, hundredths of a mile, the zone as its
LocationID (0 for a text not in the lookup) and the payment as its number
(0 for any other text). So Card to Cash, or one zone name for another of the
same length, is a change. What it does not tell apart: client 000, an empty
client and a client that is not digits all count as 0, and so does every
zone the lookup does not have, so one unknown zone swapped for another is
not a change. No character codes are needed, which would differ between
hosts. `GENERATE` leaves the client empty, so its checksum is
the same on every system (163171580 for the default size and seed). The
checksum in `ENSURE_TAXI`'s report includes the logon client, and on Node,
client 123, it is 2056928574.

## Deterministic, the same on every runtime

`CL_ABAP_RANDOM` is not used, because its sequence differs between a system,
open-abap-core and the Go port. `ZCL_OSD_DEMO_RANDOM` is Park and Miller's
minimal standard (x := 16807 x mod 2^31 - 1), computed with Schrage's method
(q = 127773, r = 2836). No intermediate result leaves type `i`, and no `int8`
is needed, which 7.02 does not have. Its own check holds everywhere: from 1,
step 10000 is 1043618065.

The rules the classes keep, each an ANORMALIES entry:

- DIV and MOD only with positive operands (`div-mod-negative-divisor`,
  `mod-packed-drops-fraction`);
- no `/` in integer arithmetic (`integer-division-not-rounded`);
- no type `f`: money is integer cents and distance is hundredths of a mile,
  and they become `DEC 15,2` only in the row;
- one draw per statement, so the order in which a host evaluates an
  expression cannot matter;
- a key named explicitly in sorts and comparisons
  (`delete-adjacent-default-key`, found by this work).

Measured on 2026-09-24 with `ZCL_OSD_DEMO_TAXI=>GENERATE( 20000, 20250101 )`
followed by `DESCRIBE( first = 5 )`:

```
9000000001 20250101 0 Manhattan/Penn Station/Madison Sq West/Cash 2 28.24 0.00 4.48;
9000000002 20250101 0 Manhattan/TriBeCa/Civic Center/Card 2 28.90 4.33 4.56;
9000000003 20250101 0 Manhattan/Upper West Side South/Card 8 83.76 14.23 12.24;
9000000004 20250101 0 Manhattan/Chinatown/Card 1 12.12 2.90 1.76;
9000000005 20250101 0 Manhattan/Central Park/Card 2 16.02 2.88 2.38;
rows 20000 trips 78715 fare 1264137.29 tip 178368.34 distance 215645.95 checksum 163171580
```

This result was identical, byte for byte, on four runtimes:

- A4H: the classes deployed from `src/demo_data` unchanged, in `$ZOSG_TMP_0462`,
  which was deleted afterwards;
- Node: the transpiler;
- OSGo: gogen's Go emitter and its JS emitter (`tools/gogen/semantics.mjs`,
  `ZCL_GOGEN_T_DEMODATA`);
- the browser preview: sql.js in Chromium, the same report (client 123) in its log.

The ABAP Unit test `ZCL_OSD_DEMO_TAXI` / `pinned_checksum` passes on A4H and
on Node. The cube's 555 groups by borough, payment and hour are equal on Node
and OSGo.

## The shape

A row is one group in the table's grain: pickup day (January 2025), hour,
zone and payment method. It carries the group's trip count and its summed
fare, tip and distance. No two rows share a group. Rows come in key order,
day by day and hour by hour. How many groups each day-hour gets is a weighted
draw over:

- the **hour curve**: low at night, peak at 18:00;
- the **weekday curve**.

The groups inside a day-hour are distinct (zone, payment) cells, drawn by:

- **zone weight**: Manhattan zones 12, its twenty busiest 40, JFK 40,
  LaGuardia 30, the other boroughs 1; a zone name the lookup lists twice
  counts once;
- **payment split**: card 70, cash 15, other 10, disputed 3, no charge 2.

The measures, per group:

- **trips**: 1 plus a spread that grows with the zone, hour, weekday and
  payment weights;
- **distance per trip**: from a mean per zone (Manhattan 1.9 mi, JFK 17.8
  mi) with noise of 60 to 140 per cent;
- **fare per trip**: USD 3.00 plus 4.50 a mile, with noise of 95 to 120 per
  cent; 60 per cent of JFK groups take the flat USD 70;
- **tip**: on card, 15 to 25 per cent of the fare, and none in 10 per cent of
  groups; on cash, a tip is recorded in 3 per cent of groups; on the other
  methods, never.

With the default size this comes to about 79000 trips. Manhattan has about
91 per cent of them and Queens (the airports) 7 per cent. The average
Manhattan fare is about USD 12. Card tips are about 18 per cent of the fare
and cash tips 0.2 per cent. `test/analytics.mjs` checks these ranges over
OData.

All the numbers are constants in `ZCL_OSD_DEMO_TAXI`. They are invented
parameters, not TLC statistics.

## Zones and their licence

The 265 zones are the NYC TLC taxi zone lookup (`taxi_zone_lookup.csv`,
https://d37ci6vzurychx.cloudfront.net/misc/taxi_zone_lookup.csv, the table of
the NYC Open Data dataset "NYC Taxi Zones", `8meu-9t5y`), published by the
NYC Taxi and Limousine Commission.

- **Version**: the file as downloaded on 2026-09-24, 265 rows, sha256
  `1a99e105092230f8620f301edcca7f80d3080642ff404d28ed957d3fa222c8ed`.
- **Modifications**: we keep LocationID (as the row number), Borough (as a
  one-letter code) and Zone. We drop `service_zone`.
- **Terms**: NYC Open Data is published without a registration requirement,
  licence requirement or restriction on use (NYC Open Data Law, Local Law 11
  of 2012; the
  [Open Data Policy and Technical Standards Manual](https://cityofnewyork.github.io/opendatatsm/publicpolicies.html)).
  A republisher may be asked to name the source, version and modifications,
  which this section and the class header do. The City gives no warranty of
  completeness or accuracy.

The zones are ABAP data (`ZCL_OSD_DEMO_TAXI=>ZONE_LINES`), not a seed table:

- the generator then needs no table at all, which is what let it run on A4H
  while `ZOSD_TAXIFACT` did not activate there (next section);
- the zones reach every host with the class, with no seed file to load
  first;
- a table would add a TABL, a TABU file and the seeding path on four hosts,
  and would buy nothing: the cube's F4 help already groups by the cube.

## ZOSD_TAXIFACT on a system

The table did not activate on A4H while its field was `ZONE`, a reserved
word in the dictionary there (ANORMALIES `zone-reserved-word`). This is why
the generator is its own class with its own row type. The field is
`PICKUP_ZONE` since #67 and the cube's element `PickupZone` since #69; the
generator's row type follows the table's names. `ZCL_OSD_DEMO_DATA`, which
writes the table, has not run on a system yet.

## Measured sizes and times (workstation, 2026-09-24, 20000 rows)

| host | first start (written) | second start (unchanged) |
| --- | ---: | ---: |
| Node, inline (`test/start.mjs`, SQLite in memory) | 0.8-1.1 s | (in memory: always written) |
| Node, `osd-serve` over a SQLite file | 808 ms | 901 ms |
| OSGo (SQLite file) | 571 ms | 332 ms |
| preview backend under Node (sql.js) | 0.9-1.2 s | |
| browser preview (Chromium service worker, sql.js) | 0.97-1.04 s | |

The generation alone is about 0.4 s on Node. The unchanged start costs as
much as the first on Node, because it makes the rows again to compare them;
it writes nothing. The Pi was not measured (not touched by this work).

## The flight facts, later

`tools/gen-data.mjs` (`STG_DATA_SCALE`) still makes the flight facts in
JavaScript, with a mulberry32 generator. They would move the same way:

1. `ZCL_OSD_DEMO_FLIGHT` over `ZCL_OSD_DEMO_RANDOM`, with its own synthetic
   key range above the 24 seed rows.
2. `ZCL_OSD_DEMO_DATA=>ENSURE_FLIGHTS`, with the same idempotence.
3. A second knob read by `BOOT`.

DuckDB's bulk CSV load in `gen-data.mjs` is the one thing ABAP would not do
as fast for a million rows. Whether that matters is a measurement for then.
