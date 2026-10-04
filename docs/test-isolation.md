# Isolation in shared Mocha runs

`tools/osd-suites.mjs` always requires `tools/osd-test-isolation.cjs`.
For a hand run:

```sh
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
  Owner: `osd-dialog-step.mjs`, `dialogStateSnapshot()`.
- **generation:** `build/live` names the current working tree hash, computed
  by the builder's own hash function, including libraries and generators.
  Trees with no live generation have nothing to compare. Owner:
  `osd-build.mjs`, `generationStateSnapshot()`.
- **children:** no serving child or asynchronous spawned process remains
  alive. Owner: `osd-runtime.mjs`, `servingStateSnapshot()`, and
  `osd-test-resources.cjs`, `resourceStateSnapshot(file)`.
- **temporary-roots:** roots created through temporary-directory helpers,
  during registration or execution, no longer exist. Owner:
  `osd-test-resources.cjs`, `resourceStateSnapshot(file)`.
- **environment:** added, changed and deleted environment keys are restored
  to their values before the file. Import-time changes are checked against
  the pre-import snapshot. Owner: `osd-test-resources.cjs`,
  `environmentSnapshot()`. Values are redacted in diagnostics; key names,
  presence and changes remain visible.

The resource observer wraps Node's spawn/fork/exec/execFile and synchronous,
callback and promise mkdtemp helpers before suite imports, and synchronizes
builtin ESM exports. The original calls and results are preserved. This also
covers repository helpers built on those functions. Exit events retire child
records; removed directories disappear from snapshots. This does not enumerate
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
names the file and invariant. Generation final evidence includes both hashes (the baseline reads only the live
link to avoid hashing twice); dialog
evidence includes queued/open work; resources include PIDs/commands or root
paths; environment evidence names the changed keys. A baseline already dirty
means contamination arrived from an earlier file; retain the earlier evidence.
The runner cannot recover an isolation failure through an isolated retry.

`tools/osd-test-isolation-allow.json` is the explicit temporary allow-list. Each entry is
a file path mapping an invariant to a nonempty reason. Environment exceptions
map individual key names to reasons instead of allowing the entire environment. Exceptions still print
the complete evidence and `TEMPORARY ALLOW`; they never perform cleanup. The
initial environment allow-list is empty. Add only measured, explained exceptions
and remove them when their owner is fixed. See the [run report](test-isolation-runs.md).

Each checked file prints total baseline and final snapshot time in milliseconds;
this excludes tests and user cleanup hooks.
