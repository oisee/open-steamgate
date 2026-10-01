# The enqueue contract, as measured (ENQ E0)

What a lock server has to answer so that `ENQUEUE_<obj>`, `DEQUEUE_<obj>`,
`DEQUEUE_ALL` and `ENQUEUE_READ` behave as they do on a system. Measured on
2026-10-01 on the SAP sandbox (ABAP release 758), **as a client**: probe
function modules of our own called the generated lock modules and
`ENQUEUE_READ`, and reported what came back. No kernel code, no source of
SAP's lock modules and no SAP client library was read. Every probe object
was deleted afterwards.

The fixtures are `test/fixtures/enq/contract.json`: 61 cases, each a
sequence of steps with the owner of each call and `expect` = what the system
answered. The Go and Node lock servers of E1 are gated on them
(`docs/backlog/gogen-osgo.md`, "The lock server (ENQ)").

## The probe

- Table `ZOSD_PRB` (`MANDT`, `K1 CHAR10`, `K2 CHAR10`, all key) and lock
  object `EZOSD_PRB` over it, primary table only, in `$ZOSG_TMP`. vsp cannot
  create a lock object over ADT, so it was written with `DDIF_ENQU_PUT` +
  `DDIF_ENQU_ACTIVATE` from a module of ours. The generated
  `ENQUEUE_EZOSD_PRB` takes `MODE_ZOSD_PRB`, `MANDT`, `K1`, `K2`, `X_K1`,
  `X_K2`, `_SCOPE`, `_WAIT`, `_COLLECT` and raises `FOREIGN_LOCK` /
  `SYSTEM_FAILURE`.
- One RFC-enabled module ran a script of steps. Each step names its owner,
  and between steps `ENQUEUE_READ` (`GNAME = 'ZOSD_PRB'`, `GUNAME = space`)
  showed the lock table.

## How a second owner was obtained

`ENQUEUE_READ` shows two owner ids for each lock, `GUSR` and `GUSRVB`.
Comparing them across sessions settled which mechanism gives a new owner:

| Mechanism | Different owner? |
|---|---|
| A direct `CALL FUNCTION` in the same program | no |
| `CALL FUNCTION ... DESTINATION 'NONE'` (synchronous) | **yes**, and stateful: its locks stay between calls until `RFC_CONNECTION_CLOSE` |
| `CALL FUNCTION ... STARTING NEW TASK ... DESTINATION 'NONE'` | yes, until the task's module returns |
| `SUBMIT ... VIA JOB` + `JOB_CLOSE strtimmed` | yes, both ids differ |
| `SUBMIT ... AND RETURN` inside an RFC session | unmeasured: the program took no lock (`sy-subrc` 4), and one that writes a list broke the RFC connection |

The fixtures call them O1 (the calling session), O2 (`DESTINATION 'NONE'`),
O3 (`STARTING NEW TASK`) and OJ (the job). All ran as one user, so
`sy-msgv1` is the same name for every holder; the fixtures write it as
`<USER>`.

## The owner model

A session has **two owners**. `GUSR`, the dialog owner, holds `_SCOPE = 1`
and lives as long as the session. `GUSRVB`, the update owner, holds
`_SCOPE = 2` (the default) and belongs to the current SAP LUW: after a
`ROLLBACK WORK`, and after a `COMMIT WORK` that ran an update, the next lock
carries a new `GUSRVB`. `_SCOPE = 3` is **one row** with both owners and both
counters (`GUSE` and `GUSEVB`). A `_SCOPE 1` lock followed by a `_SCOPE 2`
lock on the same key merges into that same one row.

An owner id is 58 characters: a 20-digit timestamp, six more digits and the
application server's instance name, padded with dots. It is compared for
equality and never parsed. A blank owner (`GUSR` of a `_SCOPE 2` lock) means
"none".

## 1. Compatibility: another owner

O1 holds the row mode; O2 asks for the column mode on the same key.

| held \ requested | E | S | X | O |
|---|---|---|---|---|
| **E** | refused | refused | refused | refused |
| **S** | refused | granted | refused | granted |
| **X** | refused | refused | refused | refused |
| **O** | refused | granted | refused | granted |

A refusal raises `FOREIGN_LOCK` with sy-subrc 1, message `MC 601`, and
`sy-msgv1` = the holder's user name. A grant adds a second row with O2's
owner. O behaves like S toward other owners.

## 2. Compatibility and cumulation: the same owner

| held \ requested | E | S | X | O |
|---|---|---|---|---|
| **E** | granted, one row, count 2 | granted, second row | refused (602) | granted, second row |
| **S** | granted, second row | granted, one row, count 2 | refused (602) | granted, second row |
| **X** | refused (602) | refused (602) | refused (602) | refused (602) |
| **O** | granted, second row | granted, second row | refused (602) | granted, one row, count 2 |

- The same mode twice cumulates: one row, its counter goes to 2. A DEQUEUE
  takes one off. After E twice and one DEQUEUE the lock is still held, and
  another owner is still refused. The second DEQUEUE releases it.
- Different modes by one owner make separate rows. In both orders, S then E
  and E then S, a DEQUEUE E leaves the S row, which another owner can share
  and cannot upgrade.
- X is never cumulated. A second X by the same owner is refused with
  `FOREIGN_LOCK`, `MC 602` (the caller's own lock) and `sy-msgv1` = the
  user. One DEQUEUE releases it.
- A DEQUEUE with another mode, another scope or a key that is not held does
  nothing and answers 0. DEQUEUE has no exceptions.

## 3. Argument masks

- An initial key field without `X_<field> = 'X'` is **generic**: it matches
  every value. `ENQUEUE_READ` shows such a field as U+FFFF in each of its
  character positions. So `(G1, initial)` refuses another owner's `(G1, B)`
  and `(G1, initial)`, and grants `(H1, B)`.
- The reverse also collides: O1 on `(G2, B)` refuses O2's generic
  `(G2, initial)`.
- `X_K2 = 'X'` makes the initial value literal: `(G3, blank)` grants another
  owner's `(G3, B)` and refuses their generic `(G3, initial)`.
- A generic first field works the same way (`(initial, Q)` refuses
  `(ZZ, Q)` and grants `(ZZ, P)`). With every field initial, the whole table
  is locked in the client.
- Shared modes stay shared generically: S on `(G5, initial)` grants another
  owner's S on `(G5, initial)` and `(G5, B)`, and refuses E on `(G5, B)`.
- `*` in a value is a literal character. It is not a wildcard.
- `GARG` is client + K1 + K2 at their DDIC lengths. Trailing blanks are not
  significant.

## 4. `_SCOPE` against COMMIT, ROLLBACK and the end of the session

Each case enqueued one lock with `_SCOPE` 1, one with 2 and one with 3:

| Event | Scope 1 | Scope 2 | Scope 3 |
|---|---|---|---|
| `COMMIT WORK` with **nothing in the update task** (also `AND WAIT`, also in a background job) | kept | **kept** | kept |
| `COMMIT WORK` after a V1 `CALL FUNCTION ... IN UPDATE TASK` | kept | released once the update task has run (still there right after the statement, gone within 2 s) | the update half goes, the dialog half stays |
| `COMMIT WORK AND WAIT` with a V1 update | kept | released when it returns | the dialog half stays |
| `ROLLBACK WORK` | kept | released | the dialog half stays |
| End of the session (`RFC_CONNECTION_CLOSE`, the end of a job, the end of an aRFC task) | released | released | released |
| The end of one RFC call on a connection that stays open | kept | kept | kept |

Two of these results were surprises and are the ones most worth gating:

1. A COMMIT that has nothing to update does not release `_SCOPE 2` locks, and
   it does not renew the update owner either. A later `_SCOPE 2` lock joins
   the same `GUSRVB`.
2. A session's locks outlive the call that took them for as long as the
   connection lives. A stateless lock server would drop them, which is the
   0.4 ADT defect in another form.

Releases at the end of a session are asynchronous. Straight after
`RFC_CONNECTION_CLOSE` the rows were still there, and one second later they
were gone.

## 5. `_WAIT`

`_WAIT = 'X'` retries before it gives up. Against a lock that stayed held,
`FOREIGN_LOCK` came after about 4.7 s (the same call without `_WAIT` takes
0 ms). Against a lock whose holder ended about one second later, the request
was granted after about 1.0 s. That is consistent with a retry about once a
second for about five seconds, but the retry count and the interval
themselves were not measured.

## 6. `DEQUEUE_ALL`

`DEQUEUE_ALL` releases every lock of the caller in every scope, the dialog
halves and the update halves. It leaves other owners' locks: O1's call kept
O2's and O3's locks, and O2's call then removed only O2's lock.

## 7. `ENQUEUE_READ`

Parameters `GCLIENT`, `GNAME`, `GARG`, `GUNAME` (`space` = all users),
`LOCAL`, `FAST`, `GARGNOWC`. It exports `NUMBER` and `SUBRC` and has the
table `ENQ`, whose rows have these fields:

| Field | Type | Seen for our locks |
|---|---|---|
| `GCLIENT` | CHAR 3 | the logon client |
| `GNAME` | CHAR 30 | `ZOSD_PRB` (the table) |
| `GARG` | CHAR 150 | client + K1 + K2, U+FFFF for generic positions |
| `GMODE` | CHAR 1 | E / S / X / O |
| `GUSR` | CHAR 58 | dialog owner id, blank for `_SCOPE 2` |
| `GUSRVB` | CHAR 58 | update owner id, blank for `_SCOPE 1` |
| `GOBJ` | CHAR 16 | `EZOSD_PRB` (the lock object) |
| `GTARG` | CHAR 50 | GARG, cut to 50 |
| `GUNAME` | CHAR 12 | the user |
| `GUSE`, `GUSEVB` | INT4 | the counters on each owner |
| `GUSETXT`, `GUSEVBT` | NUMC 10 | the same counters as digits |
| `GTHOST`, `GTSYSNR`, `GTWP` | CHAR 32, NUMC 2, NUMC 2 | where the lock was taken |
| `GTDATE`, `GTTIME`, `GTUSEC` | DATS, TIMS, NUMC 6 | when it was taken |
| `GTCODE`, `GTMARK`, `GBCKTYPE` | CHAR 20, CHAR 1, CHAR 1 | blank in every probe |

## Unmeasured

- `SUBMIT ... AND RETURN` as an owner (see above).
- `_COLLECT` / `FLUSH_ENQUEUE`, the promotion mode R (O to E), and `_SCOPE`
  inside the update task itself.
- The `_WAIT` retry count and interval as values: only the two elapsed times
  above were measured.
- V2 update modules, and the locks of an update that fails. One update
  failed during setup (our module had not been generated as an update
  module) and its update owner's locks were released too. That run was a
  setup artefact, so it is not a case.
