# ABAP daemons and messaging channels

*Design only, nothing built. Written 2026-09-24 to be put to Alice as a
decision: whether to support the ABAP Daemon Framework (ADF) and ABAP
Messaging Channels (AMC) on both hosts, and above all what a running daemon
does when a new generation is served. No SAP system was called for this
note; every statement about SAP's behaviour below is either marked as read
from documentation or listed as a probe to run on A4H first.*

---

## Why this needs a decision and not only a plan

A daemon is state that outlives a call. That is its whole point: an object
started once, living in a session of its own, woken by messages and timers
for as long as the system runs. Alice decided on 2026-09-24 that state which
outlives a call is not to be added casually, because it ties data to a
generation and complicates the hot swap of generations
(`docs/generations.md`; the reload strategy of 2026-09-23 cuts at the
*entry* of a call stack and pins sessions to their generation until they
end). A daemon never ends by itself. Pinning it to its generation would keep
the old generation alive forever, so the pinning rule that works for APC
sessions does not work here, and the note has to say what does.

The answer proposed below is one rule: **only data crosses a generation,
never an object.** A daemon is restarted in the new generation from its
start parameter, the messages queued for it are plain data held outside
the generation, and whatever the old object held in its attributes is gone,
exactly as it is gone on a system when a daemon is restarted. Everything
else in this note follows from that rule or exists to make it safe.

## What exists today

| piece | where | what it does, as read |
| --- | --- | --- |
| APC on Node | `tools/osd-apc.mjs`, `zcl_apc_host` (lib `oisee/open-abap-apc`, `/src/apc`, `/src/host`) | a real WebSocket; `zcl_apc_host` creates the handler, calls `on_accept` / `on_start` / `on_message` / `on_close`, `drain( )` returns what it pushed; one promise chain per socket serialises the callbacks |
| APC in the preview | `web/preview-backend.mjs` `openChannel`, `web/preview-socket.mjs` | the same `zcl_apc_host`, driven from the service worker over a `MessagePort`; `open` is sent before the first `drain` (CLAUDE.md, "A page that speaks APC") |
| APC on Go | `tools/gogen/go/apc/apc.go`, `tools/gogen/go/abap/apc.go` (branch `spike/go-backend`) | `Channel` is an `http.Handler`; every callback is an `APCStep`: the process-wide `abap.WorkProcess` mutex, then `DialogStep`, a panic returned as `ErrDump` |
| AMC binding | `zcl_apc_binding_manager` in open-abap-apc | `bind_amc_message_consumer` **records** the binding and nothing more; "Nothing subscribes here yet" |
| AMC types | `if_abap_channel_types` in open-abap-apc | the AMC widths read off DD04L: application ID CHAR 30, channel ID SSTR 140, extension ID CHAR 60, consumer session ID SSTR 255; the filter element's field widths not read yet |
| AMC classes | `abaplint/deps` `src/channels/` | `cl_amc_channel_manager` with `create_message_producer`, `create_message_consumer`, `get_consumer_session_id`, `create_message_producer_by_id`, every body `RETURN`; `if_amc_message_producer(_text)`, `if_amc_message_receiver(_text)`, `if_amc_message_consumer`, `if_amc_message_context`, `cx_amc_error`. Signatures for syntax only; no behaviour |
| `WAIT FOR ...` | transpiler `statements/wait.ts`; open-abap-core `src/kernel/kernel_push_channels.clas.abap` | **every** `WAIT FOR ...` statement (push channels *and* messaging channels) transpiles to `KERNEL_PUSH_CHANNELS=>wait`, which polls the condition every 100 ms and `ASSERT`s a positive `UP TO` |
| `WAIT UP TO n SECONDS` | `@abaplint/runtime` `statements/wait.js` | commits every open connection, then sleeps with `setTimeout` |
| the dialog step | `tools/osd-dialog-step.mjs` (Node, three hosts), `abap.DialogStep` in `luw.go` (Go) | commit when the work returns, roll back when it throws |
| the supervisor | `tools/osd-runtime.mjs`, `tools/osd-pool.mjs` | one child process per generation; a recycle sends `quiesce` to the old child (grace 2 s by default, `SIGKILL` 8 s later) and only then spawns the new one; a pool of *n* children pins a socket to one child for its life |
| process status | `zosd_proc` / `ZC_OSD_PROCESS` | pid, role, port, generation, epoch, sockets, RSS, alive; filled from outside by `tools/osd-status.mjs` |

What does **not** exist anywhere in the clones under `.local/lars/`
(open-abap-core at `4eec777`, open-abap-apc, deps, the transpiler): no
daemon class, no `IF_ABAP_DAEMON_*`, no timer manager, no
`IF_AC_MESSAGE_TYPE_PCP`, no PCP parser, and no AMC behaviour. The daemon
framework is greenfield; AMC is signatures without a body.

Two facts from the reading that matter below and are easy to miss:

- **Node does not serialise dialog steps across requests** (confirmed as
  a defect on 2026-09-24; osg-i7 is fixing it in a separate PR).
  `tools/osd-serve.mjs` wraps each request in `dialogStep` and takes no
  lock. With the default SQLite client this does no harm, because sql.js
  is synchronous: a request never yields to the event loop in the middle,
  so two requests never interleave. They do interleave as soon as a step
  waits on a real macrotask: DuckDB, PostgreSQL, HANA, `WAIT UP TO`,
  outbound HTTP, live RFC. Then two requests share one database connection
  and one LUW, and the first to finish commits the other's rows. Worse,
  `cl_express_icf_shim` keeps its server object in `CLASS-DATA mi_server`,
  so interleaved requests can answer each other's responses. And APC
  (`tools/osd-apc.mjs`, `serveChannel`, lines 180-282) has no commit and no
  rollback at all: its callbacks do not run through `dialogStep`. Only the
  preview serialises (`serialized( )` in `web/preview-backend.mjs`), and Go
  does (`abap.WorkProcess`). A daemon's timer fires whenever it likes, so
  it would make the overlap routine. **osg-i7's fix is a prerequisite of
  this work**: a queue in `tools/osd-dialog-step.mjs` that is released
  during `WAIT`, APC callbacks run through `dialogStep`, and `/osd/sql`
  and the shim's static server inside the step.
- **Class data is per process on both hosts.** A JavaScript class's statics
  and Go's package-level variables are shared by every session in the
  process. On a system a daemon runs in an ABAP session of its own, with its
  own static attributes (to be confirmed by probe P9). Run in a work
  process as it is, a daemon here would share its statics with every HTTP
  request of that process. That is state outliving a call, shared across
  sessions, which Alice's decision of 2026-09-24 rules out, so it is not
  the default (decision D4).

---

## 1. The API surface to reimplement

Clean-room, as everywhere else: the interface signatures are the contract
and are read off A4H's class definitions (SE24 / ADT, the way
`if_abap_channel_types` was read off DD04L), not guessed and not copied as
source. The table names what a handler written for a system calls; the
exact parameter names and types are the first thing to read (step 0).

### The daemon itself

| SAP name | role | what it calls into | open-abap today |
| --- | --- | --- | --- |
| `IF_ABAP_DAEMON_EXTENSION` | the callbacks | — | absent |
| `CL_ABAP_DAEMON_EXT_BASE` | abstract base a daemon inherits, every callback an empty default | — | absent |
| `ON_ACCEPT` | the start request arrives; the daemon accepts or rejects (a setup mode out) | caller info, start parameter | — |
| `ON_START` | first callback of an accepted instance | `IF_ABAP_DAEMON_CONTEXT`: start parameter (a PCP message), instance ID, daemon info | — |
| `ON_MESSAGE` | a message sent through a handle | the context and the message, an `IF_AC_MESSAGE_TYPE_PCP` | — |
| `ON_TIMEOUT` | a timer the daemon armed has expired. On a system this is `IF_ABAP_TIMER_HANDLER~ON_TIMEOUT`, which the daemon class implements itself; it is not a method of the extension interface (to confirm in step 0) | the timeout context | — |
| `ON_STOP` | stopped through a handle, optionally with a PCP message | the context, the message | — |
| `ON_ERROR` | **unverified until P3.** Most likely called in the *new* instance after the previous one dumped: a session that has dumped cannot run ABAP any more, so it cannot be the one that hears about its own error | the context | — |
| `ON_RESTART` | **unverified until P3.** Most likely the first callback of a new instance after a restart the *system* decided (announced to the old instance by `ON_BEFORE_RESTART_BY_SYSTEM`), rather than after a dump | the context, the original start parameter | — |
| `ON_BEFORE_RESTART_BY_SYSTEM` | the system is about to restart the daemon for a reason of its own; the old, still healthy instance's last word | the context | — |
| `ON_SERVER_SHUTDOWN` | the application server the daemon runs on is going down | the context | — |
| `ON_SYSTEM_SHUTDOWN` | the whole system is going down; no restart follows | the context | — |

### The client side

| SAP name | methods | open-abap today |
| --- | --- | --- |
| `CL_ABAP_DAEMON_CLIENT_MANAGER` | `START` (class name, daemon name, a PCP start parameter; returns an instance ID), `ATTACH` (instance ID; returns a handle), `GET_DAEMON_INFO` (by class name; a table of instances: name, instance ID, server, start time, restart count and whatever else A4H's structure carries) | absent |
| `IF_ABAP_DAEMON_HANDLE` | `SEND` (a PCP message), `STOP` (optionally with a PCP message); any further getters as read | absent |
| `CX_ABAP_DAEMON_ERROR` | what `START` / `ATTACH` / `SEND` raise (name to confirm) | absent |

### Timers

| SAP name | methods | open-abap today |
| --- | --- | --- |
| `CL_ABAP_TIMER_MANAGER` | `GET_TIMER_MANAGER` returns the session's manager | absent |
| `IF_ABAP_TIMER_MANAGER` | `START_TIMER` (handler, timeout in milliseconds, optional context; returns a timer ID), `STOP_TIMER` | absent |
| `IF_ABAP_TIMER_HANDLER` | `ON_TIMEOUT` | absent |

Timers are not a daemon feature on a system: they also fire in stateful APC
sessions. Built once, they serve both, which makes them the cheapest piece
with the widest use.

### The message: PCP

| SAP name | role | open-abap today |
| --- | --- | --- |
| `IF_AC_MESSAGE_TYPE_PCP` | Push Channel Protocol message: a set of name/value fields and a body (text or binary) | absent |
| `CL_AC_MESSAGE_TYPE_PCP` | `CREATE` returns one; `SET_FIELD` / `GET_FIELD` / `GET_FIELDS`, `SET_TEXT` / `GET_TEXT`, `SET_BINARY` / `GET_BINARY`, and the serialised form | absent |
| the wire form | fields as `name:value` lines, an empty line, the body; the WebSocket subprotocol `v10.pcp.sap.com` | absent |

PCP is the one piece that must be exactly right on the wire, because it is
what a page reads. It is also the piece that makes the generation rule
cheap: a PCP message is plain data with a canonical text form, so it can be
queued outside a generation, written to a table and replayed into the next
one. The serialiser is pure ABAP and testable against a byte string
captured on A4H.

### AMC

| SAP name | role | open-abap today |
| --- | --- | --- |
| `CL_AMC_CHANNEL_MANAGER` | `CREATE_MESSAGE_PRODUCER`, `CREATE_MESSAGE_CONSUMER`, `GET_CONSUMER_SESSION_ID`, `CREATE_MESSAGE_PRODUCER_BY_ID` | signatures in deps, bodies `RETURN` |
| `IF_AMC_MESSAGE_PRODUCER` and the typed ones (`_TEXT`, `_BINARY`, `_PCP`) | `SEND` | `_TEXT` in deps; `_BINARY` and `_PCP` absent |
| `IF_AMC_MESSAGE_RECEIVER` and the typed ones | `RECEIVE` (message, context) | `_TEXT` in deps |
| `IF_AMC_MESSAGE_CONSUMER` | `START_MESSAGE_DELIVERY`, `STOP_MESSAGE_DELIVERY` | in deps |
| `WAIT FOR MESSAGING CHANNELS UNTIL ... UP TO ... SECONDS` | where an ABAP session receives | transpiles to `KERNEL_PUSH_CHANNELS=>wait` (100 ms polling) |
| the channel definition (object type `SAMC`) | application ID, channel paths, message type, authorised programs and their activity (send / receive), scope | nothing reads `SAMC` yet; an abapGit `*.samc.xml` would be read the way `*.sapc.xml` is |
| the APC binding | `IF_APC_WSP_BINDING_MANAGER~BIND_AMC_MESSAGE_CONSUMER` in `on_start`: from then on a message on the channel goes straight to the socket, with no `on_message` | recorded, not delivered (`zcl_apc_binding_manager`) |

Where the ABAP lives is decision D6 below; the natural home is
`oisee/open-abap-apc`, which already holds the APC half, the channel types
and the binding manager, and which is ours to merge. None of this is sent to
the upstream repositories: only fixes for a difference from A4H go there.

---

## 2. What to measure on A4H before building

Every SAP-shaped behaviour below is a guess until measured, and the house
rule is that a guess is not built on (`docs/frame-comparison.md`, the
`general_get_random_int` example in CLAUDE.md). Each probe is a small ABAP
Unit test class, or a daemon class plus a test that drives it, deployed to
a throwaway `$ZOSG_TMP` package on A4H **only when Alice asks** (CLAUDE.md,
"SAP systems"). Results go into this file and into `ANORMALIES.md` where
they differ from what the runtime does. The same test classes then run here
unchanged and must pass, which is what makes them able to fail.

A daemon's callbacks run asynchronously, so a probe observes them through a
log table of its own (`ZOSD_DAEMON_LOG`: instance, callback, sequence,
timestamp in microseconds, `sy-uname`, `sy-mandt`, a free text) and the test
polls it with `WAIT UP TO` (or `WAIT FOR MESSAGING CHANNELS` where AMC is
the subject).

| # | question | probe |
| --- | --- | --- |
| P0 | the signatures | read `IF_ABAP_DAEMON_EXTENSION`, `IF_ABAP_DAEMON_CONTEXT(_BASE)`, `CL_ABAP_DAEMON_CLIENT_MANAGER`, `IF_ABAP_DAEMON_HANDLE`, the info structure, `CL_ABAP_TIMER_MANAGER`, `IF_ABAP_TIMER_*`, `IF_AC_MESSAGE_TYPE_PCP`, `CL_AMC_CHANNEL_MANAGER` and the typed producer/receiver interfaces off A4H; widths of every DDIC element they use (DD04L) |
| P1 | is `ON_MESSAGE` serialised per instance? | send 20 messages through one handle in a loop; `ON_MESSAGE` logs entry, busy-waits 200 ms, logs exit. Expect no interleaving of entry/exit pairs and the send order preserved. Also: does `SEND` return before the callback runs (asynchronous) or after? |
| P2 | timer granularity | arm timers of 1, 10, 50, 100, 1000 ms, 20 times each; log the actual delay. Also the smallest accepted value and the error for 0 and negative, how many timers one daemon may hold, and whether a timer fires while `ON_MESSAGE` is still running (expected: queued behind it) |
| P3 | a dump in `ON_MESSAGE` | `ON_MESSAGE` divides by zero on the text `boom`. Observe: is `ON_ERROR` called, in the same instance or a new one? Is `ON_BEFORE_RESTART_BY_SYSTEM` / `ON_RESTART` called? Does the instance ID survive? Is the message that dumped redelivered (at least once) or lost (at most once)? Are the messages queued behind it delivered? |
| P4 | restart limits | send `boom` repeatedly. After how many restarts, in what window, does the system give up, and what is the daemon's state then (gone from `GET_DAEMON_INFO`, or listed as stopped)? Does the counter reset after a quiet period? Same for a dump in `ON_START` and in `ON_TIMEOUT` |
| P5 | one instance per name, or many? | `START` twice with the same class and name; then two names, one class. Does the second raise, return the same instance ID, or make a second instance? What does `GET_DAEMON_INFO` list? |
| P6 | scope across clients and users | start in client A, `GET_DAEMON_INFO` and `ATTACH` from client B and from another user of client A. Log `sy-uname` and `sy-mandt` inside the daemon: whose user does a daemon run as? For AMC: a producer in client A, a consumer in client B; the channel's scope attribute in `SAMC` and what each value does |
| P7 | COMMIT inside a daemon | `ON_MESSAGE` inserts a row without `COMMIT WORK`; a second session reads it after the callback returns. Is there an implicit commit at the end of each callback (a dialog step), or does the LUW run across callbacks? Is `ROLLBACK WORK` at the end of a dump? Are `COMMIT WORK`, `WAIT UP TO`, `CALL FUNCTION ... STARTING NEW TASK`, `SUBMIT` allowed inside a daemon, and which raise? |
| P8 | AMC ordering and transactionality | one producer sends 1..1000 in a loop; a consumer (a receiver in an ABAP session, and separately an APC socket bound to the channel) checks the sequence. Then two producers in two sessions, each numbered. Then: is an AMC message sent inside a LUW that is rolled back still delivered? Is delivery at `SEND` or at `COMMIT WORK`? What is `co_comm_type_synchronous` versus asynchronous in effect? `i_suppress_echo`: does a session receive what it sent? |
| P9 | the daemon's session | a daemon class sets a static attribute in `ON_START`; the starting session reads the same static attribute. Expected on a system: not visible (the daemon's own session). This is the divergence the runtime will have in its first version |
| P10 | re-activation while running | the question that decides section 4. Start the daemon, then activate a changed version of its class (a new log text), then send a message. Which callbacks run, in which version: nothing until the next message and then the new code? `ON_BEFORE_RESTART_BY_SYSTEM` in the old load and `ON_RESTART` in the new? A `LOAD_PROGRAM_CHANGED` dump and `ON_ERROR`? Do its timers survive? Are the messages queued meanwhile delivered to the new load? |
| P11 | stop semantics | `STOP` with a message: is `ON_STOP` called with it, are queued messages delivered first or dropped, and does `SEND` to a stopped instance raise? |
| P12 | shutdown callbacks | not measurable on a single-server sandbox without stopping it, so read from SAP's ABAP keyword documentation and help instead, and say so: which callback runs on an application-server shutdown, whether the daemon is restarted on another server (with `ON_RESTART`), and whether anything starts daemons after a system restart |

P1, P3, P7, P8 and P10 are the ones the design below depends on. P12 is
reading, not running, and is the only one that stays unmeasured.

---

## 3. The mapping per host

### The shape both hosts share

```
                 stable layer (does not change with a generation)
   +-------------------------------------------------------------+
   | daemon registry     ZOSD_DAEMON rows: name, class, instance, |
   |                     start parameter (PCP text), state,       |
   |                     generation, restarts, started by/at      |
   | mailboxes           per instance: queued PCP messages (text) |
   | AMC broker          channel -> subscribers (sockets, sessions|
   |                     in any work process), in publish order   |
   +-------------------------------------------------------------+
            |  PCP text in, PCP / AMC text out  (data only)
   +-------------------------------------------------------------+
   | generation N: work process(es)                               |
   |   daemon host (ABAP)  one object per running instance, in    |
   |                       the work process itself (no thread of  |
   |                       its own); every callback a dialog step |
   |                       in the one step queue, released on WAIT|
   |   class-data guard    a daemon step that reads or writes     |
   |                       class data is a recorded runtime error |
   |   timers              per instance, owned by the generation  |
   +-------------------------------------------------------------+
```

The **daemon host** is the ABAP half and the twin of `zcl_apc_host`: it
creates the daemon object by class name, calls `on_accept` / `on_start` /
`on_message` / `on_timeout` / `on_stop` / `on_error` / `on_restart`, and
collects what the daemon sent (AMC publications, messages to other daemons)
for the host to drain after each callback. It knows nothing of Node or Go,
so the same class serves both hosts, the preview and a test.

The **stable layer** is host code, not ABAP, and holds only data: PCP text,
never an ABAP object. That is what lets it outlive a generation. On Node it
is the supervisor process; on Go it is the dispatcher proxy of the reload
strategy, which does not exist yet (see below).

Every callback is **one dialog step**, and it takes **the same lock every
other step takes**: on Node the step queue of osg-i7's PR in
`tools/osd-dialog-step.mjs`, on Go `abap.WorkProcess`. There is no lock of
the daemon's own. The queue is released for the length of a `WAIT` and taken
again after it. Inside the lock, `dialogStep` / `DialogStep` commits on
return and rolls back on a dump, unless P7 says a system does otherwise.
The rule lives in the module every host already imports (CLAUDE.md, "A
rule written once ... does not survive the second caller"), so the daemon
driver calls it rather than repeating it.

The daemon runs **in the host process and on its thread**, not in a thread
or process of its own (decision D4, model (b)). What a system gives a
daemon, a session with its own static attributes, is replaced by a rule:
**a daemon step that reads or writes class data is a recorded runtime
error**, entered in `ANORMALIES.md` with P9 as its measurement. That keeps
the rule against state that outlives a call and crosses sessions without
paying for isolation. The guard exempts the runtime's own classes (the
daemon host, PCP, the timer manager, AMC, the kernel classes of
open-abap-core), which keep process state on purpose; everything else a
daemon step reaches is checked. **How the guard is enforced is not proven
yet** (see "Statics" under Node): it is the rule the design commits to, and
its mechanism is the first thing step 5 has to demonstrate.

### Node

- **Where the daemon runs.** In a work process of the current generation:
  the child of `tools/osd-runtime.mjs`. With a pool (`OSD_WORKERS > 1`) the
  supervisor picks one child at `START` and pins the instance there, as it
  pins a socket today.
- **The mailbox.** A per-instance promise chain, the same device as the
  `turn` chain in `serveChannel`: messages and timer expiries are appended
  to one queue and run one at a time, which is what P1 is expected to
  confirm. Each entry of the chain is then queued in the one step queue of
  `tools/osd-dialog-step.mjs` (osg-i7's PR), the same queue requests and APC
  callbacks go through, so a daemon step and an HTTP request never share a
  LUW and never overlap.
- **`WAIT` releases the lock.** A lock held across `WAIT UP TO` or `WAIT FOR
  MESSAGING CHANNELS` deadlocks: the daemon waits for a message that only a
  step it is blocking could send. On a system `WAIT` rolls the session out
  and frees the work process, so here the lock is released for the length
  of the wait and taken again before the step goes on. The LUW side already
  matches: `@abaplint/runtime` `statements/wait.js` commits every open
  connection before it sleeps (`implicitCommit`, the `commit()` call at
  line 9), which is the database commit a roll-out implies. After
  osg-i7's dialog-step lock PR (#75), a `WAIT` inside a step no longer does this in the runtime's
  JavaScript alone: it goes through `installWait` in
  `tools/osd-dialog-step.mjs`, which releases the lock around the wait. The
  daemon driver uses the same queue and the same release.
- **The transpiler's async model.** Every ABAP method is an `async`
  function; a callback yields only at `await` points (database, `WAIT`,
  HTTP). Nothing preempts a busy loop, so a daemon that computes for a
  second blocks its work process for a second, as a request does today. A
  pool is the answer to that, as it already is for sockets.
- **Timers.** `setTimeout` per armed timer, whose expiry is posted into the
  instance's mailbox, never run directly, so `ON_TIMEOUT` cannot overlap
  `ON_MESSAGE`. Timers belong to the generation: a recycle drops them.
- **`SEND` and `ATTACH` from a request.** A request in child A sends to a
  daemon in child B: the ABAP client manager hands the PCP text to the host,
  the host posts it to the supervisor over the IPC channel the child already
  has (`process.send`, the same channel as `say` and `ready`), and the
  supervisor appends it to the instance's mailbox and forwards it to child
  B. With one child the round trip is the same and only shorter.
- **AMC.** When a publication leaves is **not decided until P8**. A system
  may send at `SEND`, independently of `COMMIT WORK`, in which case a
  rolled-back step has still published; or it may hold messages until the
  commit. The host supports both shapes (hand each message to the
  supervisor at `SEND`, or drain them after the step and drop them on a
  rollback) and picks the one P8 measures; no default is written before
  that. Either way a publication is posted to the supervisor and fanned
  out in publish order to every
  subscriber: a bound APC socket in any child, or an ABAP session waiting in
  `WAIT FOR MESSAGING CHANNELS`. The socket side needs `serveChannel` to
  accept frames that did not come from `on_message`; the waiting side needs
  `KERNEL_PUSH_CHANNELS=>wait` to see a delivered message instead of only
  polling a condition (it can keep polling at 100 ms in a first version).
- **Statics: a guard, not isolation, and the guard is unproven.** The
  daemon runs in the work process, so it could see the class statics of the
  requests it shares the process with. The step sets a flag in
  `abap.context` for its length, and a read or a write of a static
  attribute of a class outside the runtime's own while the flag is set
  raises a runtime error that names the class and the attribute and goes to
  the dumps list. Two ways to enforce it, neither built:
  - **The primary path: our own pass at build time**, never offered
    upstream. The guard is our experiment and not a fix for a difference
    from A4H, and only such fixes go to the transpiler's maintainer. The
    pass is a post-processing step in `tools/osd-transpile.mjs` over the
    generated modules: it rewrites each access of a static attribute in a
    method body into a guarded one, and leaves alone the copies a
    constructor makes (`this.x = <class>.x;` is a fixed shape the
    transpiler emits, so the pass can recognise it). Where the generated
    JavaScript alone cannot tell a read of class data from something that
    only looks like one, the pass asks the abaplint registry that
    `osd-transpile.mjs` already builds. If a post-processing pass proves
    too brittle, the fallback is a local hook on a feature branch of the
    transpiler clone that is **never** offered upstream. Either way the
    cost is one flag test per static access, to measure.
  - **A prototype only: an accessor** put once at load over every static
    attribute. It has two holes found by reading, and each alone is enough
    not to rely on it. **A false positive:** transpiled constructors copy
    statics into instance fields (`this.gt_by_uuid =
    zcl_stg_segw_gen.gt_by_uuid;` at line 1208 of
    `output/zcl_stg_segw_gen.clas.mjs`), so merely creating such an object
    inside a daemon step reads a static through the getter and dumps,
    though the ABAP never named the static. **A miss:** a data reference,
    a field symbol or an alias taken outside the step (in `ON_START`'s
    caller, or held in an instance attribute of the daemon) reaches the
    same value without going through the accessor at all.
  The build-time pass closes the first hole (it checks the access in the
  method body, not the property) and narrows the second to references taken before the
  step, which the P9 probe and the ANORMALIES entry must name as a known
  gap. Decision D4.
- **Why not a thread per daemon by default** (the counter-argument that
  decided D4; a `worker_threads` worker remains possible as an opt-in). It would
  give each daemon its own statics, but also its own database connection,
  and with the default database that breaks the daemon. The default SQLite
  is in-memory sql.js, so a second connection is a second, separate copy:
  the worker and the requests would not see each other's rows (demo test 3,
  "insert through OData, see the counter move", would fail). With a file,
  the generation model allows one holder of a database file at a time
  (`docs/generations.md`, "exactly one serving instance per persistent
  database"). A thread of its own is therefore only an **explicit opt-in**
  per daemon class, and only for a daemon that touches no database, or,
  as a later option, with every SQL statement of the worker routed over a
  message port to the main thread's connection and executed there inside
  the step queue.

### Go (OSGo)

- **A goroutine per instance with its own `*abap.Session`.** `Session`
  already holds what the roll area holds per session (`sy`, the TRY
  handlers, the HTTP clients), and its comment says a goroutine picks one up
  and puts it down, which is exactly a daemon between two callbacks.
- **Messages and timers as channels.** A buffered `chan pcpMessage` per
  instance and `time.AfterFunc` posting into a second channel; one `select`
  loop per goroutine takes one at a time, so serialisation per instance is
  the structure of the code, not a rule to remember.
- **The step.** A `DaemonStep` next to `APCStep`: `abap.WorkProcess.Lock()`,
  `DialogStep`, a `recover` that turns the panic into an `ErrDump` and hands
  it to the restart policy. The goroutine only waits on its channels; every
  callback it runs is under `WorkProcess`, the same mutex as HTTP and APC
  steps, because the process has one `tx` and one set of class data.
- **Statics.** Package-level variables, one set per process. The same guard
  as on Node, cheaper here: the `Session` of a daemon step carries a flag,
  and gogen emits the check at each access of a static attribute of a class
  outside the runtime's own, so a read or a write from a daemon step panics
  with a named runtime error that the restart policy treats like any dump.
  A process of its own (the same binary with a daemon flag) is the opt-in,
  under the same restriction as on Node: no database, or SQL routed to the
  main process. Decision D4 covers both hosts.
- **`WAIT` releases `WorkProcess`**, for the same deadlock reason as on
  Node.
- **The stable layer.** OSGo is one process today, so there is nowhere
  outside a generation to keep a mailbox. Until the dispatcher proxy of the
  reload strategy exists, a generation swap on Go is a process restart, and
  the registry table is the only thing that crosses it: the daemons are
  restarted from their rows (persistence and swap are then one path, which
  is a good property and is why the recommendation below insists on it).
  Messages queued in the dying process are lost unless they were written to
  the table too; decision D3.
- **Parity.** Alice's rule of 2026-09-23 is that OSGo follows the JS host
  to parity before reload work starts. The ABAP half (daemon host, PCP,
  client manager, AMC producer) compiles through gogen like any other ABAP,
  so the Go work is the host part only, and it comes after Node.

### The preview (service worker)

Possible, and not faithful. A service worker is started on demand and
stopped by the browser when idle (tens of seconds in Chromium) or when an
event runs too long; a pending `setTimeout` does not keep it alive, and it
gets no event before it is stopped, so no shutdown callback can run. What
works:

- a daemon lives while pages keep the worker busy: an open `PreviewSocket`
  conversation delivers messages, and the ticker demo would run for as long
  as its page is open;
- when the worker is stopped, the daemon dies without a callback, which is
  a crash in SAP's terms;
- when the worker starts again, the registry rows (in the preview database,
  which is exported and kept) say which daemons were running, and they are
  restarted with `ON_RESTART`, the same path as a generation swap.

Model (b) fits the worker: there are no `worker_threads` in a service
worker, and none are needed; the daemon runs in the worker's one thread.
But the preview is not ready for it as it stands. Today `openChannel`,
`channelMessage` and `closeChannel` (`web/preview-backend.mjs`, lines
201-240) bypass both `serialized( )` and `dialogStep`, and `serialized( )`
is not released on `WAIT`. osg-i7's dialog-step lock PR (#75) changes that: APC callbacks go through
`dialogStep`, the lock is released on `WAIT`, and a database reset runs
under the lock exclusively. The daemon's callbacks in the preview are built
on that PR, the same queue as on Node, and the class-data guard is the
same transpiler check.

The recommendation is to support it as that, say so on the page, and not
chase more: nothing in the browser will keep a background object alive
without a page, and pretending otherwise is the kind of "connected and
silent" answer the APC host was written to avoid.

---

## 4. The generation swap, persistence and observability

### What happens to a running daemon when a new generation is served

The options, with the rule "only data crosses a generation" as the test:

| option | what happens | verdict |
| --- | --- | --- |
| **A. restart in the new generation** | admission to the daemon's mailbox is held in the stable layer; the old instance finishes the callback it is in (the drain, bounded by the quiesce grace); it gets its last word; its timers are dropped; the new generation creates a new object from the class of the same name, gives it its first callback (`ON_RESTART`, or whatever P3/P10 show a system calls) with the same instance ID and the original start parameter; the held mailbox is released to it in order, each message removed only on an ack after its step committed | **recommended** |
| B. pin the daemon to its generation | the old generation stays up for as long as the daemon runs | rejected: a daemon never ends by itself, so the old generation never retires, and every activation adds a process |
| C. migrate the object | serialise the daemon's attributes, rebuild them in the new generation | rejected: this is option 2's roll-area serialisation, the part the reload strategy removed on purpose, and an attribute of a changed class may no longer exist |
| D. stop and forget | the daemon is stopped with the old generation and not restarted; whoever started it starts it again | honest and smallest, but an activation would silently end every daemon, and the status list would be the only place to notice |

Under option A, precisely:

1. **Which callback in the old generation.** Not `ON_STOP`: a daemon reads
   `ON_STOP` as "someone asked me to end", and may delete what it
   persisted. The closest meaning SAP has for "this server is going away and
   you will continue elsewhere" is `ON_SERVER_SHUTDOWN` followed by
   `ON_RESTART` on another server, or `ON_BEFORE_RESTART_BY_SYSTEM`
   followed by `ON_RESTART`. P10 (re-activation) and P12 (reading) inform
   the choice of **callbacks**, and only that. **Option A wins over
   whatever P10 shows about the old load.** If a system turns out to keep
   running the old load of a daemon until it is restarted, mirroring that
   here would be option B, which keeps the old generation alive for as long
   as the daemon runs. On a system the old load costs nothing, because it
   is one program in a shared buffer; here it is a whole process with its
   own database handle, and the generation model (`docs/generations.md`)
   has one serving generation per database. The fidelity rule
   ("do what a system does") gives way to Alice's rule on state outliving
   a call, and the note records that as a divergence in `ANORMALIES.md`.
   From P10 we take which callbacks run and in what order; if a system runs
   none in the old load, the old-generation callback is skipped and only
   the new instance's first callback runs.
2. **The message being processed** completes in the old generation, under
   the quiesce grace (2 s today, which a daemon may need raised). If the
   grace runs out, the step is killed. A kill **before** the step commits
   rolls its LUW back (the dialog-step rule), and the message is treated as
   P3 says a dumped message is treated. A kill **after** the commit but
   before the supervisor hears of it would make the message run twice in
   the new generation. So a message leaves the mailbox only on an
   **acknowledgement sent after the commit**, and every message carries an
   ID that the daemon host records in the same LUW as the step's work
   (`ZOSD_DAEMON_ACK`: instance, last message ID). On replay, a message whose
   ID is already recorded is dropped rather than run again. Either
   mechanism alone has a gap (an ack can be lost with the process; a dedup
   table alone does not tell the supervisor when to forget a message).
   What the two together give is narrower than "exactly once", and the note
   says so:
   - **Exactly once for the database effects of a step with a single
     commit**, the one at its end. A step can commit in the middle:
     `WAIT UP TO` does (`@abaplint/runtime` `statements/wait.js`,
     `implicitCommit`, the `commit()` call at line 9), and `COMMIT WORK` may
     be allowed in a daemon (P7). So the ID is written at **every** commit
     point of a daemon step, not only at the end. The hook for the `WAIT`
     case is `installWait` in `tools/osd-dialog-step.mjs` from osg-i7's dialog-step lock PR (#75):
     a `WAIT` inside a step passes through it, so it writes the ID into the
     LUW just before the commit it triggers. For `COMMIT WORK` the same
     write goes into the host's commit path of the daemon step.
   - **A step killed after a mid-step commit is dropped, not resumed, and
     that leaves the daemon half-done.** What it committed before the kill
     stays; what came after is lost. There is no redo and no undo. The
     daemon must tolerate that state on its next callback, exactly as a
     daemon on a system must tolerate a session that died after a
     `COMMIT WORK`: write in steps that are each consistent on their own,
     or record progress and check it in `ON_RESTART`.
   - **At least once for effects outside the database**: an AMC message
     published at `SEND` (if P8 says a system does that), outbound HTTP, a
     live RFC call, anything the step did before a kill that the rollback
     cannot undo.
   - The assumption it rests on: message IDs are assigned by the
     supervisor, **strictly increasing per instance**, so "last ID
     recorded" is enough and the table holds one row per instance. The
     supervisor keeps its counter across a generation swap; after a
     supervisor restart it starts above the highest ID in the table.
3. **Messages queued behind it** are PCP text in the stable layer and are
   delivered to the new instance after `ON_RESTART`, in order. Nothing is
   lost on Node. On Go, until the dispatcher proxy exists, they are lost
   unless D3 decides to write the mailbox to the table.
4. **Messages sent during the swap** (a request in the new generation
   sends to the daemon before it has restarted) wait in the same mailbox.
   A sender never sees an error for a swap.
5. **Timers** are dropped. The new instance re-arms in `ON_RESTART`, which a
   well-written daemon does on a system anyway, because a restart after an
   error loses them there too (to confirm by P3/P10).
6. **AMC publications** already handed to the broker are delivered; the
   broker is in the stable layer. Whether a step that was killed or rolled
   back had already published depends on P8 (at `SEND`, or at commit); no
   default is set before it.
7. **APC sockets bound to an AMC channel** live in a work process and die
   with it, as every APC socket does on a recycle today (`#stopChild`). The
   page reconnects and binds again. This is not new and not made worse; the
   demo page must reconnect, and the note on it is that APC sockets could
   later be held by the stable layer too, which is a separate decision.
8. **The daemon's attributes** are gone, which is exactly what a restart on
   a system does. A daemon that must keep something across a restart writes
   it to a table, as it must on a system.

What this costs the swap: one more phase in `recycle()`, between "old child
quiesced" and "new child ready", in which the supervisor holds mailboxes;
and one more message on the IPC channel (`{type: "daemons"}`) with which a
new child asks what to restart. The order of the recycle does not change:
the old child still goes first, because both would otherwise hold the same
database file.

### Persistence: is a daemon restarted after a process restart?

A registry table, `ZOSD_DAEMON` (name, class, instance ID, start parameter
as PCP text, state RUNNING / STOPPED / FAILED, generation, restart count,
started by, started at, last callback, last error), written by the daemon
host at `START`, `STOP`, restart and failure, in the same LUW as the
callback that caused it.

This table is **authoritative state, not a derived index**, and that has to
be said plainly. The rule of 2026-09-24 is that the files are the truth and
tables hold only indices derived from them (the cross-reference), rebuilt
per generation. `ZOSD_DAEMON` is neither a source nor derived from one: it
is the only record that a daemon is running and what it was started with,
and nothing can rebuild it. The status tables are not a precedent either,
because they are refreshed from the processes and could be dropped at any
time. So keeping it is a decision of its own (D9). The alternatives are to
keep the registry only in the supervisor's memory (a crash forgets every
daemon, and the Go swap, which is a process restart, forgets them too), or
in a file under `.local/` beside `instances.json` (host state, not table
state, but invisible to ABAP, so `GET_DAEMON_INFO` would have to ask the
host). The recommendation is the table, because `GET_DAEMON_INFO` is ABAP
and reads it, and because on a system this state lives in the kernel and is
equally authoritative; but it is Alice's call, not a status table in
disguise.

The recommendation is that **a generation swap, a process restart and a
crash take the same path**: the new work process reads the RUNNING rows and
restarts each with `ON_RESTART`. Whether a *system* restarts daemons after a
restart of the whole system is P12; if it does not, the host could still
offer it behind a switch, because a local runtime is restarted far more
often than a system is, and a demo that stops every time the laptop sleeps
is not a demo. Decision D5.

Restart after a failure follows P3/P4: the same number of restarts in the
same window as a system, then the row is FAILED and the daemon stays down
until someone starts it.

### Observability

An SM-like list in the status app, the same way the work processes are
listed: `ZOSD_DAEMON` behind a CDS view `ZC_OSD_DAEMON`, served by the
status service beside `ZC_OSD_PROCESS`, one row per instance with its work
process (pid), generation, state, restart count, mailbox depth, armed timers,
last callback and its duration, last error. The mailbox depth and timers are
host facts, so the supervisor fills them into the table the way
`tools/osd-status.mjs` fills `zosd_proc` today. A stop button calls
`IF_ABAP_DAEMON_HANDLE~STOP` through an action; a start is left to the
application, as on a system. `osd-runtime.mjs ps` gains the same list for a
terminal, and every callback that dumps goes to the dumps list with the
daemon's name in the step description, as a request's dump does.

---

## 5. The demo

**A ticker daemon that pushes the taxi counters to a browser over the
existing APC channel through AMC.** It proves every piece in one path:

| piece | object |
| --- | --- |
| the daemon | `ZCL_OSD_DAEMON_TICKER`, inheriting `CL_ABAP_DAEMON_EXT_BASE` and implementing `IF_ABAP_TIMER_HANDLER`. `ON_START` / `ON_RESTART` arm a timer (start parameter field `interval`, default 1000 ms). `ON_TIMEOUT` reads the counters (trip count per pickup borough from the taxi facts, or the demo's travel count where the taxi data is absent), publishes them as a PCP message with a sequence number, the instance's restart count and the generation, and re-arms. `ON_MESSAGE` takes `interval` and `pause` fields. |
| the channel | `ZOSD_TICKER`, an AMC application with channel `/counters`, message type PCP (`*.samc.xml`) |
| the socket | `ZCL_OSD_APC_TICKER`, a stateless PCP APC handler whose `ON_START` binds the connection to `/counters` and which otherwise does nothing: every frame the page sees came through AMC, none through `on_message` |
| the controls | an ICF node (or a function import on an existing service) that calls `CL_ABAP_DAEMON_CLIENT_MANAGER=>START`, `ATTACH`+`SEND` and `STOP` |
| the page | `webapp/ticker/`, a launchpad tile: the counters, the sequence number, the generation and the restart count, and a reconnect when the socket closes |

What it shows, as tests (`test/daemon.mjs`, and the same file against OSGo):

1. start the daemon, open the socket, receive at least three messages with
   consecutive sequence numbers;
2. send `interval=200`, observe the rate change (P2's granularity decides
   the tolerance);
3. insert taxi facts through OData, see the counter move in the next tick
   (the daemon reads committed rows, P7);
4. **recycle the generation** with a changed daemon class (a new field in
   the message): after the reconnect the messages carry the new generation,
   the restart count is 1, and a message sent during the recycle arrived;
5. send `boom`: the dump is in the dumps list, `ON_ERROR` / `ON_RESTART`
   ran as P3 says, ticks resume;
6. stop the daemon: ticks stop, the status list says STOPPED, a `SEND`
   raises.

The same classes go to A4H as an abapGit zip (`docs/a4h-deploy.md`) when
Alice asks, and the sequence of callbacks in the log table is compared
between the two, the way `tools/o4d-record.mjs --compare` compares frames.
That comparison is the acceptance test of the whole feature.

---

## 6. Effort and order

Days are working days of one session, measured against what similar pieces
cost here (the APC host, the RFC channel, the pool).

| step | what | days |
| --- | --- | --- |
| 0 | read the signatures off A4H (P0) and run the probes P1 to P11, with Alice's go; write the results into this file and `ANORMALIES.md` | 1.5 |
| 1 | **not in this work**: osg-i7's separate PR (the step queue in `tools/osd-dialog-step.mjs`, released during `WAIT`; APC callbacks through `dialogStep`; `/osd/sql` and the shim's static server inside the step). This work starts after it is merged | 0 |
| 2 | PCP: `IF_AC_MESSAGE_TYPE_PCP`, `CL_AC_MESSAGE_TYPE_PCP`, the serialiser, tested against captured bytes | 1 |
| 3 | timers: `CL_ABAP_TIMER_MANAGER` and the host hook, first inside stateful APC sessions (no daemon needed to prove them) | 1 |
| 4 | AMC in one process: producer, consumer, `WAIT FOR MESSAGING CHANNELS`, the APC binding delivering to a socket, the `SAMC` reader | 1.5 |
| 5 | the daemon host (ABAP), the client manager, the Node driver (mailbox on the shared step queue, restart policy from P3/P4), the class-data guard (first proving it, as our own post-processing pass in `tools/osd-transpile.mjs`, never sent upstream; the accessor only as a prototype), the registry (D9) | 2 |
| 6 | the stable layer on Node: mailboxes and the AMC broker in the supervisor, IPC to the children, the pool, the swap phase in `recycle()`, the ack after commit and the message-ID dedup, restart from the registry | 2.5 |
| 7 | status list and `ps`; the demo, its page and `test/daemon.mjs` | 1.5 |
| 8 | OSGo: `DaemonStep` under `WorkProcess`, goroutine and channels, timers, the class-data check in gogen, restart from rows on process start; the same test file green | 1.5 |
| 9 | the preview, best effort as described | 1 |
| | **total** | **about 13.5** |

Steps 2 to 4 are useful without daemons: timers and AMC make stateful APC handlers that push on their
own possible. A stop after step 4 leaves nothing half-built. Steps 5 and 6
are where state outliving a call begins, and should start only after the
decisions below.

---

## Decisions

Alice decided all nine as recommended on 2026-09-24. The steps
start with step 2 (step 1 is #75), and the A4H probes P0 to P11 go
as one batch before anything relies on them.

| # | decision | decided (as recommended) |
| --- | --- | --- |
| D1 | Build ADF at all, or stop after AMC and timers (steps 1 to 4)? | build, in this order; stop after step 4 is a valid answer if daemons are not wanted now |
| D2 | What a generation swap does to a running daemon | option A: restart in the new generation from its start parameter, mailbox held and replayed with an ack after commit and a message-ID dedup. P10 decides which callbacks run, not whether the old load keeps running: if a system keeps the old load, we still restart, and record the divergence |
| D3 | Do queued messages survive a *process* restart (a crash, a Go swap without a dispatcher), i.e. is the mailbox also written to `ZOSD_DAEMON_MSG`? | no in the first version: the mailbox lives in the supervisor on Node, which survives a swap; a crash loses it, as a crashed server does. Revisit with the Go dispatcher |
| D4 | Daemon statics and where a daemon runs | model (b), the foreman's choice: in the host process and thread, under the same step lock, and class data read or written from a daemon step is a recorded runtime error (ANORMALIES, P9). A thread or process of its own only as an explicit opt-in, for daemons without database access, or later with SQL routed to the main connection. Not isolation by default, because the default database is in-memory sql.js, where a second connection is a separate copy, and a file has one holder |
| D5 | Restart daemons after a process or system restart | yes for a process restart (same path as the swap); after a whole-system restart, mirror P12, with a switch to restart anyway for local use |
| D6 | Where the ABAP lives | proposal: `oisee/open-abap-apc`, which exists (public, checked with `gh repo view` on 2026-09-24), already holds the APC half and the binding manager and is ours to merge; not open-abap-core. Nothing of this goes to the upstream repositories: they receive only fixes for differences from A4H, and ADF, AMC and the timer manager are new work |
| D7 | The preview | best effort as described: a daemon lives while a page keeps the worker alive, restarts from rows when the worker starts |
| D8 | Probes on A4H | ask once for the whole set P0 to P11 in one `$ZOSG_TMP` package, rather than one at a time |
| D9 | Keep the daemon registry `ZOSD_DAEMON` (and `ZOSD_DAEMON_ACK`) as a table, although it is authoritative state and not an index derived from files | the table, because `GET_DAEMON_INFO` is ABAP and a system keeps this state authoritatively too; the alternatives are supervisor memory only (lost on a crash and on every Go swap) or a host file under `.local/` |
