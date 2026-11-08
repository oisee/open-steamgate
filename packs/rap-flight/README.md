# rap-flight: SAP's RAP flight reference scenario as a pack

`osd-pack.json` fetches the public, Apache-2.0
[SAP-samples/abap-platform-refscen-flight](https://github.com/SAP-samples/abap-platform-refscen-flight)
at a pinned commit of its `ABAP-platform-2025` branch into `upstream/`
(`node tools/osd-fetch.mjs rap-flight`), minus what the manifest excludes --
each pattern with its reason in `_exclude_why`. `src/` layers over it. What
compiles, what is refused and what each wall blocks is measured in
[docs/rap-flight-pack.md](../../docs/rap-flight-pack.md).

What the fetch keeps: the managed scenario (`managed/`), the reuse layer it
reads (`reuse/`, `reuse/agency`, `reuse/carrier`, `reuse/supplement`), the
read-only views (`readonly/`) and the legacy base (`legacy/`): the tables the
managed data generator copies from and the data generator itself.

## The overlay (`src/`)

Stand-ins for released SAP DDIC the libraries do not carry yet (`src/ddic/`;
the DDIC rule of CLAUDE.md says released objects go to open-abap-core, so
these are to send upstream and then drop):

- `ABP_LOCINST_LASTCHANGE_USER` (CHAR 12), used by eight tables
- `SDRAFT_UUID` (RAW 16), the draft tables' key; they compile, no draft runs
- `I_CURRENCY` and `I_COUNTRYTEXT` as plain tables with the columns the
  scenario reads (`SELECT DISTINCT currency`, `country, countryname`)

Copies of the two data generators, changed where this runtime differs from a
system and nowhere else (every change is marked `OSD overlay` in the source):

- `/dmo/cl_flight_data_generator`: `GET BADI` / `CALL BADI` are not
  transpiled and the BAdI definition is an ENHS, so the one implementation
  is called directly; `cl_numberrange_intervals` has no intervals here, so
  the reset is a no-op and the three blocks of numbers are drawn from the
  interval's lower bound (what a fresh system gives); `cl_abap_random_int8`
  is absent, so phone numbers get nine digits; `CORRESPONDING ... DISCARDING
  DUPLICATES`, the lookup form `CORRESPONDING #( a FROM b USING ... )` and a
  `SWITCH` over two `REDUCE`s with `LET` are not parsed, so they are spelled
  out as loops. The non-ASCII city names in its literals are upstream's.
- `/dmo/cl_data_generator_managed`: the two lookup-form `CORRESPONDING`s.

`zcl_osd_rapflight_seed` runs the generator with a console and reports the
row counts; `tools/rap-flight/seed-capture.mjs` calls it and writes the rows
into `data/*.tabu.json`.

`zosd_rapflight.stg.yaml` serves the CDS interface views the generator takes
as read-only entity sets (`/sap/opu/odata/sap/ZOSD_RAPFLIGHT_SRV`), so the
seeded data can be read over the wire. No behavior runs: the business
objects are what the RAP runtime cannot take yet (see the document).

Upstream's files are Apache-2.0 (the repository's `LICENSES/` and
`REUSE.toml`); the copies in `src/` keep that licence.
