# B3: compatibility session calls in the serving child

B1/B2 already supplied the remote session adapter needed to avoid a parent
session authority. B3 extracts its child dispatch into
`tools/osd-adt-sessions-door.mjs`, behind `POST /osd/adt-sessions`.
`RemoteSessions` sends JSON operations and snapshots through that door; the
ABAP request door no longer accepts session-only envelopes.

Both doors share the switch, JSON-only parser and per-spawn key checked with
`timingSafeEqual`. The session door permits loopback callers only, is declared
in the node inventory, and is excluded from the parent's public proxy.
Operations are explicitly listed with their argument counts.

The child's dialog FIFO encloses the authoritative session check and every
parent callback. `whileHeld` calls parent work through `OSD_SESSION_CALLBACK`;
`deleteObject` calls parent find/delete through the same IPC channel. A parent
failure rejects the child step. Process-channel disconnect rejects pending
callbacks; a child crash drops the old step and the parent request context.
An uncertain write is never retried. An already-started parent callback cannot
be undone by a child crash; this bridge does not make filesystem writes transactional.

No ADT route body, ABAP class or STORE command changes. The session call sites
in `adt-facade.mjs` and `adt-abap-front.mjs` are byte-unchanged from main
`cc6b0287`. The switch-off JS/inline selection stays unchanged. A3a/A4/A5
still own their HOST_ALLOWED entries: B3 moves no route to ABAP and has no
coverage block to delete. Their future ports will remove compatibility calls.

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
