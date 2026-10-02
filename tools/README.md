# Tools

The top-level `osd-build.mjs`, `osd-transpile.mjs`, `osd-warm.mjs`, and `osd-hot.mjs` build and refresh generations of transpiled ABAP. Start with [the feature map](../docs/where-is.md) for their commands and tests; [warm compile](../docs/warm-compile.md) explains the short rebuild path.

The `segw-*.mjs`, `cds2ddic.mjs`, and `stg-compile.mjs` files turn service, CDS, and project descriptions into source or registry artifacts. The corresponding behavior is described in [SEGW mapping](../docs/segw-mapping.md), [SEGW tree](../docs/segw-tree.md), and [the compile pipeline](../docs/stg-compile.md).

The `osd-store.mjs`, `osd-data.mjs`, `osd-db.mjs`, and `osd-runtime.mjs` files provide object, data, database, and process commands. [Database backends](../docs/db-backends.md) covers the storage choices. `osd-tmp.mjs` (with `osd-store-tmp.mjs` for the store and `osd-tmp-view.mjs` for what a session sees) is `$TMP`, the local package every system has: the folder `local/tmp`, a build layer once something is created in it, objects with their author, and never part of a deploy zip (`test/tmp-package.mjs`, measured on A4H in `test/fixtures/tmp-package/a4h.json`).

The `osd-suites.mjs`, `osd-leak-scan.mjs`, and `osd-naming-scan.mjs` files run integration and publication checks. [CI tests](../docs/ci-tests.md) explains the suite split; `npm run where` rebuilds [the feature map](../docs/where-is.md) from repository inventories.

`gogen/` holds the Go backend and its own [README](gogen/README.md). `sqlscript/` holds SQLScript parsing and analysis tools; see [the SQLScript surface](../docs/sqlscript-surface.md).
