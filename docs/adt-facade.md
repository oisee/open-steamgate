# The ADT façade: the contract, and what answers it today

**Wave 0 and wave 1's reads are built** (2026-09-13). The handshake, the
discovery document, source reads, object structures, search, the package
tree and table contents all answer on 8099, and the rest of this page is
still the contract for what has not been built. Where a
shape was guessed rather than known, it says so, and vsp's round trip is what
settles it.

The façade is Node over the object store, not ABAP: it reads the file system
and spawns abaplint and the transpiler, neither of which transpiled ABAP can
do. The OData front stays ABAP behind the ICF shim, on the same listener, so
one address serves both. `npm run osd:serve` is that address.

## Why

vsp is an MCP server for agents, and its ninety-six tools speak ADT to a
real system. If open-steamgate serves `/sap/bc/adt/**` the way it already
serves `/sap/opu/odata/sap/**`, then vsp needs no new code and no local
mode: its base URL points at a local binary that has no system behind it,
and the agent's tools are the same ones it uses against A4H. The adapter
belongs on our side. We have done this once already, for `/IWBEP/`:
clean-room interfaces, our own runtime, one ICF handler. `open-abap-adt`
declares the ADT resource interfaces and implements nothing, which is where
`open-abap-odata` stood a week ago; its `LICENSE` is empty, so it is a
spec, not a base.

What maps onto what: reads come from the files in `src/` and `gen/`, table
contents from the database we already run, a write is a file plus abaplint
as the syntax check plus a transpile as activation, ABAP Unit is the test
run, and locks and transports are synthetic because a local system has
neither.

## Two rules

1. **Discovery is the gatekeeper.** A resource is advertised only when it
   works. vsp's own compatibility sweep reads the discovery document to
   learn what exists, so an honest document is how "which tools work" gets
   one answer instead of a wiki page.
2. **vsp is the test.** Its client is strict on purpose and learned ADT's
   quirks over a thousand commits. If vsp accepts the façade, other clients
   will; when vsp breaks, it is our bug and we want the exchange.

This is not "flip a URL and ninety-six tools work". It is "flip a URL and
iterate one subset at a time". The honest end state is the development
loop, roughly thirty to fifty of the tools.

## The waves

Each wave ends in a test vsp runs against localhost.

| Wave | What | Exit test |
| --- | --- | --- |
| 0 **done** | session, CSRF, discovery, plus source reads and freestyle SQL | vsp logs on, keeps a session, reads discovery without deciding it was logged out |
| 1 **reads done** | reading a repository: sources, package contents, search | `GetSource`, `GetPackage`, `SearchObject`, `GrepPackages` |
| 2 | reading data: table contents, table and structure definitions | the table tools, with a filter |
| 3 | the development loop: write, lock, syntax check, activate, unit test | the write path end to end on one session |
| 4 | runtime errors as ST22-shaped documents | `vsp dumps --explain`, with no system |
| never | transport organiser, jobs and spool, identity, debugger over ADT, real cluster dumps | not implemented, not advertised |

## Wave 0, the handshake

From vsp's code (`pkg/adt/http.go`, `compat.go`), not from memory. All of it
is implemented in `tools/adt-session.mjs`, and `test/adt-session.mjs` fails
loudly on each rule separately, because each is a thing a client silently
mis-reads rather than reports.

- **Token fetch:** `HEAD /sap/bc/adt/core/discovery` with `X-CSRF-Token:
  fetch`; vsp falls back to `GET` if HEAD is refused. A stateful request
  also carries `X-sap-adt-sessiontype: stateful`. A heal attempt sends an
  empty `Cookie: sap-contextid=` to force a fresh context.
- **Required back:** an `X-CSRF-Token` header whose value is **not** the
  literal `Required` (vsp reads that as "no token yet"), and `Set-Cookie`
  for `sap-contextid` and `SAP_SESSIONID`.
- **Discovery:** `GET /sap/bc/adt/core/discovery`, `Accept:
  application/atomsvc+xml` or `*/*`, answered with the ADT Atom service
  document.
- **Expiry by shape, the thing that breaks first:** vsp decides it is
  logged out on any one of three shapes — a redirect off the origin, a 200
  shaped like a logon page, or a missing token where one was expected. So the
  façade never redirects at all, always emits the token, and keeps the
  session cookie stable.
- **403 is the token-demand signal, and nothing else.** vsp answers a 403 on
  a modifying request by re-fetching a token and retrying exactly once. A 403
  that means anything else therefore costs it its only retry and then fails
  for the wrong reason. So the session layer owns 403 alone: a library object
  that cannot be written answers 405.
- **Two names for discovery.** `core/discovery` is the reachability and token
  probe; `discovery` is the collection list a client scans. The same document
  answers both.
- What a client actually parses, worth knowing before polishing XML: vsp does
  not parse the Atom document. It scans for `href="/sap/bc/adt/…"` and reads
  the token header. The document is structurally real anyway, for the
  stricter clients behind it.

## Wave 1, reading a repository

| Tool | Method | Path | Accept | Answer |
| --- | --- | --- | --- | --- |
| source of a class | GET | `/sap/bc/adt/oo/classes/{name}/source/main` | `text/plain` | raw ABAP |
| source of an interface | GET | `/sap/bc/adt/oo/interfaces/{name}/source/main` | `text/plain` | raw ABAP |
| source of a program | GET | `/sap/bc/adt/programs/programs/{name}/source/main` | `text/plain` | raw ABAP |
| source of an include | GET | `/sap/bc/adt/programs/includes/{name}/source/main` | `text/plain` | raw ABAP |
| source of a module | GET | `/sap/bc/adt/functions/groups/{group}/fmodules/{fm}/source/main` | `text/plain` | raw ABAP |
| object structure | GET | `/sap/bc/adt/oo/classes/{name}/objectstructure` | `application/vnd.sap.adt.objectstructure.v2+xml` | methods and includes |
| package | GET | `/sap/bc/adt/packages/{name}` | `application/vnd.sap.adt.packages.v1+xml` | package document |
| package contents | POST | `/sap/bc/adt/repository/nodestructure` | node structure XML | the tree |
| search | GET | `/sap/bc/adt/repository/informationsystem/search` | search XML | the result set |
| grep | — | rides on the reads above, matched in the client | — | — |

What the round trip settled, 2026-09-13. vsp pointed its client at 8099 and
found exactly two reds, both shape rather than content: the object structure
answered 404 because the path is `/oo/classes/{name}/objectstructure` and not
the bare object URI, and search was not mounted. Both are built now. The data
preview document passed on the first try and its column-oriented shape is
confirmed. Still unconfirmed by any client: the node structure's request
parameters, the element type codes `CLAS/OM` and `CLAS/I`, and the package
document.

Three things the fixtures will pin and we should not guess:

- **Namespaced names arrive URL-encoded**: `/programs/programs/%2Fdemo%2Fzreport`.
- The `#fragment` on a source URL (`#start=12,4`, `#type=CLAS%2FOM;name=RUN`)
  is client-side and never reaches us; a read of one method resolves through
  the object-structure document, which is why that resource matters even for
  plain class reads.
- Source is raw `text/plain` ABAP. Structure, package and search are the
  `vnd.sap.adt` XML shapes above.

The exact search parameters, the node-structure request body and the Atom
discovery shape come as sanitized fixtures from vsp: real structure,
synthetic names, scrubbed before they reach this repository, because this
repository is public and raw captures never come here.

## Waves 2 to 4, and what each one maps onto here

The demand side is written down in vsp's repository as
`docs/adt-surface.md`, endpoint by endpoint, and that is the canonical list.
This is the answer side: what each wave means for us.

**Wave 2, data and DDIC.** `POST /sap/bc/adt/datapreview/freestyle` with SQL
in the body is the one that matters: it is how vsp reads table contents *and*
how its whole graph layer works. `POST …/datapreview/ddic` is the
table-scoped version. The definitions come from the DDIC we already carry:
`/sap/bc/adt/ddic/tables/{n}`, `…/views/{n}`, `…/structures/{n}`,
`…/dataelements/{n}`, `…/ddl/sources/{n}` for CDS, `…/srvd/sources/{n}`.

The cross-reference tables belong here and cost the façade nothing:
`CROSS`, `WBCROSSGT`, `WBCROSSGTX` for who-calls and references, `D010INC`
for the load graph. vsp reads them over freestyle SQL like any other table,
so once freestyle works they are free on the protocol side.

**These exist already**, built by the store layer on 2026-09-13 (`b78818b`):
DDIC under `src/osd/ddic/`, so the runtime creates them like any other
table, and 2424 rows seeded from the parse the transpiler already does
rather than authored. The columns were taken from the SQL vsp actually
selects, not from a memory of SAP's DDIC. `npm run osd:xref -- --write`
rebuilds them and they are not tracked, being derived. So wave 2's
who-calls-what needs nothing from this side but the freestyle endpoint.

**Wave 3, the development loop.** `POST <object>?_action=LOCK&accessMode=MODIFY`
returns a lock handle, `PUT <object>/source/main?lockHandle=…` writes,
`POST /sap/bc/adt/<collection>` creates, `POST <object>?_action=UNLOCK`
releases. `POST /sap/bc/adt/checkruns?reporters=abapCheckRun` is a syntax
check, which here is abaplint; `POST /sap/bc/adt/activation?method=activate`
is activation, which here is the same check over the object and everything
that uses it;
`GET /sap/bc/adt/activation/inactiveobjects` lists what has not been
activated; `POST /sap/bc/adt/abapunit/testruns` is a test run, which here is
the runtime running ABAP Unit. The whole path rides one affine session and
the handle is threaded from lock through write to unlock.

**The activation contract is settled** (`b6762e8`). `activate(type, name)`
returns the verdict immediately, because that is what the response carries;
writing the modules is the separate `transpile()` call, about ten seconds
over the whole system, which the façade starts without awaiting. Two
activations in flight share one promise rather than transpiling twice. The
modules only have to be in place before the next request that touches the
object, which is why the split is safe.

**A test run is a tree, not a verdict.** `(await store.unit()).runDetached(type, name)`
returns program, test classes, test methods and the alerts under each
method, which is exactly the nesting of an
`aunit:runResult`: a method with no alert passed, a method with one did
not. A class carries the `riskLevel` and `durationCategory` it declares in
ABAP, a method carries `executionTime` in seconds and `unit`, and both
carry the line and column they are written at, so the façade can build a
navigation URI into the include without parsing anything itself. `classes()`
answers what tests exist without running them, and `{testClass}` or
`{method}` narrows a run to one. An alert
is one of three kinds. `failedAssertion` for an assertion that did not
hold, with the assert's message as the title and expected and actual as
details; `exception` for an ABAP exception nobody caught; `shortDump` for a
failure of the runtime. Every alert carries a stack read back through the
transpiler's source maps, so an entry names the ABAP include and line
rather than the generated module.

The run happens in a child process. A test writes to the database, and the
database is the one the gateway is serving from, so a run inside the server
would mean a client's test data landing in the server's rows. The child
boots its own runtime against its own in-memory database, about a second,
and the parse it would otherwise repeat is handed to it, so a run of one
class costs a little over a second in total. What runs comes from the parse
rather than from the transpiled index, which is why a test class that has
been written but not yet transpiled comes back as an alert saying so
instead of quietly not existing.

**A repository comes in without a git binary.** `tools/osd-git.mjs` is a
thin call into `ZCL_OSD_GIT`, which speaks git's smart HTTP protocol: the
advertisement at `info/refs?service=git-upload-pack` says what branches
exist, a `want` over `git-upload-pack` asks for one, and what comes back is
a pack. Reading the pack is abapGit's own code, twenty-odd objects this
repository transpiles as a library named in `abap_transpile.json`, so the
hard half is not written twice. Two of those objects are ours under
abapGit's names, because off stack they cannot be abapGit's: inflate goes
to the platform rather than to the ABAP DEFLATE, which is minutes against
seconds on a real pack, and the progress indicator does nothing because
there is no screen to indicate on. `Import.fromGit(url)` uses it by
default; the git binary is still there behind `{via: "git"}` for a remote
OSD cannot reach on its own, an ssh URL for instance.

**A check run answers for source that is not on disk.** `checkruns` carries
the editor's buffer, not the stored object, so `check(type, name, {source})`
lets the given text stand in for the file for that one call and touches
nothing. The answer has the same shape as a plain check, the same shape
activation returns, because it is the same code. `{include: "testclasses"}`
aims it at a class include. A name the store does not have yet is allowed
here and only here: a client may ask about an object before it creates one,
and asking creates nothing. The shared parse is borrowed and put back in a
`finally`, all of it synchronous, so no other caller sees the substitution
and the cost is milliseconds rather than the seconds a fresh parse takes.

**Wave 4, cheap extras.** `GET /sap/bc/adt/runtime/dumps` and the detail
resource under it: a runtime error of ours emitted as an ST22-shaped
document. Revisions, if reading them out of git is enough.

## The object types Tier 1 has to answer for

A finite list, from the paths above: CLAS with its includes and methods
through the object structure, INTF, PROG, INCL, FUGR and FUNC, DEVC for a
package, TABL, VIEW, STRU, DTEL, DDLS, SRVD.

Worth keeping straight, because the two get confused: this is the breadth of
the *façade*, not the dependency closure of a running service. The closure is
the OData product's problem and a different axis entirely.

## Cross-cutting, all of it

- The token must never be the literal `Required`.
- `HEAD` on `/sap/bc/adt/core/discovery` must work; vsp tries it before `GET`.
- Never redirect an authenticated request, always return the token.
- Namespaced names arrive URL-encoded.
- Source is raw `text/plain`; structure, package, search and DDIC are the
  `application/vnd.sap.adt.*+xml` shapes.
- The lock handle is threaded through one session, and a stateless hop
  between lock and write retires it.

## SOAP, asked and answered

vsp's ADT client is pure REST; there is no SOAP in it. The only SOAP it
touches is SOAP-RFC (`/sap/bc/soap/rfc`), which is not ADT at all but a
fallback transport for classic RFC when the gateway is closed, stateless by
nature, and it belongs to the RFC family (open-rfc-go), not here. It would
only matter if a non-ADT, RFC-speaking client had to attach to a local
system, which is a different consumer and a later question. Not in the
waves; one line in the backlog as a question.

## What starts first, when it starts

Wave 0, and within it the session before the resources. The slice that
proves the whole idea is small: the handshake, one class read, one table
read, and vsp pointed at localhost.
