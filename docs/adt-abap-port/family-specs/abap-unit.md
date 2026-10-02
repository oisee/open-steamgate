# abap-unit

- Recommendation: **abap-protocol-plus-host-continuation**
- Effort: L
- Owner: dell
- Depends on: front-up (feat/adt-front-up: continuation API in tools/adt-abap-front.mjs, ZIF_OSD_ADT_ROUTE ty_continuation), STORE command PARSE (kind UNIT_PLAN), shared with group B's PARSE OUTLINE/DDLS, ZCL_OSD_ADT_URI=>ENCODE_COMPONENT / DECODE_COMPONENT (move uri_name out of ZCL_OSD_ADT_VERSIONS; coordinate with stoker), a generic continuation-to-ABAP resume/render step, ideally agreed with stoker's 4b (activation result document)

## Routes

### GET `/sap/bc/adt/abapunit/metadata` (adt-facade.mjs ~1110)

Static answer, no host state. 200, Content-Type `application/vnd.sap.adt.abapunit.metadata.result.v1+xml; charset=utf-8`, Express weak ETag over the body. The body is one line with no newline anywhere and none at the end: `<?xml version="1.0" encoding="utf-8"?><aunit:metadata xmlns:aunit="http://www.sap.com/adt/aunit">` followed by three `<aunit:supportedTypeFeatures globalWorkbenchType="K" ownTests="true" assignedTests="true" coverage="false"/>` elements, K = DEVC/K, CLAS/OC, PROG/P in that order, then `</aunit:metadata>`. HEAD is the GET without a body (Express). Advertised in discovery as `abapunit/metadata`. Quirk to keep: it says DEVC/K has ownTests="true", but testruns cannot run a package (see below).

### GET `/sap/bc/adt/core/http/unit/object` (adt-facade.mjs ~1283)

Workbench discovery, JSON, OSD-specific (not advertised). type = query.type split on '/' [0], upper-cased; name = query.name upper-cased. A type other than CLAS or PROG gives 400 ExceptionInvalidRequest `${type || "object"} cannot carry ABAP Unit tests here`. Otherwise `runner.withRisk(runner.classes(type,name))`: the abaplint registry parse (store.registry(), cached per registry) plus the xref risk graph (osd-unit-risk.mjs #graph, cached per registry; writesReached BFS, limit 5). 200 `application/json; charset=utf-8`, JSON.stringify with this exact key order: {object:{type,name}, writes:[{object,kind,file,line}], writesTotal, riskError? (only when the xref failed), classes:[{name, riskLevel, riskLevelDeclared, durationCategory, durationDeclared, schedule, include, line, column, methods:[{name,line,column}]}]}. NotFound (store.find undefined) gives 404 ExceptionResourceNotFound `CLAS X does not exist`; any other error gives 500 ExceptionTestDiscoveryFailed with the message. Every refusal goes through refuse(), so it is `application/xml; charset=utf-8` with the exceptionDocument. Class order is the order of getABAPFiles(), then the order of listClassDefinitions(), with FOR TESTING and non-abstract classes only. Methods are in declaration order, and line/column is the position of the implementation body.

### POST `/sap/bc/adt/core/http/unit/object/run` (adt-facade.mjs ~1323)

Workbench run, JSON. type and name as in the discovery route; testClass and method come from the query, upper-cased, with '' meaning undefined. The order of the checks: (1) a type that is not CLAS/PROG gives 400 `... cannot carry ABAP Unit tests here`. (2) unitRunOptions(body): an empty or unparsable body means defaults. dbEnv is filtered to UNIT_RUN_DB_ENV_KEYS (18 keys, string values only), which is a security boundary because it reaches the child env. inspectPort must be an int 1..65535 (a number, or a digit string), otherwise 400 `inspector port must be an integer between 1 and 65535`. A non-boolean waitForDebugger gives 400 `waitForDebugger must be boolean`. waitForDebugger true without a port gives 400 `waitForDebugger needs an inspector port`. (3) withRisk(classes()): NotFound gives 404 ExceptionResourceNotFound. (4) selectedUnitPlan: 404 `test class X does not belong to OBJ` or `test method C=>M does not belong to OBJ` (code NOT_FOUND, also ExceptionResourceNotFound). (5) runDetached spawns a child process (tools/osd-unit.mjs --json --plan-stdin) with its own throwaway SQLite/DuckDB file (unitChildEnv), or the given HANA/PG env, and optionally --inspect(-brk). The plan goes on stdin. Each method has a 60 s deadline. A run takes about 1 s or more. Cancellation: res 'close' before the response is written aborts (SIGTERM, then SIGKILL after 1 s), and nothing is answered. 200 `application/json; charset=utf-8`, JSON.stringify(run), where run = {program{name,type,objectType}, testClasses[...incl. riskLevel, schedule, guard, source, testMethods{name,type,executionTime,unit,ms,line,column,alerts}], counts{classes,methods,passed,failed,classAlerts}, ok, ms}. Errors: 500 ExceptionTestRunFailed (RunFailed: `the test run exited with N and printed no result: <tail of child stdout+stderr, 2000 chars>`).

### POST `/sap/bc/adt/abapunit/testruns/evaluation` (adt-facade.mjs ~2673)

Takes the body as utf8, strips `#testclass=[^"]*` (case-sensitive, unlike testruns), and runs objectReferencesIn: every `adtcore:uri="..."` resolved through objectFromUri over the SOURCE_TYPES collections (CLAS oo/classes, INTF oo/interfaces, PROG programs/programs, DDLS ddic/ddl/sources, SRVD ddic/srvd/sources, INCL programs/includes; `#`/`?` cut, `/source/main` cut, name decodeURIComponent'd and upper-cased). With none it answers 400 ExceptionInvalidRequest `no object references in the request`. Otherwise it runs the WHOLE object named first (named[0]): no selection, no withRisk, so no HARMLESS guard. The test run is executed again, not looked up. 200 with Content-Type unitResultType(req,'evaluation.result') plus `; charset=utf-8` added by Express, and the body unitResultDocument(run,{base:`/sap/bc/adt/<adt collection>/<encodeURIComponent(name.toLowerCase())>`}). Errors: NOT_FOUND gives 404 typed **ExceptionTestRunFailed** (not ResourceNotFound), anything else 500 ExceptionTestRunFailed. Content-type negotiation: an Accept containing /junit\.run-result/ gives `application/vnd.sap.adt.api.junit.run-result.v1+xml`. Otherwise the version is the first /testruns\.(?:evaluation\.)?result\.v(\d)/ in Accept (either name works for either route), default 2, giving `application/vnd.sap.adt.abapunit.testruns.evaluation.result.v<N>+xml`.

### POST `/sap/bc/adt/abapunit/testruns` (adt-facade.mjs ~2691)

Takes `named` = objectReferencesIn(body) (any adtcore:uri resolving to a source type) and `references` = every match of /<(?:[\w-]+:)?objectReference\b[^>]*\b(?:[\w-]+:)?uri="([^"]+)"/gi. The greedy [^>]* takes the LAST uri attribute of the tag. If named != 1 or references != 1 the answer is 400 ExceptionInvalidRequest: `exactly one object reference is supported` when references > 1, otherwise `one object reference is required`. That covers an empty runConfiguration and a DEVC/K package reference, which metadata nonetheless advertises. The fragment is the reference from its first '#'; it must match /^#testclass=([^;"#]+)(?:;testmethod=([^;"#]+))?$/i, otherwise 400 `invalid ABAP Unit testclass/testmethod selector`. Its parts are decodeURIComponent'd (a URIError gives 400 with the message `URI malformed`) and upper-cased. Then runner.classes() (NotFound gives 404 ExceptionResourceNotFound `TYPE NAME does not exist`), and selectedUnitPlan (404 `... does not belong to ...`, ExceptionResourceNotFound). runDetached runs with the plan and the selection but **without withRisk**: no guard, which differs from the Workbench run. 200 with unitResultType(req,'result') (`...abapunit.testruns.result.v<N>+xml` or the junit name) plus `; charset=utf-8`, and the body is unitResultDocument. No cancellation on disconnect. Other failures give 500 ExceptionTestRunFailed. Advertised as `abapunit/testruns` with accepts testruns.config v1..v4 and application/xml. unitResultDocument byte rules: 2-space indentation exactly as in the template, a final newline, xmlEscape (& < > " only, no apostrophe). An empty list still leaves its blank line (`<testClasses>\n\n    </testClasses>`, the same for testMethods, details and stack). `<alerts/>` when empty. Defaults: kind failedAssertion, severity critical, executionTime 0.000, unit s, riskLevel harmless, durationCategory short, include testclasses. The adtcore:uri of a class or method equals its navigationUri: `${base}/includes/<include>/source/main#start=L,C`. stackEntry: frameUri maps the basename `x.clas.(locals_def|locals_imp|macros|testclasses).abap` to `/includes/(definitions|implementations|macros|testclasses)/source/main#start=`, `x.clas.abap` and `x.prog.abap` to `/source/main#start=`, and with an unknown shape keeps the file name with no navigationUri. description is `line N` or empty. The program type is ADT_TYPE[type] (CLAS/OC, PROG/P, INTF/OI, FUGR/F), otherwise the raw type, e.g. `DDLS`.

## Host dependencies

- Existing, enough for metadata: none (no host call).
- Existing STORE command OBJECT (tools/osd-store-destination.mjs #object): NOT sufficient for these routes. Its NotFound text and the plan both have to come from the parse, so PARSE is used instead.
- NEW STORE command PARSE (planned in port-map section 3, shared with group B's OUTLINE/DDLS kinds; whoever lands it first owns the dispatcher). Signature: IV_COMMAND='PARSE', IV_JSON={"kind":"UNIT_PLAN","type":"CLAS","name":"ZCL_X","risk":true|false} -> EV_JSON = the plan exactly as runner.classes()/withRisk() build it ({object:{type,name,...entry}, classes:[{name,localClass,riskLevel,riskLevelDeclared,durationCategory,durationDeclared,include,source,module,line,column,testMethods[{name,method,line,column}], schedule?,guard?}], writes?, writesTotal?, riskError?}) or EV_ERROR with a code prefix NOT_FOUND:<message> | ERROR:<message>. Wraps store.unit() then runner.classes(type,name) plus optionally runner.withRisk(). Add it to CAPABILITIES. It runs inside the step and holds the work process. A warm registry costs milliseconds, a cold registry plus the xref graph can cost seconds. That has to be measured, and if the cold cost is more than about 1 s, the host pre-warms the registry at start.
- NEW continuation kind `aunit-run` (registerContinuation in tools/adt-abap-front.mjs, feat/adt-front-up). Payload {route:'testruns'|'evaluation', type, name, testClass?, method?, contentType, base}. It runs after the step with no work-process lock: store.unit() then runDetached (testruns: classes()+selectedUnitPlan, no withRisk; evaluation: the whole object, as Node does). It then hands the run JSON back to ABAP for rendering (next entry) and sends that answer with the payload's contentType.
- NEW continuation kind `unit-object-run`. Payload {type, name, testClass?, method?, body: the raw request body as text}. The host keeps the security boundary: it runs unitRunOptions again on the raw body, so the UNIT_RUN_DB_ENV_KEYS allowlist and the port check live in the host, byte for byte. It then runs withRisk(classes()) and selectedUnitPlan, and runDetached with signal = AbortController tied to res 'close'. This is today's cancellation, on the real socket, so the port-map's X-OSD-Request-Id seam is NOT needed for this family. The answer is JSON.stringify(run) as is (see abap_design for why the run JSON is not re-serialized in ABAP).
- NEW re-entry from a continuation into ABAP: a dialogStep of its own calling ZCL_OSD_ADT_AUNIT_DOC=>RENDER( iv_run_json, iv_base, iv_error_json ) -> body. It is reached by the ADT kernel closure because the route class names it as a literal. Better: a generic front helper `resume(kind, json)` that calls ZCL_OSD_ADT_HANDLER=>RESUME, which dispatches to the route's ZIF_OSD_ADT_RESUMABLE~RESUME. stoker's slice 4b (activation result document after the build) needs the same shape, so it should be agreed once.
- NOT needed, against port-map section 3: the STORE commands UNIT and JOB, and WAIT-based polling inside the step. They are the alternative if a host without continuations (the Go front on OSGo) has to serve unit runs, and only then.
- Preview host (web/preview-backend.mjs, service worker): no child processes. Today these routes answer 500 ExceptionTestRunFailed there. Register a preview `aunit-run`/`unit-object-run` continuation that answers the same 500. Otherwise an unregistered kind becomes 500 ExceptionInternalError, which is a visible difference.

## Rationale

A test run cannot run inside the request step, for three independent reasons. (1) Isolation: a run spawns a child process with a database of its own (unitChildEnv), so a test's rows never land in the database the gateway serves. ABAP in the serving process cannot provide that. (2) Duration: about 1 s per class at best, a 60 s deadline per method, and with waitForDebugger it blocks until a debugger attaches. Inside the step that would hold the work-process FIFO and stall every OData and ADT request behind it, which is exactly what the rules forbid. (3) Cancellation: Workbench runs abort on socket close, and only the host owns the socket.

The protocol half is pure text work and belongs in ABAP: body scanning, the selector grammar, the refusals with their exact messages and status/type pairs, Accept negotiation, and the unitResultDocument/frameUri renderer, which is the only ADT document here. The continuation from feat/adt-front-up is the right carrier. The ABAP step answers every refusal itself and only a validated run reaches the host. The run happens after the step with no lock held, with cancellation kept on the real res 'close'. The result goes back into ABAP in a short step of its own for rendering, so the ADT document is produced by ABAP.

This is cheaper than port-map's UNIT+JOB+WAIT polling plan. That plan needs two new commands, WAIT roll-out inside the step, polling latency of up to the WAIT granularity on a 1 s run, and the X-OSD-Request-Id cancellation seam. The continuation needs none of these.

GET abapunit/metadata is a straight port with no host. GET core/http/unit/object can be fully ABAP-served in-step over PARSE UNIT_PLAN, because it only reads the cached parse.

Workbench run JSON (core/http/unit/object/run, 200 body): the payload is the host child's own run object, passed through. Re-serializing it in ABAP would buy no protocol fidelity and would add a byte-equality risk: zcl_ajson against JSON.stringify on float-free but arbitrary nested data, with key order and escapes. The cost of the ABAP alternative is a resume step plus an ajson round trip of the whole run with keep-order, for zero behaviour change. All refusals of that route are still ABAP's.

## ABAP design

Route classes (src/adt/, 7.02, ASCII):

- ZCL_OSD_ADT_AUNIT implements ZIF_OSD_ADT_ROUTE and serves `abapunit/metadata`, `abapunit/testruns` and `abapunit/testruns/evaluation`, dispatching on the path tail.
  - metadata: a constant string as in Node, content type `application/vnd.sap.adt.abapunit.metadata.result.v1+xml; charset=utf-8`.
  - testruns, scanner: `adtcore:uri="` attribute values, and `<[prefix:]objectReference` tags whose last `[prefix:]uri="..."` attribute is taken. Both are hand-written scanners, not FIND REGEX. open-abap maps REGEX to JS, so a POSIX difference on a system would stay invisible in our tests: there is no \b, and [^>]* is greedy.
  - testruns, objectFromUri over ZCL_OSD_ADT_TYPES=>sources( ) in type-table order (CLAS, INTF, PROG, DDLS, SRVD, INCL), so DEVC never resolves.
  - testruns, selector parse: case-insensitive `#testclass=`, optional `;testmethod=`, and no ';', '"' or '#' inside.
  - testruns, percent-decode: a new ZCL_OSD_ADT_URI=>DECODE_COMPONENT raising invalid_request( `URI malformed` ). Today decode_segment refuses with Express's `Failed to decode param` text, so the decoder is factored out and each caller keeps its message.
  - testruns, then: STORE PARSE UNIT_PLAN (risk false) and the class/method selection with Node's exact 404 messages (ZCX_OSD_ADT=>NOT_FOUND).
  - testruns, content type: ZCL_OSD_ADT_AUNIT=>RESULT_TYPE( iv_accept iv_kind ): junit name if `junit.run-result` occurs, else a first-match scan for `testruns.result.v` / `testruns.evaluation.result.v` plus one digit, default 2, plus `; charset=utf-8`.
  - testruns, base: `/sap/bc/adt/` && collection && `/` && encode(lower(name)). The encoder is uri_name, moved out of ZCL_OSD_ADT_VERSIONS into ZCL_OSD_ADT_URI=>ENCODE_COMPONENT so both share it (stoker's class, a one-method move).
  - testruns, response: continuation kind `aunit-run` with payload {route,type,name,testClass,method,contentType,base}. On a system, where the response itself is the answer, the response is the 501 system_not_supported document, never a hollow 200.
  - evaluation: strips `#testclass=` up to the next '"' (case-sensitive), takes the first reference, and refuses `no object references in the request`. Then PARSE UNIT_PLAN; its NOT_FOUND is raised as NEW zcx_osd_adt( iv_status = 404 iv_type = `ExceptionTestRunFailed` ), keeping Node's odd type. Then the same continuation.
- ZCL_OSD_ADT_UNIT_OBJECT implements ZIF_OSD_ADT_ROUTE and serves `core/http/unit/object` (GET) and `core/http/unit/object/run` (POST).
  - GET: the type check with Node's message; STORE PARSE UNIT_PLAN with risk true; the JSON projection written by a small ordered writer (zcl_ajson with keep_item_order, or string concatenation with a JSON-string escaper matching JSON.stringify: \" \\ \b \f \n \r \t, other < 0x20 as \u00XX lower-hex, non-ASCII raw). A riskError key appears only when the field is present. NOT_FOUND gives 404, others give 500 `ExceptionTestDiscoveryFailed`.
  - run: the type check, then the shape of the body options with Node's three messages, in Node's order and before the plan. The dbEnv allowlist is NOT applied here: the host owns it. Then PARSE UNIT_PLAN with risk true and the selection 404s, then continuation `unit-object-run` with payload {type,name,testClass,method,body}.
- ZCL_OSD_ADT_AUNIT_DOC renders unitResultDocument and frameUri byte for byte from the run JSON:
  - escaping through ZCL_OSD_ADT_XML=>ESC;
  - the empty-list blank lines and the trailing newline are kept;
  - RENDER_ERROR( status type message ) returns ZCX_OSD_ADT->DOCUMENT for continuation-side failures (RunFailed gives 500 ExceptionTestRunFailed), so even error bodies stay ABAP's.

Router rows (explicit, not per type), inserted before the HOST catch-all:
- GET `/sap/bc/adt/abapunit/metadata`
- POST `/sap/bc/adt/abapunit/testruns/evaluation`
- POST `/sap/bc/adt/abapunit/testruns`
- GET `/sap/bc/adt/core/http/unit/object`
- POST `/sap/bc/adt/core/http/unit/object/run`

None of them collide with the lockable `POST <collection>/:name` rows. HEAD comes from the GET rows. Advertising stays as it is: discovery is still Node's, and the keys `abapunit/metadata` and `abapunit/testruns` are unchanged.

What the host is asked:
- in the step: only PARSE UNIT_PLAN;
- after the step (continuation): run the child, then call RENDER in a fresh dialogStep and send it with the payload's contentType, and for unit-object-run send JSON.stringify(run).

Recommended alongside, same unit C2 in the port map: POST `abapsource/occurencemarkers` (S, static, ABAP-pure). abap-adt-api calls it after every unit run and the run's UI breaks without it.

Proposed slicing:
- C2a (S): metadata, GET unit/object, PARSE UNIT_PLAN, and the occurencemarkers row.
- C2b (M): testruns and evaluation, the AUNIT_DOC renderer, the aunit-run continuation and the resume/render step.
- C3 (S/M): unit/object/run and the unit-object-run continuation with cancellation.

## Test plan

Extend test/adt-abap-diff.mjs (two adtRouters over one store, one with the front).

Fake runner: install a deterministic runner on the shared store (store.tests = {classes, withRisk, runDetached}), so the two sides are byte-equal on status, content-type, content-length, ETag and body despite executionTime/ms. The fake run covers:
- & < > " ' and UTF-8 in titles, details and names;
- every frame shape: clas main, testclasses, locals_imp, locals_def, macros, prog, an unknown file, a frame without a line, a namespaced `#foo#zcl_x` file giving `%23foo%23zcl_x`;
- an empty testClasses, a class with no methods, an alert with empty details and stack, class-level alerts;
- program types CLAS, PROG and DDLS (raw type).

Cases:
- metadata: GET and HEAD.
- testruns content types: Accept application/xml, testruns.result.v1, v2, `testruns.evaluation.result.v1` sent to testruns, junit, no Accept, an Accept with q-params.
- testruns selection: `#testclass=LTCL;testmethod=M`, lower-case `#TestClass=`.
- testruns refusals:
  - empty `<aunit:runConfiguration/>`;
  - two references (`exactly one`);
  - a DEVC reference (`one object reference is required`);
  - a reference with two uri attributes (the last one wins);
  - `#testclass=%` (`URI malformed`);
  - `#testclass=`, `#testmethod=CHECK`, `#testclass=X;testmethod=`;
  - unknown class or method (404 `does not belong`);
  - unknown object (404 ResourceNotFound);
  - the fake throws RunFailed (500 ExceptionTestRunFailed, body from ABAP's RENDER_ERROR).
- evaluation: no refs (400); a selector that is stripped while the whole object runs (assert the fake got no testClass); unknown object (404 typed ExceptionTestRunFailed).
- unit/object:
  - CLAS/OC, PROG, INTF (400), empty type (`object cannot carry...`), unknown (404);
  - riskError present (the fake withRisk) and absent;
  - JSON escapes of non-ASCII and control characters in a name.
- unit/object/run:
  - options: inspectPort 0, 70000, `abc`, 3.5, `\"0012\"` (OK); waitForDebugger `\"yes\"`; waitForDebugger true without a port;
  - order: an invalid port together with an unknown class must be the 400, not the 404;
  - empty and unparsable body give defaults;
  - dbEnv with a disallowed key (`NODE_OPTIONS`) and a non-string value: assert the fake received only the allowlisted string keys;
  - an unknown method gives 404;
  - cancellation: abort the fetch mid-run and assert the fake's signal is aborted and nothing is written (the analogue of adt-devloop :609/:688).
- served-by: every one of these goes through an ABAP row. A run answer carries the continuation verdict and the test asserts that the `aunit-run`/`unit-object-run` kind fired, not a plain next().

One real run (ZCL_STG_SEGW_TEST LTCL_TREE PROPERTIES_IN_FILE_ORDER, both sides), with `executionTime="[^"]*"` and `"ms":\d+` normalised, ETag/length excluded.

Existing suites green in both modes with no edits: adt-devloop :400-745 (the unit block, evaluation, junit naming, selector refusals, Workbench run, occurrence markers), adt-facade :1414 (unitRunOptions/allowlist, which stays a host JS test), unit-risk, osd-unit.

ABAP Unit (testclasses) for:
- ZCL_OSD_ADT_AUNIT_DOC: frame_uri per shape, the empty-list blank lines, the trailing newline, the escaping;
- the selector and reference scanners;
- RESULT_TYPE negotiation;
- ENCODE_COMPONENT shared with versions, whose tests must stay green.

Red proof, each checked failing before the fix:
- the renderer's empty-list `\n` dropped;
- the default version changed to 1;
- the evaluation 404 type changed to ResourceNotFound;
- the continuation unregistered (500 ExceptionInternalError instead of the run);
- options validation moved after the plan (the order case fails).

vsp junit scenario and ABAP-FS conformance (`--start`): the testruns/evaluation rows (client-view-abap-fs.md lines 32-33, Served/OK) must stay PASS, with totals not worse than 30/1/16.

## Risks

- The work-process FIFO. The run itself is outside the step, but PARSE UNIT_PLAN is inside it. A cold store.registry() plus the xref risk graph (osd-unit-risk #graph) can take seconds and blocks every request in the meantime. Measure the cold and warm cost, and pre-warm at host start if it is over about 1 s. The same issue hits dell's checkruns (C1).
- The render re-entry is a second dialog step. It queues behind a long OData step, so a finished run can wait for the work process. That is acceptable, but it adds latency, and it must not run inside the continuation's own async context of the first step (outsideStepContext), or it throws 'a nested dialog step'.
- The session can end between the verdict and the continuation. That is harmless here, because a unit run touches no session state or locks, but the continuation must not re-read req.adt.session for anything.
- Byte-equality traps. JSON.stringify against the ABAP JSON writer for unit/object (key order, \u00XX lower-hex control escapes, raw non-ASCII). decodeURIComponent's `URI malformed` text differs from the existing decode_segment refusal text. Express appends `; charset=utf-8` to the vnd.* content types. The empty-list blank lines in unitResultDocument. encodeURIComponent of `#` in namespaced file names. The greedy last-uri rule in the objectReference regex. Case-sensitive strip in evaluation against case-insensitive selectors in testruns.
- Regexes: FIND REGEX in open-abap is JS RegExp, while a real system uses POSIX (no \b, different greediness rules). A regex port would pass locally and differ on A4H, so use hand-written scanners.
- Nondeterminism: executionTime, ms and the RunFailed message (the child's stdout/stderr tail can carry host paths and timings) prevent a real-run byte diff. The diff test needs the fake runner, plus a normalised real run.
- Node asymmetries that the port would freeze. testruns runs without withRisk, so there is no HARMLESS guard, while the Workbench run has one. evaluation re-executes the whole object and ignores the selector. Evaluation's 404 is typed ExceptionTestRunFailed. metadata advertises DEVC/K ownTests while testruns refuses a package. Per Gate 1, fix these in Node first if they are wanted, then port. Flag them to dell before C2b.
- Security boundary: the dbEnv allowlist and the inspector-port check reach a child env, and --inspect opens a port. The host must keep re-validating the raw body even though ABAP validates first. ABAP must never forward a pre-filtered dbEnv the host trusts blindly.
- Hosts: the preview service worker has no child processes and needs a registered continuation answering today's 500. A host without continuations (the Go front on OSGo) would need port-map's UNIT+JOB+WAIT path after all. Child-mode parent: the render class must be in the ADT kernel closure (it is, through the route class literal), and the change reaches the parent only at its restart.
- Depends on feat/adt-front-up (the continuation API, still unmerged) and on PARSE being agreed with group B, which is planned as one command with kinds OUTLINE/DDLS/UNIT_PLAN.
