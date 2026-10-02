# write-includes (slice 4a): PUT source/main, PUT class include (both forms), POST class include create

- Recommendation: **port-to-abap**
- Effort: M
- Owner: stoker
- Depends on: slice 2 (LOCK/UNLOCK over ENQ, SYSTEM LOCK_HANDLE/LOCK_RELEASE): done, #432, versions port (ETag/sha256 precedent, URI_NAME to move): done, #442, slice 3 session impl + AbapSessions adapter (#464/#465): done; LOCK_OF must be answered in both Sessions and AbapSessions modes, host prerequisites inside this slice: STORE WRITE bound to the facade store, STORE READ EV_STATE 'empty', SYSTEM LOCK_OF, NOT dependent on slice 3B (front moves up) or 4b (activation)

## Routes

### PUT `/sap/bc/adt/{CLAS,INTF,PROG,INCL,DDLS,SRVD collection}/:name/source/main?lockHandle=` (adt-facade.mjs ~2257)

writeSource (facade.mjs ~2207), gates in this order. (1) mayWrite (~2177), before the body is read. entry = store.find(type, name). If entry.writable === false: 405 ExceptionResourceNoAccess '<TYPE> <NAME> is a library object and cannot be changed here', with the canonical type and name. Otherwise lock = req.adt.session.locks.get(String(req.query.lockHandle ?? '')). If there is no lock, or lock.type !== (entry?.type ?? type) or lock.name !== (entry?.name ?? upper(param)): 409 ExceptionResourceNotLocked, text 'no lock handle was given' (empty handle) or 'lock handle <h> does not hold this object in this session'. NOTE: an unknown object is NOT a 404 here. It falls through to the 409, because no handle can name it. (2) The body is read as Buffer and decoded with toString('utf8'): any charset in the Content-Type is ignored, invalid bytes become U+FFFD, and a BOM is kept. (3) For an include other than main, store.read validates it (404, see the include route). (4) If-Match: present (even when empty), not '*' after normalizedTag (trim, strip a leading W/, strip ONE leading and ONE trailing double quote, no comma split), and different from entityTag(current source) gives 412 ExceptionResourceIsModified 'source changed since it was opened; reload before saving'. The current source is read even when there is no If-Match. (5) stillHeld (~2196): session.locks.get(handle) and sessions.holds(session, handle, lock.type, lock.name), which is the handle map plus the ENQ holder through holderOf. Otherwise 409 ExceptionResourceNotLocked 'lock handle <h> was released before the source arrived'. (6) store.write(type, name, text, include): CRLF and CR become LF, the object is marked inactive (#460, $TMP #463), the file is written, and the registry is forgotten. (7) 200, Content-Type 'text/plain; charset=utf-8', empty body (Content-Length 0), ETag = the first 32 lower-case hex of sha256(UTF-8 of store.read(...).source AFTER the write), unquoted. Express adds no weak tag because ETag is already set. Refusals are application/xml; charset=utf-8 with Express's weak ETag. Errors go through answered(): NotFound 404 (and records an 'object' miss), ReadOnly 405, InvalidName 400, NotSupported 501, Conflict 409, else 500 org.open-steamgate.osd ExceptionInternalError with e.message.

### PUT `/sap/bc/adt/oo/classes/:name/includes/:include` (adt-facade.mjs ~2259)

CLAS only, the same writeSource with include = :include (Express-decoded, case-sensitive). An include that is not an own key of INCLUDES (definitions, implementations, macros, testclasses, plus 'main', which the write path takes as the main source) gives store.read NotFound: 404 ExceptionResourceNotFound 'CLAS <name as in the URL, NOT upper-cased> include <include> does not exist'. A known include with no file reads as empty, a PUT creates its file, and its ETag before the write is sha256('') = e3b0c44298fc1c149afbf4c8996fb924. For INTF, PROG, INCL, DDLS and SRVD no PUT include route exists, so the catch-all answers and those must stay HOST.

### PUT `/sap/bc/adt/oo/classes/:name/includes/:include/source/main` (adt-facade.mjs ~2260)

Identical to the previous row (same handler). No test covers it today (port-map A table: 'none: add one').

### POST `/sap/bc/adt/oo/classes/:name/includes?lockHandle=` (adt-facade.mjs ~2267)

Create a class include, CLAS only. The body is read FIRST (rawBody, utf8). Then mayWrite (405 or 409 as above, so without a handle the answer is 409 before any body validation). include = attribute(body, undefined, 'class:includeType'): the first match of the regex \bclass:includeType="([^"]*)" over the whole body, raw, with no entity decoding. If it is empty or missing: 400 ExceptionInvalidRequest 'the create body names no include type'. If it is 'main' or not an own key of INCLUDES (case-sensitive): 400 '<include> is not a class include'. Then current = store.read(type, name, include): 404 if the class is gone. If current.empty !== true (the include file exists, even an empty one): Conflict, 409 ExceptionResourceIsModified 'CLAS <CANONICAL NAME> include <include> already exists'. Then stillHeld (409 'released before the source arrived'). Then store.write(type, name, '', include). Answer: 201, header Location '/sap/bc/adt/oo/classes/' + encodeURIComponent(current.name.toLowerCase()) + '/includes/' + include, .end(): no Content-Type, no body, no ETag.

## Host dependencies

- STORE OBJECT (exists, tools/osd-store-destination.mjs #object, already reads the bound facade store): found, type, name (canonical), writable. Gives mayWrite's 405 and the canonical type and name the lock is compared with.
- STORE READ (exists, bound store): validates the include, gives the If-Match current source and the post-write source for the ETag. The ABAP must compose the 404 text from the URL param. EV_ERROR names the UPPER-cased name because the destination upper-cases IV_NAME before store.read (the versions route does the same).
- STORE READ, EXTEND: EV_STATE = 'empty' when read.empty === true (a known class include with no file). POST includes needs it: EV_SOURCE is '' both for a missing include and for an existing empty file, and EV_FILE for an empty include is the MAIN .clas.abap (read spreads entry.file), so neither field can tell them apart. Alternative: OBJECT extended with 'includes present' (store.classIncludes), which the port-map already plans. The READ flag is the exact predicate Node uses.
- STORE WRITE, EXTEND (blocking): #write uses this.store, the destination's own lazily opened store, and not the facade instance's bound store (systemCalls.getStore().store) that READ, HISTORY, REVISION and OBJECT use (port-map risk 12). An ABAP PUT behind a test-mounted facade would write into the process's default tree, or answer 'no object store here', while the following Node GET reads the facade's tree. Fix: add WRITE to the bound-store list and pass the store into #write(type, name, include, source, started, store). The editor screen (no binding) keeps its fallback. Semantics unchanged: inactive save, CRLF normalised, EV_ERROR = error.message verbatim (Node's 500 text is the same string).
- SYSTEM LOCK_OF, NEW (add to SYSTEM_KINDS in osd-store-destination.mjs and answer it in abapSession() in tools/adt-enq.mjs). IV_NAME = the handle. Answer: {} when req.adt.session.locks has no such handle, else {type, name, held} with held = await sessions.holds(session, handle, lock.type, lock.name). It is read-only, the twin of LOCK_RELEASE. One kind serves both checks: mayWrite reads type and name, stillHeld reads held. It works unchanged for Sessions and for AbapSessions, because both implement holds(), so ABAP gets exactly Node's semantics, including holderOf's ending of expired owners. Like the other slice-2 kinds it goes when slice 3B binds the ABAP session: then zcl_osd_adt_host=>lock_of becomes io_session->holds plus an ENQ probe (see abap_design).
- SYSTEM SESSION, IDENTITY: not needed. CSRF, cookies and X-OSD-Generation stay with the Node front in the mixed phase.
- No new STORE command, and no continuation. store.write is a synchronous file write plus the inactive marker and #forget() (milliseconds). The watcher's warm reparse is scheduled outside the step, and activation and publish are slice 4b. So the write may run inside the dialog step without breaking the work-process FIFO.

## Rationale

These are four registrations (nine router rows) of plain request/response work: object lookup, handle check, If-Match, a fast file write, and a re-read for the ETag. No build, no generation swap and no wait, so nothing needs a host continuation, and the save stays inactive by store semantics (#460/#463). Every host fact already has a seam (OBJECT, READ, WRITE), except the session's handle map. LOCK reaches that map through SYSTEM kinds today, so one more read-only kind (LOCK_OF) keeps writes on the same footing as LOCK/UNLOCK. Two host changes are real prerequisites, not polish: WRITE has to use the bound facade store, and READ has to expose `empty`. Without them the diff test writes to the wrong tree, or cannot do POST includes.

Critique of .local/codex-queue/adtwrite.md:
(a) 'the object exists: 404 as Node' is wrong. mayWrite never 404s. An unknown object answers 409 ExceptionResourceNotLocked, 'no lock handle was given' or 'lock handle X does not hold this object in this session'. A test written to the spec would fail against the reference. 404 occurs only for an unknown CLAS include (or a deletion race), and its text uses the URL's name casing.
(b) POST includes is missing entirely. It has its own order: body first, 400 texts, 409 Conflict on a present include, an empty write, and 201 with Location and no body or type.
(c) 'stillHeld = the ENQ check zcl_osd_adt_lock / holds uses' does not exist. The lock route never checks a holder; ZIF_OSD_ADT_SESSION~HOLDS checks only the handle row ('whether the lock server still holds it is the caller's second question'), and mayWrite's handle lookup has no SYSTEM kind at all. Use the host's sessions.holds through the new LOCK_OF kind so both session implementations match.
(d) The WRITE store binding (above) is not mentioned and blocks the diff test.
(e) Decoding: cl_abap_conv_in_ce in open-abap-core is fatal by default (TextDecoder fatal unless ignore_cerr = 'X'), and Node turns invalid bytes into U+FFFD. Create the converter with ignore_cerr = abap_true. The BOM is kept on both sides (ignoreBOM: true). A real system replaces with '#': ANORMALIES entry.
(f) If-Match is not If-None-Match. Versions' ENTITY splits on commas and removes every quote. normalizedTag trims, strips one W/ and only one quote at each end, and never splits. A present-but-empty If-Match is a 412. Two If-Match headers reach Node joined as 'a, b' (so 412), and the ABAP must join its duplicate rows the same way.
(g) test/adt-abap-diff.mjs slice-2 asserts that byAbap holds only 'ABAP POST' lines without '/source/'. That assertion must change in the same commit, or the existing sequence 'lock, a stateless read, the PUT, UNLOCK, and a PUT after it' turns red.

## ABAP design

Router (ZCL_OSD_ADT_ROUTER=>ROUTES): one new loop over ZCL_OSD_ADT_TYPES=>SOURCES( ) (CLAS, INTF, PROG, INCL, DDLS, SRVD; not DEVC), placed before the catch-all:
  PUT  {c}/:name/source/main -> ZCL_OSD_ADT_WRITE (6 rows)
  IF type = CLAS:
    PUT  {c}/:name/includes/:include
    PUT  {c}/:name/includes/:include/source/main
    POST {c}/:name/includes
  That is 9 rows. The POST row cannot shadow LOCK's POST {c}/:name because the segment counts differ. The matcher test in adt-abap-diff ('front matcher and MATCH pick the same row') gains these patterns.

ZCL_OSD_ADT_TYPES: add CLASS_INCLUDE( iv_include ) RETURNING abap_bool, a case-sensitive membership test over definitions, implementations, macros and testclasses (main excluded). The port-map type table plans INCLUDES there.

ZCL_OSD_ADT_URI: move ZCL_OSD_ADT_VERSIONS=>URI_NAME here as ENCODE_COMPONENT (encodeURIComponent after lower-casing, upper-case hex) and have versions call it.

New ZCL_OSD_ADT_ENTITY (or class-methods on ZCL_OSD_ADT_XML):
  - TAG( iv_body ): sha256 via cl_abap_message_digest=>calculate_hash_for_char, lower-case, first 32 characters.
  - NORMALIZED( iv_value ): condense the leading and trailing blanks only; if it starts with 'W/' cut 2; if it starts with '"' cut 1; if it ends with '"' cut 1.
  Refactoring versions' ENTITY to call TAG is optional.

ZCL_OSD_ADT_HOST additions (the only place that knows the seam):
  - LOCK_OF( iv_handle ) RETURNING ty_lock {found, type, name, held}: SYSTEM LOCK_OF.
  - SOURCE( iv_type iv_name iv_include ) RETURNING ty_source {source, name (ET_OBJECT[1]-NAME, canonical), empty (EV_STATE = 'empty'), error}: STORE READ. Unlike OBJECT, it does not raise on EV_ERROR, so the route can compose Node's 404 text.
  - WRITE( iv_type iv_name iv_include iv_source ) RAISING zcx_osd_adt: STORE WRITE. A non-empty EV_ERROR raises zcx_osd_adt=>internal( EV_ERROR ) VERBATIM (no 'WRITE x:' prefix, unlike OBJECT/SYSTEM), so the 500 text equals Node's e.message. A communication failure keeps the 'no object store here: ...' text.

ZCL_OSD_ADT_WRITE implementing ZIF_OSD_ADT_ROUTE. HANDLE: the type comes from TYPE_OF_PATH, plus the params name and include; then CASE method: PUT -> PUT_SOURCE, POST -> CREATE_INCLUDE. Short methods for abaplint, 7.02 syntax, ASCII only:
  - TARGET( ): OBJECT( type, name ), then the handle = query field 'lockHandle' (exact name, first row).
  - MAY_WRITE( is_object, iv_handle ):
    - found AND writable = false: read_only( '<T> <N> is a library object and cannot be changed here' ) (405 ExceptionResourceNoAccess, the existing factory).
    - Otherwise LOCK_OF( handle ). Compare against type = found ? object-type : route type, and name = found ? object-name : to_upper( param ).
    - Not found or different: a new factory zcx_osd_adt=>not_locked( text ), 409 ExceptionResourceNotLocked, namespace com.sap.adt, with the two texts.
  - CHECK_INCLUDE: include <> 'main' -> SOURCE( ). On an error: not_found( |{ type } { param name } include { include } does not exist| ) when the error contains ' include ', else |{ type } { param name } does not exist| (the versions precedent).
  - IF_MATCH: read the header field 'if-match' case-insensitively, joining duplicate rows with ', '. Present (even empty) AND NORMALIZED <> '*' AND NORMALIZED <> TAG( current ) -> a new factory zcx_osd_adt=>modified( text ), 412 ExceptionResourceIsModified. Do NOT reuse CONFLICT, which is 409.
  - STILL_HELD: LOCK_OF( handle ) again; if not found or held = false, not_locked( 'lock handle <h> was released before the source arrived' ).
  - DECODE( xstring ): cl_abap_conv_in_ce=>create( encoding = 'UTF-8' ignore_cerr = abap_true ), convert.
  - PUT_SOURCE: TARGET, MAY_WRITE, DECODE, CHECK_INCLUDE, SOURCE( ) (current; the error maps to 404 as above; read even without If-Match, as Node does), IF_MATCH, STILL_HELD, WRITE, SOURCE( ) again. Answer: 200, 'text/plain; charset=utf-8', header ETag = TAG, body ''.
  - CREATE_INCLUDE: DECODE (body first, as Node does), TARGET, MAY_WRITE. Then FIND FIRST OCCURRENCE OF REGEX `class:includeType="([^"]*)"` with a manual word-boundary check of the character before it (ABAP 7.02 POSIX has no reliable \b). Empty -> invalid_request( 'the create body names no include type' ); 'main' or not CLASS_INCLUDE -> invalid_request( '<inc> is not a class include' ). Then SOURCE( ) (404 'CLAS <param> does not exist'), and empty = false -> conflict( |CLAS { canonical name } include { inc } already exists| ). Then STILL_HELD, WRITE( source = `` ), which passes IV_SOURCE explicitly so given() is defined and the 'WRITE without IV_SOURCE' refusal is not hit. Answer: 201, content_type INITIAL, body '', header Location = '/sap/bc/adt/oo/classes/' && ENCODE_COMPONENT( canonical name ) && '/includes/' && inc. adt-abap-front replays an untyped empty answer with res.end(), as Node's .end().

Later, after slice 3B: ZCL_OSD_ADT_HOST=>LOCK_OF becomes the session's own lookup. The handler exposes the resolved session (a request context set in ANSWER: io_session plus its id), the type and name come from ZOSD_ADT_SHDL through HOLDS/HANDLES, and `held` is an ENQ probe. That is ENQUEUE_EZOSD_ADT_OBJ mode X _SCOPE 1 in the bound context: MC 602 means it is ours; subrc 0 means it was gone, so DEQUEUE and answer false; 601 means another session has it. The cost is the context accessor plus the probe's take-then-give-back side effect. Only this one method changes; the route does not.

## Test plan

New describe 'slice 4a: writes, against the Node façade' in test/adt-abap-diff.mjs. It reuses slice 2's tree(), logon, send, lock and unlock, and mounts node = mount({store: tree()}) and ported = mount(withAbap({store: tree()})) with identical content. Every sequence returns {status, type, length, etag, body, location}, followed by a GET source/main (status, etag, body) and a READ of the active copy where relevant. A STATUSES table pins the reference so two sides failing alike cannot pass. UUID handles are masked in bodies and URLs. Refusal bodies that carry a handle get their weak ETag verified (weakTag) and then masked, as slice 2 does.

Sequences:
1. LOCK, then PUT with the handle: 200, text/plain; charset=utf-8, length 0, ETag = tag. The GET returns the new source with the SAME ETag. Then UNLOCK and a PUT after it: 409 'does not hold'.
2. PUT without lockHandle: 409 'no lock handle was given'. With another session's handle: 409 'does not hold...', masked. With the handle of another object (ZCL_OSD_LK_DOOMED): 409.
3. An unknown object (ZCL_OSD_LK_NONE) with and without a handle: 409, NOT 404. This pins the spec's correction.
4. A library object: OBJECT writable=false. This needs a lib root in tree(), so add a libs fixture; the LOCK gives an empty handle and the PUT gives 405 with Node's text.
5. If-Match: a matching tag gives 200; '*' gives 200; W/"<tag>" gives 200; a stale tag gives 412; an empty If-Match header gives 412; '"a", "b"' gives 412; two If-Match header lines (raw http.request, since fetch joins them) give 412 on both sides.
6. stillHeld red-able case: LOCK, then remove the ENQ row directly (osd-enq locks().release for that owner) while the handle stays in the session map, then PUT. Node answers 409 'lock handle <h> was released before the source arrived'; ABAP must match.
7. After the holder's logoff, and after the session DELETE: 409.
8. CLAS includes: PUT includes/testclasses (no file yet, so the empty-include path) through both forms (includes/:include and includes/:include/source/main). GET includes/testclasses/source/main shows the same ETag. An unknown include 'bogus' gives 404 'CLAS zcl_osd_lk include bogus does not exist' with the URL in lower case, so the text's casing is pinned. 'TestClasses' (case) gives 404. PUT oo/interfaces/x/includes/y is still HOST-served, and the served log says HOST.
9. POST includes:
   - no handle: 409 (before body validation);
   - a body without the attribute: 400 'the create body names no include type';
   - includeType="main" and includeType="locals": 400 '<x> is not a class include';
   - testclasses on a class without it: 201, Location '/sap/bc/adt/oo/classes/zcl_osd_lk/includes/testclasses', no Content-Type, no ETag, empty body;
   - the same again: 409 ExceptionResourceIsModified 'CLAS ZCL_OSD_LK include testclasses already exists';
   - a class name with '/' or non-ASCII, if the tree allows one, for encodeURIComponent.
10. Bytes:
    - a non-ASCII source (umlauts, an emoji, i.e. a non-BMP character) round trips with an equal ETag;
    - a CRLF body is stored as LF, and the ETag is the LF tag on both sides;
    - a leading BOM is kept;
    - invalid UTF-8 bytes (0xff) give U+FFFD on both sides, which is the red check for missing ignore_cerr;
    - Content-Type 'text/plain; charset=iso-8859-1' is ignored on both;
    - an empty body writes ''.
11. Inactive semantics: after PUT, the active copy is unchanged (the store's inactive marker / inactiveObjects() lists the object), asserted the way #460's tests assert it, on both sides.

served assertions:
- every PUT and the POST includes are 'ABAP ...';
- PUT on a non-CLAS include path is 'HOST';
- update the slice-2 'byAbap' assertion to allow PUT '/source/'.

Router: extend the matcher-equality test with the 9 new patterns, including 'PUT .../includes/x/source/main' vs 'PUT .../source/main'.

ABAP Unit (optional, small): ZCL_OSD_ADT_ENTITY NORMALIZED cases ('W/"x"', '"x', ' x ', '"a", "b"') and TAG of '' = e3b0c44298fc1c149afbf4c8996fb924.

Red proofs, for the commit message:
- (1) treat LOCK_OF held as always true in STILL_HELD: sequence 6 goes red (200 vs 409);
- (2) create the decoder without ignore_cerr: the invalid-byte case goes red (500 vs 200);
- (3) compute the ETag from the request body instead of the re-read: the CRLF case goes red.
Revert each.

Regression, under flock /tmp/osd-heavy.lock with STG_PORT set:
- transpile, lint (no src/adt issue);
- npx mocha test/adt-abap-diff.mjs test/adt-abap-session.mjs test/adt-abap-sessions.mjs test/adt-session.mjs test/adt-facade.mjs test/adt-devloop.mjs test/adt-editor.mjs in one process;
- test/adt-abapfs-conformance.mjs --start, not worse than the 30/1/16 recorded in docs/abapfs-conformance.md;
- node tools/osd-size-budget.mjs --changed origin/main;
- the editor screen's WRITE (webgui) still works with no binding, covered by its existing test.

## Risks

- The release-during-body race cannot be reproduced byte-equal. adt-abap-front awaits the whole body before the step, so an UNLOCK that lands while a slow PUT body uploads is seen by MAY_WRITE ('does not hold this object in this session'), whereas Node passes mayWrite and fails in stillHeld ('was released before the source arrived'). Same status, same type id, different text. Document it as an accepted Node-vs-ABAP divergence (port-map item 7) and keep it out of the byte diff, or test it only for the status.
- The WRITE store-binding change touches a shared seam. The webgui editor relies on the unbound fallback, and a bound call from another facade instance must never write into the process default tree. Test both.
- The miss registry: a 404 that ABAP answers (unknown include) is not recorded as an 'object' miss in facade.missed, so /osd/not-served differs in the mixed phase. It is not on the wire. Versions has the same gap; fix it once in the front, not per route.
- Duplicate query parameters: Node's qs turns lockHandle=a&lockHandle=b into 'a,b' (visible in the 409 text), while ABAP's field() takes the first. LOCK already has this divergence. Leave it out of the diff or note it.
- calculate_hash_for_char in open-abap-core does `await import("crypto")` (marked 'doesnt work in browser'). The write route, like versions, cannot run in the service-worker preview. Fine as long as the preview has no ADT front, but it is a trap if the preview gains one.
- Real-system parity: on a system, ignore_cerr replaces invalid bytes with '#', not U+FFFD, and ICF may decode bodies by charset. The ABAP reads the raw xstring, and ANORMALIES gets an entry before any workaround.
- \b is missing from 7.02 POSIX regex. The hand-written boundary check must match JS `\b` for the first occurrence (for example 'xclass:includeType' must NOT match, while ' class:includeType' and '<class:abapClassInclude class:includeType' must).
- Session coupling: LOCK_OF is answered from req.adt.session, a request snapshot under AbapSessions. That is the same snapshot Node's mayWrite uses, so it is equal now. When slice 3B moves the front up, the SYSTEM kinds disappear and LOCK_OF must be re-implemented over ZIF_OSD_ADT_SESSION plus an ENQ probe. Keep that behind ZCL_OSD_ADT_HOST=>LOCK_OF so only one method changes.
- Host paths in 500 texts (for example ENOENT on a vanished main file) differ between the two temp trees, so keep such cases out of the byte diff.
