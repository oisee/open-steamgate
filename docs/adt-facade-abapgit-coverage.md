# abapGit ADT path and facade coverage

Discovery snapshot: **2026-10-08**. Acceptance criteria await the conversation
with Lars. This is an inventory and a proposed slice, not an implementation or
an abapGit compatibility certification.

The main finding is that **abapGit has not yet implemented the outbound ADT
repository path described in Road to the Cloud**. The facade already supports
CLAS/INTF source lifecycles, reads DTEL/TABL, and browses local packages. It
still needs DDIC mutation and activation work for a DOMA/DTEL slice. Native
osgo has no passing ADT conformance case today.

## Evidence and scope

- open-steamgate checkout: `docs/adt-facade-abapgit-coverage`, HEAD
  `17aa0bba4d025c8060cb33f8a05b6cba72ba853b`. Local route line references below
  refer to this revision.
- Read-only abapGit main clone and live GitHub main both resolved to
  `67c7f4690d441a21456bdbdd63a724b5075c8b6b`. Upstream source links below are
  pinned to that revision; paths beginning `src/` in the upstream inventory
  refer to abapGit, not open-steamgate.
- Read [Road to the Cloud #7880](https://github.com/abapGit/abapGit/issues/7880)
  and queried its current metadata: open, no comments, last updated
  2026-09-15. Its checkboxes describe the plan at that date and can lag code.
- Queried all seven open PRs (re-verified by the coordinator with authenticated read-only GitHub API calls on 2026-10-08: main `67c7f469`, #7880 open with no comments, 7 open PRs, 8 branches, head SHAs as listed, and no `/sap/bc/adt`, `cl_adt_`, `if_adt_` or `adt_rest` additions in any branch comparison or PR patch) and all eight repository branches through
  read-only GitHub APIs. Compared each non-main branch to main and examined
  the three fork PR file lists/patches. Searches covered `/sap/bc/adt`,
  `if_adt_`, `cl_adt_`, `adt_rest`, `sadt`, HTTP-client creation and adapter
  references in the main tree and changed patches. Negative findings apply
  to these public trees and diffs, not private or unpublished work.
- Read the local facade, surface, backlog, conformance documentation and case
  modules. No server or conformance suite was run for this documentation
  task. Existing measured results are attributed to their documentation.
  No A4H access, captures, upstream writes, or commits were made.

### Public work inspected

| PR or branch | Finding relevant to this discovery |
| --- | --- |
| [#7864](https://github.com/abapGit/abapGit/pull/7864), `hvam/tablddl0809`, head `6b3d8a5f8a0096268958945cc76881edcaa09afd` | Merged 2026-09-17. TABL DDL serialization/deserialization helper; PR explicitly describes standalone work without integration. This is not an HTTP ADT handler or AFF JSON endpoint. |
| [#7899](https://github.com/abapGit/abapGit/pull/7899), `hvam/oci2609`, head `894c04f21a06745cc795dc7522b732fde9e5fe2b` | Open experimental OCI support. HTTP-agent change disables redirects when requested; a transpiled test shim fixes URL parsing with explicit ports. Registry HTTP work, no outbound ADT repository calls found. |
| [#7936](https://github.com/abapGit/abapGit/pull/7936), `mbtools/langu-convert`; [#7948](https://github.com/abapGit/abapGit/pull/7948), `mbtools/menu-back` | Language conversion and settings navigation; no ADT adapter additions found. |
| [#7805](https://github.com/abapGit/abapGit/pull/7805), `hvam/smtg0608`; [#7682](https://github.com/abapGit/abapGit/pull/7682), fork | SMTG work/AFF support; does not implement the six roadmap ADT handlers. |
| [#7822](https://github.com/abapGit/abapGit/pull/7822), fork; [#7947](https://github.com/abapGit/abapGit/pull/7947), fork | RVBC handler and assertion lint rule; no ADT adapter additions found. |
| `hvam/o2as0710`, `mbtools/debug-info-env`, `mbtools/package-structure` | Additional public branches inspected; no matching outbound ADT additions found. |

All non-main branch comparisons contained fewer than 100 files. All fork PR
file lists also fit in the requested 100-file page. PR searches for ADT,
HTTP adapter and TADIR found no current ADT repository adapter PR. The only
open HTTP-related experiment located was OCI; a generic Cloud HTTP adapter
remains roadmap intent in the inspected evidence.

## What abapGit actually calls today

There are **zero identified outbound ADT HTTP endpoints** in the inspected
abapGit main and public changes. Thus an abapGit method, Accept, request body,
HTTP status expectation, CSRF policy or session policy for the future object
handlers cannot yet be extracted from implementation.

| Existing reference | URL / operation | HTTP contract and facade coverage |
| --- | --- | --- |
| [ADT transport navigation](https://github.com/abapGit/abapGit/blob/67c7f4690d441a21456bdbdd63a724b5075c8b6b/src/objects/jump/zcl_abapgit_adt_link.clas.abap#L67) | Builds `adt://<system>/sap/bc/adt/cts/transportrequests/<request>` | Navigation URI, not an HTTP request. Method, Accept, body, statuses and CSRF/session requirements: not specified here. OSG-JS transport-resource handling is missing; transport *checks* below are a separate route. osgo: missing. No real identifier is used here. |
| [Object/include URI mapping](https://github.com/abapGit/abapGit/blob/67c7f4690d441a21456bdbdd63a724b5075c8b6b/src/objects/jump/zcl_abapgit_adt_link.clas.abap#L154) | Dynamic, in-process URI mapper calls, including virtual transport mapping | No hardcoded HTTP endpoint or outbound request. Returned object URIs do not establish read/write contracts. |
| [TABL helper `serialize_adt`](https://github.com/abapGit/abapGit/blob/67c7f4690d441a21456bdbdd63a724b5075c8b6b/src/objects/tabl/zcl_abapgit_object_tabl_ddl.clas.abap#L2123) | Reads active TABL content through an in-system workbench operator | Returns DDL text, uses no HTTP client, URL or media negotiation. Its name alone is not evidence of an ADT HTTP call. |
| [Classic HTTP creation](https://github.com/abapGit/abapGit/blob/67c7f4690d441a21456bdbdd63a724b5075c8b6b/src/http/zcl_abapgit_http.clas.abap#L306), [HTTP agent](https://github.com/abapGit/abapGit/blob/67c7f4690d441a21456bdbdd63a724b5075c8b6b/src/http/zcl_abapgit_http_agent.clas.abap#L83) | Generic URL-based HTTP clients used by existing network features | No ADT destination or ADT token/session sequence found. A generic request API is not the environment-selecting Cloud adapter requested by #7880. |

The main-tree `sadt` match is an object-type exclusion, not a REST endpoint.
GUI ADT-context initialization is also in-process. Neither creates another
outbound endpoint inventory entry.

#7880 names six future ADT object handlers and an activation abstraction,
but supplies **no concrete DDIC URL patterns, verbs, media types, bodies,
status codes or session requirements**. It also asks for an ADT TADIR
implementation without choosing an endpoint. Candidate contracts in the next
section are our facade-side proposal, not abapGit requirements.

## Candidate HTTP contract and coverage matrix

All paths in this section are relative to `/sap/bc/adt`, except the explicitly
absolute logoff route. `{n}` is a synthetic object name encoded as one URI
segment; `{c}` is `oo/classes` or `oo/interfaces`. JSON system identity is
not AFF. Media names below describe the existing facade; exact client
negotiation and supported SAP releases remain to be agreed with Lars.

**Status vocabulary:** done = route and stated local behavior implemented;
partial = useful subset with material semantic gaps; missing = no usable
route/contract for the stated operation. These labels do not certify SAP
compatibility or abapGit integration.

**Session rule S:** fetch `X-CSRF-Token: Fetch` on HEAD/GET discovery, retain
all cookies and the returned token, and send the token on POST/PUT/DELETE,
including POST reads. Locks require `X-SAP-ADT-SessionType: stateful` and
session/context affinity; retain the same context for save/unlock. A stateless
read does not discard the lock. Missing/stale token produces 403 with
`X-CSRF-Token: Required`; stateless lock is 400, conflicting lock is 403.
See [session layer](https://github.com/oisee/open-steamgate/blob/17aa0bba4d025c8060cb33f8a05b6cba72ba853b/tools/adt-session.mjs), especially lines 353–379,
and [lock cases](https://github.com/oisee/open-steamgate/blob/17aa0bba4d025c8060cb33f8a05b6cba72ba853b/test/adt-conformance/cases/locks.mjs). Authentication is
intentionally permissive here ([backlog](https://github.com/oisee/open-steamgate/blob/17aa0bba4d025c8060cb33f8a05b6cba72ba853b/docs/backlog/adt.md), line 432), not SAP
credential or authorization validation. This is a candidate client sequence;
abapGit's eventual authentication/CSRF behavior is unknown.

**osgo rule G:** every row below is missing as a usable native ADT contract.
The [expected file](https://github.com/oisee/open-steamgate/blob/17aa0bba4d025c8060cb33f8a05b6cba72ba853b/test/adt-conformance/expected/osgo.json) has 23/23
known-gap entries and no expected pass. [Conformance documentation](https://github.com/oisee/open-steamgate/blob/17aa0bba4d025c8060cb33f8a05b6cba72ba853b/docs/adt-conformance.md)
records 501 at each case's CSRF handshake, at the handler's first `WHERE NP`
trap. The server does answer HTTP; it answers no case successfully. For paths
outside these 23 cases, missing follows the documented common handler gap,
not an individual endpoint measurement. Every osgo cell uses G with this
qualification.

| Candidate endpoint / method | Request and response shape / media | Existing OSG-JS statuses and state needs | OSG-JS coverage and proof | osgo |
| --- | --- | --- | --- | --- |
| `HEAD/GET core/discovery`; `HEAD/GET discovery` | No body; Accept/response `application/atomsvc+xml`; GET service/collection catalogue, HEAD empty | 200; token fetch and cookies, S | **done**: `tools/adt-facade.mjs:1636`; C1/C2/C3 | G |
| `HEAD/GET compatibility/graph` | No body; XML compatibility graph; HEAD empty | 200; token fetch also possible | **done**: `tools/adt-facade.mjs:1657`; optional for proposed client | G |
| `GET core/http/systeminformation` | No body; `application/vnd.sap.adt.core.http.systeminformation.v1+json`; system/client/user/language | 200; session identity | **done**: `tools/adt-facade.mjs:1622`; C9 | G |
| `GET core/http/sessions`; `DELETE core/http/sessions/{id}`; `GET /sap/public/bc/icf/logoff` | Session XML `application/vnd.sap.adt.core.http.session.v3+xml`; DELETE empty; logoff text | 200; DELETE S; ending session releases locks | **done** local session management: `tools/adt-session-routes.mjs:9`, `:29`, `:36`; ABAP front substitutes these in ABAP mode | G |
| `POST repository/nodestructure?parent_name={package}&parent_type=DEVC/K` | Empty or XML `TV_NODEKEY` selections; Accept/response `application/vnd.sap.as+xml;dataname=com.sap.adt.RepositoryObjectTreeContent`; `TREE_CONTENT`, `CATEGORIES`, `OBJECT_TYPES` | 200; S even though this is browsing | **partial for TADIR**, done local tree: `tools/adt-facade.mjs:2799`; C4 | G |
| `GET repository/informationsystem/search?query={pattern}&objectType={type}&maxResults={limit}` | No body; XML `adtcore:objectReferences` with object names/types/URIs | 200; ordinary session read | **partial for TADIR**, done local search: `tools/adt-facade.mjs:2835`; C5; not complete TADIR rows | G |
| `POST repository/informationsystem/virtualfolders/contents` | Selection/preselection XML body; `application/vnd.sap.adt.repository.virtualfolders.result.v1+xml` folder/object references | 200; S; exact request media/version for abapGit unknown | **partial for TADIR**, local Cloud-style drawers: `tools/adt-facade.mjs:1067`; surface wave 1 | G |
| `GET repository/informationsystem/objecttypes`; `POST repository/typestructure` | XML type metadata / AS XML `com.sap.adt.RepositoryTypeList`; POST selection body not required by current implementation | 200; POST S | **done** local metadata, not a promise of every type's lifecycle: `tools/adt-facade.mjs:1084`, `:1557` | G |
| `GET packages/{n}` | Package XML and links | 200/404; normal read | **partial for TADIR** package lookup: `tools/adt-facade.mjs:2743`; no full object-directory metadata | G |
| `GET {c}/{n}` | CLAS `application/vnd.sap.adt.oo.classes.v4+xml`, `class:abapClass`; INTF `application/vnd.sap.adt.oo.interfaces.v2+xml`, interface properties/links | 200/404, ETag/304; normal read | **done** local object reads: `tools/adt-facade.mjs:1825`, `:1840` | G |
| `GET {c}/{n}/source/main?version=active\|inactive` (or no version) | `text/plain` ABAP source; includes separately for CLAS | 200/304/404; active reads require proven active bytes | **done** source versions: `tools/adt-facade.mjs:1667`; R1–R3; facade doc line 242 | G |
| `GET oo/classes/{n}/includes/{part}` and `/source/main` alias | `text/plain`; parts include testclasses and implementations | 200/404 or type-specific missing-include refusal; normal read | **done** reads with documented aliases/active rules: source routing from `tools/adt-facade.mjs:1667`; R4/R5 | G |
| `GET {c}/{n}/objectstructure`; CLAS main/include versions feeds and version content | Objectstructure XML, Atom history feed, source bytes | 200/404; normal read; exact negotiated structure version matters | **partial** across types: `tools/adt-facade.mjs:1765`, `:1802`; O1–O5/V1 verify CLAS; INTF outline client failure remains in facade doc line 145 | G |
| `POST {c}` | Object XML root with `adtcore:name`, description and `adtcore:packageRef`; request CLAS v4 / INTF v2 vendor XML | 201, empty + Location; duplicate 409, missing package 404, missing name 400; S | **done** local create: `tools/adt-facade.mjs:2011`; SAP create success for these types remains unmeasured, facade doc create table | G |
| `POST {c}/{n}?_action=LOCK&accessMode=MODIFY`; `POST ...?_action=UNLOCK&lockHandle={h}` | LOCK no body; Accept `application/vnd.sap.as+xml;dataname=com.sap.adt.lock.Result`; AS XML handle envelope; UNLOCK empty | 200; conflicting 403, stateless 400, unsupported LOCK Accept 406; S + affinity; read-only library returns empty handle | **done** local ownership: `tools/adt-facade.mjs:2087`; L1–L5 | G |
| `PUT {c}/{n}/source/main?lockHandle={h}`; CLAS include PUT aliases | UTF-8 ABAP text, normally `text/plain`; optional `If-Match`; response empty + stored-source ETag | 200; stale ETag 412, absent/invalid ownership refused; S + held lock | **done** source writes: `tools/adt-facade.mjs:2189`, `:2239`; metadata-document updates are separate | G |
| `POST oo/classes/{n}/includes?lockHandle={h}` | Class include XML with name/includeType; creates testclasses explicitly | 201 + include Location; S + held lock | **done** local include create: `tools/adt-facade.mjs:2249`; optional initial slice | G |
| `POST {c}/{n}` without `_action` | Object metadata XML rather than source | Malformed/wrong root 400; otherwise unsupported update 501; S | **missing** valid metadata updates: `tools/adt-facade.mjs:2096`; source PUT does not cover metadata roundtrip | G |
| `DELETE {c}/{n}?lockHandle={h}` | No body; empty response | 200; foreign lock 403, missing/read-only refused; S; current JS delete checks ownership, not a strict required handle on every delete | **done** local deletion: `tools/adt-facade.mjs:2051`; stricter SAP/client handle requirement open | G |
| `GET ddic/dataelements/{n}` | `application/vnd.sap.adt.dataelements.v2+xml`; `blue:wbobj`/DTEL fields derived from classic XML | 200/404; normal read | **partial** DTEL lifecycle, done read projection: `tools/adt-facade.mjs:2758` | G |
| `GET ddic/tables/{n}`; `GET .../source/main` | `application/vnd.sap.adt.tables.v2+xml` table document; `text/plain` DDL projection | 200/304/404; normal read | **partial** TABL lifecycle, done read projection: `tools/adt-facade.mjs:2860`, `:2868` | G |
| DOMA and TTYP object reads; DOMA/DTEL/TABL/TTYP create, payload write, lock/unlock and delete | **URL/method/media/body/status not selected by abapGit**; DTEL/TABL read paths above are candidates for their object URI, not proof of mutation shapes | DDIC-specific success/error and S requirements to measure; do not assume `/source/main` is the DTEL/DOMA editor contract | **missing** DDIC lifecycle: `docs/adt-facade.md:146`–149; source-only selection `tools/adt-facade.mjs:315`; DDIC GET-only handlers above | G |
| `POST checkruns?reporters=abapCheckRun` | XML check-object list with URIs, optionally supplied source buffer; response `application/vnd.sap.adt.checkmessages+xml` | 200 with findings (not necessarily success); S | **partial**: source abaplint checks implemented, DDIC presence/readability only, `tools/adt-facade.mjs:2364`; no real DDIC semantic/dependency check | G |
| `POST activation?method=activate` | XML `adtcore:objectReferences`, optionally inclusive object-set wrapper; `application/xml` checklist `chkl:messages` with execution properties/findings | 200 for success **and validation/build failure**; missing method/no references 400; optional stale `If-Match` 412; S | **partial across six types**, done source-backed publication: `tools/adt-facade.mjs:2468`; collection filter at `:1990` / reference parsing `:2490` excludes DDIC | G |
| `GET activation/inactiveobjects` | XML inactive-object references from local store state | 200; normal read | **partial** for planned DDIC activation: `tools/adt-facade.mjs:2359`; implemented source state does not establish DDIC state parity | G |
| `POST cts/transportchecks` | AS XML checkData request naming object/package; AS XML empty RECORDING/REQUESTS | 200; S | **partial**: honest no-CTS answer, `tools/adt-facade.mjs:2293`; not transportrequest CRUD or authorization | G |
| Unselected ADT TADIR endpoint(s) for full query/insert/delete | #7880 intent only; URL, verb, Accept, payload and statuses unknown | CSRF/session expectations unknown until endpoint selected | **missing** full TADIR adapter contract; local tree/search subsets above | G |

`tools/osd-store-types.mjs:16` and `:17` assign DOMA/TTYP the index paths
`ddic/domains` and `ddic/tabletypes`. These are URI candidates in our store,
not mounted read/editor routes or confirmed abapGit request contracts.

The facade's catch-all (`tools/adt-facade.mjs:2999`) records unanswered paths
and refuses them; it must not be counted as DDIC support. Discovery/type
metadata may list an indexed object kind even when its editor route is absent.
A client of the generic activation endpoint must inspect checklist findings
and execution flags; accepting HTTP 200 alone would make a failed build look
green.

### Six object types by operation

This matrix counts object-specific ADT capability, not filesystem knowledge.
Each cell refers to the endpoint evidence above and the local
[six-type table](https://github.com/oisee/open-steamgate/blob/17aa0bba4d025c8060cb33f8a05b6cba72ba853b/docs/adt-facade.md) at lines 143–155. All 36 osgo cells are
**missing** under G; write/activation/delete cells are outside the current
23-case suite and have not been measured independently.

| Type | Read | Create | Write/source | Lock/unlock | Activate | Delete |
| --- | --- | --- | --- | --- | --- | --- |
| DOMA | missing | missing | missing | missing | missing | missing |
| DTEL | done, XML projection | missing | missing | missing | missing | missing |
| TABL | done, XML + DDL projection | missing | missing | missing | missing | missing |
| TTYP | missing | missing | missing | missing | missing | missing |
| CLAS | done, source/document/includes | done | partial: source done, metadata update missing | done | done locally, abaplint/transpiler semantics | done |
| INTF | done, source/document; outline partial | done | partial: source done, metadata update missing | done | done locally, abaplint/transpiler semantics | done |

Read projections may omit details needed for lossless abapGit serialization;
that remains a client-specific acceptance question. Local source activation is
not the SAP compiler and does not validate every Cloud language/release rule.

### TADIR operations to replace

The existing [TADIR interface](https://github.com/abapGit/abapGit/blob/67c7f4690d441a21456bdbdd63a724b5075c8b6b/src/objects/core/zif_abapgit_tadir.intf.abap)
is the concrete inventory behind the roadmap's unspecified ADT endpoint.
All five methods below have **unknown future HTTP contracts**.

| Operation | Existing abapGit behavior / evidence | OSG-JS equivalent and gap | osgo |
| --- | --- | --- | --- |
| `read` | Package selection; optional recursion, local-only, existence and deletion filters, repository filters and path handling. `zcl_abapgit_tadir.clas.abap:268`, `:461` | **partial** local package tree/search; needs complete enumeration, agreed filtering/pagination and directory fields. Not proof that search is lossless. | G |
| `read_single` | Reads a directory row by program ID, type and name, `:518` | **partial** object lookup exists; no full directory-row response | G |
| `get_object_package` | Resolves package for that key, `:379` | **partial** package refs/local store association; generated/object-specific fallback behavior not equivalent | G |
| `insert_single` | Inserts/updates directory metadata with package, language, original system, generated/editor flags, `:406` | **missing** directory operation; object creation has a packageRef but not these complete semantics | G |
| `delete_single` | Removes directory registration, optional no-throw policy, `:329` | **missing** directory-only delete; object DELETE is not the same operation | G |

The [classic implementation](https://github.com/abapGit/abapGit/blob/67c7f4690d441a21456bdbdd63a724b5075c8b6b/src/objects/core/zcl_abapgit_tadir.clas.abap#L268)
uses local repository queries and registration APIs. Its selection includes
program ID, type/name/package, deletion and original-system filtering. Decide
which metadata the external adapter actually needs before adding a TADIR-like
API. In particular, no standard `/tadir` route has been established here.

Existing [activation orchestration](https://github.com/abapGit/abapGit/blob/67c7f4690d441a21456bdbdd63a724b5075c8b6b/src/objects/core/zcl_abapgit_objects_activation.clas.abap#L137)
queues objects, separates DDIC and other activation, and queries active state
using in-system mechanisms. It has no HTTP activation or lock/token contract.
Replacing object serializers alone will not make the external path run.

## AFF and classic XML

**No ADT-payload-to-AFF conversion was found in abapGit**, because its outbound
ADT handler does not yet exist. Current conversions bridge in-system object
metadata and repository files. AFF repository JSON, classic abapGit XML, ADT
vendor XML and ABAP/DDL text are distinct representations.

| Type | Observed main-tree serialization |
| --- | --- |
| DOMA | [Object handler](https://github.com/abapGit/abapGit/blob/67c7f4690d441a21456bdbdd63a724b5075c8b6b/src/objects/zcl_abapgit_object_doma.clas.abap#L374) and `zcl_abapgit_object_doma.clas.locals_imp.abap:269`, `:312` map DDIC metadata/fixed values to AFF v1 JSON and back through local type mapping and JSON handlers. XML alternative includes DD01V, DD07V_TAB and extra metadata. JSON import is attempted when AFF is enabled, with XML fallback when no JSON is loaded; serialization chooses JSON when enabled. Repository longtexts are handled separately. |
| DTEL | [Object handler](https://github.com/abapGit/abapGit/blob/67c7f4690d441a21456bdbdd63a724b5075c8b6b/src/objects/zcl_abapgit_object_dtel.clas.abap#L221) plus `zcl_abapgit_object_dtel.clas.locals_imp.abap:468`, `:494` convert DD04V metadata to/from AFF JSON. Import chooses by presence of a JSON file; classic XML contains DD04V and DD04L_EXTRA. Handler explicitly notes supplementary documentation is not represented in AFF; it handles AFF longtexts separately. |
| INTF | [Existing experimental implementation](https://github.com/abapGit/abapGit/blob/67c7f4690d441a21456bdbdd63a724b5075c8b6b/src/objects/zcl_abapgit_object_intf.clas.abap#L321) reads JSON through local metadata/type mapping; `:511` exports JSON/translation files when AFF is enabled, otherwise XML; ABAP source remains a separate file (`:804`). Import selection uses AFF enablement (`:626`). This is newer behavior than the roadmap's unchecked INTF AFF item. |
| TABL | [DDL helper](https://github.com/abapGit/abapGit/blob/67c7f4690d441a21456bdbdd63a724b5075c8b6b/src/objects/tabl/zcl_abapgit_object_tabl_ddl.clas.abap#L354) converts internal table metadata to/from DDL text (`:2030`), with in-system active-content read `serialize_adt`. #7864 merged this standalone work. Not AFF JSON or an outbound ADT serializer; current ordinary TABL handler remains classic. |
| TTYP | No AFF registration/handler conversion found for TTYP. [SAP format request #515](https://github.com/SAP/abap-file-formats/issues/515) is still open. Current object handler remains classic XML. |
| CLAS | No CLAS AFF registration/conversion found in the inspected handler; classic XML metadata plus ABAP source/includes. ADT-based conversion remains intent. |

The [AFF registry](https://github.com/abapGit/abapGit/blob/67c7f4690d441a21456bdbdd63a724b5075c8b6b/src/objects/aff/zcl_abapgit_aff_registry.clas.abap#L49)
marks DOMA, DTEL and INTF experimental and gates them on the AFF feature;
TABL, TTYP and CLAS are not registered there. A completed roadmap checkbox
does not mean enabled-by-default export.

No inspected facade object endpoint speaks AFF JSON. DTEL/TABL reads emit
vendor XML/DDL derived from stored classic XML; CLAS/INTF emit vendor XML and
ABAP text. [Backlog X.7](https://github.com/oisee/open-steamgate/blob/17aa0bba4d025c8060cb33f8a05b6cba72ba853b/docs/backlog/adt.md) at line 582 proposes AFF as a future
negotiated wire format with abapGit XML storage. That is a plan, not a current
SAP or facade endpoint contract. Whether SAP ADT offers AFF directly for any
of these types/releases is **an open question**, not disproved by this scan.
Also open: where the new external client will own AFF mapping, which schema
versions and translation/longtext files it needs, how XML fallback works,
and which fields must survive lossless conversion.

## Questions for Lars

1. Which exact URLs, verbs, media versions and error/status contracts should
   the external path use? Is TADIR satisfied by package enumeration plus
   object refs, or does it need complete directory rows and registration?
2. First object: DOMA, or DTEL with a built-in scalar type to avoid a domain
   dependency? Would CLAS/INTF first help validate the HTTP/session seam?
3. How real must checks and activation be for initial CI: persistence and
   active/inactive promotion, dependency-aware DDIC validation, or compiler
   behavior? Which failure and batch-order cases are mandatory?
4. Should CI transpile/run abapGit in Node against OSG-JS, launch a Docker
   target, or invoke an osgo binary? Which client revision/entry point will
   exist first, and should native osgo stay advisory until cases pass?
5. What auth, cookie/context affinity, CSRF refresh/retry and lock-handle
   expectations should we enforce, including Cloud auth and no-popup errors?
6. AFF mapping in the client or negotiated endpoint JSON? Which file/schema
   and translation roundtrips define acceptance?

## Proposed first slice: DTEL

Recommend **DTEL with a built-in scalar type**, subject to Lars's choice.
It reuses the existing DTEL read projection and abapGit AFF mapping while
avoiding a new domain dependency. DOMA is also a bounded first object, but
requires its first read/editor route as well as every mutation route. No
implementation is authorized by this proposal.

Use a disposable writable package and wholly synthetic object/description
values. Keep generated names in test-local state and normalize identities in
reports. The required happy path is **TADIR query → read → write → activate →
read back**, with a separate create scenario so fresh CI does not rely on an
already installed object:

1. Bootstrap discovery/token/session. Enumerate that package via the agreed
   TADIR adapter; assert a type/name/package tuple and URI, including absence
   before create and presence after. Existing node/search routes may suffice
   for a deliberately narrow query, but cannot silently stand for full TADIR.
2. Create a minimal DTEL through the measured collection contract. Read it
   through the existing object URI and map its payload to the agreed AFF or
   classic file representation. Derive URI independently if SAP create has
   no Location; do not borrow the current CLAS 201 contract.
3. Acquire a session-bound DTEL lock, change a label or safe scalar property,
   and save through the measured DDIC payload endpoint. Verify inactive and
   active reads diverge as agreed. Do not send AFF JSON to an XML editor route
   or assume a `/source/main` PUT exists.
4. Activate exactly the DTEL, require a successful checklist and completed
   publication/state promotion, then read active content back and compare
   normalized semantic fields and reserialized repository files.
5. Unlock and delete in cleanup; verify package query absence. Add negative
   cases for duplicate create, foreign/stale lock, token loss, invalid type
   metadata and failed activation retaining previous active content.

Facade work required after contract agreement:

- DTEL collection POST, payload update, object LOCK/UNLOCK and DELETE routes;
  matching discovery/capability advertisements and errors. Existing GET is
  retained but audited for all fields the client must serialize.
- DDIC payload ↔ classic XML store mapping; explicit active/inactive DDIC
  persistence, existence and read-after-write behavior.
- Extend activation reference parsing beyond source-backed collections;
  validate/promote DTEL metadata and dependencies without pretending source
  transpilation is a DDIC compiler. Extend DDIC checkruns beyond readability.
- Implement the agreed TADIR query metadata/filters or explicitly bound the
  first adapter to the package-tree subset; registration semantics only if
  the client needs them.
- Add shared mutation conformance cases and the abapGit-driven integration
  test, registering new suites in `test/suites.d/`. The current 23 cases
  exercise read/lock behavior only. osgo promotions happen one case at a time
  with implementations; do not turn known-gap observations into passes.

For **DOMA instead**, add a discovered/measured DOMA object/editor URI, read
media and fixed-value payload mapping first, then the same create/lock/save/
activation/delete work. Avoid committing an assumed `/ddic/domains` URL as a
verified requirement before the client or reference facts establish it.

### A4H facts to measure later, on explicit request

Record our own normalized facts, then build synthetic documents/tests from
those facts. **Never commit captures**, response dumps, cookies, tokens,
handles, real object names or other live identifiers. No measurement was
performed for this report; existing class/program observations do not prove
DDIC behavior.

| Fact to measure | Why it gates the slice |
| --- | --- |
| Discovery collection URI, relation/category, request/response media versions, capability gates for DTEL (or DOMA) | Select the real endpoint and format instead of guessing from another object kind |
| Minimal create root/namespace, package/language fields, query parameters, defaulting, successful status/body/Location and duplicate errors | Bootstrap a clean CI repository with a portable create contract |
| Read/editor payload fields and attributes, references, optional/default fields, order sensitivity, ETags, `version=active/inactive`, missing-object answers | Preserve the fields required for AFF/classic XML roundtrip and state comparisons |
| Save verb/URI, XML versus JSON versus source, lockHandle/transport parameters, `If-Match` behavior, acknowledged body/media/status | Identify the missing mutation route and prevent source-only assumptions |
| Lock/unlock media and envelope, handle shape, stateful context, repeated/foreign/stale ownership and read-only answers | Reproduce the client's sequencing and failure handling |
| CSRF fetch/rejection/refresh, cookie updates, explicit logoff and stateless reads during a lock | Validate retry and cleanup rather than just a permissive successful request |
| Activation/check request wrapper, object-reference type/URI, checklist flags/messages/severity, single/batch/forced behavior and publication timing | Distinguish HTTP acceptance from real success and preserve active state on failure |
| TADIR query selection, package recursion, ordering/pagination, name/type/package/language fields, generated/deleted filtering; registration effects of create/delete | Decide whether tree/search is enough and what metadata the adapter must supply |
| DOMA → DTEL dependency behavior, invalid definitions, failed promotion, deletion with dependents | Define the next slice beyond a single scalar DTEL and the minimum real validation |
| AFF schema availability per supported release, direct endpoint JSON negotiation if any, translations/longtexts and classic fallback | Decide conversion ownership; JSON existence alone does not establish AFF |

Start CI with a pinned abapGit client in Node and a disposable OSG-JS target
once that client entry point exists. Docker can package the same run if Lars
needs it; it is not a protocol requirement. Keep native osgo a separately
reported target until its handler/store/session gaps close. The deliverable
for the first slice should be one reproducible client roundtrip and meaningful
negative cases, with explicit limitations, not a claim of the whole roadmap
running green.
