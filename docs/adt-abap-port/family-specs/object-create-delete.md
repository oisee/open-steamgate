# object-create-delete

- Recommendation: **port-to-abap**
- Effort: M
- Owner: stoker
- Depends on: front-up (feat/adt-front-up, slice 3 option B: the session resolved in ABAP and handed to routes; ENQ binding by RESOLVE), slice 2 LOCK/UNLOCK (done: ZCL_OSD_ADT_LOCK, whose enqueue/dequeue gets lifted into ZCL_OSD_ADT_ENQ), ZOSD_STORE IV_JSON parameter (lands in this slice, shared later with 4a/4b and group B's PACKAGE)

## Routes

### POST `/sap/bc/adt/{collection} for CLAS oo/classes, INTF oo/interfaces, PROG programs/programs, DDLS ddic/ddl/sources, SRVD ddic/srvd/sources, INCL programs/includes, DEVC packages (7 registrations)` (adt-facade.mjs ~2077)

Reads the raw body as UTF-8 (rawBody, before answer()). name = the first regex match of \badtcore:name="([^"]*)" anywhere in the body, with no XML unescaping. If it is missing or empty, the answer is 400 application/xml; charset=utf-8, exceptionDocument(ExceptionInvalidRequest, "the create body names no object"). The package is read the same way. For DEVC it comes from the first <pack:superPackage\b[^>]*> tag (adtcore:name). For the other types it comes from the first <adtcore:packageRef\b[^>]*> tag, using adtcore:name, else adtcore:packageName. A missing package is "". description = the first adtcore:description anywhere, else "", raw. The route then calls store.create(type, name, {description, package, author: req.adt.session.user}), which does the following: uppercases the name; runs checkName (InvalidName, 400); answers Conflict (409 ExceptionResourceIsModified, "T N already exists") if the object is in the index or its file is on disk; answers NotFound (404, "DEVC <pkg> does not exist" or "DEVC (no package named) does not exist") for a missing package; answers ReadOnly (405 ExceptionResourceNoAccess, "DEVC P comes from a library and cannot be changed here") for a library package; answers NotSupported (501 ExceptionResourceNoAccess) for SRVD ("creating an object of type SRVD is not supported") and for a DEVC that does not continue its parent's name outside $TMP ("a package under P is named P_<FOLDER>; N is not supported"). On success it writes the abapGit pair from CREATABLE templates through writeChecked (temp file + rename), creating $TMP's folder and package.devc.xml if absent (#463). In $TMP, a DEVC of any $-name is accepted, and the author (upper case, with a createdAt ISO timestamp) is recorded in the authors file. For non-DEVC types it marks the object inactive first (#460). It then calls #forget(). Success: 201, Location: /sap/bc/adt/<collection>/<encodeURIComponent(made.name.toLowerCase())> (so $ becomes %24 and / becomes %2F), res.end(): no content type, no body, Content-Length 0, no ETag. Any other throw is 500 ExceptionInternalError in namespace org.open-steamgate.osd with String(e.message). The query string (sap-client etc.) is ignored. CSRF is gated before the route.

### DELETE `/sap/bc/adt/{collection}/:name for the same 7 types` (adt-facade.mjs ~2099)

name = decodeURIComponent(req.params.name). This is a second decode after Express's own, so %2524 becomes $, and a malformed second decode throws a URIError, which answers 500 ExceptionInternalError (osd namespace) "URI malformed". With AbapSessions (always under the ABAP front) the route calls sessions.deleteObject(session, type, name, store), which runs in one dialog step: (front-up branch) a session that is no longer alive gives {ended}, answered by refuseToken (403 text/plain "CSRF token validation failed", x-csrf-token: Required); holder = the ENQ holder of (type, store.find(type,name)?.name ?? name), where a dead holder counts as no holder and is ended on the way; a holder from another session gives 403 application/xml lockedByOtherDocument(holder.session.user, String(name).toUpperCase()), which is ExceptionResourceNoAccess with T100 EU 510, V1 = user and V2 = the raw name upper-cased; otherwise store.delete(type,name), and if this session held the lock its handle is forgotten (release_handle) and its ENQ entry dropped. store.delete answers as follows: NotFound gives 404 "T <name as given, NOT upper-cased> does not exist"; ReadOnly gives 405; DEVC $TMP gives 501 "deleting $TMP, the local package every system has is not supported"; a non-empty package gives 501 "deleting P while it still holds N object(s) is not supported". Otherwise store.delete unlinks the source, the abapGit .xml header and, for CLAS, all include files; drops the index entry, the inactive mark and the active copy, and the $TMP author record. Success: 200, res.end(): untyped, empty, Content-Length 0. A legacy Node Sessions path (holderOf / store.delete / release) exists only for OSD_ADT=js.

## Host dependencies

- STORE OBJECT (exists, tools/osd-store-destination.mjs #object): the canonical name for the ENQ key of DELETE ({found,type,name,writable}). It already reads the facade-bound store (withSystem {store}).
- STORE CREATE (NEW). Inputs: IV_TYPE, IV_NAME, plus IV_JSON = {"description":"...","package":"...","author":"..."}. It calls store.create(type, name, options). Success: EV_JSON {"type":T,"name":N}. A store refusal is EV_JSON {"error":{"code":"NOT_FOUND|CONFLICT|READ_ONLY|NOT_SUPPORTED|INVALID_NAME","message":e.message}} with EV_ERROR empty. Any other throw is EV_ERROR = String(e.message), with no prefix, because the 500 text must be byte-equal. It must use the per-call bound store (systemCalls.getStore().store), like READ/HISTORY/REVISION/OBJECT, not this.#open() (port-map risk 12).
- STORE DELETE (NEW). Inputs: IV_TYPE, IV_NAME. It calls store.delete(type, name). Success: EV_JSON {"type","name"}. Errors are coded the same way as CREATE. It uses the bound store.
- ZOSD_STORE signature (NEW parameter): IV_JSON TYPE string, optional. It goes into src/webgui/zosd_store.fugr.xml and into the Go host's key list (tools/gogen/go/abap/store.go:36). Port-map's later commands (PACKAGE, UNIT, JOB) need the same structured input, so it is a one-time cost. The rejected alternative is to smuggle JSON through IV_SOURCE.
- ENQ: ENQUEUE_/DEQUEUE_EZOSD_ADT_OBJ, mode X, _SCOPE 1, in the step's ENQ session (bound to the ADT session by RESOLVE, front-up). Exists. It is already used by ZCL_OSD_ADT_LOCK, whose enqueue/try_enqueue/dequeue should be lifted into a shared ZCL_OSD_ADT_ENQ (port-map table: lock, holder_of, release).
- SYSTEM LOCK_HOLDER (exists): when a 601 holder is dead, it is ended and the enqueue is retried, exactly as ZCL_OSD_ADT_LOCK=>ENQUEUE does.
- Session in the route (NEW, ABAP side, no host): ZIF_OSD_ADT_ROUTE=>TY_REQUEST gains session TYPE zif_osd_adt_session=>ty_session (id, user, stateful), plus sessions TYPE REF TO zif_osd_adt_session, both filled by ZCL_OSD_ADT_HANDLER=>ANSWER after RESOLVE. CREATE needs session-user for the $TMP author. DELETE needs id to release its own handle.
- ZIF_OSD_ADT_SESSION~RELEASE_OBJECT (NEW interface method): iv_id, iv_type, iv_name. It forgets the session's handle for that object, if there is one, using the existing private FIND_HANDLE. About 15 lines in ZCL_OSD_ADT_SESSION. Fallback if front-up has not landed: a new SYSTEM kind LOCK_DROP (IV_NAME "TYPE NAME"), which tools/adt-enq.mjs abapSession answers by finding the handle in session.locks and calling sessions.forget. The no-new-kind hack (LOCK_HANDLE then LOCK_RELEASE) is rejected, because it adopts a handle only to drop it.
- Host-side file effects that stay in the store (no new command): the $TMP folder and package.devc.xml (ensureTmp), the authors file (recordAuthor/forgetAuthor, which has a createdAt timestamp), the inactive set (#markInactive/#saveInactive), and the active copies. The watcher then invalidates the index asynchronously, after the step.

## Rationale

Both routes are a short protocol layer (body attribute parsing, refusal mapping, the lock and holder rule, Location encoding) over two store mutations. The mutations are cheap synchronous file writes: a few small files, an inactive-set write and an index #forget. Nothing rebuilds, swaps a generation or waits, so they can run inside the ABAP step through two new STORE commands without hurting the work-process FIFO. The watcher's re-index and the dev loop already run asynchronously, after the step. No continuation is needed. The lock rule on DELETE is actually better in ABAP than in Node. Node needed a separate dialog step (AbapSessions.deleteObject) plus the front-up {ended} patch to close the gap between the front's verdict and the delete. In ABAP, RESOLVE, the holder probe (ENQUEUE in the same ENQ session that LOCK uses), the store delete and the handle release are all one step, so the race does not exist. The holder user for the 403 comes from the lock server's sy-msgv1, exactly as ZCL_OSD_ADT_LOCK already answers EU 510 byte-equal (Gate 1). The $TMP rules (#463) and the inactive state (#460) live entirely in ObjectStore.create/delete, so calling them through STORE keeps one implementation of those rules instead of a second one. On a system with no STORE destination the routes answer the existing \"no host here\" 500, as the other ported routes do.

## ABAP design

Route classes: ZCL_OSD_ADT_OBJ_CREATE (POST collection) and ZCL_OSD_ADT_OBJ_DELETE (DELETE collection/:name). Both implement ZIF_OSD_ADT_ROUTE.

Router rows (generated, never written by hand): in ZCL_OSD_ADT_ROUTER=>ROUTES, LOOP AT zcl_osd_adt_types=>lockable( ), which is the 6 SOURCE_TYPES in TYPES order plus DEVC packages, exactly the facade's [...SOURCE_TYPES, DEVC] loop. For each type, add POST c_base/<collection> -> ZCL_OSD_ADT_OBJ_CREATE and DELETE c_base/<collection>/:name -> ZCL_OSD_ADT_OBJ_DELETE, before the catch-all. That is 14 registrations. They do not collide with POST /:name (LOCK), because the segment counts differ.

The create route must know its type although its path has no :name. ZCL_OSD_ADT_TYPES=>TYPE_OF_PATH strips the last segment, so add TYPE_OF_COLLECTION( path ). It drops one trailing slash, compares case-insensitively, and handles that ABAP SPLIT drops a trailing empty segment. Alternatively, give ty_route a type field that dispatch hands over as the param `type`. Pick one; the param is cleaner and needs no re-derivation.

ZCL_OSD_ADT_OBJ_CREATE=>HANDLE:
(1) body = zcl_osd_adt_uri=>utf8( is_request-body ).
(2) ATTRIBUTE( iv_xml iv_element iv_name ). JS semantics: the scope is the whole body, or the first match of `<ELEMENT` followed by a non-word character and then [^>]*>. Inside the scope, take the FIRST match of (^|[^A-Za-z0-9_])NAME="([^"]*)". This form replaces \b, so it is portable between POSIX ABAP regex and the transpiler's JS translation. No unescaping.
(3) An initial name raises zcx_osd_adt=>invalid_request( `the create body names no object` ).
(4) The package is pack:superPackage/adtcore:name for DEVC. Otherwise it is adtcore:packageRef adtcore:name, and if that is missing (not merely empty: the JS ?? distinguishes undefined from "") adtcore:packageName. The default is ``.
(5) ZCL_OSD_ADT_HOST=>CREATE( iv_type iv_name iv_description iv_package iv_author = is_request-session-user ) returns the made name. Refusal codes map to the existing factories: NOT_FOUND to not_found, CONFLICT to conflict, READ_ONLY to read_only, NOT_SUPPORTED to not_supported, INVALID_NAME to invalid_request (400 ExceptionInvalidRequest, the same as Node's InvalidName). The message passes through verbatim. EV_ERROR goes to internal( message ) with no prefix.
(6) Response: status 201, content_type initial, headers Location = c_base && `/` && collection && `/` && zcl_osd_adt_uri=>encode_component( to_lower( made_name ) ), body initial. Replay then uses res.end(), which matches Node. ENCODE_COMPONENT is new in ZCL_OSD_ADT_URI. It keeps A-Z a-z 0-9 - _ . ! ~ * ' ( ) and writes every other byte of the UTF-8 form as %XX with upper-case hex, which is encodeURIComponent.

ZCL_OSD_ADT_OBJ_DELETE=>HANDLE:
(1) name = the param already decoded once by dispatch, then decoded AGAIN (Node's decodeURIComponent on req.params). A second-decode failure must answer internal( `URI malformed` ) (500, osd namespace), not ZCL_OSD_ADT_URI's 400. That means a DECODE_COMPONENT variant that reports failure instead of raising 400.
(2) type = TYPE_OF_PATH( path ).
(3) obj = HOST=>OBJECT( type, name ). The ENQ key name is obj-name if found, else to_upper( name ). Node uses the raw name when not found, but the ENQ argument is upper-cased anyway (adt-enq argument()).
(4) Holder probe, through ZCL_OSD_ADT_ENQ (lifted from ZCL_OSD_ADT_LOCK): try_enqueue. On 601, if HOLDER_ALIVE is false, retry once. Still 601 raises locked_by_other( iv_user = sy-msgv1 iv_object = to_upper( name ) ). That is the raw decoded name upper-cased, not obj-name. Result 0 means "probe taken". 602 means "own lock". Other subrc raises internal.
(5) TRY. HOST=>DELETE( type, name ) with the raw name, so NotFound says the name in the URL's case. CLEANUP / CATCH: if the probe was taken, DEQUEUE, then RAISE again.
(6) After success: if the probe was taken, DEQUEUE. If it was the own lock (602), is_request-sessions->release_object( iv_id = is_request-session-id iv_type = type iv_name = obj-name ) and DEQUEUE.
(7) 200, content_type initial, empty body.

Asked of the host: OBJECT, CREATE (new), DELETE (new), SYSTEM LOCK_HOLDER. Nothing else. No continuation, because no generation swap or long wait happens in the step.

ZCL_OSD_ADT_HOST gains CREATE and DELETE wrappers. They parse EV_JSON with zcl_ajson and turn /error/code into the factory, so a route never parses JSON itself. That keeps the \"refusal = ZCX factories\" rule in one place, and the same wrapper serves slice 4a's WRITE later.

Node side: osd-store-destination.mjs gets COMMANDS += CREATE, DELETE. CREATE and DELETE are added to the bound-store list. CAPABILITIES gets them only if the editor screen should show them; the recommendation is no, because CAPABILITIES drives screen buttons. IV_JSON is read via givenText.

Facade: after the rows land, the Node routes stay for OSD_ADT=js only. Nothing in them changes.

## Test plan

Harness (test/adt-abap-diff.mjs pattern, extended for writes): the two adtRouters cannot share one store, because a create would conflict on the second mode. Each case runs the same request sequence against two fresh copies of one fixture root, one plain Node and one with the ABAP front. Each copy has its own ObjectStore, bound per facade via withSystem {store}. The test compares:
(a) status, content-type (absent on both successes), Content-Length, ETag (absent), Location, and body bytes;
(b) the file tree afterwards: every written file byte for byte; the inactive set; the $TMP authors file with createdAt masked.
The front's served() must report ABAP for every case. Add the 14 rows to PORTED. Strip X-OSD-Served-By. X-OSD-Generation is set by the middleware before the front, so it is the same in both modes and can be compared.

CREATE cases:
1. CLAS, INTF, PROG, INCL, DDLS into a fixture package: 201, and the Location of each. Files come from CREATABLE, with the inactive mark.
2. DEVC $ZOSD_TEST_X under $ZOSD_TEST: Location %24zosd_test_x (the vsp body with ?sap-client=001&sap-language=EN, stateless header).
3. CLAS into $TMP on a root where local/tmp does not exist yet: the $TMP folder, its package.devc.xml and the author (the Basic user, upper case) are recorded.
4. DEVC $ANYNAME under $TMP (#463: any $ name).
5. SRVD: 501 \"creating an object of type SRVD is not supported\".
6. A body with no adtcore:name, and one with adtcore:name=\"\": 400 \"the create body names no object\".
7. Package $NOPE: 404. No packageRef: 404 \"DEVC (no package named) does not exist\".
8. A library package: 405.
9. A duplicate create: 409 ExceptionResourceIsModified. Also a file on disk that is not yet indexed: 409.
10. An invalid name (ZCL-BAD, and a lower-case name that is fine because it is upper-cased first): 400 with the quoted nameProblem text, which checks that \" is escaped as &quot;.
11. DEVC Z_OTHER under $ZOSD_TEST: 501 with the P_<FOLDER> text.
12. The description holds \"a &amp; b <c>\" (raw, not unescaped) and Cyrillic text: header file bytes are equal.
13. Only adtcore:packageName and no adtcore:name on packageRef: the fallback is used.
14. A namespaced /OSD/CL_X: Location %2Fosd%2Fcl_x (or 400 if checkName refuses it; either way both modes must agree).
15. The path /SAP/BC/ADT/OO/Classes/ (case plus a trailing slash) is served by ABAP.
16. A root element with attributes in another order (adtcore:name after packageRef): proves that the first match wins in both modes.

DELETE cases:
1. An unlocked DDLS: 200 empty. The .asddls and .ddls.xml are gone, and so are the inactive entry and the active copy.
2. A second delete: 404 \"DDLS zosd_made_cds does not exist\" (lower case kept).
3. A CLAS with includes: every include file is gone.
4. A foreign holder (OTHERDEV, stateful, locked): 403 EU 510 with V1 OTHERDEV and V2 the upper-cased name; the files are still there.
5. The holder deletes (the own-lock path): 200. After that, the old handle's UNLOCK is a no-op 200, a re-create by the same name plus LOCK by another session succeeds (the ENQ entry is gone), and the session's handle row is gone from ZOSD_ADT_SHDL.
6. A dead holder (logged-off session whose ENQ survived, or one expired by the set_clock test clock): 200.
7. A library object: 405.
8. DEVC $TMP: 501.
9. A non-empty package: 501 with the count. An emptied package: 200.
10. An object in $TMP: its author record is gone.
11. %2524ZOSD_X decodes twice to $ZOSD_X. %25zz gives 500 \"URI malformed\".
12. Without a CSRF token: 403 (the existing gate).

Red proof:
(i) Add the rows to PORTED before the route classes exist: every case fails the served-by-ABAP assertion.
(ii) Mutants, each checked failing: drop the DEQUEUE after a probe (DELETE case 5's LOCK by another session gets 403); decode only once (case 11); use obj-name in the 403 V2 (an object found under a different case would differ); upper-case the NotFound name (case 2); unescape the description (create case 12); forget the packageName fallback (case 13); STORE CREATE on this.#open() instead of the bound store (with two facades over two roots, the file lands in the wrong root).

Also: test/adt-devloop.mjs create/delete/foreign-session/vsp-package cases stay green under the ABAP front; test/tmp-package.mjs; an ABAP Unit for ATTRIBUTE and ENCODE_COMPONENT in zcl_osd_adt_obj_create testclasses (JS-regex parity table); ABAP-FS conformance (tools/abapfs-conformance.mjs --start, its deleteObject path) not worse than 30 PASS / 1 FAIL / 16 MISSING; abaplint 7.02 + ASCII over src/adt.

## Risks

- Session in the route: ty_request has no session today. CREATE's $TMP author and DELETE's own-handle release need it. This depends on feat/adt-front-up (slice 3 option B) landing, plus the TY_REQUEST extension. Without front-up, use the SYSTEM LOCK_DROP fallback, and extend SYSTEM SESSION with user.
- The store binding: STORE commands other than READ/HISTORY/REVISION/OBJECT use the destination's own lazily-opened store. If CREATE/DELETE are not put on the bound-store path, a test with several facades writes into the wrong root, and the diff harness with two copies would pass falsely if both copies resolved to one store.
- Regex dialect: JS \b and lazy first match versus ABAP POSIX regex. Use the explicit (^|[^A-Za-z0-9_]) form and FIND FIRST OCCURRENCE. Also check that the transpiler's regex translation keeps first-match semantics. A body that is not valid UTF-8 decodes to U+FFFD in Node and may fail ABAP's conversion: a 500 on one side and not the other. This is an edge case to pin or document.
- The double decode on DELETE is a Node quirk (express already decodes params). It must be reproduced, including the 500 text "URI malformed" in place of ZCL_OSD_ADT_URI's 400, or else declared a fix in both modes at once.
- The ENQ probe for DELETE takes a transient X lock in the session's ENQ context. Every path, refusal included, must DEQUEUE in CLEANUP, or a deleted object stays locked by the deleting session until logoff. This relies on the work-process FIFO serialising steps, so no other LOCK interleaves.
- The 403 user comes from sy-msgv1, the ENQ user, while Node uses holder.session.user. They are equal because RESOLVE binds the ENQ session with the session user, which the LOCK diff already relies on. A foreign facade's holder on the same lock server gives the ENQ user in both modes.
- 500 texts from filesystem errors carry host paths, and writeChecked's temp name has the pid and Date.now(). Those cannot be byte-equal across two roots. Only compare the controlled refusals.
- The authors file has a createdAt timestamp and the inactive set may carry times. Mask them in the tree comparison; never compare them byte for byte.
- ZOSD_STORE gains IV_JSON, so the fugr XML and the Go host (tools/gogen/go/abap/store.go key list) must move together. On OSGo, CREATE and DELETE are unknown commands, so the route answers 500. That is acceptable only if OSGo does not mount the ABAP ADT front; check this.
- The front-up {ended} refusal (refuseToken when a logoff ran between the verdict and the delete) has no ABAP counterpart, because the gap is gone. A diff test cannot provoke it in ABAP mode; document it as an intended difference, not a regression.
