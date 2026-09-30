# Go backend packages

`abap/` implements ABAP values, tables, Open SQL, database operations, and HTTP-facing runtime support; its [README](abap/README.md) maps the files. The generator pipeline and measured scope are in [gogen's README](../README.md).

`amc/` and `apc/` implement messaging and push-channel support used by the Go host. `termgui/` contains terminal UI code for OSABAP; see [native ABAP reports](../../../docs/osabap-native.md).

`cmd/` contains command entry points, including `osgo/`, `osabap/`, and benchmark or probe commands. `go.mod` defines the module; [conformance](../../../docs/conformance.md) describes the HTTP checks used across hosts.

Go package tests sit beside their implementations as `*_test.go` files. The generated code and parity workflow are described in [gogen's README](../README.md).

The feature map links this directory from the [Go generator and runtime](../../../docs/where-is.md) feature.
