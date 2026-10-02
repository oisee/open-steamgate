# information-system-search-tree

- Recommendation: **port-to-abap**
- Effort: L
- Owner: dell
- Depends on: query record with Express qs semantics: slice 3 B front-up record, or a tolerant shim string_to_fields, ABAP 404 -> facade.missed marker (skeleton), Node fix first: nodepath URIError and vfs contents host throw (unhandled async rejections under Express 4), SYSTEM SESSION answers user (tools/adt-enq.mjs), or TY_REQUEST-USER after slice 3 B

## Routes

### GET `/sap/bc/adt/repository/informationsystem/virtualfolders/facets` (adt-facade.mjs ~917)

Static. 200, Content-Type 'application/vnd.sap.adt.facets.v1+xml; charset=utf-8'. One line, no trailing newline: XML decl + <vf:facets xmlns:vf="http://www.sap.com/adt/ris/facets"> + 5 <vf:facet/> for package, group, type, api, fav (key=lower, displayName=first letter upper, description=key, isHierarchical=false, isForFiltering=true, isForStructuring=true). No ETag set by the route: Express adds one from the body only if the app's etag setting is on (test/start.mjs and osd-serve set it false). HEAD comes from Express's GET handling.

### POST `/sap/bc/adt/repository/informationsystem/virtualfolders/contents` (adt-facade.mjs ~935)

Async route that does NOT go through answer(). Parses the raw UTF-8 body with regexes: preselections `<vfs:preselection[^>]*facet=".."[^>]*>(lazy)</vfs:preselection>` go into a Map keyed by lower-cased facet. A Map keeps the first insertion position and the last value. Values are `<vfs:value>([^<]*)` upper-cased and NOT XML-unescaped. The order is every `<vfs:facet>` in the document, lower-cased. The pattern is the first objectSearchPattern="..", default '*'. The object set is everyObject(): store.packages() order (localeCompare) x store.package(p).objects order (localeCompare on type+name), with no $TMP user filter. It is then filtered by a star-glob on the upper-cased name and by each preselection. The package facet expands a plain name to its subtree (BFS over subpackages) and takes '..P' as the package itself only. An empty order gives the object rows: uri BASE/<TYPES.adt or 'unknown'>/<encodeURIComponent(lower name)>, text=name (description is never set), type=ADT_TYPE or code, expandable=TYPES[t].source. A package order gives package drawers: one plain package gives '..P' first if it has its own objects, then its subpackages .sort(). No package gives store.rootPackages() names .sort(). Several packages give themselves, in request order. Each drawer has a counter, a description text, two atom links and hasChildrenOfSameFacet. A group or type order gives drawers counted by facet value, sorted with localeCompare, labelled from TREE_FOLDER/TREE_TYPE_LABEL (PROG->REPO) or GROUP_LABELS/TREE_CATEGORY_LABEL. api and fav have no value, so their drawers are empty. preselectionInfo appears only for exactly one plain package. selectionHref = BASE/repository/informationsystem/virtualfolders?selection=encodeURIComponent(parts.join(' ')). 200, 'application/vnd.sap.adt.repository.virtualfolders.result.v1+xml; charset=utf-8', one line, no trailing newline, objectCount = filtered count. A host exception here is an unhandled rejection under Express 4, so the request hangs with no answer.

### GET `/sap/bc/adt/repository/informationsystem/objecttypes` (adt-facade.mjs ~1050)

Static. 200, 'application/vnd.sap.adt.nameditems.v1+xml; charset=utf-8', namedItemsDocument over Object.keys(TYPES): 15 codes in insertion order CLAS INTF PROG FUGR TABL DTEL DOMA TTYP DDLS SRVD VIEW SHLP MSAG DEVC INCL. name=code, description=LABELS[code][1] (the plural), data='type:<ADT_TYPE>;usedBy:quick_search,virtual_folders'. The query (maxItemCount, name, data) is ignored. Multi-line template with a trailing newline.

### GET `/sap/bc/adt/repository/informationsystem/releasestates` (adt-facade.mjs ~1066)

Static. 200, 'application/vnd.sap.adt.nameditems.v1+xml; charset=utf-8', namedItemsDocument([]). The bytes are: decl, newline, <nameditem:namedItemList ...>, newline, two spaces + <nameditem:totalItemCount>0</...>, newline, EMPTY LINE, </nameditem:namedItemList>, newline.

### GET `/sap/bc/adt/repository/informationsystem/objectproperties/values` (adt-facade.mjs ~1071)

Same bytes and type as releasestates: an empty namedItems list. Not advertised.

### GET `/sap/bc/adt/packages/settings` (adt-facade.mjs ~1076)

Static. 200, 'application/vnd.sap.adt.packages.settings+xml; charset=utf-8', decl + <pkcs:settings pkcs:showPackageCheckErrors="false" xmlns:pkcs="http://www.sap.com/adt/packages/settings"/>, no trailing newline. It is registered before packages/:name and shadows a package called SETTINGS.

### GET `/sap/bc/adt/packages/valuehelps/:what` (adt-facade.mjs ~2745)

200, 'application/vnd.sap.adt.nameditems.v1+xml; charset=utf-8'. namedItems [{name:'standard', description:'Standard ABAP'}] when the decoded :what === 'abaplanguageversions' (case-sensitive), else an empty list. The query (name=) is ignored.

### GET `/sap/bc/adt/packages/:name` (adt-facade.mjs ~2752)

Wrapped in answer(). Type 'application/vnd.sap.adt.packages.v2+xml' when Accept contains 'packages.v2+xml' (case-sensitive), else v1. Express's send adds '; charset=utf-8'. The body is packageDocument(packageOf(store, name, {user: req.adt.session.user}), {describe}). packageOf upper-cases the name, calls store.package, then localView: $TMP shows the user's objects and subpackages plus the non-library roots (OSD_LOCAL_PACKAGES overrides that set) and gets the default description 'Local objects'; a package below $TMP is filtered by author. describe(child) = store.packages().find(...).description ?? ''. The multi-line template has fixed indentation and a trailing newline. createdAt/changedAt are 1970-01-01T00:00:00Z and the user is the constant 'OSD'. isAddingObjectsAllowed = !library. superPackage appears only when there is a parent. An empty subpackage list leaves a blank line. Unknown package: NotFound('DEVC', NAME), so 404 ExceptionResourceNotFound 'DEVC <NAME> does not exist' AND an 'object' miss in facade.missed. Any other throw: 500 ExceptionInternalError in org.open-steamgate.osd.

### POST `/sap/bc/adt/repository/nodepath` (adt-facade.mjs ~2775)

Async, not wrapped in answer(). The body is read and ignored. uri = req.query.uri when it is a string, else '' (a repeated uri arrives as an array, so ''). The URI is parsed with objectFromUri(uri minus /includes/..., SOURCE_TYPES collections): cut at # and ?, strip /source/main, take the first case-sensitive prefix match in order CLAS INTF PROG DDLS SRVD INCL, then decodeURIComponent and toUpperCase on the name. No match: 400 application/xml ExceptionInvalidRequest 'an object uri is required' (refuse() bytes). store.find miss: 404 ExceptionResourceNotFound '<TYPE> <NAME> does not exist', NOT recorded as a miss. Otherwise 200 'application/xml; charset=utf-8' nodePathDocument: entry.packages chain (DEVC/K, lower-cased encoded uri), then the object with ADT_TYPE and the raw uri minus ?#, /includes/..., /source/main. category is always ''. A malformed %XX in the name throws URIError inside an async handler, an unhandled rejection under Express 4, so there is no answer.

### POST `/sap/bc/adt/repository/nodestructure` (adt-facade.mjs ~2801)

Wrapped in answer() after the body is read. name = parent_name ?? parentName ?? package ?? ''. This is ?? and not ||, so an empty parent_name= wins; a repeated parameter is an array and is stringified 'a,b'. parentType = parent_type ?? parentType. Node keys are every <TV_NODEKEY>..</TV_NODEKEY> in the body except '000000'. Content-Type = asXmlTypeFor: the first /dataname=([\w.]+)/ in Accept (case-sensitive) or com.sap.adt.RepositoryObjectTreeContent. Express re-formats it with sorted params to 'application/vnd.sap.as+xml; charset=utf-8; dataname=X'. classFolders = Accept does NOT match /dataname=com\.sap\.adt\.RepositoryObjectTreeContent/i. user = String(user_name ?? '') || session.user. nodesOf: a CLAS parentType gives the class nodes main, then classIncludes on disk (CLAS/I, name 'X.include', not expandable), and NotFound for an unknown class. Otherwise packageOf(name, user) gives DEVC/K child rows (expandable X), then objects except DEVC, each with ADT_TYPE, uriOf, expandable only for a CLAS with classFolders, version, and 'library object' as the description for library objects. With name==='' and parentType==='DEVC' the document is FLAT (TREE_CONTENT only, 6 fields). With node keys, the kinds are mapped through this request's own OBJECT_TYPES NODE_IDs and the document is re-rendered over the matching nodes as a full document with fresh ids; an unknown key gives an empty set. A full document has the rows (OBJECT_URI and OBJECT_VIT_URI omitted when empty, other empty fields self-closed, VERSION I or A), CATEGORIES in first-seen order, and OBJECT_TYPES with NODE_ID 000001.. in the order kinds first appear, DEVC skipped. Multi-line with fixed indentation, a trailing newline, and a blank line for an empty table. A NotFound becomes 404 + an object miss.

### GET `/sap/bc/adt/repository/informationsystem/search` (adt-facade.mjs ~2837)

Wrapped in answer(). query = query ?? search ?? ''. max = Number(maxResults ?? 100) with JS Number semantics: '' gives 0, 'abc' gives NaN, '2.5' gives a 2-slice, '-1' a slice(0,-1), '1e1' 10. type = typeOf(objectType ?? type): '' gives undefined, else the upper-cased part before '/'. searchObjects: pattern = trim + upper. A '*' anchors the pattern as a glob, otherwise it is a substring. With no type or DEVC, packages come first in store.packages() order, filtered by includes or glob, slice(0,max), with description undefined when empty. DEVC returns those alone. When packages >= max the result is those packages. Otherwise searchNonPackages(max - n): seed = the first non-empty glob part (or the whole pattern), store.search(seed, {type, max: max*4}) in INDEX order, filtered by the glob, cut at max. NaN never cuts, so maxResults=abc returns every non-package hit and no packages. Hits are rendered with ADT_TYPE, uriOf, and 'library object'. 200 'application/xml; charset=utf-8' objectReferencesDocument: one line per reference, attribute order uri, type, name, packageName (never set), description, with a trailing newline.

## Host dependencies

- SYSTEM SESSION (exists, tools/adt-enq.mjs abapSession): extend the JSON from {stateful} to {stateful, user: session.user}, and add ZCL_OSD_ADT_HOST=>SESSION_USER( ). nodestructure and packages/:name need req.adt.session.user. After the front moves up (slice 3 B) the handler fills a new ZIF_OSD_ADT_ROUTE=>TY_REQUEST-USER from ZIF_OSD_ADT_SESSION=>RESOLVE, and the route uses that when it is set.
- STORE OBJECT (exists, osd-store-destination.mjs #object, bound store): extend the JSON, backward compatible, with packages: entry.packages (the chain root->leaf, for nodepath) and, for CLAS, includes: store.classIncludes(name) (for class nodes in nodestructure). The LOCK route ignores the new keys.
- STORE PACKAGE (NEW): IV_NAME = package as given (the host upper-cases it with JS toUpperCase; '' = the root pseudo-package), IV_FILTER = user. It answers EV_JSON {found:true, name, parent?, description?, library, subpackages:[{name, description}], objects:[{type, name, library, version}]} = packageOf(boundStore, name, {user}) with each subpackage described as store.packages().find(...).description ?? ''. It answers {found:false, name:<UPPER>} on NotFound and EV_ERROR with the raw message for anything else. Order exactly as the host has it (subpackages: localView order; objects: localeCompare). It reads host state: package.devc.xml CTEXT (raw, not unescaped), tmp authors, OSD_LOCAL_PACKAGES, stateOf overlay (version).
- STORE PACKAGES (NEW): IV_FILTER = 'OBJECTS' or ''. It answers EV_JSON [{name, parent?, description?, library, subpackages:[...]} (+ objects:[{type,name}] with OBJECTS)] in store.packages() order. Objects come from store.package(name).objects, raw, WITHOUT localView, as vfs everyObject does. vfs contents uses OBJECTS; search uses names and descriptions only.
- STORE SEARCH (NEW): IV_FILTER = seed, IV_TYPE = type or '', IV_LIMIT = limit ('' = unbounded, for the NaN case). It answers EV_JSON [{type, name, library}] = store.search(seed, {type, max}) in index (Map insertion) order. LIST is not reused: it sorts with localeCompare, filters by substring with its own limit default, and reads this.store rather than the facade's bound store (port-map risk 12).
- All three new commands read systemCalls.getStore()?.store ?? open() (the facade instance's store, as READ and OBJECT do). They are not listed in CAPABILITIES (no screen button), are answered as JSON in EV_JSON, and need no new ZOSD_STORE parameter (IV_NAME, IV_TYPE, IV_FILTER and IV_LIMIT already exist). OSGo has no implementation of OBJECT or of these; OSGo does not mount the front, so that is noted and not built.
- No SYSTEM kind beyond the SESSION extension; no git, no build, no job, no continuation.

## Rationale

Every route in this family is a pure read: static XML, or an XML rendering of the store's package and object index. None of them rebuilds, swaps a generation, waits or spawns, so none needs a host continuation, and none is OSD-private introspection. The work splits cleanly. The host keeps what is host state (the file index, its iteration order, package.devc.xml texts, tmp authorship, OSD_LOCAL_PACKAGES, the inactive overlay, and every localeCompare ordering) behind three new JSON STORE commands and two extensions of existing answers. ABAP owns all the logic that is pure: the $TMP view is already applied host-side, and ABAP has the tree and drawer rules, NODE_ID assignment and TV_NODEKEY mapping, the flat-root rule, glob matching, quick-search package/max arithmetic, vfs facet filtering and counting, the selection hrefs, and all five documents. Ordering is the reason the cut sits there. Node sorts packages and objects with String#localeCompare (ICU), which differs from binary order for '_' against letters, so '$ZT_A' comes before '$ZTA' under ICU and after it under ABAP SORT. ICU also differs between Node and Bun builds. The host therefore hands lists over already ordered, and ABAP never re-sorts them. ABAP sorts only where JS uses plain .sort() (code-unit order) or where the value vocabulary is provably safe (the vfs group and type drawers). The static six are about 150 lines with no host call and can go first.

## ABAP design

Router rows. Eleven hand-written rows, no per-type generation, inserted before the HOST catch-all (order is a contract: packages/settings before packages/:name):
GET  /sap/bc/adt/repository/informationsystem/virtualfolders/facets -> ZCL_OSD_ADT_RIS_STATIC
POST /sap/bc/adt/repository/informationsystem/virtualfolders/contents -> ZCL_OSD_ADT_VFS
GET  /sap/bc/adt/repository/informationsystem/objecttypes -> ZCL_OSD_ADT_RIS_STATIC
GET  /sap/bc/adt/repository/informationsystem/releasestates -> ZCL_OSD_ADT_RIS_STATIC
GET  /sap/bc/adt/repository/informationsystem/objectproperties/values -> ZCL_OSD_ADT_RIS_STATIC
GET  /sap/bc/adt/packages/settings -> ZCL_OSD_ADT_RIS_STATIC
GET  /sap/bc/adt/packages/valuehelps/:what -> ZCL_OSD_ADT_RIS_STATIC
GET  /sap/bc/adt/packages/:name -> ZCL_OSD_ADT_PACKAGE
POST /sap/bc/adt/repository/nodepath -> ZCL_OSD_ADT_TREE
POST /sap/bc/adt/repository/nodestructure -> ZCL_OSD_ADT_TREE
GET  /sap/bc/adt/repository/informationsystem/search -> ZCL_OSD_ADT_SEARCH
HEAD comes from the existing HEAD->GET rule. The POST LOCK row on packages/:name does not collide. Small router change: DISPATCH copies the matched pattern into a new TY_REQUEST-PATTERN, so a multi-row class switches on its row instead of re-matching the path. TY_REQUEST also gains USER (see the host dependencies).

Shared helpers:
- ZCL_OSD_ADT_URI=>ENCODE_COMPONENT: lifted out of ZCL_OSD_ADT_VERSIONS=>URI_NAME (encodeURIComponent, upper-case hex, UTF-8), which versions then calls.
- ZCL_OSD_ADT_URI=>QUERY( request, name, EXPORTING found ): Express qs semantics. Names are decoded, '+' becomes a space, a malformed % stays literal, and a repeated name is joined with ',' (String(array)). found distinguishes absent from empty, which the ?? chains need.
- ZCL_OSD_ADT_JS: NUMBER( ) implements Number() for maxResults (trim, '' -> 0, sign, decimals, exponent, hex, Infinity, NaN flag). GLOB( name, pattern ) is a star-only greedy match (prefix, ordered middles, suffix) instead of a regex. 7.02 POSIX regex has no lazy quantifiers, and the transpiled JS regex would hide that.
- ZCL_OSD_ADT_TYPES gains ALL( ): the 15 codes in TYPES order with collection, source flag, ADT_TYPE (STRU included), LABEL and PLURAL. It also gains TREE_FOLDER, TREE_CATEGORY, TREE_TYPE_LABEL and TREE_CATEGORY_LABEL.
- ZCL_OSD_ADT_DOC_COMMON (port-map name): NAMED_ITEMS( ) and OBJECT_REFERENCES( ). Documents are string tables joined with CL_ABAP_CHAR_UTILITIES=>NEWLINE, so an empty table yields the blank line the JS template yields. Escaping uses ZCL_OSD_ADT_XML=>ESC only.

Route classes:
- ZCL_OSD_ADT_RIS_STATIC (no host call): the facets, objecttypes (from TYPES-ALL), releasestates, objectproperties, settings and valuehelps bytes.
- ZCL_OSD_ADT_PACKAGE: USER (from the request, else SESSION_USER), then HOST=>PACKAGE( name user ). found = false raises ZCX_OSD_ADT=>NOT_FOUND( 'DEVC '&&name&&' does not exist' ) with the host's upper-cased name. Otherwise the port of packageDocument, indentation verbatim, v1/v2 by Accept.
- ZCL_OSD_ADT_TREE:
  - nodepath parses the uri itself (query, cut at the first / of /includes/, # and ?, /source/main, then a case-sensitive prefix over ZCL_OSD_ADT_TYPES=>SOURCES) and decodes the name with DECODE_SEGMENT.
  - It calls HOST=>OBJECT, which now returns packages, then INVALID_REQUEST or NOT_FOUND with Node's texts.
  - nodestructure has the ?? chains, the user rule and node keys found with FIND and offsets. Then HOST=>PACKAGE( name user ), or HOST=>OBJECT for a CLAS parent (includes); the node list follows the nodesOf rules.
  - NODE_STRUCTURE( nodes flat node_keys ) ports nodeStructureDocument, including the recursive leaf render.
- ZCL_OSD_ADT_SEARCH: the searchObjects and searchNonPackages arithmetic over HOST=>PACKAGES( '' ) and HOST=>SEARCH( seed type limit ). NaN means an unbounded limit and no packages.
- ZCL_OSD_ADT_VFS:
  - Hand-scans the request (preselection table that keeps first position and last value, facet order, pattern).
  - Calls HOST=>PACKAGES( 'OBJECTS' ) once and builds the package map and BFS subtree in ABAP.
  - Filters and counts objects, then renders the three answer shapes.
  - The group and type drawers use SORT (their value set is all [A-Z_] with distinct first letters, so binary order = ICU order; a unit test enumerates it). Subpackages and roots use SORT, as JS uses .sort().

Error texts: new host methods raise ZCX_OSD_ADT=>INTERNAL with the host's raw EV_ERROR, without the 'OBJECT x:' prefix that OBJECT uses, so a 500 matches answer()'s String(e.message).

What the host is asked per request: nodestructure needs SESSION (+ PACKAGE, or OBJECT for a class), so 2 calls. packages/:name needs SESSION + PACKAGE. nodepath needs OBJECT. search needs PACKAGES + SEARCH. vfs contents needs PACKAGES(OBJECTS). The statics need nothing.

Slices: B1 statics (S). B5+package: tree, nodepath and packages/:name, with PACKAGE, the OBJECT and SESSION extensions and the miss marker (M). B6+B7: search and vfs, with PACKAGES and SEARCH (M).

## Test plan

Diff tests in test/adt-abap-diff.mjs, in its pattern: two adtRouters over copies of one tree, one with the ABAP front. Each case compares status, content type, length, entity tag and body, asserts the reference status and asserts that ABAP served the request.

Fixture additions. These must be in the tree, or the ordering mutations cannot fail:
- packages $ZT_A and $ZTA, where ICU and binary order differ;
- a package whose CTEXT holds &amp; and <;
- a namespaced package /OSDT/PKG;
- a library package;
- a $TMP object authored by the test user and one by another user, plus a package below $TMP;
- an inactive object;
- a class with testclasses and locals_imp on disk;
- an INCL;
- more than 4*N names containing B where only a few end in B (exercises the max*4 seed cut).

1. Statics: all six, GET and HEAD, a trailing slash, an upper-case path; valuehelps abaplanguageversions, ABAPLANGUAGEVERSIONS (empty), %61baplanguageversions, applicationcomponents.
2. packages/:name:
   - known, lower-case, %2Fosdt%2Fpkg, library, root super-package, $TMP for two Basic users, a package below $TMP;
   - Accept v1, v2 and none;
   - SETTINGS shadowing;
   - unknown package: 404 and a facade.missed entry.
3. nodepath: CLAS, CLAS /includes/testclasses, /source/main?x#y, PROG and INCL, DDLS; a DEVC uri, no uri, uri twice (400); oo/classes/ with an empty name (404 'CLAS  does not exist'); an unknown object, a 404 with NO miss recorded.
4. nodestructure:
   - flat root (parent_type=DEVC, no name) and a non-flat root;
   - parent_name versus parentName versus package, and parent_name= empty;
   - $TMP with user_name absent, empty, or another user;
   - a mixed-type package; a CLAS parent; an unknown class or package (404 + miss);
   - Accept with the dataname, the dataname in another case (classFolders), */*;
   - TV_NODEKEY: one key, two keys, an unknown key, only 000000;
   - an inactive object (VERSION I).
5. search:
   - query plain, ZCL*, *B, * and empty; search= as an alias;
   - objectType DEVC/K, CLAS/OC, PROG; objectType= empty with type=CLAS;
   - maxResults absent, 0, 1, 3 (when packages fill it), -1, 2.5, abc, 1e1, ' 7 ';
   - query with %20 and with + (qs gives a space);
   - library hits.
6. vfs: facets; contents with:
   - an empty facetorder over one package, ..P, several packages, or none;
   - facetorder package (with and without own objects), group, type, api, fav;
   - objectSearchPattern absent, empty, ZCL*, *X*;
   - a duplicated preselection facet (Map position), a value with &amp;, an upper-case facet attribute, an unknown package.
7. Query robustness: % at the end of query= and %zz in a value. Node keeps them literal; today the shim's unescape_url throws (see risks), so this case is red until that is fixed and documents it.
8. Performance: medians of 20 for nodestructure, packages/:name, search and vfs contents over the full repo tree, Node-only against the ABAP front, the same method as abap-skeleton.md.

Red proof, each mutation must fail at least one case:
- an ABAP SORT on the PACKAGE/PACKAGES lists ($ZT_A);
- || instead of ?? for parent_name;
- dataname matched case-sensitively for classFolders;
- the flat rule dropped;
- NODE_ID started at 0;
- the node-key map off by one;
- the seed limit max instead of max*4;
- NaN treated as 0;
- packages not counted against max;
- vfs Map that moves a repeated facet to the end;
- XML unescape of vfs values;
- ESC dropped on CTEXT;
- an ETag set by ABAP;
- the blank line of empty tables removed;
- the trailing newline added to the one-line documents.

ABAP Unit: TREE=>NODE_STRUCTURE over the test/adt-facade.mjs:8 fixture (port-map reuse note), JS=>NUMBER and JS=>GLOB tables, and ENCODE_COMPONENT.

Existing suites must stay green: adt-facade, adt-devloop (it mounts the ABAP front), adt-abap-diff, osd-routes and zosd-test cloud tree. The ABAP-FS conformance run (--start) must not be worse than its expected.json (30 PASS / 1 FAIL / 16 MISSING); its tree, reveal and quickSearch scenarios cover nodestructure, nodepath, objecttypes and search. Run npm run lint (7-bit ASCII) on src/adt.

## Risks

- Query parsing differs before any route runs. The front hands originalUrl to cl_express_icf_shim, which fills form fields through cl_http_utility=>string_to_fields. That function does not decode names, does not turn '+' into a space (axios, and so abap-adt-api/ABAP-FS, sends spaces as '+'), and keeps repeated names as separate rows. Its unescape_url is decodeURIComponent in a kernel line, so query=50% raises a URIError that no CATCH reaches, and the front then answers 500 where Node answers normally with the '%' kept. Fix it before search, nodestructure and nodepath move: either the front-up record (slice 3 B, the front builds the record from req.query) or a tolerant string_to_fields upstream. ZCL_OSD_ADT_URI=>QUERY must give qs semantics either way.
- Ordering is host collation. store.packages(), store.package().objects and LIST sort with localeCompare (ICU), and store.search returns index order. The contract is that ABAP never re-sorts host lists. A future Bun binary may order differently from Node, but both sides of the diff read the same host, so byte equality holds while the order changes per host. Flag it in docs, since it is invisible otherwise.
- Miss registry: packages/:name and nodestructure record an 'object' miss on 404 through answer(), but nodepath does not. ABAP 404s do not reach facade.missed yet (abap-skeleton.md, 'Not in slice 1'). This family is the first where that loses information (/osd/not-served). It needs a marker: ZCX_OSD_ADT=>NOT_FOUND with a record flag, and an X-OSD-Miss header the front strips and records. nodepath must not set it.
- Two Node defects that byte equality cannot reproduce. nodepath with a malformed %XX in the uri, and any host throw in vfs contents, are unhandled rejections in async Express 4 handlers: the request hangs with no answer. Fix them in Node first (wrap in answer(), so a 400 or 500 exception document), as port-map does for identity escaping. Otherwise those diff cases cannot exist.
- JSON volume: vfs contents asks PACKAGES with every object (about 1500 objects, roughly 100-150 KB) and is called about 19 times while a cloud project builds its tree. zcl_ajson in transpiled code may cost tens of ms per call. Measure it. The fallback is ET_OBJECT (ZOSD_OBJECT_S), but its NAME is CHAR 40, PACKAGE CHAR 30 and it has no LIBRARY column, so it would truncate long or namespaced names. Prefer compact JSON (arrays of arrays) before reaching for it.
- Case mapping: JS toUpperCase/toLowerCase and ABAP to_upper/to_lower differ outside ASCII (for example the German sharp s ß becomes SS in JS). Take upper-cased names from host answers (PACKAGE returns name) and keep tests ASCII. Non-ASCII package names are out of scope and should be documented.
- Regex portability: the Node parsers use lazy [\s\S]*? and JS \w. Written as ABAP REGEX they would run transpiled (the JS engine) and fail on a 7.02 system (POSIX, no lazy quantifiers). Use FIND with offsets and the hand-written GLOB.
- Session user source changes under slice 3: in the mixed phase it comes from SYSTEM SESSION, and after the front moves up from the resolved ZIF_OSD_ADT_SESSION. Both paths must give the same upper-cased Basic user, or the $TMP views diverge.
- 500 texts: the existing ZCL_OSD_ADT_HOST methods prefix EV_ERROR ('OBJECT T N: ...'), while Node's answer() sends the raw message. The new methods must not prefix. Host-fault 500s from OBJECT (nodepath, class nodes) stay off by the prefix unless OBJECT's prefix is dropped, which touches the LOCK diff test.
- Invalid UTF-8 in a POST body: Node's toString('utf8') substitutes U+FFFD, while cl_abap_codepage=>convert_from may raise. Accept the difference and document it, or decode leniently.
