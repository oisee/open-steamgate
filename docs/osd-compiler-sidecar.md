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

Contract statement: `snapshot` is the objects osgo names, pinned by SHA-256
and containment. `inputsHash` is the generation input hash of everything the
check could read, frozen by re-hashing before the answer. The sidecar uses
`inputsOf` / `hashOf` from `tools/osd-build.mjs`, the builder's generation
identity machinery covering source trees, packs, configured libraries,
configuration and ZIP layers. It computes the hash at the start of the check,
then rediscovers and re-hashes inputs just before answering. A changed hash
returns `SNAPSHOT_MISMATCH` with `inputs moved during check`; successful
answers carry the original `inputsHash` (the builder's 16 hex character hash).
Listed snapshot files are also reverified before answering. There is no
per-file read audit or `inputs` list.

The contract's completeness guarantee follows the existing builder input
identity. That identity hashes `abap_transpile.json`; it currently does not
hash `abaplint.jsonc`. Edits to that lint configuration therefore are not
frozen by `inputsHash` unless it is also a listed snapshot file.

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
