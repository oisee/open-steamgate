# discovery-compatibility

- Recommendation: **port-to-abap**
- Effort: S
- Owner: stoker (proposed: discovery is the logon handshake, HEAD core/discovery is the CSRF token fetch, and it sits next to sessions/logoff and the slice-3 front that stoker already owns; the graph, its twin, is also from the skeleton slices)
- Depends on: slice 1 front (landed: ZCL_OSD_ADT_HANDLER, ZCL_OSD_ADT_ROUTER, adt-abap-front.mjs), none of 4a/4b; coordinate with every later family port, because each one that changes an advertise() must also update ZCL_OSD_ADT_DISCOVERY=>COLLECTIONS

## Routes

### HEAD `/sap/bc/adt/core/discovery` (adt-facade.mjs ~1732)

Explicit HEAD row, registered before the GET on purpose because clients fetch the CSRF token with HEAD. Answers `res.status(200).type("application/atomsvc+xml").end()`: status 200, content type exactly `application/atomsvc+xml` with no charset, no Content-Length, no ETag, no body, and Express adds `connection: close`. The session middleware runs before it (or ZCL_OSD_ADT_SESSION in slice-3 mode) and adds sap-contextid, SAP_SESSIONID_OSD_001 and x-csrf-token on `x-csrf-token: fetch`. It cannot fall back to the HEAD-from-GET rule, because that rule would send Content-Length 12619.

### GET `/sap/bc/adt/core/discovery` (adt-facade.mjs ~1735)

200 with `application/atomsvc+xml; charset=utf-8` (Express appends the charset on send(string)) and a weak ETag that Express computes. The ETag was W/"314b-ktUc0PGnOFv8UG2aTy0Yvj1gqPo" on origin/main at 2026-10-02, 12619 bytes. The body is discoveryDocument(resources): an Atom service document with 25 collections. Workspaces are grouped in the order each one first appears, and collections keep the order in which adtRouter called advertise(). If-None-Match gives a 304 through Express freshness.

### HEAD `/sap/bc/adt/discovery` (adt-facade.mjs ~1732)

Same as HEAD core/discovery, because the same loop registers both paths.

### GET `/sap/bc/adt/discovery` (adt-facade.mjs ~1735)

Same document, type and ETag as GET core/discovery. vsp scans this body for href="/sap/bc/adt/<collection>". abap-fs gates features on workspace titles and hrefs. Eclipse NPEs on a collection that has no atom:category.

### HEAD `/sap/bc/adt/compatibility/graph` (adt-facade.mjs ~1753)

ALREADY ABAP (ZCL_OSD_ADT_GRAPH, router row 1). 200, `application/xml` without charset, empty body. Gate 1 covers it in the PORTED list of test/adt-abap-diff.mjs.

### GET `/sap/bc/adt/compatibility/graph` (adt-facade.mjs ~1756)

ALREADY ABAP (ZCL_OSD_ADT_GRAPH, router row 2). 200, `application/xml; charset=utf-8`, compatibilityGraphDocument(): 32 nodes and 19 edges, byte-equal, in PORTED, including the case-variant path. Nothing is left to port. The Node route stays only as the Gate-1 reference and the fallback while the ABAP route table cannot be read.

## Host dependencies

- None. The discovery document is a pure function of static data in tools/adt-facade.mjs: ACCEPT, CATEGORY, TEMPLATE_LINKS (with SEARCH_TEMPLATE), TITLE, WORKSPACE(), the order of the advertise() calls in adtRouter, and SOURCE_TYPES derived from the static TYPES in tools/osd-store-types.mjs. It does not depend on the store, the tree, options, identity, time or the session. No STORE command (LIST/READ/WRITE/CHECK/ACTIVATE/CAPABILITIES/HISTORY/REVISION) and no SYSTEM kind (IDENTITY/LOCK_HANDLE/LOCK_RELEASE/SESSION/LOCK_HOLDER) is needed, and no new one is proposed.
- Session cookies and the CSRF token on the HEAD token fetch: in the mixed phase the Node session middleware adds them before the front; in slice-3 mode ZCL_OSD_ADT_HANDLER=>ANSWER adds them through ZIF_OSD_ADT_SESSION. Both exist already, and the route class adds nothing.
- ETag and the 304: computed by Express in the front's res.send (tools/adt-abap-front.mjs line ~196). The route does not set it. It comes out equal because the body bytes and content type are equal.
- The source-collection order can reuse the existing ZCL_OSD_ADT_TYPES=>SOURCES (CLAS, INTF, PROG, DDLS, SRVD, INCL), which already mirrors SOURCE_TYPES.

## Rationale

The compatibility graph is finished: ZCL_OSD_ADT_GRAPH serves HEAD and GET, and Gate 1 holds it byte-equal. Only the four discovery rows are left. The milestone defines done as no HOST rows except the catch-all, so discovery cannot stay host-served. It also does not need to. Node computes the document entirely from constants and the fixed order of the advertise() calls, and reads no host state, so the usual reason a route stays on the host (the route reads host state) does not apply. abap-skeleton.md says 'host-built in the mixed phase' because it assumed discovery would be generated from an advertise column on the router table. That column cannot express collections served by the HOST catch-all, and the router table is per route while discovery is per collection. A separate, ordered collection list in ABAP is therefore the right source of truth. During the mixed phase Gate 1 makes Node's advertise() order and the ABAP list agree byte for byte. Once Node's discovery route is retired, the ABAP list is the only one.

## ABAP design

New class ZCL_OSD_ADT_DISCOVERY implementing ZIF_OSD_ADT_ROUTE. It is static data, like ZCL_OSD_ADT_GRAPH, so no JSON asset or zcl_osd_tpl is needed.

Types:
- ty_link = {rel, template, type}, with tt_link.
- ty_collection = {adt (the path below /sap/bc/adt), title, workspace, accept TYPE string_table, term, scheme, links TYPE tt_link}, with tt_collection.

Methods:
- COLLECTIONS( ) RETURNING tt_collection. It returns the 25 collections in Node's advertise() order:
  1. repository/informationsystem/virtualfolders
  2. repository/informationsystem/objecttypes
  3. repository/informationsystem/releasestates
  4. abapunit/metadata
  5. the six collections from ZCL_OSD_ADT_TYPES=>SOURCES: oo/classes, oo/interfaces, programs/programs, ddic/ddl/sources, ddic/srvd/sources, programs/includes
  6. oo/classrun
  7. checkruns
  8. cts/transportchecks
  9. checkruns/reporters
  10. activation/inactiveobjects
  11. activation
  12. abapunit/testruns
  13. packages
  14. ddic/dataelements
  15. repository/nodestructure
  16. repository/informationsystem/search
  17. ddic/tables
  18. datapreview/ddic
  19. datapreview/cds
  20. datapreview/freestyle
- Private helpers ADD, ACCEPT, CATEGORY, TITLE, LINKS and WORKSPACE, one per Node map. WORKSPACE copies Node exactly: `ddic/` or `datapreview/` gives Data Dictionary; `repository/` or `packages` gives Repository; exactly `activation`, exactly `checkruns`, `abapunit*` or `cts/*` gives Development Loop; anything else gives Source Library. This deliberately puts checkruns/reporters and activation/inactiveobjects in Source Library, as Node does. A missing title falls back to the adt path, as `TITLE[adt] ?? adt` does.
- DOCUMENT( ) RETURNING string. It groups by workspace in order of first appearance, then writes Node's exact whitespace and LF newlines:
  - the XML declaration, then `<app:service` with three xmlns lines indented 13 spaces;
  - per workspace, `  <app:workspace>` and `    <atom:title>`;
  - per collection, `    <app:collection href=...>`, `      <atom:title>`, one `      <app:accept>` line per accept (no line when there are none), `      <atom:category term= scheme=/>`, and either `      <adtcomp:templateLinks/>` or the block with `        <adtcomp:templateLink rel= template=[ type=]/>`;
  - `    </app:collection>`, with collections joined by a newline;
  - `  </app:workspace>`, then `</app:service>` plus a trailing LF.

  Every text and attribute value goes through ZCL_OSD_ADT_XML=>ESC. SEARCH_TEMPLATE's `{&objectType*}` must come out as `{&amp;objectType*}`.
- HANDLE: for HEAD, status 200, content_type `application/atomsvc+xml`, no body. For GET, status 200, content_type `application/atomsvc+xml; charset=utf-8`, body = DOCUMENT( ).

Router rows in ZCL_OSD_ADT_ROUTER=>ROUTES, ahead of the catch-all, HEAD rows before GET as Node registers them:
- HEAD /sap/bc/adt/core/discovery
- GET /sap/bc/adt/core/discovery
- HEAD /sap/bc/adt/discovery
- GET /sap/bc/adt/discovery

All four have handler ZCL_OSD_ADT_DISCOVERY and are served by ABAP. HEAD needs its own rows: the HEAD-to-GET fallback would send Content-Length.

The ABAP constraints are 7.02 and ASCII: no string templates, so use backtick literals joined with &&. Lines must stay under 255 characters, so SEARCH_TEMPLATE (~370 characters) is split across several && pieces. The graph and nodes are unchanged.

No host continuation: the step is pure computation of about 12 KB.

Later, at the end of the milestone, add an invariant check to ABAP Unit: every advertised href is the prefix of at least one ABAP router row. That is what 'discovery advertises every route' means once the HOST rows are gone. Today the catch-all makes it trivially true. Node's advertise() calls stay as the Gate-1 reference until Node's discovery route is deleted.

## Test plan

test/adt-abap-diff.mjs:
- Move ["GET","/sap/bc/adt/discovery"] and ["HEAD","/sap/bc/adt/core/discovery"] from DELEGATED to PORTED, and add GET core/discovery, HEAD discovery, `/SAP/bc/ADT/Discovery/` (case and trailing slash) and `/sap/bc/adt/core/discovery/`. Each is compared on status, content-type, content-length, ETag and the whole body, and the front must report ABAP as the server.
- The warm-up call at line ~246 ('the route table is read once') uses GET discovery. Switch it to a path that stays HOST, for example GET debugger/listeners. Otherwise the 'no step for a HOST row' assertion counts a discovery step.
- Extra cases:
  - HEAD with `x-csrf-token: fetch`: both sides 200, content type with no charset, no Content-Length, no ETag, and an x-csrf-token header present (compare that it is present, not its value).
  - GET with If-None-Match set to Node's ETag: both sides 304.
  - test/adt-abap-sessions.mjs, which already drives core/discovery in AbapSessions mode: the token and the cookies come back from ABAP now that the route is ABAP.
- Red proof:
  1. Change one TITLE character in the ABAP and Gate 1 must fail on the body and ETag.
  2. Add a dummy advertise() in Node and Gate 1 must fail. This proves that list drift is caught.
  3. Remove the HEAD rows and HEAD must fail on Content-Length.
- ABAP Unit on ZCL_OSD_ADT_DISCOVERY:
  - workspace grouping by first appearance, giving Repository, Development Loop, Source Library, Data Dictionary;
  - esc of & in the search template;
  - a collection without accept writes no accept line;
  - the type attribute appears only on classrun;
  - 25 collections, each with a category.
- The existing content assertions must stay green with the abap option set: test/adt-facade.mjs :256/:263/:352/:468-492/:562 and test/adt-devloop.mjs :398/:743/:863/:928.
- Gate 2 (A4H) is not applicable to the bytes, because ours are not SAP's. The ABAP-FS compatibility test must be no worse; it uses discovery as its feature gate.

## Risks

- Two lists can drift during the mixed phase. Every family port that adds or reorders an advertise() in Node must change ZCL_OSD_ADT_DISCOVERY in the same PR, and Gate 1 catches it only if the discovery rows are in PORTED. Keep them in PORTED permanently. The ETag (W/"314b-..." today) changes with every advertise change, so never pin it as a literal; compare it against Node.
- Byte quirks must be kept, not fixed: checkruns/reporters and activation/inactiveobjects land in 'Source Library', because WORKSPACE matches `checkruns` and `activation` exactly. Seven collections use their path as the title. The 'respository' misspelling is SAP's scheme. ACCEPT['functions/groups'] and several CATEGORY entries are never advertised and must not appear. A 'fix' on one side breaks Gate 1; any fix goes into both lists in one PR.
- Advertised but not served: the client-view doc says absent is fine and a 404 is not. 'Change and Transport System' and 'abapGit Repositories' are deliberately not advertised. Porting must not add them.
- Work-process FIFO: HEAD core/discovery is every client's first request (logon and token fetch) and the liveness probe of scripts/osd-restart.sh. Once ported, it enters an ABAP step and queues behind a long OData or ABAP step. Before, Node answered in about 0.4 ms; measured ABAP-first cost is about 0.9-1.0 ms. If the route table cannot be read, the front falls back to Node, so liveness during a cold start is not lost. A dump in the ABAP returns a 500 where it used to return a 200.
- Line-length and ASCII limits in 7.02 ABAP: the search template is ~370 characters and must be split. Any em dash or non-ASCII character copied from a Node comment fails abaplint, so run the lint.
- Clients parse this document very differently. Eclipse NPEs on a missing category, vsp regex-scans the hrefs, and abap-fs matches titles. A whitespace-only difference is harmless to all three but still fails Gate 1, which is the intended strictness.
