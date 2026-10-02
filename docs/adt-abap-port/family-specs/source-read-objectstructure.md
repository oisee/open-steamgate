# source-read-objectstructure

- Recommendation: **port-to-abap**
- Effort: L
- Owner: dell
- Depends on: versions slice (done): ZCL_OSD_ADT_VERSIONS entity()/uri_name() become ZCL_OSD_ADT_ENTITY and ZCL_OSD_ADT_URI=>ENCODE_COMPONENT, and the versions diff test guards the refactor, coordinate with stoker slice 4a (PUT source/includes): the cross ETag case (Node PUT, then ABAP GET with If-None-Match) and post-write registry warm-up for OUTLINE

## Routes

### GET `/sap/bc/adt/{oo/classes,oo/interfaces,programs/programs,ddic/ddl/sources,ddic/srvd/sources,programs/includes}/:name/source/main` (adt-facade.mjs ~1766)

store.read(type, req.params.name) (INCL falls back to the PROG entry; DDLS also resolves by defined entity name). 200, Content-Type exactly 'text/plain; charset=utf-8', body = file text as read utf8 (BOM/CRLF kept), ETag = first 32 hex of sha256(UTF-8 body), unquoted (tools/adt-entity.mjs sendEntity). If-None-Match: comma list, each trimmed, leading W/ and one leading/trailing quote stripped; a match -> 304 via res.status(304).end(), ETag and Content-Type kept, no body. Missing object -> 404 ExceptionResourceNotFound, message '<TYPE> <param as given, decoded, original case> does not exist', application/xml; recorded in facade.missed as kind 'object'. Any other throw -> 500 ExceptionInternalError ns org.open-steamgate.osd with e.message. X-OSD-Generation header from the earlier middleware. HEAD via Express GET fallback.

### GET `/sap/bc/adt/{6 source collections}/:name/includes/:include` (adt-facade.mjs ~1776)

Registered for all six types. type != CLAS -> 404 '<TYPE> <name> include <include> does not exist'. CLAS: store.read(CLAS, name, include) first: unknown CLAS -> 404 'CLAS <name> does not exist'; include not an own key of INCLUDES (case-sensitive: main/definitions/implementations/macros/testclasses) -> 404 'CLAS <name> include <include> does not exist'; known include with no file -> empty source. Then: if String(req.headers.accept) (undefined -> 'undefined') does NOT contain 'application/vnd.sap.adt.oo.classes.includes.' -> text/plain; charset=utf-8 + sendEntity(source) (empty include = 200, empty body, ETag e3b0c44298fc1c149afbf4c8996fb924). Else classIncludeDocument(store.find(CLAS,name).name [canonical upper], include as given, '/sap/bc/adt/oo/classes/' + encodeURIComponent(name.toLowerCase()) + '/includes/' + include + '/source/main'), sendEntity with type 'application/vnd.sap.adt.oo.classes.includes.v2+xml' -> 200 header gets '; charset=utf-8' appended by res.send(string), the 304 keeps the bare type (res.status(304).end()).

### GET `/sap/bc/adt/{6 source collections}/:name/includes/:include/source/main` (adt-facade.mjs ~1796)

type != CLAS -> 404 '<TYPE> <name> include <include> does not exist' (thrown before any read, so it is the include message even when the object does not exist). CLAS: as the text branch of includes/:include: store.read with include, text/plain; charset=utf-8, sendEntity; same 404 texts; missing include file -> 200 empty.

### GET `/sap/bc/adt/{6 source collections}/:name/objectstructure` (adt-facade.mjs ~1879)

structureOf(store, type, name): store.find (no DDLS entity fallback) -> undefined -> 404 '<TYPE> <name> does not exist'. Else abaplint full registry (store.registry(), a 4 s whole-tree parse after any write) getObject(INCL->PROG): methods (CLAS/OM, visibility, modifiers static, uri source/main#start=r,c;end=r,c at the body, else declaration), interface-implemented methods from METHOD blocks, attributes CLAS/OA, non-empty class includes CLAS/I (uri includes/<inc>/source/main), CLAS/OCX self with isExternalRef/description extras, PROG/INCL parts (PROG/PU, PROG/PL, PROG/PP, PROG/PE events) + PROG/PX; DDLS/SRVD: no children. objectStructureDocument with xml:base = xmlEscape(req.originalUrl) (raw, undecoded, WITH query string), *Block links each followed by an *Identifier twin. res.type('application/vnd.sap.adt.objectstructure.v2+xml').send(string) -> Content-Type '...v2+xml; charset=utf-8'; NO ETag (app etag disabled in test/start.mjs:97 and osd-serve.mjs:142, not sendEntity). Only Express freshness applies: If-None-Match: * -> 304 with Content-Type removed.

### GET `/sap/bc/adt/oo/classes/:name` (adt-facade.mjs ~1902)

store.find(CLAS,name) undefined -> 404 'CLAS <name> does not exist'. classDocument({...found, ...store.stateOf(found)}, {includes: store.classIncludes(found.name)}): changedAt = main file mtime ISO without ms (fallback 1970-01-01T00:00:00Z), version 'inactive' if in store.inactive else 'active', changedBy = $TMP author from the index else 'OSD', description '' (index has none), packageRef uri encodeURIComponent(package.toLowerCase()) ($ -> %24); include list = main + the includes whose FILE exists (not non-empty), INCLUDES order. Type 'application/vnd.sap.adt.oo.classes.v4+xml', sendEntity (200 gets '; charset=utf-8', 304 bare). Answers class:abapClass whatever Accept says.

### GET `/sap/bc/adt/{programs/programs,oo/interfaces,ddic/ddl/sources}/:name` (adt-facade.mjs ~1917)

SOURCE_PROPERTY_MIME types PROG, INTF, DDLS: store.read(type,name) (entity fallback for DDLS; 404 '<TYPE> <name> does not exist'); sourcePropertiesDocument(type, object): object is the index entry + source, so changedAt is ALWAYS 1970-01-01T00:00:00Z and version ALWAYS 'active' (stateOf not applied, unlike the class), changedBy $TMP author else OSD, description ''. PROG adds program:programType="executableProgram" when /^\s*report\b/im matches the source (JS \s includes BOM and NBSP); DDLS adds view-entity attributes when /\bdefine\s+(?:root\s+)?view\s+entity\b/i matches. Byte quirks: an empty line where the intf-only xmlns:abapoo would be (PROG/DDLS), versions link href 'source/main/versions' (PROG) / 'versions' (DDLS) / none (INTF), syntaxConfiguration only PROG/INTF, trailing LF. Types: programs.v3+xml, ddlSource+xml, oo.interfaces.v2+xml; sendEntity (200 + '; charset=utf-8', 304 bare).

### GET `/sap/bc/adt/{programs/includes,ddic/srvd/sources}/:name` (adt-facade.mjs ~1926)

INCL and SRVD: the objectstructure handler itself, so xml:base is the bare object URL (originalUrl incl. query) and everything else as objectstructure; no ETag.

## Host dependencies

- STORE READ (exists, tools/osd-store-destination.mjs #read): EV_SOURCE, EV_PACKAGE, EV_FILE ('' = class include without a file), ET_OBJECT (ZOSD_OBJECT_S, NAME C40). Already reads the per-facade bound store (systemCalls store), which the diff test needs. Used by source/main, both include routes and the PROG/INTF/DDLS property document. Do NOT use its EV_VERSION/CHANGED_AT for the property document: Node shows 1970/active there.
- STORE READ, extended additively (no FM signature change): also fill EV_JSON = {"name": entry.name, "changedBy": entry.changedBy|null, "empty": bool}. This gives the canonical name as a string (C40 truncation avoided) and the $TMP author the property document needs. Existing callers (versions, webgui editor) ignore EV_JSON.
- STORE OBJECT (exists, #object), extended additively: {found,type,name,writable} + package, changedAt (store.stateOf(entry).changedAt or null), changedBy (entry.changedBy, the index snapshot as classDocument uses it, not authorNow), version (stateOf.version), includes (store.classIncludes(name), INCLUDES order; [] for non-CLAS). ZCL_OSD_ADT_LOCK reads only the first four, so it is unaffected. Used by bare CLAS and by the include XML (canonical name).
- NEW STORE command OUTLINE: IV_TYPE, IV_NAME -> EV_JSON = structureOf(store, type, name) as {found:false} or {found:true, name, type, children:[{name, type, visibility?, modifiers?, uri?, links:[{rel,href}], extra:[{name,value}], children:[...]}]} ('extra' and 'links' as ARRAYS, because zcl_ajson iterates object members sorted by name and would flip isExternalRef/description); EV_ERROR = e.message on a throw. Must read the bound store (add to the [READ, HISTORY, REVISION] list in #answer) and go in COMMANDS but NOT in CAPABILITIES (no screen button), as OBJECT is handled. OSGo/Go STORE host: answer EV_ERROR 'OUTLINE is not supported here' until it has a parser.
- Handler: ty_request gains uri TYPE string = get_header_field( '~request_uri' ) (express-icf-shim sets it to req.url, which the front passes as originalUrl; on an ICF it is the raw URI with query). xml:base needs it; today the handler drops every ~ field.
- Optional front change (tools/adt-abap-front.mjs): when the ABAP answer carries a marker header (e.g. X-OSD-Miss: object, removed before replay), call the facade's record(req,'object',message) so ABAP 404s still reach facade.missed (test/start.mjs:215). Without it the commonest object misses (source reads of missing objects) vanish from the miss list.
- No SYSTEM kind and no host continuation needed: nothing here rebuilds, swaps generations or waits on the network.

## Rationale

Six of the seven routes are pure renderers over data the STORE destination already returns (READ) or can return with additive JSON fields (READ EV_JSON, OBJECT), so they belong in ABAP and need no continuation: they read one file and stat it. The objectstructure (and its INCL/SRVD bare alias) needs a parse of ABAP source into methods, attributes, ranges and program parts. There is no ABAP-side parser in this tree (ZCL_OSD_ABAP_TOKENS is a word list; open-abap has no SCAN ABAP-SOURCE), so writing one in ABAP 7.02 would be XL and could not be byte-equal to abaplint's ranges. The split is: the host computes the outline rows from the same structureOf (new STORE command OUTLINE), and ABAP owns the document (escaping, Block->Identifier twins, xml:base, ordering, the empty-children line). That is still an ABAP route with a host data command, not HOST and not a continuation. On a real system the ABAP-side alternative to OUTLINE is CL_OO_SOURCE_SCANNER / SCAN ABAP-SOURCE / CL_RECA_RS_SERVICES-style scans behind the same JSON shape. Cost: L, and not byte-equal to abaplint's ranges without a corpus of diffs. The one honest cost of running OUTLINE in the step: a cold registry (after any write) is a ~4 s synchronous parse. Today it blocks the Node event loop just as hard, so the FIFO adds no wall time, but it does hold the work-process queue. Measure it in the slice; if it matters, warm the registry from the write route's completion (stoker 4a) rather than moving the route to HOST.

## ABAP design

Router rows: in ZCL_OSD_ADT_ROUTER=>ROUTES, a loop over ZCL_OSD_ADT_TYPES=>SOURCES( ) (CLAS, INTF, PROG, DDLS, SRVD, INCL) generates 5 GET rows per type, 30 in total, none written by hand, all before the HOST catch-all, in Node's order: c_base/<coll>/:name/source/main -> ZCL_OSD_ADT_SOURCE; :name/includes/:include -> ZCL_OSD_ADT_SOURCE; :name/includes/:include/source/main -> ZCL_OSD_ADT_SOURCE; :name/objectstructure -> ZCL_OSD_ADT_STRUCTURE; :name -> ZCL_OSD_ADT_OBJECT. None of them can shadow the versions rows or POST LOCK: different methods or a different literal segment at the same depth. HEAD is served by the HEAD->GET rule.

Shared helpers, extracted from ZCL_OSD_ADT_VERSIONS (refactor it to call them, with its diff test as the guard):
(1) ZCL_OSD_ADT_ENTITY=>SEND( is_request, iv_body, iv_type, iv_note optional ): sha256 over the UTF-8 body, first 32 hex chars, lower case. A 200 gets Content-Type iv_type && `; charset=utf-8` unless iv_type already has `charset=`. A 304 gets the bare iv_type, no body, ETag kept. That is how Node differs between res.send(string) and res.status(304).end(). Candidates are matched the way normalizedTag does it: strip a leading W/ and ONE leading and one trailing quote. The current CONDENSE NO-GAPS plus 'remove all quotes' is looser; aligning it is part of the extraction.
(2) ZCL_OSD_ADT_URI=>ENCODE_COMPONENT (the current uri_name: encodeURIComponent of the lower-cased name, upper-case hex).
(3) ZCL_OSD_ADT_HOST gets READ( type name include ) RETURNING ty_read {source, file, package, name, changed_by, empty}, OBJECT extended to the new fields, and OUTLINE( type name ) RETURNING ref to zcl_ajson. Error mapping: an EV_ERROR that ends in ' does not exist' becomes ZCX_OSD_ADT=>NOT_FOUND, with the message rebuilt from the DECODED PARAM (original case, not the upper-cased store name). Any other EV_ERROR is INTERNAL( EV_ERROR ), which is what answered() does with e.message. Versions currently maps every error to not_found; do not copy that.

ZCL_OSD_ADT_SOURCE: the type comes from the path, the way versions finds it. For params name and include: if an include is present and the type is not CLAS -> not_found '<T> <name> include <inc> does not exist'. Then READ. For the includes/:include row, branch on the accept header (field( ), case-insensitive name; the value is a case-sensitive CS 'application/vnd.sap.adt.oo.classes.includes.'; an absent header matches nothing). The XML branch is classIncludeDocument, rendered with LF line endings, the canonical name from READ EV_JSON name, and the raw include in the href. The text branch is ENTITY=>SEND with 'text/plain; charset=utf-8'.

ZCL_OSD_ADT_OBJECT:
- CLAS: HOST=>OBJECT, not found -> 404. Then classDocument with changedAt/changedBy/version/package/includes from OBJECT and description ''. Escape exactly where Node escapes: name, who, description and package yes; when, version and sourceUri no. Type 'application/vnd.sap.adt.oo.classes.v4+xml'.
- PROG/INTF/DDLS: READ, then sourcePropertiesDocument with changedAt literally 1970-01-01T00:00:00Z and version literally 'active' (Node's behaviour; fix both sides later in one change). The PROG report test is a line scan: on some line, after leading whitespace (including x'EFBBBF'/U+FEFF and NBSP, since JS \s covers them, and blank lines in between), the text is 'report' case-insensitive, followed by a non-[A-Za-z0-9_] character or the end. The DDLS view-entity test is a hand tokenizer: 'define', 1+ whitespace, optional 'root' + whitespace, 'view', whitespace, 'entity', with word boundaries. No FIND REGEX, because 7.02 POSIX has neither \b nor (?:.
- INCL/SRVD: delegates to ZCL_OSD_ADT_STRUCTURE.

ZCL_OSD_ADT_STRUCTURE: HOST=>OUTLINE; found false -> not_found '<T> <name> does not exist'. Render objectStructureDocument recursively: 2-space indent per level; attributes in the order name, type, visibility, modifiers, sourceUri, extras; each link whose rel ends in 'Block' is followed by its 'Identifier' twin; with no children the body is an empty line. xml:base = esc( is_request-uri ). The response is a plain 200 with content_type 'application/vnd.sap.adt.objectstructure.v2+xml; charset=utf-8', NO ETag header, and no If-None-Match handling in ABAP (Express's freshness check in the front's res.send reproduces Node's If-None-Match:* 304).

Slices (each one codex slice):
- B2a: SOURCE + OBJECT (CLAS and properties) + the helpers + READ/OBJECT JSON extension + ty_request-uri.
- B2b: OUTLINE + STRUCTURE + the INCL/SRVD bare alias + the miss marker.

## Test plan

Extend test/adt-abap-diff.mjs. Both routers run over ONE store and tree, or over copies with mtimes restored via utimes: the class document and its ETag carry the file mtime, so copied trees would differ for no real reason. Compare status, Content-Type, Content-Length, ETag and body bytes, and assert served_by ABAP for every row in this family, including HEAD, a trailing slash, an upper-case collection and a %2F-namespaced name.

Cases:
(1) source/main for each of the six types, with a fixture source that has non-ASCII text (a Cyrillic comment), CRLF lines, a UTF-8 BOM, and no final newline. The ETag must be the same 32-hex value on both sides.
(2) If-None-Match variants: the exact tag, "tag", W/"tag", a list 'x, "tag"', a non-matching tag, and '*'. '*' gives 304 on BOTH sides through Express freshness, with Content-Type removed. Check the 304 Content-Type: 'text/plain; charset=utf-8' for source, and the bare vnd type, with no charset, for the class and include documents.
(3) A missing object: the 404 message keeps the request's case ('CLAS zcl_nope does not exist') and the document matches Node's byte for byte.
(4) A DDLS read by its entity name (FOR TABLE FUNCTION) on source/main and on the bare route. The objectstructure of the same entity name is a 404, because structureOf does not fall back.
(5) Class includes: definitions present; macros absent (200, empty body, ETag e3b0c442...); 'Definitions' and 'constructor' give 404 include; includes/x on INTF, PROG and SRVD gives 404 include even when the object does not exist; Accept */*, an absent Accept, and Accept application/vnd.sap.adt.oo.classes.includes.v2+xml (the XML, with an href that re-encodes a namespaced name).
(6) Bare CLAS: active, then after a Node PUT (inactive, new mtime, new ETag); a $TMP class with an author, where changedBy is that author; a class with and without local include files (the include list).
(7) Bare PROG with 'REPORT', with a BOM before 'report', with 'reports', with a comment line '* report'; INCL source; INTF; DDLS with and without 'define root view entity' split across lines. Pin that changedAt is 1970 and version is 'active' even for an inactive PROG, so a Node-side fix has to change both.
(8) objectstructure for a class with methods, an interface-only class, an attribute, testclasses, and an empty class (OCX only); an interface; a report with FORM, local class and START-OF-SELECTION; an include; a DDLS and an SRVD (empty children line). Use a query string containing & ('?version=active&x=1') to check that xml:base is escaped, and the bare INCL/SRVD URL as xml:base. Neither side may send an ETag.
(9) A cold registry: a write followed by objectstructure. Record the latency on both sides (the record is the deliverable, not an assertion) and assert equal bodies.
(10) A host that refuses OUTLINE/READ (a throwing answers stub) gives a 500 ExceptionInternalError with the message, equal to answered().
(11) The matcher test picks up the 30 new rows automatically. Assert that no row for this family is HOST.
(12) Cross-implementation ETag: PUT through Node (stoker's route), then GET through ABAP with If-None-Match = the PUT's ETag, gives 304.

Red proofs: each of these must fail a case:
- the charset not appended on 200, or appended on 304;
- a lower-case-hex or quoted ETag;
- the store name used in the 404 message;
- a case-insensitive include key;
- includes checked for non-empty instead of existing;
- stateOf applied to the property document;
- extras emitted as a sorted JSON object;
- Identifier twins missing;
- xml:base without the query string;
- the PROG regex without the BOM/NBSP whitespace;
- READ against the unbound store (two facades, different trees).

Then run the ABAP-FS compatibility suites test/adt-editor.mjs and test/adt-devloop.mjs (with the ABAP front, and OSD_ADT=js) plus test/adt-facade.mjs, and confirm they are not worse. Also run npm run lint for 7-bit ASCII.

## Risks

- The 200 and 304 Content-Types differ for the XML documents: res.send(string) appends '; charset=utf-8', while sendEntity's res.status(304).end() keeps the bare type. If ABAP writes one type for both, the 304s diverge, and the existing tests never send If-None-Match to an XML document.
- Express freshness (If-None-Match: *, and Cache-Control: no-cache disabling it) makes 304 decisions in the front's res.send, not in ABAP. Byte-equal on the Node host by accident; on a real ICF there is no such layer, so the '*' answer would differ. This should be decided explicitly, not inherited.
- ETag hashing: cl_abap_message_digest=>calculate_hash_for_char must hash the UTF-8 bytes, as Buffer.from(String(body)) does. A BOM, NUL or non-BMP character in a source is where open-abap's string to codepage conversion could differ. The fixture must contain them.
- Node quirks that byte-equality forces ABAP to copy: the property document's changedAt is always 1970 and its version always 'active', even for an inactive PROG. Fixing this later must touch both sides in one change, and the diff test pins it.
- The OBJECT/READ JSON extensions must stay additive. ZCL_OSD_ADT_LOCK and the webgui editor read the old fields, and the Go STORE host (OSGo) needs the same fields or an EV_ERROR for OUTLINE. Otherwise the ADT front under OSGo serves a 500 where Node served a document.
- OUTLINE runs the whole-tree abaplint parse when the registry is cold (~4 s after any write) inside the step, which holds the work-process FIFO. Node blocks the event loop just as long today, so there is no new wall time, but OData steps queue behind ADT outline reads. Mitigation: warm after write or activation (store.warm), not a HOST row.
- zcl_ajson iterates object members by name, not insertion order. Any ordered map in the OUTLINE answer (extras) must be an array, or the attribute order flips (description before isExternalRef).
- ZOSD_OBJECT_S NAME is C40 and PACKAGE C30. Take the name and package from EV_JSON/EV_PACKAGE (strings), never from ET_OBJECT, or a long $OSD_... package or a 40-character DDLS gets truncated silently.
- The miss registry: an ABAP not_found does not reach facade.missed. Moving the source reads to ABAP empties the most useful part of the miss list (test/start.mjs:215) unless the front records a marker header.
- 500 messages: a non-NotFound store error (e.g. ENOENT between index and read) carries an absolute host path in e.message on both sides. Equal, but the path leaks into a client-visible document. This is existing behaviour; note it, do not fix it in this slice.
- The xml:base comes from ~request_uri. The express shim sets it to req.url, which the front passes as originalUrl. If another host (OSGo, child mode) passes a path without the query, xml:base silently loses the query string.
