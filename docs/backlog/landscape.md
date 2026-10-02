# Track SL — a system landscape: several systems side by side, and one set split across two (2026-10-02)

Alice, 2026-10-02: the next super-milestone after the L3 governor. A rule set that today runs in one
system is generated as **two parts in two systems**: one system runs the heavy checks, and the
other turns hits into alerts, runs the auto-close rules and owns the final manual-handling budget
(the glass of [the governor](../dsl-l3.md)). The cut can go through different places, and through
more than RFC. OSG gains from it directly, because proving this takes several systems running side
by side that can see each other.

Labels follow the release practice: **must** gates the milestone, **should** is expected with it,
**nice** is welcome.

## What already exists (read off `main`, not assumed)

- **Identity per process.** `tools/osd-identity.mjs` sets `sy-sysid`, `sy-mandt` and `sy-uname` from
  `OSD_SID`, `OSD_CLIENT` and `OSD_USER` at boot, in every host (node, the binary, the service
  worker). The status table, the ADT façade and the screens read the same identity. Two processes
  with two values are already two different systems to the ABAP inside them.
- **Destinations.** `.local/rfc-destinations.json` (example: `docs/rfc-destinations.example.json`)
  gives each `DESTINATION` name a kind: `local`, `live` (open-rfc to a real system), `record`,
  `replay` or `fallback`. There is no kind that means "another OSG".
- **A JSON RFC channel.** `/sap/bc/osd/rfc/` (`docs/rfc-channel.md`) calls any remote-enabled
  module of the tree. It can be the far end of such a kind.
- **OData across systems.** `tools/osd-remote-service.mjs` answers a service the registry lacks
  from a destination on this origin, with the CSRF token and its session cookie. The in-process
  `zcl_stg_odata_client` (`service:`+`set:` sources) is the same consumer in ABAP.
- **Containers.** `docker/compose.yml` (profiles sqlite, hana) brings up **one** OSG.
- **Renaming by prefix.** `tools/osd-rename.mjs` renames whole identifiers, the contents and the
  file names of a set of objects. It is a deploy-time tool, not a generator option.

## Decided 2026-10-02: one system first, with a real seam

Alice: colleagues may lay the foundation for real cross-system calls, but the set stays **inside one
system** for now. It still crosses a **real seam**: `CALL FUNCTION ... DESTINATION`, to a set of
remote-enabled function modules with a typed contract.

- **The contract.** The DSL generates the cut as a function group of remote-enabled modules
  (`<REMOTE_CALL>R</REMOTE_CALL>`) with DDIC-typed parameters only (no generic types, no references:
  what RFC can carry), plus a structure and table type per payload. The two sides of the cut call
  each other only through these modules.
- **One system today.** The destination is a setting of the set (5b), by default `NONE`, so the
  call runs locally in its own LUW the way RFC does. Moving one side to another system means
  changing the destination, not the code.
- **Proof that it is a real seam.** On A4H, the same set runs through `NONE` and through an SM59
  destination that points back at the same system (another client or a loopback logon). The
  results are equal, and a test fails if a side reads the other's tables directly.
- **Foundation for later, by the colleagues:** SL.1, SL.2 and SL.3 below. The DSL needs only the
  `NONE` route and a typed signature from them, so it does not wait.

**Already in OSG and what it lacks.**
- `CALL FUNCTION ... DESTINATION d` is `abap.context.RFCDestinations[d].call(name, params)`.
- Host bridges live in the same map under destination names: `AMDP`, `JOBS`, `STORE`,
  `SQLTRACE`. They are in-process only and occupy names an SM59 entry could want. SL.2 separates
  them (reserved names or a map of their own).
- `NONE` must be registered as local (an AGENDA gotcha from 2026-09-12).
- The JSON channel `/sap/bc/osd/rfc/` has no authentication.
- `IN BACKGROUND TASK` and `STARTING NEW TASK` with a destination are not handled yet. Check the
  transpiler before SL.2's exactly-once variant.

## SL.0 — a real connection to itself, before any network (must)

Alice, 2026-10-02: OSG needs a destination to **itself** that is not `NONE` and behaves like a real
one. It is the intermediate step to a network destination: only the target changes after it.

On a system, an SM59 type 3 entry pointing at its own system is exactly that. The call goes out
and comes back into **another work process**, under a fresh logon, with its own session and LUW.
OSG already has the parts: the work-process pool (`tools/osd-pool.mjs`, `OSD_WORKERS`, children on
one SQLite file in WAL mode) and the JSON RFC channel with its generated, typed dispatcher.

A kind `loopback` (or `osd` with the target `self`) calls a **different work process of the same
system** over the RFC channel. What makes it real, each point with a test that fails under `NONE`:

1. **Another internal session.** Static attributes, `EXPORT TO MEMORY`, buffers and singletons of the
   caller are not visible on the other side. ABAP that relied on shared global state breaks here,
   as it would on a system.
2. **Its own connection and LUW.** A `COMMIT WORK` on the far side does not commit the caller's
   pending rows, and a caller's `ROLLBACK WORK` does not undo what the far side committed. The
   session stays alive across calls on the same destination until `RFC_CONNECTION_CLOSE` or the
   end of the caller's step, so `BAPI_TRANSACTION_COMMIT` works.
3. **By value, RFC types only.** Parameters are serialised through the channel. A reference, an
   object or a generic type is refused at compile time where possible, otherwise at the call. A
   module without `REMOTE_CALL = R` raises the call's exception (the channel already answers 403).
4. **The destination's logon.** User and client come from the destination: the far side's
   `sy-uname` and `sy-mandt` are the logon's, not the caller's. A loopback into **another client**
   is the cheapest two-"system" test there is.
5. **Failures like RFC.**
   - A dump on the far side is `SYSTEM_FAILURE` with its text.
   - No free work process, a timeout or a refused logon is `COMMUNICATION_FAILURE`.
   - Classic exceptions of the module pass through by name.
6. **The same wire as the network.** Loopback is the HTTP JSON call to the pool's other process, so
   a destination to another OSG later changes the address and adds authentication, and nothing
   else.

**The constraint to measure first: SQLite has one writer.** Suppose the caller holds uncommitted
writes and the far side wants to write too:
- on HANA or PostgreSQL this works for different rows, as on a system;
- on SQLite the far side waits for the caller, which waits for the far side.

The loopback detects this through the busy timeout and answers `SYSTEM_FAILURE` ("lock wait:
SQLite allows one writer"), recorded in ANORMALIES. It must not hang.
- For the DSL cut this is mostly moot. A write across the cut goes **after** the commit
  (`IN BACKGROUND TASK`, SL.2's exactly-once variant), and a synchronous call stays read-only or
  goes to the far side's own ledger before the caller writes.
- Full fidelity is the PostgreSQL or HANA profile.

**With a single work process** (`OSD_WORKERS=1`) the loopback answers `COMMUNICATION_FAILURE` ("no
free work process"). That is also what a system with no free dialog work process does after its
wait, so the test is honest rather than a special case.

**A4H twin.** The same set, proved through an SM59 type 3 entry to the sandbox itself, gives the
oracle for every point above.

## SL.1 — consistent identity per instance (must)

- **The client is part of the data.** The seed rows in `data/` are in client 123. An instance
  started with `OSD_CLIENT=200` must seed into 200 and read from 200. The A4H deploy already
  learned this ("a seed row for another client is rewritten into the logon client"). Today the
  local seed path does not do it.
- **One source.** SID, client, user and the ADT pair (which deliberately stays fixed, see
  `osd-identity.mjs`) come from one place per instance. Nothing derives them twice.
- **Test.** Two instances, `OSD_SID=HVY OSD_CLIENT=100` and `OSD_SID=ALR OSD_CLIENT=200`, on one
  database file each. Each answers its own `sy-sysid` and `sy-mandt` and sees only its own rows.
- Open: two clients of **one** database (MANDT is a key column everywhere) as a cheaper second
  shape. That is how a real system hosts two "systems", and it tests implicit-MANDT handling.

## SL.2 — an SM59 of our own (must)

- **Destinations as a table, not a gitignored JSON file.** An RFCDES-shaped `ZOSD_DEST`: name,
  kind, target, client, user, and a reference to a credential that never sits in the row. The JSON
  file stays as an overlay for what must not be stored (live logons). An Easy Access entry and an
  OData service list and test the destinations, like SM59's connection test.
- **A new kind `osd`:** another OSG over its JSON RFC channel. `CALL FUNCTION ... DESTINATION 'ALR'`
  from instance HVY runs in instance ALR, with ALR's identity, LUW and database.
- **An HTTP kind (the G type)** for OData and plain REST to another instance or to a real system.
  `osd-remote-service` and `zcl_stg_odata_client` already speak it, and they would take the
  destination from the table instead of from configuration.
- **Exactly once.** A tRFC/qRFC-shaped variant: a call carries a transaction id, the receiver
  records it and answers a repeat without running it again. This is what lets a cut survive a
  dropped link (see SL.4).

## SL.3 — a landscape in docker compose (should)

- **One `landscape.yaml`, many systems.** Each entry has a name, SID, client, port, database and
  packs. A generator writes the compose file (one service per system, one image) **and** each
  system's destinations to the others, so the two cannot disagree. The `--profile` approach stays
  for one-system shapes.
- **Health by content**, as the single-system compose already does (`system.serving` is a string),
  for every system. The landscape is up only when every system is.
- Nice: Portainer or a landscape page that lists the systems, their identity and their
  destinations, with the connection test.

## SL.4 — the DSL: a set in two systems (must)

- **The cut is a port.** L3 already reads and writes only through ports (#401). A cut is a port
  whose variant crosses a system boundary: the heavy system's `alerts` sink is bound to a remote
  variant, and the alerting system has the matching source. The set is generated once and emits
  two deliverables, one per side, each with its own package (SL.5).
- **Where the cut can go.** The DSL names the cut, not the transport. Candidates:
  - **after the hits:** the heavy side sends hits, and the alerting side groups them into alerts,
    auto-closes and counts the budget. The heavy side knows nothing about the budget.
  - **after the alerts:** the heavy side groups, and the alerting side only auto-closes and owns
    the budget.
  - **the budget only:** both stay as they are, and the reservation (governor, 5c-1) is a remote
    call to whoever owns the glass.
- **Transports for a cut** (a binding, as port variants already are):
  - synchronous RFC per pile;
  - tRFC/qRFC (SL.2, exactly once, in order per queue);
  - OData `$batch` to a generated service on the other side;
  - an outbox table the other side pulls (no inbound connection at all into the heavy system,
    which is often the only shape an operations team allows).
- **The budget across a cut.** A remote reservation per pile costs a round trip and stops the run
  when the link drops. The alternative is a **lease**: the owner grants the heavy side a slice of
  the glass, the heavy side reserves against it locally (the same conditional UPDATE), asks for
  more near the end of the slice and returns what it did not use. No overshoot is still a
  property of the owner's ledger, and the governor's states (NARROW, GLASS) map onto "the lease
  is running out" and "no more lease".
- **Idempotent keys.** The alert key (set, rule, model hash, check date, pile, seq) already makes a
  resend harmless, and SL.2's transaction id covers the transports that are not table-keyed.
- **Trace across systems.** `explain` follows an alert to the heavy system's pile and rule through
  the key. The trace sidecars of both deliverables name the same set line.

## SL.5 — names: prefix and package at generation (must)

Asked by Alice, 2026-10-02: can generation take a prefix (the package the objects go into) so that
every object is in that namespace?

- **Today: partly.**
  - `class:` and `report:` in a set rename the runner and its report.
  - The ports, the exception, the settings class and its report derive their names from the set
    (`zcl_l3_<set>_*`).
  - The shared tables (`ZOSD_L3_*`) are fixed names.
  - `osd-rename.mjs` renames a whole finished set by prefix at deploy time. That is how the A4H
    attempts get their own names, but it is not part of generation and the trace does not know
    about it.
- **To do.** A set (and a landscape side) takes `namespace:` (a `Z…_` prefix or a `/NS/`
  namespace) and `package:`. Every generated name derives from them, the shared tables included:
  a namespaced installation owns its own copies, so two installations in one system never share
  a run lock. The length rules (30 for a class, 16 for a table, 40 for a program) are checked at
  compile time, and the trace records the mapping.
- **Two sides, two packages.** SL.4's two deliverables go into two packages. A deploy manifest
  unit per side means `segw:zip` and prove-on-system work on each side unchanged.

## SL.6 — the proof (must)

1. Two OSG instances in compose (SL.3): a set split after the hits, a run in mode P on the heavy
   side, alerts and auto-close on the other, the glass owned by the other. A dropped link in the
   middle of a run ends with no overshoot and no lost or duplicated alert.
2. OSG as the heavy side, A4H as the alerting side, over a live destination.
3. Both sides on A4H in two packages: the deliverables of SL.5 through prove-on-system, one unit
   each.

## Order

SL.0 (loopback) with SL.5 (names) and SL.1 (identity) first: they are small and everything else stands on them. Then
SL.2 (`osd` kind plus the exactly-once variant), SL.4 with the outbox and synchronous transports,
SL.3, then the lease and the other cuts.
