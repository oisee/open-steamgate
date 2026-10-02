<!-- Produced 2026-10-02 by a 16-agent workflow (one spec agent per route family, a completeness critic, a synthesis), read-only against origin/main. Inputs to codex slices; each slice still gets its own critic. Line numbers in the family specs are as of the run and drift as main moves (tools/adt-facade.mjs has since been reorganised): find a route by its pattern, not its line. Ownership agreed 2026-10-02: group A and discovery, feeds/users, debugger/listeners, OSD introspection, notebook: stoker; group C, the front (F1/F2), information system / search / tree and DDIC reads / typestructure: dell; source read / objectstructure: stoker. -->

# ADT on ABAP 100%: port plan (milestone 0.7, "must")

Sources: 15 family specs plus the critic's findings. I checked one fact on origin/main as of 2026-10-02: the router has graph, sysinfo, LOCK and versions rows, then a `*` HOST catch-all. `debugger/listeners` is still Node-only (`tools/adt-facade.mjs`), and `feat/adt-front-up` has not been merged.

## 1. Summary

| # | Family | Node routes (ABAP rows) | Recommendation | Effort | Owner | Depends on |
|---|---|---|---|---|---|---|
| 1 | sessions / logoff / reentrance | 4 (4) | port | M | stoker | F1, F2 |
| 2 | discovery (+ compatibility graph, already done) | 6 (4 new) | port | S | stoker (proposed) | slice 1 (landed) |
| 3 | debugger/listeners (missed by every spec) | 3 (3) | port | S | stoker (proposed) | none |
| 4 | source read / objectstructure | 7 (30, generated) | port + STORE PARSE OUTLINE | L | stoker | S0, versions helpers |
| 5 | object create / delete | 2 (14, generated) | port + STORE CREATE/DELETE | M | stoker | S0, F1 |
| 6 | write + includes (4a) | 4 (9) | port | M | stoker | S0, F1 (session-native, no LOCK_OF) |
| 7 | activation + inactiveobjects (4b) | 2 (2) | ABAP protocol + host continuation | L | stoker | S0, F3 |
| 8 | checkruns | 2 (2) | port + STORE CHECKRUN | M | dell | S0, F1, B5 (PACKAGE) |
| 9 | ABAP Unit | 5 (5) | ABAP protocol + host continuation | L | dell | S0, F3, PARSE |
| 10 | data preview | 5 (5) | port + STORE SQL/SQLCHECK | L | dell | S0, B8b, PARSE |
| 11 | information system / search / tree | 11 (11) | port + STORE PACKAGE/PACKAGES/SEARCH | L | dell | S0, F2 (qs record), Node fixes |
| 12 | DDIC reads + typestructure | 5 (5) | port | M | dell | S0 |
| 13 | editor helpers + transport check | 8 (8) | port | M | stoker (proposed) | S0 |
| 14 | classrun + notebook | 2 (2) | classrun: port; notebook: protocol + continuation | L | dell (classrun), stoker (notebook, proposed) | F1 fence, F3 |
| 15 | OSD introspection (build, changed, git, services, transactions, entitysets, xref) | 9 (9) | port: thin rows over STORE/SYSTEM, xref and entitysets real ports | L | stoker (proposed: the family is unassigned, and this balances the load) | S0, F2 (/osd/ready) |
| | **Total** | **~75 Node registrations** | | | | |

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

**Rules decided in S0, written into `docs/adt-abap-port/port-map.md`:**
- **PARSE is one STORE command:** `IV_JSON {kind: OUTLINE | DDLS | UNIT_PLAN, ...}`. One dispatcher, owned by dell, with the first user landing it. `structureOf`, the `cdsEntityOf` halves and `runner.classes` become exported functions that both Node and PARSE call.
- **PACKAGE is one command:** `IV_JSON {name, mode: raw | local, user}` gives `EV_JSON`. PACKAGES (OBJECTS) and SEARCH are separate. ET_OBJECT is never used for names (CHAR40/CHAR30 truncation).
- **Git stays on STORE**, the HISTORY/REVISION family, as ADR 0007 says: new commands `GIT_STATE` and `GIT_BLOB`. The route must use `gitObjectRevision` and not `gitObjectRevisionAt` (different message text, no rename following).
- **Non-document refusals:** a route may return a non-2xx `ty_response` with its own body only when Node does. Known cases: the reentranceticket 400s (text/plain) and the notebook (JSON). This is recorded in `ZIF_OSD_ADT_ROUTE`'s contract; nothing is decided per slice.
- **Wire format:**
  - Content types: the front replays a Buffer with `res.set`, so an ABAP `content_type` literal must already be the normalized wire form.
  - ETags: production runs with `app etag false` (`test/start.mjs`, `tools/osd-serve.mjs`). The diff harness is switched to `etag false` as well, so weak-ETag and 304 claims in the specs that come from the harness are dropped. Only strong `ENTITY` tags are part of the contract.
  - Ordering: ABAP never re-sorts a list the host has ordered (localeCompare/ICU). ABAP may `SORT` only where JS uses a plain `.sort()`.
- **Conformance baseline:** the ABAP-FS figure is re-measured on main in S0 and recorded in `docs/abapfs-conformance.md`. Every later slice compares against the figure at its merge base. The two numbers quoted today, 29/2/16 and 30/1/16, are both superseded.
- **Done gate (new test, `test/adt-abap-coverage.mjs`):**
  - It walks the `adtRouter` Express stack (method plus path, with a sample instance per pattern) and asserts that the front's `MATCH` returns ABAP.
  - A `HOST_ALLOWED` list starts with every unported route. **Each slice deletes its own entries.** Done means the list is empty and the router has exactly one HOST row.
- **Acceptance for S0:** versions, lock and sysinfo diffs stay green after the refactor; the TYPES parity mocha test passes; `npm run lint` is clean (ASCII); the coverage test passes with the full allow-list. No behaviour changes.

## 3. Slices per owner

Every slice is one codex run plus a Claude critic. Every acceptance is `test/adt-abap-diff.mjs`-style: the Node façade and the ABAP-front façade over one store (or over mtime-preserved copies for writes) must agree byte for byte on status, content-type, content-length, strong ETag, Location, every Set-Cookie line, and the body. On top of that, every slice must:
- show the served-by line as ABAP for every row it ports;
- remove its own entries from `HOST_ALLOWED`;
- keep ABAP-FS conformance no worse than the baseline;
- show at least one red proof (a mutant that the diff catches).

### Front-up (dell, file owner of `tools/adt-abap-front.mjs`)

| Slice | Content | Acceptance |
|---|---|---|
| **F1** | Rebase and merge `feat/adt-front-up`, rebased on main after #471. Extend `TY_REQUEST` once: `session` (id, user, stateful), a `sessions` ref, `pattern`, `uri` (`~request_uri`). Add `ZIF_OSD_ADT_SESSION~RELEASE_OBJECT`. The handler skips RESOLVE, CSRF and stamping outside `/sap/bc/adt`. Add `ZCL_OSD_ADT_HANDLER=>FENCE` (commit before route work, roll back route work only), so routes never COMMIT or ROLLBACK ad hoc. | `adt-abap-session(s)`, `adt-session` and the existing diff tests stay green; a route reads `is_request-session`. |
| **F2** | Front extensions: replay 3xx and 201 with `res.end` and an explicit Content-Length (no ETag); append every Set-Cookie instead of setting it; mount the front on `/sap/public/bc/icf/logoff` (Node host only, no sicf); build the query record from `req.query` (qs semantics, so a stray `%` no longer throws in `unescape_url`); add an `X-OSD-Miss` marker driven by the ZCX flag (stripped, then recorded in `facade.missed`); add a host-only **`/osd/ready`** outside `/sap/bc/adt` that never enters a step, and switch `osd ready`, release smoke, `run.ps1` and `osd-restart.sh` from `core/http/build` and HEAD discovery to it. | Fixture routes return 307 and 201 byte-equal; three cookies survive the replay; a 404 shows up in `/osd/not-served`; `osd ready` answers while a gated step is held. |

### stoker

| Slice | Content | Acceptance |
|---|---|---|
| **S0** | Section 2 above. | As in section 2. |
| **A1** | `ZCL_OSD_ADT_DISCOVERY`: four rows (explicit HEAD rows before GET), `COLLECTIONS` in `advertise()` order, quirks kept. **`debugger/listeners`** gets GET, POST and DELETE rows answering 200 untyped and empty. The diff warm-up moves to an unknown path that hits the catch-all. Discovery rows stay in PORTED permanently. **From this slice on, any PR that changes an `advertise()` call also changes `COLLECTIONS`.** | Byte-equal on both discovery paths, case and trailing-slash variants, HEAD with `x-csrf-token: fetch` (no Content-Length); 3×3 listener cases. Red proofs: one title character changed; a dummy `advertise()` added. |
| **A2** | Editor helpers: `ZCL_OSD_ADT_FEEDS` (5 feeds plus `system/users`, identity unescaped, a 24-character `now_iso`), `ZCL_OSD_ADT_TRANSPORT` (`OBJECT` package, `OBJECT` errors swallowed as Node does), `ZCL_OSD_ADT_OCCURRENCES`, which **this slice owns, so abap-unit drops its row**. | `atom:updated` masked after a format check; transport matrix (`/source/main`, `#`, `?`, DEVCLASS absent/empty/self-closing, `%zz` gives a 500); occurrence-marker `uri` matrix. |
| **A3a** | `ZCL_OSD_ADT_SESSIONS` (GET poll with the sha256 security id, DELETE `sessions/:id`) and `ZCL_OSD_ADT_LOGOFF` (no RESOLVE; guard on a 24-character lowercase hex id, pinned by a unit case). Delete the Node `Sessions.end` calls from the façade. | Poll, delete and logoff matrices from the spec; logoff answers carry no Set-Cookie, token or generation, and the row count is unchanged; the two-cookie precedence case passes; `test/adt-devloop.mjs:1270-1360` stays green. |
| **A3b** | Tighten the Node route first (a strict loopback grammar applied before `new URL()`), then `ZCL_OSD_ADT_REENTRANCE`: query re-serialization, Accept negotiation, `escapeHtml`, the `sap-usercontext` cookie, the three plain-text 400s. Before landing, confirm against a STG_ADT_DUMP capture of an Eclipse cloud logon. | Reentrance matrix incl. 127.1 and 0x7f000001 refused identically on both sides; no ETag on the 307; cookie order is context, session, usercontext. |
| **A4** | 4a: `ZCL_OSD_ADT_WRITE` covering PUT `source/main`, both PUT include forms and POST includes. It uses the **session interface plus an ENQ probe, not SYSTEM LOCK_OF** (it lands after F1). WRITE goes through the bound store (from S0). The decoder is created with `ignore_cerr`. The slice-2 `byAbap` assertion changes in the same commit. | The spec's sequences 1-11, including the 409 for an unknown object (not 404), If-Match variants, the `stillHeld` race done through ENQ removal, and invalid UTF-8 decoding to U+FFFD. The release-during-body text difference is documented and compared by status only. |
| **A5** | Create and delete: `ZCL_OSD_ADT_OBJ_CREATE` and `ZCL_OSD_ADT_OBJ_DELETE`, 14 generated rows, new STORE CREATE and DELETE (`IV_JSON`, bound store), ENQ probe lifted into `ZCL_OSD_ADT_ENQ` (shared with LOCK), double decode with a "URI malformed" 500. | 16 create and 12 delete cases on two fixture copies, with the file tree compared and createdAt masked; mutants: missing DEQUEUE, single decode, unbound store. |
| **F3** | Continuation plumbing on top of front-up: kinds registered once at module scope; per-request `req.osdFacade = {store, options, step}`; one re-entry point `ZCL_OSD_ADT_HANDLER=>RESUME( kind, json )` that calls the route's `ZIF_OSD_ADT_RESUMABLE~RESUME`; preview and service-worker stubs that return today's 500 for every kind. The resume step must not run in `outsideStepContext`. | Two `adtRouter`s in one process each resume against their own store; a fake kind finishes through RESUME. |
| **A6** | 4b-1: GET `inactiveobjects` (STORE INACTIVE, host order) and POST `activation` step 1: reference scan, If-Match/412, STORE VERDICT, the failure document, and the `transpileOnActivate:false` path through STORE COMPLETE. Publish cases still delegate. | Cases (1)-(4) of the activation plan, with OSD_WARM off. |
| **A7** | 4b-2: the `activation` continuation (publish, `warmHeaders`) followed by `FINISH` through RESUME, COMPLETE with the named-only `built` map. Flag to the screen's owner that STORE ACTIVATE publishes inside the step (a FIFO violation that is not ours). | Cases (5)-(7), including the FIFO proof: an ABAP row answers while publish is gated. |
| **A8a** | Thin introspection rows in `ZCL_OSD_ADT_INTROSPECT`: build, changed, services, transactions over SYSTEM `raw`. The Node bodies become shared functions that both the Node route (child mode) and the SYSTEM kind call. Refusals use the com.sap.adt namespace, never `internal()`. | Body and key-order matrix from the spec (root undefined, liveHash undefined, two identities, forced throw). Measure transactions' per-request file walk inside the step; if it is over about 50 ms, turn it into a continuation-kind read. |
| **A8b** | git/object and git/object/revision over STORE GIT_STATE and GIT_BLOB. | clean, modified (tab, CR, U+2028), untracked, ignored, unborn; a sha before a rename gives a 400 with the capital-G text. |
| **A9** | xref/readers and xref/closure: Open SQL over WBCROSSGT/X, SYSTEM XREF_WARM, OBJECT_TYPES, TESTCLASSES, SERVICE_ROWS, SEGW_REGISTRATIONS; `COLLATE` sort for closure; a cap seam `options.xrefLimit`. | The spec's cases; collation checked against V8 over every name in `store.list()`. |
| **A10** | segw/entitysets. **First wrap the Node route in `answer()`**, so a throw becomes an ADT document instead of Express's HTML page. Then port: per-line scan with CR stripped; the CONSTANTS pattern runs over the whole text. | Demo DPC_EXT, an STG-generated MPC, 16-character prefixes (ambiguous and unique), CRLF, 404, 400. |
| **C6** | Notebook (moved from dell; it reuses 4b's write/publish/complete path): validation in ABAP (JSON 400s), a `NOTEBOOK_CELL` continuation, then RESUME, then `ZCL_OSD_ADT_CLASSRUN=>RUN`. | Body matrix, 503 when there is no scratch root, 422 with the source restored, 200 JSON with `ms` normalized, two cells serialized. Needs C5. |

### dell

| Slice | Content | Acceptance |
|---|---|---|
| **B1** | `ZCL_OSD_ADT_RIS_STATIC`: facets, objecttypes, releasestates, objectproperties/values, `packages/settings`, `packages/valuehelps/:what`. Row order: settings before `packages/:name`. | Six statics × GET/HEAD/slash/case; valuehelps case-sensitivity. |
| **B8a** | typestructure plus `ddic/tables/parser/info` (miss = resource). | Accept dataname variants. |
| **B8b** | `ZCL_OSD_ADT_DDIC`: DTEL and TABL documents, `tables/:name/source/main`, `TABLE_FIELDS` (resolver hook prepared but not called). | The spec's DTEL and TABL matrix, including the inactive table still showing `active`/epoch and the mixed-case 404. |
| **B2a** | `ZCL_OSD_ADT_SOURCE` and `ZCL_OSD_ADT_OBJECT`: source/main, both include routes, bare CLAS/PROG/INTF/DDLS documents; 20 generated rows. | Cases (1)-(7) and (12) (Node PUT followed by an ABAP 304); BOM/CRLF/Cyrillic fixture. |
| **B2b** | The PARSE dispatcher with kind OUTLINE; `ZCL_OSD_ADT_STRUCTURE`; the INCL/SRVD bare alias. **Precondition in this slice: the host warms the registry (`store.warm`) after write and activation**, so no cold parse runs in a step. | Case (8); case (9) records cold and warm latency; Identifier twins; `xml:base` with the query string. |
| **B5** | STORE PACKAGE (raw/local); `ZCL_OSD_ADT_PACKAGE` and `ZCL_OSD_ADT_TREE` (nodepath, nodestructure). **Fix the Node nodepath URIError first.** | Fixtures `$ZT_A` vs `$ZTA`, namespaced, library, `$TMP` with two users; the `??` chains; node keys; flat root. |
| **B6** | STORE PACKAGES and SEARCH; `ZCL_OSD_ADT_SEARCH`; `ZCL_OSD_ADT_VFS`. **Fix the Node vfs host-throw hang first.** | maxResults matrix including NaN, seed `max*4`, vfs facet orders; measure ajson cost (vfs is about 19 calls per tree build). |
| **C1** | Checkruns: STORE CHECKRUN over an extracted shared `checkRunReport()`; reporters; package expansion through PACKAGE raw. | The spec's 15 cases plus a destination test for the bound store and an empty overlay. |
| **C4a** | Freestyle: STORE SQL and SQLCHECK on the **raw DEFAULT connection inside a savepoint**, shared cell module, `ZCL_OSD_ADT_TABLEDATA`. | Freestyle and checkSyntax matrix on sqlite **and duckdb** (a refused SELECT must not lose the session row); the red proof with `lockedClient` shows the nested-step error. |
| **C4b** | ddic and cds preview (4 rows); PARSE kind DDLS; `TABLE_FIELDS` with the resolver. | Cases 1-4; measure the per-field READ cost on a wide table. |
| **C2a** | `abapunit/metadata` and GET `core/http/unit/object` over PARSE UNIT_PLAN. Measure the cold xref graph; pre-warm at start if it is over 1 s. | metadata GET/HEAD; unit/object matrix with JSON escapes. |
| **C2b** | testruns and evaluation, the `AUNIT_DOC` renderer, an `aunit-run` continuation, then RESUME to render. | Fake-runner matrix; content-type negotiation; red proofs from the spec. |
| **C3** | `unit/object/run` through the `unit-object-run` continuation; the host re-validates the raw body (dbEnv allowlist); cancellation on `res 'close'`. | Options order case; dbEnv filtering; abort mid-run. |
| **C5** | Classrun: `ZCL_OSD_ADT_CLASSRUN`, a `ZCL_OSD_KERNEL_GUARD` @KERNEL try/catch (a runtime seam, not a host capability; the note goes in the port-map), SYSTEM DUMP (queued, not awaited), `FENCE` from F1. In the same slice, Node gets a 503 NOT_BUILT before `importFresh`. | Cases 1-14; the red proof without the guard (an ASSERT-todo error gives a 500). |

## 4. What stays on the host, and what "100%" means

**Route rows that stay HOST: only the catch-all `* /sap/bc/adt/*`.** None of the 15 families keeps a HOST row. `debugger/listeners`, the static rows and the introspection rows all become ABAP rows. Introspection gets no exemption: under design B a HOST row costs the same ABAP step plus the Node route, so keeping it saves nothing.

**Host work that stays on the host behind an ABAP row (allowed by the rules):**

| Work | Why it stays | Mechanism | What an ABAP alternative would cost |
|---|---|---|---|
| Build, generation swap, publish | It rebuilds the code the step runs in and holds the work-process FIFO for 0.5-18 s. | Continuation (`activation`, `NOTEBOOK_CELL`). | Not possible in-step. |
| ABAP Unit run | Needs an isolated child database, takes 1-60 s, and is cancelled through the socket. | Continuation. | Not possible. |
| abaplint parse, check, outline, unit plan | There is no ABAP parser in the tree. | STORE PARSE / CHECKRUN in the step, with the warm-up precondition. | SCAN/CL_OO_SOURCE_SCANNER on a real system: L, and not byte-equal to abaplint's ranges. |
| SQL execution and cell rendering | Backend dialect plus the JS value model; open-abap ADBC returns only the first column. | STORE SQL / SQLCHECK. | Finishing ADBC upstream through a fork: L, and still not byte-equal. |
| Git state, file walks, live symlink, hashOf, warm digests | Host filesystem and process state. | STORE GIT_*, SYSTEM `raw` kinds. | ZOSD_SVC-based services: L, and still made of host paths. |
| Liveness probe | It must answer while a step is busy. | `/osd/ready`, outside `/sap/bc/adt`, never a row. | n/a |
| Session middleware, X-OSD-Generation, STG_ADT_DUMP | Front concerns (slice 3). | Node front. | n/a |

**How "100%" is defined:**
1. `ZCL_OSD_ADT_ROUTER=>ROUTES` has exactly one HOST row, the catch-all.
2. `test/adt-abap-coverage.mjs` passes with an empty `HOST_ALLOWED`: every Express registration in `adtRouter` (plus `/sap/public/bc/icf/logoff`) matches an ABAP row.
3. Replaying a STG_ADT_DUMP Eclipse and abap-fs session in inline mode shows HOST served-by only for paths Node 404s too.
4. ABAP-FS conformance is no worse than the S0 baseline.

**Scope, stated explicitly:**
- This covers **inline mode**, the only mode that mounts the front.
- `STG_SERVE=child`, `OSD_ADT=js`, the preview service worker and OSGo still serve the Node routes. Those Node handlers stay as the Gate-1 reference and as the child-mode server; in inline mode they are unreachable, which the coverage test proves.
- Deleting them, or mounting the front in child mode, belongs to the next milestone.

**Deliberate non-equalities, each documented and compared by status only:**
- 4a: the release-during-body message text.
- create/delete: the front-up `{ended}` race. ABAP closes that gap entirely.
- segw/entitysets: a throw becomes an ADT document instead of Express HTML (fixed in Node first, so equal in practice).

## 5. Critical path and estimate

```
S0 ─► F1 ─► F2 ─► F3 ─► A6 ─► A7 ─► C6
              │     └─► C2b ─► C3
              ├─► B5 ─► C1
              └─► A3a ─► A3b
S0 ─► B2b(PARSE) ─► C2a ─► C2b ;  C4b
```

- Slices that need neither front-up nor a continuation can start right after S0: A1, A2, B1, B8a, B8b, B2a, B2b, C4a. A9 and A10 can also start early but need F2 for `/osd/ready` before they land.
- **Count:** S0 (2 runs) + front 2 + stoker 15 + dell 15 = **34 slices**.
- **Critical path:** S0 → F1 → F2 → F3 → A6 → A7 → C6 = **8 slices** of strictly serial dependency.
- **Throughput bound:** each owner's line is about 15-16 slices. With two owners in parallel, the milestone takes **about 17-18 slice-turns**. dell's line is the binding one, because F1 and F2 block stoker's A3, A4, A5 and F3, so F1 and F2 go first on dell's queue.
- **Main risks to the estimate:**
  - the front-up rebase;
  - the duckdb savepoint for C4a;
  - zcl_ajson cost in B6 and C4.

## 6. The critic's missing routes, resolved

| Route | Slice | Notes |
|---|---|---|
| GET `/sap/bc/adt/debugger/listeners` | **A1** (stoker) | 200 `res.end()`, untyped, empty. |
| POST `/sap/bc/adt/debugger/listeners` | **A1** | Same; CSRF stays the front's gate. |
| DELETE `/sap/bc/adt/debugger/listeners` | **A1** | Same. |
| Discovery warm-up "stays HOST" assumption | **A1** | The warm-up uses an unknown path that hits the catch-all. |
| `occurencemarkers` claimed twice | **A2** (stoker) | C2a drops its row. |
| `core/http/build` liveness under the FIFO | **F2** (`/osd/ready`) + **A8a** (row) | HEAD core/discovery stops being the restart probe. |
| Already ABAP: systeminformation, LOCK/UNLOCK, versions (all forms), compatibility/graph | landed | Listed in `HOST_ALLOWED`'s complement from S0. |
| `router.use` middleware (sessions, X-OSD-Generation, STG_ADT_DUMP) | F1/F2 (front) | Not route rows; out of the row count. |

**Ownership changes against port-map, each needing one line of confirmation:**
- stoker takes discovery, feeds/users, debugger/listeners, the whole introspection family and the notebook.
- dell keeps group C minus the notebook, plus front-up F1/F2, plus the B families information system / search / tree and DDIC reads / typestructure. **The B family source read / objectstructure goes to stoker** (agreed 2026-10-02: osg-research's track is the DSL; the split keeps both lines near 18-20 slices). Its slices listed under dell above are stoker's.