# Backlog

Everything open, as a tree, with who owns it and what it waits on.
Written 2026-09-13. `AGENDA.md` stays the narrative record of what was
decided and why; this is the list.

Owners: **S** open-steamgate (this session's repository), **T** the
transpiler session (`src/segw/**`, the ABAP generators, connectivity, APC),
**V** vsp (the Go bridge, the only thing that touches a real system),
**A** Alice — a decision nobody else can take.

---

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
1.5  layers: the binary takes an ordered list of abapGit src paths   [S+A]
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
8.6  source maps, so a failure names her ABAP line not our .mjs      [S]
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
