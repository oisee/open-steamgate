
### Track WD -- Web Dynpro, with the handlers in the page

Proposed 2026-09-18 by fable-osd; the case is in
[`docs/webdynpro-in-the-browser.md`](webdynpro-in-the-browser.md).

Run a component **and its own ABAP handlers** in the browser, reaching the
application server only when the ABAP goes outside it -- database, RFC, locks.

It reads as madness and is not, for three reasons that are already true here:
the transpiler runs ABAP in a page; the boundary to data is **one object with
eleven methods**, so "go to the server only for data" is a second
implementation of an existing seam rather than a new architecture; and that
seam is **already asynchronous**, so the point where execution would have to
pause is exactly where a remote call would go. The real work is three things:
the context (nodes, lead selection, cardinalities, supply functions -- the
largest piece), the phase model, and drawing with **our own** HTML rather
than imitating Unified Rendering.

Seven waves. The first was to be a corpus measurement designed to close the
track in a day. **It was run on 2026-09-19 and it did not close it**
([`docs/webdynpro-measured.md`](webdynpro-measured.md)): against 2710
components and 151,000 controller method bodies on the sandbox, **25
framework methods cover 80% of all framework calls and 62 cover 90%** --
overwhelmingly the context API. The critic expected a long tail, which would
have ended the track for the price of an afternoon; the tail is there (661 of
4,735 declared methods are called at all) but the head is small enough to
build.

What the same review **did** kill is the original argument, and the author
withdrew it: the data boundary is not where the proposal put it (real
controllers reach the outside through a model, and in the one real component
available that model is BOPF), the seam is statement-level so one round trip
becomes N, and any sound server-side re-validation reconstructs the round
trip the track existed to remove. What survives is the other product --
**Web Dynpro running with no system behind it at all**, in the preview where
the ABAP and the database are already in the page, where none of those three
objections applies because there is no remote call. The beachhead moves from
a plain component to an **FPM feeder** (687 of them on the sandbox): an
ordinary ABAP class that transpiles today, with no generated controller and
no context API, whose screen is a configuration file.

**The security rule is written before the speed, on purpose:** a handler run
in the browser is a **prediction, not a decision**. An `AUTHORITY-CHECK` in a
page is not a check, and a write "approved" by the client is a security
boundary handed to whoever opened the developer tools. Everything that writes
is replayed or re-checked on the server.


**What is being worked on now:** N5, the conformance suite — the same
requests asked of a base URL rather than of an in-process app, so "our
tests pass" becomes "we answer the way a system answers". U.2, the status
app on the browser deployment, is done: there is no façade there, so the
worker says what it knows about itself and leaves the rest visibly empty.

## Track G — the classic screens, and the GUI substitutes under them

*A system has an entry screen, and things you reach by typing their name. The
substrate for drawing them is `open-abap-gui`, wired in as a library at
`ed96e89` (`docs/webgui.md`).*

**Where a new service app goes (Alice, 2026-10-02).** A new service or
monitoring app -- a lock table, a job monitor, a trace -- is a Fiori app
over an OData service with a launchpad tile, not a webgui screen. It is
built the way the rest of the product is built (`stg-compile`, SEGW, the
launchpad), and on a system it deploys as a BSP plus an OData service.
webgui stays for what a SAP GUI user expects to see as SAP GUI: Easy Access,
the command field, dynpros and selection screens of programs that bring
their own, and the classic transactions as they are.

What is there now, sorted by that rule: SE16 (`ZCL_OSD_SE16`, G.9) and ST05
(`ZCL_OSD_ST05`, G.10) are built in the shape of their transactions, and
ZOSD_NOTE (G.3) proves the webgui loop itself -- they stay. *Tech debt, not
now:* the versions screen (`ZCL_OSD_VERSIONS`, an object's history out of
git) is a service app drawn as webgui HTML. It stays until it needs more
than a fix; then it is rebuilt as a Fiori app over the same ABAP, and the
webgui entry becomes a link to the tile. A rewrite that turns out cheaper
than the fix may be done at once. A Fiori twin of SE16 or ST05 is a new app
under this rule, not a replacement.

```
G.1  SAP Easy Access, served by ABAP                     [S] DONE 2026-09-18
     ├─ /sap/bc/gui/sap/its/webgui/, the path the real ITS webgui answers
     │  on, which is the nod and not an accident
     ├─ ZCL_OSD_WEBGUI (src/webgui/) behind a *.sicf.xml, the same ICF
     │  pattern as packs/lsd and src/icf
     ├─ the tree is read out of the five status tables, so a service added
     │  anywhere appears with no change here; ZOSD_SVC gained a TEXT column
     │  and KIND='APP' rows, both derived from sources that already had them
     ├─ a node has a kind: FOLDER / APP / SERVICE / TRANSACTION
     ├─ the command field resolves server-side against the same node list
     └─ open-abap-gui in as a lib: +301 objects, /src plus three scaffold
        files /src names; escaping on the page is cl_gui_control=>escape_html

G.1b The drop, drawn, and a menu bar that works           [S] DONE 2026-09-18
     Alice, 2026-09-18: "каноническую каплю саповскую нарисуем (но другую -
     диагональную) и меню там тоже реализуй".
     ├─ the drop is drawn in the page as SVG, on a diagonal
        (rotate(38 60 60)) on the panel's own deep blue field: a glossy bead,
        tip and bulb, a nod rather than a copy. Not a bitmap, no second
        request, and in an SVG of its own rather than in the stretched
        background, which would squash it when the splitter moves. Its class
        is `bead` because `.drop` is the menu's fold-out, display:none, and
        the filled path was invisible for one build while the outline beside
        it was not - it read as a gradient that had not applied
     ├─ the menu bar works, as anchors, still no JavaScript on the page:
        System > Status and System > Log off are the URLs of the tree's own
        SM50 and FLP nodes, read through ZCL_OSD_WEBGUI=>TARGET rather than
        typed a second time (the test asserts menu href == tree href),
        Favorites lists the Favorites folder, Help > About is a page of the
        same class at .../webgui/about with the identity, the generation and
        the build. Everything else is greyed, aria-disabled and titled "not
        wired to anything", top-level entries included
     ├─ the splitter is CSS: resize:horizontal on the tree pane (flex:0 0
        auto so the dragged width wins), the image takes what is left. The
        handle is the browser's own corner grip; no drawn bar, because a bar
        that looked draggable and was not is the same lie the menu just
        stopped telling. The browser test drags it
     └─ **the status bar tells the truth** (Alice: "надо правду показывать").
        One source, tools/osd-identity.mjs: the boot sets sy-sysid, sy-mandt
        and sy-uname from it (test/setup.mjs, which every host boots through;
        the browser has no environment, so the build writes the id into the
        bundle and web/preview-backend.mjs hands it over), the status
        snapshot takes ZOSD_SYS-SID from it, and the ADT facade takes its
        identity from it. The bar reads sy and prints
        "OSG (436726) 123 DEVELOPER · node · open-steamgate" - and the tests
        assert it against SystemSet through the status service rather than
        against a string.
        ├─ two names on purpose: OSD_SID is runtime-facing (sy-sysid, the
           status table, default OSG) and STG_ADT_SID is ADT-facing (default
           OS2), because a project stores the id it was created against and
           refuses a logon to a system reporting another one - the trap
           tools/adt-facade.mjs already documents. The facade's client 001
           is pinned for the same reason while the runtime's is 123, which
           is the client data/ is seeded in. STG_ADT_SID still renames both
        └─ the session number is a work process: ZOSD_SYS gained PID, the
           process the tables were written in (inline the facade, otherwise
           the child the snapshot is posted to, by the port it posts to).
           The browser deployment has none and prints no parentheses rather
           than a zero that looks like a session
     └─ SE80 - editing a class from this screen - is later (Alice), and it
        is the ADT facade's editor behind a transaction node, not a new one

G.2  Prove a sapevent click comes back                     [S] DONE 2026-09-18
     ├─ the gap was as measured: nothing in open-abap-gui raised sapevent
     │  on the HTML viewer. The raise is in our fork now, branch
     │  html-viewer-sapevent at 0324e1c (two commits, 496 tests and the
     │  zcl_gg_ex_151 browser spec green there): cl_gui_html_viewer=>
     │  dispatch_sapevent takes the POST, finds the viewer by the hidden
     │  gg_control field every rewritten form carries, strips the
     │  transport's fields, raises with action / getdata / postdata /
     │  query_table on the CNHT types; the rewrite now also covers a
     │  document's own <form action="sapevent:X"> and formaction, which is
     │  how abapGit's forms are written. No PR upstream yet: docs/upstream.md,
     │  "Beside the transpiler", says what it would say
     ├─ the contract was measured against the consumer, not the frontend:
     │  zcl_abapgit_gui_event (256-char lines joined RESPECTING BLANKS,
     │  only %3A %3F %3D %2F %23 %25 %26 undone), so lines fill to 256 and
     │  text stays as typed with % & = escaped. The width SAP GUI fills is
     │  the one unmeasured number; one constant, c_post_data_chunk
     ├─ PROVEN against abapGit's own markup: zcl_abapgit_html (real) writes
     │  the anchors, zcl_abapgit_html_viewer_gui (real) wraps the viewer as
     │  abapGit does, zcl_abapgit_gui_event (real) reads the event, and the
     │  handler repeats the CREATE OBJECT zcl_abapgit_gui=>handle_action
     │  starts with. src/webgui/zcl_osd_sapevent at
     │  /sap/bc/gui/sap/its/webgui/sapevent/; test/sapevent.mjs (browser by
     │  hand, 6) and test/e2e/sapevent.spec.mjs (Chromium clicking inside
     │  the sandboxed frame, 3): anchor -> action select, getdata key=...,
     │  query {KEY}; the New Online Repository form -> action
     │  add-repo-online, postdata = the document's fields only, form_data( )
     │  = the typed values; a side action's formaction is its own event; a
     │  700-char value fills 256-char lines and abapGit joins them back
     ├─ NOT proven, and said so in the class header and docs/webgui.md: the
     │  form itself is a copy of what zcl_abapgit_html_form writes, because
     │  that class reaches zcl_abapgit_ui_factory and with it 371 of
     │  abapGit's 592 objects by name, as does zcl_abapgit_gui and every
     │  page class; zcl_abapgit_gui=>on_event itself is absent for the same
     │  reason. abapGit's own CI transpiles the whole tree with
     │  open-abap-gui + open-abap-seo + abapGit-web-classic under
     │  unknownTypes: runtimeError, so the closure is a build decision
     │  (compileError, the pack/delta half only), not a GUI gap: G.4's lift
     ├─ found on the way and fixed in the fork: show_url of what load_data
     │  assigned showed the url's text, so abapGit's own page flow drew
     │  "abapgit.html" (ANOMALY-2026-09-18-html-viewer-show-url)
     └─ state between GET and POST is class data of the harness, one
        document per process: enough for a proof, and exactly G.3's step 3

G.3  A transaction node that actually runs                 [S] DONE 2026-09-18
     ├─ the registry is derived, like every other one here:
     │  tools/osd-tran-registry.mjs reads *.tran.xml out of the input
     │  layers the way osd-icf.mjs reads *.sicf.xml, and writes
     │  gen/tran/zcl_osd_tran_registry -- the list, and a generated CASE
     │  doing a static CREATE OBJECT per runnable code, for the reason
     │  zcl_osd_fm_call is generated
     ├─ **the rule for runnable**: TSTCP-PARAM names \CLASS=..\METHOD=..,
     │  which is SE93's own "transaction with class method" form and what
     │  zcl_abapgit_object_tran serialises, the class is in the tree, and
     │  it implements ZIF_OSD_TRANSACTION. A report is refused with
     │  "SUBMIT is not implemented by the transpiler" -- measured, not
     │  assumed: statements/submit.ts is one throw and call_transaction.ts
     │  is a no-op -- and a dynpro with "there is no dynpro processor
     │  here". ZABAPGIT stays typed out and now says what it is missing
     │  (no zabapgit.tran.xml in this tree), which is G.4's lift
     ├─ page( iv_body ): the left pane was hard-wired to branch( ), so a
     │  transaction had nowhere to draw. The tree is the default body and
     │  the screen keeps its title bar, menu, command field and status bar
     │  around whatever is running
     ├─ **the state between two requests is a row, not a pinned process**
     │  (ZOSD_TSES, keyed by a uuid, holding what ROLL_OUT wrote). Weighed
     │  against the pin on four things that happen here: the browser
     │  preview has no pool to pin to, a recycle mid-conversation takes
     │  class data with it, two browsers are two rows and cannot collide,
     │  and a process cannot expire anything while a TOUCHED column can
     │  (30 minutes idle, swept on every start). ZOSD_SYS-PID goes into the
     │  row so a session that moved between processes is readable, and
     │  nothing routes by it. Given up: no live object graph across a step
     │  -- the state must survive /ui2/cl_json -- and no affinity
     ├─ one step is the dynpro cycle: roll in, PBO, dispatch_sapevent into
     │  the viewer PBO just rebuilt, PBO again, render_html, roll out. The
     │  session id rides in cl_gui_control=>ty_sapevent-fields, so the
     │  rewrite writes it as a hidden field and dispatch strips it back out
     ├─ the demonstration is ZOSD_NOTE, the session notepad (a field, Add,
     │  the list) -- the smallest thing that proves the loop, not abapGit
     └─ tests: test/transaction.mjs (11, browser by hand),
        test/e2e/transaction.spec.mjs (4, Chromium, two contexts for two
        sessions), ltcl_session in
        src/webgui/zcl_osd_tran_session.clas.testclasses.abap (6) -- expiry
        is there because only ABAP inside the system can age a row without
        waiting half an hour

G.4  abapGit through the substitutes                                   [S+A]
     └─ G.3 built the seat: a *.tran.xml naming a class that implements
        ZIF_OSD_TRANSACTION is entered and drawn, so what abapGit needs
        from this side is that tran object, a class whose PBO builds
        zcl_abapgit_gui's viewer, and ROLL_IN/ROLL_OUT over its page
        stack. What it needs from the other side is the closure.
     └─ blocked on G.2 by choice. It should arrive as a transaction rather
        than as a page with a URL of its own, because that is how a system
        works; and what stops it is not the GUI layer (31 todo stubs in
        open-abap-gui/src, 20 of them in cl_salv_form_*, none in the
        container/viewer/frontend-services path) but the SAP APIs abapGit
        wants underneath. That is a closure audit, not a screen.
```

---

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

## W.1 second sieve — the SQL a system actually ran (2026-09-19)

`STG_SQL_TRACE=<file.ndjson>` records every statement the chosen client is
asked for; `npm run sql:compare -- a.ndjson b.ndjson [--rule literals]`
compares two of them. `tools/osd-sql-trace.mjs`, suite `test/sql-trace.mjs`.

**Why this sieve and not another.** The database seam is the one place where
being wrong is invisible from outside: a missing MANDT, a different ORDER BY,
an N+1 where the system issues one statement, a different FOR ALL ENTRIES
chunking — every one can produce the right answer by accident and none of
them shows in a response body. And our side is nearly free, because all
transpiled ABAP talks to exactly one object with eleven methods, so there is
one interception point and no new protocol.

The tracer is installed in `test/setup.mjs` rather than in a client. Six
paths there choose six different clients, and a tracer written into one of
them is a tracer the other five do not have.

**Calibrated, not asserted.** Two `npm run unit` runs, in two processes,
7075 statements each:

- before any rule but whitespace: **34 of 7075 differ**, first at 5398
- every one of the 34 came from `ZOSD_TSES` — a session id built from the
  clock, its `created`/`touched` stamps, and the 16 reads carrying that id
  in a WHERE
- with one rule for exactly that: **identical, 7075 statements**

The rule is narrow on purpose — a 32-digit run and a date-shaped 14-digit
stamp, never `\d+` — and the suite asserts both halves: that two runs differ
without it, and that a `LIMIT 100`, a row count and an eight-digit key
survive it. The first sieve nearly masked its own row counts with a rule
that wide, and a check that cries wolf gets turned off.

Literals are **not** masked by default. Two systems of ours hold the same
data, so a different value is a difference until somebody says otherwise;
`--rule literals` is for the day the other side is a real system.

**What is left for O.1**: the other half, an ST05 or ADT trace taken on A4H
and brought to the same canonical form. That needs the sandbox and therefore
an ask — the cheap half is done and the ask is now a single one.

### G.10 wave 1 — the analysis, before the screen (2026-09-19)

`npm run sql:summary -- <trace.ndjson>` reads a trace the second sieve wrote
and answers the two questions a trace is opened for: **where the request
went** (per table: count, milliseconds, rows) and **what it did twice**.

Written before the page deliberately. The backlog's own warning about G.10 is
that a screen built first is "a handsome page with no consumer and no
normaliser behind it"; the normaliser is `tools/osd-sql-trace.mjs` and the
analysis is now beside it, so the screen is a rendering job rather than the
work.

The tracer gained what a screen needs and a log alone does not: a **duration**
timed around the call, the **table** taken from the seam's own options where
it gives one (a regular expression over SQL is a guess; `insert({table})` is
not), and the **row count**. A statement that RAISED is recorded too — it is
exactly the one somebody opens a trace for.

`repeated` is the entry the response sieve cannot produce at all: the same
statement with only its values differing, run n times. The answer is right
and the system did the work n times, so nothing shows in a response body. It
is found by counting canonical statements with the literals masked, which is
the one place masking literals is the point rather than a concession.

**First run, on `npm run unit` (6793 statements, 1563 ms):**

```
2263x  217 ms  INSERT INTO "wbcrossgt" (...)
1537x  175 ms  INSERT INTO "tadir" (...)
 906x  161 ms  INSERT INTO reposrc (...)
```

4706 of 6793 statements and 553 of 1563 ms are three tables seeded one row at
a time. Whether that is worth batching is a separate question — a count is
not a defect, and a seed writing one row per object is not surprising — but
it is now a number instead of a feeling, and it is where a third of the
database time of every unit run goes.

### G.10 wave 2 — the buffer, and where a trace may not live (2026-09-19)

`tools/osd-sql-trace-buffer.mjs`: a bounded ring in the host, and a
destination an ABAP screen calls the way the AMDP tile calls HANA —
`CALL FUNCTION 'ZOSD_SQL_TRACE' DESTINATION 'SQLTRACE'` with
`START / STOP / CLEAR / LIST / SUMMARY`. Registered in `test/setup.mjs`, on
the server path and in the browser preview both. Suite
`test/sql-trace-buffer.mjs`.

**Why the buffer is not a DDIC table**, which was the obvious design and
would have made the screen ordinary ABAP with an ordinary SELECT:

- the tracer sits on the one connection every statement goes through, so a
  trace row would trace itself
- a trace row written inside an open LUW is **lost when that LUW rolls back**
  and **changes the commit shape when it does not** — which is the exact
  thing the trace is measuring

A measurement that takes part in what it measures is not one. So the ring is
in the host, bounded, and it counts what it dropped: a screen that shows
three of five statements without saying so is lying quietly.

**Installed always, free while off.** The screen turns tracing on at runtime,
so the wrapper has to be in place at all times; `enabled` is checked first
and the call goes straight through. Measured over 200 000 calls:

```
no wrapper      0.06 us/call
wrapper, off    0.08 us/call     +0.02
wrapper, on     0.38 us/call     +0.31
```

0.02 µs a call is 0.14 ms over the 6793 statements of a whole unit run.

**What is left, and the reason it is a separate wave.** The screen itself.
ABAP has no JSON reader here — `zcl_stg_json` writes, it does not parse — so
the rows reach ABAP one of two ways, and the choice is not free:

1. a **DDIC structure** for a trace row and a `TABLES` parameter, which is
   the honest signature and costs a DDIC object plus a function-group XML
2. the **`zcl_osd_webgui` precedent**: the host writes rows into a table and
   ABAP reads them with Open SQL — but the write must be flushed at
   screen-read time with the ring paused, or it lands in the trace it is
   writing

**Counted, because "cheaper" was an opinion** (osg-osd-i7 asked for the price
in objects, which is the right question):

| route | files | repository objects |
| --- | --- | --- |
| structure + `TABLES` | 7 | 2 — one INTTAB structure, one function group |
| scalar strings (the AMDP precedent) | 6 | 1 — one function group |
| a table ABAP reads with Open SQL | 1 + flush plumbing + a ring-pause | 1 transparent table |

The details that settle it, all read off the tree rather than assumed:

- a `TABLES` parameter names the structure **directly** (`<DBSTRUCT>`), so no
  table type object is needed
- a structure whose fields use built-in types (`INTTYPE`/`DATATYPE`) needs
  **no data elements** — `ZOSD_TEST_ITEM_S` mixes both and proves it
- a function group is **six files** whichever route is taken: the `.fugr.xml`,
  the TOP include pair, the main program pair, and one `.abap` per module
- a destination may answer a `TABLES` parameter: the direction comes from the
  caller's signature at call time (`tools/rfc-replay.mjs`), which is the same
  mechanism the AMDP tile already uses

So the typed route costs **one file and one object more** than the cheapest
honest alternative. And the third route's cheapness was never real: a
persisted DDIC table, flush plumbing, a ring-pause, and a trace that lives
where it can take part in the run — more than the other two, not less.

**Decided: the structure and `TABLES`.** One extra object buys a signature
that says what a trace row is, and the alternative to it was a saving of one
file.

### G.10 wave 3 — the screen, at /sap/bc/osd/st05/ (2026-09-19)

`ZCL_OSD_ST05` over `ZOSD_SQL_TRACE DESTINATION 'SQLTRACE'`, rows typed by
`ZOSD_SQLTRACE_S`. Start, use the system, read what it ran. Measured live:
7 statements after one OData read and one SE16 page, and the summary naming
ZSTG_DEMO 2 statements / 8 rows, ZSTG_STATUS 1 / 3.

Cost, against the estimate: **7 files, 2 objects**, exactly as counted.

Three defects on the way, and all three were of one kind -- **a contract I
had invented rather than read**:

- the destination returned `{EXPORTING: {...}}`. A destination does not
  return an answer; it **fills the caller's typed values**, the directions
  are ABAP's in lower case, and the ABAP `EXPORTING` is the module's INPUT
  (`tools/rfc-replay.mjs` is the reference). My unit tests passed because
  they asked the invention what the invention did.
- the parameter name was matched **with** case. `IV_COMMAND` was never
  found, every command fell back to the default, and so the screen rendered,
  said "off", showed no error, and every button did the same thing. **A
  lookup that misses returns a default, and a default is indistinguishable
  from an answer.**
- the table fixture in the test had `append` making its own row, so
  `fromJson` never touched it. The second fixture was written from the
  reference implementation instead of from memory.

The fourth was somebody else's contract read correctly and mine written
loosely: `esc( )` typed `string` refuses a DDIC `CHAR`, which the syntax
check said before anything ran -- which is the whole reason the row is typed.

And one defect in the generator, found because a structure was added:
`tools/cds2ddic.mjs` wrote a table-access class for **every** TABL, INTTAB
included. A structure is not a table, and for a **keyless** one it wrote a
`DELETE` with no WHERE, which does not parse and stopped the build. The
class it had written for `ZOSD_TEST_ITEM_S` had been there all along, with
nothing referencing it: an object generated from a thing it should not have
been generated from, waiting for the first structure without a key.
