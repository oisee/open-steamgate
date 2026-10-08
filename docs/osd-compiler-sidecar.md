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

Light verification:

```sh
node node_modules/mocha/bin/mocha.js test/osd-compiler-sidecar.mjs
```

## Go client (round 1)

`tools/gogen/go/compiler` provides a lazy client with one child per Client and
serialized requests. Discovery tries `OSGO_SIDECAR`, then `osd` beside the osgo
executable, and never searches PATH. `BuildSnapshot` hashes raw files relative
to the root and refuses lexical or symlink escapes. `Check` returns diagnostics
and the registry identity, or a typed refusal preserving the protocol code.
The default check deadline is 30 seconds and can be configured. A timeout or
crash stops the process group; the next request restarts after backoff.

`osgo -compiler-status [-root <tree>]` performs hello and prints JSON containing
discovery, versions, contract, capabilities, limits, restarts and the last error.
It exits successfully even when the sidecar is absent (`found:false`).
`Status()` itself only reads state; `Hello` starts the child. Call `Close` when
the client is no longer needed. No ADT or serving path uses this client yet.
Round 2 will connect ZOSD_STORE CHECK on osgo through the client after PR #653
merges.

The Go unit tests re-execute their own test binary as a fake sidecar and need
no Node. The gogen suite registers `test/osgo-compiler.mjs`, which drives the
real Node CLI through the Go client on a single-class fixture. It checks a
clean verdict, syntax coordinates and a false snapshot hash.
