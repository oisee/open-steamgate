# The ADT façade: the contract, before any of it is built

Nothing here is implemented. This is the agreed shape, so that the day it
starts, it starts against a written contract instead of a conversation.

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
| 0 | session, CSRF, discovery with two resources | vsp logs on, keeps a session, reads discovery without deciding it was logged out |
| 1 | reading a repository: sources, package contents, search | `GetSource`, `GetPackage`, `SearchObject`, `GrepPackages` |
| 2 | reading data: table contents, table and structure definitions | the table tools, with a filter |
| 3 | the development loop: write, lock, syntax check, activate, unit test | the write path end to end on one session |
| 4 | runtime errors as ST22-shaped documents | `vsp dumps --explain`, with no system |
| never | transport organiser, jobs and spool, identity, debugger over ADT, real cluster dumps | not implemented, not advertised |

## Wave 0, the handshake

From vsp's code (`pkg/adt/http.go`, `compat.go`), not from memory.

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
  logged out when a 200 was redirected or carries no `X-CSRF-Token`. So the
  façade never redirects an authenticated request, always emits the token,
  and keeps the session cookie stable.

## Wave 1, reading a repository

| Tool | Method | Path | Accept | Answer |
| --- | --- | --- | --- | --- |
| source of a class | GET | `/sap/bc/adt/oo/classes/{name}/source/main` | `text/plain` | raw ABAP |
| source of an interface | GET | `/sap/bc/adt/oo/interfaces/{name}/source/main` | `text/plain` | raw ABAP |
| source of a program | GET | `/sap/bc/adt/programs/programs/{name}/source/main` | `text/plain` | raw ABAP |
| source of an include | GET | `/sap/bc/adt/programs/includes/{name}/source/main` | `text/plain` | raw ABAP |
| source of a module | GET | `/sap/bc/adt/functions/groups/{group}/fmodules/{fm}/source/main` | `text/plain` | raw ABAP |
| object structure | GET | `/sap/bc/adt/oo/classes/{name}` | `application/vnd.sap.adt.objectstructure.v2+xml` | methods and includes |
| package | GET | `/sap/bc/adt/packages/{name}` | `application/vnd.sap.adt.packages.v1+xml` | package document |
| package contents | POST | `/sap/bc/adt/repository/nodestructure` | node structure XML | the tree |
| search | GET | `/sap/bc/adt/repository/informationsystem/search` | search XML | the result set |
| grep | — | rides on the reads above, matched in the client | — | — |

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
