# B3: compatibility session calls in the serving child

B1/B2 already supplied the remote session adapter needed to avoid a parent
session authority. B3 extracts its child dispatch into
`tools/osd-adt-sessions-door.mjs`, behind `POST /osd/adt-sessions`.
`RemoteSessions` sends JSON operations and snapshots through that door; the
ABAP request door no longer accepts session-only envelopes.

Both doors share the switch, JSON-only parser and per-spawn key checked with
`timingSafeEqual`. The session door permits loopback callers only, is declared
in the node inventory, and is excluded from the parent's public proxy by its
`internal: true` flag (shared with `adt-step`). Its JSON body is limited to
1 MB; the ABAP step door retains 34 MB for hex-encoded request bodies.
Operations are explicitly listed with their argument counts.

The child's dialog FIFO encloses the authoritative session check and every
parent callback. `whileHeld` calls parent work through `OSD_SESSION_CALLBACK`;
`deleteObject` calls parent find/delete through the same IPC channel. A parent
failure rejects the child step. Process-channel disconnect rejects pending
callbacks; a child crash drops the old step and the parent request context.
An uncertain write is never retried. An already-started parent callback cannot
be undone by a child crash; this bridge does not make filesystem writes transactional.
The same window exists when the 120 s STORE IPC timer rolls back the child
step and frees its FIFO while parent work is still running. A timeout or failed
session step invalidates the parent callback context over IPC, refusing further
callbacks. Already-running work may still write; completion after invalidation
is logged as an uncertain write and its result is refused. There is an
unlogged gap between the child's 120 s timer firing and the parent receiving
`store-context-ended`: parent work that completes in that interval still sees
a valid context, so its late write is not logged.

No ADT route body, ABAP class or STORE command changes. The session call sites
in `adt-facade.mjs` and `adt-abap-front.mjs` are byte-unchanged from main
`cc6b0287`. The switch-off JS/inline selection stays unchanged. A3a/A4/A5
still own their HOST_ALLOWED entries: B3 moves no route to ABAP and has no
coverage block to delete. Their future ports will remove compatibility calls.

A3a now serves poll, session DELETE and logoff in ABAP. The compatibility
adapter and session door no longer forward raw `end`; the remote request door's
transitional HOST logoff block is removed. B3 race tests end sessions through
the ABAP logoff route, including while a parent delete callback holds the FIFO.
The session door rejects `end` even with its formerly valid argument count.
Remaining compatibility `RemoteSessions.end()` callers send `logoff` through
the session door. The child's FIFO calls `ZCL_OSD_ADT_LOGOFF=>END_SESSION`
with its own session provider, sharing the route's ABAP ID guard. Inheriting
the inline adapter's END would instead delete parent rows, leaving the child's
CSRF/RESUME session and ENQ locks alive, including across recycle. This bridge
does not resolve a replacement session or depend on a test route table.
The remaining B3 operations and internal doors stay in place for Node callers.

The A3a compatibility follow-up ran all 37 files of `test/suites.d/adt.json`
in one Mocha invocation in manifest order per mode: **1739 passing** with
`OSD_ADT_ONE_RUNTIME=1`, and **1739 passing** with the switch unset, zero
failures. The focused one-runtime/CSRF pair passed 63 tests, including the
added child-row/lock termination regression. A3a ABAP Unit passed all 10
methods; XML and WITH_UNIT_TESTS checks passed 6 tests. Lint passed with no
method_length or complexity warnings in either A3a class. All heavy runs used
`OSD_HEAVY_RANGE=90-99 tools/osd-heavy.sh`.

## Verification

All commands ran through `OSD_HEAVY_RANGE=80-89 tools/osd-heavy.sh`:

- Switch off: diff, coverage, XML, store-destination and xref-seed: 137 passed.
- Switch on: osd-routes, osd-adt-one-runtime, diff and coverage: 145 passed.
- B0 child carry: 3 passed (SQLite, DuckDB and file SQLite).
- B0 session/front focused checks: 7 passed.
- `npm run web:preview`: webpack compiled successfully, 4263 modules.

Ten new checks cover lock visibility in both directions (the ABAP LOCK
answers explicitly assert served-by ABAP), stale write snapshots, route PUT
and DELETE behind logoff, deletion holding the FIFO, callback failure,
recycle during a callback, public isolation, input validation and switch-off
doors. Existing wire parity compares Node and the front over one store.

Temporary mutations, restored before the final green run, proved the checks:

- Bypass `whileHeld` and call parent work directly: two assertions fail;
  the stale snapshot writes, and PUT answers 200 rather than 409.
- Bypass `deleteObject` and call parent delete directly: DELETE answers 200
  rather than 403 after logoff.
- Disable the child verdict's logoff END: #432's queued LOCK answers 200
  rather than 403.

B4 RESUME, B5 kernel deletion and pool-wide ENQ coordination remain outside
this slice. No new ABAP means no new ABAP Unit or lint targets; Go is unchanged.

## Round-1 review fixes

The requested focused command passed 81 tests, including the three B0 child
carry cases. The B0 session/front checks passed another 7 tests. Public
isolation now runs against the real parent port in `test/osd-child.mjs`;
removing the internal-node exclusion made both door checks fail (403 instead
of 404), and the exclusion was restored before the final green run. Deletion
ordering records `deleteDone` before `ended` without a sleep; round 2 adds
a positive queue-depth signal before releasing deletion. Dedicated checks
exercise the 1 MB session body limit and fire the IPC timeout directly to
verify context invalidation, refusal of further callbacks and late-work logging.


## Round-2 review fixes

The callback-crash test waits for the killed child's exit before calling
`ensure()`: rejection of the pending HTTP call can precede that exit. Every
test that reads the child URL obtains it after its own `ensure()`.

`/osd/serving` now reports the existing work-process status (`held`, `waiting`,
`heldMs`) without taking the FIFO. The delete callback test waits until logoff
has reached the child and queued behind deletion before releasing parent work,
then checks `deleteDone` before `ended`. Temporarily bypassing remote
`deleteObject` with direct parent deletion makes this test fail (0 passed,
1 failed: the queue condition never settles); the mutation was restored.

Ten consecutive runs of `test/osd-adt-one-runtime.mjs`, each through
`OSD_HEAVY_RANGE=80-89 tools/osd-heavy.sh npx mocha --exit`, passed:
**32, 32, 32, 32, 32, 32, 32, 32, 32, 32**, with zero failures.

The full targeted set (`osd-adt-one-runtime`, `osd-child`, `osd-routes`,
`store-destination`) passed **81 tests**, including the three B0 child carry
cases (SQLite, DuckDB and file SQLite). B0 session/front checks passed **7**;
carry IPC compatibility (`osd-adt-fork`) passed **3**. All ran through the
same heavy wrapper. Final process inspection found no `osd-serve.mjs` children
left from this clone.

## Tie-breaker follow-up

Graceful recycle now waits at most `grace + 8000 ms` for the parent's ADT
contexts to drain before sending quiesce. This lets an in-flight parent
callback finish and the child commit/snapshot its B0 carry. Stop bypasses
that wait and still wins over recycle. A callback exceeding the bounded
wait can still lose carry; uncertain writes are never replayed.

If parent deletion succeeds but the compatibility session step fails before
forgetting the handle, `RemoteSessions.deleteObject` attempts `release(type,
name)` in a fresh step, preserving the original error even if cleanup fails.
This is best-effort cleanup, not a transactional filesystem delete.

Known limit for B6/follow-up (P3-2): a hold near the STORE IPC 120 s ceiling
can outlast the supervisor's 30 s wait for `hot-done` in `ServingRuntime.hot`.
The parent rejects the warm swap and removes its message listener, but the
child's queued hot swap can still execute after the hold releases. The child
can then carry the new generation while the parent still reports the old
one. This slice documents the limit; it does not change hot-swap cancellation
or generation reconciliation.

The regressions were run against the unchanged implementation first:

A held callback released after both quiesce grace periods failed its session
call (`fetch failed`, 0 passed / 1 failed), proving recycle lost the in-flight
step and its carry. The post-delete IPC serialization failure retained its
handle (1 passed / 1 failed in the initial two-case run). After the fixes,
both cases passed, including `holderOf` on the replacement child and exactly
one parent write. A third regression checks stop overtaking the drain.

Five consecutive runs of `test/osd-adt-one-runtime.mjs` through the heavy
wrapper passed **35, 35, 35, 35, 35**, with zero failures.

The full targeted run passed **160 tests**, with zero failures, through the
same heavy wrapper: `osd-adt-one-runtime`, `osd-child`, `osd-routes`,
`store-destination`, `osd-runtime`, `osd-adt-fork`, `adt-abap-session`, and
`adt-abap-front`. This includes B0 carry on SQLite, DuckDB and file SQLite,
plus the B0 session/front and carry IPC checks. Final `ps` inspection found
**0** leftover `osd-serve.mjs` processes from this clone; no PID needed killing.
