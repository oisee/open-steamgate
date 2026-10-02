# osd-introspection (port-map group D, units D1-D4: core/http/build, changed, git/object, git/object/revision, services, transactions, segw/entitysets, xref/readers, xref/closure)

- Recommendation: **port-to-abap**
- Effort: L
- Owner: Proposed (group D is unassigned). The split is:
- dell leads the family. xref/readers, xref/closure and segw/entitysets are where-used and repository-read logic next to group B's where-used. build/changed/services/transactions ride the SYSTEM skeleton dell already owns.
- git/object and git/object/revision go to stoker. They sit on the git helpers next to versions (HISTORY/REVISION), and stoker knows the gitObjectRevision vs gitObjectRevisionAt difference.
- If one owner is required: dell.
- Depends on: skeleton slices 1-2 (router, handler, ZCX_OSD_ADT, ZCL_OSD_ADT_HOST, SYSTEM binding via withSystem) -- landed, slice 3 front decision B (every /sap/bc/adt request enters ABAP first) -- not strictly required (an ABAP row already works with today's front), but the liveness mitigation for core/http/build must land with or before it, for D-b: ABAP miss registry rule agreed (these 404s record no miss), nothing from 4a/4b; independent of groups A, B, C

## Routes

### GET `/sap/bc/adt/core/http/build` (adt-facade.mjs ~1165)

200 application/json; charset=utf-8, JSON.stringify of {build: facadeBuildStamp() (sha256 over 8 tools/*.mjs files resolved off import.meta.url, first 16 hex, cached), generation: liveHash(store.root) (basename of the 'live' symlink; key DROPPED when undefined), commit: sourceCommit() (GITHUB_SHA, else release.json in store.root or cwd, else git rev-parse HEAD, else 'unknown'; cached per adtRouter), system: undefined (key dropped) when store.root undefined, else {source: hashOf(root) (~105 ms), live, serving: store.served.running ? store.served.generation : null, database:{serving: served.database ?? 'memory' | null, preview: data.source ?? 'in-process'}, synchronized}, started: module-level STARTED ISO (process start), identity: the facade instance's identity object (systemID,userName,userFullName,client,language + options.identity spread)}. No refusal path. No ETag (app.set('etag', false) in test/start.mjs and osd-serve; a harness that leaves etag on gets a weak ETag from express). Consumers: osd ready (2 s timeout, reads system.serving), release smoke/run.ps1, osd-restart.sh, osd-child, osd-binary, workbench-w2, protocol-rfc, replay-compare.

### GET `/sap/bc/adt/core/http/changed` (adt-facade.mjs ~1216)

200 application/json; charset=utf-8, {objects, reason}: objects = store.changedObjects() = [{type,name,base}] for CLAS/INTF whose file sha256 differs from the warm compiler's digests, in ObjectStore #entries() Map order (not sorted); undefined (key dropped) when the warm registry is not primed, then reason = 'OSD_WARM is not 1' when warm().on !== true else warm().reason; reason dropped when objects defined. Without OSD_WARM the body is exactly {"reason":"OSD_WARM is not 1"}. No refusal path.

### GET `/sap/bc/adt/core/http/git/object` (adt-facade.mjs ~1229)

query type (split at '/', [0], toUpperCase), name (toUpperCase). store.read(type,name) then gitObjectState(store.root, entry.file) (tools/osd-git-history.mjs: 4-6 execFileSync git calls: rev-parse, symbolic-ref, ls-files, status --porcelain, check-ignore, diff HEAD, log -n 20). 200 application/json; charset=utf-8 {available:false, reason, file} or {available, branch, detached, unborn, head, headShort, file, tracked, status (ignored|untracked|clean|modified), diff (full unified diff text, or a synthesized new-file diff for untracked), history:[{revision, shortRevision, author, authoredAt, subject}] (20 max)}. Refusals via refuse() (application/xml, namespace com.sap.adt, no miss recorded): NotFound -> 404 ExceptionResourceNotFound error.message; anything else -> 500 ExceptionGitHistory.

### GET `/sap/bc/adt/core/http/git/object/revision` (adt-facade.mjs ~1246)

query type/name as above, revision. store.read then gitObjectRevision(root, file, revision): revision must be /^[0-9a-f]{40}$/ after toLowerCase else Error 'A Git revision must be a full 40-character commit SHA.' (capital G -- differs from gitObjectRevisionAt used by the existing REVISION command: 'A git revision ...'); git log --diff-filter=AM -n 1 must return the same sha else 'Revision <12> is not a version of <file>.' (no rename following, unlike REVISION); body = git show sha:file, final newline kept. 200 text/plain; charset=utf-8. Refusals: NotFound -> 404 ExceptionResourceNotFound; anything else (incl. bad sha) -> 400 ExceptionGitRevision.

### GET `/sap/bc/adt/core/http/services` (adt-facade.mjs ~1361)

200 application/json; charset=utf-8 {services:[...], counts:{<kind>:n}}. Rows from serviceTree(store.root) (tools/osd-status.mjs: registeredServices(segwRegistrations(generatorFoldersOf)) + icfServices + pushChannels + appsOf, packOf via packsOf/layers owner map, sorted by path localeCompare, reads OSD_PACKS env). Per row key order: kind,name,path,text,pack,handler,handlerUri,handlerSource,app,mpc,mpcUri,mpcSource,helpers,source; undefined keys dropped (APP rows: no handler*, has app; ODATA only has mpc). handlerUri/mpcUri = uriOf('CLAS',name) only if store.exists; *Source = store.read('CLAS').file (tree-relative path). helpers: ODATA -> [<mpc with _MPC_EXT->_MPC_ANN>, ZCL_STG_SEGW_REGISTRY, ZCL_STG_SHLP_REGISTRY, ZCL_STG_FM_REGISTRY], APP -> [ZCL_STG_BSP_REGISTRY], filtered by store.exists, each {name, role: annotations|registry, uri, source}. counts keys in first-seen order of the sorted rows. Any throw -> 500 ExceptionInternalError, namespace com.sap.adt (NOT the osd namespace zcx_osd_adt=>internal uses).

### GET `/sap/bc/adt/core/http/transactions` (adt-facade.mjs ~1407)

200 application/json; charset=utf-8 {transactions:[...]}: transactions(generatorFoldersOf(root) folders) (tools/osd-tran-registry.mjs: winningByLayer walk, reads EVERY *.clas.abap of every layer to test INTERFACES <contract>, parses TRAN xml; sorted by tcode localeCompare), each row = {...one (tcode,text,program,dynpro,className,method,... , file:undefined kept in position then dropped), reason, runnable, kind, source: relative(root,file), package, layer (store.locationOf spread; absent when undefined), programSource: store.find(CLAS|PROG).file}. Throw -> 500 ExceptionInternalError com.sap.adt.

### GET `/sap/bc/adt/core/http/segw/entitysets` (adt-facade.mjs ~1430)

query class (toUpperCase); '' -> 400 ExceptionInvalidRequest 'class is required'. registrations = segwRegistrations(generatorFoldersOf) (NOT filtered by registeredServices; first entry with dpc.toUpperCase() === class wins; order = layer index then service localeCompare). entitySetMapFor: needs entry.dpc and entry.mpc; dpc/mpc source = own source + (if *_EXT) base class source joined by '\n', read via store.read('CLAS').source (missing -> undefined). undefined -> 404 ExceptionResourceNotFound '<NAME> is not a registered service's _DPC_EXT with a known MPC'. 200 application/json; charset=utf-8 {class, service: external||service, mpc, sets:[{method, kind, set}]}: all get_entityset matches first (regex /^[ \t]*METHOD\s+(\w+)_get_entityset\s*\.[ \t]*$/gim), then get_entity; set from MPC constants TYPE *ty_e_med_entity_name* VALUE '...' plus ->create_entity_set('...') (later wins in byLower map), lowercase match; 16-char prefixes resolved by unique startsWith; dedupe by 'kind method'. No try/catch: a throw from segwRegistrations reaches express' default 500 HTML handler (not an ADT document).

### GET `/sap/bc/adt/core/http/xref/readers` (adt-facade.mjs ~1474)

query type (toUpperCase) must be CLAS|INTF else 400 ExceptionInvalidRequest 'type must be CLAS or INTF'; name '' -> 400 'name is required'; !store.exists -> 404 ExceptionResourceNotFound '<TYPE> <NAME> does not exist'. includes = warm compiler readersOf(type,name) names (source 'warm') else data.query UNION over WBCROSSGT/WBCROSSGTX otype='TY' name=N include<>N, max 5000 rows, uppercased (source 'xref'). typeOf = Map(store.list() name->type, last wins). registrations = registeredServices(segwRegistrations). testClasses = testClassesIn(root) with ' (...)' suffix stripped. readers = dedupe, drop name, plain .sort() (UTF-16 code-unit order), map {type (|| 'UNKNOWN'), name, include, isTest, services: registrations with r.dpc === include (case-sensitive) -> external}. counts.services = countServiceRegistrations(readers, CLAS ? serviceTree(root) : [], name) = |{'/SAP/OPU/ODATA/SAP/'+svc upper} U {row.path upper where handler or mpc upper === name}|. 200 application/json; charset=utf-8 {name, source, readers, counts:{readers,tests,services}}. Throw -> 500 ExceptionInternalError com.sap.adt.

### GET `/sap/bc/adt/core/http/xref/closure` (adt-facade.mjs ~1540)

type CLAS|INTF and name required else 400 ExceptionInvalidRequest 'type (CLAS or INTF) and name are required'; !exists -> 404 '<TYPE> <NAME> does not exist'. closure = warm closureOf(type,name) [{type,name}] (source 'warm', truncated false) else DFS: seen={name}, todo=[name], while todo && seen.size < 5000: pop, UNION query (no include<>name filter, max 5000), push unseen uppercased; truncated = todo.length>0; closure = seen in insertion order mapped {type: root?type:typeOf||'UNKNOWN', name}. objects = {...o, isTest: type==='CLAS' && tests.has(name)} sorted by name localeCompare (ICU collation: '_' and '/' before digits before letters). 200 application/json; charset=utf-8 {type, name, source, truncated, closure, tests:[names], counts:{objects,tests}}. Throw -> 500 ExceptionInternalError com.sap.adt.

## Host dependencies

- EXISTING SYSTEM IDENTITY (tools/osd-store-destination.mjs SYSTEM_KINDS) -- reused only indirectly; build's identity block comes from the new BUILD kind so the per-instance identity spread stays one object
- EXISTING STORE OBJECT (found/type/name/writable) -- enough for store.exists in readers/closure (404 path); it uses the bound facade store via withSystem
- EXISTING STORE READ (EV_SOURCE) -- entitysets reads the DPC/MPC (+ base without _EXT) sources; EV_ERROR treated as 'no source' exactly like the Node readSource catch
- NOT REUSABLE: STORE LIST (cut at IV_LIMIT, filtered, sorted, and maps every row through store.find+stateOf -- too expensive and wrong shape for the name->type Map), STORE HISTORY/REVISION (REVISION uses gitObjectRevisionAt: follows renames, different error text 'A git revision', answers EV_VERSION; the route uses gitObjectRevision). Do not 'extend' them; byte-equality breaks.
- NEW SYSTEM envelope: when a kind's answer carries a string field `raw`, #system puts it into EV_SOURCE untouched and JSON-encodes the rest into EV_JSON; ZCL_OSD_ADT_HOST gets SYSTEM_RAW( iv_kind iv_name ) -> {status, type, message, content_type, body}. Reason: finished bodies (git diff text, revision source, the services JSON) must not round-trip through JSON string escaping + zcl_ajson unescape (\u00XX controls, U+2028, astral chars, CR).
- NEW SYSTEM BUILD (IV_NAME '') -> raw = the finished /core/http/build JSON text. Host: move the route body into a closure buildAnswer() inside adtRouter (needs facadeBuildStamp, liveHash, sourceCommit, hashOf, store.served, data.source, STARTED, identity) and answer it from the abapSession system callback (adt-facade.mjs :693, today `kind === 'IDENTITY' ? identity : undefined`). Per facade instance, never process-wide.
- NEW SYSTEM CHANGED -> raw = JSON of {objects, reason} (store.changedObjects, store.warm)
- NEW SYSTEM GIT_OBJECT (IV_NAME 'TYPE NAME') -> raw = gitObjectState JSON, or {refuse:{status:404,type:'ExceptionResourceNotFound',message}} / {refuse:{status:500,type:'ExceptionGitHistory',message}}
- NEW SYSTEM GIT_REVISION (IV_NAME 'TYPE NAME SHA', or IV_NAME 'TYPE NAME' + a new IV_REVISION pass-through) -> raw = blob text, or refuse 404 / 400 ExceptionGitRevision with gitObjectRevision's exact messages
- NEW SYSTEM SERVICES -> raw = the finished {services, counts} JSON (serviceTree + classUri/classSource/helpers, all of which need store.exists/read/uriOf and host-relative file paths); refuse 500 ExceptionInternalError (namespace com.sap.adt) on throw
- NEW SYSTEM TRANSACTIONS -> raw = the finished {transactions} JSON (transactions(generatorFoldersOf), locationOf, find().file); refuse 500 on throw
- NEW SYSTEM SEGW_REGISTRATIONS -> [{service, external, dpc, mpc}] in segwRegistrations order, UNFILTERED, plus a flag `registered` per row = member of registeredServices (readers needs the filtered set, entitysets the unfiltered first-match)
- NEW SYSTEM SERVICE_ROWS -> [{path, handler, mpc}] of serviceTree(root) for countServiceRegistrations (only path/handler/mpc are read)
- NEW SYSTEM TESTCLASSES -> [names] = testClassesIn(root) with the ' (...)' suffix already stripped (host walks abap_transpile.json input folders + exclude_filter)
- NEW SYSTEM XREF_WARM (IV_NAME 'READERS|CLOSURE TYPE NAME') -> {available:false} or {objects:[{type,name}]} from store.warm().compiler.readersOf/closureOf (host-only state: the warm abaplint registry)
- NEW SYSTEM OBJECT_TYPES (IV_NAME space-separated names, or IV_SOURCE for long lists) -> {NAME: type} built exactly as new Map(store.list().map(o=>[o.name,o.type])) (last entry wins on a name held by two types), answered for the asked names only
- NATIVE (no host): WBCROSSGT / WBCROSSGTX (src/osd/ddic, OTYPE CHAR2, NAME CHAR120, INCLUDE CHAR40), seeded by tools/osd-xref-seed.mjs at host start, read with Open SQL in the step on the serving connection
- All new kinds go into SYSTEM_KINDS and into the adtRouter binding; in child mode (STG_SERVE=child) the parent loads no ABAP and the Node routes keep answering, so the Node route bodies are refactored into the same shared functions rather than deleted

## Rationale

These nine routes are reads with no after-step work. Nothing rebuilds, swaps a generation or waits, so a host continuation buys nothing and the choice is port vs stay-host. Under design B (slice-3-front.md) every /sap/bc/adt request already takes one ABAP step, and a HOST row costs that step plus the Node route. An ABAP row that asks the host once through SYSTEM costs the same, so "stay-host" saves nothing at runtime. Its only effect would be to block the milestone's done criterion. So all nine get ABAP rows, at two depths that the code justifies.

(1) Thin rows: build, changed, git/object, git/object/revision, services, transactions. Their answers are host state: the live symlink, hashOf over the tree, store.served, git subprocesses, the warm registry's digests, file walks over TRAN/IWSV/IWMO/packs/manifests, and tree-relative file paths. ABAP owns the row, the query parse, the validation and the refusal mapping. The host owns the finished body through one SYSTEM kind per route. The Node route body moves into a shared function that both the Node route (child mode) and the kind call, so the body is byte-equal by construction. Two ABAP-native alternatives exist, and both were costed and rejected:
- services from ZOSD_SVC: the table has PATH/KIND/HANDLER_NAME/TEXT/PACK only. It lacks name, mpc, source, *Uri, *Source and helpers. It is refreshed by ZCL_OSD_STATUS on its own schedule, not per request. Matching Node would take three new columns, a refresh-on-read and N×5 OBJECT calls for helper existence. That is about L, for a body that is still made of host paths.
- transactions from the generated TRAN registry class: it lacks source, package, layer and programSource.
Neither runs anywhere a host does not, because OSGo has no git and no tree, so a native port gains no portability.

(2) Real ports: segw/entitysets, xref/readers, xref/closure.
- The logic runs over data ABAP can reach: Open SQL over WBCROSSGT/WBCROSSGTX, the regex scan over sources it gets from READ, and the pure countServiceRegistrations.
- The host supplies only lists it alone can walk: registrations, service rows, test classes, the warm reverse index and the name→type map.
- Port-map units D3/D4 asked for this split, and it is where ABAP adds a real capability: where-used over the system's own cross-reference tables, as a system would answer it.

One honest exception to watch is build. It is the liveness probe (`osd ready` 2 s, smoke 3 s, run.ps1 2 s). Behind the work-process FIFO, a long activation or unit-run step makes it time out. That is true under design B whether the row is ABAP or HOST, so it is not an argument for HOST. The fix is in the front: answer build, or a host-only /osd/ready, before the step. Keeping a HOST row would not fix it.

## ABAP design

Two route classes, rows in ZCL_OSD_ADT_ROUTER=>ROUTES. All of them are literal GET rows, none per type. They go before the HOST catch-all, and the order among them matters for one pair only: `core/http/git/object/revision` must not be shadowed. The patterns differ in segment count, so the matcher already separates them, but list revision first anyway, the way Express registration order does. HEAD falls through to these GET rows (body dropped, Content-Length kept), as Express does. New rows also go in test/adt-abap-diff.mjs's matcher-equality case.

Slice D-a, ZCL_OSD_ADT_INTROSPECT (thin, about 200 lines). One class serves 6 rows and switches on the lower-cased path suffix after /sap/bc/adt/core/http/.
- A query helper `query( name )` reads the FIRST tihttpnvp entry. It is pinned against Express for a repeated param: req.query is an array, and String(arr) gives 'a,b'. The helper joins the repeated values with ',' to match.
- type = to_upper( segment before the first '/' ), name = to_upper( value ).
- Each route calls ZCL_OSD_ADT_HOST=>SYSTEM_RAW( kind, name ):
  - build → BUILD
  - changed → CHANGED
  - git/object → GIT_OBJECT 'TYPE NAME'
  - revision → GIT_REVISION 'TYPE NAME SHA'
  - services → SERVICES
  - transactions → TRANSACTIONS
- On `refuse`, raise `NEW zcx_osd_adt( iv_status iv_type iv_message )` with the default namespace com.sap.adt. Never zcx_osd_adt=>internal( ): Node's refuse() writes com.sap.adt, and internal( ) writes org.open-steamgate.osd.
- Otherwise status 200, content_type `application/json; charset=utf-8`, or `text/plain; charset=utf-8` for revision, and body = raw.
- A SYSTEM transport failure stays internal( ) (500, osd namespace), as sysinfo does. That case has no Node twin, because the host is absent.

Host side for D-a:
- In osd-store-destination.mjs #system, add the `raw` → EV_SOURCE split. EV_SOURCE is already in EMPTY and the ZOSD_STORE signature.
- In adt-facade.mjs, extract buildAnswer/changedAnswer/gitObjectAnswer/gitRevisionAnswer/servicesAnswer/transactionsAnswer, each returning {raw} | {refuse}. The Node routes become `send(res, answerOf(...))`. The adtRouter system callback answers the six kinds from the same functions.

Slice D-b, ZCL_OSD_ADT_XREF (readers, closure) and ZCL_OSD_ADT_ENTITYSETS, about 450 lines, plus helpers.
- readers:
  - Validate in Node's order: type, then name, then OBJECT found → not_found( `<TYPE> <NAME> does not exist` ) (404 ExceptionResourceNotFound com.sap.adt).
  - XREF_WARM READERS: if available, names as given and source 'warm'. Else two SELECTs (`SELECT include FROM wbcrossgt WHERE otype = 'TY' AND name = lv_name AND include <> lv_name`, then the same on wbcrossgtx; there is no UNION in 7.02), each UP TO 5000 ROWS, merged, to_upper, SORT + DELETE ADJACENT DUPLICATES, cut to 5000, source 'xref'.
  - Drop name, then plain SORT (binary order equals JS code-unit order for these names).
  - OBJECT_TYPES for the names; SEGW_REGISTRATIONS filtered to registered=true; TESTCLASSES; for CLAS also SERVICE_ROWS.
  - countServiceRegistrations as a sorted unique string table.
  - The JSON is built by hand in key order name, source, readers[type, name, include, isTest, services[]], counts{readers, tests, services}. Booleans are bare true/false and numbers are unquoted.
- closure:
  - XREF_WARM CLOSURE, else the DFS with an explicit stack: pop = last line, the 5000 cap, seen as a hashed table plus an insertion-order table, truncated = stack not empty.
  - Same isTest rule (CLAS only).
  - Sort with a new ZCL_OSD_JS_COLLATE=>KEY( name ), which maps each character to an ICU-root primary rank. The order is whitespace, then `_ - , ; : ! ? . ' " ( ) [ ] { } @ * / \ & # % ` ^ + < = > | ~ $`, then digits, then letters case-folded with lowercase-before-uppercase as the tie-break, compared lexicographically.
  - The existing ZCL_STG_SEGW_GEN_DPC=>SORT_KEY trick (replace '_' with '/') is wrong once a name holds both characters, and should move onto the shared helper.
- entitysets:
  - class from the query, '' → invalid_request( `class is required` ).
  - SEGW_REGISTRATIONS unfiltered, first row with to_upper( dpc ) = class, then READ for dpc, dpc minus _EXT, mpc and mpc minus _EXT. A READ error means no source.
  - None → not_found( `<NAME> is not a registered service's _DPC_EXT with a known MPC` ).
  - The scan runs per line after SPLIT at newline with a trailing CR stripped. This replaces the /gim multiline anchors, whose ^/$ treatment of CR differs between the transpiled JS RegExp and a system's POSIX engine. The patterns are `^[ \t]*METHOD\s+(\w+)_get_entityset\s*\.[ \t]*$` IGNORING CASE and the CONSTANTS/create_entity_set patterns with SUBMATCHES. Note that the CONSTANTS pattern can span lines (\s+), so it runs over the whole text, not per line.
  - Output order: every get_entityset first, then every get_entity. The 16-char prefix rule and dedupe follow Node.
- JSON string escaping: move ZCL_OSD_ADT_SYSINFO=>JSON_STRING to a shared ZCL_OSD_ADT_JSON. Fix its gaps first. It does not escape the other C0 controls as \u00XX, which JSON.stringify does, and it is fed `cr_lf(1)`, which is CR. Both are fine for object names but matter if a reused caller hands it free text.

## Test plan

Extend test/adt-abap-diff.mjs. Each case mounts the ported façade and the Node façade (OSD_ADT=js or no abap option) over the SAME ObjectStore and data instance, with the same STARTED. Each case compares {status, content-type, etag, content-length, body} byte for byte and checks X-OSD-Served-By / the abapServed callback, to prove that ABAP answered.

D-a:
- build: a tree with git (the versions fixture pattern: git init + 2 commits) and one without. Run once with store.root undefined, so the system key is dropped, and once with liveHash undefined, so the generation key is dropped. Assert key order. Pin that two instances with different identities each answer their own (interleaved, like the identity case at :325).
- changed: OSD_WARM unset gives {"reason":"OSD_WARM is not 1"}; a primed warm store with one edited class gives objects in map order.
- git/object: clean, modified (diff text with a tab, CR, a UTF-8 non-ASCII line and U+2028, which proves the raw channel), untracked (synthesized diff), ignored, unborn repo, no worktree (available:false). Also type `CLAS/OC` (split), lower-case name, unknown object → 404 document, and git missing from PATH → 500 ExceptionGitHistory with the com.sap.adt namespace.
- revision: a valid sha gives byte-equal source including the final newline and a file without one. Also: 39-char sha, upper-case sha (accepted, lowered), a sha that is not a version of the file, a sha before a rename (400 with gitObjectRevision's text, NOT REVISION's), unknown object → 404.
- services and transactions: the demo tree (ODATA, ICF, APC and APP rows, with helpers present and absent), plus a forced throw (store.root pointing at a removed folder) → 500 com.sap.adt.
- HEAD on each: same headers, no body.
- Repeated query param `?type=CLAS&type=INTF` pinned against Express.

D-b:
- readers on a class with WBCROSSGT and WBCROSSGTX rows (overlapping, with a self-reference row, lower-case INCLUDE in a seeded row), a reader that is a test class, one that is a registered DPC, an MPC handler row for the services count, and an INTF.
- readers refusals: type=PROG, empty name, an unknown object.
- readers with the warm registry primed (source 'warm'). This needs OSD_WARM=1 and a prime in the test, and is skipped with a message when the warm compiler is not built.
- closure on a 3-level chain with a cycle. Plus a name set chosen to break naive sorting, as ABAP Unit: ZCL_A_B vs ZCL_AB vs ZCL_A1 vs /NS/ZCL_X vs ZCL_A=. Expected order is computed by calling localeCompare in the mocha test and handed to ABAP, so ZCL_OSD_JS_COLLATE is checked against V8 directly. Run it once over every name in store.list() of the demo tree.
- closure truncation: make the cap a class constant that a test subclass or friend lowers to 3, and compare against Node with LIMIT injected. Node's LIMIT is a local, so add an `options.xrefLimit` seam; until that exists, prove the cap in ABAP Unit only and say so.
- entitysets:
  - the demo DPC_EXT (classic constants)
  - an STG-generated MPC (create_entity_set only)
  - a 16-char prefix that is ambiguous and one that is unique
  - a source with CRLF line ends
  - a class that is not a DPC → 404
  - no class → 400
  - an _EXT whose base is missing.
- Red proof for each slice: flip the row to HOST and the served-by assertion fails. Break one byte (for example, drop the namespace override and let internal( ) through) and the refusal case fails. Run once with the shared-function refactor reverted in the SYSTEM callback only, to show that the diff catches drift.
- Gate 1 consumers also run unchanged in both modes: adt-devloop :491/:501/:515-603/:558/:581, vscode-extension :3509 / ~2401, osd-child, osd-binary, workbench-w2.

## Risks

- Liveness: build is the readiness probe (bin/osd.mjs ready 2 s, release smoke 3 s, run.ps1 2 s, osd-restart.sh). Under design B it waits behind the work-process FIFO whether its row is ABAP or HOST, so a long activation or unit step makes `osd ready` report not-ready. Mitigation belongs to the front: answer build, or a host-only /osd/ready, before the step. Decide this before slice 3's front move, not in this family.
- Namespace trap: every 500 refusal in this family is refuse(...,'ExceptionInternalError') with namespace com.sap.adt; zcx_osd_adt=>internal( ) uses org.open-steamgate.osd. Using the factory breaks byte equality on every error path. ExceptionGitHistory (500) and ExceptionGitRevision (400) have no factory, so they need the constructor.
- Miss registry: Node's refuse() records NO miss for these 404s. When the ABAP miss registry lands (port-map step 4: NotFound records an `object` miss), these 404s must not be recorded, or /osd/not-served diverges.
- JSON round-trip: finished bodies with diff text or sources must not go through EV_JSON + zcl_ajson get_string. Use the proposed `raw` to EV_SOURCE channel, or expect drift on \u escapes, CR, U+2028 and astral characters.
- Two git helpers with different semantics: the route uses gitObjectRevision (no rename following, 'A Git revision ...'); the existing REVISION command uses gitObjectRevisionAt ('A git revision ...', follows renames). Reusing REVISION looks natural and breaks both the error text and the rename case.
- Collation: closure sorts by localeCompare (ICU, '_' and '/' before digits and letters, case tertiary); readers sorts by code units. Getting either one wrong only shows on names mixing '_', digits and namespaces, and the existing sort_key hack in ZCL_STG_SEGW_GEN_DPC is already wrong for names with both '_' and '/'.
- Closure truncation is order-dependent: which 5000 objects are 'seen' depends on the DFS pop order and on the order of SQLite's UNION output (sorted-distinct in practice, not guaranteed). ABAP sorts explicitly. The two agree only while SQLite keeps returning the UNION sorted. Pin it with a small-limit test.
- Database identity: Node's xref branch queries `data.query` (the façade's preview data source); ABAP's Open SQL hits the serving step's DEFAULT connection. They are the same database only when system.database.preview === 'serving' or the runtime is in-process. A façade with a separate `data` option (tests) gives different rows; the diff tests must hand both the same connection.
- Stale reads: WBCROSSGT is seeded at host start and not on a warm swap, so the 'xref' answers are as stale on both sides. That is no regression, but a diff test that builds between the two calls sees the warm branch in one and not the other. Keep the store still for the length of a case.
- Child mode: in STG_SERVE=child the parent loads no ABAP and the Node routes keep answering, so the Node route bodies cannot be deleted. They are refactored into the shared functions the SYSTEM kinds call. If someone edits the Node route instead of the shared function, the two drift, and only the diff test catches it.
- Volume over the destination: SERVICES/TRANSACTIONS answers are tens of KB, and TESTCLASSES/OBJECT_TYPES can carry 1500+ names through one RFC-shaped call per request. That is fine on Node; on the OSGo destination it needs measuring. transactions also reads every *.clas.abap of every layer per request (host cost, unchanged, but now inside the step).
- Express quirks to pin rather than reproduce blindly: a repeated query param becomes an array, so String() gives 'a,b'; `type[x]=1` becomes '[object Object]'; JS toUpperCase vs ABAP to_upper differ on non-ASCII (ß→SS). Names are ASCII in practice; pin with a test and do not chase.
- segw/entitysets has no try/catch in Node: a throw from segwRegistrations gives Express's default 500 HTML page, not an ADT document. ABAP will answer the ADT exception document instead. Accept and document this one deliberate non-equality, or wrap the Node route first (preferred: fix Node, then port).
