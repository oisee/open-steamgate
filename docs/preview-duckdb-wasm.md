# DuckDB-Wasm in the browser preview

The opt-in `OSD_PREVIEW_DB=duckdb` build replaces the preview's sql.js
`DEFAULT` database connection with DuckDB-Wasm. ABAP Open SQL, OData handlers,
and Portable AMDP therefore read the same rows and share the same transaction
context. It is not a second, AMDP-only demonstration database.

Build and test locally with `npm run e2e:preview:duckdb`, or build with
`npm run web:preview:duckdb` and serve with `npm run web:serve`.

The browser service worker cannot create a nested Worker, so this uses the
official blocking DuckDB-Wasm binding inside the service worker. The build
ships the MVP Wasm module beside `sw.js`; it does not fetch code from a CDN.
The package's `./blocking` export in pinned 1.32.0 resolves to a missing Node
module, so webpack maps that specifier to the browser blocking file actually
shipped by the package.

This first version is intentionally volatile: the database is in memory and
is reseeded when the service worker is evicted or the preview resets. The
existing sql.js build remains the default and keeps its Cache Storage
snapshot. DuckDB-Wasm reports `Engine=duckdb`, `Storage=memory` in System
Status. Durable OPFS storage and a migration/reset policy are a separate
acceptance gate before changing the default Pages build.

The browser bundle contains compiled portable IR from the public AMDP
catalogue, not source SQLScript bodies or a Node compiler. An unsupported
AMDP must still refuse explicitly, never fall back to HANA or silently return
an empty table.
