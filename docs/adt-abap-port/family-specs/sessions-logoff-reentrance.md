# sessions-logoff-reentrance

- Recommendation: **port-to-abap**
- Effort: M
- Owner: stoker
- Depends on: front-up (dell, slice 3 part B): USE_SESSION bound, every /sap/bc/adt request enters ZCL_OSD_ADT_HANDLER first, Node session middleware and JS matcher removed, slice 3 session: ZCL_OSD_ADT_SESSION (#464) and AbapSessions (#465) as the only session store (no in-memory Node Sessions left on the ADT path), skeleton step 1 (port-map section 2): handler applies session, CSRF and stamping only under /sap/bc/adt (needed for logoff)

## Routes

### GET `/sap/bc/adt/core/http/reentranceticket` (adt-facade.mjs ~746)

Under BASE, so the session middleware has already run: fresh session => two Set-Cookie (sap-contextid Path=/sap/bc/adt, SAP_SESSIONID_<SID>_<client> Path=/), x-csrf-token, X-OSD-Generation. Query redirect-url via express qs: not a non-empty string (missing, empty, repeated => array, bracketed => object) => 400 text/plain; charset=utf-8 'redirect-url is required'; new URL() throws => 400 'redirect-url is not a URL'; url.hostname not localhost / 127.0.0.1 / [::1] (WHATWG-normalized: case folded, 127.1 and 0x7f000001 become 127.0.0.1, [0:0::1] becomes [::1]) => 400 'redirect-url must point at loopback'. The 400s are plain text, NOT the ADT exception document, with express's weak ETag. Success: ticket = randomBytes(24) base64url (32 chars, never stored, never checked); url.searchParams.set('_', String(req.query._ ?? Date.now())) then set('reentrance-ticket', ticket) -- URLSearchParams.set re-serializes the WHOLE query form-urlencoded (space=>+, pairs without = get =, set replaces the first occurrence in place and drops the rest, appends if absent); a repeated _ arrives as array and serializes '1,2'. Appends Set-Cookie 'sap-usercontext=sap-client%3D001; Path=/' (cookie.serialize encodeURIComponent; the only use of the client). res.redirect(307, url): Location = encodeurl(url.toString()); res.format negotiation over [text, html] on Accept (no Accept => text): text => Content-Type text/plain; charset=utf-8, body 'Temporary Redirect. Redirecting to <loc>'; html => text/html; charset=utf-8, body '<p>Temporary Redirect. Redirecting to <escapeHtml(loc)></p>' (express 4.22.2, no anchor); nothing acceptable => default, no Content-Type, empty body. Always 'Vary: Accept', explicit Content-Length, res.end (no ETag). HEAD: same headers, no body. Never writes the session cookie.

### GET `/sap/bc/adt/core/http/sessions` (adt-facade.mjs ~784)

200, Content-Type 'application/vnd.sap.adt.core.http.session.v3+xml; charset=utf-8', express ETag over the body, plus middleware cookies/token/generation. Body is one fixed string with one variable: id = upper(first 32 hex of sha256(utf8(req.adt.session.id))) where session.id is the middleware-chosen session (context cookie wins over session cookie). Links in order: BASE/core/http/sessions/<id> rel .../sessions/securitysession title 'Security session'; /sap/public/bc/icf/logoff rel .../sessions/logoff title 'Logoff resource'; BASE/core/http/systeminformation rel .../system/systeminformation type application/vnd.sap.adt.core.http.systeminformation.v1+json title 'System information resource'; then http:properties inactivityTimeout 1800 (advertised, not tied to TTL). No newlines, xml decl with double quotes.

### DELETE `/sap/bc/adt/core/http/sessions/:id` (adt-facade.mjs ~1598)

CSRF-gated (DELETE is unsafe: wrong token => 403 text/plain 'CSRF token validation failed', x-csrf-token: Required). If upper(:id, express-decoded) equals sessionIdentifier(req) the caller's own session is ended (sessions.end: rows, handles, ENQ session, so every lock goes). Any other id (including the raw 24-hex id, which test/adt-abap-sessions.mjs sends) is a silent no-op. Always status 200, res.end(): no Content-Type, Content-Length: 0, no ETag; still carries the middleware's Set-Cookie/x-csrf-token of the session it just ended. Wrapped in answer(), so a throw from end() is a 500 ExceptionInternalError document in namespace org.open-steamgate.osd.

### GET `/sap/public/bc/icf/logoff` (adt-facade.mjs ~1604)

Outside BASE: no session middleware, so no sweep, no fresh session, no Set-Cookie, no x-csrf-token, no X-OSD-Generation, no CSRF gate. Reads cookies with parseCookies and sessionIdOf (sap-contextid if non-empty else SAP_SESSIONID_<SID>_<client>); if an id, sessions.end(id) (unknown id: no-op in Node Sessions; AbapSessions calls ABAP END regardless). Always 200 'text/plain; charset=utf-8' body 'logged off' with express weak ETag. HEAD answered by the same handler. abap-fs (abap-adt-api) uses this as its logout; test/adt-devloop.mjs:1275-1360 pins 'two cookies naming two sessions end only the one the client is using'.

## Host dependencies

- SYSTEM IDENTITY (exists, ZCL_OSD_ADT_HOST=>IDENTITY): client for the sap-usercontext cookie and system id/client for the SAP_SESSIONID cookie name (already used by ZCL_OSD_ADT_SESSION->cookie_name)
- Session end: ABAP-native ZIF_OSD_ADT_SESSION->END (ZOSD_ADT_SESS/ZOSD_ADT_SHDL delete + ZCL_OSD_ENQ_KERNEL=>END over the existing ENQ kernel seam, tools/osd-enq-host.mjs endEnqSession). No STORE command.
- Session lookup without opening one (logoff): ABAP-native, cookies parsed by ZCL_OSD_ADT_CSRF=>COOKIES_OF; precedence as RESOLVE. No STORE command.
- Randomness (ticket, 24 bytes): cl_system_uuid as ZCL_OSD_ADT_SESSION->RANDOM already does; expose a TICKET kind or a public helper. No host call.
- Clock for the default _ (epoch milliseconds): GET TIME STAMP FIELD (long) converted to ms since 1970. No host call.
- SHA-256: cl_abap_message_digest=>calculate_hash_for_char SHA256 (open-abap-core, already used by ZCL_OSD_ADT_VERSIONS). No host call.
- X-OSD-Generation and STG_ADT_DUMP stay in the Node front (slice-3-front item 3); unchanged by this family.
- NEW STORE commands: none. NEW SYSTEM kinds: none, provided the family lands after front-up. (Landing before front-up would need a new SYSTEM kind SESSION_ID answering the Node middleware's req.adt.session.id, plus a SESSION_END kind -- not recommended: it keeps two session stores alive.)
- Node front change (tools/adt-abap-front.mjs, dell's file): (1) mount the front also on /sap/public/bc/icf/logoff; (2) replay a 3xx answer with Content-Length = body bytes and res.end(body) (HEAD: res.end()), never res.send, because express send would add an ETag Node's res.redirect does not send; (3) append (not set) every Set-Cookie from ANSWER's own record (three lines on a fresh reentrance: context, session, sap-usercontext) -- risk 5, the shim keeps only one.

## Rationale

All four routes read and write only session state and identity, which after slice 3 are ABAP's own (ZOSD_ADT_SESS / ZOSD_ADT_SHDL, the ENQ kernel seam, SYSTEM IDENTITY). None rebuilds or swaps a generation, waits, or reads host files, so nothing needs a host continuation and the work-process FIFO is not an issue (END is a few DELETEs and an ENQ end inside one step). Keeping them on the host after front-up would be wrong rather than merely incomplete: the host would need an adapter call back into ABAP to end a session that ABAP resolved in the same request (two steps for one logoff), and the in-memory Node Sessions would have to be kept for the logoff path. No new host capability is needed. The only real cost is reproducing express/WHATWG behaviour byte-for-byte in reentranceticket (URL normalisation, URLSearchParams serialisation, Accept negotiation, encodeurl, escapeHtml, cookie encoding). The design below bounds that cost by tightening the accepted grammar on both sides (Node first, as the escaping note in port-map step 11 does), so that WHATWG's work on the accepted set is a short list of rules ABAP can state.

## ABAP design

Route classes (each implements ZIF_OSD_ADT_ROUTE, no constructor parameters):
- ZCL_OSD_ADT_SESSIONS: GET /sap/bc/adt/core/http/sessions and DELETE /sap/bc/adt/core/http/sessions/:id. A shared private method SECURITY_ID( id ) returns to_upper( substring( calculate_hash_for_char( SHA256, id ) len 32 ) ), with the hex output upper-cased explicitly and not trusted to the kernel. GET builds the document with one string template (no XML writer, so no whitespace drift) and content_type `application/vnd.sap.adt.core.http.session.v3+xml; charset=utf-8`. DELETE: IF to_upper( param id ) = SECURITY_ID( request-session-id ), call session->END( id ). Answer status 200, empty content_type, empty body.
- ZCL_OSD_ADT_LOGOFF: GET /sap/public/bc/icf/logoff. id = context cookie if non-empty, else the SAP_SESSIONID_<SID>_<client> cookie, taken from ZCL_OSD_ADT_CSRF=>COOKIES_OF( headers ). If id is not initial, session->END( id ). Answer 200, `text/plain; charset=utf-8`, `logged off`. It must never call RESOLVE (that would INSERT a fresh session and emit cookies). Decision for the slice: either guard END on a 24-lower-hex id (Node's Sessions.end ignores unknown ids, while ABAP END also ends the ENQ key of whatever the cookie says), or keep today's AbapSessions behaviour. The guard is preferred, with a unit case for each.
- ZCL_OSD_ADT_REENTRANCE: GET /sap/bc/adt/core/http/reentranceticket. Read the redirect-url and _ query values. A repeated redirect-url or a bracketed name answers 'required'. A repeated _ joins with ',' as String(array) does. The URL step is a strict grammar, case-insensitive on scheme and host: ^(http|https)://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?(/path)?(\?query)?(#fragment)?$. The path holds RFC 3986 pchars only, with no dot segments, no backslash, and %XX only as valid hex. Anything that is not http(s):// with an authority answers 'is not a URL'. A parsed URL whose host is not one of the three literals answers 'must point at loopback'. Normalise as WHATWG does on that set:
  - lower-case the scheme and the host;
  - parse the port as a number (leading zeros stripped) and drop it when it is the default (80 for http, 443 for https); a port over 65535 answers 'not a URL';
  - an empty path becomes '/';
  - keep the fragment verbatim.
  For the query, parse it form-urlencoded ('+' is a space, percent-decode, split on '&', drop empty pieces, a missing '=' gives an empty value). set('_') replaces the first '_' in place and removes the later ones, else appends; set('reentrance-ticket') does the same. Serialize each byte outside [*-._0-9A-Za-z] as %XX upper case, a space as '+'. When the query is empty after the sets, there is no '?'. Location = the serialized URL (encodeurl is the identity on this grammar's output, which is why the grammar refuses a stray '%'). Ticket = 24 random bytes, base64url (32 chars, no padding). Accept negotiation on Accept over (text/plain, text/html), negotiator order: q desc, specificity desc, Accept index asc, provided index asc, q=0 excluded, no header means text. Body and content type are as Node's (text, html with escapeHtml of & < > \" ', or empty with no type). Headers: location, vary: Accept, set-cookie: sap-usercontext=sap-client%3D<client>; Path=/ (encode the client with encodeURIComponent rules). Status 307. The three 400s are ordinary responses (status 400, text/plain; charset=utf-8, the exact Node texts), not ZCX_OSD_ADT, because byte equality with Node wins over the exception-document rule here.
  Node tightening, the same slice, first: the Node route applies the same grammar before new URL(), so that both sides refuse 127.1, 0x7f000001, LOCALHOST. (still accepted, lower-cased), dot segments and backslashes identically. Without it, ABAP needs a WHATWG host and path parser (IPv4 shorthand and hex, IPv6 compression, percent-encode sets, dot-segment removal), which turns this family into an L.
Router rows (ZCL_OSD_ADT_ROUTER=>ROUTES), placed before the HOST catch-all and after nothing that could shadow them (port-map: explicit core/http/* before generic): GET /sap/bc/adt/core/http/reentranceticket -> ZCL_OSD_ADT_REENTRANCE; GET /sap/bc/adt/core/http/sessions -> ZCL_OSD_ADT_SESSIONS; DELETE /sap/bc/adt/core/http/sessions/:id -> ZCL_OSD_ADT_SESSIONS; GET /sap/public/bc/icf/logoff -> ZCL_OSD_ADT_LOGOFF (the first row outside c_base; the JS matchRoute already handles absolute patterns). HEAD falls back to these GET rows by the existing rule. None are per-type, so none are generated from the type table.
Handler/interface changes:
- ZIF_OSD_ADT_ROUTE=>TY_REQUEST gains a component `session TYPE zif_osd_adt_session=>ty_session`, which ANSWER fills after RESOLVE. Adding a component leaves existing routes untouched.
- ZCL_OSD_ADT_HANDLER gains CLASS-METHOD SESSION( ) RETURNING the ZIF_OSD_ADT_SESSION in use (go_session or the io_session of the current ANSWER), so a route can call END without creating its own instance with a possibly different TTL.
- ANSWER skips resolve, gate and stamp when the path is not under /sap/bc/adt (logoff). That is the BASE scope rule of port-map step 1.
- Set-Cookie lines from the route (sap-usercontext) are appended after the session's two, as Node's order is middleware first, route second.
ICF: zosd_adt.sicf.xml is unchanged. Do NOT ship a sicf for /sap/public/bc/icf/logoff to a system: it is SAP's standard logoff node and an abapGit import would collide with it. On a system ICF owns the session and logoff (ZIF_OSD_ADT_SESSION's own note), so the logoff row is Node-host only. Mount it in tools/adt-abap-front.mjs, with no sicf object, or with a .local/ dev-only one.
Host: no new STORE command and no new SYSTEM kind. Front changes as listed in host_dependencies. No continuation: nothing here publishes, rebuilds or waits.
Done for this family: the four Node handlers in tools/adt-facade.mjs are deleted, and Sessions.end is no longer called from the facade.

## Test plan

Extend test/adt-abap-diff.mjs (the pattern used for lock and versions): the same request goes to a Node-only facade and to the facade with the ABAP front up and AbapSessions. Compare status, content-type, content-length, etag, vary, location, every Set-Cookie line (getSetCookie(), order-sensitive), the presence of x-csrf-token and X-OSD-Generation, and the body bytes. Random and time values are masked by shape:
- the session id (24 lower hex) in cookies;
- the security id (32 upper hex), checked equal to sha256(cookie id) on each side separately;
- the token (24 base64url);
- the ticket (32 base64url);
- the defaulted _, checked as a digit string within [t0, t1] ms.

Cases:
(1) Sessions poll:
  - fresh (no cookie);
  - with the context cookie only, then the session cookie only;
  - the mixed cookies of test/adt-devloop.mjs:1336 (context names A, session names B: the poll must name A);
  - stateful versus stateless (cookie lines present or absent);
  - HEAD (no body, same length and ETag);
  - If-None-Match with the poll's ETag answers 304 on both sides.
(2) DELETE sessions/:id:
  - own security id, upper and lower case, then a follow-up write with the old token gets 403 Required, and a lock held by the session is released (reuse the 'session DELETE releases them too' sequence);
  - another session's security id: 200, nothing ended;
  - the raw 24-hex id: 200, no-op;
  - a percent-encoded id;
  - no token or a wrong token: 403 CSRF, byte-equal;
  - each 200 has no content-type, Content-Length 0 and no ETag.
(3) Logoff:
  - no cookie;
  - session cookie only;
  - context cookie only;
  - an empty context cookie plus a session cookie (the session cookie's session ends);
  - two cookies naming two sessions (only the context one ends; the other's lock survives, adt-devloop:1356);
  - an unknown id;
  - a stateful session holding a lock (the lock is free afterwards);
  - HEAD;
  - assert there is no Set-Cookie, no x-csrf-token and no X-OSD-Generation on both sides, and that no session row was created (ZOSD_ADT_SESS count unchanged).
(4) Reentrance:
  - the test/adt-facade.mjs:132 case (localhost with _=12345);
  - 127.0.0.1 and [::1];
  - upper-case HOST and SCHEME;
  - an explicit :80 and :0080;
  - https with :443;
  - an empty path;
  - an existing query with '+', %20, a key with no '=', '&&', a pre-existing _ and reentrance-ticket, a duplicate _;
  - a fragment;
  - _ repeated in the outer query (gives '1,2');
  - no _ (the time window);
  - Accept absent, text/html (the Eclipse browser string), */*, application/json (empty body, no type), 'text/plain;q=0.5, text/html' and 'text/html;q=0' (q-values and tie rules);
  - HEAD.
  Refusals: missing, empty, repeated or bracketed redirect-url; 'not a url'; https://example.invalid; 192.0.2.1; and the tightened set (127.1, 0x7f000001, [0:0::1], dot segments, a backslash, a stray %), each byte-equal after the Node tightening. Assert the sap-usercontext line is exactly 'sap-usercontext=sap-client%3D001; Path=/' and comes after the two session lines on a fresh request, that no response writes the session cookie twice, and that there is no ETag on the 307.

ABAP Unit, in testclasses next to each route, against ZCL_OSD_ADT_SESSION_MEM:
- SECURITY_ID against a fixed vector computed in Node;
- the query serializer and the grammar table;
- Accept negotiation;
- the logoff precedence;
- DELETE id matching.
Run the ABAP-FS compatibility suite (docs/abapfs-conformance.md, --start), whose logout is GET /sap/public/bc/icf/logoff and keepalive is compatibility/graph. The figure must be no worse than main's recorded 29 PASS / 2 FAIL / 16 MISSING. test/adt-abap-sessions.mjs (the adapter scenario uses both logoff and the session DELETE) and test/adt-devloop.mjs:1270-1360 must stay green.

Red proof, each checked failing before the fix is restored:
- replace SECURITY_ID with the un-hashed id: the poll diff fails;
- drop the to_upper in the DELETE match: the 'lower case' case fails;
- have logoff call RESOLVE: the 'no Set-Cookie' and 'no row created' asserts fail;
- reverse the logoff precedence: the two-cookie case fails;
- send the 307 through res.send in the front: the ETag diff fails;
- drop the Node tightening: the 127.1 case diverges (Node 307, ABAP 400).

## Risks

- Byte equality of reentranceticket rests on reproducing WHATWG URL plus URLSearchParams plus encodeurl plus express format/escapeHtml/cookie.serialize. Without tightening Node to the same strict grammar first, ABAP needs a WHATWG host and path parser (IPv4 shorthand and hex, IPv6 compression, dot segments, percent-encode sets), which is an L by itself. Tightening is a behaviour change on Node (it refuses 127.1, 0x7f000001 and dot-segment paths that it now accepts). Eclipse's listener URL, http://localhost:<port>/<path>, stays inside the grammar, but confirm against a STG_ADT_DUMP capture of a real cloud-project logon before landing.
- express qs semantics of req.query: a repeated _ gives an array and String() gives '1,2'; a bracketed name gives an object; '+' decodes to a space. The ABAP side sees the ICF form fields as cl_express_icf_shim fills them. Verify that the shim keeps duplicates, keeps their order and decodes '+' the same way, or read the raw query string from the request instead.
- Risk 5 (slice-3-front): the shim keeps one Set-Cookie line. A fresh reentrance has three (context, session, sap-usercontext). Under design B the front must replay ANSWER's own header list. On a real ICF, open-abap-core's set_cookie stub is the blocker (fork PR plus an ANORMALIES entry first).
- The front replays every typed non-empty answer with res.send, which adds an ETag. Node's res.redirect uses res.end with an explicit Content-Length and no ETag, so the front needs a 3xx rule (dell's file). Without it, the 307 diff fails on the ETag alone.
- Logoff is outside BASE. The handler must not RESOLVE there: a resolve would sweep, INSERT a fresh session and emit cookies, all invisible in a status-only test, so the diff must assert the absent headers and the unchanged row count. The front also needs a second mount. Shipping a sicf node for /sap/public/bc/icf/logoff to a real system would collide with SAP's standard logoff node, so it must stay Node-host only.
- DELETE sessions/:id ends the very session the same step just resolved and, if stateful, bound to its ENQ key. ZCL_OSD_ENQ_KERNEL=>END on the bound key relies on osd-enq-host's doomed/retire path. Test that the step ends cleanly, commits the row deletion, and that the stamped answer, which still carries the ended session's token and cookies as Node's does, is harmless.
- ABAP END on an arbitrary cookie value marks that ENQ key ended for good (#433), while Node's Sessions.end ignores unknown ids. The adapter already behaves like ABAP. Decide explicitly whether to guard on the 24-hex id shape and pin the choice with a unit case.
- The ticket randomness comes from cl_system_uuid. On a real kernel a UUID is not a CSPRNG (partly time-based), so a ticket is predictable there. That is harmless today, because the ticket is never validated and only the cookie carries the session, but say so in the class doc so no later route starts trusting it.
- Ordering: until front-up, the routes cannot read the middleware-chosen session id from ABAP without a new SYSTEM kind. Landing early would mean SESSION_ID and SESSION_END kinds and keeping two session stores, so this family should wait for front-up.
- inactivityTimeout 1800 is a literal in Node, independent of the TTL that AbapSessions passes (ttlMs). Keep it a literal for byte equality, and do not derive it from mv_ttl, or a test-configured TTL shows up as a diff.
