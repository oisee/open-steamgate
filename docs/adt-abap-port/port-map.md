# ADT façade in ABAP: port map

Base: origin/main `e359bcf5`, mainly `tools/adt-facade.mjs` (3097 lines) and `tools/adt-session.mjs`. ADR 0007 moves the document façade to ABAP under variant C. ADR 0008 moves locks to ENQ. Clean-room rule: we port our own JavaScript. The wire and our tests are the contract.

## 1. Summary

Variant C (Alice, 2026-10-03) gives ABAP the grammar and document routes.
The host permanently owns write (A4), create/delete (A5), inactive objects
and activation (A6/A7), git (A8b), ABAP Unit runs (C2b), unit/object/run
(C3) and notebook (C6), served by the Node facade through the catch-all.
No new continuation routes are planned. See [port-plan.md](port-plan.md)
for the current slices: B2a, B2b, A1, A2, A3a, A3b, A8a, A9 and A10.
Done means `PORT_PENDING` is empty and the coverage checks still pass;
`HOST_ALLOWED` is permanent scope, not a port queue. The gate currently
records 56 pending document registrations and 31 host registrations.

**A destination runs where its resource lives.** With the opt-in
`OSD_ADT_ONE_RUNTIME=1`, STORE and build/store/supervisor SYSTEM kinds run
in the parent through process IPC. SQL, SQLCHECK, CLASSRUN, DUMP, XREF and
child database/session facts run in the primary serving child. Publication
runs as a parent continuation after the child step ends, because it can
recycle that child. See [B1](one-runtime-b1.md) and
[B2](one-runtime-b2.md) for the contracts, proofs and measurements.

### Counting rule

- A **route row** is one (method, path pattern, handler).
- Loops over literal paths are expanded:
  - `debugger/listeners` is 3 rows (GET, POST, DELETE, `:1742`).
  - Discovery is 4 rows: HEAD and GET on `core/discovery` and on `discovery`.
  - The compatibility graph is 2 rows: HEAD and GET.
- Per-type families (`{src}` = the six SOURCE_TYPES CLAS, INTF, PROG, INCL, DDLS, SRVD, plus DEVC where noted) count **once per pattern**.
- The three bare-object GET handlers (class document, property document, structure alias) are separate rows, because they have different handlers.

With that rule there are **83 route rows plus the catch-all, 84 in all**.

At runtime the per-type loops expand to **142 registrations**:
- 78 from the type families: 11 patterns × 6 types, +2 DDLS sibling versions, +4 CLAS/INTF include versions, +3 CLAS include writes, +3 DEVC create/delete/lock.
- 63 other rows.
- 1 catch-all.

The 142 registrations describe the Node inventory, not an ABAP row target.
Every document registration needs its own ABAP pattern for every method;
host orchestration reaches the single last HOST catch-all permanently.

Express also answers HEAD for every GET automatically. That is one router rule (section 2, step 3), not extra rows.

### Rows per group (original inventory)

The original grouping and owner proposals below are superseded by variant C (2026-10-03); see [port-plan.md](port-plan.md).

| group | owner | rows | S | M | L |
|---|---|---|---|---|---|
| SKELETON | dell | 23 | 20 | 3 | 0 |
| A, versions + write path + activation | stoker | 15 | 4 | 9 | 2 |
| B, repository reads | dell (information system, DDIC); stoker (source read, objectstructure) | 22 (11 core + 11 proposed) | 14 | 5 | 3 |
| C, check / unit / preview / run | dell | 15 | 4 | 6 | 5 |
| D, OSD-private endpoints | unassigned | 9 | 1 | 7 | 1 |
| **total** | | **84** | **43** | **30** | **11** |

### Original owner proposals (historical)

- **D → SKELETON:** `feeds`, `feeds/variants`, `system/users`. They share `emptyFeed` and identity with `runtime/dumps`.
- **Current split:** `cts/transportchecks` is an ABAP editor document (A2); `activation/inactiveobjects` stays host orchestration (A6).
- **D → B, needs osg-research's confirmation.** Eleven rows: `virtualfolders/facets`, `virtualfolders/contents` (L), `objecttypes`, `releasestates`, `objectproperties/values`, `packages/settings`, `packages/valuehelps/:what`, `ddic/dataelements/:name`, `ddic/tables/parser/info`, `ddic/tables/:name`, `ddic/tables/:name/source/main`.
  - The CONTEXT scopes B to search, nodestructure, nodepath, source read, object structure and packages. These eleven are "anything else".
  - Reason for the move: they share B's tree tables, `namedItemsDocument` and `tableFieldsOf`.
  - If osg-research declines, they go back to D as unit D5, and C4 still depends on `tableFieldsOf` from whoever owns it.

### Owners: LOCK/UNLOCK and the notebook

**LOCK/UNLOCK (`:2147`).**
- ADR 0007 gives "lock / write / unlock" to stoker. The CONTEXT gives locks via ENQ to the skeleton.
- Proposed resolution, shown in the owner column of every lock row below:
  - **dell** owns the ENQ adapter, the session's handle map, the LOCK/UNLOCK route, and the two functions `lock( )` and `holds( handle, type, name )`.
  - **stoker** owns the host write/delete family; it stays in the Node facade under variant C.
- stoker and dell confirm this in one line each.

**notebook/abap (`:2010`) and oo/classrun (`:1978`).**
- Notebook is permanently host orchestration, C6, owned by stoker under variant C. Its tests run through the catch-all to the Node facade.
- Classrun is native ABAP (C5, landed).

### The five hardest routes

The original port difficulty ranking is superseded by variant C (2026-10-03); activation and unit runs stay host-owned. See [port-plan.md](port-plan.md).

1. **POST `activation` (2495).**
   - A cold build takes about 18 s, a warm one about 0.46 s.
   - The build runs inside a dialog step, which holds the work-process lock.
   - The hot swap or recycle hits the process that is running the handler.
   - Under variant C, the Node facade owns the complete activation flow.
2. **GET `objectstructure` (1910, plus the bare INCL/SRVD alias at 1957).**
   - `structureOf` walks abaplint's AST, and there is no ABAP parser in `src/`.
   - It becomes host PARSE OUTLINE returning rows. The XML is the easy half.
3. **POST `checkruns` (2386).**
   - It runs the full abaplint check with an inline-source overlay, plus AMDP portability warnings. Those depend on the DB engine (`process.env.STG_DB`, `:2457`).
   - It also decodes base64-or-entity content and expands packages.
4. **POST `abapunit/testruns` (2675) and `core/http/unit/object/run` (1354).**
   - Both spawn a child with its own database.
   - 1354 also cancels on client disconnect and enforces an env allowlist, which is a security boundary.
5. **POST `repository/nodestructure` (2785).**
   - It carries the most client quirks: class folders by Accept, flat root mode, a NODE_ID counter, TV_NODEKEY.
   - It runs on every tree expansion.
   - Its sibling `virtualfolders/contents` (966) is nearly as hard.

## 2. The skeleton (dell, 0.6 must)

### Responsibilities, in build order

1. **ICF node and handler.**
   - `/sap/bc/adt` gets a `*.sicf.xml` modelled on `src/rfc/zosd_rfc.sicf.xml`.
   - `/sap/public/bc/icf/logoff` is a Node-host mount of the same front. No SICF object is shipped for SAP's standard logoff node.
   - The handler applies session lookup, CSRF and `X-OSD-Generation` **only under `/sap/bc/adt`**. In the JS, logoff sits outside `router.use(BASE, …)`. It gets no middleware, no token, no cookies and no generation header, and only reads the cookies to find the session to end.
   - `/osd/not-served` retains miss reporting from both ABAP documents and the Node facade behind the HOST catch-all.
   - `src/icf/nodes.json:51` and `test/osd-routes.mjs:176-184` (which asserts `handler === 'adt-facade'` for `/sap/bc/adt`) change together. Each document slice adds its ABAP rows; host orchestration stays behind the catch-all.
2. **Request/response record.**
   - Request: method, path (split first, then percent-decoded, as `zcl_stg_url` does), query, a header list, parsed cookies, the body as xstring, and `fetching` (`x-csrf-token: fetch`, computed on every request, `adt-session.mjs:271`).
   - Response: status, content type, a header **list** (two `Set-Cookie` lines must survive), and a string or xstring body.
3. **Router.**
   - An ordered table of rows: method, pattern with `:param` segments, handler, advertise key, and `served-by` (ABAP or HOST).
   - First match wins. The last row is the catch-all.
   - Order is part of the contract:
     - `packages/valuehelps/:what` before `packages/:name`.
     - `ddic/tables/parser/info` before `ddic/tables/:name`.
     - explicit `core/http/*` routes before generic ones.
     - Host create and include-create POST patterns remain ordered in the Node facade, outside the ABAP document table.
   - Per-type document rows are generated from the type table, never hand-listed. Host orchestration has no family rows; it reaches the catch-all.
     - `includes/:include` and `includes/:include/source/main` GET are generated for **all six** source types. They answer an "object" NotFound for non-CLAS, so the miss kind stays `object`, not `resource`.
     - LOCK/UNLOCK document rows also cover **DEVC** (`packages`). DELETE and POST create remain in the Node facade, including DEVC.
   - General rule: **HEAD = the matching GET with the body dropped.** Express does this for every GET. Discovery and the graph also have explicit HEAD rows.
4. **Error document and exception.**
   - `ZCX_OSD_ADT` carries status, type id, namespace and properties. The handler catches it once.
   - Mapping: NotFound→404 (and records an `object` miss), ReadOnly→405, NotSupported→501, Conflict→409, anything else→500 in namespace `org.open-steamgate.osd`.
   - The miss registry keeps the `kind METHOD path` → {count, first, accept, query, detail} map.
5. **Session** (`adt-session.mjs:35-274`).
   - The session id is 12 random bytes as lower-case hex (24 characters). The `core/http/sessions` hash depends on this format.
   - Id lookup: cookie `sap-contextid` wins over `SAP_SESSIONID_<SID>_001`. An empty value means "open a fresh session".
   - The user comes from Basic auth, upper-cased, **only when the session is created**. Default `OSD`, no credential check.
   - `stateful` is set by `x-sap-adt-sessiontype: stateful` and never cleared.
   - TTL is 30 min, swept lazily on each request. `get` touches the session; `holderOf` does not.
   - Cookies are issued only when the session is fresh or stateful, each with `append`:
     - `sap-contextid=<id>; Path=/sap/bc/adt; HttpOnly; SameSite=Strict`
     - `SAP_SESSIONID_<SID>_001=<id>; Path=/; HttpOnly; SameSite=Strict`
   - The cookie name carries the one system id (`tools/osd-identity.mjs`: `OSD_SID`, alias `STG_ADT_SID`, default `OSD`) and the ADT client `001`.
6. **CSRF.**
   - The token is 18 random bytes, base64url (24 characters), one per session. Every answer under BASE carries `x-csrf-token`, never the word `fetch`.
   - On POST, PUT, DELETE, PATCH or MERGE, a mismatch answers 403 `text/plain` `CSRF token validation failed` with `x-csrf-token: Required`.
   - The gate covers BASE only. OData is never gated.
7. **Common headers (under BASE only).**
   - `X-OSD-Generation` from host GENERATION, omitted when undefined.
   - ETag = the first 32 hex characters of SHA-256 over the UTF-8 body.
   - If-None-Match → 304, accepting the weak `W/` form, quotes and comma lists.
   - `normalizedTag` is shared with If-Match on writes.
   - `asXmlTypeFor` echoes `dataname=` from Accept.
8. **ENQ adapter and lock route** (owner dell, ADR 0008).
   - The lock object key is (type, name). Types are the six source types **and DEVC**. Exclusive, `_SCOPE 1`, owner = the ADT session id.
   - LOCK and UNLOCK go through `?_action=` (upper-cased; unknown → 400).
   - Missing object → 404.
   - A library object (`writable === false`) → 200 with an **empty** handle.
   - Re-lock in the same session → the existing handle.
   - Another session, including the same user in another session → 403 `lockedByOtherDocument` (EU 510, holder user).
   - UNLOCK of an unknown handle is ignored.
   - The handle is a random UUID. The map handle → {type, name, since} stays in the session, because it is an ADT value, not an ENQ artefact.
   - Exported to group A: `holds( handle, type, name )`, `holder_of( type, name )`, `release( type, name )`.
   - Session end, logoff and expiry release all of that owner's locks.
9. **Session routes.**
   - **PORTED A3a** `core/http/sessions` (`ZCL_OSD_ADT_SESSIONS`): the security-session id is the first 32 hex of SHA-256 of the **middleware-chosen** session id, upper-cased.
   - **PORTED A3a** DELETE `core/http/sessions/:id` (`ZCL_OSD_ADT_SESSIONS`): always 200 with an empty body. It ends the session only if `:id` matches.
   - **PORTED A3a** GET `/sap/public/bc/icf/logoff` (`ZCL_OSD_ADT_LOGOFF`): ends only the session the cookies name (same precedence), 200 `text/plain` `logged off`.
   - `core/http/reentranceticket` (`:777-808`):
     - 400 `text/plain` for a missing redirect-url ("redirect-url is required"), an unparsable one ("… is not a URL") and a non-loopback one ("… must point at loopback"; host is `localhost`, `127.0.0.1` or `[::1]`).
     - Mints a ticket of 24 random bytes, base64url.
     - Sets the query parameters `_` (the client's `_` echoed, else the current milliseconds) and `reentrance-ticket` on the URL.
     - Sets cookie `sap-usercontext=sap-client=<identity.client>; Path=/`, the only use of sap-client anywhere (asserted at `test/adt-facade.mjs:146`).
     - Answers 307 with Location.
     - Never writes over the session cookie.
10. **Discovery and compatibility.**
    - `core/discovery` and `discovery` (HEAD and GET) are generated from the advertise column plus ACCEPT, CATEGORY, TITLE, TEMPLATE_LINKS and WORKSPACE (the `respository` misspelling stays).
    - Rows marked HOST and still served by the JS router are advertised too.
    - `compatibility/graph` (HEAD and GET) is static data, `application/xml`.
11. **Small static routes.**
    - `systeminformation`: identity JSON, systemID = the one system id, the same as sy-sysid (default `OSD`); client `001`, not sy-mandt.
    - `repository/typestructure`: type table × LABELS.
    - `debugger/listeners`: 3 rows, 200 empty.
    - One `empty_feed( title, self )` serves `runtime/dumps`, `runtime/systemmessages`, `gw/errorlog`, `feeds` and `feeds/variants`. `system/users` is close to it.
    - Timestamps are ISO-8601 with milliseconds and `Z`.
    - **Identity values are written unescaped, as the JS does.** This keeps the Gate 1 byte diff clean. The default values are plain ASCII, so no test pins either form. Escaping is a later fix, made in OSG-JS first.
12. **Type table.** `ZCL_OSD_ADT_TYPES` holds:
    - TYPES (15 codes in insertion order, ADT collection, source flag)
    - SOURCE_TYPES
    - ADT_TYPE, INCLUDES, LABELS, SOURCE_PROPERTY_MIME
    - `uri_of( )` and `object_from_uri( )`.
13. **Mixed-phase bridge and Gate 1 harness.**
    - On the Node host, every request under BASE enters `ZCL_OSD_ADT_HANDLER` first (slice 3, option B, `docs/adt-abap-port/slice-3-front.md`). The front (`tools/adt-abap-front.mjs`) calls `ANSWER` with the request record in one `dialogStep`, with the request's `ZCL_OSD_ADT_SESSION` from `AbapSessions#sessionFor`. The session (items 5 and 6) is resolved and the CSRF gate run in ABAP. Node's `Sessions` and its middleware are not mounted when the front is. ABAP matches document rows first; the Node facade matches requests that reach the HOST catch-all.
    - A row with `served-by HOST` (or a route that answers with a continuation) ends the step with the HOST verdict. The front puts the record's two `Set-Cookie` lines and the token on the response and sets `req.adt` to the session ABAP resolved. Then it runs the continuation after the step; the default continuation is `next()`, the JS router.
    - A failure of the step answers 500 for every request, a HOST row included, because no session was resolved.
    - `STG_ADT_DUMP` capture stays in the Node front, before the handler, so it sees both sides.
      - **OSGo** has no Node front. Its Go front must implement the same JSONL capture before any group is switched to ABAP on OSGo. Otherwise the only record of what Eclipse sent is lost.
      - **Preview:** n/a, because no ADT client reaches a service worker.
    - `tools/gogen/parity.mjs:447-507` classifies all `/sap/bc/adt` traffic and `test/adt-facade.mjs` as `adt-deferred`. Each landed group narrows `ADT_PATH` to the paths still served by HOST, and permanent host orchestration retains its host category. The parity denominator changes on every landing, so report the old and the new figure side by side.

### Class layout (proposal)

| object | role |
|---|---|
| `ZCL_OSD_ADT_HANDLER` | `if_http_extension~handle_request`. Builds the request record, scopes middleware to BASE, calls the router, writes the response. Commits session and handle rows whatever the status. |
| `ZCL_OSD_ADT_ROUTER` | The document route table (method, pattern, handler, advertise key, served-by), HEAD=GET rule, `:param`, single last HOST catch-all, miss registry. |
| `ZIF_OSD_ADT_ROUTE` | `handle( request ) RETURNING response`. One class per small family. |
| `ZCL_OSD_ADT_REQUEST` / `_RESPONSE` | Header list, cookies, `fetching`, Accept helpers, `send_entity( )` (ETag/304), `as_xml_type( )`. |
| `ZCL_OSD_ADT_SESSION` | open/get/touch/end/sweep, id, token, stateful, user, handle map. Tables `ZOSD_ADT_SESS`, `ZOSD_ADT_HNDL`. |
| `ZCL_OSD_ADT_CSRF` | Issue and check. Separate so it can be tested on its own. |
| `ZCL_OSD_ADT_ENQ` | `lock`, `unlock`, `holds`, `holder_of`, `release`, `end_owner` over `ENQUEUE_/DEQUEUE_EZOSD_ADT_OBJ` and `ENQUEUE_READ`. |
| `ZCX_OSD_ADT` | Status, type id, namespace, properties, message. |
| `ZCL_OSD_ADT_XML` | `esc( )` (`& < > "`), string table, `concat_lines_of`. Not `cl_http_utility=>escape_xml_attr_value`, which is a todo stub. |
| `ZCL_OSD_ADT_DOC_COMMON` | `exception`, `locked_by_other`, `lock_result`, `named_items`, `empty_feed`, `object_references`. |
| `ZCL_OSD_ADT_DISCOVERY` | Discovery and graph from the data maps (constants, or a JSON asset rendered with `zcl_osd_tpl`). |
| `ZCL_OSD_ADT_TYPES` | Type tables. |
| `ZCL_OSD_ADT_HOST` | Wraps `CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'`, caches CAPABILITIES keyed by the host's index generation. |

Reuse:
- `zcl_stg_http_handler` (handler shape)
- `zcl_osd_rfc_channel` (routing below a node)
- `zcl_stg_url`
- ajson (every JSON route)
- `zcl_osd_tpl`
- `cl_abap_message_digest`
- `cl_system_uuid` / `cl_abap_random`

### Cross-cutting concerns

| concern | moves to ABAP | stays in the host |
|---|---|---|
| Mount / ICF | two ICF nodes; middleware only under BASE | Express mount, `express.raw` |
| Session, cookies, stateful, `fetching` | yes | — |
| CSRF | yes | — |
| X-OSD-Generation | yes (host GENERATION) | — |
| sap-client / language | No request parsing. Identity is read once from the host. sap-client appears only in the reentrance `sap-usercontext` cookie. | — |
| Content negotiation, ETag, If-None-Match, HEAD=GET | yes | — |
| Body helpers (`attribute`, `objectReferencesIn`, `objectFromUri`) | yes | — |
| Error documents, `answered()` | yes | — |
| Miss registry, catch-all, `/osd/not-served` | yes | `STG_ADT_DUMP` (Node front; Go front on OSGo) |
| Watcher / index invalidation | The ABAP caches key on `index_generation` from CAPABILITIES. | `store.watch()`: the host bumps the counter on every watcher event and every WRITE, CREATE or DELETE. Tests pass `watch: false` to the host, never to ABAP. |
| Lock and ownership | yes, over ENQ | — |
| Discovery | yes, from the route table | — |

### Acceptance

The test files mount `adtRouter({…}).router` in-process:
- `test/adt-facade.mjs:35`
- `test/adt-devloop.mjs:96`
- `test/zosd-test.mjs:90`
- `test/vscode-extension.mjs:3487` (with `watch: false`)

`adtRouter` gets a switch (`options.abap` or `OSD_ADT=abap`). It puts the ABAP handler in front and binds the STORE destination to **that router's** `options.store`. Every route-level case then runs in both modes unchanged.

Must pass against the skeleton, with the other groups served by HOST behind it:
- `test/adt-facade.mjs`:
  - discovery `:169`
  - advertise `:308`, `:476-479`
  - session poll and security session `:175`
  - systeminformation `:182`, `:191`, `:194`
  - feeds `:197`, `:205`
  - debugger `:216`
  - typestructure `:227`
  - graph `:273-379`
  - both reentrance cases, including the `sap-usercontext` assertion at `:146`
  - `:898`
- `test/adt-devloop.mjs`:
  - lock section `:150-194`
  - "locks across requests and sessions" `:1240-1360`
  - `:1323`
  - the DEVC lock in "a created package stays in the tree…"
- `test/adt-editor.mjs`: the lock shape case, plus HEAD token fetches `:87`, `:115`, `:134`.
- `test/adt-notebook.mjs:32`, `:80`, and `test/osd-child.mjs:51`, `:267`.
- `test/osd-routes.mjs:184`: updated in the same commit that flips the node.

Cases that **cannot** run against ABAP, because they import JS exports directly:
- `test/adt-session.mjs` (17 cases): becomes ABAP Unit on `ZCL_OSD_ADT_SESSION` with the same case names.
- `test/adt-facade.mjs:9`, `:1414-1437` (`unitRunDbEnv`, `unitRunOptions`, `UNIT_RUN_DB_ENV_KEYS`): the allowlist stays in host orchestration, so these stay JS tests of the host.
- `test/adt-facade.mjs:8` (`nodeStructureDocument`): becomes an ABAP Unit case when B5 lands.
- `test/vscode-extension.mjs:15` (`tableDataDocument`, `countServiceRegistrations`): each becomes an ABAP Unit case when its group lands. The JS export stays until then.

## 3. Host interfaces

The original command expansion and unit-run cancellation design in this section are superseded by variant C (2026-10-03); see [port-plan.md](port-plan.md). The table is a historical seam sketch, not a command backlog.

Document capabilities use the existing `ZOSD_STORE` destination (`tools/osd-store-destination.mjs`). Its existing commands are LIST, READ, WRITE, CHECK, ACTIVATE, HISTORY, REVISION and CAPABILITIES. No parallel seam.

- New commands take `IV_JSON` and answer `EV_JSON`.
- READ and WRITE keep their typed parameters.
- The route table does not advertise a route whose command is missing from CAPABILITIES.

**Counting rule for this table:** one row is one command name. CREATE and DELETE are two commands. The table has **9 new commands** (OBJECT, CREATE, DELETE, PACKAGE, PARSE, UNIT, JOB, SQLCHECK, SYSTEM) and **6 extended ones** (CAPABILITIES, LIST, HISTORY, REVISION, CHECK, ACTIVATE). READ and WRITE are unchanged. That gives 17 commands on one destination.

Notebook stays host-served permanently (C6). It needs no ABAP commands or continuation route. WRITE, CREATE, DELETE, ACTIVATE, UNIT and JOB below are historical orchestration proposals, not port work.

| command | signature sketch | wraps today (JS) | groups |
|---|---|---|---|
| CAPABILITIES *(extend)* | → commands[], `db_engine` (STG_DB normalised: file/memory/sqljs→sqlite), `index_generation` (bumped by the watcher and by every write) | — / `process.env.STG_DB` (`:2457`) / `store.watch` | all |
| READ | type, name, include → source, file, package, writable, version, empty | `store.read` | A B C D |
| WRITE | type, name, include, source → ok / error | `store.write` | A |
| OBJECT *(new)* | type, name → entry, package chain, changedAt, active flag, includes present, file, `location{package, layer}` | `store.find`, `exists`, `stateOf`, `classIncludes`, `locationOf` | A B C D |
| CREATE *(new)* | type, name, description, package → name, or NotFound / Conflict / ReadOnly / NotSupported | `store.create` + CREATABLE templates | A |
| DELETE *(new)* | type, name → type, name | `store.delete` | A |
| PACKAGE *(new)* | name (`''` = roots) → name, parent, description, library, simulated, subpackages[**with descriptions**], objects[]. One call, so `describe` (`:2741`) needs no `packages()` per item. | `store.package`, `packages`, `rootPackages`, `packageOf` | B |
| LIST *(extend)* | seed, type, limit → objects[] with library flag | `store.search`, `store.list` | B D |
| HISTORY *(extend)* | type, name, include, limit → available, reason, status, mtime, entries[revision, SAP user, authoredAt, subject]. limit 0 = state only. | `objectVersions`, `gitObjectHistory`, `gitObjectState`, `statSync`, `sapUserOf` | A D |
| REVISION *(extend)* | type, name, include, version or sha → source (byte-stable); NotFound when not listed | `versionSource`, `gitObjectRevisionAt`, `gitObjectRevision` | A D |
| CHECK *(extend)* | objects[{type, name, include, inline source}] → issues and status per object, dictionary presence, AMDP warnings for `db_engine` | `store.check`, `portabilityWarnings` | C |
| ACTIVATE *(extend)* | objects[], expected revisions → job id; result {ok, issues, transpile{warm, closure, tests}, hot, ms} | `activate`, `warmActivation`, `publish`, `completeActivations`, `testClassesIn` | A |
| PARSE *(new)* | kind OUTLINE / DDLS / UNIT_PLAN, type, name → JSON | `structureOf`, `cdsEntityOf`, `runner.classes` + `withRisk` | B C |
| UNIT *(new)* | type, name, class, method, dbEnv (allowlisted **in the host**, byte for byte), inspectPort, waitForDebugger, `request_id` → job id | `runner.runDetached`, `unitRunOptions` | C |
| JOB *(new)* | id, POLL / CANCEL → state, result | AbortController, promises | A C |
| SQLCHECK *(new)* | statement → issues / unavailable | `data.check` (`checkSelect`) | C |
| SYSTEM *(new)* | one kind per call, see the list below | see the list below | skeleton, D |

SYSTEM kinds:
- `GENERATION`: wraps `liveHash`.
- `IDENTITY`: wraps `osdIdentity`.
- `BUILD`: wraps `sourceCommit`, `hashOf`/`liveHash`, `store.served`, `STARTED`, `data.source`. Returns `{commit, generation, system{source, live, serving, database, synchronized}, started, stamp}`.
  - commit: `GITHUB_SHA`, else `release.json` in the store root, else cwd, else `git rev-parse HEAD`, else `unknown`. Cached.
  - started: `STARTED`, `:617`.
  - stamp: replaces the JS digest of six source files (`:3082-3097`) with the compiled generation's stamp. The field names stay.
- `CHANGED`: wraps `changedObjects` and `warm().reason`.
- `SERVICES`: wraps `serviceTree`.
- `TRANSACTIONS`: wraps `transactions(generatorFoldersOf(root))`, `find(...).file` and `locationOf`. Returns the finished JSON.
- `SEGW_REGISTRATIONS`: wraps `segwRegistrations` and `registeredServices`.
- `TESTCLASSES`: wraps `testClassesIn`.

**Who parses what in D.**
- The host owns every file walk and every XML file read: TRAN, IWSV/IWMO, `abap_transpile.json`, packs, the tree's test classes.
- ABAP owns everything that runs over sources or rows it already has:
  - `entitySetMapFor` (regex over the DPC source and its base source, read through READ instead of the `readSource` callback)
  - `countServiceRegistrations` (`:46`, a pure function, ported)
  - the xref SELECTs over WBCROSSGT / WBCROSSGTX (native Open SQL)
  - `services` rows from `ZOSD_SVC` / `ZOSD_PACK` / `ZOSD_SYS` (native)

**Unit-run cancellation (`:1363-1366`).**
The Node facade owns the socket, execution and cancellation. The existing
host tests `adt-devloop :609` and `:688` remain; no ABAP UNIT/JOB poll loop
or cancellation continuation is planned.

ADR 0007 names three host families: store, git and build. This map needs two more: **SYSTEM** and **SQLCHECK** (the DatabaseClient seam). Running SQL is native: ADBC `cl_sql_statement` is in open-abap-core.

### PORTED A3a: sessions and logoff

| method | path | ABAP route |
|---|---|---|
| GET (HEAD fallback) | `/sap/bc/adt/core/http/sessions` | `ZCL_OSD_ADT_SESSIONS` |
| DELETE | `/sap/bc/adt/core/http/sessions/:id` | `ZCL_OSD_ADT_SESSIONS` |
| GET (HEAD fallback) | `/sap/public/bc/icf/logoff` | `ZCL_OSD_ADT_LOGOFF` |

The explicit core/http rows precede generated object rows and the sole HOST
catch-all. Logoff uses the same non-empty context-cookie precedence as
RESOLVE but never resolves, sweeps, stamps or opens a session. END is guarded
by exactly 24 lowercase hexadecimal characters, so a foreign cookie cannot
end an arbitrary ENQ owner. No STORE command or SYSTEM kind was added.
The Node oracle and child-mode routes live in `tools/adt-session-routes.mjs`;
the facade and front no longer perform a delegated session END.
A3a parity tests assert ABAP served-by for every row, ordered cookies and
response bytes, unchanged row counts for no-op logoff, and old-token refusal
after END. Express ETags are disabled in the diff harness as in production;
poll and logoff have no implicit weak ETag or conditional 304.
The generic S0 `HOST_ALLOWED` coverage suite is absent at this slice's base;
A3a's cases cover all three rows directly in `test/adt-abap-diff.mjs`.

## 4. Groups

### A: versions, write path, activation (stoker)

The route inventory below includes permanent host orchestration: writes, include creation, object create/delete and inactive objects/activation. Versions, LOCK/UNLOCK and transportchecks are ABAP documents. Slice names follow [port-plan.md](port-plan.md).

Version routes and the types they cover:

| family | types |
|---|---|
| `{src}/:name/source/main/versions` + `/:stamp/:version/content` | **CLAS, INTF, PROG, INCL, DDLS, SRVD** (all six) |
| `{ddl}/:name/versions` + content (sibling) | DDLS only |
| `{oo}/:name/includes/:include/versions` + content | CLAS, INTF (INTF: `main` only, else 404) |

| method | path | cx | owner | host | documents | tests |
|---|---|---|---|---|---|---|
| GET | `{src}/:name/source/main/versions` | M | stoker | READ, HISTORY | versionsFeed | adt-versions `:69`, `:99`, `:125`, `:135` |
| GET | `…/source/main/versions/:stamp/:version/content` | M | stoker | READ, REVISION | text | adt-versions `:82` |
| GET | `ddic/ddl/sources/:name/versions` | S | stoker | as above | versionsFeed | adt-versions `:116` (GETs this URL directly, expects 00000, 00001) |
| GET | `ddic/ddl/sources/:name/versions/:stamp/:version/content` | M | stoker | as above | text | adt-versions `:116` |
| GET | `oo/{classes,interfaces}/:name/includes/:include/versions` | M | stoker | READ, HISTORY | versionsFeed | adt-versions (6 cases) |
| GET | `…/includes/:include/versions/:stamp/:version/content` | M | stoker | READ, REVISION | text | adt-versions |
| POST | `{src}` and `packages` | M | stoker | Node facade (permanent HOST) | 201 + Location | adt-devloop create, 404 package, 409, DEVC round trip |
| DELETE | `{src}/:name` and `packages/:name` | M | stoker (host orchestration) | Node facade (permanent HOST) | lockedByOther, exception | adt-devloop delete, foreign session |
| POST | `{src}/:name?_action=LOCK\|UNLOCK` and `packages/:name` | M | **dell** (skeleton row, listed here for completeness) | OBJECT, ENQ | lockResult, lockedByOther | see skeleton |
| PUT | `{src}/:name/source/main?lockHandle=` | L | stoker (host orchestration) | Node facade (permanent HOST) | ETag; 405/409/412 | adt-editor save; adt-devloop `:209-269`, release-during-body, stateless keeps lock |
| PUT | `oo/classes/:name/includes/:include` | M | stoker | Node facade (permanent HOST) | as above | adt-editor include under parent lock |
| PUT | `oo/classes/:name/includes/:include/source/main` | S | stoker | Node facade (permanent HOST) | as above | **none**: add one |
| POST | `oo/classes/:name/includes?lockHandle=` | M | stoker | Node facade (permanent HOST) | 201 + Location | adt-devloop test-include create |
| POST | `activation` | L | stoker | Node facade (permanent HOST) | activationSuccess/Failure, X-OSD-* | adt-devloop `:740-860`, `:991`; zosd-test `:443`; adt-notebook `:98` |
| POST | `cts/transportchecks` *(from D)* | S | stoker | OBJECT | transportCheck | adt-facade (2) |
| GET | `activation/inactiveobjects` *(from D)* | S | stoker | Node facade (permanent HOST) | inline | **none** |

The lock row is not counted in A's 15. It is one of the skeleton's 23.

**One versions closure, both URL shapes.**
- The feed `base` is always `…/source/main/versions` (`:1842-1844`), also when the DDLS sibling route answers.
- The test fetches the sibling feed and then follows the entry `src`, which points under `source/main/versions`. That route also exists for DDLS, so the test passes.
- Keep both URL shapes registered and leave the base as it is.

The original A1-A4 port units and their write/create/activation ordering are superseded by variant C (2026-10-03); see [port-plan.md](port-plan.md).

Versions and LOCK/UNLOCK are already ABAP. Transportchecks belongs to the
pending A2 editor documents. A4 writes, A5 create/delete and A6/A7 inactive
objects/activation stay in the Node facade permanently through the
catch-all, with their existing host tests.

### B: repository reads (dell: information system, DDIC; stoker: source read, objectstructure)

Reassigned 2026-10-02: osg-research's track is the DSL and its applications. The port plan (port-plan.md) and the family specs (family-specs/) carry the slices.

Core rows (CONTEXT scope):

| method | path | cx | host | documents | tests |
|---|---|---|---|---|---|
| GET | `{src}/:name/source/main` | S | READ | text + ETag | adt-facade `:508-540`; adt-editor `:56-103` |
| GET | `{src}/:name/includes/:include` (all 6 types; non-CLAS → object 404) | S | READ, OBJECT | text or classInclude | adt-facade `:523`, `:681` |
| GET | `{src}/:name/includes/:include/source/main` (all 6; non-CLAS → 404) | S | READ | text + ETag | adt-facade `:523`; adt-editor `:146-153` |
| GET | `{src}/:name/objectstructure` | L | OBJECT, PARSE OUTLINE | objectStructure | adt-facade (11); adt-editor |
| GET | `oo/classes/:name` | M | OBJECT | classDocument | adt-facade (6); adt-devloop inactive |
| GET | `{programs,interfaces,ddl}/:name` | S | READ | sourceProperties | adt-editor (3); adt-versions links |
| GET | `{includes,srvd}/:name` | S (once the outline exists) | as objectstructure | objectStructure | none direct |
| GET | `packages/:name` | M | PACKAGE | packageDocument | adt-facade `:799-898`; adt-devloop `:1470-1500` |
| POST | `repository/nodepath` | S | OBJECT | nodePath | adt-devloop `:717` |
| POST | `repository/nodestructure` | L | PACKAGE, OBJECT | nodeStructure | adt-facade `:823-986`; adt-devloop `:1474` |
| GET | `informationsystem/search` | M | LIST, PACKAGE | objectReferences | adt-facade `:748-790`; adt-devloop `:1480` |

Proposed rows, moved from D, **needing osg-research's confirmation**:

| method | path | cx | host | documents | tests |
|---|---|---|---|---|---|
| GET | `virtualfolders/facets` | S | — | inline | **none** |
| POST | `virtualfolders/contents` | L | PACKAGE | vfs result, tree tables | adt-facade "virtual folders"; zosd-test cloud tree |
| GET | `informationsystem/objecttypes` | S | — | namedItems | adt-facade data string |
| GET | `informationsystem/releasestates` | S | — | namedItems | none |
| GET | `informationsystem/objectproperties/values` | S | — | namedItems | none |
| GET | `packages/settings` | S | — | inline | none (python corpus only) |
| GET | `packages/valuehelps/:what` | S | — | namedItems | none |
| GET | `ddic/dataelements/:name` | M | READ | dataElement | adt-facade `:1041`; zosd-test `:348` |
| GET | `ddic/tables/parser/info` | S | — | exception 404 | adt-facade `:1264` |
| GET | `ddic/tables/:name` | M | READ | tableDocument + ETag | adt-facade `:1225` |
| GET | `ddic/tables/:name/source/main` | S | READ | tableSource | adt-facade `:1232` |

The original B ordering and unit table below are superseded by variant C (2026-10-03): their unit names (B2, B3, B4, B7) do not match the current slices. Source read and bare object documents are B2a, objectstructure and the INCL/SRVD alias are B2b; see [port-plan.md](port-plan.md) for the current slice list and what has landed.

Original order: B2 → B3 → B6 → B5 → B4. The proposed units follow if confirmed: B1 → B8 → B7.

B4 is last because it waits for PARSE OUTLINE. B8 provides `tableFieldsOf` to C4.

| unit | routes | documents | tests |
|---|---|---|---|
| B2 source read | source/main, includes (×6 types), include source (×6) | classInclude | adt-facade `:508-540`, adt-editor |
| B3 object documents | class, property, package | classDocument, sourceProperties, packageDocument + `packageOf` | adt-facade class/package, adt-editor |
| B4 outline | objectstructure + alias | objectStructure (`xml:base` load-bearing) | adt-facade structure |
| B5 tree | nodestructure, nodepath | nodeStructure + TREE_*, nodePath | adt-facade, adt-devloop; plus ABAP Unit for the `nodeStructureDocument` import |
| B6 search | search | objectReferences, `searchObjects` (CP) | adt-facade search |
| B1 static *(proposed)* | facets, objecttypes, releasestates, objectproperties, settings, valuehelps | namedItems | adt-facade objecttypes; add 4 small cases |
| B7 cloud tree *(proposed)* | vfs contents | vfs result (TREE_* from B5) | adt-facade vfs, zosd-test |
| B8 DDIC *(proposed)* | dataelements, tables, tables source, parser/info | dataElement, tableDocument, tableSource, `tableFieldsOf` | adt-facade `:1041`, `:1225`, `:1232`, `:1264` |

### C: check, ABAP Unit, data preview, run (dell)

C2b testruns/evaluation, C3 unit/object/run and C6 notebook in this inventory are permanent HOST orchestration through the catch-all. Their document bodies also stay in the Node facade.

| method | path | cx | host | documents | tests |
|---|---|---|---|---|---|
| GET | `abapunit/metadata` | S | — | inline | none |
| GET | `core/http/unit/object` | M | PARSE UNIT_PLAN | JSON | adt-devloop `:481` |
| POST | `core/http/unit/object/run` | L | Node facade (permanent HOST) | JSON | adt-devloop `:609`, `:688`; adt-facade `:1414` (host unit test) |
| POST | `oo/classrun/:name` | L | OBJECT, CAPABILITIES (built?) | text | adt-devloop Q6b (5) |
| POST | `notebook/abap` | L | Node facade (permanent HOST) | JSON | adt-notebook, adt-devloop notebook (4), through the bridge |
| GET | `checkruns/reporters` | S | — | inline | none |
| POST | `checkruns` | L | CHECK (with `db_engine`), READ, PACKAGE | checkReport | adt-devloop `:289-380`; adt-facade `:440`; adt-notebook |
| POST | `abapsource/occurencemarkers` | S | — | inline | adt-devloop `:703`, `:729` |
| POST | `abapunit/testruns/evaluation` | M | Node facade (permanent HOST) | unitResult | adt-devloop `:427` |
| POST | `abapunit/testruns` | L | Node facade (permanent HOST) | unitResult | adt-devloop `:446-740` |
| GET | `datapreview/ddic/:name/metadata` | S | READ | tableData | adt-facade `:1243` |
| POST | `datapreview/ddic` | M | READ; SYSTEM SQL | tableData | adt-facade `:1256-1283`; osd-data; osd-child |
| GET | `datapreview/cds/:name/metadata` | M | PARSE DDLS | tableData | adt-facade `:1293`, `:1306` |
| POST | `datapreview/cds` | M | PARSE DDLS; SYSTEM SQL | tableData | adt-facade `:1310-1318` |
| POST | `datapreview/freestyle` | M | SYSTEM SQLCHECK / SQL | checkReport, tableData | adt-facade `:545-603`; adt-devloop `:871`, `:947` |

The original C1-C6 unit table and unit-run/notebook port ordering are superseded by variant C (2026-10-03); see [port-plan.md](port-plan.md).

C1 checks, C2a metadata and unit/object plans, C4 data preview and C5
classrun are landed ABAP documents. Occurrence markers belong to pending
A2. C2b, C3 and C6 have no ABAP port units; their existing host tests run
through the catch-all. Notebook ownership is settled: host, C6.

C5 notes:
- Native port: `CREATE OBJECT TYPE (name)` plus `if_oo_adt_classrun~main` in the request's own step. Verify that the IR supports dynamic CREATE OBJECT.
- The IF_OO_ADT_CLASSRUN check uses RTTI, not a regex.
- The dump is recorded outside the step that is rolled back.
- NOT_CLASSRUN answers 400; a dump answers 200.

### D: OSD-private endpoints (unassigned)

| method | path | cx | host | ABAP owns | tests |
|---|---|---|---|---|---|
| GET | `core/http/build` | M | SYSTEM BUILD | JSON shape (null serving, absent system) | osd-child, vscode-warm, osd-binary, protocol-rfc, replay-compare, e2e |
| GET | `core/http/changed` | S | SYSTEM CHANGED | absent `objects` when not primed | none |
| GET | `core/http/git/object` | M | Node facade (A8b) | —; host owns body and refusals | e2e only |
| GET | `core/http/git/object/revision` | M | Node facade (A8b) | —; host owns body and refusals | e2e only |
| GET | `core/http/services` | M | SYSTEM SERVICES, OBJECT (file) | status-table rows, helper filtering | adt-devloop `:558`; vscode-extension `~2401` |
| GET | `core/http/transactions` | M | SYSTEM TRANSACTIONS | wrap only | adt-devloop `:581` |
| GET | `core/http/segw/entitysets` | M | SYSTEM SEGW_REGISTRATIONS, READ | `entitySetMapFor` regex scan | adt-devloop `:491`, `:501` |
| GET | `core/http/xref/readers` | L | SYSTEM SEGW_REGISTRATIONS, SERVICES, TESTCLASSES; LIST | WBCROSSGT SELECT, `countServiceRegistrations`, sort | adt-devloop `:515-603`; vscode-extension `:3509` |
| GET | `core/http/xref/closure` | M | SYSTEM TESTCLASSES; LIST | BFS over WBCROSSGT, cap 5000, sort | adt-devloop `:537-554` |

| unit | routes | notes |
|---|---|---|
| D1 build | build, changed | Field names fixed (deploy checks read them). |
| D2 git | git/object, revision | Thin pass-through. |
| D3 inventory | services, transactions, segw/entitysets | Host walks files. ABAP reads the status tables and scans sources. |
| D4 xref | readers, closure | Open SQL. The warm reverse-index branch goes behind a capability. Normalise the sort order to match `localeCompare`. Seeding by `tools/osd-xref-seed.mjs` is unchanged. |
| D5 DDIC + static | only if osg-research declines the B moves | as B1 and B8 |

D depends only on the skeleton and SYSTEM. Open question: is D in 0.6 at all? D matters only for OSGo and the preview Workbench.

## 5. Documents

**Lands with the skeleton (shared):**
- `exceptionDocument`
- `lockedByOtherDocument`
- `lockResultDocument`
- `namedItemsDocument`
- `objectReferencesIn` / `objectFromUri` / `attribute`
- `uriOf` / ADT_TYPE / TYPES / SOURCE_TYPES
- `xmlEscape`
- `entityTag` / `normalizedTag` / `sendEntity`
- `asXmlTypeFor`
- `emptyFeed` (identity unescaped, as the JS does)
- `discoveryDocument`
- `compatibilityGraphDocument`
- the typestructure template

| group | builders |
|---|---|
| A | `versionsFeedDocument` (+ `objectVersions` / `versionSource` over HISTORY/REVISION), `transportCheckDocument` + `transportCheckRequest` (pending A2). Activation documents and CREATABLE templates stay in the host. |
| B core | `objectStructureDocument` (over PARSE rows), `classDocument`, `classIncludeDocument`, `sourcePropertiesDocument`, `packageDocument` + `packageOf`, `nodeStructureDocument` + `nodesOf` / `classNodesOf` + TREE_*, `nodePathDocument`, `objectReferencesDocument` + `searchObjects` |
| B proposed | `dataElementDocument`, `tableFieldsOf`, `tableDocument`, `tableSourceDocument`, vfs result (inline today) |
| C | `checkReportDocument` + `checkObjectsIn` / `decodeContent`, `tableDataDocument` (`adt-facade.mjs:272`). Unit-run results and notebook JSON stay in the host. |
| D | ABAP introspection JSON (ajson); `countServiceRegistrations`. Git bodies and refusals stay in the host (A8b). |

## 6. Migration gates (ADR 0007)

The original whole-group acceptance matrix below is superseded by variant C (2026-10-03); see [port-plan.md](port-plan.md). It remains a regression reference, including host behavior, not a requirement to port host families.

**Gate 1:** the document slice's route-level tests run green in both modes, with no edit to the tests. The JS-export unit cases listed in section 2 are ported to ABAP Unit when their group lands. vsp scenarios run against both hosts with a byte diff. Known A4H differences are fixed in OSG-JS first.

Every landing also:
- updates `nodes.json`, `test/osd-routes.mjs` and `/osd/not-served` where they apply
- narrows `parity.mjs` `ADT_PATH` and reports the old and new denominator.

| group | Gate 1: OSG-JS diff | Gate 2: A4H harness (vsp-i7) |
|---|---|---|
| SKELETON | adt-facade discovery, session, feeds, graph, ticket (with `sap-usercontext`), catch-all; adt-devloop lock/session (with DEVC); adt-editor lock; adt-notebook and osd-child HEAD; adt-session as ABAP Unit; osd-routes `:184` updated; vsp logon + lock/unlock | logon (graph, discovery, CSRF fetch), session poll, lock / foreign lock EU 510 / logoff release |
| A | adt-versions (all, both DDLS URL shapes); adt-editor writes; adt-devloop create/delete/write/activate; vsp edit-save-activate | versions feed and 00000 bytes; lock-write-unlock-activate on a `$TMP` object; transport check |
| B | adt-facade structure/search/package/tree (+ vfs/DDIC if moved); adt-editor reads; zosd-test cloud tree (`:90` mounts adtRouter); vsp browse/search | search, nodestructure, nodepath, objectstructure, class and package documents, DDIC reads |
| C | adt-devloop checks and unit (`:609`/`:688` exercise the cancellation seam); adt-facade preview/freestyle; adt-notebook (notebook through the bridge); osd-data; osd-child; vscode-extension preview consumer | checkrun clean and broken; testrun v1/v2/junit; F8 and freestyle |
| D | adt-devloop services/transactions/segw/xref; vscode-extension (`:3487`, `watch: false`); e2e Workbench; osd-child and vscode-warm build | **n/a**: OSD-private, Gate 1 only |

## 7. Risks and open questions

1. **Session state and rollback.**
   - `zcl_stg_http_handler` rolls back on status ≥ 400, but a session or token issued on a 403 or 404 must persist. The ADT handler catches every refusal in `ANSWER`, so the step ends without an exception and commits the session and handle rows whatever the status. That includes the CSRF refusal of a session that ended (its rows' deletion).
   - On OSGo, state cannot live in statics: tables `ZOSD_ADT_SESS` / `ZOSD_ADT_SHDL` (#464).
   - Touching the session is a write per request. Measured on a running host (stoker, median of the last 100 of 120), a HOST row costs +1.9 to 2.2 ms with the ABAP front (discovery 0.70 ms with `OSD_ADT=js`, 2.91 ms in child mode, 3.09 ms inline). See `slice-3-front.md`.
2. **Host orchestration.**
   - Activation, unit runs and notebook stay in the Node facade after the ABAP front's step ends.
   - Execution, publication and disconnect cancellation remain host responsibilities. No ABAP polling or new continuation routes are planned.
3. **ENQ owner.**
   - Each Node request is a new step, so the owner must be **set** to the ADT session id.
   - Expiry and logoff from another request need "release owner X". `DEQUEUE_ALL` releases only the caller's own locks.
   - Release is asynchronous for up to 1 s, so tests need tolerance.
4. **SHA-256 everywhere.**
   - `cl_abap_message_digest` goes through `@KERNEL import("crypto")`, marked "this doesnt work in browser?". Verify it in the service worker and in OSGo first.
   - Hash UTF-8 bytes, not characters.
5. **Duplicate headers.** Measured: the open-abap response object does not keep both `Set-Cookie` lines. `set_header_field` replaces a header of the same name, and `set_cookie` is a stub. On Node the front reads `ANSWER`'s record and not the shim's, so both lines reach the client (`test/adt-abap-front.mjs`). The shim path (a real ICF, and any host that uses the shim) still needs an open-abap-core fix.
6. **XML in ABAP.**
   - Request bodies: `FIND REGEX` and offsets (7.02, they transpile). The sXML reader is there if needed.
   - Output: string tables plus `concat_lines_of`.
   - Never `escape_xml_attr_value`.
   - ABAP source is 7-bit ASCII: run `npm run lint`.
7. **Streaming bodies.** ICF delivers the whole body first, and so does the Node front now: it reads the body before the handler's step. In the "lock released while the body arrives" case, the PUT route therefore checks the lock after the whole body is in, and still writes nothing (`test/adt-devloop.mjs`).
8. **Binary.** No ADT route returns a zip. Sources travel as UTF-8 xstring through `body_x`, with the final newline and line endings kept byte-stable (REVISION restore).
9. **Performance.**
   - Every request runs transpiled ABAP plus at least GENERATION.
   - nodestructure calls PACKAGE on every expansion. PACKAGE returns descriptions in one call.
   - Cache CAPABILITIES, identity and OBJECT/LIST results keyed by `index_generation`. Measure on the skeleton.
10. **Host capability gaps.** OSGo has no abaplint and no git. The preview has no fs, git, spawn or abaplint. Discovery follows CAPABILITIES.
11. **Capture on OSGo.** `STG_ADT_DUMP` must be reimplemented in the Go front before any group is switched there.
12. **Test binding.** The STORE destination must resolve to each test's own `ObjectStore`. Check how `osd-store-destination.mjs` binds before building the harness.
13. **Open questions for Alice and the owners:**
    - LOCK/UNLOCK split (dell route + `holds`; stoker writes). Confirm.
    - The 11 proposed B rows: osg-research confirms, or they go to D5.
    - C6 notebook is settled by variant C: permanently host-served, owned by stoker.
    - Is D in 0.6?
    - Identity escaping in feeds: fix in OSG-JS first, or keep it.
    - Which uncovered rows get tests first: vfs facets, releasestates, objectproperties, packages/settings, feeds, users, abapunit/metadata, checkruns/reporters, inactiveobjects, valuehelps, include PUT `/source/main`, the INCL/SRVD bare path, and `includes/:include` on a non-CLAS type.
    - ADR 0007 should record the variant C document/orchestration split; the old 17-command sketch is not a port backlog.
## Rules decided in S0

**Bulk lists: line format.** Bulk STORE replies travel as raw `EV_SOURCE`,
with one record per LF-delimited line and TAB-delimited fields, no trailing
LF, and no fixed-width DDIC fields. Lists retain host order. Escape backslash
as `\\`, TAB as `\t`, and LF as `\n`; `ZCL_OSD_ADT_JS=>UNESCAPE` decodes
text fields in one pass (so a literal `\n` stays literal). Repository
identifiers cannot contain TAB, LF or backslash; descriptions can.
Records are fixed-arity per kind letter: a new field is a new kind letter
or a new format name, never an extra column on an existing record (a
reader that splits into named fields would take it silently).

B6 PACKAGES input `{format:"lines"}` returns
`P<TAB>name<TAB>parent<TAB>description<TAB>library<TAB>root`.
`{format:"vfs-lines"}` adds `C<TAB>parent<TAB>child` for each package's
subpackages and `O<TAB>package<TAB>type<TAB>name<TAB>description<TAB>library`
for its raw objects. P, C and O records retain package, child and object
host order; `X` means true, empty means false. Root is true only when parent
is absent. Object descriptions default to names only when absent/null.
PACKAGES without a format retains its existing package JSON answer;
there is no `objects` flag. SEARCH adds `{format:"lines"}` to its existing
`{seed,type,limit}` input and returns `type<TAB>name<TAB>library` records in
index order. Its default JSON answer remains available. Empty lists return
an empty string. Only bulk facts cross this seam: VFS request parsing,
patterns, facets, subtrees, counts, sorting and XML rendering are ABAP.
SYSTEM VFS has been removed.

Slice 0b establishes the host seam without adding route rows. `ZOSD_STORE`
accepts optional `IV_JSON`; every STORE operation uses the request-bound
store before the destination default. Refusals carry
`EV_JSON {error:{code,message}}` with the original message and no command or
object prefix. `EV_ERROR` remains for existing screens. ADT maps NOT_FOUND,
CONFLICT, READ_ONLY, NOT_SUPPORTED, INVALID_NAME and INTERNAL to its exception
factories (404, 409, 405, 501, 400 and 500). An unknown code is INTERNAL.
`READ` adds name, changedBy and empty to EV_JSON; `OBJECT` adds package,
packages (the chain), changedAt, changedBy, version and includes.

`CAPABILITIES` drives screen buttons only. `COMMANDS` returns
`{commands:[...]}` for the commands the destination implements, independent
of whether a source tree is available. A missing command is a 501, including
on an older host that answers only `EV_ERROR`. A SYSTEM answer with a string
`raw` travels in `EV_SOURCE` untouched; completed bodies never pass through
ajson. Structured SYSTEM answers continue to use EV_JSON.

The following decisions govern later slices; their implementations land with
their first users or with slice 0a/the front, rather than in the host seam:

- PARSE is one STORE command, with `IV_JSON {kind: OUTLINE | DDLS | UNIT_PLAN,
  ...}`. Dell owns its dispatcher. `structureOf`, the `cdsEntityOf` halves and
  `runner.classes` become shared exports used by Node and PARSE.
- PACKAGE is one command: `IV_JSON {name, mode: raw | local, user}` gives
  EV_JSON. PACKAGES and SEARCH are separate commands. ET_OBJECT
  never carries names for these commands: CHAR40/CHAR30 would truncate them.
- Git state and revision routes stay in the Node facade permanently (A8b).
  No GIT_STATE/GIT_BLOB port commands are planned. HISTORY/REVISION remain
  host capabilities for ABAP version documents.
- A route may return a non-2xx response with its own non-document body only
  where Node does, such as the reentranceticket's text/plain 400s. Notebook
  JSON refusals remain in host orchestration (C6).
- Content types are already normalized wire values: the front replays a
  Buffer with `res.set`. Production uses `app etag false`; the diff harness
  will use that too. Harness-only weak ETags and 304s are removed from the
  specs; only strong ENTITY tags are contractual.
- ABAP never re-sorts a host list ordered with localeCompare/ICU. ABAP may
  SORT only where JavaScript uses plain `.sort()`.
- The ABAP-FS conformance baseline will be re-measured on main in S0 and
  recorded in `docs/abapfs-conformance.md`, superseding both 29/2/16 and
  30/1/16. Later slices compare with their merge-base figure.
- `test/adt-abap-coverage.mjs` walks the Express adtRouter stack
  by method and sample path and checks the front's MATCH. Under
  [variant C](port-plan.md), PORT_PENDING holds the document-port queue;
  each slice removes its entries. HOST_ALLOWED is the final Map of host
  orchestration and reasons. Completion means PORT_PENDING empty, every
  orchestration method reaching HOST, and exactly one last HOST catch-all.

Acceptance across S0 remains green versions, LOCK and SYSINFO byte diffs,
TYPES parity, ASCII/7.02 lint and coverage with the initial full allow-list.
F3 continuation contract: [slice-f3-continuations.md](slice-f3-continuations.md); router rows declare `resume_kind`, dispatched through `ZIF_OSD_ADT_RESUMABLE` in a fresh step. This is landed infrastructure. Variant C adds no new continuation routes; host orchestration reaches the catch-all.

## C5 on one runtime B: classrun / F9

`POST /sap/bc/adt/oo/classrun/:name` is `ZCL_OSD_ADT_CLASSRUN` in the
serving child with `OSD_ADT_ONE_RUNTIME=1`. OBJECT and READ use the facade's
bound source store over IPC. Source interface refusal remains 400; a class
absent from the compiled generation is deliberately 503 with NOT_BUILT in
one-runtime mode. Node maps ERR_MODULE_NOT_FOUND only after importFresh's
500 ms retry expires. With the switch off, main's original 500 remains.
The reduced parent kernel and plain inline hosts mark this row HOST through
`ZCL_OSD_KERNEL_GUARD=>HAS_GENERATION`: a complete generation alone is not
enough; the switch or a per-request oneRuntime binding must also be on.
The Node route and `/osd/classrun` remain available with the switch off.
Inline classrun therefore keeps main's console location and durable dump
persistence through Node's runClassrun.

`ZCL_OSD_KERNEL_GUARD=>CALL_CLASSRUN` is a runtime error boundary around
construction and MAIN, not a STORE capability. Its @KERNEL try/catch carries
plain JavaScript errors (including ASSERT-todo) as console runtime errors;
ABAP class-based exceptions are handled as well. Partial console output
survives. The response requests rollback, which the handler FENCE performs;
the route performs no COMMIT or ROLLBACK.

No STORE command is added. Existing SYSTEM DUMP accepts IV_JSON with
`operation: "record"`, `name`, `message`, `stack`, and `request`, and returns
EV_JSON with `where` and `frames`. Other DUMP queries retain the child ring
listing. Recording uses the serving child's existing dump ring and queues
persistDump outside the current step context, so the independent dump write
survives FENCE rollback and does not deadlock the FIFO. No parent database
or parent dump adapter is introduced. Go parity is deferred: osgo does not
mount ADT, and the route calls `ZCL_OSD_ADT_HOST=>REQUIRE( 'SYSTEM' )` before
execution. Go has no new logic or binding.

`test/adt-abap-c5.mjs` mounts live Node and remote ABAP facades over one
store and serving child, compares response bytes, and asserts ABAP
provenance, dump-ring recording, durable dumps and rollback. The former
inline suite with its own DUMP stub has been removed. Its isolated inline
switch-off helper boots the full generation through test/start.mjs and
mounts the real adtRouter without a DUMP adapter. It checks HOST provenance,
byte-equal dump text including the source location, a durable dump from each
facade, and the unbuilt-class 500 after the retry against the actual Node
ClassRun loaded from main cc6b0287. A file arriving during the retry is also
exercised. The reduced-parent helper checks HOST output (200), unbuilt
(500), and the retained classrun door (200). The C5 block is absent from
PORT_PENDING (formerly HOST_ALLOWED).

Notebook/C6 and the separate B4/B5 runtime work remain outside C5.

C5 review fixes validated on feat/adt-c5-b (Node 26): 53 targeted tests
passed (adt-abap-c5, adt-abap-coverage, xml-wellformed, store-destination),
including 17 C5 cases. ABAP Unit of the changed classes: router 18, guard 2,
classrun 1; all 21 methods passed. The coverage gate explicitly binds
oneRuntime when inspecting the ported route table; the isolated C5 helpers
exercise the switch-off table. No full suite, push, or SAP-system call was
made.
