# ddic-reads-typestructure

- Recommendation: **port-to-abap**
- Effort: M
- Owner: dell (group B, unit B8 in port-map; typestructure is SKELETON step 11, also dell). Could be split into two S slices: (1) typestructure + parser/info + ZCL_OSD_ADT_TYPES=>ALL; (2) DTEL/TABL documents + the shared entity/encode lift.
- Depends on: skeleton slices 1-2 (router table, Node front adt-abap-front.mjs, ZCL_OSD_ADT_HOST, ZCX_OSD_ADT) - landed, A1 versions (stoker) - landed; its private ENTITY and URI_NAME helpers are lifted into shared classes here, coordinate with stoker, nothing from slice 3 Part B or 4a/4b: no session, write or continuation dependency, C4 data preview (dell) depends on this family's TABLE_FIELDS, not the other way round

## Routes

### GET `/sap/bc/adt/ddic/dataelements/:name` (adt-facade.mjs ~2767)

answer(): store.read('DTEL', req.params.name) (osd-store.mjs:801; find upper-cases the key) then dataElementDocument(entry) (adt-documents.mjs:849) with no options, so adtcore:responsible/changedBy/createdBy = 'OSD' and changedAt/createdAt = '1970-01-01T00:00:00Z' (deterministic, no identity, no mtime). Values: the FIRST match of <TAG>([^<]*)</TAG> anywhere in the abapGit XML (DD04V comes first, so later I18N DDTEXTs never win), unescaped for exactly &lt; &gt; &quot; &amp; in that order (no &apos;, no numeric refs, so '&#39;' comes back out as '&amp;#39;'), then xmlEscape (& < > "). typeKind: REFKIND R + REFTYPE C|I -> refToClifType, R otherwise -> refToPredefinedAbapType, D -> refToDictionaryType, DOMNAME set -> domain, else predefinedAbapType. typeName = DOMNAME, else the first ROLLNAME, which is the element's own name. Numbers go through JS parseInt: '000015' -> 15, ''/missing -> 0, and non-numeric text -> 'NaN'. The label lengths use `|| default` (10/20/40/55), so 0 or NaN gives the default; the max lengths are fixed at 10/20/40/55. Booleans are the literal 'true'/'false' (flag === 'X'). packageRef uri = /sap/bc/adt/packages/ + encodeURIComponent(lower(package)) ($TMP -> %24tmp). Body ends in '</blue:wbobj>\n'. 200, Content-Type 'application/vnd.sap.adt.dataelements.v2+xml; charset=utf-8'. Sent with res.send and no explicit tag, so Express adds its weak ETag W/"<len>-<sha1b64>" and turns a matching If-None-Match into a 304. Refusals: NotFound -> 404 ExceptionResourceNotFound 'DTEL <name as decoded from the URL, original case> does not exist' (e.g. 'DTEL icfname does not exist'), and the miss is recorded as kind 'object'. Any other error -> 500 ExceptionInternalError in namespace org.open-steamgate.osd with the raw e.message. HEAD = the GET without its body.

### GET `/sap/bc/adt/ddic/tables/parser/info` (adt-facade.mjs ~2858)

record(req,'resource') then refuse(404,'ExceptionResourceNotFound','the DDL parser information is the system's own and is not served here'). application/xml, the exceptionDocument (adt-documents.mjs:1243), namespace com.sap.adt, empty <properties/>, Express weak ETag. Registered before :name; the segment counts differ anyway.

### GET `/sap/bc/adt/ddic/tables/:name` (adt-facade.mjs ~2862)

answer(): store.read('TABL', name) (structures, TABCLASS INTTAB, are TABL entries too and are served the same way). tableFieldsOf(store, entry) (adt-documents.mjs:909) is run, but only table.description (DDTEXT of the part before '<DD03P_TABLE>') reaches tableDocument(entry,{description}) (adt-documents.mjs:967). resolveType calls are made and their results are discarded. who = 'OSD'. when = entry.changedAt ?? epoch, and adtcore:version = entry.version ?? 'active'. Index entries carry neither field, so it is ALWAYS the epoch and 'active', even for an object saved inactive. sourceUri './'+encodeURIComponent(lower(name))+'/source/main'. The abaplanguageversions href is encodeURIComponent('/sap/bc/adt/ddic/tables/'+lower(name)) with the slashes encoded as %2F. packageRef as for DTEL. adtcore:name = entry.name (canonical upper case). Content-Type 'application/vnd.sap.adt.tables.v2+xml; charset=utf-8'. sendEntity (adt-entity.mjs): ETag = first 32 lower-case hex of SHA-256(UTF-8 body), unquoted. If-None-Match is split on ',', each part has W/ and quotes stripped, and a match -> 304 with an empty body. Refusals as for DTEL with 'TABL <name> does not exist'.

### GET `/sap/bc/adt/ddic/tables/:name/source/main` (adt-facade.mjs ~2870)

answer(): store.read('TABL'), then tableFieldsOf, then tableSourceDocument (adt-documents.mjs:993). Fields: every <DD03P>...</DD03P> block (lazy) in the whole XML. A block with an empty FIELDNAME or a FIELDNAME starting with '.' (.INCLUDE/.APPEND) is skipped, not expanded. The type is the lower-cased ROLLNAME when one is set, and the resolver result is never used here. Otherwise abap.<DDL_TYPE[kind] ?? lower(kind)>, with (len,dec) for DEC/CURR/QUAN/DF16_DEC/DF34_DEC, (len) for CHAR/NUMC/RAW/LCHR/LRAW/RSTR/STRG/SSTR, else bare. RSTR->rawstring and STRG->string; an empty DATATYPE gives 'abap.'. Line = two spaces + ('key ' or four spaces) + lower(name).padEnd(max name length) + ' : ' + type + (' not null' if NOTNULL X) + ';', and the lines are joined with LF. Header: @EndUserText.label : '<DDTEXT, raw text, ' doubled>' then enhancement.category #NOT_EXTENSIBLE, tableCategory #TRANSPARENT, deliveryClass #<CONTFLAG or A>, dataMaintenance #ALLOWED if MAINFLAG = X else #RESTRICTED, then 'define table <lower name> {', a blank line, the lines, a blank line, '}' and a final LF. Content-Type 'text/plain; charset=utf-8', with sendEntity ETag and 304 as above. Refusals as for tables/:name.

### POST `/sap/bc/adt/repository/typestructure` (adt-facade.mjs ~1646)

Body ignored, CSRF-gated (POST). One <SEU_ADT_OBJECT_TYPE_DESCRIPTOR> per TYPES entry (osd-store-types.mjs:9) in insertion order, 15 rows: CLAS INTF PROG FUGR TABL DTEL DOMA TTYP DDLS SRVD VIEW SHLP MSAG DEVC INCL. Each row: OBJECT_TYPE = ADT_TYPE (adt-documents.mjs:23; INCL -> PROG/I, FUGR -> FUGR/F). LABEL, PLURAL and CATEGORY come from LABELS (adt-facade.mjs:1628), and CATEGORY_LABEL = CATEGORY. URI_TEMPLATE = /sap/bc/adt/<collection>/{name}, with a literal {name}. Then <PARENT_OBJECT_TYPE/>, OBJNAME_MAXLENGTH 30 and <CAPABILITIES/><USER_AUTHORIZATIONS/>. No newlines anywhere. Wrapped as '<?xml version="1.0" encoding="utf-8"?><asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>'...'</DATA></asx:values></asx:abap>', with no trailing newline. Content-Type from asXmlTypeFor (adt-facade.mjs:3102): 'application/vnd.sap.as+xml; charset=utf-8; dataname=' + the first /dataname=([\w.]+)/ in Accept, else com.sap.adt.RepositoryTypeList. Express's setCharset reformats it, sorting parameters (charset < dataname, so the order is unchanged). res.send, so Express's weak ETag. Fully deterministic.

## Host dependencies

- STORE READ (existing, tools/osd-store-destination.mjs:315): IV_TYPE DTEL|TABL, IV_NAME (upper-cased by the host), IV_INCLUDE main -> EV_SOURCE (the abapGit XML), EV_PACKAGE (string; use this and not ET_OBJECT-PACKAGE, which is CHAR30), ET_OBJECT[1]-NAME (canonical name), EV_ERROR. It reads the store bound to the facade instance (withSystem), so a test with several mounts is correct. One call per request; all routes are short and never touch the generation, so the FIFO is not at risk.
- Do NOT use READ's EV_VERSION or ET_OBJECT-VERSION/CHANGED_AT for these documents: Node's entry has no version or changedAt, so it always writes 'active' and the epoch. Using them breaks byte-equality for an object saved inactive.
- No SYSTEM kind is needed. The documents hard-code 'OSD' as the user and do not read IDENTITY.
- No new STORE command or SYSTEM kind is needed for this family.
- Optional host-side change, not a STORE command: tools/adt-abap-front.mjs could record ABAP-answered 404s into facade.missed (e.g. the handler emits 'X-OSD-Miss: object|resource' and the front strips it), so /osd/not-served keeps the 'object' misses (DTEL/TABL not found) and the 'resource' miss (parser/info) that Node records today. Without it these entries vanish in the mixed phase until the miss registry moves into ABAP (port-map step 4).
- Later, for C4 (data preview, dell) and not this family: resolving a field's type (DTEL -> DOMA) costs one READ per data element plus one per domain. If that is too slow for wide tables, a new STORE command TYPE (IV_NAME -> EV_JSON = resolveType output) is the fallback. That would keep logic in the host, so prefer the ABAP resolver over READ first and measure.

## Rationale

All five routes are pure functions of either nothing (typestructure, parser/info) or one object's abapGit XML (DTEL, TABL), reached through the existing STORE READ. There is no host state, no generation and no long work, so neither a continuation nor a new host command is justified. The documents are deterministic: who = 'OSD', when = epoch, version = 'active', and no random ids, mtimes or host paths, except in the raw 500 message, which READ carries through unchanged. Byte-equality is therefore reachable. The work is string building plus a faithful port of three JS quirks: the first-match tag regex with a 4-entity unescape, parseInt/NaN, and padEnd. A second reason is that port-map B8 is meant to provide tableFieldsOf to C4 (data preview), which dell also owns, so the field parser should exist in ABAP anyway. typestructure is listed under SKELETON step 11 in port-map. It needs only the full 15-row type table that step 12 already says ZCL_OSD_ADT_TYPES must hold.

## ABAP design

Router rows in ZCL_OSD_ADT_ROUTER=>ROUTES, before the HOST catch-all. These are not per-type rows. Collections are taken from ZCL_OSD_ADT_TYPES=>ALL( ) for DTEL and TABL, so the paths are not hand-typed twice.
- POST /sap/bc/adt/repository/typestructure -> ZCL_OSD_ADT_TYPESTRUCTURE
- GET /sap/bc/adt/ddic/dataelements/:name -> ZCL_OSD_ADT_DDIC
- GET /sap/bc/adt/ddic/tables/parser/info -> ZCL_OSD_ADT_DDIC (before :name, as port-map requires)
- GET /sap/bc/adt/ddic/tables/:name -> ZCL_OSD_ADT_DDIC
- GET /sap/bc/adt/ddic/tables/:name/source/main -> ZCL_OSD_ADT_DDIC
HEAD is covered by the GET rows. No row collides: TABL and DTEL are not in SOURCE_TYPES, so no lock, versions or create row exists under these collections.

1) ZCL_OSD_ADT_TYPES gains ALL( ) -> tt_type_full: type, collection, adt_type, label, plural, category, source flag. It holds the 15 TYPES rows in osd-store-types.mjs insertion order with ADT_TYPE and LABELS. SOURCES( ) and LOCKABLE( ) are derived from it (source = X keeps CLAS INTF PROG DDLS SRVD INCL in today's order). This is port-map step 12.

2) ZCL_OSD_ADT_TYPESTRUCTURE (ZIF_OSD_ADT_ROUTE) loops ALL( ) and concatenates the descriptor string exactly, with no newlines. content_type = ZCL_OSD_ADT_XML=>AS_XML_TYPE( it_headers, `com.sap.adt.RepositoryTypeList` ): the Accept header field, FIND REGEX `dataname=([A-Za-z0-9_.]+)` (JS \w is ASCII), giving `application/vnd.sap.as+xml; charset=utf-8; dataname=<x>`. Set no ETag; Express adds the weak one in the front on both sides. Status 200.

3) ZCL_OSD_ADT_DDIC (ZIF_OSD_ADT_ROUTE) picks the case from the path: ZCL_OSD_ADT_TYPES=>TYPE_OF collection, plus whether it ends in /source/main or is parser/info.
- parser/info: RAISE zcx_osd_adt=>not_found( `the DDL parser information is the system's own and is not served here` ).
- READ( type, param ): CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE' command READ, as ZCL_OSD_ADT_VERSIONS does.
  - EV_ERROR CP `* does not exist` -> not_found( |{ type } { param } does not exist| ), using the decoded URL param in its original case, never the host's upper-cased text.
  - Any other EV_ERROR -> internal( ev_error ), the same text Node's 500 carries.
  - An RFC failure -> internal( `no object store here: ...` ).
  - Returns xml, name (ET_OBJECT[1]-NAME) and package (EV_PACKAGE).
- TAG( iv_xml, iv_tag ): FIND FIRST OCCURRENCE OF REGEX `<TAG>([^<]*)</TAG>` SUBMATCHES, which is POSIX-safe. Unescape &lt; &gt; &quot; &amp; in that order.
- JS_INT( text ) -> string: parseInt semantics (leading whitespace, sign, digits, leading zeros dropped). With no digits it returns `NaN`. `|| default` applies when the result is 0 or NaN.
- DATA_ELEMENT( xml, name, package ) -> the document string, line for line as dataElementDocument.
- TABLE_FIELDS( xml ) -> ty_table (description, delivery class, maintenance, fields with name, key, notnull, element, datatype, length, decimals). Blocks are found by FIND `<DD03P>` / `</DD03P>` with offsets, not by a lazy regex: `[\s\S]*?` is not 7.02 POSIX. Skip '' and '.'-prefixed names. Leave an optional resolver hook (DTEL -> DOMA through READ) for C4; it is not called here because neither document uses it.
- TABLE_DOCUMENT( name, package, description ): version is the literal `active` and the timestamps the literal epoch.
- TABLE_SOURCE( ty_table ): width = max strlen of the names, padding with spaces, LF joins, the '' doubling, DDL_TYPE as a CASE.
- The tables and source/main answers go through a shared SEND_ENTITY.

4) Lift two private helpers out of ZCL_OSD_ADT_VERSIONS (stoker's class; coordinate) into shared places, and make versions call them:
- ENTITY becomes ZCL_OSD_ADT_XML=>SEND_ENTITY( is_request, iv_body, iv_type ), or a new ZCL_OSD_ADT_ENTITY: strong 32-hex ETag, If-None-Match with W/, quotes, lists and '*', and 304.
- URI_NAME becomes ZCL_OSD_ADT_URI=>ENCODE_COMPONENT: encodeURIComponent with upper-case hex.

What the host is asked: READ only. Everything ABAP 7.02 and ASCII; the em dash in the parser/info message is not there (the message is ASCII), so check the literal.

## Test plan

Add a case "ddic slice" to test/adt-abap-diff.mjs, in the pattern of the versions slice. Use a mkdtemp root with crafted abapGit files and mount twice: Node-only, and withAbap(counted). For every request compare status, content-type, content-length, etag and body byte for byte. Assert from `served` that each request was ABAP-served and from `steps` that ABAP was asked.

Data elements:
- domain-typed (DOMNAME).
- predefined: no DOMNAME, DATATYPE CHAR, LENG 000015, so typeName is the element's own ROLLNAME.
- REFKIND R with REFTYPE C, and with REFTYPE I.
- REFKIND R with another REFTYPE.
- REFKIND D.
- missing SCRLEN*: defaults 10/20/40/55.
- SCRLEN '000000' and a non-numeric LENG 'x1', which pins the 'NaN' output.
- texts with & < > \" ' and a literal '&#39;'.
- an I18N block after DD04V carrying a different DDTEXT: first match wins.
- non-ASCII DDTEXT (umlaut): UTF-8 length and the weak ETag.
- flags NOHISTORY/LOGFLAG/LTRFLDDIS/BIDICTRLC set to X.
- package $TMP (%24tmp) and a namespaced name /DEMO/ZDTEL requested as %2Fdemo%2Fzdtel.
- missing element in mixed case 'ZNope': the 404 body must read 'DTEL ZNope does not exist'.

Tables:
- key + not null CHAR, DEC(15,2), INT4, RSTR, STRG.
- a ROLLNAME field.
- a field with neither ROLLNAME nor DATATYPE ('abap.').
- a .INCLUDE row: skipped.
- DDTEXT containing an apostrophe and an umlaut (DDL doubling, plus SHA-256 over UTF-8).
- no CONTFLAG (#A) and MAINFLAG X.
- zero fields.
- a structure (INTTAB).
- a table saved inactive through a WRITE first: the document must still say version="active" and the epoch.
- the object document and the source, each with If-None-Match = the strong tag, W/\"tag\", a list containing it, and '*': expect 304 on both sides, or 200 for '*'.
- HEAD of both.
- a missing table.
- tables/parser/info, GET and HEAD.
- tables/parser (one segment, a TABL named parser: 404).

typestructure:
- POST with a valid token, with no Accept, with Accept dataname=com.sap.adt.RepositoryTypeList, and with Accept dataname=foo.bar.
- POST without a token: refused by the Node CSRF gate before the front on both sides.
- If-None-Match = Express's weak ETag: 304 on both sides.

Existing suites run in both modes unchanged: test/adt-facade.mjs :229 (typestructure), :1036 (dataelements icfname), :1225-1268 (zstg_photo object + DDL + parser/info), and test/zosd-test.mjs :348, :487-489.

ABAP Unit on ZCL_OSD_ADT_DDIC builders (no host): TAG unescape order, JS_INT, padEnd width, '' doubling, the DDL_TYPE table, the typeKind matrix, and ALL( ) row count and order (15; INCL last; ADT codes).

ABAP-FS conformance (--start) must stay at main's figure (29 PASS / 2 FAIL / 16 MISSING at slice 3). Report the before and after numbers. Narrow parity.mjs ADT_PATH and report the old and new denominators.

Red proof:
(a) emit the trailing LF of the DDL twice, or drop the one after </blue:wbobj>: the body diff fails;
(b) use READ's EV_VERSION for adtcore:version: the inactive-table case fails;
(c) use the host's upper-cased error text: the mixed-case 404 case fails;
(d) remove the five router rows: `served` shows HOST and the slice assertion fails;
(e) put parser/info after :name in a pattern that would shadow it: its 404 message changes.

## Risks

- Miss registry: Node records 'object' misses (DTEL/TABL not found) and a 'resource' miss (parser/info) into /osd/not-served. ABAP-served refusals are not recorded in the mixed phase, so that instrument goes quiet for these paths. No current test covers these paths (adt-facade.mjs:903 uses packages). Either the front records ABAP 404s (header marker) or this is accepted until the ABAP miss registry lands. Decide before landing.
- Byte traps that look harmless: version/changedAt must be the literal 'active' and the epoch, not READ's state; the 404 name must be the URL's decoded case and not READ's upper-cased name; the DDL ends in exactly one LF; typestructure has no trailing newline; DTEL has one.
- JS semantics to replicate: parseInt with 'NaN' output; `||` defaults that also catch NaN; padEnd counts UTF-16 units and ABAP strlen counts characters, which differ only for non-BMP names; JS \w is ASCII; the 4-entity unescape order (&amp; last) leaves &apos; and numeric refs unescaped and then double-escapes them.
- ABAP 7.02: the lazy regex `<DD03P>([\s\S]*?)</DD03P>` cannot be used (POSIX, no PCRE before 7.55); the block scan must be done with FIND/offsets. open-abap's JS-backed regex would hide this locally and fail on a system, so lint with the 7.02 profile and keep the scan regex-free.
- Non-ASCII texts: the strong ETag needs SHA-256 over UTF-8. calculate_hash_for_char must hash UTF-8 and the shim must send the string body as UTF-8. The versions slice only proved ASCII, so pin it with an umlaut case.
- Weak ETag on DTEL/typestructure is Express's (res.send in the front), not ABAP's. Gate 1 is equal by construction, but on a real system (no Express) these answers would carry no ETag. That is a host-less difference to note, not to fix here.
- Content-Type: Node's string passes through Express setCharset/content-type format; the ABAP literal is sent unreformatted with a Buffer body. It is equal today because the types are already canonical. An Accept dataname that needs quoting cannot occur ([\w.]+ only).
- The helper lift touches stoker's ZCL_OSD_ADT_VERSIONS (entity, uri_name). Coordinate or duplicate briefly, with a follow-up to dedupe.
- On a system without the STORE host, READ fails and the routes answer 500. The ABAP-side alternative (DDIF_DTEL_GET / DDIF_TABL_GET into the same builders) would cost a DD04V/DD02V/DD03P-to-XML-shape adapter and would not be byte-equal to abapGit-file-derived answers. Out of scope for 0.7.
- The documents are known approximations of A4H: typeName for predefined types, always 'active', includes dropped from the DDL, structures served as 'define table'. Porting freezes them in two places; fidelity fixes must land in OSG-JS first, per Gate 1.
- C4 (data preview metadata) needs resolved field types (DTEL -> DOMA), which this family does not. If C4 reuses TABLE_FIELDS with the resolver, a wide table costs up to 2 READ round-trips per field inside one step. Measure before C4 lands.
