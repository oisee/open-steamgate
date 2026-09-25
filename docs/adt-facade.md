# The ADT façade: what OSD answers, and the contract a client can rely on

OSD exposes an ADT HTTP surface over an abapGit-shaped source tree. A client
can browse objects, read and edit the supported source kinds, ask for checks
and activation, run ABAP Unit and preview data. The façade is JavaScript
(`tools/adt-facade.mjs` over the object store in `tools/osd-store.mjs`): it
reads the file system and calls abaplint and the transpiler, neither of which
transpiled ABAP could do. The OData front stays ABAP behind the ICF shim on the
same listener, so one address serves both.

The façade is useful without an SAP installation. It is not a complete SAP
repository implementation and not a substitute for compatibility testing
against the SAP releases a client supports.

This page has two halves. The first is the map: what the façade is for, what
it answers today, how activation and persistence work, and how a new client
should be tested against it. The second is the contract, endpoint by endpoint,
for whoever writes such a client. The server's own measured coverage, test by
test, is [adt-surface.md](adt-surface.md); what remains open is in
[backlog.md](backlog.md).

## Why this matters to abapGit

The [Road to the Cloud roadmap](https://github.com/abapGit/abapGit/issues/7880)
describes one abapGit codebase across classic ABAP, Cloud and external hosts,
with environment adapters and ADT-based repository operations. OSD can be the
local target for developing and testing those ADT client adapters: a system
that answers ADT, lands every change on a git tree as abapGit files, and needs
nothing installed beyond Node.

The responsibilities are distinct:

```text
abapGit on an external host / Eclipse / vsp
                    |
                 ADT HTTP
                    |
             OSD ADT façade
               /         \
    repository store      check / build / unit / data
           |                         |
   configured source roots     toolchain and runtime
```

An ADT-backed abapGit object handler is a client of this surface. OSD's store
maps the supported operations to local files; it does not implement Cloud's
repository APIs inside an SAP system. Local tests establish client/server
agreement; SAP Cloud authorization, released APIs, transports and
release-specific behaviour still need the corresponding systems.

AFF is a separate serialization concern: reading abapGit XML or serving an ADT
document says nothing about AFF import or export. Package browsing likewise
covers the local package model and not the whole of TADIR.

## Starting and inspecting an instance

From a prepared development checkout (prerequisites, packs and the release
launchers are in [Using OSD](using-osd.md)):

```sh
npm start            # transpile, then serve on 3030
npm run dev          # the same, and rebuild + recycle whenever ABAP changes
npm run osd:serve    # the same workbench on 8099
build/osd up         # the compiled binary, same shape, port from STG_PORT
```

`STG_PORT` chooses the port (`test/start.mjs`, default 3030; `osd:serve` sets
8099). ADT lives under `/sap/bc/adt/`; the launchpad and OData are on the same
listener.

`GET /sap/bc/adt/core/http/build` reports the façade's own build stamp, the
live generation and three hashes of the system: `source` (what a build of the
tree would produce now), `live` (the generation on disk) and `serving` (what
the runtime child actually runs). `source` ahead of `live` means unbuilt saves;
`live` ahead of `serving` means a build that went live without a recycle.
Diagnose a stale answer by comparing the three before suspecting the client.

The system identity is `OS2` by default; `STG_ADT_SID` changes it. A client
compares the id it stored when the project was created with the one the
system reports and refuses the logon when they differ, so the id is a default
in the code rather than something a restart has to remember. Change it only
together with the projects that point at it. `OSD` is the product, `OS2` the
system.

## Capabilities and boundaries

| Operation | Current implementation | Qualification |
| --- | --- | --- |
| Sessions, CSRF, discovery, compatibility graph | Implemented | Cookies and the stateful context are kept through a mutation |
| Package tree, node structure, search, virtual folders | Implemented | The local package model, not a full TADIR |
| Source reads, class includes, object structure | Implemented for the source-backed types | Editor documents and include aliases are client-sensitive |
| Lock, source write, unlock | Implemented for the source-backed types | Session-bound local locks; no system-wide enqueue |
| Syntax checks | abaplint, over the stored object or a supplied buffer | Not the SAP compiler; the supported language subset applies |
| Activation | The check over the object and its dependents, then an awaited publication | The verdict is in the response document, not in the status code |
| ABAP Unit | Detached execution in a child runtime | Isolation and generation selection belong to the unit/runtime layer |
| Table, CDS and freestyle data preview | Implemented | SQL/CDS coverage is a separate axis from ADT coverage |
| Create and delete | CLAS, INTF, PROG, INCL, DDLS, DEVC | A route answering is not the same as an IDE wizard completing |
| Runtime dumps, system messages, gateway error log | Empty feeds | The runtime's own `/osd/dumps` is a separate API, not ST22 |
| Transport checks | Answers that nothing would carry the object and nothing needs to | No transport organiser |
| Authorizations, debugger, jobs, spool | Not implemented | Not advertised in discovery |

Discovery and the compatibility graph are client gates: a client reads them to
decide what to attempt. A collection is advertised only when it works, and an
advertised collection still says nothing about every operation or document
version under it. A run of vsp certifies vsp; Eclipse, VS Code and an abapGit
adapter each need their own run.

### Five endpoints that are OSD's, not ADT's: do not carry them into the proxy

The Workbench app (`webapp/workbench/`) reads five endpoints that OSD made up
and put under the ADT prefix. A real system answers 404 on each of them, so
the ADT proxy (`ultra/adt-proxy`, the planned way to reach a real system) must
**not** forward, fake or reimplement them (host-tools review 2026-09-25, H7a):

| Endpoint | What it answers here |
| --- | --- |
| `GET /sap/bc/adt/core/http/build` | the facade's build stamp and the generation it serves |
| `GET /sap/bc/adt/core/http/git/object` | the git state of an object's files in the host checkout |
| `GET /sap/bc/adt/core/http/git/object/revision` | one revision of an object's source out of git |
| `GET /sap/bc/adt/core/http/unit/object` | the test classes and methods of an object |
| `POST /sap/bc/adt/core/http/unit/object/run` | a run of those tests in a child runtime |

The genuine ADT endpoints nearby (`core/http/sessions`,
`core/http/systeminformation`, `core/http/reentranceticket`) are not in this
list. If the Workbench survives the proxy decision, these five become ABAP
later (the generation is already in sysinfo, git as a STORE command, unit as
an ABAP runner), not proxy routes. Until then the launchpad greys the
Workbench tile wherever `HEAD /sap/bc/adt/core/discovery` is not a 200
(OSGo, the browser preview), the same way it greys the AMDP tile without
an engine. The Workbench stays: it is the editor meant for a real system
through that proxy.

### The six object types named in the abapGit roadmap

The matrix describes the routes as mounted in `tools/adt-facade.mjs`. It does
not infer write support from the store knowing a file extension.

| Type | Read surface | Create / write / delete over ADT | Integration status |
| --- | --- | --- | --- |
| CLAS | Class document, source, includes, object structure | Implemented | Name-validation wizard gate and some editor paths are recorded gaps |
| INTF | Source and properties document | Implemented | The interface outline has a recorded client failure |
| TABL | Table document (`ddic/tables/{n}`) and a DDL source projection | No DDIC mutation contract | Read-only; a dedicated handler and lifecycle work are needed |
| DTEL | Data-element document (`ddic/dataelements/{n}`) | No DDIC mutation contract | Read-only; the editor opens and the flags it needs to save are not offered |
| DOMA | No ADT route; the store indexes the file only | None | A dedicated editor format is pending |
| TTYP | No ADT route; the store indexes the file only | None | A dedicated editor format is pending |

The creatable set is CLAS, INTF, PROG, INCL, DDLS and DEVC (the templates in
`tools/osd-store.mjs`); lock, write and delete run over the source-backed
types, which add SRVD to that list. CLAS and INTF are the right first
candidates for an abapGit client integration test. Dependencies such as domain
to data element to table need their own creation, error and activation-order
scenarios; class-only results do not cover them.

## Repository and mutation semantics

**Layers.** The `input_folder` list of `abap_transpile.json` is the ordered
set of application layers, and the store, the builder and the transpiler all
read the same list: a later folder wins a name it shares with an earlier one,
the same name twice inside one folder refuses the build, and the libraries
(the open-abap clones beside the tree) fill only what no root has.
`node tools/osd-inputs.mjs` prints overrides, duplicates and shadows. Only
listed folders are the system; an import (`npm run osd:import`) appends its
folder to the list.

**Packages.** A package is a folder, named the abapGit way. Creating one
needs an existing writable parent, and the new name is `<PARENT>_<FOLDER>`:
the store derives the folder from the suffix, so an importer that would
normally choose an arbitrary package name has to follow this convention here.
Generated (`gen/`) and library objects are read-only.

**The sequence** for a source-backed type:

1. Fetch discovery and a CSRF token; keep the session context.
2. Create the object through its collection, or locate it.
3. Acquire its modification lock and keep the returned handle.
4. Write the source with the handle, then read back the source and state.
5. Check and activate, reading the response document for findings.
6. Release the lock and verify the resulting repository content.

**Activation, as the code does it.** `POST /sap/bc/adt/activation` names
objects; the store checks each one with abaplint over the whole registry, then
checks every object that mentions its name, because a local system has no
queue and a rename that breaks a caller is exactly the case activation exists
to refuse. Any finding answers `200` with an activation failure document
listing the object and the dependents it broke. A clean check then **awaits**
`store.publish()`: the transpile builds a new generation to the side and makes
it live by a rename, so a failed build leaves the live generation untouched;
if a serving runtime is up it is recycled, and the call resolves only when the
new process answers. A publish that fails answers a failure document naming
the objects with the build's last lines as the message. Success answers the
properties document (`checkExecuted`, `activationExecuted`,
`generationExecuted`, all true). So the status code is `200` in every case
and the body carries the verdict. `transpileOnActivate: false` is a test seam
for suites that want the verdict without the build; it is not what a running
instance does.

`GET /sap/bc/adt/activation/inactiveobjects` answers an empty list; an
object's own document carries its inactive state after a write.

**Persistence.** Which rows survive what depends on the backend chosen in
`test/setup.mjs`:

- `STG_DB=file`, the default for `npm start` (`test/run.mjs`): SQLite in a
  real file, WAL, written while the process runs. The rows survive a crash and
  a recycle, and a second connection can read them. The path is
  `.local/db/osd.sqlite` unless `STG_DB_PATH` says otherwise; a new file is a
  copy of a base image seeded once per DDIC.
- `STG_DB=sqlite` with `STG_DB_PATH`: sql.js in memory, read from the file
  when a runtime boots and written when it exits (`tools/osd-persist.mjs`).
  Nothing is written while it runs. Without `STG_DB_PATH` the database is in
  memory only and a test suite pays nothing.
- `STG_DB=duckdb`, with `STG_DB_PATH` to persist.

A database file carries a fingerprint of the schema it was built for. A
runtime that opens a file built for other tables says so, moves the file
aside with the schema it was made for in its name, and starts clean rather
than serving rows the running code does not describe. `STG_DB_STRICT=1`
refuses instead, for data worth inspecting before it is discarded. The
fingerprint is a compatibility check and nothing more: never compared between
instances, never promoted, and the answer to a mismatch is always to rebuild
this instance's data. A new generation does not migrate existing rows.
[generations.md](generations.md) has the mechanism; ADT support does not imply
schema migration or zero-downtime updates.

## A reproducible starting point for client integration

Two suites establish the local session and the development loop, and their
fixtures are the expected document shapes:

```sh
npx mocha test/adt-session.mjs test/adt-devloop.mjs
```

Both are part of `npm run integration`. The dev-loop suite runs the façade
with `transpileOnActivate: false`, so it proves the verdicts and not the
publication; publication has its own checks in `test/osd-runtime.mjs` and
`test/osd-build.mjs`.

For a new abapGit adapter, add a dedicated test in a disposable writable tree:

| Step | Assertion |
| --- | --- |
| Discover and establish a session | Valid service document, token and retained context |
| Create a subpackage under a fixture parent | Expected package document, location and files |
| Create a minimal class | `201` with a location and a readable skeleton |
| Lock, write, read back | Exact source and the inactive state |
| Check and activate | No findings; publication finished before success is consumed |
| Re-read or export through the client | Content round-trips with the expected metadata |
| Delete the class, then the package | Removed objects no longer resolve |
| Repeat with a duplicate name and invalid source | Typed errors and findings; no false success |

This is the proposed acceptance scenario, not a claim that abapGit has passed
it. Keep the adapter's exact request bodies and MIME versions as sanitized
fixtures. A second test should cover interfaces; DDIC lifecycles follow once
their server contracts exist.

## Transport and diagnostics

HTTP clients use the façade directly, which is what an ABAP Cloud project in
Eclipse, vsp and a future abapGit adapter do. A Custom Application Server
project in Eclipse logs on over RFC instead and carries every ADT request
inside one call to `SADT_REST_RFC_ENDPOINT`; the bridge that accepts that
conversation and forwards the HTTP exchange inside it is the built-in MIT
JavaScript listener under `tools/protocols/`. The sibling
[open-rfc-go](https://github.com/oisee/open-rfc-go) remains an independent
test oracle. The protocol facts, BXML payload encoding and what a working
Eclipse session asks for over that wire are in
[adt-over-rfc.md](adt-over-rfc.md). SOAP does not enter into it: ADT is REST,
and SOAP-RFC is a transport of the RFC family rather than of this façade.

Running a program from the editor hands off to SAP GUI, which speaks DIAG on
the dispatcher port; what exists on that side is a dispatcher listener that
answers every frame with one still screen ([diag-notes.md](diag-notes.md)).
It is not part of the edit, check, activate and unit-test cycle, which needs
no DIAG frame at all.

`STG_ADT_DUMP=<file.jsonl>` records every exchange under the façade. A
recording carries source and session material, so it stays local and only
sanitized fixtures are published. Compare what the client actually sent with
the intended contract before attributing a missing request to permissions or
a cache.

Open issues, measured and listed in the backlog: the generic creation wizard,
class-name validation, some exception-document properties and the interface
outline merge. Direct CRUD passing says that the routes hold, not that every
IDE dialog on top of them does.

---

# The contract

What follows is the endpoint-level contract, read off the clients' code (vsp's
`pkg/adt/http.go` and `compat.go`, Eclipse's ADT jars) rather than from
memory, and pinned by `test/adt-session.mjs`, `test/adt-devloop.mjs`,
`test/adt-facade.mjs` and `test/adt-editor.mjs`. vsp's client is strict on
purpose and learned ADT's quirks over a thousand commits; a façade it accepts
is one other clients accept, and when it breaks the exchange is the bug
report.

## The handshake

Implemented in `tools/adt-session.mjs`; `test/adt-session.mjs` fails on each
rule separately, because each is something a client silently mis-reads
rather than reports.

- **Token fetch:** `HEAD /sap/bc/adt/core/discovery` with `X-CSRF-Token:
  fetch`; a client falls back to `GET` if HEAD is refused, so HEAD works. A
  stateful request also carries `X-sap-adt-sessiontype: stateful`. A heal
  attempt sends an empty `Cookie: sap-contextid=` to force a fresh context.
- **Required back:** an `X-CSRF-Token` header whose value is never the
  literal `Required` (a client reads that as "no token yet"), on every
  answer, and `Set-Cookie` for `sap-contextid` and `SAP_SESSIONID_OS2_001`.
- **Discovery:** `GET /sap/bc/adt/core/discovery`, `Accept:
  application/atomsvc+xml` or `*/*`, answered with the ADT Atom service
  document. `core/discovery` is the reachability and token probe;
  `discovery` is the collection list a client scans. The same document
  answers both.
- **Expiry by shape.** A client decides it is logged out on any of three
  shapes: a redirect off the origin, a `200` shaped like a logon page, or a
  missing token where one was expected. The façade therefore never redirects,
  always emits the token, and keeps the session cookie stable.
- **403 is the token demand, and nothing else.** A client answers a `403` on
  a modifying request by re-fetching a token and retrying exactly once; a
  `403` that means anything else costs it its only retry and it fails for the
  wrong reason. The session layer owns `403` alone. A library object that
  cannot be written answers `405` on the write and, on the lock, the lock
  envelope with no handle in it (`modifiable="false"`), which is what a real
  system returns for an object ADT may not modify. Never a redirect.
- What a client actually parses: vsp does not parse the Atom document. It
  scans for `href="/sap/bc/adt/…"` and reads the token header. The document
  is structurally real anyway, for the stricter clients behind it.

## Reading a repository

| What | Method | Path | Accept | Answer |
| --- | --- | --- | --- | --- |
| source of a class | GET | `/sap/bc/adt/oo/classes/{name}/source/main` | `text/plain` | raw ABAP |
| a class include | GET | `/sap/bc/adt/oo/classes/{name}/includes/{include}` | `text/plain` | raw ABAP |
| source of an interface | GET | `/sap/bc/adt/oo/interfaces/{name}/source/main` | `text/plain` | raw ABAP |
| source of a program | GET | `/sap/bc/adt/programs/programs/{name}/source/main` | `text/plain` | raw ABAP |
| source of an include | GET | `/sap/bc/adt/programs/includes/{name}/source/main` | `text/plain` | raw ABAP |
| a CDS view | GET | `/sap/bc/adt/ddic/ddl/sources/{name}/source/main` | `text/plain` | DDL source |
| object structure | GET | `/sap/bc/adt/oo/classes/{name}/objectstructure` | `application/vnd.sap.adt.objectstructure.v2+xml` | methods and includes |
| class document | GET | `/sap/bc/adt/oo/classes/{name}` | `application/vnd.sap.adt.oo.classes.v4+xml` | properties, includes, state |
| package | GET | `/sap/bc/adt/packages/{name}` | `application/vnd.sap.adt.packages.v1+xml` (or v2) | package document |
| package contents | POST | `/sap/bc/adt/repository/nodestructure` | node structure XML | one level of the tree |
| search | GET | `/sap/bc/adt/repository/informationsystem/search` | search XML | the result set |
| grep | — | rides on the reads above, matched in the client | — | — |

Three things a client's fixtures pin:

- **Namespaced names arrive URL-encoded**: `/programs/programs/%2Fdemo%2Fzreport`.
  On disk the slash is `#`, the abapGit way, and the store decodes before it
  looks.
- The `#fragment` on a source URL (`#start=12,4`, `#type=CLAS%2FOM;name=RUN`)
  is client-side and never reaches the server. A read of one method resolves
  through the object-structure document, which is why that resource matters
  even for plain class reads.
- Source is raw `text/plain` ABAP. Structure, package, search and DDIC are
  the `application/vnd.sap.adt.*+xml` shapes above.

The object types the façade answers for: CLAS with its includes and methods
through the object structure, INTF, PROG, INCL, DDLS, SRVD, DEVC, TABL and
DTEL. This is the breadth of the façade, not the dependency closure of a
running service; the closure is the OData product's problem and a different
axis.

## Data and DDIC

`POST /sap/bc/adt/datapreview/freestyle` with SQL in the body is how a client
reads table contents and how vsp's whole graph layer works;
`GET …/datapreview/ddic/{name}/metadata` and `POST …/datapreview/ddic` are
the table-scoped version (columns first, then the rows for a SELECT the
client writes, or the whole table when it sends none), and
`…/datapreview/cds/{name}/metadata` with `POST …/datapreview/cds` the CDS one. The definitions come from the DDIC the
runtime already carries: `/sap/bc/adt/ddic/tables/{n}` with its DDL projection
under `/source/main`, and `…/ddic/dataelements/{n}`. The DDL parser
information under `ddic/tables/parser/info` is the system's own and answers
`404`; a table editor opens without it.

The cross-reference tables cost the façade nothing: `CROSS`, `WBCROSSGT`,
`WBCROSSGTX` for who-calls and references, `D010INC` for the load graph. Their
DDIC is under `src/osd/ddic/`, their rows are derived from the parse the
transpiler already does rather than authored, and the columns are the ones
vsp actually selects. Every host fills them at start -- the Node server,
`osd serve` and the binary -- and the browser preview and OSGo at build,
all through `tools/osd-xref-seed.mjs`, once per generation (the parse is
cached under `build/xref/`). They are an index and never edited: a start
replaces them with what the files say. A client reads them over freestyle
SQL like any other table.

## The development loop

`POST <object>?_action=LOCK&accessMode=MODIFY` returns a lock handle,
`PUT <object>/source/main?lockHandle=…` writes (a class include through
`<object>/includes/{include}`), `POST /sap/bc/adt/<collection>` creates,
`DELETE <object>` deletes, `POST <object>?_action=UNLOCK` releases.
`POST /sap/bc/adt/checkruns?reporters=abapCheckRun` is the syntax check,
`POST /sap/bc/adt/activation?method=activate` the activation described above,
`POST /sap/bc/adt/abapunit/testruns` a test run. The whole path rides one
affine session and the handle is threaded from lock through write to unlock;
a stateless hop between lock and write retires it.

What a write answers: `405` for a library object, `409` for a missing handle
or one that holds another object or belongs to another session, and `200`
with an `ETag` computed from what a read now returns, because a client files
the tag beside the saved source and shows an empty editor without one. The
write lands the file only; the transpile belongs to activation.

**A check run answers for source that is not on disk.** `checkruns` carries
the editor's buffer, not the stored object, so `check(type, name, {source})`
lets the given text stand in for the file for that one call and touches
nothing. The answer has the same shape as a plain check, which is the shape
activation returns, because it is the same code. `{include: "testclasses"}`
aims it at a class include. A name the store does not have yet is allowed
here and only here: a client may ask about an object before it creates one,
and asking creates nothing. The shared parse is borrowed and put back in a
`finally`, synchronously, so no other caller sees the substitution and the
cost is milliseconds rather than the seconds a fresh parse takes. Every type
the façade serves may be checked, including a dictionary object, for which
the status says that it is here and readable rather than implying a syntax
check it did not get.

**A test run is a tree, not a verdict.** `(await store.unit()).runDetached(type, name)`
returns program, test classes, test methods and the alerts under each
method, which is exactly the nesting of an `aunit:runResult`: a method with
no alert passed, a method with one did not. A class carries the `riskLevel`
and `durationCategory` it declares in ABAP, a method carries `executionTime`
in seconds, and both carry the line and column they are written at, so the
façade builds a navigation URI into the include without parsing anything
itself. `classes()` answers what tests exist without running them, and
`{testClass}` or `{method}` narrows a run to one. An alert is one of three
kinds: `failedAssertion` for an assertion that did not hold, with the
assert's message as the title and expected and actual as details;
`exception` for an ABAP exception nobody caught; `shortDump` for a failure of
the runtime. Every alert carries a stack read back through the transpiler's
source maps, so an entry names the ABAP include and line rather than the
generated module. The result document is the classic `aunit:runResult`,
named by what the client asked for: `abapunit.testruns.result.v2` for
Eclipse, the junit name for vsp.

The run happens in a child process. A test writes to the database, and the
database is the one the gateway is serving from, so a run inside the server
would mean a client's test data landing in the server's rows. The child boots
its own runtime against its own in-memory database, about a second, and the
parse it would otherwise repeat is handed to it, so a run of one class costs
a little over a second. What runs comes from the parse rather than from the
transpiled index, which is why a test class that has been written but not
yet built comes back as an alert saying so instead of quietly not existing.
The child is younger than the edit, so it sees the code just written even
when the serving runtime has not been recycled yet; that is a consequence of
the isolation, and the awaited publication is what keeps the two from
disagreeing for long.

## The serving runtime

Node pins a module graph for the life of a process, and a process that has
loaded the old code goes on answering with it however often the modules are
rewritten. That is why `store.publish()` does more than transpile: if a
serving runtime is up it replaces it, resolving only when the new process
answers. Measured on this repository: a fresh serving runtime is 0.7 to 0.9
seconds and a recycle about 0.9, against 3.9 seconds for the store's parse,
which is why only the serving half is replaced and the façade never restarts.
The pieces are `tools/osd-runtime.mjs`, the supervisor, and
`tools/osd-serve.mjs`, the OData front in a process that can be thrown away.

The order inside a recycle is not the zero-downtime one. The old runtime is
asked to go first and the new one starts after it, because both would
otherwise hold the same database file and the second to write would win.
`whenReady()` is the promise a proxy awaits so a request that arrives
mid-recycle waits about a second instead of failing. It is resolved while a
runtime is serving, pending while one is being replaced, and rejected when
there is none, including after a crash: a readiness that outlives the process
it described is a success report for work that is not happening. `ensure()`
is the call for a proxy that wants a runtime now whatever the reason none is
serving; it waits out a recycle, starts a runtime after a crash, and the
generation it answers with is how a caller sees that a crash happened. `died`
carries what the last unexpected exit said.

An instance is a source tree, a port and a database, and nothing in the
supervisor assumes there is one of them: `new ServingRuntime({root, port,
database})` runs over a second worktree beside the first, which is what a
branch under test would be.

## A repository comes in without a git binary

`tools/osd-git.mjs` is a thin call into `ZCL_OSD_GIT`, which speaks git's
smart HTTP protocol: the advertisement at `info/refs?service=git-upload-pack`
says what branches exist, a `want` over `git-upload-pack` asks for one, and
what comes back is a pack. Reading the pack is abapGit's own code, twenty-odd
objects this repository transpiles as a library named in
`abap_transpile.json`. Two of those objects are ours under abapGit's names,
because off stack they cannot be abapGit's: inflate goes to the platform
rather than to the ABAP DEFLATE, and the progress indicator does nothing
because there is no screen. `Import.fromGit(url)` uses it by default; the git
binary is still there behind `{via: "git"}` (`--git-binary` on the command
line) for a remote OSD cannot reach on its own, an ssh URL for instance.

## In the tree, built, and serving are three states

Measured on 2026-09-13 while importing a real application, when the store
still read `local/` on its own and the transpiler did not: the 466 abapGit
classes under `local/` appeared in the ADT tree, opened in an editor, and had
no module in `output/`. A client could not tell a class it could call from
one it could only look at, because both answer a source read with source.
That is the trap the layer rule closes.

Today the store and the transpiler read the same `input_folder` list, so an
object is **in the tree** exactly when its folder is listed. Two states
remain distinct from that one and from each other, and `core/http/build`
shows all three:

- **in the tree**: the store found the object under a listed root (or a
  library, read-only). It answers reads, checks and locks.
- **built**: a module for it exists in the live generation, which means its
  folder was listed when the last build ran and the build succeeded.
- **serving**: the runtime child runs that generation. A pinned runtime, or
  one that failed to come up and was rolled back, serves an older one.

Making something runnable is therefore a deliberate act, because whatever is
listed is built and one class that does not compile refuses the build.
Narrow an import to what is meant to run (`npm run osd:import -- <url>
--types CLAS,INTF`, or a folder holding only the objects that matter) before
its folder goes on the list. `local/o4d` is the worked example: one class out
of an 85-class repository, because the other 84 do not compile and the one
that matters does not need them. A folder under `local/` that is not listed
is in nobody's tree.

## The pseudo-headers an ICF handler can ask for

A handler reads the request through `~`-prefixed pseudo-headers, and
`IF_HTTP_HEADER_FIELDS_SAP` is the canonical list. `cl_express_icf_shim`
serves seven of the eighteen: `~path`, `~path_info`, `~path_info_expanded`,
`~path_translated_expanded`, `~query_string`, `~request_method`,
`~request_uri`.

Absent: `~path_translated`, `~script_name`, `~script_name_expanded`,
`~request_line`, `~server_name`, `~server_port`, `~server_protocol`,
`~remote_addr`, `~uri_scheme`, `~unidentified_path_segments`,
`~virtual_host_number`.

Nothing served here asks for any of them, measured rather than assumed: our
own code uses four and the imported demo application uses two, all present.
So this is a gap and not a defect today. It is written down because of its
shape: a handler asking for `~server_name` gets an initial value and builds a
wrong absolute URL out of it, with nothing reporting that the question was
not answered. `~script_name` is the one most likely to be wanted first, being
the matched node path, the complement of `~path_info`, which is the
remainder, by the CGI convention SAP follows.

`~path_info` itself is confirmed against working code from a real system: it
carries a leading slash, it does not include the service name, and at the
node root it is empty rather than `/`. That is what OSD does.

The shim is a library, so closing the gap is a small change upstream rather
than a workaround here.

## Cross-cutting, all of it

- The token is never the literal `Required`.
- `HEAD` on `/sap/bc/adt/core/discovery` works; a client tries it before `GET`.
- No redirect on an authenticated request; the token on every answer.
- `403` means "fetch a token"; an unwritable object answers `405`.
- Namespaced names arrive URL-encoded; a `#fragment` never arrives.
- Source is raw `text/plain`; structure, package, search and DDIC are the
  `application/vnd.sap.adt.*+xml` shapes.
- The lock handle is threaded through one session, and a stateless hop
  between lock and write retires it.
- Activation answers `200` in every case; the body says whether it held, and
  a success is answered only after the modules are written and the process
  that serves them has them.
