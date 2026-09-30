# Go ABAP runtime

`data.go`, `tables.go`, `move.go`, and the arithmetic and string helpers implement values and ABAP operations emitted by the Go backend. [gogen's README](../../README.md) describes the source-to-IR-to-Go pipeline and supported subset.

`db.go`, `dbstore.go`, `dbwrite.go`, `dbraw.go`, `irsql.go`, and `osqlwhere.go` handle storage and Open SQL execution. The `db_*.go` files select database implementations by build context; see [database backends](../../../../docs/db-backends.md) and [dynamic WHERE](../../../../docs/osql-where.md).

`icf.go`, `icf_db.go`, `frontend.go`, `apc.go`, and `unitdump.go` support requests, channels, and test reporting. Their adjacent `*_test.go` files exercise runtime semantics; [conformance](../../../../docs/conformance.md) covers the HTTP contract.

`dataset.go`, `codepage.go`, and related conversion helpers support file and text operations. See [dataset behavior](../../../../docs/dataset.md).

This package is selected through `go.mod` in its parent directory; [the feature map](../../../../docs/where-is.md) links it to the corresponding JS and ABAP paths.
