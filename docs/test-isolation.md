# Isolation in shared Mocha runs

`tools/osd-suites.mjs` always requires `tools/osd-test-isolation.cjs`.
For a hand run:

```sh
OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 tools/osd-heavy.sh npm run transpile
OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 tools/osd-heavy.sh \
  npx mocha --require ./tools/osd-test-isolation.cjs test/adt-devloop.mjs
```

Serial Mocha root `afterAll` runs once for the entire run. This setup uses
Mocha's pre/post-require file events to place every file's suites, root tests
and file hooks into a file suite. Its final hook checks after the file's own
`after` hooks, including when a file hook throws. Pending suites are checked
as well. Files with no selected tests receive a final root audit of their
import-time state, without invoking their unexecuted cleanup hooks. Parallel Mocha is refused; the suite runner uses serial Mocha inside
each independent shard process. A file boundary adds its path to title paths.

The checks never kill children, remove directories, reset environment variables,
release a lock, rebuild code or switch generations:

- **dialog:** the FIFO work-process lock is free, the queue is empty and no
  execution remains open, including executions suspended in `WAIT`.
  Owner: `osd-dialog-step.mjs`, `dialogStateSnapshot()`. The detector installs
  an observer slot and owns the open-token Set. Without the detector a step
  performs one null check, with no Set allocation or add/delete operations.
- **generation:** `build/live` names the current working tree hash, computed
  by the builder's own hash function, including libraries and generators.
  Trees with no live generation have nothing to compare. Owner:
  `osd-build.mjs`, `generationStateSnapshot()`.
- **gen:** generated outputs under checkout `gen/` keep the same sorted
  manifest of relative paths, sizes and `mtimeMs`. Owner:
  `osd-test-resources.cjs`, `genManifest()` / `genDifference()`. Snapshots
  read directory entries and metadata only. When entries differ, evidence
  names each added, removed or changed path and hashes only differing files
  still present (SHA-256). Removed files retain their baseline metadata;
  their deleted bytes cannot be hashed without reading contents up front.
  A metadata change counts as a change even if rewritten bytes are identical.
  This detects sweeps that the generation hash cannot see: `gen/` is an
  output and excluded from that hash. It does not validate pre-existing
  output against a build manifest or assign a stale run start to a file.
- **children:** no serving child or asynchronous spawned process remains
  alive. Owner: `osd-runtime.mjs`, `servingStateSnapshot()`, and
  `osd-test-resources.cjs`, `resourceStateSnapshot(file)`.
- **temporary-roots:** roots created through temporary-directory helpers,
  during registration or execution, no longer exist. Owner:
  `osd-test-resources.cjs`, `resourceStateSnapshot(file)`.
- **environment:** added, changed and deleted environment keys are restored
  to their values before the file. Keys changed anywhere in the import sequence
  are reconciled against the original process environment, so later imports
  cannot adopt an earlier import's contaminated baseline. A final run-wide check
  also compares with the original environment. Owner: `osd-test-resources.cjs`,
  `environmentSnapshot()`. Values are redacted in diagnostics; key names,
  presence and changes remain visible.

The resource observer wraps Node's spawn/fork/exec/execFile and synchronous,
callback and promise mkdtemp helpers before suite imports, and synchronizes
builtin ESM exports. The original calls and results are preserved. This also
covers repository helpers built on those functions. Exit events retire child
records; removed directories disappear from snapshots. Temporary roots use
absolute paths resolved against the cwd at helper invocation, including callback
and promise completion after a cwd change. This does not enumerate
arbitrary directories, grandchildren, or processes started by native extensions.
A run terminated during import or with `process.exit()` cannot finish checks.

## Intentional generation changes

Prefer a file-level `after` hook that restores sources **and** the generation.
Restoring source bytes alone can leave a generation built from the edited tree.
For a test that intentionally ends with inactive source or a stale generation,
register a reason during that file's execution:

```js
import isolation from '../tools/osd-test-isolation.cjs';
after(() => {
  isolation.allowGenerationMismatch('Exercises an inactive save; no activation is intended');
});
```

This affects only the generation invariant for that file. It expires at the
file boundary, prints the reason, and performs no restoration. Load the setup
with `--require` before importing it in a test.

## Reading a failure

`test-isolation: test/example.mjs: generation: {"before":...,"after":...}`
names the file and invariant. Generation evidence includes live and tree hashes
at entry and exit; dialog
evidence includes queued/open work; resources include PIDs/commands or root
paths; environment evidence names the changed keys. An unchanged inherited generation drift is reported only at its originating
boundary. The detector re-baselines its observation state for the next file;
a new live link, missing generation, hash error or additional tree drift remains red.
The detector does not re-baseline the filesystem.
The `gen` check compares both import entry/exit and execution entry/exit
(after user cleanup). Import-time generator calls therefore belong to the
file importing them, including files with no selected tests. Each file gets
its own observation baseline; a downstream file that leaves already missing
outputs alone passes. Directory symlinks are not traversed; changed symlinks
are hashed by link target. Empty directories and edits that restore both
size and timestamp between snapshots are outside this metadata manifest.
If the first file has identical entry and exit hashes but `live` differs from
`tree`, the run began with a stale generation. An external build before the run
restores that baseline; identical snapshots alone do not establish an exemption.
The runner cannot recover an isolation failure through an isolated retry.

`tools/osd-test-isolation-allow.json` contains only originating exceptions.
Each invariant entry requires `reason`, `owner` and a `backlog` item link;
malformed entries fail at load time. Root exceptions enumerate basename prefixes
and maximum surviving counts. A different prefix or an excess count remains red.
Generation exceptions describe the originating input changes and maximum count.
`gen` exceptions use a nonempty `files` array of `{path, maxCount: 1}` or
`{prefix, maxCount}` identities rooted under `gen/`. Prefixes end in `/`
and must name a narrower directory than `gen/` itself. Every changed path
must match an identity and every identity's count must stay within its bound;
overlapping identities cannot multiply a bound. Counts cover unique paths
across import and execution. Evidence is still printed in full. The
`allowGenerationMismatch()` API cannot waive this separate invariant.
For added trace sidecars the detector proves that excluding exactly those new
paths returns the baseline hash. For restored activation inputs the originating
fixture calls the already-loaded detector's `observeGenerationDrift()` while
edited inputs still exist; it verifies their identity/count, the hash they name,
and the restored tree hash. A warm runtime may use persisted active copies of
inactive objects. The detector reads their existing metadata and bytes, proves
that view did not change during the known edit, and checks the builder's hash
with that overlay. It never constructs a store or invokes its recovery path.
The view fingerprint also participates in downstream comparisons. This observer
is absent in plain Mocha runs. A later live or active-copy change cannot reuse
that proof. Snapshot errors and generation deletion
have no exception.

Exceptions still print full evidence, ownership, backlog and `TEMPORARY ALLOW`;
they never perform cleanup. There are no environment exceptions. Remove each
entry when its [fixture repair](backlog/misc.md#test-isolation-fixture-repairs)
is complete. See the [run report](test-isolation-runs.md).

Each checked file prints total baseline and final snapshot time in milliseconds;
this includes detector proof captures and excludes test work and user cleanup.
The run also prints `gen` manifest boundary count, initial file count, median
milliseconds per boundary, comparison/hash time and total added observation
time. This total includes import observations as well as execution snapshots;
normally there are four manifests per selected file.
