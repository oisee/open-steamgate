# B0: ADT state across a serving-child recycle

B0 prepares option B without moving the front. It ships OFF by default until
B1: set `OSD_ADT_ONE_RUNTIME=1` on the supervisor to opt in. Only then does
`ServingRuntime` set `OSD_ADT_CARRY=1` on its child. Other IPC parents boot
without a carry handshake. An opted-in child falls back to database rows
after 5 seconds without `adt-state`, announcing the timeout. Today the ADT front, sessions,
CSRF tokens and handles still live in the parent's in-memory ADT kernel.
The serving child owns a separate ENQ table. A child quiesce therefore carries
no authoritative front rows today; the parent supplies its current rows at
spawn. The child restores those rows and rebuilds its own locks before ready.
B1 can remove that parent snapshot hook when the front's step moves into the
child; the child-owned carry and rebuild need no replacement.

`test/start.mjs` attaches the snapshot provider to the primary runtime (also
when it is a pool). Other workers retain their own ENQ tables. B0 does not
synchronize live LOCK/UNLOCK/logoff between processes: a lock acquired after
boot is not yet in the child's table, and a mirrored lock released in the
parent remains in the child until its next recycle. B1 resolves that by
putting the front in the primary. B0 does not persist the parent's kernel
across a whole-host restart.

## Carry protocol

The process channel carries plain rows, never ENQ owner ids or serialized
lock-server internals:

- At boot the child installs its listener before loading modules and sends
  `adt-state-request`. The supervisor answers `adt-state` with optional
  `state` and `replace`.
- `state` is `{version: 1, zosd_adt_sess: [...], zosd_adt_shdl: [...]}`.
  Column names are lowercase; rows retain MANDT, stateful flag,
  timestamps and handles. Carry stays in supervisor memory, not a tracked
  file, environment variable or log. The parent blanks CSRF tokens until B1.
  Both snapshots include only handles whose actual ENQ holder matches the
  session owner key; the child reads its own lock table under the step lock.
- A parent-kernel provider is captured in the spawn caller's step context.
  Publication currently can wait for a recycle while holding that step;
  requesting a new exclusive parent step from child IPC would deadlock it.
  The temporary parent provider uses one SQLite UNION ALL statement for
  both tables without waiting for the work process. This also avoids a
  background recycle queuing behind a parent step that then joins the boot.
  The parent's SQLite select executes synchronously, giving one coherent
  view of its connection, including in-flight rows during publication.
  Those rows can later roll back in the parent: the child mirror then stays
  stale until recycle, like a mirrored lock after parent logoff. This
  unlocked provider is only for the current in-memory SQLite parent kernel;
  authoritative child-owned carry remains under the work-process lock.
  A parent snapshot uses `replace`, including deletions, so old mirrors
  are discarded. B1 removes this temporary provider.
- A clean quiesce stops accepting requests, waits for the work process,
  commits, snapshots both tables while the connection is open and sends
  `adt-carry`. The child waits for the IPC send callback before disconnecting
  a file client or exiting an export-at-exit client. The supervisor saves
  this snapshot for the next spawn. Snapshot/send failures are announced
  separately and still allow the committed file connection to disconnect.
- A child-owned carry is upserted in one dialog step after database setup
  (including schema recreation), before lock rebuilding and ready. The handle
  set of each carried session replaces its old set, preserving dead-handle
  deletions. Unknown carry versions are announced and dropped; only database
  rows are rebuilt in that case. The consumed carry is cleared at ready so a subsequent crash cannot replay
  an old clean snapshot and resurrect logged-off sessions.

A crash or quiesce that cannot finish within its grace has no new carry.
Only whatever the database file itself holds remains: file SQLite and
path-backed DuckDB retain committed rows; in-memory SQLite/DuckDB lose them;
sql.js with a path retains its last exported file. Schema drift after a crash
can still discard file SQLite's rows. Under today's kernel, the parent still
holds the authoritative front rows and supplies them again after a child
crash. Host shutdown loses the supervisor's carry.

## Rebuild

`ZCL_OSD_ADT_SESSION=>REHYDRATE`

```abap
IMPORTING iv_id TYPE string
          iv_bind_context TYPE abap_bool DEFAULT abap_true
RETURNING VALUE(rv_count) TYPE i
RAISING zcx_osd_adt
```

It reads the current client's stateful session and handles, binds the ENQ
session through `ZCL_OSD_ENQ_KERNEL=>BIND` (the host computes the new process's
`adt:<prefix>:<id>` key), then calls `ENQUEUE_EZOSD_ADT_OBJ` for each handle:
mode X, scope 1, both key fields specific. It leaves tokens and timestamps unchanged. An already-owned X lock (602) is accepted without adding
another lock count. A foreign lock (601) deletes the dead SHDL row and
continues; the returned count includes only recovered handles, and the host
reports the skipped count. Other rebuild
failures are announced and boot continues: the mirror must never block ready.
It deliberately avoids normal session BIND, whose missing-context cleanup
would delete the handles being restored.

The host scans sessions by `touched DESC` (newest wins), and runs one dialog
step per stateful session with handles. Native ICF
can pass `iv_bind_context = abap_false` to use its existing ENQ context rather
than the host-only binding bridge. osgo can use the default with its bridge.
Those two hosts were not executed in this slice.

## Measurements and proof

On this clone, actual ABAP rehydration over SQLite, after seeding (one run):
5 sessions / 20 handles: **2.68 ms**; 100 sessions / 1,000 handles:
**77.49 ms**. This includes ABAP reads, binding, FM calls and step commits,
unlike the research note's direct lock-server timings of 1.3 / 107 ms.
The table scan remains quadratic in the worst case. A cheap exact-key path
in `collide` removes the repeated code-point-array allocations; generic
keys retain position-wise collision and insertion precedence. An ENQ index
would also have to preserve generic/exact ordering and all release paths;
B0 does not bypass ENQUEUE by inserting internal lock rows.

`test/osd-child.mjs` checks both the current parent front and future child-owned
rows. It kills a child after an ADT LOCK and observes the rebuilt row through
a child classrun calling ENQUEUE_READ. It tests clean carry on pathless SQLite
and DuckDB, file-SQLite schema drift retaining the token and handle, and crash
recovery without replaying stale carry. The drift is forced by changing the
file's schema fingerprint after clean quiesce, exercising setup's recreation.
`adt-abap-session` also boots under a held parent step, both directly and
when that step joins a background boot, guarding the publication wait cycle.
`adt-abap-front` checks a dead handle stays 409 after filtered carry and
rebuild. The fork test covers an IPC parent that never answers `adt-state`;
the conflict test covers two persisted sessions claiming the same object.
Removing the child's boot rebuild makes ENQUEUE_READ show zero rows. The
session ABAP Unit covers idempotent rebuild and unchanged rows.
