# editor-helpers-transport

- Recommendation: **port-to-abap**
- Effort: M
- Owner: stoker (proposed: OBJECT is his host command and the transport check belongs to his write/activate flow; one codex slice). Needs dell's confirmation, since port-map.md lists the feeds under SKELETON and occurencemarkers under C2.
- Depends on: slice 1 (handler, router, front, SYSTEM IDENTITY): landed, slice 2 OBJECT store command: landed; this family extends it with `package`, no dependency on slice 3 front-up, 4a or 4b: these routes touch neither the session nor locks nor the build

## Routes

### GET `/sap/bc/adt/feeds` (adt-facade.mjs ~1086)

emptyFeed(res, "ABAP System Monitoring", "/sap/bc/adt/feeds"). 200, res.type("application/atom+xml;type=feed") which Express 4.22 send() rewrites on the wire to `application/atom+xml; charset=utf-8; type=feed` (params re-sorted, charset added; measured). Body, no newlines anywhere: `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:author><atom:name>{identity.userFullName}</atom:name></atom:author><atom:contributor><atom:name>{identity.systemID}</atom:name></atom:contributor><atom:link href="{self}" rel="self" type="application/atom+xml;type=feed"/><atom:title type="text">{title}</atom:title><atom:updated>{new Date().toISOString()}</atom:updated></atom:feed>`. Identity values are written UNESCAPED. self is the fixed canonical path, not the request path (trailing slash / upper case still yield the canonical href). Query ignored. Express weak ETag W/"<hexlen>-<sha1 b64>" from send(); HEAD = GET headers, no body. Not advertised in discovery.

### GET `/sap/bc/adt/feeds/variants` (adt-facade.mjs ~1089)

emptyFeed with title "Feed Variants", self "/sap/bc/adt/feeds/variants". Otherwise identical to /feeds.

### GET `/sap/bc/adt/system/users` (adt-facade.mjs ~1096)

200, same wire content type as the feeds (`application/atom+xml; charset=utf-8; type=feed`). Body: `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:title>Users</atom:title><atom:updated>{ISO now}</atom:updated><atom:entry><atom:id>{identity.userName}</atom:id><atom:title>{identity.userFullName}</atom:title></atom:entry></atom:feed>`. No author/contributor/link, title without type attribute; identity unescaped; one entry, the facade's own user. Query (e.g. a search term) ignored.

### GET `/sap/bc/adt/runtime/dumps` (adt-facade.mjs ~1694)

emptyFeed, title "Runtime Errors", self "/sap/bc/adt/runtime/dumps". Polled on a timer (108 calls in a captured session).

### GET `/sap/bc/adt/runtime/systemmessages` (adt-facade.mjs ~1698)

emptyFeed, title "System Messages", self "/sap/bc/adt/runtime/systemmessages". Polled (54 calls per captured session).

### GET `/sap/bc/adt/gw/errorlog` (adt-facade.mjs ~1702)

emptyFeed, title "SAP Gateway Error Log", self "/sap/bc/adt/gw/errorlog".

### POST `/sap/bc/adt/cts/transportchecks` (adt-facade.mjs ~2304)

Advertised ("cts/transportchecks": accept `application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData`, category transportchecks/cts, title "Transport Checks"); discovery stays Node-generated. CSRF-gated by the Node session middleware before the front. Body read raw (express.raw */*), toString utf8 (invalid bytes -> U+FFFD). transportCheckRequest: for URI, DEVCLASS, OPERATION each the FIRST match of /<NAME>([^<]*)<\/NAME>/i (case-insensitive tag, no namespace prefix, self-closing `<DEVCLASS/>` does not match -> undefined; `<DEVCLASS></DEVCLASS>` -> ""), raw text, NOT XML-unescaped. objectFromUri(uri, collections) with collections = SOURCE_TYPES in order CLAS oo/classes, INTF oo/interfaces, PROG programs/programs, DDLS ddic/ddl/sources, SRVD ddic/srvd/sources, INCL programs/includes: path = uri cut at first '#', then at first '?', one trailing `/source/main` removed (case-sensitive); first collection whose `/sap/bc/adt/<coll>/` is a CASE-SENSITIVE prefix wins; name = decodeURIComponent(rest).toUpperCase() (rest may contain '/', e.g. `x/includes/testclasses`). store.find(type,name) wrapped in try: a throw counts as not found. 200 + res.type(`application/vnd.sap.as+xml; charset=UTF-8; dataname=...checkData`) -> wire `application/vnd.sap.as+xml; charset=utf-8; dataname=com.sap.adt.transport.service.checkData` (charset lower-cased, sorted). Body = transportCheckDocument: `<?xml version="1.0" encoding="utf-8"?>\n<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n  <asx:values>\n    <DATA>\n` then 16 lines each 6 spaces + `<N>esc(v)</N>`: PGMID R3TR; OBJECT ADT_TYPE[type] (CLAS/OC, INTF/OI, PROG/P, DDLS/DF, SRVD/SRV, PROG/I) or "" when no collection matched; OBJECTNAME the decoded upper-cased name (not the store's spelling); OPERATION asked ?? "I" (an empty element stays ""); DEVCLASS found.package ?? asked.devclass ?? "$TMP" (nullish: "" from an empty element survives); CTEXT always "" (description is never passed); KORRFLAG ""; AS4USER ""; PDEVCLASS ""; DLVUNIT LOCAL; NAMESPACE ""; RESULT S; RECORDING ""; EXISTING_REQ_ONLY ""; TADIRDEVC same as DEVCLASS; URI the raw asked uri (so `&amp;` becomes `&amp;amp;`); then `      <MESSAGES/>\n      <REQUESTS/>\n      <LOCKS/>\n    </DATA>\n  </asx:values>\n</asx:abap>\n` (trailing newline). Values escaped with xmlEscape (& < > "). Failure: the only realistic throw is decodeURIComponent's URIError (e.g. `%zz`, lone `%FF`) -> 500, res.type("application/xml") -> wire `application/xml; charset=utf-8`, exceptionDocument("ExceptionTransportCheckFailed", "URI malformed") in namespace com.sap.adt (message text is V8's; Bun/JSC would say something else). ETag: Express weak ETag on both 200 and 500.

### POST `/sap/bc/adt/abapsource/occurencemarkers` (adt-facade.mjs ~2656)

Not advertised. Body read and ignored. req.query.uri must be a non-empty string (Express qs, case-sensitive key): missing, `uri=`, `?uri`, repeated `uri=a&uri=b` (array), `uri[x]=1` (object) or `URI=x` -> 400, wire `application/xml; charset=utf-8`, exceptionDocument("ExceptionInvalidRequest", "uri is required") namespace com.sap.adt. Otherwise 200 `application/xml; charset=utf-8` (passed with charset already), body exactly `<?xml version="1.0" encoding="utf-8"?><occurrenceInfo xmlns="http://www.sap.com/adt/abapsource"><occurrences/></occurrenceInfo>` with no trailing newline; constant body so a constant weak ETag (and a 304 on a matching If-None-Match through send's freshness check). `uri=%` is not decodable but qs keeps the raw '%', so it is a 200.

## Host dependencies

- SYSTEM IDENTITY (exists: tools/osd-store-destination.mjs SYSTEM_KINDS, bound per facade instance by withSystem in tools/adt-abap-front.mjs; ABAP ZCL_OSD_ADT_HOST=>identity( )). Used by the five empty feeds (userFullName, systemID) and system/users (userName, userFullName). No new kind.
- OBJECT (exists, store command added in slice 2: IV_TYPE, IV_NAME -> EV_JSON {found,type,name,writable}). EXTEND additively with `package: entry.package` in StoreDestination#object and `package TYPE string` in ZCL_OSD_ADT_HOST=>ty_object, read with get_string('/package'). Needed for the transport check's DEVCLASS/TADIRDEVC (test/adt-facade.mjs:1097 expects $STG_GATEWAY for ZCL_STG_DISPATCHER). Port-map section 3 already plans OBJECT returning the package chain, so this is the first step of that, not a new command. LOCK is unaffected (extra field ignored).
- No new STORE command, no new SYSTEM kind, no git/build/fs state, no continuation: nothing here rebuilds, swaps a generation or waits, so all of it runs inside one short dialog step.
- Clock: GET TIME STAMP FIELD into TIMESTAMPL (open-abap runtime get_time.js fills milliseconds from the same JS Date the Node side uses). Not a host command.

## Rationale

All eight routes are pure functions of (identity, request body/query, store object lookup, now). They read no host-only state (no build, git, watcher, file walk), so the stay-host exemption for OSD introspection routes does not apply, and they need no continuation. The only host facts are SYSTEM IDENTITY (exists) and OBJECT (exists, needs one additive field, package). The empty feeds are about a quarter of all ADT traffic in a captured session, so moving them is also what takes most requests off the HOST catch-all, which is the 0.7 done criterion. Byte equality is reachable for everything except <atom:updated> (wall clock, masked in the diff test). Note on ownership: port-map.md already proposed splitting this family (feeds and users D->SKELETON/dell, transportchecks D->A/stoker, occurencemarkers in C2/dell). As one slice it is smaller than the coordination cost of three owners, so I propose one owner. stoker fits: OBJECT is his host command (slice 2), and the transport check is part of his write-and-activate flow. dell has to confirm, because it takes occurencemarkers out of C2 and the feeds out of the SKELETON list. On a real system, for the record: the dumps feed would eventually read real short dumps (SNAP) rather than stay empty. That is out of scope here, because the reference is Node, which answers empty.

## ABAP design

New route classes in src/adt/ (7.02, ASCII-only comments, run abaplint):

1. ZCL_OSD_ADT_FEEDS (ZIF_OSD_ADT_ROUTE). handle( ): key = to_lower( path ) with one trailing '/' dropped and c_base stripped (the router already matched case-insensitively and slash-tolerant). Then CASE key: /feeds -> empty_feed( 'ABAP System Monitoring', '/sap/bc/adt/feeds' ), /feeds/variants -> 'Feed Variants', /runtime/dumps -> 'Runtime Errors', /runtime/systemmessages -> 'System Messages', /gw/errorlog -> 'SAP Gateway Error Log', /system/users -> users( ). The self href is the constant, never the request path. Identity comes from ZCL_OSD_ADT_HOST=>identity( ), written WITHOUT zcl_osd_adt_xml=>esc (matching the JS; port-map step 11 says to fix escaping in OSG-JS first). content_type constant c_atom = `application/atom+xml; charset=utf-8; type=feed`, which is the wire form Express produces, so a real ICF sends the same bytes. Public static now_iso( ) RETURNING string: GET TIME STAMP FIELD lv_tsl (TIMESTAMPL), CONVERT TIME STAMP to date/time TIME ZONE 'UTC' (or split the packed digits), ms = trunc( frac( lv_tsl ) * 1000 + '0.0005' ) clamped to 999, because the runtime deliberately leaves float garbage in the fraction. Format YYYY-MM-DDTHH:MM:SS.mmmZ, always 24 chars. Later this moves to the ZCL_OSD_ADT_DOC_COMMON=>empty_feed planned in port-map.

2. ZCL_OSD_ADT_TRANSPORT (ZIF_OSD_ADT_ROUTE), POST cts/transportchecks. Body: cl_abap_codepage=>convert_from( body ), with a CATCH that falls back to a lossy conversion so that bad bytes do not 500. field( name ): FIND FIRST OCCURRENCE OF REGEX `<NAME>([^<]*)</NAME>` IN text IGNORING CASE SUBMATCHES v, keeping a found flag (absent and empty are different states and must stay distinct). Then ZCL_OSD_ADT_TYPES=>object_from_uri( iv_uri EXPORTING ev_type ev_name RAISING zcx_osd_adt ), a NEW method (port-map step 12 lists it): cut at '#' then '?', drop one trailing `/source/main` case-sensitively, loop sources( ) in order with a case-sensitive prefix `/sap/bc/adt/<coll>/`, decode the rest with the existing ZCL_OSD_ADT_URI decoder (same decodeURIComponent semantics Express uses for params) and upper-case it. Map the decoder's 400 to NEW ZCX_OSD_ADT=>transport_check_failed( 'URI malformed' ): status 500, type ExceptionTransportCheckFailed, namespace com.sap.adt. Also add ZCL_OSD_ADT_TYPES=>adt_type( type ) for the six source codes (CLAS/OC, INTF/OI, PROG/P, DDLS/DF, SRVD/SRV, INCL->PROG/I). Lookup: TRY. ls_obj = zcl_osd_adt_host=>object( type name ). CATCH zcx_osd_adt. not found. ENDTRY. This mirrors the Node try/catch. package = found ? ls_obj-package : ( devclass_found ? devclass : '$TMP' ); operation = op_found ? op : 'I'. Document: the 16 value lines with newline separators via cl_abap_char_utilities=>newline, values through zcl_osd_adt_xml=>esc, plus the trailing newline. content_type `application/vnd.sap.as+xml; charset=utf-8; dataname=com.sap.adt.transport.service.checkData`.

3. ZCL_OSD_ADT_OCCURRENCES (ZIF_OSD_ADT_ROUTE), POST abapsource/occurencemarkers. Count the query fields named exactly `uri`, and treat a field whose name starts with `uri[` as a non-string. Raise zcx_osd_adt=>invalid_request( 'uri is required' ) unless exactly one plain `uri` field exists and its value is not initial. Otherwise 200, `application/xml; charset=utf-8`, the constant body. The private `field` helper of ZCL_OSD_ADT_LOCK should move to a shared public one (ZCL_OSD_ADT_REQUEST in the port-map class layout) instead of a third copy.

Router rows (ZCL_OSD_ADT_ROUTER=>routes, served_by ABAP, before the `* /sap/bc/adt/*` HOST catch-all; they overlap none of the existing graph, sysinfo, lock or versions rows): GET /sap/bc/adt/feeds, GET /sap/bc/adt/feeds/variants, GET /sap/bc/adt/system/users, GET /sap/bc/adt/runtime/dumps, GET /sap/bc/adt/runtime/systemmessages, GET /sap/bc/adt/gw/errorlog -> ZCL_OSD_ADT_FEEDS; POST /sap/bc/adt/cts/transportchecks -> ZCL_OSD_ADT_TRANSPORT; POST /sap/bc/adt/abapsource/occurencemarkers -> ZCL_OSD_ADT_OCCURRENCES. HEAD is covered by the existing HEAD->GET rule. Eight literal rows, none per type, so nothing is generated from the type table.

Host side (Node): the one-line OBJECT extension in tools/osd-store-destination.mjs. Then delete the eight Node handlers, or leave them as dead fallback while OSD_ADT=js exists; emptyFeed stays as long as js mode does. The `advertise("cts/transportchecks")` call stays because discovery is still Node's.

What the host is asked per request: feeds and users ask SYSTEM IDENTITY once; transportchecks asks OBJECT once (only when the URI names a source collection); occurencemarkers asks nothing.

## Test plan

Add one `describe("editor helpers and transport check")` to test/adt-abap-diff.mjs (two adtRouters over one store, one with the front and one without; compare status, content-type, content-length, ETag and body; assert X-OSD-Served-By is not HOST and that an ABAP step ran).

Feeds and users:
- GET and HEAD for each of the 6 paths, plus a trailing slash, an upper-case path and a noise query (`?$top=1&x=y`).
- Before comparing, take the `<atom:updated>` value from both sides, assert each matches /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/ and that they lie within 5 s of each other, then replace both with a mask. Content-length must be equal unmasked (the ISO stamp is fixed width).
- The ETag differs with the stamp, so compare its shape and its length part W/"<hex len>-, not its hash.
- Two facade instances with different identities, requests interleaved: each feed names its own systemID and userFullName, and users names its own userName.
- One identity containing `&` and `<`: byte-equal unescaped. This pins the deliberate quirk, so a later escaping fix flips both sides together.

Transport check, byte-equal including ETag (all POSTs with the token and cookie):
- a known class (zcl_stg_dispatcher -> $STG_GATEWAY);
- a known class through `/source/main`, through `#start=1,1`, through `?version=active`;
- an unknown name in a known collection, with `<DEVCLASS></DEVCLASS>` (gives ""), with `<DEVCLASS/>` (gives $TMP), with no DEVCLASS (gives $TMP), and with `<DEVCLASS>ZPKG</DEVCLASS>`;
- a class include URI (`.../includes/testclasses`, name with '/', not found);
- each of the 6 collections once (INCL gives PROG/I, SRVD gives SRVD/SRV);
- an upper-case collection prefix `/sap/bc/adt/OO/classes/x` and non-source collections (packages/x, ddic/tables/x): OBJECT "" with the name empty;
- a URI with no path under a collection;
- no URI, and an empty `<URI></URI>`;
- OPERATION absent (I), empty (""), and D;
- lower-case tags `<uri>`; two URI elements (the first wins);
- `&amp;` inside the URI, kept raw then escaped, so it is double-escaped;
- `%2FNS%2FZCL_X` (a namespace);
- `%zz` and a lone `%FF`: 500 ExceptionTransportCheckFailed "URI malformed", content type and ETag equal;
- an empty body;
- a body with 0xFF bytes outside the URI;
- a library object (found, its library package).

Occurrence markers:
- a valid encoded URI gives 200 with an equal ETag;
- If-None-Match with that ETag gives 200 on both sides for POST (live Node check: Express freshness applies to GET/HEAD);
- missing, `uri=`, bare `?uri`, `uri=a&uri=b`, `uri[x]=1` and `URI=x` give a 400 byte-equal to Node;
- `uri=%` gives 200;
- a 1 MB body is ignored;
- no CSRF token is still refused by the Node gate before the front (unchanged).

ABAP Unit (zcl_osd_adt_router testclasses or a new local class):
- the content_type literals as ANSWER records them, which is the system's wire bytes. The Node diff cannot see these, because Express's send() re-normalizes whatever ABAP writes;
- now_iso( ) is 24 chars and its millisecond rounding stays 3 digits at x.9995;
- the object_from_uri cases above;
- adt_type for all six;
- the decoder error mapping to 500.

Red proof (each must fail the diff and be restored):
- the identity escaped;
- a different element order in emptyFeed;
- the transport document without its trailing newline;
- `?? 'I'` implemented as `IS INITIAL -> 'I'` (fails the empty-OPERATION case);
- a case-insensitive collection prefix (fails the OO/classes case);
- OBJECT without package (fails dispatcher -> $TMP);
- the OBJECT error not swallowed (an unknown name gives 500);
- occurrences accepting the first of two `uri` fields.

Existing suites must stay green through the front: test/adt-facade.mjs :195-220 (feeds and contributor = systemID) and :1097-1120 (transport check, advertised), test/adt-devloop.mjs :703 and :729 (occurrence markers), test/adt-abap-diff.mjs as a whole.

ABAP-FS conformance (--start) must not be worse than 30 PASS / 1 FAIL / 16 MISSING: the transport check and feeds/dumps/users scenarios stay PASS. Also report the drop in HOST-routed traffic, e.g. by replaying the STG_ADT_DUMP capture and counting HOST vs ABAP verdicts before and after.

## Risks

- The clock: <atom:updated> is wall time on both sides and cannot be byte-equal, so the diff must mask it after asserting its format. The open-abap runtime puts float garbage into TIMESTAMPL's fraction on purpose, so naive millisecond extraction can print .999 as 1000 or lose a digit; round and clamp.
- Content-type normalization: on the Node host the front replays the ABAP answer through res.send, which re-sorts params and lower-cases the charset. A non-normalized ABAP literal would therefore pass the Node diff and still differ on a real ICF. Pin the literals in ABAP Unit against ANSWER's record.
- ETag: Express adds a weak ETag (and 304 handling) on the Node host for both sides. A real ICF adds none. This system-vs-Node difference is outside Gate 1 and should be noted rather than emulated.
- The identity is written unescaped, as the JS does, so an identity containing & or < produces malformed XML on both sides. Keep it for byte-equality and fix it in OSG-JS first (port-map open question).
- The transport check's decode error message is V8's 'URI malformed'. The Bun binary host would say something else, so ABAP hard-codes the Node text and the binary's JS answer differs today. Moving to ABAP removes that divergence.
- Swallowing every OBJECT failure as 'not found' copies Node's try/catch, but it also swallows 'no host here'. On a system without STORE the check then answers the request's DEVCLASS or $TMP instead of 500. That is acceptable (the answer is the same for every object) but it differs from sysinfo, which 500s. A system port would read TADIR instead.
- JS toUpperCase vs ABAP to_upper on non-ASCII names (e.g. sharp s becoming SS in JS). The diff should use ASCII names, and the difference should be recorded as a known non-equality if found.
- Query parsing parity between Express qs (arrays, bracket keys, '+' as space, an undecodable '%' kept raw) and the shim's get_form_fields_cs. Only presence and emptiness of `uri` matter, but the shim must not throw a JS URIError on `uri=%` (port-map notes unescape_url is decodeURIComponent in a kernel line). Verify that before relying on it.
- Request bodies with invalid UTF-8: Node substitutes U+FFFD, while cl_abap_codepage may raise. A non-URI field with bad bytes must still give 200.
- Cost: each feed poll becomes a dialog step plus one destination call, and polls are about a quarter of all traffic. They now queue in the work-process FIFO behind any long step (a unit run that still runs inside a step) where Node answered them immediately. Measure poll latency during an ABAP Unit run before and after.
- Ownership conflict with port-map.md's earlier proposed moves (feeds to SKELETON/dell, transportchecks to A/stoker, occurencemarkers to C2/dell). Needs one line of confirmation from dell.
- Discovery is still Node's and advertises cts/transportchecks independently of the router row. When discovery moves to ABAP, the advertise column must be added to this row.
