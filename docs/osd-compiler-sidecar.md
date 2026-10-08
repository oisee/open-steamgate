# Compiler sidecar (skeleton)

`osd compiler --stdio` implements the compiler-provider
[contract v1](../../../adt-osgo/SIDECAR-contract.md). In a source checkout,
`node tools/osd-compiler-sidecar.mjs --stdio` runs the same module. Child
launchers use `compilerCommand()` from `tools/osd-host.mjs` so a packaged host
starts its own compiler mode.

Requests and responses are NDJSON, one response per line with the request's
`id`. Stdout contains only protocol responses; tool logs go to stderr.
Malformed lines receive `BAD_REQUEST` and processing continues (a line with
no recoverable id has no response id). EOF closes the process successfully.

`hello` requires `contract: 1` and returns `contract`, `osd` (the local
`osd-version.json` version, otherwise `source`), `transpiler` (the commit pin
in the bundled `libs.lock.json`), `capabilities: ["check"]`, and `limits`:
`maxSnapshotBytes: 16777216`, `maxConcurrentRequests: 1`. Requests are serial.

`check` requires the contract's snapshot root, generation, objects, versions,
and relative file paths with SHA-256 digests. Missing or changed files return
`SNAPSHOT_MISMATCH`. The generation is carried as caller metadata; this slice
verifies identity by file hashes. Checks use the store's existing ACTIVATE
validation, including publication rules, active dependency overlays and the
transitive reader closure. They check the verified bytes and recheck hashes
before returning. The registry is built on demand; no transpile, publication,
serving database or ABAP execution is involved.

Results contain `diagnostics` with severity, `ABAP_SYNTAX` code, text, object
identity, include path, and A4H coordinates: lines start at 1, columns at 0,
and the end points to the last character. All other operations receive
`UNSUPPORTED_OP`; future capabilities remain unimplemented.

Light verification:

```sh
node node_modules/mocha/bin/mocha.js test/osd-compiler-sidecar.mjs
```
