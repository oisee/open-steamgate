
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
     ├─ **Container acceptance, 2026-09-20:** a schema-bound test client now
     │  sends a real SADT_REST_RFC_ENDPOINT call through the published 33nn
     │  port and validates OSD's HTTP response. The generic `orfc` path still
     │  fails: its recursive codec needs RFC_METADATA_GET, which the pinned
     │  bridge does not serve. Add compatible deep-metadata discovery and
     │  a generic-client regression test; the explicit-schema probe is not
     │  evidence that discovery works. Generic `orfc ping` also encounters
     │  FU_NOT_FOUND during interface discovery; transport logon/ping works.
     ├─ `rfc call SADT_REST_RFC_ENDPOINT` stops in the client's own classic
     │  structure codec: "classic RFC type v is not implemented"
     ├─ this function's parameters are recursive and travel as BASXML; the
     │  client has that codec (internal/xrfc) but `rfc call` does not use it
     └─ the bridge is not in the way — this is client work, and it would make
        the bridge drivable from a script as well as from Eclipse

A.13 abap-fs over RFC: a client that needs no ADT on HTTPS      [R/S]  new 09-19
     Alice, 2026-09-19: teach the VS Code client to reach a system
     **directly over RFC**, so a system whose ICF is closed -- which is most
     of them -- is still editable. The protocol half is measured and written
     down already (`docs/adt-over-rfc.md`): a Custom Application Server
     project tunnels every ADT request inside one call of
     `SADT_REST_RFC_ENDPOINT`, whose two parameters are an HTTP request and
     an HTTP response. What is new is the **direction**: the bridge we have
     *accepts* that call from Eclipse and speaks HTTP outward; this needs a
     client that *makes* it.
     ├─ **the cheap shape changes nothing in anybody's editor: a sidecar.**
     │  A local process listens on `127.0.0.1`, takes an ordinary ADT
     │  request and forwards it as one `SADT_REST_RFC_ENDPOINT` call.
     │  `abap-adt-api` is then pointed at `http://127.0.0.1:<port>` and does
     │  not know the difference; neither does Eclipse, nor vsp, nor a curl.
     │  **No upstream change is needed to have the feature at all**, which
     │  is this estimate's hinge
     ├─ **what it actually costs is A.4b**, and that is where the work is:
     │  `rfc call SADT_REST_RFC_ENDPOINT` stops in open-rfc's classic
     │  structure codec, because the parameters are recursive and travel as
     │  BASXML. The codec exists (`internal/xrfc`); `rfc call` does not use
     │  it. Until that is done there is no RFC client to build a sidecar on;
     │  after it, the sidecar is a day
     ├─ **then three questions that are measurements rather than opinions**,
     │  each with a known place to look:
     │  ├─ *session*: ADT is stateful over cookies, CSRF and
     │  │  `sap-contextid`. Over RFC those ride in the header table, and A.5
     │  │  records that Eclipse opens several connections at once with a jar
     │  │  each -- so a lock/write/activate has to land in one context.
     │  │  Reads first; writes only after A.5
     │  ├─ *bodies*: the body field is `RSTR`, so binary is free and HTTP
     │  │  chunking does not exist -- but a 606 KB answer was already seen
     │  │  split across records (B.5), and the sidecar must reassemble
     │  └─ *logon*: the sidecar needs the credentials the extension already
     │     has. Taking them from the client's own settings rather than from
     │     a second file is the difference between a demo and a thing people
     │     use -- and it is also the place where a secret would leak
     ├─ **the upstream half, small if it is wanted**: `abap-adt-api` (MIT,
     │  8.4.3, marcellourbani/abap-adt-api) builds every call on one HTTP
     │  client. A pluggable transport there, plus a setting in
     │  `vscode-abap-remote-fs` that starts the sidecar, turns "run this
     │  proxy yourself" into a checkbox. Offer it only **after** the sidecar
     │  has worked against a real system, with the measurement in hand: an
     │  upstream PR whose premise is untested is the shape our own critic
     │  rejects
     ├─ **and the honest boundary**, which decides whether it is worth
     │  doing: it buys **reachability, not coverage**. A client that could
     │  not open a port now can; a client that refuses to show a button
     │  still refuses. Most façade failures are decided in the client
     │  (`docs/adt-facade.md`), and no transport changes that
     └─ **ranking, the subaltern's version**: A.4b first, because it is the
        real cost; the sidecar second, a day; upstream third, small and only
        with a measurement; **native RFC inside Node never** -- that is
        `node-rfc` plus SAP's own SDK, a licence and a C++ addon in a place
        where a separate process does the job

A.14 Coverage by driving a real client, with A4H as the oracle  [S/R]  new 09-19
     Alice, 2026-09-19: Eclipse is awkward as a 1:1 oracle, so drive the
     **VS Code** client instead -- and fuzz, or rather use it meaningfully.
     ├─ **do not simulate the editor.** `vscode-abap-remote-fs` is a shell
     │  over `abap-adt-api` (MIT, 8.4.3), which is an ordinary typed library:
     │  logon, nodeContents, objectStructure, getObjectSource, lock /
     │  setObjectSource / activate / unLock, searchObject, findObjectPath,
     │  syntaxCheck, unitTestRun, transports. **Its method surface IS the
     │  client's vocabulary**, so "simulating what a person does in VS Code"
     │  is calling those in the order the extension calls them -- two orders
     │  of magnitude cheaper than automating an Electron window, and
     │  deterministic
     ├─ **fuzzing: the wrong tool first, the right one second.** Blind URL
     │  fuzzing buys 404s we already collect for free -- the façade records
     │  every unanswered path and `/osd/not-served` ranks them. The yield is
     │  in **parameters of calls the client really makes**: `version=active`
     │  against `inactive`, `withShortDescriptions`, the facet and depth of
     │  a node list, `Accept` and the document versions (`…v3+xml` against
     │  v2), `If-Match` and etags, a lock handle reused or stale. That is
     │  where a client gives up silently rather than loudly
     ├─ **the oracle is a second run, not a second instrument**: the same
     │  script against OSD and against A4H through a recording proxy, then
     │  the comparison machinery W.1 already has -- normalise, diff, and an
     │  approved difference carries a reason from the start. Captures stay
     │  under `.local/`; only protocol facts reach the repository
     ├─ **three routes, one vocabulary**, which is what makes this worth
     │  building rather than scripting once: HTTPS to OSD, HTTPS to A4H
     │  through the proxy, and RFC to A4H through A.13's sidecar. A
     │  difference between routes is as interesting as a difference between
     │  systems
     ├─ **first artefact, and it needs no sandbox**: a driver that runs the
     │  scripted sequences against one URL and writes one line per call --
     │  method, arguments, status, a digest of the normalised body. Run
     │  against OSD alone it already prints the worklist, ranked by what a
     │  real client does most. Only the second run needs A4H, and that is
     │  the ask
     ├─ **a call the client refused is a third value, not a match**
     │  (fable-osd, 2026-09-19, and it is the sharpest thing in this entry):
     │  a call neither side made produces nothing on **both** sides, and
     │  "both silent" reads as agreement. The harness has to write "not
     │  attempted" as its own value the way every other instrument here
     │  writes "not measured" -- otherwise the coverage number counts the
     │  calls nobody dared make as successes
     └─ **the boundary, stated before the work**: driving the library
        measures **the server's surface**, not the client's willingness.
        Most façade failures are decided client-side -- the extension does
        not call, and a capture shows nothing -- so this closes "we answer
        wrongly" and leaves "the client refused" to reading the client's own
        bundle. Two different instruments; naming which one is being bought
        is half the estimate.
        **And the gates are NOT in the library**: they are in the extension
        above it, which decides whether to call at all. Driving
        `abap-adt-api` therefore reproduces the client's *vocabulary* and
        not its *judgement* -- which is precisely why the boundary above
        holds and why "including the client's gates" would be the wrong
        claim to make for this harness

A.5  Stateful session affinity across parallel connections               [R]
     ├─ Eclipse opens many RFC connections at once; each gets its own cookie
     │  jar and CSRF token today, which is correct for isolation and wrong
     │  for a lock/write/activate that must land in one ADT context
     ├─ the real client carries sap-adt-connection-id; we do not use it
     └─ needed before writes-over-RFC are trustworthy, not before reads

A.6  Debugger endpoints                                                  [S]
     ├─ debugger/listeners is a long poll and the second most frequent call
     │  in a real session; breakpoints is a POST
     ├─ answering them emptily is most of the value: it stops the client
     │  retrying, and debugging can stay unimplemented for a long time
     └─ **the message schemas are shared with O.2** and the two must be
        written together. A.6 is us *answering* `debugger/listeners` and
        `breakpoints`; O.2 is us *calling* the same endpoints on A4H to
        record a step trace. Done apart, the schemas get written twice and
        drift. Note also that the entry carries two different sizes under
        one number: answering emptily is small, being the oracle's client
        is not

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

A.11 One file, one lock: INCL X and PROG X                      [S] should
     ├─ both name the same file in the store, but the lock argument is
     │  (type, name), so INCL X and PROG X are two locks: two sessions can
     │  each take one and both write the same source
     ├─ found by the slice-2 review of the ADT lock route (#432); the Node
     │  façade's own lock table has the same gap
     └─ fix idea: lock by the store file (or the entry the file belongs
        to), not by type and name, in EZOSD_ADT_OBJ and in the Node table
```

---

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
open  revisions: reading them out of git instead of a system -- designed below,
      "Versions of an object, read out of git (2026-09-30)".
```


## Versions of an object, read out of git (2026-09-30)

Alice, 2026-09-30: the version API inside ABAP should reach the host and land on the git layer.
Today nothing does. There is no `SVRS_GET_VERSION_DIRECTORY*` or `SVRS_GET_REPS_FROM_OBJECT`, no `VRSD`,
and the ADT facade has no versions feed. Eclipse's Revision History and vsp get nothing.
The design stays a thin layer over the files: versions are not stored anywhere, git answers.

- **Host history service.** Object name to its files, in layer order (the winning folder), then
  `git log --follow` over them and `git show <commit>:<file>`. Version = commit. The active version is the
  working tree; an unsaved edit is "inactive". Cached per HEAD.
- **ABAP side.** Clean-room substitutes for `SVRS_GET_VERSION_DIRECTORY_46` / `SVRS_GET_REPS_FROM_OBJECT`
  through a kernel hook, to SAP's contract. They return `VRSD`-shaped rows: version number, author, date/time,
  and the short commit SHA in `KORRNUM`. Standard ABAP that compares versions then works over git.
- **ADT facade.** `.../source/main/versions` (Atom, one entry per commit) and reading one version's source,
  so Revision History and "Compare with..." work in Eclipse and vsp.
- **VS Code** needs nothing: it already has git.
- **Author.** The commit author, mapped to a SAP user name. No e-mail, per the repository's identity rule.
- **Outside git** (a pack without `.git`, the browser preview): an honest "no history" answer, never an empty
  list that reads as "never changed".
- First consumer of the lazy table providers (gogen-osgo.md, "Lazy table providers"): `VRSD` by key, provider
  = git log, invalidated on a HEAD change.
- Order: after track O. Measure the contract on A4H first (P-probe of the FMs' signatures and a VRSD row),
  per the clean-room rule.
- **Done 2026-09-30 (stoker): the host history service.** `ZOSD_STORE` `HISTORY` / `REVISION` on Node and Go,
  `ZCL_OSD_VERSIONS` as a thin reader ([`docs/object-versions.md`](../object-versions.md)).
- **Done 2026-09-30 (stoker): the ADT versions feed.** `…/source/main/versions` and `…/includes/<include>/versions`,
  each version's content, and the `relations/versions` links where the A4H corpus has them. Next: the `SVRS_*`
  substitutes on the provider registry.

## Logon: open by design now, checked credentials later (2026-10-02)

- **Now (Alice, 2026-10-02): the system is open on purpose.** The ADT façade accepts any user and password,
  or none (`tools/adt-session.mjs`). What keeps it local is the bind: every listener goes through `OSD_BIND`,
  which defaults to loopback (127.0.0.1 and ::1), so a system started by the VS Code extension, `osd up` or
  `npm start` is not reachable from the network. Opening it is deliberate: set `OSD_BIND=0.0.0.0`. Clients
  such as ABAP-FS and vsp may send a placeholder user, and the system accepts it.
- **Docker Compose is a separate question.** A container can listen beyond loopback. Its exposure is settled in
  the compose files and the deployment docs when we get there, not in the façade.
- **Later: checked credentials, opt in.** A system setting holds a user and a password (or several users). When
  it is set, the façade checks Basic credentials on logon and answers 401 to anything else. When it is not set,
  the system stays open, as now. Points to settle then:
  - where the secret lives: never in a tracked file, an argv or a log;
  - whether the ABAP side sees the logged-on user as `sy-uname`;
  - how the extension passes it to its own system, so the local case stays without a prompt.

## An ABAP development API, and GENERATE SUBROUTINE POOL (2026-10-02)

Design note: [`docs/abap-development-api.md`](../abap-development-api.md). For ABAPiti (run-time CLAS, PROG,
FUGR and FUNC) and its self-hosted compiler (GENERATE from M2). Labels follow "only must blocks a tag".

- in progress elsewhere, labelled there (ABAPiti M1): GENERATE SUBROUTINE POOL refused the kernel's way: sy-subrc 8,
  MESSAGE "not supported", no exception, on JS and Go (`feat/gogen-generate-refusal`).
- should (0.8, prep for P2 and P5): P0, the A4H probes: the dev-system signal (T000 CCCATEGORY / CCCORACTIV / CCNOCLIIND, the system
  change option; UNMEASURED), LINE/WORD for more error kinds, PERFORM USING. The pool name and per-session limit
  are measured (#469). [S]
- must (0.8): P2, `ZCL_OSD_DEVELOPMENT` as the layer under the ADT write routes (create, write, activate verdict,
  delete, lock through ENQ), `ZCX_OSD_DEVELOPMENT` with per-line messages, writes only in a development system.
  After slice 3's adapter and group A's host commands. [M]
- should (0.8): P3, publish after the step: a `publish` continuation (front-up's registry, stoker's 4b) and an
  after-step queue in `tools/osd-dialog-step.mjs` for non-ADT entries. After #466. [M]
- must (0.8): P4, the fast path: a new object with no dependents and no generator reading it is transpiled alone
  against the warm registry and loaded without a swap or a recycle, with its own cold-transpile check. [M]
- should (0.8): P5, GENERATE SUBROUTINE POOL on P4: transient pools outside `$TMP` and the layer list, `%_Txxxxx`
  names, subrc 4 / LINE / WORD from the check, lifetime of the internal session, PERFORM USING fixed. The preview
  and OSGo keep the refusal. [M]
- nice: P6, FUGR and FUNC creation (always cold, live after the step). [M]

## Reentrance ticket: timestamp arithmetic (2026-10-03, A3b)

Not an SAP/open-abap discrepancy (nothing was measured on a system), so it
lives here rather than in ANORMALIES: the reentrance route needs epoch
milliseconds, and `CL_ABAP_TSTMP=>SUBTRACT` on the locked open-abap-core
returns whole seconds. Owner: adt-i5. Open question for whoever needs it: what
SUBTRACT returns on a real kernel (an A4H probe; not a blocker).


- Status: `documented`; the route retains millisecond arithmetic.
- Discovery date: `2026-10-03`; corrected after critic round 1.
- Affected API: `CL_ABAP_TSTMP=>SUBTRACT` in open-abap-core at
  `8b397be863e805182c32e4bbb8bedbd291619f58` (`libs.lock.json`), whose
  return type is `i` (whole seconds).
- Executable observation: `subtract_precision` in
  `src/adt/zcl_osd_adt_reentrance.clas.testclasses.abap`, registered in
  `test/adt-abap-a3b.mjs`. Both operands are `TIMESTAMPL`: literal
  `20261003123456.9980000` and epoch `19700101000000.0000000`.
  SUBTRACT returns `1791030896`; multiplying by 1000 gives `1791030896000`,
  losing 998 milliseconds. The same test calls SUBTRACT with a live
  `GET TIME STAMP FIELD` value and verifies the discarded fraction.
- Exact command (after `npm run transpile`): `OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 tools/osd-heavy.sh node_modules/.bin/mocha test/adt-abap-a3b.mjs --grep subtract_precision`.
- Expected route arithmetic: milliseconds since 1970, within the request's
  time window. This is the Node route's numeric contract, not a new
  SAP-system measurement or a claim that SUBTRACT promises milliseconds.
- Correction: the initial implementation was reported to answer 500 with
  `The number NaN cannot be converted to a BigInt because it is not an integer`.
  Its exact original operands and assignment were not preserved. Literal
  and live long-timestamp probes on the locked substrate do not reproduce
  that dump. The `default clock` route test bypasses SUBTRACT and is a
  regression test, not a reproducer of the reported dump.
- Route implementation: calculate UTC epoch milliseconds from date and
  time differences, adding the first three fractional digits as text. For
  the literal above, `unix_ms` returns `1791030896998`. Retained to satisfy
  the millisecond contract and avoid the packed-to-Number precision loss
  documented in the A2 timestamp observation above; no runtime change.
- Regression: `test/adt-abap-a3b.mjs`, `clock`, `subtract_precision` and
  `default clock`.
- Upstream: none; whole-second return is the locked API's declared contract,
  and the originally reported dump is unconfirmed.

## Open items from the clean-room acceptance run (2026-10-03)

- should: **create answers like SAP.** On the A4H sandbox `POST programs/programs`
  answered 200 with no content type and an empty body; our facade answers 201
  with `Location`. Align to SAP (clients are written against it and cannot
  expect `Location`), after checking that the VS Code extension, the ABAP-FS
  bridge and our tests do not read `Location` after a create. Low priority,
  after the activation and active/inactive slices. [S] Owner: adt-i5.
- nice: **a stale read after PUT was not reproduced.** One whole-fragment run
  under `OSD_ADT_ONE_RUNTIME=1`, with four other heavy runs on the host, saw
  `adt-devloop` read the old source right after a PUT (and two 404s after it).
  It did not recur: the fragment passed under CPU load, and with a one-second
  delay injected into the write path every PUT -> GET read the new source. If
  it recurs, run the whole adt.json fragment in one-runtime mode with three
  more fragment runs in parallel and capture the source-read/write trace.
  Owner: adt-i5.
- nice: **`test/start.mjs`'s inline front does not record dumps.** It logs a
  dump without writing it; if one-runtime ever runs through it, it needs the
  shared recorder in `tools/osd-dumps.mjs` (#561). Owner: adt-i5.

