<!-- Produced 2026-10-02 by a 16-agent workflow (one spec agent per route family, a completeness critic, a synthesis), read-only against origin/main. Inputs to codex slices; each slice still gets its own critic. Line numbers in the family specs are as of the run and drift as main moves (tools/adt-facade.mjs has since been reorganised): find a route by its pattern, not its line. Ownership agreed 2026-10-02: group A and discovery, feeds/users, debugger/listeners, OSD introspection, notebook: stoker; group C, the front (F1/F2), information system / search / tree and DDIC reads / typestructure: dell; source read / objectstructure: stoker.
Re-scoped 2026-10-03 to variant C (Alice). -->

# ADT on ABAP: port plan

## Variant C (2026-10-03)

Alice decided that ABAP owns the grammar: request parsing, XML/JSON
documents, sessions, CSRF, ENQ and the document routes. The host owns
orchestration permanently, served by the Node facade through the catch-all:
write (A4), create/delete (A5), inactive objects and activation (A6/A7),
git (A8b), ABAP Unit runs (C2b), unit/object/run (C3) and notebook (C6).
No new route is built through a continuation. F3 and one-runtime B4 remain
merged infrastructure; nothing is removed.

The coverage gate has two scope lists. `PORT_PENDING` is the ABAP document
work queue; each slice deletes its own block. `HOST_ALLOWED` is the final
Map of host orchestration registrations and reasons, not a queue. It only
grows by a decision of Alice recorded here. `HOST_BY_DESIGN` separately
names the catch-all registration. Done means `PORT_PENDING` is empty,
every orchestration method reaches HOST, and the router table has exactly
one HOST row, the catch-all, last. All other registrations must have an
ABAP row of their own pattern for every method.

The earlier "100%" goal in section 4, every family behind an ABAP row with
continuations for host work, is superseded. ADT is a parallel track outside
milestone 0.7's must. For ADT, 0.7 keeps only the ABAP-FS regression matrix
in CI.

## 1. Summary

| Family / slices | Variant C | Status | Remaining work |
|---|---|---|---|
| Sessions / logoff / reentrance (A3a/A3b) | ABAP | pending; A3a parked | Poll/delete/logoff, reentranceticket |
| Discovery and debugger/listeners (A1) | ABAP | pending | Discovery documents and listener replies |
| Source read / objectstructure (B2a/B2b) | ABAP | pending | Source and bare documents, outline, INCL/SRVD alias |
| Object create / delete (A5) | HOST | host orchestration, not ported | none in this port |
| Write + includes (A4) | HOST | host orchestration, not ported | none in this port |
| Inactive objects / activation (A6/A7) | HOST | host orchestration, not ported | none in this port |
| Checkruns (C1) | ABAP | landed (#511) | none |
| ABAP Unit metadata / unit/object (C2a) | ABAP | landed (#511) | none |
| ABAP Unit runs / unit/object/run (C2b/C3) | HOST | host orchestration, not ported | none in this port |
| Data preview (C4a/C4b) | ABAP | landed (#526) | none |
| Information system (B1), package/tree (B5), search/VFS (B6) | ABAP | landed (#495, #506, #513) | none |
| Typestructure / DDIC reads (B8a/B8b) | ABAP | landed (#496, #506) | none |
| Feeds, system/users, transportchecks, occurencemarkers (A2) | ABAP | pending | Editor documents |
| Classrun (C5) | ABAP | landed (#525) | none |
| Notebook (C6) | HOST | host orchestration, not ported | none in this port |
| Build, changed, services, transactions (A8a) | ABAP | pending | Introspection documents |
| Git (A8b) | HOST | host orchestration, not ported | none in this port |
| Xref readers/closure (A9), segw/entitysets (A10) | ABAP | pending | Xref and entity-set documents |
| Shared helpers / seam (S0), front (F1/F2) | ABAP | landed (#491, #485, #481, #487) | none |
| Continuation plumbing (F3) | HOST | landed infrastructure (#527) | no new route continuations |
| One-runtime B0-B4 | ABAP | landed infrastructure, switch off by default (#512, #521, #528, #529) | B5/B6 below |

B5/B6 in the information-system row are the document slices. One-runtime
B5/B6 below are separate runtime decisions. The coverage test is the
registration-level source of truth, including earlier graph, sysinfo,
LOCK/UNLOCK and versions rows.

## 2. Slice 0: shared infrastructure, landed first

One PR with two codex runs (0a for ABAP, 0b for the host seam) and one critic pass. It adds no new route rows.

**0a: ABAP helpers (stoker, because the code comes out of his versions and lock classes).**
- **`ZCL_OSD_ADT_URI`:**
  - `ENCODE_COMPONENT`, moved from `VERSIONS=>URI_NAME`.
  - `DECODE_COMPONENT`, which returns ok/failed and never raises. Each caller raises its own Node-equal refusal: 400 "Failed to decode param", 500 osd "URI malformed", 400 "URI malformed" (unit selector), or 500 `ExceptionTransportCheckFailed`.
  - `QUERY( name, found )` with qs semantics: repeated names are joined with `,`, absent and empty are told apart, `+` becomes a space, and a stray `%` stays literal.
- **`ZCL_OSD_ADT_ENTITY`:**
  - `TAG`: sha256 over the UTF-8 bytes, first 32 hex characters, lower case.
  - `NORMALIZED`: trim, strip one `W/`, strip one quote at each end, no comma split. This is the If-Match rule.
  - `SEND`: If-None-Match is a comma list; a 200 gets `type; charset=utf-8`; a 304 gets the bare type.
  - `VERSIONS` is refactored onto it, and its diff test is the guard.
- **`ZCX_OSD_ADT`:**
  - New factories: `MODIFIED` 412, `NOT_LOCKED` 409, `WRONG_DATA` 400, `NO_ACCESS(status)`, `NOT_BUILT` 503, `TRANSPORT_CHECK_FAILED`.
  - A namespace parameter, com.sap.adt or org.open-steamgate.osd.
  - A per-raise `miss` flag (object/resource/none), which F2 needs.
- **`ZCL_OSD_ADT_TYPES`:**
  - `ALL()` returns the 15 TYPES rows in JS order, with collection, source flag, ADT_TYPE (plus the STRU fallback), label, plural, category and the TREE_* labels.
  - `SOURCES()` and `LOCKABLE()` are derived from it.
  - New methods: `OBJECT_FROM_URI` (cut at `#`, then `?`, strip `/source/main`, case-sensitive prefix match) and `TYPE_OF_COLLECTION`.
  - A mocha test holds `ALL()` equal to `osd-store-types.mjs` and `ADT_TYPE`.
- **`ZCL_OSD_ADT_JSON`:** an ordered writer whose escaping equals `JSON.stringify` (C0 as `\u00xx` lower hex, non-ASCII raw). It replaces `SYSINFO=>JSON_STRING`.
- **`ZCL_OSD_ADT_JS`:** `NUMBER` (with a NaN flag), `JS_INT` (parseInt), `GLOB` (star only), and a `COLLATE` key that a mocha test checks against V8's localeCompare.
- **`ZCL_OSD_ADT_SCAN`:** XML scanners written by hand, with no `FIND REGEX`, because 7.02 POSIX has no lazy quantifier and no `\b`. It provides `ATTRIBUTE( xml, element, name )` with a JS `\b`-equivalent boundary, `REFERENCES`, `BLOCKS` and `FIRST_TAG_VALUE`.
- **Document builders:** `ZCL_OSD_ADT_CHECKREPORT` (`checkReportDocument` with `omitEmptyList`) and `ZCL_OSD_ADT_DOC_COMMON` (namedItems, objectReferences, emptyFeed), each with an ABAP Unit against fixtures generated by Node.
- **Session user from the Basic header:** one shared helper.

**0b: host seam (stoker; dell reviews).**
- **`ZOSD_STORE`** gets a new optional `IV_JSON` parameter. It goes into the fugr XML, `osd-store-destination` `givenText`, and the Go key list in `tools/gogen/go/abap/store.go`.
- **One error envelope:** `EV_JSON {error:{code,message}}`, raw message, no prefix. `ZCL_OSD_ADT_HOST` maps NOT_FOUND, CONFLICT, READ_ONLY, NOT_SUPPORTED, INVALID_NAME and INTERNAL to the ZCX factories. The `OBJECT x:` prefix is dropped, and the LOCK diff test is updated.
- **Bound store by default:** every STORE command reads `systemCalls.getStore()?.store ?? open()`. Today only READ, HISTORY, REVISION and OBJECT do. Without this, the diff tests for 4a, checkruns, create/delete and package read or write the wrong tree.
- **READ and OBJECT are each extended once:**
  - READ: `EV_JSON {name, changedBy, empty, error:{code,message}}`.
  - OBJECT: `package`, `packages` (the chain), `changedAt`, `changedBy`, `version`, `includes`.
- **CAPABILITIES rule:** CAPABILITIES drives screen buttons only. A new `COMMANDS` answer lists what the host implements. Routes refuse with 501 when a command is missing (OSGo, the binary).
- **`SYSTEM` raw channel:** when an answer carries a `raw` string, it goes to `EV_SOURCE` untouched, so finished bodies never pass through ajson.

**Rules decided in S0 (subject to the variant C scope above), written into `docs/adt-abap-port/port-map.md`:**
- **PARSE is one STORE command:** `IV_JSON {kind: OUTLINE | DDLS | UNIT_PLAN, ...}`. One dispatcher, owned by dell, with the first user landing it. `structureOf`, the `cdsEntityOf` halves and `runner.classes` become exported functions that both Node and PARSE call.
- **PACKAGE is one command:** `IV_JSON {name, mode: raw | local, user}` gives `EV_JSON`. PACKAGES (OBJECTS) and SEARCH are separate. ET_OBJECT is never used for names (CHAR40/CHAR30 truncation).
- **Git stays host orchestration under variant C.** The earlier proposed STORE GIT_STATE/GIT_BLOB port is superseded.
- **Non-document refusals:** a route may return a non-2xx `ty_response` with its own body only when Node does. The reentranceticket 400s use text/plain; notebook JSON refusals remain host-owned (C6). This is recorded in `ZIF_OSD_ADT_ROUTE`'s contract; nothing is decided per slice.
- **Wire format:**
  - Content types: the front replays a Buffer with `res.set`, so an ABAP `content_type` literal must already be the normalized wire form.
  - ETags: production runs with `app etag false` (`test/start.mjs`, `tools/osd-serve.mjs`). The diff harness is switched to `etag false` as well, so weak-ETag and 304 claims in the specs that come from the harness are dropped. Only strong `ENTITY` tags are part of the contract.
  - Ordering: ABAP never re-sorts a list the host has ordered (localeCompare/ICU). ABAP may `SORT` only where JS uses a plain `.sort()`.
- **Conformance baseline:** the ABAP-FS figure is re-measured on main in S0 and recorded in `docs/abapfs-conformance.md`. Every later slice compares against the figure at its merge base. The two numbers quoted today, 29/2/16 and 30/1/16, are both superseded.
- **Done gate (new test, `test/adt-abap-coverage.mjs`):**
  - It walks the `adtRouter` Express stack (method plus path, with a sample instance per pattern) and checks the front's `MATCH` against the variant C scope lists.
  - `PORT_PENDING` holds the remaining document registrations. **Each slice deletes its own entries.** Done means this queue is empty, with the host checks described above still passing. `HOST_ALLOWED` is permanent orchestration scope.
- **Acceptance for S0:** versions, lock and sysinfo diffs stay green after the refactor; the TYPES parity mocha test passes; `npm run lint` is clean (ASCII); the coverage test passes with the full allow-list. No behaviour changes.

## 3. Slices per owner

Every remaining document slice is one codex run plus a Claude critic. Its acceptance is `test/adt-abap-diff.mjs`-style: the Node façade and the ABAP-front façade over one store (or over mtime-preserved copies for writes) must agree byte for byte on status, content-type, content-length, strong ETag, Location, every Set-Cookie line, and the body. On top of that, every document slice must:
- show the served-by line as ABAP for every row it ports;
- remove its own entries from `PORT_PENDING`;
- keep ABAP-FS conformance no worse than the baseline;
- show at least one red proof (a mutant that the diff catches).

### Front-up (dell, file owner of `tools/adt-abap-front.mjs`)

| Slice | Content | Acceptance |
|---|---|---|
| **F1** | **Landed.** Rebase and merge `feat/adt-front-up`, rebased on main after #471. Extend `TY_REQUEST` once: `session` (id, user, stateful), a `sessions` ref, `pattern`, `uri` (`~request_uri`). Add `ZIF_OSD_ADT_SESSION~RELEASE_OBJECT`. The handler skips RESOLVE, CSRF and stamping outside `/sap/bc/adt`. Add `ZCL_OSD_ADT_HANDLER=>FENCE` (commit before route work, roll back route work only), so routes never COMMIT or ROLLBACK ad hoc. | `adt-abap-session(s)`, `adt-session` and the existing diff tests stay green; a route reads `is_request-session`. |
| **F2** | **Landed.** Front extensions: replay 3xx and 201 with `res.end` and an explicit Content-Length (no ETag); append every Set-Cookie instead of setting it; mount the front on `/sap/public/bc/icf/logoff` (Node host only, no sicf); build the query record from `req.query` (qs semantics: joined repeats, nested values and raw bad escapes, matching Node routes); add an `X-OSD-Miss` marker driven by the ZCX flag (stripped, then recorded in `facade.missed`); add a host-only **`/osd/ready`** outside `/sap/bc/adt` that never enters a step, and switch `osd ready`, release smoke, `run.ps1` and `osd-restart.sh` from `core/http/build` and HEAD discovery to it. | Fixture routes return 307 and 201 byte-equal; three cookies survive the replay; a 404 shows up in `/osd/not-served`; `osd ready` answers while a gated step is held. |

The host orchestration rows below record the final boundary; their earlier
port designs and acceptance matrices are superseded. Landed rows retain
their implementation notes. Pending rows describe planned work.

### stoker

| Slice | Content | Acceptance |
|---|---|---|
| **S0** | **Landed.** Section 2 above. | As in section 2. |
| **A1** | `ZCL_OSD_ADT_DISCOVERY`: four rows (explicit HEAD rows before GET), `COLLECTIONS` in `advertise()` order, quirks kept. **`debugger/listeners`** gets GET, POST and DELETE rows answering 200 untyped and empty. The diff warm-up moves to an unknown path that hits the catch-all. Discovery rows stay in ABAP coverage permanently. **From this slice on, any PR that changes an `advertise()` call also changes `COLLECTIONS`.** | Byte-equal on both discovery paths, case and trailing-slash variants, HEAD with `x-csrf-token: fetch` (no Content-Length); 3×3 listener cases. Red proofs: one title character changed; a dummy `advertise()` added. |
| **A2** | Editor helpers: `ZCL_OSD_ADT_FEEDS` (5 feeds plus `system/users`, identity unescaped, a 24-character `now_iso`), `ZCL_OSD_ADT_TRANSPORT` (`OBJECT` package, `OBJECT` errors swallowed as Node does), `ZCL_OSD_ADT_OCCURRENCES`, which **this slice owns, so abap-unit drops its row**. | `atom:updated` masked after a format check; transport matrix (`/source/main`, `#`, `?`, DEVCLASS absent/empty/self-closing, `%zz` gives a 500); occurrence-marker `uri` matrix. |
| **A3a** | `ZCL_OSD_ADT_SESSIONS` (GET poll with the sha256 security id, DELETE `sessions/:id`) and `ZCL_OSD_ADT_LOGOFF` (no RESOLVE; guard on a 24-character lowercase hex id, pinned by a unit case). Delete the Node `Sessions.end` calls from the façade. | Poll, delete and logoff matrices from the spec; logoff answers carry no Set-Cookie, token or generation, and the row count is unchanged; the two-cookie precedence case passes; `test/adt-devloop.mjs:1270-1360` stays green. |
| **A3b** | Tighten the Node route first (a strict loopback grammar applied before `new URL()`), then `ZCL_OSD_ADT_REENTRANCE`: query re-serialization, Accept negotiation, `escapeHtml`, the `sap-usercontext` cookie, the three plain-text 400s. Before landing, confirm against a STG_ADT_DUMP capture of an Eclipse cloud logon. | Reentrance matrix incl. 127.1 and 0x7f000001 refused identically on both sides; no ETag on the 307; cookie order is context, session, usercontext. |
| **A4** | **Host orchestration (variant C), not ported.** Source writes and include writes/creation stay in the Node facade. | Every method reaches HOST through the catch-all; existing host tests remain. |
| **A5** | **Host orchestration (variant C), not ported.** Object creation and deletion stay in the Node facade. | Every method reaches HOST through the catch-all; existing host tests remain. |
| **F3** | **Landed.** Continuation plumbing on top of front-up: kinds registered once at module scope; per-request `req.osdFacade = {store, options, step}`; one re-entry point `ZCL_OSD_ADT_HANDLER=>RESUME( kind, json )` that calls the route's `ZIF_OSD_ADT_RESUMABLE~RESUME`; preview and service-worker stubs that return today's 500 for every kind. The resume step must not run in `outsideStepContext`. | Two `adtRouter`s in one process each resume against their own store; a fake kind finishes through RESUME. |
| **A6** | **Host orchestration (variant C), not ported.** Inactive objects and the activation protocol stay in the Node facade. | Every method reaches HOST through the catch-all; existing host tests remain. |
| **A7** | **Host orchestration (variant C), not ported.** Activation publication and completion stay in the Node facade. | Every method reaches HOST through the catch-all; existing host tests remain. |
| **A8a** | Thin introspection rows in `ZCL_OSD_ADT_INTROSPECT`: build, changed, services, transactions over SYSTEM `raw`. The Node bodies become shared functions that both the Node route (child mode) and the SYSTEM kind call. Refusals use the com.sap.adt namespace, never `internal()`. | Body and key-order matrix from the spec (root undefined, liveHash undefined, two identities, forced throw). Measure transactions' per-request file walk inside the step; no new continuation route is planned. |
| **A8b** | **Host orchestration (variant C), not ported.** git/object and git/object/revision stay in the Node facade. | Every method reaches HOST through the catch-all; existing host tests remain. |
| **A9** | xref/readers and xref/closure: Open SQL over WBCROSSGT/X, SYSTEM XREF_WARM, OBJECT_TYPES, TESTCLASSES, SERVICE_ROWS, SEGW_REGISTRATIONS; `COLLATE` sort for closure; a cap seam `options.xrefLimit`. | The spec's cases; collation checked against V8 over every name in `store.list()`. |
| **A10** | segw/entitysets. **First wrap the Node route in `answer()`**, so a throw becomes an ADT document instead of Express's HTML page. Then port: per-line scan with CR stripped; the CONSTANTS pattern runs over the whole text. | Demo DPC_EXT, an STG-generated MPC, 16-character prefixes (ambiguous and unique), CRLF, 404, 400. |
| **C6** | **Host orchestration (variant C), not ported.** Notebook validation, write, publication and execution stay in the Node facade. | Every method reaches HOST through the catch-all; existing host tests remain. |

### dell

| Slice | Content | Acceptance |
|---|---|---|
| **B1** | **Landed.** `ZCL_OSD_ADT_RIS_STATIC`: facets, objecttypes, releasestates, objectproperties/values, `packages/settings`, `packages/valuehelps/:what`. Row order: settings before `packages/:name`. | Six statics × GET/HEAD/slash/case; valuehelps case-sensitivity. |
| **B8a** | **Landed.** typestructure plus `ddic/tables/parser/info` (miss = resource). | Accept dataname variants. |
| **B8b** | **Landed.** `ZCL_OSD_ADT_DDIC`: DTEL and TABL documents, `tables/:name/source/main`, `TABLE_FIELDS` (resolver hook prepared but not called). | The spec's DTEL and TABL matrix, including the inactive table still showing `active`/epoch and the mixed-case 404. |
| **B2a** | `ZCL_OSD_ADT_SOURCE` and `ZCL_OSD_ADT_OBJECT`: source/main, both include routes, bare CLAS/PROG/INTF/DDLS documents; 22 generated rows. | Cases (1)-(7) and (12) (Node PUT followed by an ABAP 304); BOM/CRLF/Cyrillic fixture. |
| **B2b** | The PARSE dispatcher with kind OUTLINE; `ZCL_OSD_ADT_STRUCTURE`; the INCL/SRVD bare alias. **Precondition in this slice: the host warms the outline registry (`store.registry()`) after write and activation**, so no cold parse runs in a step. | Case (8); case (9) records cold and warm latency; Identifier twins; `xml:base` with the query string. |
| **B5** | **Landed.** STORE PACKAGE (raw/local); `ZCL_OSD_ADT_PACKAGE` and `ZCL_OSD_ADT_TREE` (nodepath, nodestructure). **Fix the Node nodepath URIError first.** | Fixtures `$ZT_A` vs `$ZTA`, namespaced, library, `$TMP` with two users; the `??` chains; node keys; flat root. |
| **B6** | **Landed.** Implemented: STORE PACKAGES/SEARCH bulk line replies; ABAP search and VFS filtering/counting/XML; SYSTEM VFS removed. | Live Node diff: maxResults including NaN and huge negatives, `/K`, seed `max*4`, 12-object order and all facet orders. Accepted search 9.24 ms ABAP / 2.14 ms Node; VFS 98.41 ms / 80.65 ms (section 4). |
| **C1** | **Landed.** Checkruns: STORE CHECKRUN over an extracted shared `checkRunReport()`; reporters; package expansion through PACKAGE raw. | The spec's 15 cases plus a destination test for the bound store and an empty overlay. |
| **C4a** | **Landed.** Freestyle: SYSTEM SQL and SQLCHECK in the **serving child on raw DEFAULT inside a savepoint**, shared cell module, `ZCL_OSD_ADT_TABLEDATA`. | Freestyle and checkSyntax matrix on sqlite **and duckdb**, plus the PostgreSQL fence client test (a refused SELECT must not lose the session row); the red proof with `lockedClient` shows the nested-step error. |
| **C4b** | **Landed.** ddic and cds preview (4 rows); PARSE kind DDLS; `TABLE_FIELDS` with the resolver. | Cases 1-4; measure the per-field READ cost on a wide table. |
| **C2a** | **Landed.** `abapunit/metadata` and GET `core/http/unit/object` over PARSE UNIT_PLAN. Measure the cold xref graph; pre-warm at start if it is over 1 s. | metadata GET/HEAD; unit/object matrix with JSON escapes. |
| **C2b** | **Host orchestration (variant C), not ported.** ABAP Unit testruns and evaluation stay in the Node facade. | Every method reaches HOST through the catch-all; existing host tests remain. |
| **C3** | **Host orchestration (variant C), not ported.** unit/object/run stays in the Node facade. | Every method reaches HOST through the catch-all; existing host tests remain. |
| **C5** | **Landed.** Classrun: `ZCL_OSD_ADT_CLASSRUN`, a `ZCL_OSD_KERNEL_GUARD` @KERNEL try/catch (a runtime seam, not a host capability; the note goes in the port-map), SYSTEM DUMP (queued, not awaited), `FENCE` from F1. In the same slice, Node gets a 503 NOT_BUILT before `importFresh`. | Cases 1-14; the red proof without the guard (an ASSERT-todo error gives a 500). |

## 4. What stays on the host

Variant C keeps A4, A5, A6/A7, A8b, C2b, C3 and C6 as host
orchestration. These registrations reach the Node facade through the
catch-all permanently. They are not queued for ABAP rows or continuations.
The table still has exactly one HOST row, the catch-all; a HOST row per
family is unnecessary. The gate proves that every method of every
`HOST_ALLOWED` entry reaches HOST, and rejects even one ABAP-served method.

Host capabilities used by ABAP document rows remain host work: filesystem
facts through STORE, abaplint parse/check/outline/unit plans, backend SQL,
and SYSTEM facts. ABAP owns the document and refusal grammar. `/osd/ready`
remains a host liveness probe outside ADT. F3 and one-runtime B4 continuation
plumbing remain available infrastructure, with no new route built on it.

B6 accepted measurements (this clone, Node 26, 159 packages / 1,937 objects,
20 warm wire samples): search **9.24 ms ABAP vs 2.14 ms Node**, below the
10 ms target; VFS group drawers **98.41 ms ABAP vs 80.65 ms Node**. Bulk
package and object facts now cross STORE as line records in EV_SOURCE;
VFS parsing, filtering, subtree counts and XML are ABAP. SYSTEM VFS is
removed. The diagnostic ajson parse of the old 202,026-byte full tree costs
281.84 ms and is no longer on either ABAP route's bulk path. See
[slice-b6.md](slice-b6.md) for the decision and measurement table.

Completion is `PORT_PENDING` empty with all coverage checks passing:
no stale or overlapping scope entries, every unlisted registration served
by its own ABAP pattern for every method, host orchestration always HOST,
and the single last HOST catch-all. ABAP-FS conformance must remain no
worse than the baseline. Node handlers also remain the byte-diff reference
and serve modes that do not mount the ABAP front.

## 5. Critical path

The remaining document slices are B2a, B2b, A1, A2, A3a, A3b, A8a,
A9 and A10. The landed S0 and F1/F2 provide their shared seam and front.
A3b follows A3a; B2b needs the PARSE OUTLINE seam and registry warm-up.
A3a remains pending here despite its parked implementation branch.
Activation, notebook and unit runs stay host-owned permanently; they have no port work.
The earlier serial chains A6 -> A7 -> C6 and C2b -> C3 are superseded.

One-runtime B5/B6 are the other remaining part of this track. Alice's
2026-10-03 decisions are:

- **B5:** remove the parent kernel and enable `OSD_ADT_ONE_RUNTIME` by
  default after the items under ["Before the switch is turned on by
  default" in one-runtime-b2.md](one-runtime-b2.md#scope-differences-and-remaining-slices)
  are closed. A 2-3 s ADT pause while the serving child restarts is accepted.
- **B6:** one work process by default; a pool only by explicit setting.
  There is no shared lock server in this scope; that belongs to E2.

The runtime B0-B4 work is merged and remains off by default today. These
are planned defaults, not implemented behavior. There is no revised
slice-turn estimate here. ADT is a parallel track outside 0.7's must;
0.7 retains only the ABAP-FS regression matrix in CI for this track.

## 6. The critic's missing routes, resolved

| Route | Slice | Notes |
|---|---|---|
| GET `/sap/bc/adt/debugger/listeners` | **A1** (stoker) | 200 `res.end()`, untyped, empty. |
| POST `/sap/bc/adt/debugger/listeners` | **A1** | Same; CSRF stays the front's gate. |
| DELETE `/sap/bc/adt/debugger/listeners` | **A1** | Same. |
| Discovery warm-up "stays HOST" assumption | **A1** | The warm-up uses an unknown path that hits the catch-all. |
| `occurencemarkers` claimed twice | **A2** (stoker) | C2a drops its row. |
| `core/http/build` liveness under the FIFO | **F2** (`/osd/ready`) + **A8a** (row) | HEAD core/discovery stops being the restart probe. |
| Already ABAP: systeminformation, LOCK/UNLOCK, versions (all forms), compatibility/graph | landed | Covered by the gate as ABAP registrations. |
| `router.use` middleware (sessions, X-OSD-Generation, STG_ADT_DUMP) | F1/F2 (front) | Not route rows; out of the row count. |

**Document-slice ownership (2026-10-02, subject to variant C scope):**

- stoker owns discovery, feeds/users, debugger/listeners and the ABAP
  introspection documents. Source read / objectstructure (B2a/B2b), listed
  under dell above, also belong to stoker by the 2026-10-02 agreement.
- dell owns the ABAP document subset of group C, the front F1/F2,
  information system / search / tree and DDIC reads / typestructure.
