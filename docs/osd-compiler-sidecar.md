# Compiler sidecar

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
in the bundled `libs.lock.json`), `capabilities: ["check", "outline"]`, and `limits`:
`maxSnapshotBytes: 16777216`, `maxConcurrentRequests: 1`. Requests are serial.

`check` requires the contract's snapshot root, generation, objects, versions,
and relative file paths with SHA-256 digests. The snapshot pins the objects
osgo names; missing or changed snapshot files return `SNAPSHOT_MISMATCH`.
Listed snapshot paths are contained by `realpath`; a file or directory
symlink that resolves outside the snapshot root returns `BAD_REQUEST`.

Contract statement: the verdict is computed from exactly the registry identified
by `registryHash` (+ `configSha`); every on-disk member is re-verified before
the answer. `snapshot` pins the named objects by SHA-256 and realpath containment
and is also reverified before answering.

After applying the inactive overlay, `registryHash` is SHA-256 of the JSON
encoded sorted list of `[filename, sha256(raw)]` for every registry file:
sources, includes, `gen/`, resolved libraries (including `OSD_LIB_*` overrides)
and active copies of inactive dependencies. Filenames sort by code unit order.
`configSha` hashes the raw abaplint config file used to build that registry.
Successful answers carry both 64-character hashes, `inputCount` (all registry
members), and `virtualFiles` (filenames without disk backing, empty when none).
Before answering, each on-disk member is read from its resolved real path and
compared with the registry raw by SHA-256, and the config is re-hashed. A changed
or vanished input returns `SNAPSHOT_MISMATCH` with `inputs moved during check`.
This identifies the actual validation view, rather than claiming that the
builder's generation hash covers all check inputs.

generation = transpile output, keyed by abap_transpile.json + sources + transpiler;
lint config is not an input of the output, but is an input of every check verdict,
so verdict caches key on its sha.

Checks use the store's existing ACTIVATE validation, including publication
rules, active dependency overlays and the transitive reader closure. The
registry is built on demand; no transpile, publication, serving database or
ABAP execution is involved.

Results contain `diagnostics` with severity, `ABAP_SYNTAX` code, text, object
identity, include path, and A4H coordinates: lines start at 1, columns at 0,
and the end points to the last character. All other operations receive
`UNSUPPORTED_OP`; future capabilities remain unimplemented.

| op | request | response |
|---|---|---|
| `hello` | `contract: 1` | versions, capabilities, limits |
| `check` | snapshot | diagnostics, registryHash, configSha, inputCount, virtualFiles |
| `outline` | snapshot (one object), object `{type, name, version}` | outline, registryHash, inputCount, virtualFiles |

`outline` returns exactly the JSON produced by STORE `PARSE` kind `OUTLINE`,
under `outline`, including `{found:false}` for an unknown object. It calls the
same handler and `structureOf` over a store view of a fresh snapshot-only
abaplint registry. Both active and inactive requests read the files the snapshot
names; the object identity and version must match the snapshot object. Active
copies and the working tree outside that snapshot cannot supply coordinates.
The same hash checks, realpath containment and final snapshot verification as
`check` apply.

For outline, `registryHash` uses the same sorted `[filename, sha256(raw)]`
encoding as check, but covers only the supplied parser files; `inputCount`
counts them and `virtualFiles` is empty. There is no `configSha`: outline
parses structure with the parser defaults and does not read lint configuration
or validate dependencies. This identity describes the actual outline inputs
without claiming the validation registry or the generation covers them.

Example NDJSON request (replace the digest with SHA-256 of the named file):

```json
{"id":2,"op":"outline","snapshot":{"root":"/tmp/outline-system","generation":"fixture","objects":[{"type":"CLAS","name":"ZCL_EXAMPLE","version":"inactive","files":[{"path":"src/zcl_example.clas.abap","sha256":"<64 lowercase hex characters>"}]}]},"object":{"type":"CLAS","name":"ZCL_EXAMPLE","version":"inactive"}}
```

The answer is `{"id":2,"outline":{"found":true,...},"registryHash":"...",
"inputCount":1,"virtualFiles":[]}`. Links use the existing A4H coordinates:
lines start at 1, columns at 0, and ends point to the last character.

Light verification:

```sh
OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 tools/osd-heavy.sh node node_modules/mocha/bin/mocha.js --require tools/osd-test-isolation.cjs test/osd-compiler-sidecar.mjs
```
