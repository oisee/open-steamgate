# Backlog

Everything open, as a tree, with who owns it and what it waits on.
Written 2026-09-13. `AGENDA.md` stays the narrative record of what was
decided and why; this is the list.

Owners: **S** open-steamgate (this session's repository), **T** the
transpiler session (`src/segw/**`, the ABAP generators, connectivity, APC),
**V** vsp (the Go bridge, the only thing that touches a real system),
**R** open-rfc-go (the RFC/CPIC transport and the ADT bridge),
**A** Alice — a decision nobody else can take.

---

# Where it stands, and what is next — 2026-09-17

OSD is a system a client cannot tell from one: Eclipse works over HTTPS and
over RFC, the demo runs on three machines and in a browser, content arrives
as packs fetched from repositories, and the runtime is measured against a
real system frame by frame. What is left is not "make it work" but "make it
answer the way a system answers", and two or three tracks that were never
started.

```
A — the ADT surface: what a client may ask
│   the client works today; the rest is coverage
├─ A.1  editor documents for FUGR, MSAG, DOMA, TTYP, VIEW, SHLP     open
├─ A.2  function groups and modules as create targets               open
├─ A.3  data preview beyond the freestyle door                      open
├─ A.4  the metadata bootstrap                                      DONE
├─ A.4b an RFC client that CALLs, not only describes                open
├─ A.5  session affinity across parallel RFC connections            open
├─ A.6  debugger endpoints                                          open
├─ A.7  ATC, refactorings, quick fixes, where-used                  open
├─ A.8  CTS                                                         open
├─ A.9  creating an object: the second dialog nobody reads          open
├─ A.10 what the client complains about while it works              open
├─ A.11 a service of several CDS views, no hand-written class       DONE 09-17
└─ A.12 SRVD + a minimal SRVB: the service definition as an input   next-ish

B — the runtime underneath: what the answers are made of
│   the track is done; these are the named gaps
├─ B.1  SADL beyond read-only, and beyond one table                 valuable
├─ B.2  BOPF / RAP / drafts                                         a track of its own
├─ B.3  OData V4                                                    a track of its own
├─ B.4  the RFC runtime, both directions                            open
├─ B.5  multi-record framing, measured against a long answer        open
├─ B.6  the client and MANDT story                                  first-order risk
├─ B.7  the database seam beyond three backends                     open
├─ B.8  SICF and SM59 as applications, the way SEGW is one          open
├─ B.9  a forced build mutates a generation under its name          open
├─ B.10 the base image named by the schema alone                    DONE 09-17
├─ B.11 the binary beyond the checkout (a system pack)              open
├─ B.12 work processes, and a channel that never waits              DONE 09-16
├─ B.13 a new SMW0 object never reaches an existing database        DONE 09-17
├─ B.14 a cast in a CDS view drops the field                        open, small
├─ B.15 does our pipeline read a view entity?                       open, one build
├─ B.16 the demo DPC ignores $orderby                               DONE 09-17
├─ B.17 the arithmetic protocol: 30 ns an operation, and who        measured,
│       fixes it                                                    ranked
└─ B.18 the release bundle runs 3.5x slower than the same build     measured,
                                                                    undiagnosed

C — the side quest: RFC in, DIAG out
├─ C.1-C.4  the oracle read, the stub that answers                  DONE
├─ C.5  one ticket, three doors: HTTP, RFC, DIAG                    open
└─ C.6  whether it goes further                                     a decision

D — the RFC gateway: every RFC-enabled module, exposed
│   the channel calls any module of the tree; no wire face yet
├─ D.1  a generic "call this module" endpoint                       DONE 09-17
├─ D.2  which modules are exposed, and finding them                 half done
├─ D.3  the signature -> metadata graph builder                     open, next
├─ D.4  the bridge becomes a generic RFC server                     open
├─ D.5  the SOAP-RFC facade, likely the easiest win                 open
└─ D.9  docs/adt-facade.md for abapGit #7880                        DONE 09-17

E — content packs and layers: what the tree is made of
├─ E.1  ordered source roots, duplicates refused                    DONE 09-16
├─ E.2  a pack is a directory, not a rebuild                        DONE 09-16
├─ E.3  what a pack may carry                                       open
├─ E.4  the Zork console does not fit its box                       open, small
├─ E.5  the launchpad asks for a config we do not serve             open, small
├─ E.6  a pack cut out of a system, with stubs on the perimeter     open
├─ E.7  the oracle's leftovers: Pages stops mid-show, profiling     open
├─ E.8  a DIAG stream as a demo                                     milestone 1 DONE
└─ E.9  a pack has a page of its own                                open

U — the user, and the thing itself
├─ U.1  the user's path, measured by a stranger                     DONE 09-17
└─ U.2  the status app on the browser deployment                    DONE 09-17

N — the no-regret set (docs/shift-right-and-quick-wins.md)
├─ N1  a real file-backed SQLite client                             DONE
├─ N2  the workbench-only entry point                               DONE
├─ N3  transpile as a library call                                  DONE 09-16
├─ N4  activation ordering                                          DONE (generations)
└─ N5  the black-box conformance suite                              DONE 09-17
```

**What is being worked on now:** N5, the conformance suite — the same
requests asked of a base URL rather than of an in-process app, so "our
tests pass" becomes "we answer the way a system answers". U.2, the status
app on the browser deployment, is done: there is no façade there, so the
worker says what it knows about itself and leaves the rest visibly empty.

**What I would take after those:** B.1 (SADL beyond one table — A.11 walked
half of that road already), B.6 (MANDT, the oldest first-order risk on the
list), D.3 (the signature -> metadata graph, now that D.1 has put a channel
under it), then A.12 (SRVD, the native shape of a service definition).

> The numbered sections below ("The standing list", 0 to 8) are the older
> plan and stay as history; the tree above is the current one.
> [`plan-spikes-and-sprints.md`](plan-spikes-and-sprints.md) lays the
> sprints out, [`shift-right-and-quick-wins.md`](shift-right-and-quick-wins.md)
> has the value-against-cost table, and
> [`generations.md`](generations.md) is the mechanism that absorbed N4.

---

## Track A — ADT coverage surface

*Make more of what a real client asks answerable. The measure is not a count of
endpoints: it is how far an ordinary session gets before something 404s.*

The catch-all under the façade already records every unanswered path by method
(`Refusals`, `adt-surface.md`), so **the worklist writes itself** — run a
client, read what it asked for and did not get. That is the method for this
whole track; everything below is what it has produced so far.

```
A.1  Editor documents for the object types that have none                [S]
     ├─ FUGR, MSAG, DOMA, TTYP, VIEW, SHLP — each has its own editor format
     ├─ the object is already in the tree and in the search; opening it 404s
     ├─ test/zosd-test.mjs lists exactly which
     └─ order by what a client opens first, not alphabetically

A.2  Function groups and modules as create targets                       [S]
     └─ a group is a folder of includes with a header of its own
     └─ blocked on nothing; nothing has asked for one yet

A.3  Data preview                                                        [S]
     ├─ seen live 2026-09-15: Eclipse says "Data Preview is not supported
     │  in this system" on a CDS view served by us; A4H answers it
     ├─ /sap/bc/adt/datapreview/ddic?… and /datapreview/ddic/<T>/metadata
     └─ the SADL runtime already does the query half; this is the wrapper

A.4  The metadata bootstrap, proven live                            [R] DONE
     ├─ was: implemented and shape-verified offline, never run live, because
     │  the Eclipse that tested it had the answers cached
     ├─ done 2026-09-16 by pointing a plain RFC client (the `rfc` CLI in
     │  open-rfc-go) at the bridge: `rfc describe SADT_REST_RFC_ENDPOINT`
     │  returns the interface with both parameters typed
     ├─ it found a defect on the way: the gateway header's communication and
     │  connection index were constant. Eclipse never looks, an RFC client
     │  does, and refused every reply. A reply carries communication index
     │  zero and the connection index the call came in on — echoing the
     │  request's 0xffff "unset" is equally wrong
     ├─ and a gap: an RFC client resolves structures with RFC_METADATA_GET
     │  then RFC_GET_STRUCTURE_DEFINITION, not DDIF_FIELDINFO_GET. The
     │  latter is now answered from the same dictionary
     └─ STILL OPEN, and still shared with C.3: whether a client accepts
        uncompressed 0303 rows for a LARGE table. Both tables exercised so
        far are small enough that the system sends them uncompressed too

A.4b An RFC client that can CALL it, not only describe it                [R]
     ├─ `rfc call SADT_REST_RFC_ENDPOINT` stops in the client's own classic
     │  structure codec: "classic RFC type v is not implemented"
     ├─ this function's parameters are recursive and travel as BASXML; the
     │  client has that codec (internal/xrfc) but `rfc call` does not use it
     └─ the bridge is not in the way — this is client work, and it would make
        the bridge drivable from a script as well as from Eclipse

A.5  Stateful session affinity across parallel connections               [R]
     ├─ Eclipse opens many RFC connections at once; each gets its own cookie
     │  jar and CSRF token today, which is correct for isolation and wrong
     │  for a lock/write/activate that must land in one ADT context
     ├─ the real client carries sap-adt-connection-id; we do not use it
     └─ needed before writes-over-RFC are trustworthy, not before reads

A.6  Debugger endpoints                                                  [S]
     ├─ debugger/listeners is a long poll and the second most frequent call
     │  in a real session; breakpoints is a POST
     └─ answering them emptily is most of the value: it stops the client
        retrying, and debugging can stay unimplemented for a long time

A.7  ATC, refactorings, quick fixes, where-used                          [S]
     └─ not started, not blocking; listed so a 404 reads as a plan

A.10 What the client complains about while it works                      [S]
     Free findings: with CDS data preview and the package tree working
     (2026-09-16), Eclipse's own Workspace Log still carries three OSD
     complaints. None of them stops anything today; each is a thing the
     client wanted and did not get.
     ├─ "Couldn't get URI from discovery for CDS Annotation ADT Resource",
     │  repeated on every CDS editor open. A4H answers
     │  /sap/bc/adt/ddic/cds/annotation/definitions with 188 KB of CDATA —
     │  the annotation grammar, which is what feeds code completion and the
     │  syntax colouring of @-annotations in the DDL editor. We answer 404.
     │  Note before copying: that document is SAP's own content, so it is
     │  not ours to bundle (clean-room, CLAUDE.md). What we can serve is the
     │  annotations our own runtime understands, which is a smaller and
     │  honest document
     ├─ "Properties file content do not contain an entity tag for the source
     │  file" (determineEtagForSourceFile), on every source open. Our
     │  source-properties document carries no ETag at all
     │  (tools/adt-source-properties.mjs); the source response does. Cheap,
     │  and it is the value the client wants to send back on a save
     └─ "An exception occurred invoking extension
        com.sap.adt.semanticfs.packageContent" for the project object, with
        "Unhandled event loop exception" beside it. Unread; the semantic
        filesystem asks for package content in a shape we have not measured

A.9  Creating an object: two dialogs, and only one of them is read   [S]
     There are two, and they fail differently — worth keeping apart,
     because conflating them cost a wrong conclusion once already.
     ├─ the GENERIC wizard, "New ABAP Repository Object", still says "No
     │  authorization to create objects in the system" and asks us
     │  NOTHING: no request reaches the façade when it opens, and there is
     │  no authorization check anywhere in what Eclipse sends a real
     │  system either. So it decides from what it holds, and what that is
     │  has not been found yet. Unfinished.
     └─ the TYPE-SPECIFIC dialogs — New ABAP Class, and Copy ABAP Class
        from the object's own menu — open fine and get as far as the name
        check. That is where the measurement below comes from.
     Measured 2026-09-16 with STG_ADT_DUMP:
     ├─ A.9a POST /sap/bc/adt/oo/validation/objectname                   [S]
     │  ├─ 404 here, and it is what the dialog reports. The client asks
     │  │  before it will enable Finish, with objname, packagename,
     │  │  description and objtype=CLAS/OC in the query and nothing in the
     │  │  body. The same call gates Copy ABAP Class
     │  └─ the answer is a short document saying whether the name is free
     │     and legal; the store already knows both (exists(), and the name
     │     rules it enforces on create). Small, and it unblocks create
     ├─ A.9b Save failed: "Cannot invoke java.util.Map.get(Object)
     │  because exceptionProperties is null"                             [S]
     │  ├─ a client NPE, not a message from us: it is reading the
     │  │  properties of an exception document and finding none. Saving an
     │  │  include reproduced it
     │  └─ our exceptionDocument writes <properties/> empty; A4H's carries
     │     entries. Compare against the corpus before guessing which
     ├─ A.9c "Loading outline failed" on an interface                    [S]
     │  ├─ "Index 0 out of bounds for length 0" in
     │  │  AdtStructuralInfoService.mergeOutlineContentWithRndBasedOutline
     │  ├─ the client merges OUR objectstructure with ITS own parse of the
     │  │  source, and one of the two came back empty. A class outline
     │  │  works, so it is the interface shape
     │  └─ not in the dump yet: the failing project reaches us over RFC.
     │     Re-run with the dump on that project
     └─ A.9d two more misses from the same session                       [S]
        ├─ GET /sap/bc/adt/functions/groups/<name> — the FUGR editor, A.1
        └─ GET /sap/bc/adt/oo/classes/<name>/includes/localtypes — a class
           include we do not carry. A real class has all four includes
           whether or not they have content

A.8  CTS                                                                 [S]
     └─ deliberately absent: there is no transport system here, and the
        boundary to a real system is an abapGit archive from a git ref
```

---

## Track B — the runtime underneath

*Deepen what the answers are made of: OData, SADL, RFC, and the database seam.*

```
B.1  SADL beyond read-only                                               [S]
     ├─ today: CDS projections, an analytics cube, $select -> GROUP BY,
     │  and writes only on a projection of exactly one table
     └─ next: associations in a projection, and a write path that is not
        the single-table special case

B.2  BOPF / RAP / drafts                                                 [S]
     ├─ still out, as stated on day one
     ├─ oracles planned but not built: docs/oracle-rap.md, oracle-draft.md
     └─ gated on 0.4 / 0.5 (Alice: build sample objects on the sandbox?)

B.3  OData v4                                                            [S]
     └─ the serializer is v2; v4 is a second shape over the same model, and
        nothing in the dispatcher assumes v2 except the JSON writer

B.4  The RFC runtime, both directions                                    [R]
     ├─ today: destinations resolve local / replay / live / record / fallback
     ├─ the bridge is an RFC *server* for exactly one function module
     └─ next: serve more than SADT_REST_RFC_ENDPOINT, so a real RFC client
        (SM59 test, an external caller) reaches a transpiled function module

B.5  Multi-record framing, properly measured                             [R]
     ├─ splitting works and a 606 KB answer was accepted in two records
     └─ but the operation-info length on a *continued* record is inferred
        from single-record captures; capture a real long answer and check

B.6  The client/MANDT story                                             [S+T]
     └─ unchanged and still first-order: fixed client 123, no implicit
        MANDT (ANORMALIES.md). The demo keeps T0009 visible on purpose

B.8  SICF and SM59 as applications, the way SEGW is one                  [S]
     ├─ Alice, 2026-09-16: a SICF editor over the *.sicf.xml / *.sapc.xml the
     │  tree carries (tools/osd-icf.mjs already lists and mounts them), the
     │  way src/segw is SEGW as an application over its own tables
     ├─ a node may point at an ABAP handler (if_http_extension, served by the
     │  child through the shim, as today) OR at a JS — later maybe Go —
     │  implementation: the door (POST /osd/sql) is already a node answered
     │  by JS, so the shape exists; missing is declaring it in a *.sicf.xml
     │  and an editor over the set
     └─ SM59 in the same manner later: destinations as objects with an
        editor, over the .local/rfc-destinations.json the RFC runtime reads
        (local / replay / live / record / fallback); track D's gateway makes
        the outbound half real

B.9  A forced build mutates a generation under its name                 [S]
     ├─ Astra, 2026-09-16: `--force` replaces the directory build/by-input/<hash>
     │  holds, so a consumer pinned to that name sees changed content under
     │  an unchanged name, which is what immutability was for
     ├─ since 2026-09-16 the swap is two renames (no moment without a live
     │  generation), and the rule that decides the output is part of the
     │  hash, so a forced build differs from the cached one only when the
     │  transpiler or the builder changed under the same inputs
     └─ still to do: a forced build should check reproducibility (build,
        compare, report) or publish under a name of its own, never both
        keep the name and change the bytes

B.10 The base image is named by the schema alone                  [S]  DONE 2026-09-17
     ├─ Astra, 2026-09-16: .local/db/base/<schema-hash>.sqlite; a change to
     │  the seed rows (data/*.tabu.json) or to the seeding rules with the
     │  same DDIC keeps the name, so a new instance copies old rows
     └─ the identity is schema + seed data + the loader that applies them;
        a persistent user database is never reseeded by this, only the
        image a new database is copied from
     └─ DONE 2026-09-17 with B.13: the image is named by the schema and
        the rows that went into it, and the tables the generation writes
        at start (tadir, wwwparams, t100) are rewritten from the
        generation on every boot over an existing file

B.12 One work process, and a channel that never waits                    [S]  pool DONE 2026-09-16
     ├─ tools/osd-pool.mjs: OSD_WORKERS children, a push channel pinned to
     │  one for the life of its socket, HTTP on the primary. Deployed to
     │  the second machine with four: over the network 111 frames/s on one
     │  socket, 369 on four, three processes busy at once instead of one
     │  core at 100 %. Nothing in the ABAP or the page changed. Still open
     │  below: HTTP across workers (needs a decision about what a session
     │  is), and the page's missing back-pressure, which is the demo's
     ├─ measured 2026-09-16 on a 16-core machine: one core at 100 %, the
     │  other fifteen at 1 %, load average 1.04. The serving runtime is one
     │  process with one JavaScript thread, so every session's ABAP runs on
     │  the same core — that is one dialog work process, not a pool
     ├─ a frame costs 0.7 ms direct and 1.3 ms through the façade on an idle
     │  server; with a second session playing the demo it is 55 ms at the
     │  median. The cost is contention, not the ABAP
     ├─ and the demo's page never waits: it fires a frame request every
     │  24.6 ms and draws whatever comes back. Over a slow link 247 requests
     │  produced 43 drawn frames and 205 outstanding, replies 4 s behind —
     │  which is why an effect plays slowly and the next one rushes. Two
     │  independent defects: no back-pressure in the page, one core here
     ├─ the client's fan-out buys nothing, which is the proof: the demo's
     │  PRELOAD pulls frames on four sockets at once, and the server stays
     │  at one core (109 % of one, the rest of sixteen idle). Measured on an
     │  idle server here: 474 frames/s on one socket, 599 on two, 491 on
     │  four — flat, and four sockets are slightly worse than one. Four
     │  throats, one work process
     ├─ the pool: the supervisor already owns process lifecycle (recycle,
     │  reap, registry), so N children with sessions pinned to one of them
     │  is the shape — SAP's dispatcher and its dialog work processes, and
     │  what makes APC and the ABAP Daemon Framework scale on a real system
     └─ for this demo specifically a frame is a pure function of (demo,
        tick) through the JSON path, so the per-session state that matters
        is small (which demo, running or not) and frames are cacheable by
        key — the page already has a CACHED mode

B.11 The binary beyond the checkout                                      [S]
     ├─ measured on a second machine 2026-09-16 (bun-spike.md part five):
     │  the Bun binary needs nothing; the Node hosts need a closure of four
     │  packages beside the workspace, because generated code imports the
     │  runtime by name and setup.mjs imports the database adapter, and
     │  neither is bundled outside Bun. scripts/make-release.mjs assembles
     │  a directory that works for all of them
     ├─ what still travels beside any host: src/, webapp/, data/ and the
     │  setup hook — OSD's own content, which wants to be a pack of its own
     ├─ SP4 (bun-spike.md part three) runs the workbench from one binary
     │  with the checkout as its workspace; a directory with only ABAP in
     │  it needs src/, webapp/, data/ and test/setup.mjs brought along —
     │  that is E.2, and the boundary is recorded rather than tested around
     ├─ not measured: other platforms (each needs a native run), APC over
     │  the binary, TLS, the preview build; the parent's 500 MB RSS is the
     │  store's parse plus the bundle and wants a look
     └─ `osd doctor` lists runtime classes the bundle renamed; a bundler
        change that renames another one shows up there first

B.7  Database seam                                                       [S]
     └─ SQLite, DuckDB and sql.js today; a third needs no change elsewhere
        (docs/db-backends.md). bun:sqlite is 1.1, gated on 0.1
```

---

## Track C — the side quest: RFC in, DIAG out

*Answer SAP GUI on the dispatcher port with a screen. Start by showing one
picture and nothing else.*

The point is not to implement DIAG. It is that this project already speaks the
gateway half of a system's front door, and the other half — the one SAP GUI
knocks on — is a protocol we can already *read*. Answering it at all, even with
one static screen that says the guru meditates, turns "an OData runtime with an
ADT façade" into "something a SAP client connects to", and tells us exactly how
big the real thing would be.

**What the oracle says.** A SAP GUI logon against a sandbox was captured
through a passive tap (40 frames, dispatcher port 3200, kept under `.local/`,
never here):

- the conversation is **NI-framed**, like RFC, and opens with the same
  `ffffffff` route request;
- **30 of 37 payload frames are SAP-LZH compressed** — the `1f 9d` magic with
  algorithm byte `0x12`, the same container `pkg/sapcompress` in vsp already
  decodes;
- the handshake frames that are *not* compressed carry readable items: the
  codepage (`4110`, `utf-8`), the protocol level (`4103`), a session id.

```
C.1  Decide the smallest honest goal                                     [A]
     ├─ proposal: SAP GUI connects, gets a logon screen or a single dynpro
     │  carrying one message, and stays connected long enough to read it
     └─ non-goal, explicitly: a usable GUI, transactions, or input handling

C.2  Read the oracle properly                                       [R] DONE
     ├─ done 2026-09-16: docs/diag-notes.md. Frame = 8-byte header + body,
     │  body optionally SAP-LZH (flag in the header; setup frames are
     │  UNCOMPRESSED, so a stub needs no writer). Items are (type, id, sid,
     │  len, value); 0x10 APPL / 0x12 APPL4 / 0x0c end. The screen chrome
     │  (title, menu, geometry, session/status) is mapped
     ├─ the SAPGUI capability shipped (9d232e5) made SAP GUI actually connect:
     │  it sends an NI route request carrying _NAVIGATION=…;D_WB_ACTION=EXECUTE
     │  and waits for a screen. diag-catch records it and never replies
     └─ ONE unknown left: the DYNT/DYNT_ATOM field-item layout, the text
        *in* a screen. That is the gap between reading a screen and writing
        one, and it is what C.4 needs

C.3  The LZH *writer* question                                     [A] ANSWERED
     └─ answered by the measurement in C.2: a DIAG setup frame is sent
        UNCOMPRESSED (the header's compress flag is zero), so a stub needs
        no LZH writer at all. The writer stays a want for parity with a real
        system's traffic, not a blocker for C.4

C.4  A dispatcher listener that says one thing                     [R] DONE
     ├─ done 2026-09-16, and not the way it was sized: nothing had to be
     │  measured. open-diag-go's lsd already is a self-contained DIAG server
     │  with an embedded, scrubbed wrapper and a screen writer; one flag,
     │  -stub guru|spectrum, makes it answer every frame with one still
     │  screen and end cleanly on close (branch osd-stub there)
     ├─ measured with Eclipse: F8 on ZOSD_TEST_DEMO_PROG hands SAP GUI to
     │  :3201 with a reentrance ticket in the hello, and the guru is painted.
     │  Three client frames, each answered with the same screen
     ├─ the local lab: façade :3030, bridge :3301, stub :3201, one instance
     │  (01) on one WSL address; the Eclipse project is Custom Application
     │  Server with that host and instance
     └─ docs/diag-notes.md: the stub as built, and what the hello carries

C.5  One ticket, three doors: SSO across HTTP, RFC and DIAG               [S+R]
     ├─ measured: the GUI logs on by cookie (<LOGIN COOKIE=…/> in the hello),
     │  RFC has a credential tag for a ticket (0x0670, open-rfc-go writes it),
     │  HTTP takes it as a cookie. Every door exists; no authority does
     ├─ the façade mints a signed claim (user, client, issued, nonce; HMAC,
     │  60 s, single use) instead of 24 random bytes; the stub, the bridge
     │  and the HTTP middleware verify with the shared secret, offline
     ├─ then the bridge checks a logon for the first time, the stub knows
     │  who pressed F8, and a page on the façade can jump into SAP GUI the
     │  way Eclipse does
     └─ docs/diag-notes.md, "SSO across the three doors"; about a session-day

C.6  Then, and only then, decide whether it goes further                 [A]
     └─ a real DIAG server is a large thing; this track is allowed to stop
        at C.4 having proved the point
```

---

## Track D — the RFC gateway: expose every RFC-enabled function module

*The ADT bridge terminates RFC for one function module. Make it a real gateway
for all of them: an external RFC client calls any exposed function module of
this project as if it were RFC-enabled, and gets a typed answer.*

Added 2026-09-16 (Alice). The point is that the door is already open — the
bridge is an RFC server, it already answers RFC_GET_FUNCTION_INTERFACE and
carries typed parameters, and its DefaultDispatcher already has a working
STFC_CONNECTION handler, which is exactly "call a function module over RFC and
get a typed answer". What is hardcoded to the one ADT function becomes generic.

What already exists, and is why this is a track and not a project:
 - OSD transpiles and runs function modules today (FUNCTION z_osd_test_status_text
   in src/zosd_test/, a FUNCTION-POOL that runs).
 - the fugr importer already reads a module's signature from a *.fugr.xml
   (zcl_stg_segw_fugr, tools/segw-gen-mapping.mjs, ZSTG_FM_PARAM).
 - the bridge has both metadata halves (RFC_GET_FUNCTION_INTERFACE / DDIF /
   RFC_GET_STRUCTURE_DEFINITION answered) and the codecs that encode arbitrary
   typed values (internal/xrfc, internal/classicrfc, internal/structure) — all
   currently driven by one hand-built graph (ADTRestGraph).

The one genuinely new piece: a **signature → metadata graph** builder. Every
handler today is fed a graph made by hand; a generic gateway builds that graph
from the module's real signature (its parameters and their DDIC types). That is
the meat of the track; everything else is wiring what exists.

```
D.1  A generic "call this module" endpoint in OSD             DONE 2026-09-17
     ├─ ICF service ZOSD_RFC at /sap/bc/osd/rfc/: GET /functions,
     │  GET /functions/<NAME>, POST /call/<NAME> {IMPORTING, CHANGING,
     │  TABLES} -> {EXPORTING, CHANGING, TABLES} or {EXCEPTION}, all JSON
     ├─ tools/osd-fm-registry.mjs reads the *.fugr.xml the way
     │  segw-registry.mjs reads *.iwsv.xml, and writes gen/rfc/: the
     │  registry (TFDIR/ENLFDIR of this tree, with the signature) and the
     │  typed dispatcher — generated because the transpiler resolves a CALL
     │  FUNCTION's parameter list at transpile time and has no
     │  PARAMETER-TABLE
     ├─ the gate: no REMOTE_CALL = 'R', no call, twice over — the channel
     │  refuses with 403 and the dispatcher has no method for it
     ├─ an exception is a field of a 200, not an HTTP error: the call
     │  reached the module and the conversation is intact, which is what an
     │  RFC client is told; only a system failure is a broken call
     ├─ src/rfc/ (channel + if_http_extension + the SICF node),
     │  test/osd-rfc.mjs, test/unit/zcl_osd_rfc_test, docs/rfc-channel.md
     └─ NOT in it: the RFC wire, the SOAP envelope, authentication, and
        calling out through the same channel

D.2  Which modules are exposed, and finding them             half done 09-17
     ├─ DONE: the registry is derived from the *.fugr.xml of the content
     │  folders, and GET /functions is the catalogue — every module with its
     │  group, its remote flag, whether the tree implements it, whether it is
     │  exposed, and the reason when it is not
     ├─ open: RFC_FUNCTION_SEARCH answered from it (a name mask -> the
     │  matches), so SE37's remote test, an SDK, or another system's CALL
     │  FUNCTION … DESTINATION can discover them
     └─ open: mode c) Alice named: a switch that drops the remote-enabled
        gate and exposes ANY transpiled module — a regeneration with a flag,
        since the dispatcher is generated from the same list

D.3  The signature -> metadata graph builder                            [R]
     ├─ the one new thing: build the bridge's type graph from a module's real
     │  parameters and their DDIC types, the way ADTRestGraph is built by hand
     │  for the one function today
     ├─ feeds the generic metadata handlers (RFC_GET_FUNCTION_INTERFACE, DDIF,
     │  RFC_GET_STRUCTURE_DEFINITION) so they answer for ANY module
     └─ and feeds the codecs, so import params decode and exports encode

D.4  The bridge becomes a generic RFC server                            [R]
     ├─ one handler for any unknown FM name: look up the signature (D.3),
     │  decode the imports, call OSD (D.1), encode the exports
     ├─ STFC_CONNECTION and RFC_PING already work; this generalises them
     └─ result: `rfc call <ANY_FM>` through the bridge reaches a transpiled
        module. A4.b's "rfc call needs the recursive codec" is the same client
        gap and is shared

D.5  mode b) the SOAP-RFC facade — likely the easiest first win        [S]
     ├─ /sap/bc/soap/rfc: a SOAP envelope naming the module and its params ->
     │  the result, HTTP-only, no RFC transport and no bridge in the path
     ├─ reuses D.1 directly; provable with curl; the classic way any
     │  RFC-enabled module is also a web service
     └─ a good place to START the track: it exercises D.1 + D.3 without the
        RFC framing, so the marshalling is proven before the transport is

Smallest first win: taken, 2026-09-17. D.1 is done over z_osd_test_status_text
and a second demo module written for it (z_osd_test_item_list: an optional
import, a scalar export, a TABLES parameter and a classic exception), reachable
by curl. D.3/D.4 put it on RFC, where `rfc call` and SE37 reach it. The three
modes Alice named map to: a) = D.4 (full RFC gate), b) = D.5 (SOAP-RFC),
c) = the switch in D.2.

What D.1 measured, and what the two faces still need: both need DDIC *types*
rather than type names — internal length, decimals, output length, the line
type of a table type as a structure — which is what D.3 builds and neither the
registry nor JSON needs. Both also need authentication (S_RFC per function
group) and a third state between success and exception, namely SYSTEM_FAILURE.
docs/rfc-channel.md has that list in full.

Recommendation: D.3 next, then D.5 on top of it. D.5 needs no transport work
at all and would then be a second envelope in front of a proven core.
```

---

## Track E — content packs and layers: what the tree is made of

*Objects come from more than one folder, and today the first one the disk
walk reaches wins, silently. Make the layering explicit, and make a pack
something you add without a rebuild.*

Added 2026-09-16 (Alice), to give the split document's piece E a track of
its own; the letters of the two lists agree from here on.

```
E.1  Ordered source roots, and a duplicate that does not keep quiet     [S]  DONE 2026-09-16
     ├─ one list, one order: the input_folder of abap_transpile.json is the
     │  layer order for the store and the builder alike, and the LATER
     │  folder wins, as 1.5 says (tools/osd-inputs.mjs `layers`,
     │  tools/osd-store.mjs `rootsOf`). Measured before deciding: the
     │  transpiler on its own writes the later folder's module last, while
     │  abaplint's registry in memory files the first and calls the second
     │  "already defined" — so the winner is decided here and not left to
     │  either. A library is not a layer: it fills only what no root has
     ├─ the builder hands the transpiler the winner only: every file of a
     │  hidden object goes into the build's exclude_filter, the manifest
     │  lists `overridden`, the log says "overridden: CLAS X: <file> hidden
     │  by local/used". Proven with the real transpiler over a two-layer
     │  tree: the winner's method in output, the loser's absent
     ├─ the same file name twice inside one folder is refused before a lock
     │  is taken, both files named (code DUPLICATE; test/osd-build.mjs)
     ├─ local/ is no longer one root: only listed folders are the system, so
     │  677 objects of local/abapgit, local/cpm, local/vivid-vibes left the
     │  ADT tree, which no build ever had. An import now appends its folder
     │  to the list (`Import#enlist`), the newest layer
     └─ `node tools/osd-inputs.mjs` prints overrides, duplicates and shadows

E.2  A pack is a directory, not a rebuild                                [S]  DONE 2026-09-16
     ├─ a pack is a directory with an osd-pack.json in it: ABAP (src/ by
     │  default), seed rows (data/), table definitions (src/ddic), a page
     │  (webapp/), a name and an order. tools/osd-packs.mjs is the only
     │  place that knows this, and everything else asks it
     ├─ found in <root>/packs/ and in every directory OSD_PACKS names (a
     │  pack itself or a container of them); layered after the folders
     │  abap_transpile.json lists, so a pack wins a name it shares and the
     │  build reports the override with both files (E.1)
     ├─ what a pack brings: its ABAP to the transpile and to the ADT tree
     │  as a package of its own ($VIBES, not $SRC), its rows to the seed,
     │  its tables to the DDIC lookup, its page to /app/<name>
     ├─ proven with the compiled binary: build/osd built before the pack
     │  existed serves its class through ADT, its rows through the door and
     │  its page over HTTP, with nothing rebuilt but the generation
     ├─ found on the way and fixed: a generator that read every layer
     │  picked up a CDS fixture under test/ and failed the build, so
     │  generators read content (src + packs), not layers; and cds2ddic now
     │  removes what it no longer generates, because a pack taken away left
     │  its table accessor behind and the next build failed on a table that
     │  did not exist
     └─ a pack that adds generated objects settles on the second build: the
        hash is taken before the generators run and gen/ is an input. The
        dev loop does that second build by itself

E.5  The launchpad sandbox asks for a config we do not serve             [S]
     ├─ Alice, 2026-09-16, from the browser console on the second machine:
     │  GET /appconfig/fioriSandboxConfig.json answers 404 on every open,
     │  red in the console and harmless — the ushell sandbox looks for its
     │  own file before it takes window["sap-ushell-config"]
     └─ answer it with {} from test/start.mjs, or set the sandbox's config
        URL to something we serve; either stops the noise without a change
        to flp.html

E.4  The Zork console does not fit its box                               [S]
     ├─ Alice, 2026-09-16, from the launchpad tile: a long line runs past
     │  the right edge of the terminal frame instead of wrapping inside it,
     │  and the block cursor sits on its own line
     └─ the page is written by ZCL_ZORK_HTTP_HANDLER (a pack now); the
        wrapping is the page's, not the Z-machine's

E.3  What a pack may carry                                               [S]
     └─ ABAP and DDIC (today), SEGW projects and CDS (today, through the
        generators), a Fiori app under webapp/ (2.10: a UI5/BSP object type
        so a client can deploy one), SICF and APC declarations (B.8)
     └─ a folder fetched from a repository at a commit, with an overlay
        (sources in the manifest, tools/osd-fetch.mjs) — DONE 2026-09-17;
        packs/o4d and packs/zork are the worked examples and the public
        preview builds from them

E.7  The oracle's leftovers (docs/frame-comparison.md, 2026-09-17)      [S]
     └─ Pages: the demo stops in the middle of plasma while the same
        build on the i7 plays the whole demo; the worker is one thread
        and plasma is 641 rectangles a frame — measure whether it is the
        page's back-pressure (B.12) or a worker error the page swallows
     └─ where the transpiled ABAP is slow: some effects run far below
        the system's speed on one core; profile a frame of plasma,
        julia_morph and the 4D cells in the runtime (node --cpu-prof on
        the serving child) before reaching for fast-math; the suspects
        are Float allocation per operator and the string templates that
        build every colour
     └─ sorted triangles: amiga_ball, amiga_ball_2, sierpinski sort by z
        without a second key, so equal depths paint in an order the sort
        chooses; the demo needs a tie-break key (a PR to vivid-vibes),
        and the runtime's SORT should be checked for stability against
        the kernel's on a table with many equal keys
     └─ ignition's seed chain and one line of copperbars: not traced
     └─ one worker against eight on a problem scene with the APC session
        pinned, to separate arithmetic and table order from state
        distribution (Astra)
     └─ 2026-09-17, later: with the console fix the browser demo reaches
        the frame before rotozoom (Alice); the stop moved, the cause is
        still unmeasured
     └─ work processes in the browser too (Alice): several workers
        behind the service worker, one runtime each, and a page that
        pulls frames over several sockets and interleaves them — the
        B.12 pool, in a browser. Idea only.

D.9  docs/adt-facade.md, the version #7880 links to               [S]  DONE 2026-09-17
     └─ Astra's docs/adt-facade-proposed.md (uncommitted, 2026-09-17) is
        the top half of the next version: the role for the abapGit
        roadmap, the object-type matrix, activation as it is now (the
        original still says fire-and-forget). Before it goes in: DOMA/TTYP
        rows say "no ADT route", persistence names STG_DB=file, the
        RFC bridge points at docs/adt-over-rfc.md, the DIAG sentence
        shrinks to the stub, the review scaffolding goes, the "Do not"
        cadence softens; and the client contract of the original stays
        below it (403/405, encoded names, in-the-tree vs runnable,
        STG_DB_STRICT, unit-run alerts, the shim's pseudo-headers).
        DONE 2026-09-17 evening: merged with the seven corrections, the
        client contract kept below; 696 -> 542 lines, leak scan clean.
        The draft file stays untracked until Astra drops it.

B.13 A new SMW0 object never reaches an existing database file    [S]  DONE 2026-09-17
     └─ found 2026-09-17 with the lsd pack: with STG_DB=file the rows of
        wwwparams are seeded when the file is created, so an object added
        to a pack later (ZLSD-MUSIC) is in the generation and not in the
        table, WWWDATA_IMPORT finds no parameters, and the page answers
        404 while a fresh database serves it. The seed (or the schema
        fingerprint) has to notice a generation's W3MI set changing, or
        the media rows should be read from the generation rather than
        from the table. Until then: delete the file (or use another
        STG_DB_PATH) after adding media to a pack.

U.1  The user's path, measured                                      [S]  DONE 2026-09-17
     └─ a fresh agent with only docs/using-osd.md brought a pack (a YAML
        service over its own table with seed rows, a CDS view with
        @OData.publish), served it on another port, changed a line,
        broke the syntax on purpose: 12 minutes, both services answered.
        What tripped, and what changed for it: the guide now names
        STG_PORT and STG_DB_PATH, says how a running server picks up a
        build (it does not: npm run dev recycles, npm start restarts),
        shows where the file shapes come from and the CDS service's
        naming (<VIEW>_CDS, <View>Set, upper-case properties), and
        reads a failed build's line; stg-compile --all now removes a
        gen/stg project folder no YAML declares (the pack's service kept
        being registered after the pack was gone). Report under
        .local/try/user-path-report.md. Left: the error text for a
        missing period points at the next statement (abaplint's wording);
        the failed line sits among the generators' output.

A.12 SRVD and a minimal SRVB: the service definition as an input       [S+A]
     └─ Alice asked 2026-09-17 whether to take CAP-like syntax; the
        answer is that ABAP already has it and it is native:
        `define service N { expose E as A; }` in a SRVD, with a SRVB
        saying V2 or V4. CAP is a Node/Java runtime with its own
        persistence and handlers - reimplementing it would add an
        application model no SAP system runs, against the rule that the
        same ABAP runs in a system's ICF
     └─ the work: parse the SRVD ourselves in a generator (the way
        cds2ddic reads DDLS), emit the YAML model, let stg-compile make
        the classes; read-only over OData V2, which is what our gateway
        serves. Roughly a day, almost all reuse
     └─ two rocks: the transpiler refuses object type SRVD
        (ANOMALY-2026-09-15-srvd-not-allowed, needs an issue) - the
        generator reads src/ itself, so the object only has to be kept
        out of the transpile input; and V4 naming is unmeasured, V4 is a
        track of its own
     └─ not in scope: BDEF, behaviour implementations, drafts, actions,
        EML - the write side of RAP is its own track
     └─ @OData.publish is the older path (the sandbox warns that
        DDIC-based CDS views are obsolete), so this is the one that
        stays

A.11 A service of several CDS views, without a hand-written class [S+A] DONE 2026-09-17
     └─ today: @OData.publish gives one view one service and no
        navigation (publishedYaml() in tools/cds2ddic.mjs never emits an
        association, though the parser reads them); several CDS entities
        with navigation need either a hand-written MPC carrying the
        exposure XML (src/demo_sadl, as ZSTG_SADL_SRV does) or a
        stg.yaml that declares the navigation (as ZOSD_STATUS_SRV does)
     └─ the shape ABAP gives this is a service definition (SRVD): "these
        views, this service"; the transpiler refuses SRVD objects
        (ANOMALY-2026-09-15-srvd-not-allowed), so the near-term move is
        ours: carry the exposed associations from the parser into the
        generated YAML, and let a marker (a second annotation, or an
        SRVD-shaped file we read ourselves) say which views make one
        service
     └─ measured on the sandbox 2026-09-17 (docs/cds-publish.md): the
        annotation there generates IWSV + IWMO + IWVB and still needs the
        hub to publish; ours serves immediately
     └─ DONE 2026-09-17: publishedYaml() walks the exposed associations
        breadth first with a cycle guard and emits one entity per reached
        view plus the associations; names follow the system
        (<VIEW>Type, <VIEW>, to_<alias>, assoc_<32 hex>, the last one a
        sha256 slice rather than a fresh GUID so a build stays
        reproducible). ZC_STG_TRAVEL_CDS now serves ZC_STG_TRAVEL and
        ZC_STG_BOOKING with to_Bookings and to_Travel both ways
     └─ **and the specification is now measured, not guessed**: one
        published view pulls every view its exposed associations reach
        into the same service. Entity set = the view's name as it is
        (no Set suffix), entity type <VIEW>Type, container
        <SERVICE>_Entities, navigation `_Items` -> `to_Items`,
        association `assoc_<32 hex>` with FromRole_/ToRole_, read-only
        flags on the set, labels from the data elements. $expand and the
        navigation URL both work. So no SRVD is needed for this case:
        the work is to carry the parser's exposed associations into
        publishedYaml() and add the reached views as entities of the
        same service. Note it changes existing services (ZC_STG_TRAVEL_CDS
        would gain the booking entity and to_Bookings), so it is a
        decision, not only a patch

B.16 The demo DPC ignores $orderby                          [S]  DONE 09-17
     └─ found 2026-09-17 writing the conformance suite: a hand-written
        `_DPC_EXT` gets the ordering in `io_tech_request_context` and
        `zcl_zstg_demo_dpc_ext` never applies it, so
        `TravelSet?$orderby=TravelId desc` comes back ascending. The
        SADL and CDS paths do order. Either the demo DPC applies it or
        the dispatcher sorts what a DPC hands back when the DPC says it
        did not - a system does the former. The conformance cases for
        $orderby ride on the SADL service meanwhile


B.18 The release bundle runs 3.5x slower than the same build         [S]
     `ANOMALY-2026-09-17-release-bundle-slower-than-source`, found while
     re-measuring something else. One generation, one machine, one scene:
     100 ms a frame from a checkout, 363 ms from the release bundle. Node
     is not the cause. **This is what the i7 and every release run**, so
     the deployed demo is several times slower than the same demo from a
     checkout, and the work-process pool numbers (B.12) were taken on the
     source host.
     └─ it is not uniform, and that is the clue: with the transpiler's
        typed-arithmetic flag off the bundle costs 3.6x, with it on 2.0x,
        so the penalty falls on the `@abaplint/runtime` operator protocol
        rather than on everything equally
     └─ suspects, none confirmed: Terser's mangling of the runtime's hot
        classes, the single-chunk module wrapper defeating inlining, or
        the generated code reaching the runtime through the bundle
        plugin's `build.module` copy instead of a normal import
     └─ how to isolate it cheaply: build the bundle with Terser off, then
        with the chunk split, then with the runtime external, and profile
        the same generation each time. One scene and 60 frames answers it
     └─ until it is understood, **no performance number may be taken
        through a release**: a bundle that taxes the operator protocol
        flatters any change that removes protocol work, which is how a
        41 % improvement read as 63 % for a day

B.17 The arithmetic protocol: 30 ns an operation, and who fixes it   [S/T]
     Measured 2026-09-17, docs/demo-profile.md and docs/abap-hot-code.md.
     Every ABAP arithmetic operation costs about 30 ns here and about 1 ns
     in plain JavaScript; one frame of sdf_blobs is 1.97 million of them.
     The cost is the protocol around the operation - dispatch on the
     operand types, parse each operand, allocate the result - and not the
     arithmetic. Ranked by measured gain against risk, and the order is
     not the intuitive one:
     └─ a constant Character should remember the number it parses to
        (runtime, operators/_parse.ts with the character factory). Five
        lines, no compiler change, measured 22 % of an sdf_blobs frame,
        because '0.5' is how ABAP spells a float constant. Safe only for
        a literal with a decimal point: an integer-valued one takes the
        Integer branch and folding it would change an inferred type
     └─ a Float/Float branch in add/minus/multiply/divide (runtime). Two
        lines each, measured 9-17 % a frame. Integer addition is 17 ns
        and float addition 33 because the chain tests Integer first;
        divide is cheaper than multiply because its chain is two tests
        and multiply's is eight
     └─ raw JavaScript arithmetic when the operand types are proven
        (transpiler codegen, expressions/arith_operator.ts and source.ts).
        110-200 ns to about 1. The largest item by a wide margin and a
        project rather than a patch: the operator is chosen today by a
        string switch with no type information, source.ts already carries
        a context type it ignores, and abaplint core exports no
        getTypeOfSource(node), so a bottom-up type for a Source subtree
        has to be written. The admission rule is not "both operands f"
        but "no operand is character-like, packed, decfloat34, int8, hex,
        date or time, and at least one is f", which is what makes the
        calculation type fall away; division keeps its zero guard
     └─ a synchronous LOOP AT when the body contains no await (runtime
        plus codegen). LOOP AT is an async generator and costs 172 to 349
        ns a row before the body runs, against 74 for DO with READ TABLE
        INDEX. 2.3x on every table loop in every program, but "no await"
        means "no method call at all", so it reaches leaf arithmetic
        loops and little else
     └─ method inlining. 123 ns to 67, and 206 to 67 when the method
        returns a structure. High gain, high risk (aliasing, sy-subrc,
        exceptions, recursion, everything generated is async), and it is
        the precondition for anything across a call boundary
     └─ loop-invariant code motion: nearly nothing here on its own,
        because the one enormous invariant in the demo (cos of a rotation
        recomputed 128 000 times a frame) is behind a method call and
        invisible without inlining. Not worth starting before it
     └─ **not** a lookup table for a function over a proven range, and
        this was measured rather than argued: sin( ) is 19 ns and a
        READ TABLE INDEX lookup is 71, so the table is four times slower
        than the thing it replaces, and no table equals Math.sin at the
        sampled points, which breaks the frame comparison. The builtins
        are cheaper than the operators here (sqrt 10 ns, less than one
        multiply), so hand-expanding ** into multiplications is also a
        pessimisation
     └─ the demo's own ABAP is the ceiling measurement, not the fix:
        rewriting three scenes by these rules took sdf_blobs -37 %,
        torus_3d -38 %, quat_julia -28 % with every frame identical, so
        at least that much is on the table for a compiler that did it by
        itself. The patch is under .local/hotabap/ and belongs to
        vivid-vibes, not here

B.15 Does our CDS pipeline read a view entity?                           [S]
     └─ every view here is DDIC-based (`define view` + sqlViewName);
        the modern shape is `define view entity` with no SQL view, and
        that is what a system now wants. parseDDLS takes the view's own
        name when there is no sqlViewName, so it may already work -
        nobody has run one through. Write one, build, and either record
        that it works or fix it (docs/cds-publish.md, "Unverified here")

B.14 A cast in a CDS view drops the field                                [S]
     └─ found 2026-09-17 building the status service:
        `cast(pid as abap.char(10)) as Pid` in a view is parsed, but the
        field is missing from the row the generated source class returns
        and an entity keyed on it answers `PortSet()` with no key. Until
        it is fixed, change the type in the stg.yaml instead. A test over
        a casted element in tools/cds2ddic.mjs would pin it.

U.2  The status app on the browser deployment                            [S]
     ├─ DONE 2026-09-17: the worker takes the snapshot itself and posts it
     │  to ZCL_OSD_STATUS=>REFRESH at boot and on every read of the
     │  service (web/preview-backend.mjs); host "browser", one process
     │  with no pid and no port, one port row saying there is none and
     │  why, the services of generated/services.mjs plus the SEGW
     │  registrations, the packs with their object counts from the build
     │  (web/generated/status.mjs). docs/status-service.md "On the
     │  browser deployment"; test/e2e/preview.spec.mjs
     └─ Alice, 2026-09-17: the launchpad on GitHub Pages has the tile and
        the app, but nothing fills the five tables there — no façade, no
        pool, no listeners. What the worker does know and could write at
        boot: host kind (a service worker), one "process" (itself), the
        generation (build.json), every service and channel (the generated
        services.mjs), the packs (packs.json), the objects per pack;
        ports would be honestly empty with a note. web/preview-backend.mjs
        is the place, ZCL_OSD_STATUS=>REFRESH the door, and the JSON
        contract already exists (tools/osd-status.mjs)

E.9  A pack has a page of its own                                        [S]
     └─ Alice, 2026-09-17: a pack tile should open something even when
        the pack brought no webapp — a generated Fiori page (or a
        deep-linked one) with the pack's description, its objects, its
        services, channels and tiles, read from osd-pack.json and the
        object store. Today a tile without a url points at /app/<name>/,
        which is 404 for a pack with ABAP only.

E.8  A DIAG stream as a demo                                      [S+A] milestone 1 DONE 2026-09-17
     └─ Alice, 2026-09-17: record the whole DIAG stream of a SAP GUI
        session (the LSD demo), push it over an APC channel the way ZO4D
        pushes frames, and paint it on the page with a SAP TUI written
        in JS, in the same console as the demos, with music. The DIAG
        reader exists in the sibling project (docs/layers-we-own.md);
        the missing piece is the screen-side renderer and the recording
        format.
     └─ milestone 1 DONE 2026-09-17 (docs/lsd-pack.md): sap-tui --record
        writes the composed screens as styled runs (141 KB gzipped for
        the whole show), packs/lsd carries the recording as an SMW0
        object, ZCL_LSD_APC_HANDLER hands it out by line, the page paints
        it on a canvas with the xterm palette; tile on the launchpad,
        preview test on the channel. Left: the music file (S: is not
        mounted here), icon glyphs, a compressed object once the browser
        side inflates it
     └─ milestone 2, if wanted: a DIAG decoder in JavaScript, so the page
        follows a live dispatcher

E.6  A pack cut out of a system                                        [S+A]
     └─ Alice, 2026-09-17: for vsp, or anything that speaks ADT and the
        abapGit API — prepare a self-contained pack from a system, with
        stubs and shims on the perimeter: the objects asked for, their
        closure inside the package, and a stub for every class, function
        and table the closure reaches outside it (npm run probe knows the
        closure; the stub is the ASSERT 1 = 'todo' shape open-abap-core
        uses, so a missing piece fails loudly and by name). The output is
        a directory with an osd-pack.json in it, so E.2 needs nothing new.
     └─ the perimeter is the hard part, not the export: a DPC_EXT's
        closure is the finding of Sprint 0, and the stubs are what make a
        pack run before the closure is transpiled
```

---

# The standing list

## 0. Decisions waiting on Alice

Nothing below them starts until the answer.

```
0.1  Bun "local ABAP AS" packaging: yes / no                          [A]
     └─ unlocks 1.1, 1.2, 1.3
     └─ feasibility settled 2026-09-13: bun 1.4.2 runs the whole thing,
        107 ABAP Unit tests and the gateway over HTTP, docs/bun-spike.md
     └─ packaging settled 2026-09-14: the %23 defect does NOT block a
        compiled binary. Bun.build({compile, plugins}) with a five-line
        onResolve builds one that runs; only `bun <script>` and the
        plugin-less CLI `bun build --compile` fail. #1841 is no longer a
        gate here (docs/bun-spike.md part two)
     └─ external: open-abap-apc (T's, local only, no remote) for the APC layer
     └─ settled already: it lives in this repository, not a third one

0.2  ADT façade: ANSWERED YES by Alice 2026-09-13, building              [A]
     └─ the contract for waves 0 and 1 is written: docs/adt-facade.md
     └─ unlocks 2.1 .. 2.4
     └─ external: open-abap-adt (interfaces only, LICENSE empty -> spec, not base)
     └─ external: vsp as the oracle and the test client
     └─ external: sanitized ADT fixtures from V; this repository is public,
        so raw captures never come here, V scrubs before handing over

0.3  A4H: what goes up, and when                                      [A]
     ├─ level 1  the SEGW project as an abapGit repository (13 files)
     ├─ level 2  + DDIC, seed data, search help, the hand-written _EXT
     ├─ level 3  + the Travels app as a BSP (three changes, AGENDA)
     └─ needs: package name, transport, the word
     └─ external: A4H sandbox, abapGit installed on it

0.4  draft oracle: build the sample objects on A4H?                   [A]
     └─ plan: docs/oracle-draft.md
     └─ external: A4H; a browser to capture $metadata (MCP cannot)
     └─ risk named there: the writable draft service may not be a SEGW artifact

0.5  RAP oracle: build the sample objects on A4H?                     [A]
     └─ plan: docs/oracle-rap.md
     └─ external: SAP-samples/abap-platform-refscen-flight (Apache-2.0) is
        most of the oracle already; A4H only adds the 1909 BDEF dialect
     └─ external: A4H 1909 is unmanaged-only, no managed, no draft

0.6  Is depending on ZADT_VSP being installed on the target ok?       [A]
     └─ decides V's deploy route (2. vs 3. on the ladder in 4.2)

0.7  What S does while the above is open                              [A]
     └─ proposal: the analytics chain, 3.1
```

---

## 1. The Bun binary (gated on 0.1)

```
1.1  bun:sqlite backend for the DatabaseClient seam                   [S]
     └─ eleven methods + the seven rewrites (docs/db-backends.md)
     └─ must keep the seed path alive: test/seed.mjs over data/*.tabu.json,
        T's SEGW tables ride on it
1.2  Bun.serve adapter, replacing express-icf-shim                    [S]
     └─ the ABAP side (zcl_stg_http_handler) does not change
1.3  build and stitch: bun build --compile, one exe per platform      [S]
     └─ external: CI runners per platform
     └─ NOT gated on #1841 any more, measured 2026-09-14: the bundler's
        onResolve closes %23 and %25 together, ten lines, and the compiled
        binary runs. #1841 stays worth having (it would delete the plugin
        and fix `bun <script>`) but nothing waits on Lars for it
     └─ known: mainstream platforms only, ~60-100 MB per exe
1.4  APC over Bun websockets                                          [T]
     └─ open-abap-apc as an outside library, cloned into .local/lars
     └─ not gated on Lars: the library ships its own copy of the SAP-named
        part today and works; the PR (9.4) only makes it prettier
1.5  layers: the binary takes an ordered list of abapGit src paths   [S+A]  (E.1 done 2026-09-16: the list is abap_transpile.json, later wins; the binary's argument is E.2)
     └─ Alice's formulation, 2026-09-14: later layers win on a name
        collision, and data layers (data/*.tabu.json) apply the same way
     └─ the argument is not theoretical: local/o4d/ and local/vivid-vibes/
        both carry ZCL_O4D_HTTP_HANDLER, and on 2026-09-14 whichever the
        directory walk reached first won, silently. Explicit order plus a
        report of what was overridden is the whole feature
     └─ the unifying bit: hash(ordered layers) is the transpile cache key
        AND the ADT version-id Alice proposed earlier. One number, three
        uses, and it is what makes "spin a runtime from sources" fast —
        first run transpiles 1065 objects, later runs do not
     └─ open, needs Alice: does a layer override the OBJECT (all its
        files) or single FILES? Overriding .clas.abap without .clas.xml
        is the case that decides it                                   [A]
     └─ zip as a layer: an abapGit export unpacked into the cache
1.6  the runtime half of packaging, in order                          [S]
     └─ measured first, built second: `bun tools/osd-serve.mjs`
        interpreted is the next cheap check, and it is where the %23
        defect still bites (1.3 is unaffected)
     └─ then the supervisor: ServingRuntime spawns a SCRIPT PATH today;
        a binary must spawn `process.execPath serve --port ...`, so the
        entry needs subcommands before --compile is useful
```

## 1a. Shipping shapes that are not the binary

Three exist or could: the browser bundle (done), the binary (section 1),
and one local HTML file. They answer different questions, and the third is
the only one still undecided.

```
1a.1 the browser bundle                                          [S] DONE
     └─ service worker + sql.js, every ICF service, APC channels, and
        since 2026-09-14 the SMW0 media. Read-only showroom: no ADT, no
        activation, no writes that outlive the tab
     └─ needs https off localhost, which is the friction the binary removes
1a.2 one local HTML file, opened from disk                        [S+A]
     └─ FACT, not an opinion: a service worker cannot be registered from
        file://. So this is not "bundle harder", it is a different seam —
        run the runtime IN THE PAGE and shim fetch + XMLHttpRequest
     └─ already half-built without meaning to: preview-socket.mjs shims
        WebSocket the same way, and handleRequest({method, path, search,
        headers, body}) knows nothing about transport. Tens of lines
     └─ cost: ~45-50 MB (33 MB JS + 11 MB media as base64), re-parsed on
        every open, UI5 still from the CDN
     └─ needs webpack, not Bun: file:// refuses <script type="module">,
        so the build must be a classic script with TLA lowered
     └─ worth it only for "send someone a file they double-click". Where
        an executable may be run, the binary wins                     [A]
1a.3 UI5 is NOT embedded in any of them — decided 2026-09-14         [S]
     └─ Fiori Elements (sap.fe, sap.ui.generic.app) is SAPUI5 and is not
        in OpenUI5, so embedding OpenUI5 buys freestyle apps and not the
        thing the project is for. Licence aside, it would not work
     └─ instead: CDN by default, `osd ui5 fetch` caching a dist under
        ~/.osd/ui5/<version>/ for offline, --ui5 <dir> to point at one
```

## 2. The ADT façade (gated on 0.2)

Not "flip a URL and 96 tools work". It is "flip a URL and iterate one
subset at a time against vsp", whose client is strict on purpose. Order
below is V's, and it is the order that matters: the session comes before
the objects.

```
2.1  session and CSRF emulation                                  [S] DONE
     ├─ the token dance: HEAD/GET fetch, x-csrf-token on writes
     ├─ X-sap-adt-sessiontype stateful / stateless, sap-contextid, cookies
     ├─ an affine session for lock -> write -> activate
     └─ expiry by shape: a 200 without a token reads to vsp as logged out
     └─ V's warning: this breaks first, so it is built first
2.2  discovery as the gatekeeper                                 [S] DONE
     ├─ /sap/bc/adt/discovery advertises only what is implemented
     └─ so vsp never calls an endpoint that 404s, and "which tools work"
        has one honest answer
2.3  thin vertical slice, one day                                [S] DONE
     ├─ discovery + the session dance
     ├─ GetSource for a class, from the files in src/ and gen/
     └─ GetTableContents, from the database we already have
     └─ exit test: vsp pointed at localhost, its own tools answer
2.4  reads: programs, classes, interfaces, tables, packages, search
                                                                 [S] DONE
     └─ and the cross-reference tables over freestyle SQL: free on the
        protocol side, filled from the parse by the store layer        [T]
2.5  writes: source in, abaplint as the syntax check, transpile as
     activation, ABAP Unit as the test run; synthetic locks, no
     transports                                                       [S]
     └─ the store side is in: check with source in the request, and the
        test run as program/testClasses/testMethods/alerts, both
        tools/osd-*.mjs, both with the shape vsp unmarshals           [T]
     └─ and the fetch: a clone happens inside OSD now, git's smart HTTP
        in ABAP over abapGit's transpiled pack code, no git binary    [T]
2.6  runtime errors as ST22-shaped dump documents                     [S]
     └─ V's freebie: `vsp dumps --explain` then works with no system
2.7  honest scope: the development loop, some thirty to fifty of the
     ninety-six tools. Transport organiser, job and spool, identity,
     debugger over ADT and real cluster dumps stay out and stay
     undiscovered.                                                    [S]
     └─ external: sanitized ADT document shapes from V (see below)
2.8  create: a client POSTs ADT create XML and the object is persisted [S]
     └─ the store writes the files; the metadata beside the source is
        what we would otherwise be inventing                          [T]
     └─ 2.8a AFF (SAP/abap-file-formats) as the source for that metadata,
        ~90 JSON schemas, Apache-2.0                            [T] ~2h
        ├─ agreed 2026-09-13 by all three sessions: it waits until create
        │  arrives, nothing on vsp's Tier 1 path needs it. V's words:
        │  vsp talks to OSD over ADT and never reads OSD's on-disk
        │  metadata, so XML-vs-AFF is our internal choice
        ├─ catch: abaplint reads object metadata from .xml only, its
        │  aff_and_xml rule merely flags having both. So AFF has to be
        │  converted to XML on import, or the syntax check answers
        │  confidently about objects it cannot see
        └─ later, not now: if OSD ever emits AFF archives, V's deploy
           path reads standard abapGit XML and would need AFF then
2.9  activated code reaches the running gateway                    [T+S]
     └─ measured 2026-09-13 while answering Alice's "can we develop and
        deploy today": it does not. Node pins the whole transpiled
        module graph at boot (test/start.mjs imports output/ statically),
        so an activation changes src/ and output/ and leaves the serving
        process on the code it started with. Not a metadata cache: the
        entire OData runtime is frozen the same way
     └─ the sharp edge: ABAP Unit over ADT does see the new code,
        because the runner imports the testclasses module in a child
        process. So a green unit verdict and a Fiori client reading the
        old model happen in the same minute
     └─ a restart fixes it and costs the database, which is in memory.
        So the fix is two decisions, not one: how the process picks up
        new modules (recycle a worker, or the whole process) and where
        the rows live so a recycle does not eat them      [A decides]
     └─ smaller, same family: activation answers before the transpile
        finishes and nothing says when it landed                       [S]
     └─ the store half is in: serving runtime in a process of its own
        (tools/osd-serve.mjs), a supervisor that replaces it
        (tools/osd-runtime.mjs), STG_DB_PATH for SQLite so a recycle
        does not eat a client's rows, and store.publish() which
        transpiles and then recycles, resolving when the new process
        answers. Asserted: changed modules are live after a recycle and
        not before it                                                  [T]
     └─ what is left is the listener's half: proxy the OData path to the
        current runtime, await whenReady() so a request mid-recycle
        waits rather than fails, and let activation answer out of
        publish() instead of firing the transpile and forgetting    [S]
2.10 what a client can do to an object, and what it cannot            [S]
     └─ no DELETE anywhere in the façade: create and change, never remove
     └─ a Fiori application is files on disk, not an object of the
        store, so "deploy an app into OSD" has nowhere to land. Needs a
        UI5 or BSP type in the store before the façade can carry it [T]
```

## 2a. OSD: the tiers, and who owns which layer

The local system, working name OSD, the off-stack doppelganger. The tiers
say **when**, the layers say **who**; they are the same picture from two
angles and both were agreed across the three sessions on 2026-09-13.

```
Tier 1  OSD speaks ADT well enough for vsp
        waves 0-4 above, plus abapGit in a box as the way content gets in
        gate: vsp's wave 0-4 tools green against localhost, AND
              open-steamgate's own suites unchanged with the facade in
Tier 2  OSD speaks ADT well enough for an IDE. Not one thing: two, with
        very different costs, and the split was measured on 2026-09-13
Tier 2a VS Code, through murbani.vscode-abap-remote-fs on abap-adt-api.
        That client logs on with plain basic auth, no ticket and no RFC,
        and its login calls exactly one resource,
        /sap/bc/adt/compatibility/graph. We were 404ing it; one route was
        the whole distance. Served and tested now (03fa379), with an
        empty graph on purpose: a compatibility graph is a system saying
        which resources a client may use at which versions, and we have
        measured none of those facts
        honest scope: one route served and tested, NOT a connected client
        browsing a tree. What the extension asks for and we lack will
        name itself in /osd/not-served, which is the instrument
Tier 2b Eclipse. RE-COSTED 2026-09-14, because the premise was wrong:
        ADT is NOT only HTTP over the ICM. SADT_REST_RFC_ENDPOINT (function
        group SADT_REST) carries a whole HTTP exchange in one RFC call --
        REQUEST_LINE, HEADER_FIELDS, MESSAGE_BODY in, STATUS_LINE, headers,
        body out. Measured: GET /sap/bc/adt/discovery over RFC answered 200
        with the atomsvc document. Alice had sniffed this; the session had
        asserted the opposite without data. So the on-prem route is not
        "replay an unreplayable logon and then still need HTTP", it is "be
        an RFC server answering one function module", and the payload is
        already the shape the facade speaks. See docs/adt-facade.md.
        The old note below is kept for the reasoning it records.
        Eclipse, still on the logon, not on the ADT surface. Two forks:
        the on-prem project wants an RFC logon on 3399, costed at three
        to eight weeks with a real chance of never converging, because
        the logon-accept is a function of the client's init and cannot be
        replayed; the ABAP Cloud project wants the browser reentrance
        ticket, which is hours, because the ticket is opaque to Eclipse
        and only the accepting system validates it, and that is us
        cheapest next measurement: Alice pastes the string behind
        "Copy Logon URL to Clipboard", which names the loopback port,
        the path and whether a nonce is echoed                        [A]
        rule: an Eclipse capture stays in .local/, never in this repository
Tier 3  OSD speaks the rest: RFC and DIAG fronts, a screen that answers
        "not implemented" instead of nothing
        not ours to build: odgp already draws screens from Go with no
        system behind it, and the DIAG sibling carries the LZH writer
        (docs/layers-we-own.md). The spike is "can odgp answer a screen
        routed from OSD", and it is odgp's question
```

```
Layer                      Owner  What
protocol surface           S      the ADT facade: session, discovery, the
                                  resource tree, content handlers, ETags,
                                  locks; and the packaging that ships it
the object service seam    S      drafted as part of the facade contract:
                                  read, write, activate, delete, list,
                                  search, and the shape activation returns
                                  for an error. The facade never touches
                                  storage, the store never parses HTTP
what is behind it          T      the object store, the activation path
                                  (file, abaplint, transpile), abapGit in
                                  a box, APC and daemons
the client and yardstick   V      the calls a real development loop makes,
                                  the sanitized fixtures, the round trip
```

## 2b. Questions parked next to the façade

```
ANSWERED  does Eclipse need the dispatcher port at all? No. Tested by
      taking the dispatcher forwarder down on 2026-09-14 and connecting
      again: the project was created and everything worked — until a program
      was run, when Eclipse's embedded GUI opened and could show nothing.
      So ADT is entirely the gateway, 33NN, and 32NN is only ever DIAG.
      Two consequences, and they split the work cleanly. To make Eclipse
      connect and develop, OSD needs an RFC server on ONE port answering ONE
      function module. To make programs run inside it, OSD needs a DIAG
      front on 32NN, which is open-diag-go's territory and not the façade's.
      What is lost without DIAG is dialog programs and transactions, and
      only those: ABAP Unit runs over ADT (abapunit/metadata is in the
      capture, Ctrl+Shift+F10 goes through the façade), so edit, check,
      activate and test all work with no DIAG frame at all. Alice's
      correction, and it matters — "cannot execute" undersold it badly.
open  SOAP: vsp's ADT is pure REST, no SOAP in it. The only SOAP it touches
      is SOAP-RFC (/sap/bc/soap/rfc), a fallback transport for classic RFC
      when the gateway is closed, stateless, and it belongs to open-rfc-go.
      A local system would need it only if a non-ADT, RFC-speaking client
      had to attach. Question, not an item.
open  Eclipse ADT against the façade: free if vsp accepts it, untested.
open  revisions: reading them out of git instead of a system.
```

## 3. Analytics and CDS (no gate, S can start)

```
3.1  star schema                                                      [S]
     ├─ @Analytics.dataCategory: #DIMENSION / #TEXT
     ├─ @ObjectModel.text.element, foreign-key associations
     └─ so the analytical list page shows names, not codes
3.2  view parameters                                                  [S]
     └─ parameterised entity sets in OData v2
3.3  delta extraction (the BI piece)                                  [S]
     ├─ @Analytics.dataExtraction.enabled, delta by a timestamp element
     ├─ !deltatoken on the service, __delta in the answer
     └─ a change-log table our own writes fill, so deletions are in the delta
3.4  calculated measures over the virtual-element exit                [S]
     └─ free now, docs/virtual-elements.md
```

## 4. The road to a system

```
4.1  capture IN: DDIC + table contents from a system into our files   [V]
     └─ this is the thing we lack: our DDIC and seed rows are hand-made
     └─ external: rfc export (abapGit ZIP) + Data Config, both exist in vsp
4.2  deploy OUT, as a ladder                                          [V]
     ├─ rung 0  abapGit on the box pulls the repository itself   (nothing to build)
     ├─ rung 1  vsp deploys CLAS + DDIC; IWMO/IWSV registered by hand once
     ├─ rung 2  vsp triggers abapGit deserialize        (gated on 0.6)
     └─ rung 3  vsp learns IWSV/IWMO/IWPR natively      (only if install-free
                deploy becomes a promise)
4.3  two bundles, never conflated                                     [S+V]
     ├─ out: classes, DDIC, registration objects
     └─ in: DDIC + table contents; data/*.tabu.json does not go back
```

## 5. SEGW, the application (T's, with my editor on top)

```
5.1  the wizards SEGW has                                             [S]
     ├─ import from a DDIC structure
     ├─ map to a data source
     └─ referential constraints, complex types, data sources by hand
5.2  node order, drag and drop (STG_SEQ)                              [S]
5.3  a text row created when there is none                            [S]
5.4  Generate into src/ and a registration without a restart          [S+T]
5.5  the informational Cloud abaplint pass, numbers per release       [T]
```

## 6. Gateway leftovers (S)

```
6.1  media: CREATE_STREAM with a slug, deleting a media resource,
     ETags, streaming instead of one xstring
6.2  deep insert through a projection (a composition)
6.3  ETags on a CDS projection
6.4  @ObjectModel.readOnly per element
```

## 7. stg-compile leftovers (S), blocked on an oracle

```
7.1  Include: a model that merges another service's model
7.2  a function import mapped to a function module
     └─ neither has a corpus example; both need a small sample project
        built on A4H (0.3 / 0.4 territory)
```

## 8. Housekeeping (S)

```
8.1  e2e data isolation, so the suite can run in parallel again
     └─ today: workers: 1, deterministic, 44 seconds
8.2  the flaky value-help spec, seen once, not reproduced
8.3  keep the preview build green (it broke twice on bundling)
8.4  verification discipline, after three false greens in one day     [S]
     └─ 2026-09-14, all three the same shape: a test that passed while
        the path it claimed to cover was broken (it called install()
        itself), a suite that passed against a stale build/sw.js, and a
        fix "verified" by grepping for a comment webpack strips
     └─ rules that follow: assert on CODE in a built artefact, never on
        a comment; a test must exercise the injected path, not simulate
        it; and a deployed bundle is verified by content, not by the
        deploy command exiting 0
     └─ DONE, the mechanism rather than the rule: the bundle carries a
        digest of itself, serves it at <mount>__preview/build, and the
        first test of the preview suite compares it with build/build.json.
        A registration that outlived a rebuild now says so instead of
        answering quietly. scripts/build-preview.mjs writes the stamp
     └─ a FOURTH one the same day, after the rule was written: a fix
        reported as shipped that had gone into a folder which is not an
        input (9.7, 9.8). The stamp would not have caught that one; the
        input report does
     └─ still open: this is the argument for one e2e suite running against
        every packaging target, or the binary becomes a second runtime
        with no second check
8.7  a leak detector on the way out, not a rule in a document   [СДЕЛАНО]
     └─ 2026-09-14: a wire capture was about to go into open-rfc-go, a
        public repository, as a test fixture. It contained two LAN
        addresses, a host name, an Eclipse project name, a machine id and
        Alice's surname. I caught it by reading the bytes before committing,
        which is exactly the kind of catch that works until the once it
        does not
     └─ CLAUDE.md has said "no live identifiers in any tracked file" since
        the first week. The rule did not stop it; noticing did. That is the
        day's theme in a new place, and the answer is the same: a mechanism
        that cannot be walked past
     └─ what it should be: a check on `git commit` and again before a
        publish — addresses in the private ranges, host names of the
        machines in play, the user names, anything matching a GUID shape,
        and a *.jsonl or *.pcap staged at all. Hex-encoded too, since a
        capture hides its identifiers inside hex strings where grep for
        "192.168" finds nothing
     └─ scope: this repository and the sibling Go ones, since they take the
        same captures. A pre-commit hook is not enough on its own — hooks
        are per-clone and silently absent on a fresh one — so the same check
        belongs in CI where it cannot be skipped
     └─ Alice's call, 2026-09-14, and the right one
     └─ built 2026-09-14, `tools/osd-leak-scan.mjs`, `npm run leak`, hook in
        `.githooks/pre-commit`, CI in `.github/workflows/leak-scan.yml`
     └─ and it caught one the same hour, in the repository it was written
        for. A 746-byte logon template committed to open-rfc-go carried the
        captured system's host name, instance, address, logon string and
        user, all in UTF-16LE — and a hand scan run over that very file had
        reported it clean an hour earlier, because it looked for runs of
        printable ASCII and a NUL after every character is enough to hide a
        host name from a grep. The design lesson is one line: decode first,
        match second, over every encoding a file plausibly has
     └─ a sixth identifier was not text at all. The last six bytes of a
        session GUID are the client's own IPv4 packed into the uuid node
        field, which is how a LAN address travels through a public
        repository without ever spelling itself out. Matched in binary now,
        and only on two-byte prefixes: 10.x is one byte, any random blob
        produces one per 256, and the first run turned up seven of those and
        nothing real. A check that cries wolf is read once
     └─ its first real catch was the comment I wrote explaining the scrub. I
        cleaned the data and spelled both identifiers out in the prose beside
        it. Nothing was pushed, so nothing was public
     └─ what it finds on open-rfc-go's public main is Alice's to decide: two
        of her LAN addresses, her surname, and the stock A4H appliance host
        name, in files that predate this branch

8.6  source maps, so a failure names her ABAP line not our .mjs      [S] DONE
     ├─ done 2026-09-16 — and most of it already was: the transpiler writes
     │  a map beside every module (write_source_map), and osd-where.mjs
     │  resolves a generated position to the ABAP statement; the unit
     │  runner has named ABAP lines in its alerts for a while
     ├─ what was missing was the runtime: a request that died in ABAP was
     │  logged as a JavaScript stack. The child keeps short dumps now —
     │  what, where in ABAP, the frames under it — says the ABAP statement
     │  in its log, puts the position into the OData error's innererror,
     │  and answers them at GET /osd/dumps; ICF services report through
     │  the same door
     └─ the ADT runtime/dumps route reading them in ST22 shape is 2.6,
        ADT work, later
     └─ from T, 2026-09-14, half done already: `write_source_map` is
        ALREADY true in our abap_transpile.json and output/ carries the
        .mjs.map files, so only the consumer side is missing. 341 maps
        on this tree, resolving to the statement rather than the object:
        zcl_o4d_sales_dance.clas.mjs:1346 -> .clas.abap:119, which is the
        line the demo actually died on
     └─ the consumer is here: tools/osd-apc.mjs `describe(error)` already
        names the exception class and the frames from output/. With maps on
        and findSourceMap over the thrown object's stack it can name the
        ABAP statement instead. Costs a flag and some disk

8.5  the preview suite flakes on a worker-served page        [S] FIXED
     └─ seen on 2026-09-14, a different test each run, mostly a page.goto
        timing out or "execution context was destroyed". Diagnosed rather
        than retried, and it was a real race: web/index.html is the
        installer and does location.replace("app/") the moment the worker
        is ready, so every test that waits for the controller on that page
        and then goes somewhere collides with a navigation already in
        flight. The error surfaces on an unrelated line, which is why it
        read as noise
     └─ the fix is in the page, not the tests: index.html?stay leaves the
        visitor where they are instead of redirecting, which is a
        reasonable thing to offer anyway, and the suite uses it. Four
        consecutive clean runs, 6/6
     └─ the lesson is 8.4's: a suite that goes green on a second run
        teaches everyone to run it twice, which is how a real failure gets
        waved through. This one was hiding a defect for a day
```

## 9. Upstream, outside this repository (T's, verbatim from them)

```
9.1  transpiler #1835, @abaplint/database-duckdb                      [T]
     └─ open since 2026-09-12, checks green, no review
     └─ external: Lars merges; PR only, never merge ourselves
     └─ blocks nothing here; the branch feat/database-duckdb lives until then

9.2  transpiler: 2.13.87 is out (2026-09-14)                          [T]
     └─ DONE as far as publishing goes: 2.13.87 carries #1836 (flat concat
        chain) and #1843, so both generators can drop the 200-line SADL
        rule (segw-gen's sadlXml and zcl_stg_segw_gen_dpc). T's files
     └─ it does NOT let us leave the linked local build, which is what it
        looked like it would do. Checked against the open pull requests:
        #1846 (a W3MI object keyed on its name, not its file name) and
        #1845 (a binary file survives the copy to output) are both still
        open, and the whole media path rests on them. Without #1846 the
        registry is written abap.W3MI["zork-mini%2ez3"] while
        WWWDATA_IMPORT asks for "ZORK-MINI.Z3" and finds nothing; without
        #1845 the bytes beside the module are corrupt
     └─ so do NOT record the dependency by bumping package.json to
        ^2.13.87. ^2.13.86 already resolves there, and an npm install would
        replace the link and take the media down without saying so. The
        debt stays named instead: DEBT-2026-09-13-linked-transpiler

9.3  open-abap-core: BAPI_TRANSACTION_COMMIT / ROLLBACK over the LUW   [T]
     └─ written, eb0bedd on branch bapi-transaction in the fork, unpushed
     └─ waits on 9.2, then PR, then the commit_work test in open-abap-odata
     └─ external: Lars merges

9.4  open-abap-core: the APC family a real handler needs               [T]
     └─ core's if_apc_wsp_extension has two methods, a stateful handler
        needs five (on_accept, on_close, on_error) and if_apc_wsp_message
        needs set_text; cl_apc_wsp_ext_stateful_base does not exist
     └─ written and tested in open-abap-apc, not yet a PR
     └─ external: Lars merges; until then open-abap-apc ships its own copy
        and leaves core's src/tcp out of its dependency

9.5  oisee/vivid-vibes: what actually stops the full package       [A/T]
     └─ MEASURED 2026-09-14, and the old entry ("2 of 85 implement them,
        so 75 do not transpile") was wrong. Transpiling local/vivid-vibes
        as the only o4d input fails with 17 errors, and they are not what
        was assumed:
        ├─ ~13 of them are two dev-time report programs, not the demo:
        │  zo4d_render_demo.prog.abap and zo4d_offline_export.prog.abap,
        │  which call cl_gui_frontend_services (SAP GUI, absent in
        │  open-abap) and use X255. They are export tooling and have no
        │  business in a browser build
        ├─ implement_methods on exactly ONE class,
        │  zcl_o4d_mountains_oops_a (get_required_media, is_loopable) —
        │  that is the DEFAULT IGNORE family, abaplint #4291
        └─ two real errors in zcl_o4d_composer ("field frame does not
           exist in structure")
     └─ so the full 85-effect package is two programs and two classes away
        from building, not 75 classes away. The 31 effects absent from the
        current build are absent because nobody copied them into
        local/o4d-apc, not because they fail
     └─ what this makes cheap: excluding the two *.prog.abap files is a
        glob, and then vivid-vibes can BE the input instead of being
        curated into two folders by hand
     └─ DEMONSTRATED, not merely argued: with vivid-vibes as the only o4d
        input and four entries added to exclude_filter — the two .prog
        files, zcl_o4d_mountains_oops_a and zcl_o4d_composer — the tree
        transpiles clean, 1094 objects and **83 effect classes against the
        54 the demo ships today**. Config only; nothing in her repository
        had to change. Reverted afterwards, because what the demo contains
        is Alice's call and two effects are dropped by name to get there
     └─ so the recommendation is not a lean/extended branch split but one
        input and four excludes; local/o4d and local/o4d-apc then go, and
        the hand-kept duplicate goes with them
     └─ external: Alice's repository, a patch there is the fix — the two
        real errors in zcl_o4d_composer, and mountains_oops_a once
        abaplint #4291 lands or its two methods are written

9.5a open-abap-core: GENERAL_GET_RANDOM_INT                            [S]
     └─ found 2026-09-14 by replaying the MiniZork walkthrough through the
        bundle's APC channel: the Z-machine's `random` opcode calls it, it
        does not exist, and CX_SY_DYN_CALL_ILLEGAL_FUNC closes the channel
        on the first dice roll — the troll fight, twenty-five commands in
     └─ small and contributable; a fork, since we have no write access to
        open-abap-core. ANOMALY-2026-09-14-general-get-random-int
     └─ WRITTEN AND PROVEN 2026-09-14, not yet offered: twelve lines on
        core's own cl_abap_random_int, in .local/lars/open-abap-core. With
        it the whole walkthrough plays in the bundle, every assertion,
        start to finish. The test still tolerates the old death because a
        fresh clone of core has no such file
     └─ OPENED: open-abap-core#1221, 2026-09-14, after asking T for
        objections (none: "take it") as Alice instructed. Lint and the full
        core unit suite green on a clean clone of the fork, the four new
        tests confirmed to have run, and checked by negative control — the
        naive 1..RANGE version fails random_int_zero with "Expected '0',
        got '1'"
     └─ the contract was measured on A4H, not inferred, and the inference
        was wrong twice over: it is 0..range inclusive, and a negative
        range is legal. cl_abap_random_int cannot express either, because
        intinrange asserts high > low and low >= 0

9.5b zork-abap: the Z-machine assumes random( ) returns 1..range        [A]
     └─ falls out of the A4H measurement. The Z standard says the `random`
        opcode yields 1..range; GENERAL_GET_RANDOM_INT yields 0..range. So
        zcl_ork_00_zmachine:557 takes the module's answer unmapped and will
        occasionally store 0 where the story expects 1..range — on a real
        system as much as here
     └─ not ours to fix and not the module's job to bend: matching the real
        system is what #1221 is for, and the caller maps

9.6  Bun, measured rather than assumed                                [T]
     └─ done in part 2026-09-13: it runs, and twenty reads took 220 ms
        against Node's 264 ms (docs/bun-spike.md)
     └─ still open: the three request shapes (100/20, 1000/100,
        5000/100 rows) so the brief has Bun beside Node 2 ms and goja
        36 ms on the same axis
     └─ confirmed: Bun is JavaScriptCore, not V8
     └─ part two 2026-09-14: no native dependencies exist at all
        (database-sqlite is sql.js, wasm); the bundler is 166x faster and
        unusable; the compiled binary is not blocked by #1841

9.7  oisee/vivid-vibes: the megademo player asks for ?image=          [A]
     └─ found 2026-09-14 while making SMW0 media work in the bundle.
        get_megademo_html writes `img.src='?image='+n`; the handler's
        route is `?img=`, and the SMW0 objid carries the extension
        (ZO4D_05_COPPER.PNG). So the gallery images of the DEFAULT player
        have never loaded, on Node or in the browser, silently: the
        request falls through to the default branch and returns the page
     └─ CORRECTED 2026-09-14, having been written wrong the same day: the
        first fix went into local/vivid-vibes, which is NOT an input folder,
        so it changed nothing; the second went into local/o4d, which is, but
        after the last build. The bundle was reported fixed while both
        copies still shipped `?image=`. Now built and verified by content:
        two occurrences of `'?img='+n+'.PNG'`, none of `?image=`
     └─ the dev player, line 443, was always right, which is how it hid
     └─ T confirmed 2026-09-14 and corrected their own copy of the claim:
        they had repeated `?image=` out of her page as fact without ever
        requesting it
     └─ external: Alice's repository, a one-line patch there is the fix

9.8  local/vivid-vibes is a shadow copy, not a duplicate input        [A]
     └─ CORRECTED 2026-09-14: the first version of this entry said the
        directory walk picks a winner silently. It does not. Only local/o4d
        is in abap_transpile.json; local/vivid-vibes holds 121 objects, 85
        of which the build also has, and is not an input at all. So it is
        not a race that happens to go the right way — it is a folder that
        looks like source and absorbs edits that reach nothing
     └─ now reported rather than remembered: tools/osd-inputs.mjs runs as
        part of `transpile` and names both shapes, a later input overriding
        an earlier one and a folder beside the inputs that is not one.
        test/osd-inputs.mjs. It prints and never fails the build, because
        either can be deliberate
     └─ what is left for Alice: whether local/vivid-vibes should be the
        input (it is the complete package, 237 files against 60) or should
        go. Today the smaller copy is what runs
```

---

## External dependencies, all of them in one place

```
Lars / abaplint
  ├─ transpiler #1835 (DuckDB driver)          open, see 9.1
  ├─ transpiler #1836 (flat concat chain)      merged 2026-09-13
  ├─ transpiler #1841 (%23 breaks Bun)         open, blocks 1.3
  │   └─ when it reaches npm, SADL_CHUNK can go from both generators
  ├─ open-abap-odata                            license still "todo"
  │   └─ we reimplement, contribute fixes, do not fork
  ├─ open-abap-adt                              license empty, interfaces only
  └─ open-abap-core                             T's APC PR, not written yet

SAP
  ├─ A4H sandbox            only on Alice's word, MCP is read-only
  ├─ abapGit on the box     the blessed last mile
  ├─ SAP-samples/abap-platform-refscen-flight   the RAP oracle, Apache-2.0
  └─ SAPUI5 1.120.50 from the CDN               the apps' runtime

Tooling
  ├─ bun 1.4.2              installed (~/.bun), runs everything
  ├─ Go 1.26                installed (used for the goja spike)
  └─ npm, pinned by the lock file

Known defects we live with
  ├─ no implicit MANDT in the transpiler        ANORMALIES, T0009 kept visible
  ├─ bun does not decode %23 in a specifier     transpiler #1841; blocks
  │     `bun <script>` only — NOT the compiled binary (measured 2026-09-14)
  ├─ bun's bundler emits import.meta + TLA        ANOMALY-2026-09-14; webpack
  │     stays for web:preview, the binary is unaffected
  └─ Bun runs JavaScriptCore, not V8            corrects the vision draft
```

## Effects that render, and render wrong

Noted by Alice watching vivid-vibes run off-stack on 2026-09-14, in the
order the timeline reaches them. All four draw something; none of them
errors. That is what makes them worth writing down rather than fixing by
eye: a frame that arrives, parses and paints is indistinguishable from a
correct one without something to compare against.

- the equaliser's second, coloured part
- `mountains` and the variant after it
- the plasma between copperbars and twistzoomer

The oracle exists: the same scene on a real system, driven to the same
bar. Until somebody runs that comparison these are observations, not
defects, and they are recorded as observations.

One known cause is already upstream and would produce exactly this shape.
`DATA(x) = <arithmetic involving a character literal>` is inferred by
abaplint as a character field whose length comes from the literal, so
`lv_f * '0.25'` lands in a `c(4)` and the value is truncated to a couple of
significant digits. `zcl_o4d_sales_dance` computes its bar heights that
way. The effect runs, the picture is plausible, the numbers are coarse, and
nothing reports it. Whether it explains all four is unknown.

## Two for abaplint/abaplint, both reproduced here

Verified independently on abaplint 2.120.50 with minimal projects, not
relayed: `.local/` scratch, no libraries, no demo. Both have a live
consumer in this repository, which is the part that makes them worth
raising rather than noting.

**Arithmetic against a character literal is inferred as a character
field.** Thirteen lines:

```abap
DATA lv_f TYPE f.
DATA(a) = lv_f * '0.25'.            " -> Character(4)   wrong
DATA(b) = lv_f + '0.25'.            " -> Character(4)   wrong
DATA(c) = lv_f * 2.                 " -> Float          right
DATA(d) = lv_f * CONV f( '0.25' ).  " -> Float          right
```

The literal's length becomes the field's. In ABAP the result of arithmetic
is never character-like; with an `f` operand the calculation type is `f`.
An integer literal does not poison it, a `CONV` does not either — only the
bare character literal. Consumer: `zcl_o4d_sales_dance` computes bar
heights this way, so they are truncated to about two significant digits.
It draws, it looks plausible, and nothing reports the loss.

**`implement_methods` does not honour `DEFAULT IGNORE` / `DEFAULT FAIL`.**
A class may legally omit such a method; the rule demands it anyway.

```abap
INTERFACE zif_t PUBLIC.
  METHODS required.
  METHODS optional DEFAULT IGNORE.
ENDINTERFACE.
```

A class implementing only `required` gets `Implement method "optional"`
[E]. The control matters: removing `DEFAULT IGNORE` produces the identical
message, so the rule is not reading the modifier at all, although the
parser understands it (`method_def`, v740sp08, marked as available in
OpenABAP). Consumer: a class that legitimately omits an optional method
cannot be transpiled, and the error says "implement this" where ABAP says
"you need not". Switching the rule off in the project does not help — the
transpiler runs its own mandatory set.

Raise as pull requests rather than issues where the fix is small, and note
what Lars said on transpiler#1836: a branch inside the repository triggers
the regression and performance suites and a fork's branch triggers neither.
Write access is the deciding factor; `oisee` had none on open-abap-core
(403) and #1218 went as a fork.
