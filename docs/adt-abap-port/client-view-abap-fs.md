# abap-fs client view of the ADT facade (read-only research, 2026-10-01)

Sources (clean room, MIT only): abap-adt-api 8.4.3 tarball (`npm pack`, LICENSE MIT, readable build/*.js, in scratchpad `api/package`). Cross-checked by string/function search in the abap-fs 2.9.1 bundle (same function bodies present, e.g. `debuggerStackTrace`, `featureDetails`). The clone at /mnt/safe/@wsl/vibing-steampunk/abap-adt-api is MIT but 7.0.0 and older than what abap-fs ships, so only used as a licence check. Server side: `git show origin/main:tools/adt-facade.mjs` and `tools/adt-documents.mjs`.

## Client mechanics (apply to every call)

- Every request carries `x-csrf-token` (first `fetch`, then the token returned), `X-sap-adt-sessiontype: stateless|stateful`, `Accept: */*` default, `Cache-Control: no-cache`, cookies replayed by hand. Basic auth, or bearer.
- Login = `GET /sap/bc/adt/compatibility/graph?sap-client&sap-language` with token fetch. Body is never parsed by abap-adt-api. The same URL is the keepalive (every 120 s) and `dropSession`. Logout = `GET /sap/public/bc/icf/logoff`.
- On a 401/403-style login error and not stateful, it clears the token, logs in again and retries once. A 403 on a write therefore costs the retry.
- Write operations call `ValidateStateful`: lock, PUT source, delete, create include all throw client-side if the client is not in `stateful` session mode. The lock must live in the same session as the PUT.
- `ValidateObjectUrl` rejects anything not starting `/sap/bc/adt/`.
- Parsing uses fast-xml-parser with **prefixes kept** (`fullParse`, no namespace stripping). So element names are matched literally: `chkl:messages` and unprefixed `msg` are different keys. The only call that strips prefixes is the debugger and ATC users.

## Table 1 - paths the client uses that we serve

| Client call (method path ; query) | What it reads | Our response / verdict |
|---|---|---|
| GET `compatibility/graph` | nothing (status 200 + token header) | OK. abap-fs itself never reads the graph; Eclipse does. |
| GET `core/discovery`, `/discovery` | `app:service/app:workspace[]` with `atom:title`, `app:collection@href`, `atom:title`, `atom:category@term` (core), `adtcomp:templateLinks/templateLink` attrs | Served. **Gate titles:** abap-fs looks up workspace **title** "Change and Transport System" holding href exactly `/sap/bc/adt/cts/transportrequests`, and title "abapGit Repositories". Our WORKSPACE() titles are only Data Dictionary / Repository / Development Loop / Source Library, and `cts/transportrequests` is not advertised. See table 3. |
| GET `/sap/bc/adt/{class,intf,prog,...}/:name` (objectStructure; `version`) | root = first element (`xmlRoot`); all attributes; `adtcore:changedAt/createdAt` Date.parse; `atom:link[]`; for classes `class:visibility` on root (decides class vs other) and `class:include[]` each **requiring** `atom:link` array, `class:includeType`, `abapsource:sourceUri` | Served (classDocument, source-properties doc). Comments in code show these were already fixed (class:include links). Risk: if `class:visibility` is missing on root, abap-fs throws "Operation not supported for object CLAS/OC". Non-class objects must carry `abapsource:sourceUri` or a `text/plain` `atom:link`, else source URL falls back to object URL. |
| GET `<obj>/objectstructure?version=active&withShortDescriptions=true` | `abapsource:objectStructureElement` tree: `adtcore:name/type/description`, `visibility`, `level`, `constant`, `constructor`, `testmethod`, `redefinition`, `final`, `atom:link[]`; errors swallowed (returns []) | Served. Prefer-name check: client also reads `xml:base`-free. OK. Errors are swallowed so a failure shows only as an empty outline. |
| GET `<src>` (`/source/main`, `/includes/:i`; `version`) | body as text | Served. Git-user headers `Username`/`Password` are sent for abapGit-backed reads, ignored by us. |
| POST `<obj>?_action=LOCK&accessMode=MODIFY` ; Accept `application/*,application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result` | `asx:abap/asx:values/DATA[0]`: `LOCK_HANDLE`, `IS_LOCAL`, `CORRNR`, `CORRUSER`, `CORRTEXT`, `IS_LINK_UP`, `MODIFICATION_SUPPORT` | Served. **Mismatch candidate:** abap-fs computes `modificationSupport = (MODIFICATION_SUPPORT === "X")`. We always emit `NoModification` (comment says a real system does too, so likely harmless, but if abap-fs uses it for a read-only banner it is always false). `IS_LOCAL=X` selects "no transport needed", which is what we want. A 403 on lock for "held by other session" is read as a login/CSRF failure by the client retry path: see finding 7. |
| PUT `<src>` ; `lockHandle`, `corrNr` ; Content-Type `text/plain; charset=utf-8` (or `application/*` if body starts `<?xml`) | status only | Served. |
| POST `<obj>?_action=UNLOCK&lockHandle=` | body returned | Served (empty text). |
| DELETE `<obj>?lockHandle&corrNr` | status | Served. |
| POST `/{collection}` create ; `corrNr` ; `application/*` ; body `class:abapClass` etc. | status only | Served per SOURCE_TYPES/DEVC. Creation is preceded by validation, which is not served (table 2). |
| POST `activation?method=activate&preauditRequested=true` ; body `adtcore:objectReferences/objectReference@uri,@name` | `chkl:messages/msg[]` (**unprefixed `msg`**, attrs `type`, `shortText.txt`); `ioc:inactiveObjects/ioc:entry[]` each with `ioc:object/ioc:ref` (and `ioc:transport`) | Success doc fine (empty list, success). **Likely mismatch on failure:** we emit `msg:msg` (prefixed), which fast-xml-parser keys as `msg:msg`, so abap-fs sees zero messages; and `ioc:entry` carries adtcore attrs directly with no `ioc:object/ioc:ref`, so `object` is undefined while `inactive.length>0` forces `success=false`. Net: activation "fails" with no messages and no object list. |
| GET `activation/inactiveobjects` ; Accept `application/vnd.sap.adt.inactivectsobjects.v1+xml, application/xml;q=0.8` | `ioc:inactiveObjects/ioc:entry/ioc:object/ioc:ref` attrs | Served but always empty element, so the inactive-objects list is permanently empty. Namespace URI is `.../adt/ioc` (irrelevant, prefix is matched). |
| GET `checkruns/reporters` | `chkrun:checkReporters/chkrun:reporter@chkrun:name` + `chkrun:supportedType[]` | Served. |
| POST `checkruns?reporters=abapCheckRun` ; `application/*` ; `chkrun:checkObjectList/checkObject@uri,@version/artifacts/artifact@uri/content(base64)` | `chkrun:checkRunReports/checkReport/checkMessageList/checkMessage@uri,@type,@shortText`; position parsed from `uri#start=line,col` (regex) | Served; checkReportDocument matches (shortText attr, #start fragment). OK. |
| POST `abapunit/testruns` (`aunit:runConfiguration`, risk/duration flags, `uriType semantic`, `withNavigationUri`) ; Accept `application/*` | `aunit:runResult/program/testClasses/testClass` (attrs, `alerts/alert` with `details/detail`, `stack/stackEntry`, `testMethods/testMethod`) | Served; document shape matches (unprefixed child names). OK. |
| POST `abapunit/testruns/evaluation` | `testMethods/testMethod` | Served. |
| POST `abapsource/occurencemarkers?uri=` ; text/plain | `occurrenceInfo/occurrences/occurrence@kind,@keepsResult` + `objectReference@uri` | Served. |
| POST `repository/nodestructure` (`parent_type`, `parent_name`, `parent_tech_name`, `user_name`, `rebuild_tree`, `withShortDescriptions`; body optional `TV_NODEKEY`) | `asx:abap/asx:values/DATA`: `TREE_CONTENT/SEU_ADT_REPOSITORY_OBJ_NODE[]`, `CATEGORIES`, `OBJECT_TYPES/SEU_ADT_OBJECT_TYPE_INFO[]` incl. `OBJECT_TYPE_LABEL` (HTML-decoded) | Served; code already tuned against real client behaviour. Client coerces OBJECT_NAME/TECH_NAME to string, so numeric names work. |
| POST `repository/nodepath?uri=` | `projectexplorer:nodepath/projectexplorer:objectLinkReferences/objectLinkReference` attrs | Served. We deliberately do not advertise PROJECTEXPLORER/treePath (Eclipse gate); abap-fs does not check it. |
| GET `repository/informationsystem/search?operation=quickSearch&query&maxResults&objectType` ; Accept `application/*` | `adtcore:objectReferences/adtcore:objectReference` attrs; splits `NAME (TYPE)` legacy names | Served. |
| GET `repository/informationsystem/objecttypes?maxItemCount=999&name=*&data=usedByProvider` | `nameditem:namedItemList/namedItem`: `nameditem:name/description/data`; `data` = `type:X;usedBy:A,B;...` entries without both `type` and `usedBy` are dropped | Served; must verify `data` carries `usedBy` (else the object-type map is empty and URL-to-type resolution degrades). |
| POST `repository/typestructure` | `asx:abap/.../SEU_ADT_OBJECT_TYPE_DESCRIPTOR[]` with `CAPABILITIES/SEU_ACTION` | Served. Drives which types are creatable in the UI. |
| GET `packages/valuehelps/:what?name=` | `nameditem` list | Served. |
| GET `packages/:name` (`pak:package`) | package XML | Served (v2 + v1). Gate: abap-fs asks discovery for `/sap/bc/adt/packages` first, else falls back to `/vit/wb/object_type/devck/object_name/...` (not served). |
| GET `.../versions` (revisions feed) ; Accept `application/atom+xml;type=feed` | `atom:feed/atom:entry`: `atom:content@src`, `atom:title`, `atom:updated`, `atom:author/atom:name`; the feed link found via `atom:link rel=http://www.sap.com/adt/relations/versions` on the structure | Served (adt-versions); rel link appears only on class includes in classDocument. Other types need the link on the root. |
| POST `cts/transportchecks` ; `application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData` ; body asx `DEVCLASS,OPERATION,URI` | `DATA` header fields + `REQUESTS/CTS_REQUEST/REQ_HEADER`, `LOCKS`, `MESSAGES/CTS_MESSAGE` (severity E/A/X throws) | Served; REQUESTS and LOCKS empty, so no transport list ever appears, consistent with local-only objects. |
| POST `datapreview/ddic`, `datapreview/freestyle` | table rows XML | Served. |
| GET `feeds`, `runtime/dumps`, `system/users` (Accept atom feed) | atom feed | Served (system/users, feeds, dumps). |
| POST `oo/classrun/:name` | body text | Served. |
| GET `ddic/tables/:name` and `.../source/main`, `ddic/dataelements/:name` | text/regex-matched XML (`adtcore:*` attrs, `dtel:dataElement`, `stru:`) | Served. |
| POST `abapsource/occurencemarkers`, `ddic/ddl/sources` etc. | see above | Served for DDLS/SRVD. |

## Table 2 - used by the client, NOT served (404 via catch-all `router.all(BASE/*)`)

| Path | Client feature that breaks | Notes |
|---|---|---|
| `debugger/listeners` (GET/POST/DELETE), `debugger/breakpoints` (+`/:id`), `debugger` (POST ?method=attach/step*/getStack/setDebuggerSettings/getVariables/getChildVariables/setStackPosition/setVariableValue), `debugger/stack` | Entire debugger (listen, breakpoints, step, variables) | `DebugService.create` calls core discovery then stateful session. `debuggerStackTrace` asks discovery for collection `/sap/bc/adt/debugger/stack`: present means GET stack, absent means POST `/debugger?method=getStack`. Bodies are `com.sap.adt.debugger.*` asx and `dbg:` XML. Large. |
| `abapsource/codecompletion/proposal` (POST, `uri#start=l,c&signalCompleteness`) | Code completion | Response: `asx:abap/asx:values/DATA/SCC_COMPLETION[]` with `IDENTIFIER`; `@end` row filtered. |
| `abapsource/codecompletion/insertion` (POST `patternKey`), `.../elementinfo` | Completion item resolve, hover docs | elementinfo parses `abapsource:elementInfo` (`adtcore:name/type`, `abapsource:documentation`, `atom:link@href`, nested elementInfo with `abapsource:properties/abapsource:entry`). |
| `navigation/target` (POST, `uri#start=l,c;end=l,c`, `filter=definition|implementation`) | Go to definition / implementation | Reads `adtcore:objectReference@adtcore:uri` with `#start=l,c`. If empty URI abap-fs shows nothing. |
| `repository/informationsystem/usageReferences`, `usageSnippets` | Where-used, find usages | Request `usagereferences:usageReferenceRequest`; reads `usageReferences:usageReferenceResult/referencedObjects/referencedObject` + `objectIdentifier`, `adtObject`, `packageRef`. |
| `abapsource/typehierarchy` (POST `type=superTypes|subTypes`) | Type hierarchy | `hierarchy:info/entries/entry` attrs. |
| `abapsource/prettyprinter` (POST text/plain) and `.../settings` (GET/PUT) | Format source | settings: `abapformatter:PrettyPrinterSettings` attrs. |
| `urifragmentmappings?uri=...#type=;name=` | Navigation from outline/usage references to a line | body `...#start=l,c`, else "Fragment not found". |
| `<include>/mainprograms` | Include to main program mapping (needed for includes, breakpoints, syntax check context) | `adtcore:objectReferences/objectReference`. |
| `docu/abap/langu` (POST) | ABAP keyword docs hover | returns HTML. |
| `objectrelations`, `objectrelations/components|network|references` (abap-fs's own, not the library) | Relation analysis LM tools | abap-fs catches "does not exist" and reports unsupported. Graceful. |
| `.../validation` endpoints: `oo/validation/objectname`, `programs/validation`, `includes/validation`, `functions/validation`, `ddic/ddl/validation`, `packages/validation`, `ddic/*/validation`, `businessservices/bindings/validation`, `messageclass/validation` | Create-object wizard validates the name before POST; a 404 raises an exception. | Cheap to add: return `asx` `DATA/CHECK_RESULT`,`SEVERITY`,`SHORT_TEXT`; SEVERITY=ERROR aborts the wizard. |
| `functions/groups/:g/fmodules`, `functions/groups/:g/includes`, `functions/groups` object docs | Function groups/modules creation and structure; only discovery `functions/groups` is advertised, no handler beyond SOURCE_TYPES if FUGR not in TYPES | verify TYPES has FUGR/FUGR-F; our graph advertises FUNCTIONS features. |
| `cts/transportrequests` (GET list with `user`, `targets`; GET `/{nr}`; POST `/{nr}/{action}` release/newreleaser; PUT/DELETE; `/reference`; `/searchconfiguration/configurations`), `cts/transports` (POST create) | Transport organiser view, "create transport" in the save flow | Accept `application/vnd.sap.adt.transportorganizer.v1+xml`; reads `tm:request/tm:task/tm:abap_object`. Create returns plain text whose last path segment is the TR number. |
| `sscr/registration/objects?uri=` | Developer-key registration check | reads `reg:objectRegistrationResponse`. Only used on demand. |
| `security/reentranceticket` | SAP GUI navigation tickets | We serve `core/http/reentranceticket`, a different path. |
| `vit/wb/object_type/.../object_name/...`, `vit/docu/...` | "open in SAP GUI" links, includes of function groups; package fallback | Used as strings in links, requested from SAP GUI, not by the HTTP client. |
| `atc/*` (customizing, worklists, runs, items, exemptions/apply), `atc/variants` | ATC checks panel | Not served. Needs `system/users` too (served). |
| `ddic/ddl/elementinfo`, `ddic/ddl/ddicrepositoryaccess`, `ddic/cds/annotation/definitions` | CDS editor completion and hover | |
| `businessservices/bindings/:name`, `odatav2/...`, `odatav4/publishjobs`, `generators`, `ddic/srvd/sources` creation | SRVB creation, publish/unpublish, RAP generator | `bindingDetails` parses `srvb:serviceBinding`. SRVD sources are served, SRVB and BDEF are not. |
| `quickfixes/evaluation`, `refactorings` (rename, extract, change package) | Quick fixes and refactoring | |
| `runtime/traces/abaptraces/*` | ABAP trace explorer | |
| `textelements/{classes,programs,functiongroups}/:n` | Text elements editor | lock and PUT use same lock flow. |
| `abapgit/repos`, `externalrepoinfo`, `repos/:id/pull`, `branches/:b` | abapGit panel | Gated by discovery title "abapGit Repositories" (not advertised, so the panel stays off; no 404s). |
| `/sap/bc/z_abap_repl`, `/sap/public/myssocntl` | ABAP REPL, SSO control | not ADT. |

## Table 3 - discovery / compatibility gates to advertise

| Gate (client reads) | Where checked | Effect if absent | State here |
|---|---|---|---|
| Workspace title "Change and Transport System" containing collection href `/sap/bc/adt/cts/transportrequests` | transport tree root node | no Transports view | Not advertised (`cts/` is filed under "Development Loop"). Needs a workspace by exactly that title. |
| Collection `/sap/bc/adt/cts/transportrequests/searchconfiguration/configurations` (`findCollectionByUrl`) | `hasTransportConfig()` | Transport search config/filter off | Not advertised. |
| Workspace title "abapGit Repositories" | git panel | panel hidden (`getNoGitItem`) | Not advertised; fine unless git panel wanted. |
| Collection `/sap/bc/adt/packages` | `packageUri()` | falls back to `vit/wb/object_type/devck` URL which we do not serve | Advertised. |
| Collection `/sap/bc/adt/debugger/stack` | debugger stack variant | picks the old POST `?method=getStack` form instead | n/a until debugger exists. |
| Template link `templateLinks/templateLink@template` (collectionFeatureDetails by template) | URL-template lookups | feature lookups return undefined | We advertise templates only for a few collections. |
| `objecttypes` result with `data=...usedBy` | object-type to URL map | creation list/URL parsing weak | Served; verify usedBy. |
| compatibility graph | **not read by abap-fs** (login only). Eclipse reads it, per our notes. | n/a | Already full. |
| X-sap-adt-sessiontype handling | all writes (stateful) | write throws client-side | Handled in adt-session. |

## Ten most valuable findings for the ABAP port, ranked

1. **The only hard gate abap-fs applies is discovery, not the compatibility graph.** Port discovery byte-for-byte including workspace titles; the graph can stay as is for Eclipse. Add workspace "Change and Transport System" with `/sap/bc/adt/cts/transportrequests` and `.../searchconfiguration/configurations` only when those resources exist; otherwise leave them out (absent is fine, a 404 is not).
2. **Writes require a stateful session and one lock per same-session handle.** Lock, PUT, unlock, delete and include-create all validate `stateful` on the client; the server session store must key the lock to the cookie and the `x-sap-adt-sessiontype` flip. Port `adt-session` semantics exactly (csrf Required then retry).
3. **A 403 on any request is read as stale CSRF** (client re-logins and retries once when not stateful). Our "locked by other" 403 on LOCK should arguably be 409/423 or a 403 with a real exception body; the facade comment already avoids 403 elsewhere (405), so the LOCK path is the inconsistent one.
4. **Activation failure XML does not match what abap-adt-api parses:** `msg:msg` vs unprefixed `msg`, and `ioc:entry` attrs vs `ioc:object/ioc:ref`. Result in abap-fs: failed activation with an empty message list. Fix when porting activationFailureDocument (emit default-namespace `msg`, `ioc:entry/ioc:object/ioc:ref`). Same for `activation/inactiveobjects`, which is always empty.
5. **Prefixes are matched literally.** Any response element must carry exactly the prefix the client names (`asx:`, `chkrun:`, `ioc:`, `nameditem:`, `abapsource:`, `adtcore:`, `class:`, `atom:`; `aunit:runResult` but unprefixed `program/testClass/alerts`). The ABAP serializer must not re-prefix via `CALL TRANSFORMATION` defaults.
6. **Class structure is the fragile one:** root needs `class:visibility`, `abapsource:sourceUri`, `class:include[]` each with a non-empty `atom:link[]` (client does `.map` on it), and `adtcore:changedAt` parseable. Missing links crash with "e.atom:link.map is not a function"; missing visibility means "not supported".
7. **Missing but cheap and visible:** the `*/validation` POST endpoints (create wizard stops without them), `mainprograms` (includes), and `urifragmentmappings` (navigation). Each is a few lines and unblocks a feature.
8. **Completion / go-to-definition / where-used / pretty-printer / type hierarchy are all absent** (404). Their request/response shapes are above and small except completion and where-used. Navigation target needs `objectReference@uri#start=`; pretty printer is text in/out (could be a no-op identity to light the feature).
9. **Transport path is half there:** `cts/transportchecks` is served but with empty REQUESTS/LOCKS, so abap-fs never shows a TR; `cts/transportrequests` and `cts/transports` are missing, so Create-transport and the organiser tree fail if the gate is advertised. Keep not advertising until built.
10. **Lock result:** `MODIFICATION_SUPPORT` is compared to `"X"` by abap-fs, `IS_LOCAL === "X"` chooses "no transport". Emit `IS_LOCAL=X` plus `CORRNR` empty for local objects (done); consider real `X` semantics if a read-only banner is wanted. Also reentrance ticket path differs (`security/` vs our `core/http/`).
