# open-abap and transpiler anomaly log

Behaviour that differs between a real SAP system and open-abap / the abaplint
transpiler / its database adapter. Add an entry as soon as the discrepancy is
isolated and before hiding it behind a workaround. Ordinary open-steamgate
defects that reproduce identically on both runtimes do not belong here.

Resolved entries stay as compatibility history. Review all open entries before
upgrading `@abaplint/*` and before every release.

Format adapted from `larshp/hithub` (MIT).

## Entry template

### ANOMALY-YYYY-MM-DD-short-name — Short title

- Status: `open` | `workaround` | `reported` | `fixed` | `not-an-anomaly`
- Discovery date: `YYYY-MM-DD`
- Affected versions: `@abaplint/transpiler-cli x.y.z`, `@abaplint/runtime x.y.z`, `@abaplint/database-sqlite x.y.z`
- Affected ABAP statement, runtime API or adapter: `...`
- Minimal ABAP reproducer: `path/to/reproducer`
- Exact command used to run it: `...`
- Expected SAP behaviour: `...`
- Actual open-abap behaviour: `...`
- Impact on open-steamgate: `...`
- Smallest safe workaround: `...` or `none`
- Upstream issue: `link` or why it has not been reported
- Regression-test location: `path/to/test`
- Upstream version containing a fix: `...` or `unknown`

## Open anomalies
### ANOMALY-2026-09-24-daemon-statics -- a daemon's class data is its own session's on a system, and the process's here

- Status: `open` (by design; decision D4 in `docs/abap-daemons.md`)
- Discovery date: `2026-09-24`
- Affected versions: none yet; the daemon host is not built (`docs/abap-daemons.md`, step 5)
- Affected ABAP statement, runtime API or adapter: static attributes read or written from a daemon callback (`CL_ABAP_DAEMON_EXT_BASE` subclasses)
- Minimal ABAP reproducer: `docs/probes/abap-daemons/zcl_osd_t_ddrv.batch_a.testclasses.abap`, method `p01_serial` (the P9 part); the daemon sets `gv_static` in `ON_START`, the driver reads and sets its own copy, the daemon logs its value
- Exact command used to run it: the ABAP Unit driver `ZCL_OSD_T_DDRV` (sources in `docs/probes/abap-daemons/`), run on A4H 2026-09-24 in `$ZOSG_TMP_0060`, all objects deleted afterwards
- Expected SAP behaviour: the starting session reads the static the daemon set as initial, and the daemon keeps its own value after the starting session changed the static (probe P9). A daemon runs in an ABAP session of its own.
- Actual open-abap behaviour: (planned) the daemon runs in the host process and on its thread (model (b) of D4), where class data is shared with every request of the process; a daemon step that reads or writes class data outside the runtime's own classes is a recorded runtime error instead
- Impact on open-steamgate: a daemon that keeps state in class data works on a system and dumps here; that is the intended rule against state that outlives a call
- Smallest safe workaround: keep daemon state in instance attributes or in a table
- Upstream issue: none; this is our design, not a transpiler defect
- Regression-test location: none yet (step 5 of `docs/abap-daemons.md`)
- Upstream version containing a fix: `not applicable`

### ANOMALY-2026-09-24-daemon-creator-program -- a system restricts GET_DAEMON_INFO and ATTACH to the program that called START; the local runtime will not check it at first

- Status: `open`
- Discovery date: `2026-09-24`
- Affected versions: none yet; the client manager is not built (`docs/abap-daemons.md`, step 5)
- Affected ABAP statement, runtime API or adapter: `CL_ABAP_DAEMON_CLIENT_MANAGER=>GET_DAEMON_INFO`, `=>ATTACH` (and probably `=>STOP`, unmeasured)
- Minimal ABAP reproducer: `docs/probes/abap-daemons/zcl_osd_t_other.clas.abap` called from `zcl_osd_t_ddrv.batch_d1.testclasses.abap`
- Exact command used to run it: the ABAP Unit driver `ZCL_OSD_T_DDRV` (sources in `docs/probes/abap-daemons/`), run on A4H 2026-09-24 in `$ZOSG_TMP_0060`, all objects deleted afterwards
- Expected SAP behaviour: from a program other than the one that called `START` (for a class, its class pool, not the class name), `GET_DAEMON_INFO` returns 0 rows and `ATTACH` + `SEND` raises `CX_ABAP_DAEMON_ERROR` "No access right for program <program>." (probe P6). Inside the daemon itself `GET_DAEMON_INFO` also returns 0 rows. `STOP` from another program was not measured.
- Actual open-abap behaviour: (planned) the transpiled runtime has no way to ask for the calling program, so the local client manager allows every caller until step 5 builds one
- Impact on open-steamgate: code that works here may be refused on a system, notably a generic stop button in the status list
- Smallest safe workaround: call `START`, `ATTACH` and `STOP` of a daemon from one class
- Upstream issue: none yet; a caller-program query belongs to the runtime and would be proposed with the daemon host
- Regression-test location: none yet
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-24-daemon-lazy-restart -- after a re-activation a system restarts a daemon at its next event; we restart it at the generation swap

- Status: `open` (by design; option A of D2 in `docs/abap-daemons.md`)
- Discovery date: `2026-09-24`
- Affected versions: none yet; the swap phase is not built (`docs/abap-daemons.md`, step 6)
- Affected ABAP statement, runtime API or adapter: `ON_BEFORE_RESTART_BY_SYSTEM` / `ON_RESTART` after a changed daemon class is activated
- Minimal ABAP reproducer: `docs/probes/abap-daemons/zcl_osd_t_ddrv.batch_d1.testclasses.abap`, then the daemon class activated with `co_version = 'V2'`, then `batch_d2`
- Exact command used to run it: the ABAP Unit driver `ZCL_OSD_T_DDRV` (sources in `docs/probes/abap-daemons/`), run on A4H 2026-09-24 in `$ZOSG_TMP_0060`, all objects deleted afterwards
- Expected SAP behaviour: nothing happens while the daemon is idle; at its next event (a timer, a message, a stop) `ON_BEFORE_RESTART_BY_SYSTEM( i_code = 202 )` runs in the old load and `ON_RESTART` in the new one, same instance ID (probe P10). A daemon that never gets another event keeps the old load.
- Actual open-abap behaviour: (planned) the old generation's daemons are restarted when the generation is swapped, with the same two callbacks in the same order
- Impact on open-steamgate: the callbacks a daemon sees are the same; only their moment differs, and an idle daemon restarts here and not on a system
- Smallest safe workaround: none needed
- Upstream issue: none; this is our design
- Regression-test location: none yet (`test/daemon.mjs`, demo test 4, planned)
- Upstream version containing a fix: `not applicable`

### ANOMALY-2026-09-24-wait-for-channels-subrc -- WAIT FOR MESSAGING CHANNELS that reaches its time limit sets sy-subrc 8 on a system and 4 here, and a non-positive UP TO asserts here

- Status: `open`
- Discovery date: `2026-09-24`
- Affected versions: `@abaplint/transpiler 2.13.89`, `@abaplint/runtime 2.13.89`, open-abap-core `src/kernel/kernel_push_channels.clas.abap` (current `main`)
- Affected ABAP statement, runtime API or adapter: `WAIT FOR MESSAGING CHANNELS UNTIL <cond> UP TO <n> SECONDS` (every `WAIT FOR ...` transpiles to `KERNEL_PUSH_CHANNELS=>wait`)
- Minimal ABAP reproducer: `docs/probes/abap-daemons/zcl_osd_t_ddrv.batch_p8b.testclasses.abap`, method `p08b_luw`, the `ECHO_ON` step: a session subscribed to a channel sends with `i_suppress_echo = abap_true`, so the condition never becomes true, and waits `UP TO 2 SECONDS`
- Exact command used to run it: the ABAP Unit driver `ZCL_OSD_T_DDRV` (sources in `docs/probes/abap-daemons/`), run on A4H 2026-09-24 in `$ZOSG_TMP_0061`, all objects deleted afterwards
- Expected SAP behaviour: after the time limit `sy-subrc = 8` (probe P8, logged as `ECHO_ON subrc=8`); when the condition is met `sy-subrc = 0` (`ECHO_OFF subrc=0`). A non-positive `UP TO` was not measured.
- Actual open-abap behaviour: `KERNEL_PUSH_CHANNELS=>wait` returns `sy-subrc = 4` at the time limit, and `ASSERT lv_seconds > 0` dumps for an `UP TO` of zero or less (read from the source, not run)
- Impact on open-steamgate: code that branches on `sy-subrc = 8` after a timed-out wait takes the wrong branch locally; nothing here depends on it yet (AMC is step 4 of `docs/abap-daemons.md`)
- Smallest safe workaround: test `sy-subrc <> 0` rather than a specific value
- Upstream issue: none yet; to be proposed to open-abap-core together with the AMC work, after the value for `UP TO 0` is measured
- Regression-test location: none yet (step 4 of `docs/abap-daemons.md`)
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-24-zone-reserved-word -- A table field named ZONE (or HANDLER, SECTION, PARAMETER) activates here and not on a system

- Status: `workaround` (ZONE: the table field is renamed in #67, the CDS element in #69, and ZC_OSD_TAXICUBE activates on A4H; HANDLER, SECTION, PARAMETER: the fields and the elements are renamed in #73, and every table and view they were in activates on A4H)
- Discovery date: `2026-09-24`
- Affected versions: `@abaplint/cli` 2.120.50 (the `npm run lint` pass, `open-abap` syntax version, reports nothing), `@abaplint/core` 2.120.55, `@abaplint/transpiler` 2.13.89 (creates the column)
- Affected ABAP statement, runtime API or adapter: a TABL field, or a CDS element, named like a word the dictionary reserves; here `ZOSD_TAXIFACT-ZONE` (`src/ddic/zosd_taxifact.tabl.xml`) and the element `Zone` of `ZC_OSD_TAXICUBE`; `HANDLER` in `ZOSD_ICF_APC`, `ZOSD_ICF_ASIDE` and `ZOSD_SVC`, `SECTION` in `ZOSD_DB`, `PARAMETER` in `ZSTG_FM_PARAM`; the elements `Handler` of `ZC_OSD_ICF_APC`, `ZC_OSD_ICF_HANDLER` and `ZC_OSD_SERVICE` and `Section` of `ZC_OSD_DATABASE`
- Minimal ABAP reproducer: a transparent table with a field `ZONE` of any type; a CDS view with an element `... as Zone`
- Exact command used to run it: **measured on A4H 2026-09-24** twice. `$ZOSG_TMP_0462` (ultra/demodata): ZOSD_TAXIFACT created over ADT with its eleven fields; activation cancelled with "ZONE is a reserved word (choose another field name)" and "TABL ZOSD_TAXIFACT was not activated" (D0 408). `$ZOSG_TMP_0025` (#67), saving the DDL source over ADT: a table with `zone : abap.char(80)` is not saved, "ZONE is a reserved word (choose another field name)"; the same eleven fields with `pickup_zone` save and activate. A DDIC-based CDS view (`@AbapCatalog.sqlViewName`) over that table with `pickup_zone as Zone` is not saved, "ZONE is a reserved word; choose another word"; a view entity with the same element, "ZONE is a reserved word (choose another field name)"; `pickup_zone as PickupZone` activates. All probes were deleted. `$ZOSG_TMP_0025` also found HANDLER, SECTION and PARAMETER refused in a table (TEXT and LENGTH, also in `TRESE`, accepted) and `Handler` / `Section` refused as view-entity elements. `$ZOSG_TMP_0040` (#73): `ZOSD_SVC` with `handler` is not saved, "HANDLER is a reserved word (choose another field name)"; `ZC_OSD_ICF_HANDLER` with `icfhandler as Handler` is not saved, "HANDLER is a reserved word; choose another word", and `ZC_OSD_DATABASE` with `category as Section`, "SECTION is a reserved word; choose another word" (both DDIC-based views).
- Expected SAP behaviour: neither the table nor the view activates. The list is the dictionary table `TRESE` (453 names on A4H; `ZONE` carries the source hint `DB6, MSS`)
- Actual open-abap behaviour: abaplint reports nothing, the transpiler creates `"zone"`, and the table, the CDS cube `ZC_OSD_TAXICUBE` over it and the Analytical List Page work
- Impact on open-steamgate: ZOSD_TAXIFACT, and with it the taxi cube and page, could not be deployed to a system. The table field is now `PICKUP_ZONE` (#67) and the cube's element `PickupZone` (`pickup_zone as PickupZone`), so the OData property is `PICKUPZONE`; the page's annotations, its e2e test and the taxi bench follow it. The demo's OData has no outside consumers, so a system that activates the cube was put before the old property name (decided 2026-09-24). Measured on A4H after the rename (`$ZOSG_TMP_0026`): ZOSD_TAXIFACT with `PICKUP_ZONE` and ZC_OSD_TAXICUBE / ZVOSDTAXICUBE with this tree's source (without `@OData.publish`, which would register a service) activate, and a Data Preview `SELECT PickupZone, SUM( Trips ) ... GROUP BY PickupZone` answers; both were deleted. The same for the other three words (#73): the table fields are `ZOSD_ICF_APC-CLASS_NAME` (SAPC's own name for it), `ZOSD_ICF_ASIDE-ICF_HANDLER`, `ZOSD_SVC-HANDLER_NAME` (a DPC, a handler class, an APC class or an app id), `ZOSD_DB-CATEGORY` and `ZSTG_FM_PARAM-PARAM_NAME`; the elements are `ClassName`, `IcfHandler` (`ZC_OSD_ICF_HANDLER`, like its `IcfName`/`IcfOrder`/`IcfTyp`), `HandlerName` and `Category`, and the OData properties of ZOSD_ICF_SRV and ZOSD_STATUS_SRV follow them (the Fiori pages are annotation-driven from the YAML; the zvdb pack page and the preview e2e read `Category`). `ModuleParameterSet` keeps its property `Parameter`: it is table-mapped, not a CDS element, and only its `sap:label` changes. The JSON the hosts post to `/sap/bc/osd/status/` keeps its keys `handler` and `section`. Measured on A4H (`$ZOSG_TMP_0040`): the five tables and the four DDIC-based views with this tree's sources activate (the views only warn "DDIC-based CDS views are obsolete", `ZC_OSD_ICF_HANDLER` also that ICFTYP is not in its key) and a Data Preview of each view answers with the new column; all deleted. The structures with COUNT, FILE, PACKAGE, ROWCOUNT and RULE (`ZOSD_TYPE_S`, `ZOSD_OBJECT_S`, `ZOSD_SQLTRACE_S`, `ZOSD_ISSUE_S`) are left as they are: a structure has no database table, and among the dictionary objects A4H activated since 2024-01-01 (DD03L joined to DD02L, active version) these names occur in structures only, never in a transparent table: COUNT in 23 structures, FILE 1, PACKAGE 9, ROWCOUNT 2, RULE 2, and PARAMETER 39, HANDLER 1, SECTION 1; a structure of ours could not be activated directly, because vsp creates only transparent tables
- Smallest safe workaround: the renames above. DuckDB files made before it are migrated at boot and by the import (`tools/osd-db-migrate.mjs`, one transaction), **one way**: a build from before the rename cannot read a migrated file (its first `SELECT zone` fails). Views the running build does not have are logged and left, and one of them that names `zone` breaks. A kept HANA schema is not migrated and is refused at boot with the way out (`STG_DB_FRESH=1`); the stamped backends rebuild or set the file aside by their own drift policy. **The migration covers DuckDB only.** A SQLite file (`STG_DB=file`, `STG_DB_PATH` with SQLite) that sees this DDIC drift is moved aside to `*.drift` and the system starts empty: the module signatures imported into `ZSTG_FM_PARAM` and the records in `ZOSD_ICF_ASIDE` are not carried over. The way back is `POST FunctionGroupSet` with the same `*.fugr.xml` again; the aside records are kept in the `*.drift` file only and are not restored by anything (they are written again only when an object next replaces an edited ICF row)
- Upstream issue: [abaplint/abaplint#4331](https://github.com/abaplint/abaplint/issues/4331), filed 2026-09-24: abaplint's `cds_check_syntax` already refuses BEGIN, NUMBER and POSITION; the issue asks for ZONE, HANDLER and SECTION there and a TABL field counterpart
- Regression-test location: `test/db-migrate.mjs` (the migration, including a renamed key column), `test/taxi-import.mjs` (an import into an old-shaped file), `test/reserved-words.mjs` (no field of an own transparent table and no CDS element is one of the names A4H was seen refusing: ZONE, HANDLER, SECTION, PARAMETER; checked failing on the tree before the renames)
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-24-delete-adjacent-default-key -- DELETE ADJACENT DUPLICATES without COMPARING compares whole rows, where a system compares the primary key

- Status: `fixed upstream: abaplint/transpiler#1892, merged 2026-09-24, not yet in a release`
- Discovery date: `2026-09-24`
- Affected versions: `@abaplint/runtime` 2.13.89 as this tree pins it, and every release up to the one that ships #1892 (`packages/runtime/src/statements/delete_internal.ts`: without `COMPARING`, the whole row was compared)
- Affected ABAP statement, runtime API or adapter: `DELETE ADJACENT DUPLICATES FROM itab` without `COMPARING`, on any table whose primary key is not the whole row: a structure `WITH DEFAULT KEY` (or `TYPE TABLE OF` with no key clause), a user key, a sorted key, an empty key
- Minimal ABAP reproducer:

```abap
TYPES: BEGIN OF ty_row,
         c TYPE c LENGTH 2,
         i TYPE i,
       END OF ty_row.
DATA tab TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
DATA row TYPE ty_row.
APPEND row TO tab.
row-i = 7.
APPEND row TO tab.
DELETE ADJACENT DUPLICATES FROM tab.
WRITE / lines( tab ).   " system: 1 -- runtime before #1892: 2
```

- Exact command used to run it: first seen with `ZCL_OSD_DEMO_TAXI`'s grain test (`$ZOSG_TMP_0462`, ultra/demodata): rows (a,2) (a,1) (b,1) of `c(1), i`, `SORT` then `DELETE ADJACENT DUPLICATES`, 2 lines on an ABAP 7.5x system and 3 here. The rule was then measured with ABAP Unit probes on the same ABAP 7.5x system in `$ZOSG_TMP_0030` and `$ZOSG_TMP_0031` (deleted after): two rows that differ in one component only, then `DELETE ADJACENT DUPLICATES FROM tab`; two lines left means the component is in the key.

| Component type | Lines left | In the default key |
| --- | ---: | --- |
| `c`, `n`, `d`, `t` | 2 | yes |
| `string` | 2 | yes |
| `x`, `xstring` | 2 | yes |
| `i`, `int1`, `int2`, `int8` | 1 | no |
| `p`, `f`, `decfloat16`, `decfloat34` | 1 | no |
| `utclong` | 1 | no |
| `c` inside a substructure | 2 | yes, substructures are expanded |
| `i` inside a substructure | 1 | no |
| table component | 1 | no |
| `REF TO data`, `REF TO object` | 1 | no |
| `c` from `INCLUDE TYPE` | 2 | yes |

| Case | System | Runtime before #1892 |
| --- | --- | --- |
| `TYPE TABLE OF ty_row` (no key clause), rows differ in `i` only | 1 line | 2 |
| Only numeric components, `WITH DEFAULT KEY`, two identical rows | 2 lines, nothing deleted | 1 |
| `WITH EMPTY KEY`, two identical rows | 2 lines, nothing deleted | 1 |
| `WITH NON-UNIQUE KEY i`, rows (0,''), (0,'AB'), (5,'AB') | 2 | 3 |
| `SORTED ... WITH NON-UNIQUE KEY c`, rows differ in `n`, then in `c` | 2 | 3 |
| `WITH NON-UNIQUE KEY table_line` | whole row compared | same |
| elementary `STANDARD TABLE OF i`, 1 1 2 1 | 3 | same |

- Expected SAP behaviour: without `COMPARING` only the primary key is compared. The standard key of a structured row is its character-like and byte-like components (`c`, `n`, `d`, `t`, `string`, `x`, `xstring`), with substructures and includes expanded; `i`/`int1`/`int2`/`int8`, `p`, `f`, `decfloat16`/`decfloat34`, `utclong`, table and reference components are not in it. An empty key (a row of numeric components only, or `WITH EMPTY KEY`) deletes nothing, not even identical rows; the syntax check warns "table with an empty primary key"
- Actual open-abap behaviour: before #1892 the runtime compared whole rows, whatever the key, so rows differing only outside the key stayed and an empty key deleted identical rows
- Impact on open-steamgate: found by `ZCL_OSD_DEMO_TAXI`'s grain test, which passed here and failed on the system; the test now sorts and compares by every component explicitly, which both answer alike. Any ABAP relying on the default key to drop rows that differ in an amount or a count keeps them here
- Smallest safe workaround: name the key: `SORT ... BY` and `COMPARING <components>` (or `COMPARING ALL FIELDS` where the whole row is meant)
- Upstream issue: fixed by [abaplint/transpiler#1892](https://github.com/abaplint/transpiler/pull/1892), merged 2026-09-24 (branch `delete-adjacent-default-key`): without `COMPARING`, rows are reduced to their primary key (the given `keyFields`, else the standard key above; `keyType` EMPTY or a standard key with no components deletes nothing). Two callers relied on the old whole-row compare and keep it through an explicit `allFields: true`: `COMPARING ALL FIELDS`, which was transpiled like the plain form, and the duplicate removal after `FOR ALL ENTRIES` (`statements/select.ts`), which passed a `by` the runtime ignored. Not covered: `USING KEY` on the statement is still ignored, and a row type that is itself a table type (empty standard key) is still compared as a whole row
- Relation to ANOMALY-2026-09-24-sort-default-key (ultra/parity-wave1, not on main yet): both measurements agree that a system uses the standard key for `SORT` and `DELETE ADJACENT DUPLICATES` alike. That entry measures the runtime's `SORT` without `BY` on a table of structures as leaving the order unchanged (whole rows compared with `lt`), which contradicts this entry's first version, where the taxi rows came out of `SORT` in the same order on both sides; that agreement was the rows' order, not the runtime sorting by the default key. The key rule measured here (character-like and byte-like components) is wider than what sort-default-key measured (`c` and `string`); the rule of that entry is left to it
- Regression-test location: upstream, `test/statements/delete_internal.ts` (six cases from the tables above), `test/database.ts` ("FOR ALL ENTRIES, duplicates removed comparing all fields, not the key"), `packages/transpiler/test/single_statements.ts` (`COMPARING ALL FIELDS` emits `allFields: true`); here `src/demo_data/zcl_osd_demo_taxi.clas.testclasses.abap` (`grain_and_marks`) uses the portable form, and no test pins the anomaly
- Upstream version containing a fix: `unknown` (merged, not yet released)

### ANOMALY-2026-09-24-httpc-body-latin1 -- open-abap-core's `CL_HTTP_CLIENT` sends the request body one byte per UTF-16 code unit; a system sends UTF-8, whatever charset the request names

- Status: `open`, **measured on an ABAP 7.5x system 2026-09-24** (the Go host of tools/gogen does what Node does, on purpose: Node is its oracle)
- Discovery date: `2026-09-24`
- Affected versions: open-abap-core 4eec777 (`src/http/cl_http_client.clas.abap`, `IF_HTTP_CLIENT~SEND`: `req.write(requestBody, "binary")` of `get_cdata( )`, `content-length` from `lv_body.get().length`)
- Affected ABAP statement, runtime API or adapter: `IF_HTTP_CLIENT~SEND` with a body set by `request->set_cdata( )`; `request->get_cdata( )` after `request->set_data( )`
- Minimal ABAP reproducer: `docs/probes/httpc/zcl_osd_t_httpc_body.testclasses.abap`, `zcl_osd_t_httpc_body2.testclasses.abap`, `zcl_osd_t_httpc_cs.testclasses.abap` (over `zcl_osd_t_httpc.clas.abap` and `z_osd_t_httpc_sleep.func.abap`); on Node, case `post-nonlatin` of `tools/gogen/httpc.mjs` (spike/go-backend)
- Exact command used to run it: the probe classes as ABAP Unit on an ABAP 7.5x system; every request went to the system's own ICM on localhost, logged on with an assertion ticket. The text is `a`, e-acute, euro sign, `z`. Two receivers: `/sap/bc/abap/demo_post?input=X` (SAP's demo handler, answers the body's `&`-parts, but its `unescape_url` turns every non-ASCII character into `#`, so it only counts characters) and `/sap/bc/soap/rfc` calling a probe RFC module that answers the text the SOAP runtime decoded, as UTF-8 (`EV_HEX`). The SOAP receiver decodes UTF-8 whatever the header's charset says (calibrated by posting known UTF-8 bytes with `set_data` under `charset=iso-8859-1`: it answered the text unchanged)
- Expected SAP behaviour, as measured: `set_cdata` puts UTF-8 into the entity and that is what goes out. `request->get_data( )` is `61C3A9E282AC7A` right after `set_cdata` and again after `SEND`, under `text/plain; charset=utf-8`, `text/plain`, no content type at all, `text/plain; charset=iso-8859-1` set before `set_cdata` and set after it, `text/plain;charset=ISO-8859-1`, `charset=windows-1252`, `charset=utf-16`, and the header set through `set_header_field( 'content-type' )` or `( 'Content-Type' )`. Through SOAP every one of these arrived as the same four characters (`EV_HEX` = base64 `YcOp4oKseg==` = `61C3A9E282AC7A`) and the envelope parsed whole. An emoji is `F09F9880` (`61F09F98807A`) and reaches demo_post as two characters, one surrogate pair. So the charset parameter of the request does **not** change the bytes on this system; the entry's first version ("in the entity's code page, UTF-8 by default") was half right. `set_data( '61E97A' )` (not UTF-8) is sent as those three bytes, no exception anywhere; the receiver decoding UTF-8 got an empty body. `request->get_cdata( )` after `set_data` decodes UTF-8 (`41C3A9` gives `Aé`) and gives an **empty string** for bytes that are not UTF-8 (`61E97A`, under no charset, utf-8 and iso-8859-1 alike), not an exception. `Content-Length` of the wire was not seen directly (no raw echo was available); the SOAP envelope arriving whole is consistent with a byte count
- Actual open-abap behaviour: the euro sign goes out as the single byte `AC` (each UTF-16 code unit written as its low byte), `content-length` counts UTF-16 code units, so a non-Latin-1 body is both corrupted and cut short; a body `set_data` filled with bytes that are not UTF-8 raises `CX_SY_CONVERSION_CODEPAGE` in `get_cdata` before anything is sent
- Impact on open-steamgate: any request body outside Latin-1 is corrupted on the wire; ZCL_OSD_GIT's upload-pack request is ASCII and is not affected
- Smallest safe workaround: none in OSG (a caller can `set_data( cl_abap_codepage=>convert_to( text ) )` itself, which is what a system does anyway)
- Upstream: **needs an issue** in open-abap/open-abap-core (`CL_HTTP_CLIENT`): send the bytes of `request->get_data( )`, which are UTF-8 for a `set_cdata` body, with `content-length` from their length; `get_cdata` of bytes that are not UTF-8 answers empty
- Regression-test location: `tools/gogen/httpc.mjs` on spike/go-backend (Node and Go compared, not against a system); the system side is the probe sources above
- Upstream version containing a fix: none yet

### ANOMALY-2026-09-24-httpc-failure-dumps -- a failed `CL_HTTP_CLIENT` request is an uncatchable error on Node; a system returns from SEND and fails RECEIVE with a classic exception

- Status: `open`, **measured on an ABAP 7.5x system 2026-09-24** (the Go host dumps where Node does)
- Discovery date: `2026-09-24`
- Affected versions: open-abap-core 4eec777 (`IF_HTTP_CLIENT~SEND`: the promise rejects out of a `WRITE '@KERNEL'` line; `SEND` and `RECEIVE` end in `sy-subrc = 0. " workaround for classic exceptions`; `GET_LAST_ERROR` answers the status code and `'todo_open_abap'`)
- Affected ABAP statement, runtime API or adapter: `client->send( EXCEPTIONS http_communication_failure = 1 http_invalid_state = 2 http_processing_failed = 3 ... )`, `client->receive( EXCEPTIONS ... )`, `client->get_last_error( )`
- Minimal ABAP reproducer: `docs/probes/httpc/zcl_osd_t_httpc_misc.testclasses.abap`, methods `f1`-`f7`; on Node, cases `refused`, `tls-to-plain`, `bad-scheme`, `header-newline` of `tools/gogen/httpc.mjs` (spike/go-backend)
- Exact command used to run it: the probe class as ABAP Unit on an ABAP 7.5x system, each call inside `TRY ... CATCH cx_root` as well as with `EXCEPTIONS`
- Expected SAP behaviour, as measured: no class-based exception in any case (the `CATCH cx_root` never fired) and no dump. A connection failure is **not** reported by `SEND`, which returns sy-subrc 0; it is `RECEIVE` that ends with `http_communication_failure` (sy-subrc 1, message 00 001 carrying the text), and the response then holds a status and an HTML error page that the ICM made up as the client:

| Case | SEND | RECEIVE | `get_last_error` code / message | `get_status` |
| --- | ---: | ---: | --- | --- |
| connection refused (`http://localhost:1/x`) | 0 | 1 | 411 / `Direct connect to localhost:1 failed: NIECONN_REFUSED(-10)` | 404 `Connection Refused` |
| `https://` to a plain HTTP port | 0 | 1 | 407 / `SSL handshake with localhost:<port> failed: SSSLRC_NO_SSL_RESPONSE (-75)` + the SSL library's explanation | 500 `Native SSL Error` |
| method `GE T` | 0 | 1 | 405 / `Error in HTTP Request: Invalid request line (9); request line: GE T /sap/bc/abap/demo_post HTTP/1.0` | 400 `Bad Request` |
| header value with a newline | 1 (message SHTTP 864) | 2 (SHTTP 862) | after SEND 46 / `46 -Fehlercode beim Senden der Daten.` (the kernel's text, German on that system); after RECEIVE 1001 / `Invalid http state.` | 46, then 1001, empty reason |
| `RECEIVE` without `SEND` | -- | 2 (SHTTP 862) | 1001 / `Invalid http state.` | -- |
| `ftp://` URL | `create_by_url` sy-subrc 1 (`argument_not_found`), no client | | | |
| header name with a space | 0 | 0 | sent as is, the server answered 200 | 200 |

- Actual open-abap behaviour: a JavaScript error no `CATCH` takes (a dump) for the refused, TLS, scheme and header-newline cases; the classic exceptions are never raised and sy-subrc is 0 whenever the call returns; `get_last_error` has no message
- Impact on open-steamgate: ZCL_OSD_GIT (and any client) cannot report an unreachable remote; the dialog step dumps
- Smallest safe workaround: none in OSG
- Upstream: **needs an issue** in open-abap/open-abap-core (`CL_HTTP_CLIENT`): catch the request's error in `SEND`, keep it, and let `RECEIVE` set sy-subrc 1 with the message in `get_last_error`; the response status the ICM invents (404/500/400) is secondary. Classic exceptions from a method in the transpiler are the underlying gap the source comment names
- Regression-test location: `tools/gogen/httpc.mjs` on spike/go-backend; the system side is the probe source above
- Upstream version containing a fix: none yet

### ANOMALY-2026-09-24-httpc-timeout-ignored -- `SEND`'s `TIMEOUT` is ignored by open-abap-core's `CL_HTTP_CLIENT`; a system ends RECEIVE after that many seconds

- Status: `open`, **measured on an ABAP 7.5x system 2026-09-24** (the Go host ignores it as well)
- Discovery date: `2026-09-24`
- Affected versions: open-abap-core 4eec777 (`IF_HTTP_CLIENT~SEND` never reads `timeout`; no timeout is set on the Node request or its agent)
- Affected ABAP statement, runtime API or adapter: `client->send( timeout = n )`
- Minimal ABAP reproducer: `docs/probes/httpc/zcl_osd_t_httpc_time.testclasses.abap`, methods `t0`-`t5`
- Exact command used to run it: the probe class as ABAP Unit on an ABAP 7.5x system against the system's own `/sap/bc/soap/rfc` calling a probe RFC module that waits a given number of seconds (at most 10); elapsed time from `GET TIME STAMP` around `SEND` + `RECEIVE`
- Expected SAP behaviour, as measured: `if_http_client=>co_timeout_default` is 0 and `co_timeout_infinite` is -1. `send( timeout = 2 )` against a 6-second answer: `SEND` sy-subrc 0, `RECEIVE` sy-subrc 1 (`http_communication_failure`, message 00 001) after 2054 ms, `get_last_error` 402 / `Connection to partner timed out after 2s.`, `get_status` 500 `Internal Server Error` with an ICM error page. `timeout = 10` against 3 s: answered in 3014 ms; `timeout = 0` (default) against 3 s: 3013 ms; `timeout = -1` against 2 s: 2014 ms. `timeout = -5`: `SEND` sy-subrc 4 (`http_invalid_timeout`, message SHTTP 865), nothing sent; the following `RECEIVE` sy-subrc 1 (SHTTP 864), `get_last_error` 17 / `Internal error. Handle for this http session was not found or is NULL.` The default timeout's own length (a profile value) was not measured
- Actual open-abap behaviour: the request waits as long as the socket stays open, whatever `timeout` says; an invalid value is not refused
- Impact on open-steamgate: a remote that hangs hangs the dialog step
- Smallest safe workaround: none in OSG
- Upstream: **needs an issue** in open-abap/open-abap-core (`CL_HTTP_CLIENT`): a positive `timeout` as a socket timeout on the request, surfacing at `RECEIVE` as `http_communication_failure` (together with the failure entry above); a value below -1 is `http_invalid_timeout` from `SEND`
- Regression-test location: none here (no timing test); the system side is the probe source above
- Upstream version containing a fix: none yet

### ANOMALY-2026-09-24-httpc-status-code-field -- the response of open-abap-core's `CL_HTTP_CLIENT` has no `~status_code` header field; a system's has it and five more pseudo fields

- Status: `open`, **measured on an ABAP 7.5x system 2026-09-24** (the Go host does the same)
- Discovery date: `2026-09-24`
- Affected versions: open-abap-core 4eec777 (`IF_HTTP_CLIENT~SEND` sets `mv_status` and the header fields Node returns; no pseudo field)
- Affected ABAP statement, runtime API or adapter: `client->response->get_header_field( '~status_code' )`, `~status_reason`, `~server_protocol`, `get_header_fields( )`; `get_status( )` itself answers on both
- Minimal ABAP reproducer: `docs/probes/httpc/zcl_osd_t_httpc_misc.testclasses.abap`, methods `s1`-`s4` (every probe call prints `get_status( )`, the three fields and the names of all `~` fields); on Node, case `status-500` of `tools/gogen/httpc.mjs` (spike/go-backend)
- Exact command used to run it: the probe classes as ABAP Unit on an ABAP 7.5x system
- Expected SAP behaviour, as measured: after a `RECEIVE` that got an answer, `get_header_fields( )` lists `~response_line`, `~server_protocol`, `~status_code`, `~status_reason`, `~remote_addr`, `~uri_scheme_expanded` (after the timeout only the first four), and `~status_code` / `~status_reason` agree with `get_status( )` in every case seen: 200 `OK`, 401 `Unauthorized`, 403 `Forbidden`, 404 `Not found`, 500 `Soap document processing failed`, and the ICM's own 404 `Connection Refused`, 500 `Native SSL Error`, 400 `Bad Request`, 500 `Internal Server Error` of the failure entries. `~server_protocol` was `HTTP/1.0` against this system's own ICM. When `SEND` itself failed (a header with a newline), the three fields are empty and `get_status( )` answers the last error code (46, then 1001) with an empty reason
- Actual open-abap behaviour: `~status_code`, `~status_reason` and `~server_protocol` are empty and `get_header_fields( )` has no `~` field; `get_status( )` gives the code and an empty reason
- Impact on open-steamgate: ZCL_OSD_GIT's 4xx/5xx check reads `~status_code` and never fires, on Node or on OSGo
- Smallest safe workaround: none in OSG (read `get_status( )` instead, in the ABAP that is ours)
- Upstream: **needs an issue** in open-abap/open-abap-core (`CL_HTTP_CLIENT`): set `~status_code`, `~status_reason` (Node's `statusMessage`) and `~server_protocol` on the response, and `get_status`'s reason
- Regression-test location: `tools/gogen/httpc.mjs` on spike/go-backend; the system side is the probe source above
- Upstream version containing a fix: none yet

### ANOMALY-2026-09-24-httpc-post-url-query -- open-abap-core moves the query of a POST's URL into the body even when the program set a body; a system does that only for a POST without one

- Status: `open`, **measured on an ABAP 7.5x system 2026-09-24**; narrowed: the case `tools/gogen/httpc.mjs` records (`query-post`, a POST with no body) does on a system what it does here, except the content type (the Go host does the same as Node)
- Discovery date: `2026-09-24`
- Affected versions: open-abap-core 4eec777 (`CREATE_BY_URL` splits the query off into form fields with `cl_http_utility=>set_query`; `SEND` writes the form fields of a POST into the body with `set_cdata`, whether or not a body was set, and sets no content type for them)
- Affected ABAP statement, runtime API or adapter: `cl_http_client=>create_by_url( 'http://h/p?a=1' )` followed by `request->set_method( 'POST' )`, a body or none, and `send( )`
- Minimal ABAP reproducer: `docs/probes/httpc/zcl_osd_t_httpc_misc.testclasses.abap`, methods `q1`-`q4`, and `zcl_osd_t_httpc_time.testclasses.abap`, method `q5`; on Node, case `query-post` of `tools/gogen/httpc.mjs` (spike/go-backend)
- Exact command used to run it: the probe classes as ABAP Unit on an ABAP 7.5x system against SAP's demo handler `/sap/bc/abap/demo_post`, which answers the request's `~QUERY_STRING` (without `input=X`) or the `&`-parts of its body (with `input=X`)
- Expected SAP behaviour, as measured: `create_by_url` keeps only the path in `~request_uri` and leaves `~query_string` empty, as open-abap-core does; the query waits as form fields. At `SEND`:
  - GET: the fields go onto the request line (`~QUERY_STRING` at the server `k=v&z=1`, order kept)
  - POST with a body set by `set_cdata` (`BODY`, `b=1`): the fields go onto the request line (`k=v&z=1`) and the body is sent unchanged
  - POST with no body: the fields become the body (`input=X&k=v` at the server), the request line has no query (`~QUERY_STRING` empty), and the request's `content-type` field reads `application/x-www-form-urlencoded` after `SEND` (while `request->get_data( )` stays empty)
- Actual open-abap behaviour: a POST always gets the fields as its body, replacing a body set before (`set_cdata`), with no query on the request line and no `content-type`
- Impact on open-steamgate: none found (git's smart HTTP puts `?service=` on GETs only)
- Smallest safe workaround: none in OSG
- Upstream: **needs an issue** in open-abap/open-abap-core (`CL_HTTP_CLIENT`), narrow: when a POST has a body, put the fields on the URL as for GET; when it has none, keep writing them into the body and add `content-type: application/x-www-form-urlencoded` unless one is set. PUT and other methods were not measured
- Regression-test location: `tools/gogen/httpc.mjs` on spike/go-backend; the system side is the probe sources above
- Upstream version containing a fix: none yet

### ANOMALY-2026-09-18-icf-shim-form-fields-from-body — A POSTed form field is not there, and reads as an empty one

The same defect as ANOMALY-2026-09-19-posted-form-has-no-fields, found a day
earlier building the AMDP sandbox (backlog G.8); the entries are merged there
(2026-09-24), with this one's workaround and its `+`-to-space trap.

### ANOMALY-2026-09-18-call-function-parameter-case — A destination call is made in lower case and the declaration is upper, so it answers into nothing

**A destination call runs and answers into nothing.** The transpiler writes the
parameter names of a `CALL FUNCTION` in the case they were typed in the ABAP
source, which for ordinary ABAP is **lower**:

```js
abap.statements.callFunction({name: 'ZOSD_AMDP_SANDBOX', destination: 'AMDP',
  exporting: {iv_body: lv_body}, importing: {ev_result: lv_result, ...}});
```

The function group declares the same parameters **upper** case (`IV_BODY`,
`EV_RESULT`), which is how a `*.fugr.xml` names them and how a real system
holds them. A destination implementation that looks its parameters up by the
declared name therefore finds nothing: the call is made, the work is done, and
the answer is written into a bag nobody reads.

**Why it is worth an entry.** On a system this cannot happen -- the kernel
resolves the parameter interface, and case is not a property the caller
carries. Here the two spellings meet, and the failure leaves **no trace at
all**: no exception, no error, no empty result to be suspicious of. The page
that prompted it showed neither a result nor an error, which is the least
informative outcome a program can produce.

Found building the AMDP sandbox (backlog G.8). **Workaround** in
`tools/amdp-destination.mjs`: look parameters up case-insensitively. Every
destination implementation needs the same, so it belongs in the contract rather
than in each one -- see `docs/rfc-destinations.example.json` and the note in
`tools/rfc-replay.mjs`.

**Upstream:** abaplint/transpiler, if the intent is that a destination sees the
declared names. Not yet drafted -- the question to ask first is which spelling
is meant to be authoritative.


### ANOMALY-2026-09-18-system-uuid-window — cl_system_uuid asks a service worker for `window`, and drops the ABAP wrapper when it does

- Status: `workaround`
- Discovery date: `2026-09-18`
- Affected versions: `open-abap-core` at `.local/lars/open-abap-core` (`src/uuid/cl_system_uuid.clas.abap`), any host that is not Node
- Affected ABAP statement, runtime API or adapter: `cl_system_uuid=>if_system_uuid_static~create_uuid_c32` / `_c22` / `_c36` / `_x16`, all four through the private `RANDOM`
- Minimal ABAP reproducer: `DATA(lv) = cl_system_uuid=>if_system_uuid_static~create_uuid_c32( ).` anywhere that runs in the browser deployment
- Exact command used to run it: `npm run web:preview` then `grep -o ".\{40\}window\.crypto.\{0,40\}" build/preview/sw.js`
- Expected SAP behaviour: a 32-character uuid, on every host
- Actual open-abap behaviour: `RANDOM` does `await import("crypto")` and, when that module has no `randomUUID`, falls back to `rv_str = window.crypto.randomUUID();`. Two things are wrong with that line in this tree, and the second one only shows on a host where the first does not bite:
  - webpack polyfills `crypto` with `crypto-browserify`, which has **no** `randomUUID` (`prng, pseudoRandomBytes, rng, randomBytes, Hash, …`), so the fallback is the branch that runs; and the browser deployment is a **service worker**, where there is no `window` at all. `ReferenceError`.
  - the fallback assigns the JavaScript variable rather than calling `set( )` on it — `rv_str = …` where every other line of the method is `rv_str.set(…)` — so a plain page, where `window` does exist, gets a raw JavaScript string back where the caller's ABAP type is a `String`.
- Impact on open-steamgate: the dialog-session id of a transaction (backlog G.3) is the first thing in this tree that wanted a uuid, and the browser preview is one of the three deployments it has to work in
- Smallest safe workaround: `zcl_osd_tran_session=>new_id( )` — `GET TIME STAMP` plus `cl_abap_random`, which is `Math.random( )` on every host and needs no import. Local, and one line from becoming the upstream call again
- Upstream issue: not filed yet. It belongs in `open-abap/open-abap-core` and is two lines: `globalThis.crypto` rather than `window.crypto`, and `rv_str.set(…)` rather than `rv_str = …`. See `docs/upstream.md`
- Regression-test location: `src/webgui/zcl_osd_tran_session.clas.testclasses.abap` (`ltcl_session`, which would fail on any host where the id could not be made) and `test/transaction.mjs`
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-17-integer-division-not-rounded — In integer arithmetic, a division keeps its fraction until the end of the expression

- Status: `open, issue filed`
- Discovery date: `2026-09-17`
- Affected versions: `@abaplint/transpiler` 2.13.87 and `@abaplint/runtime` 2.13.87 together: the transpiler emits `abap.operators.divide( )` for every `/`, and the runtime's `divide` answers a `Float` for two integers; nothing rounds until the target is assigned
- Affected ABAP statement, runtime API or adapter: any arithmetic expression whose calculation type is `i` (every operand and the target are integers) with a `/` in it that is not the last operation — `( a / 3 + b ) MOD 256`, `7 / 2 + 7 / 2`, `( 7 / 2 ) * 2`
- Minimal ABAP reproducer:

```abap
DATA i TYPE i.
i = 7 / 2 + 7 / 2.              " SAP: 8 — open-abap: 7
i = ( 7 / 2 ) * 2.              " SAP: 8 — open-abap: 7
i = ( -40 / 3 + 13 ) MOD 256.   " SAP: 0 — open-abap: 256
DATA f TYPE f.
f = 7 / 2 + 7 / 2.              " SAP: 7 — open-abap: 7 (the target makes the calculation type f)
```

- Exact command used to run it: `tools/o4d-record.mjs --scene plasma --ticks 256` against A4H after `ANOMALY-2026-09-17-append-number-rounded` was fixed: 7 frames of 256 still differed (10, 41, 161, 177, 192, 208, 223), each in exactly one row of 32 rectangles. The row's sine index is `( lv_y / 3 + CONV i( lv_t1 * 35 ) ) MOD 256`, and for those rows the sum before `MOD` is −0.333 or 255.667: a system rounds `lv_y / 3` to an integer first and gets 0, here the fraction survives, `MOD` gives 255.667, the integer target rounds it to 256, and `READ TABLE mt_sin INDEX 257` fails, leaving the previous pixel's value in `lv_v2`. **Measured on A4H, 2026-09-17**, ABAP Unit on a probe class: `( -40 / 3 + 13 ) MOD 256` = 0, `( 140 / 3 + 209 ) MOD 256` = 0, `7 / 2 + 7 / 2` = 8, `( 7 / 2 ) * 2` = 8, `10 / 4 + 10 / 4` = 6, and into an `f` target `7 / 2 + 7 / 2` = 7. The runtime asked directly gives 256, 256, 7, 7, 5 and 7. The probe class was deleted afterwards.
- Expected SAP behaviour: with calculation type `i`, every intermediate result of `/` is rounded to an integer (ABAP keyword documentation, "Calculation Type"; the rounding is commercial, half away from zero)
- Actual open-abap behaviour: the intermediate is a float, rounded once at the assignment
- Impact on open-steamgate: 7 of 256 plasma frames, one wrong row each; and the whole tesseract scene (127 of 128 frames): `CONV i( lv_bright / 255 * 60 + 20 )` with `lv_bright TYPE i` is 20 or 80 on a system (`200 / 255` rounds to 1, measured `l=80` on A4H 2026-09-17) and 39 to 70 here, so the depth shading of every line differs. Any ABAP that does integer arithmetic with a division inside a longer expression — index computations, bucketing, `MOD` after a division — silently differs
- Smallest safe workaround: none in ABAP that a system would want; the code is right as written
- Upstream issue: [abaplint/transpiler#1866](https://github.com/abaplint/transpiler/issues/1866), filed 2026-09-17 as a question with the six measured lines, after a critic pass. The fix is not in the runtime alone: whether `7 / 2` is 4 or 3.5 depends on the calculation type of the whole statement, which the target decides too, so the transpiler has to emit a rounding division (a `divide` with an integer flag, or `abap.operators.div_i`) when the expression's calculation type is `i`, and core knows that type. A design question for Lars; the reproducer is the four lines above as a transpiler test.
- Regression-test location: none yet; `packages/transpiler/test` over the reproducer
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-17-append-number-rounded — `APPEND sin( x ) TO` a float table rounds the value to an integer

- Status: `fixed upstream: abaplint/transpiler#1867, released in 2.13.88`
- Discovery date: `2026-09-17`
- Affected versions: `@abaplint/runtime 2.13.87` (`types/table.ts`, `cloneRow`, twice)
- Affected ABAP statement, runtime API or adapter: `APPEND <numeric function>( … ) TO itab` where the row type is `f` (or `p`, or anything with a fraction) — `sin`, `cos`, `sqrt`, `abs`, `floor`, `ceil`, `trunc`, `sign`, `log`, `exp` return a raw JavaScript number from the runtime
- Minimal ABAP reproducer:

```abap
DATA sines TYPE STANDARD TABLE OF f WITH EMPTY KEY.
DO 256 TIMES.
  APPEND sin( ( sy-index - 1 ) * '6.283185' / 256 ) TO sines.
ENDDO.
READ TABLE sines INDEX 2 INTO DATA(second).   " SAP: 0.024541227323353419 — open-abap: 0
READ TABLE sines INDEX 7 INTO DATA(seventh).  " SAP: 0.14673046733376413 — open-abap: 0 (index 65, sin of a quarter turn, is 1 on both, which is why the first draft of the issue reproduced nothing)
```

- Exact command used to run it: `tools/o4d-record.mjs --scene plasma --ticks 256` on the lab and on A4H, then `--compare`: 256 of 256 frames differ, every rectangle's `f` (its colour) — 7 distinct colours here across 641 rectangles and 169 there, frame 0 all `rgb(20,201,201)` here (hue 180: the row's four sines are 0 after rounding). Then the runtime asked directly: `append({source: abap.builtin.sin({val: Float 0.5}), target: <float table>})` leaves a row of `0`; `append({source: Float 0.479})` keeps it. The values of indexes 2, 7 and 65 were measured on A4H with an ABAP Unit probe (0.0245…, 0.1467…, 0.99999…97); the old wrapping makes them 0, 0, 1. The critic pass before the issue caught the first draft claiming "all zeros": the table holds −1, 0 and 1.
- Expected SAP behaviour: the sine value in the row
- Actual open-abap behaviour: `cloneRow` wraps a raw number as `new Integer().set(item)` before setting the row, so the value is rounded to the nearest integer before the float row sees it
- Impact on open-steamgate: the plasma scene of the demo has 7 colours across a frame instead of 169; any ABAP that tabulates a numeric function
- Smallest safe workaround: assign to an `f` variable first and append that
- Upstream issue: [abaplint/transpiler#1865](https://github.com/abaplint/transpiler/issues/1865), filed 2026-09-17 after a critic pass; PR [#1867](https://github.com/abaplint/transpiler/pull/1867) the same day. Branch `fix/append-number-float` (worktree `.local/pr-append-number` of the transpiler clone, based on `origin/main`, 283a48d8): a whole number stays an `Integer`, anything else goes through a `Float`; cherry-picked onto `local/osd-build`. Runtime tests and lint green.
- Regression-test location: `packages/runtime/test/statements/append_number.ts`, upstream since #1867
- **Verified, 2026-09-17.** With the fix on `local/osd-build` and the runtime rebuilt, the plasma scene against A4H goes from 256 differing frames of 256 to 18: 12 of them the pulse `p` (`ANOMALY-2026-09-16-numeric-builtins-typed-integer`), 7 one row each (`ANOMALY-2026-09-17-integer-division-not-rounded`).
- Upstream version containing a fix: `2.13.88`

### ANOMALY-2026-09-17-character-literal-calc-type — An inline declaration from `lc_h * ( '0.4' + … )` is a character

- Status: `fixed upstream, pin behind`
- Discovery date: `2026-09-17`
- Affected versions: `@abaplint/core` up to 2.120.51; fixed in 2.120.52 by [abaplint/abaplint#4293](https://github.com/abaplint/abaplint/pull/4293) (merged 2026-09-14). The transpiler build this tree and the preview were pinned to (`local/osd-build`) still resolved 2.120.50.
- Affected ABAP statement, runtime API or adapter: `DATA(x) = <arithmetic expression with a character literal>` — the inline variable took the literal's type, `Character(4)` for `'0.12'`
- Minimal ABAP reproducer:

```abap
CONSTANTS lc_h TYPE f VALUE 400.
DATA(lv_base_y) = lc_h * ( '0.4' + 1 * '0.12' ).   " SAP: f, 208 — open-abap: c(4) '2,08', then 2 in arithmetic
```

- Exact command used to run it: `tools/o4d-record.mjs --scene mountains_oops --ticks 512` on the lab and on A4H: 511 of 512 frames differ, every mountain rectangle's `y` and `h` by exactly 159. The generated module declares `lv_base_y = new abap.types.Character(4, {})`; the runtime asked directly: `Character(4).set(400 * ('0.4' + 0 * '0.12'))` is `"1,60"`, and `"1,60" - lv_h` reads it as 1. 160 − 1 = 159.
- Expected SAP behaviour: the calculation type of the expression, `f`; 160
- Actual open-abap behaviour: a four-character field, and a float printed with the user's decimal comma into it, read back as its integer part
- Impact on open-steamgate: the mountains scene sits 159 pixels too high; more generally any inline declaration from an expression with a character literal in it
- Smallest safe workaround: none needed once core is at 2.120.52
- Upstream issue: fixed by #4293. The action here is the pin: `local/osd-build` takes `@abaplint/core ^2.120.54` (c148d363), and the preview workflow's `OSD_TRANSPILER_REF` moves with it.
- Regression-test location: upstream, with #4293; here the frame comparison of the mountains scene
- **Verified, 2026-09-17.** With core 2.120.54 in the pinned build, the mountains scene against A4H goes from 511 differing frames of 512 to 268, and the constant 159 is gone. What remains is in bars 28 to 31 only, the sharp mountains: `DATA(lv_tri1) = abs( ( lv_nx MOD 2 ) - 1 ) * 2 - 1` is declared an integer because `abs` is (`ANOMALY-2026-09-16-numeric-builtins-typed-integer`, core), and the `MOD` fix alone changes nothing there; plus the pulse `p` and the beat `flash` it triggers, the same core anomaly.
- Upstream version containing a fix: `@abaplint/core 2.120.52`

### ANOMALY-2026-09-16-numeric-builtins-typed-integer — `frac`, `abs`, `floor`, `ceil`, `trunc`, `sign` of a float are typed as integers

- Status: `open, issue filed`
- Discovery date: `2026-09-16`
- Affected versions: `@abaplint/core 2.120.50` and 2.120.54 (`build/src/abap/5_syntax/_builtin.js`, entries `FRAC`, `FLOOR`, `CEIL`, `TRUNC`, `ABS`, `SIGN`: `return: IntegerType.get()`), and so every transpile
- Affected ABAP statement, runtime API or adapter: an inline declaration from one of the six numeric functions — `DATA(lv_phase) = frac( lv_time / lv_step )`, `DATA(lv_d) = abs( lv_x - lv_y )` — and anything else that takes the function's type from the syntax analysis rather than from the value
- Minimal ABAP reproducer:

```abap
DATA time TYPE f VALUE '8.25'.
DATA(phase) = frac( time ).     " SAP: f, 0.25 — open-abap: i, 0
DATA(dist)  = abs( CONV f( '-2.5' ) ).  " SAP: f, 2.5 — open-abap: i, 3
```

- Exact command used to run it: the ZO4D demo compared frame by frame with A4H after `ANOMALY-2026-09-16-float-vs-character-compare` was fixed: 3 frames of 60 still differed, all in the beat pulse `1 / ( 1 + lv_phase16 * 12 )`; on A4H `lv_phase16` runs 0, 0.25, 0.5, 0.75 and here 0, 0, 1, 1. The generated module declares it `new abap.types.Integer({qualifiedName: "I"})` and `abap.builtin.frac` returns a `Float` of 0.25 into it. Then the core table, read directly. **Measured on A4H, 2026-09-17**, with an ABAP Unit class asking `cl_abap_typedescr=>describe_by_data( )->type_kind` of the inline variable: `frac( f )` and `abs( f )` are `typekind_float`, `frac( 7 )` is `typekind_int`; the probe class was deleted afterwards.
- Expected SAP behaviour: the numeric functions `abs`, `ceil`, `floor`, `frac`, `sign` and `trunc` return a value **of the type of their argument** (ABAP keyword documentation, "Numeric Functions"); `frac( f )` is `f`.
- Actual open-abap behaviour: the six are declared with a fixed integer return type in core's built-in table, whatever the argument. The runtime's `frac` returns a float and the variable it lands in rounds it, so the value is right for a moment and wrong at rest.
- Impact on open-steamgate: the last three of sixty differing frames of the demo's first scene, and, measured 2026-09-17 with every other anomaly fixed, everything that still differs from A4H in three more: the pulse `p` in 12 of 256 plasma frames and 24 of 512 mountains frames, the beat `flash` it triggers (10 mountains frames), the brightness of 13 voxel-landscape frames on the beat, and the sharp mountains of bars 28 to 31 (`DATA(lv_tri1) = abs( … )` declared an integer). More generally any 7.40-style ABAP that declares inline from these functions over a float gets an integer without a word from the compiler. Business code, which mostly applies them to `i` and `p`, is not hit — for `i` the rule and the table agree.
- Smallest safe workaround: declare the variable — `DATA lv_phase16 TYPE f.` before the assignment — which is what the demo's author would not write on a system.
- Upstream issue: [abaplint/abaplint#4302](https://github.com/abaplint/abaplint/issues/4302), filed 2026-09-17 with the measurement and the three tests. Branch `fix/numeric-builtins-argument-type` in the fork worktree (`~/dev/abaplint/.local/pr-numeric-builtins`, based on `origin/main`) carries the tests only, no fix yet. The fix is not a table edit: `IBuiltinMethod.return` is one static `AbstractType`, so the six need their return type taken from the argument where the call is typed: `expressions/method_call_chain.ts` sets `context` to the declared return (line 101 of 2.120.52) *before* `MethodCallParam.runSyntax` analyses the argument; for these six, `context` should be the argument's type once that has run. A fork PR, since `oisee` has no write access there (`DEBT-2026-09-14-no-push-to-abaplint`).
- Regression-test location: `packages/core/test/abap/syntax/basic_variables.ts` on the branch — "inline DATA from frac( f ) is a float", "… abs( f ) …" (both failing on 2.120.54: `expected IntegerType to be an instance of FloatType`) and "frac( i ) stays an integer" (passing)
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-17-release-bundle-slower-than-source — The release bundle runs ABAP arithmetic three and a half times slower than the same build on plain Node

- Status: `measured, not diagnosed`
- Discovery date: `2026-09-17`
- Affected versions: this tree's own `scripts/build-sea.mjs` bundle (`osd.mjs`) and, by extension, the Bun binary and every release deployed from them
- Affected ABAP statement, runtime API or adapter: none in particular — arithmetic-heavy ABAP, measured on the demo
- Minimal reproducer: serve one generation two ways and profile the same scene.

```
node tools/o4d-profile.mjs http://127.0.0.1:<port> --scene quat_julia --ticks 60
# the ordinary source host (test/run.mjs -> tools/osd-serve.mjs):   100.4 ms a frame
# the release bundle (.local/release-*/osd.mjs serve):              363.3 ms a frame
```

- Exact command used to run it: found while re-measuring the code-generation
  feature with five interleaved rounds a side, 2026-09-17. The same cached
  generation, the same machine, the same scene. Node was ruled out as the
  cause: the source host under the release tree's own private Node 26.9 gives
  98.6-101.5 ms, indistinguishable from system Node 26.3 at 100.4.
- Expected behaviour: a bundle of the same code runs at roughly the speed of
  the code.
- Actual behaviour: **3.5x slower**, and not uniformly. The penalty falls on
  the `@abaplint/runtime` operator protocol specifically: with the transpiler's
  typed-arithmetic flag **off** the bundle costs 3.6x (100 -> 363 ms), with it
  **on** only 2.0x (59 -> 119 ms). Whatever the bundling does, it does it to
  the operators.
- Impact on open-steamgate: **this is what the i7 and every release run.**
  The demo on a deployed release is several times slower than the same code
  served from a checkout, and the work-process pool (B.12) was measured on the
  source host. It also silently inflates any performance comparison taken
  through a release: a change that removes protocol work looks better than it
  is, which is how a -41 % improvement read as -63 % before this was found.
- Smallest safe workaround: measure on the source host. For deployment there
  is none yet, because the cause is unknown.
- Suspects, none confirmed: Terser's mangling of the runtime's hot classes
  (`keep_classnames`/`keep_fnames` are set for a correctness reason, so the
  shape V8 sees may still differ), the bundle's single-chunk module wrapper
  defeating inlining, or the generated code reaching the runtime through the
  plugin's `build.module` copy rather than a normal import (CLAUDE.md, the
  binary's four facts).
- Upstream issue: none; this is ours.
- Regression-test location: none yet
- Upstream version containing a fix: n/a

### ANOMALY-2026-09-17-character-operand-calculation-type — A character literal in arithmetic gives a different type on each side, and neither is the kernel's

- Status: `measured, not fixed`
- Discovery date: `2026-09-17`
- Affected versions: `@abaplint/runtime 2.13.87` (`operators/multiply.ts`, `minus.ts`, `add.ts`, `divide.ts`) and the transpiler's inferred type for an inline declaration
- Affected ABAP statement, runtime API or adapter: any arithmetic with a character literal operand, which is how ABAP spells a non-integer constant
- Minimal ABAP reproducer:

```abap
DATA lv_i TYPE i VALUE 3.
DATA(lv_a) = lv_i * '2'.      " SAP: P(8,0) 6    open-abap: Float 6
DATA(lv_b) = '2' * lv_i.      " SAP: P(8,0) 6    open-abap: Integer 6
DATA(lv_c) = lv_i * '2.5'.    " SAP: P(8,0) 8    open-abap: Float 7.5
```

- Exact command used to run it: **measured on A4H, 2026-09-17**, a throwaway class with an ABAP Unit test that fails on purpose so the assertion message carries `cl_abap_typedescr=>describe_by_data( )->type_kind` and the value of each expression; created, read and deleted. The runtime side was read from the operators directly.
- Expected SAP behaviour: a character-like operand makes the calculation type packed, **symmetrically** — the side the literal is on does not matter. The system answers `P(8,0)` for `*`, `-`, `+` and `/` alike, and the compiler warns nine times that `P(8,0)` is used implicitly because the length and the decimals cannot be derived.
- Actual open-abap behaviour: the operators test a character operand only on one side, and differently per operator. `multiply` and `minus` check `Number.isInteger(Number(left.get()))` for the left operand only; the right-hand test reads the object rather than its value, so it can never fire; `divide` has no character branch at all. The result is `Integer` with the literal on the left and `Float` with it on the right, and neither is packed.
- **The second half of the measurement, and the more useful half**: the rounding is not in the computation, it is in the target. On A4H `lv_f = lv_i * '2.5'` is 7.5 and `lv_p` with four decimals is 7.5000, while the inline `DATA(x)` is 8, because the inferred type is `P(8,0)`. And with no character literal at all, `lv_f = lv_i / 2` is 1.5 while `DATA(x) = lv_i / 2` is `I` and 2. **So the kernel chooses the calculation type from the target of the assignment as well as from the operands**, which is exactly the question [abaplint/transpiler#1866](https://github.com/abaplint/transpiler/issues/1866) asks and has no answer to yet. This is the measurement that issue was missing.
- Impact on open-steamgate: this is the family behind the inline-declaration differences the frame comparison found (`docs/frame-comparison.md`, the mountains and tesseract rows). A scene that writes `DATA(lv_x) = lc_h * ( '0.4' + … )` is packed with no decimals on a system and a float here.
- Smallest safe workaround: declare the variable rather than inferring it, and give it the type the computation needs.
- Upstream issue: none of its own yet. It belongs with #1866 as the measurement that answers it, and the asymmetry is a candidate in the draft of the character-literal issue (`docs/upstream.md`, the performance track).
- Regression-test location: none yet
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-16-mod-result-integer — `MOD` with a float operand answers an integer

- Status: `fixed upstream: abaplint/transpiler#1863, merged 2026-09-18, released in @abaplint/runtime 2.13.88; this tree already has it`
- Discovery date: `2026-09-16`
- Affected versions: `@abaplint/runtime 2.13.86` and 2.13.87 (`operators/mod.ts`)
- Affected ABAP statement, runtime API or adapter: `a MOD b` where either operand is a float (or a packed number with decimals)
- Minimal ABAP reproducer:

```abap
DATA r TYPE f.
r = CONV f( '2.75' ) MOD 1.   " SAP: 0.75 — open-abap: 1
```

- Exact command used to run it: the runtime asked directly, `abap.operators.mod(Float 2.75, Integer 1)` — the value is computed as 0.75 and returned in an `Integer`, which rounds it to 1. Found while probing the arithmetic around `ANOMALY-2026-09-16-numeric-builtins-typed-integer`. **Measured on A4H, 2026-09-17** (ABAP Unit, `lv_f = '2.75'. rv_r = lv_f MOD 1.` into an `f`): 0.75.
- Expected SAP behaviour: the calculation type of the operands decides — with a float operand the result is a float, 0.75.
- Actual open-abap behaviour: `mod()` returns `new Integer().set(val)` for anything that is not `Integer8`, and the integer rounds the remainder.
- Impact on open-steamgate: none seen in the demo; every effect that keeps a phase with `MOD` on floats would be quantised the way the pulse was.
- Smallest safe workaround: `frac( a / b ) * b` in ABAP, which stays float
- Upstream issue: [abaplint/transpiler#1860](https://github.com/abaplint/transpiler/issues/1860), filed 2026-09-17; PR [#1863](https://github.com/abaplint/transpiler/pull/1863), 2026-09-17. Branch `fix/mod-float-result` (worktree `.local/pr-mod-float-result` of the transpiler clone, based on `origin/main`), one commit with the fix and the test (2026-09-17, after Alice asked why the tests went without fixes): a `Float` result when either operand is one or the remainder is not whole, beside the `Integer8` case that already exists; the runtime's tests and lint green.
- Regression-test location: `packages/runtime/test/arithmetics.ts` on the branch, "MOD with a float operand answers a float" (failed on 2.13.87 with `expected Integer{ value: 1 } to be an instance of Float`, passes with the fix)
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-16-integer-rounds-negative-half-to-zero — A float of −0.5 assigned to an integer becomes 0

- Status: `fixed upstream: abaplint/transpiler#1864, released in 2.13.88`
- Discovery date: `2026-09-16`
- Affected versions: `@abaplint/runtime 2.13.86` and 2.13.87 (`types/integer.ts`, `set()` with `Math.round`)
- Affected ABAP statement, runtime API or adapter: any move of a negative float exactly on a half to an integer — `lv_i = lv_f` with `lv_f = -0.5`, `-1.5`, …
- Minimal ABAP reproducer:

```abap
DATA i TYPE i.
i = CONV f( '-0.5' ).   " SAP: -1 — open-abap: 0
```

- Exact command used to run it: the runtime asked directly, `Integer.set(Float -0.5)` gives 0; +0.5, 1.5, 2.5 are right. `Math.round(-0.5)` is `-0` in JavaScript, which rounds a half towards positive infinity, and ABAP rounds a half away from zero. **Measured on A4H, 2026-09-17** (ABAP Unit, `lv_f = '-0.5'. rv_i = lv_f.`): −1.
- Expected SAP behaviour: −1
- Actual open-abap behaviour: 0
- Impact on open-steamgate: none seen; it is a half of a unit, exactly, on the negative side, which is rare and silent
- Smallest safe workaround: none needed
- Upstream issue: [abaplint/transpiler#1861](https://github.com/abaplint/transpiler/issues/1861), filed 2026-09-17; PR [#1864](https://github.com/abaplint/transpiler/pull/1864), 2026-09-17. Branch `fix/integer-round-half-away` (worktree `.local/pr-integer-round-half-away`, based on `origin/main`), one commit with the fix and the test (2026-09-17): `roundHalfAwayFromZero` on `Integer` (`-Math.round(-v)` for a negative, `-0` made `0`), used by `Integer.set` for numbers and floats, by `toInteger` for strings and by `Integer8.set` for floats; `Float.getRaw` already rounded this way. The runtime's tests and lint green.
- Regression-test location: `packages/runtime/test/arithmetics.ts`, "a negative half moved to an integer rounds away from zero" (failed on 2.13.87 with `expected -0 to equal -1`, passes with the fix), upstream since #1864
- Upstream version containing a fix: `2.13.88`

### ANOMALY-2026-09-16-float-vs-character-compare — A float compared with a character literal is compared with an integer

- Status: `fixed upstream: abaplint/transpiler#1862, released in 2.13.88`
- Discovery date: `2026-09-16`
- Affected versions: `@abaplint/runtime 2.13.86` and 2.13.87 (`compare/gt.ts`)
- Affected ABAP statement, runtime API or adapter: every comparison of a numeric operand with a character or string one — `IF f > '0.5'`, `f < '0.3'` — through `compare.gt` and, written in terms of it, `lt`, `ge`, `le`. `eq` is not affected: it already reads a point.
- Minimal ABAP reproducer:

```abap
DATA prog TYPE f.
prog = '0.06'.
IF prog > '0.5'.
  WRITE 'label'.   " open-abap writes it; SAP does not
ENDIF.
```

- Exact command used to run it: `tools/o4d-record.mjs --compare` of the ZO4D demo recorded on A4H and here — 59 frames of 60 differ, every one by a quarter label the demo draws here from the second frame on and a system never does. Then the runtime asked directly: `abap.compare.gt(Float 0.06, Character '0.5')` is `true`, `lt` is `false`, `gt(Float 0.06, Float 0.5)` is `false`.
- Expected SAP behaviour: the character operand is converted to the type of the numeric operand it is compared with — `f` here, so `'0.5'` is 0.5 and the label waits until the bar is half grown.
- Actual open-abap behaviour: in the generic tail of `compare/gt.ts` a numeric left against a string right (and the mirror) ended in `parseInt(…, 10)`, so `'0.5'` was 0 and every fraction compared as its integer part. The runtime's own `operators/_parse.ts` has the right rule (`parseFloat` when the string holds a point) and was not called.
- Impact on open-steamgate: the demo's `Sales Dance` scene labels its bars on the second frame instead of halfway through the intro, and the frame stream is not the system's from frame 1 (`ANOMALY-2026-09-16-*` is the first anomaly found by the frame comparison rather than by a crash). Any ABAP that compares a float with a literal carrying a fraction is affected; business code, which compares with integer literals, happens not to be.
- Smallest safe workaround: write the literal as a float, `CONV f( '0.5' )`, which compares float with float. Not applied to the demo: the ABAP is right as written.
- Upstream issue: [abaplint/transpiler#1859](https://github.com/abaplint/transpiler/issues/1859), filed 2026-09-17 with the frame count before and after; PR [#1862](https://github.com/abaplint/transpiler/pull/1862) from the branch inside the repository, 2026-09-17. Branch `fix/compare-character-literal` in `abaplint/transpiler` (worktree `.local/pr-compare-char`, based on `origin/main` 7daf28f2): `parse()` in place of `parseInt` in both branches of `gt`'s tail, one commit, the runtime's tests and lint green.
- Regression-test location: `packages/runtime/test/compare.ts`, "float against a character literal with a fraction", upstream since #1862
- **Verified, 2026-09-16.** With the fix cherry-picked onto `local/osd-build` and the runtime rebuilt, the same sixty frames against A4H differ in 3 instead of 59, and none of them by a label; what remains is the field `p` on frames 33 to 35, which is a different question and is being looked at.
- Upstream version containing a fix: `2.13.88`

### ANOMALY-2026-09-15-srvd-not-allowed — The transpiler refuses SRVD objects

- Status: `open`
- Discovery date: `2026-09-15`
- Affected versions: `@abaplint/transpiler-cli` as pinned in package.json (see `npm ls @abaplint/transpiler-cli`)
- Affected ABAP statement, runtime API or adapter: object type `SRVD` (service definition) in the transpile input
- Minimal ABAP reproducer: any `<name>.srvd.srvdsrv` + `<name>.srvd.xml` under `src/`
- Exact command used to run it: `npm run transpile`
- Expected SAP behaviour: a service definition is an ordinary repository object; abaplint knows the type
- Actual open-abap behaviour: `Error: allowed_object_types, Object type SRVD not allowed` — `SRVD` is absent from the transpiler's `defaultAllowedObjectTypes`
- Impact on open-steamgate: the `$ZTEST` demo package cannot hold a service definition; the ADT façade lists the type (`osd-store.mjs` TYPES) but no object can exist behind it
- Smallest safe workaround: `none` — the object files were removed from `src/ztest/`
- Upstream issue: needs an issue in `abaplint/transpiler` (not yet filed)
- Regression-test location: none yet
- Upstream version containing a fix: `unknown`


### ANOMALY-2026-09-11-no-implicit-mandt — Client-dependent tables are read across all clients

- Status: `open`
- Discovery date: `2026-09-11`
- Affected versions: `@abaplint/transpiler-cli 2.13.85`, `@abaplint/runtime 2.13.85`, `@abaplint/database-sqlite 2.13.83`
- Affected ABAP statement, runtime API or adapter: `SELECT` on a table with `CLIDEP = X`; `sy-mandt` is the constant `123` (`runtime/src/builtin/sy.ts`)
- Minimal ABAP reproducer: `src/demo/zcl_zstg_demo_dpc_ext.clas.abap` `travelset_get_entityset` against `data/zstg_demo.tabu.json` (3 rows in client 123, 1 in client 001)
- Exact command used to run it: `npm run unit`
- Expected SAP behaviour: 3 rows; the database interface adds `MANDT = sy-mandt` to every Open SQL statement on a client-dependent table unless `CLIENT SPECIFIED`
- Actual open-abap behaviour: 4 rows; no client predicate is generated, `INSERT`/`UPDATE`/`DELETE` likewise touch every client
- Impact on open-steamgate: every real business table is client-dependent; a seeded multi-client capture leaks rows across clients, and any DPC that branches on `sy-mandt` sees `123`
- Smallest safe workaround: seed captures with a single client and set every row's `mandt` to `123`; do not rely on client isolation in tests
- Upstream issue: **[abaplint/transpiler#606](https://github.com/abaplint/transpiler/issues/606)**, open since 2022 and phrased as a question. larshp's own answer on it is "or ignore it? as the client feature is not needed in the transpiler/runtime, just spin up multiple" — which is what our workaround already does, so this is a settled design decision rather than a missing fix. Measured and added to the issue on 2026-09-14: a `CLNT`-keyed table with rows under 123, 456 and 789 returns 3 rows here and 1 on a system. Documented rather than implemented, in [abaplint/transpiler#1850](https://github.com/abaplint/transpiler/pull/1850), because the README's `SY-MANDT = 123` line reads as though the client is handled and merely constant
- Regression-test location: `test/unit/zcl_stg_phase0_test.clas.testclasses.abap` `entityset_reads_sqlite` pins the current 4-row result and will fail when the runtime starts filtering
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-11-oao-handler-hardcodes-test-dpc — open-abap-odata cannot be consumed as a library

- Status: `fixed upstream, workaround removed`
- Discovery date: `2026-09-11`
- Affected versions: `open-abap/open-abap-odata` main at `7b20ba2` (2026-08-27)
- Affected ABAP statement, runtime API or adapter: `zcl_oao_http_handler=>data` declares `lo_dpc TYPE REF TO zcl_zsegw_dpc_ext`, a class that only exists in that repo's `test/` folder
- Minimal ABAP reproducer: add the repo as a lib in `abap_transpile.json` without `exclude_filter`
- Exact command used to run it: `npm run transpile`
- Expected SAP behaviour: n/a (library packaging)
- Actual open-abap behaviour: `Error: CreateObjectTranspiler, target variable "lo_dpc" not a object reference`
- Impact on open-steamgate: blocks using the interface transcription as a lib
- Smallest safe workaround: `"exclude_filter": ["zcl_oao_http_handler"]` on the lib entry. **Removed 2026-09-14**: the filter is no longer in `abap_transpile.json` and the build is green without it, so the record saying "(applied)" had outlived the thing it described
- Upstream issue: https://github.com/open-abap/open-abap-odata/issues/33 (open, same crash); QW1 in `AGENDA.md` is the fix, sent upstream as https://github.com/open-abap/open-abap-odata/pull/40 (merged 2026-09-12)
- Regression-test location: `npm run transpile` itself
- Upstream version containing a fix: open-abap-odata main from 5467424 (2026-09-12); open-steamgate consumes upstream directly since #48

### ANOMALY-2026-09-11-doubled-quote-literal — A literal holding two quotes is transpiled as one character

- Status: `fixed` in `@abaplint/transpiler` 2.13.86 (2026-09-12); workaround removed the same day
- Discovery date: `2026-09-11`
- Affected versions: `@abaplint/transpiler-cli 2.13.85`
- Affected ABAP statement, runtime API or adapter: any character literal whose content is escaped quotes, e.g. `''''''` (two quotes) used in `REPLACE ALL OCCURRENCES OF '''''' IN lv WITH ''''`
- Minimal ABAP reproducer (inline):

  ```abap
  rv_result = `x''y`.
  REPLACE ALL OCCURRENCES OF '''''' IN rv_result WITH ''''.
  " SAP: x'y   open-abap: x''y
  ```

- Exact command used to run it: `abap_transpile` + `node output/index.mjs` on a class with the two lines above in a FOR TESTING method
- Expected SAP behaviour: `''''''` is a `c LENGTH 2` literal containing `''`; the replace yields `x'y`
- Actual open-abap behaviour: the literal is emitted as `abap.CharacterFactory.get(1, '\'\'')`, a `c LENGTH 1`, so the pattern degenerates to a single quote and the statement is a no-op. Length is computed before the escape sequence is folded.
- Impact on open-steamgate: OData key predicates and `$filter` literals escape quotes by doubling; un-doubling silently failed
- Smallest safe workaround: build the two-quote string at runtime, `lv_two = |''|`, and use the variable in `REPLACE` (was applied in `zcl_stg_url`, `zcl_stg_json`, `zcl_stg_request_context`, `zcl_stg_sadl_dpc`; the literal is back since 2.13.86)
- Upstream issue: https://github.com/abaplint/transpiler/pull/1829 (fix + test, open 2026-09-12)
- Regression-test location: `test/unit/zcl_stg_gateway_test.clas.testclasses.abap` `ltcl_url->keys_named`
- Upstream version containing a fix: 2.13.86

### ANOMALY-2026-09-12-fae-dedupe-by-db-key — FOR ALL ENTRIES de-duplicates by the DB key on the target table

- Status: `fixed` in `@abaplint/transpiler` 2.13.86 (2026-09-12); workaround removed the same day
- Discovery date: `2026-09-12`
- Affected versions: `@abaplint/transpiler-cli 2.13.85`, `@abaplint/runtime 2.13.85`
- Affected ABAP statement, runtime API or adapter: `SELECT <fields> FROM tab INTO CORRESPONDING FIELDS OF TABLE lt FOR ALL ENTRIES IN ...` where the target line type lacks a key field of `tab` (typically MANDT)
- Minimal ABAP reproducer: `src/demo/zcl_zstg_demo_dpc_ext.clas.abap` `get_expanded_entityset` before this entry's workaround
- Exact command used to run it: `npm run unit`
- Expected SAP behaviour: the union of the per-entry selects with duplicates removed, target fields filled by name
- Actual open-abap behaviour: the generated code runs `SORT lt BY mandt travel_id booking_id` + `DELETE ADJACENT DUPLICATES` with the DB key's component names on the *target* table: `Error: sort compare, wrong component name, mandt`
- Impact on open-steamgate: any DPC that FAE-selects into a projection structure crashes the request; very common in hand-written DPCs
- Smallest safe workaround: select into a table typed like the DB table (`TYPE STANDARD TABLE OF tab`) and MOVE-CORRESPONDING afterwards (was applied in the demo; `INTO CORRESPONDING FIELDS` is back since 2.13.86)
- Upstream issue: https://github.com/abaplint/transpiler/pull/1830 (fix + test, open 2026-09-12)
- Regression-test location: `test/unit/zcl_stg_gateway_test.clas.testclasses.abap` `ltcl_navigation->expand_by_the_dpc`
- Upstream version containing a fix: 2.13.86

### ANOMALY-2026-09-12-fae-empty-driver — FOR ALL ENTRIES with an empty driving table throws

- Status: `fixed` in `@abaplint/transpiler` 2.13.86 (2026-09-12); workaround removed the same day
- Discovery date: `2026-09-12`
- Affected versions: `@abaplint/transpiler-cli 2.13.85`
- Affected ABAP statement, runtime API or adapter: `SELECT ... FOR ALL ENTRIES IN lt` with `lt` empty
- Minimal ABAP reproducer: the same SELECT as above with an empty `lt_travel` (guarded by `IF lt_travel IS NOT INITIAL` in the demo)
- Exact command used to run it: `npm run unit` without the guard
- Expected SAP behaviour: the WHERE condition with the FAE table is dropped, all rows are selected (the classic FAE trap)
- Actual open-abap behaviour: `throw new Error("FAE, todo, empty table")` in the generated code
- Impact on open-steamgate: a DPC that relies on the SAP behaviour (or forgets the guard) crashes instead of over-selecting
- Smallest safe workaround: guard every FAE with `IF lt IS NOT INITIAL`, as good ABAP does anyway (kept: since 2.13.86 an unguarded empty driver selects everything, like on SAP)
- Upstream issue: https://github.com/abaplint/transpiler/pull/1832 (SAP semantics: empty driver ignores the WHERE; Lars may prefer an option, offered in the PR)
- Regression-test location: none
- Upstream version containing a fix: 2.13.86

### ANOMALY-2026-09-12-create-data-ddic-view — CREATE DATA with a DDIC view type is unknown at runtime

- Status: `fixed` in `@abaplint/transpiler` 2.13.86 (2026-09-12); workaround removed the same day
- Discovery date: `2026-09-12`
- Affected versions: `@abaplint/transpiler-cli 2.13.85`, `@abaplint/runtime 2.13.85`
- Affected ABAP statement, runtime API or adapter: `CREATE DATA rr TYPE STANDARD TABLE OF <ddic view>` (VIEW object)
- Minimal ABAP reproducer: `tools/cds2ddic.mjs` generated source classes before this entry's workaround
- Exact command used to run it: `npm run unit`
- Expected SAP behaviour: a table of the view's line type
- Actual open-abap behaviour: `Error: CREATE DATA, unknown type ZVSTGTRAVEL` (the transpiler resolves the view statically for SELECT, but the runtime DDIC lookup has no entry for views)
- Impact on open-steamgate: generic code that creates data by a view name fails
- Smallest safe workaround: declare `TYPES ty_line TYPE <view>` in the class and `CREATE DATA ... TYPE ty_line` / a local table type (was applied in the generator; `CREATE DATA ... TYPE STANDARD TABLE OF <view>` is back since 2.13.86)
- Upstream issue: https://github.com/abaplint/transpiler/pull/1831 (two fixes: views were never imported by the init script, and the runtime ignored the TABLE flag for static DDIC names, so plain `CREATE DATA ... TYPE STANDARD TABLE OF t100` was broken too)
- Regression-test location: `test/unit/zcl_stg_gateway_test.clas.testclasses.abap` `ltcl_sadl->entity_set_with_filter`
- Upstream version containing a fix: 2.13.86

### ANOMALY-2026-09-13-conv-second-in-expression — The second constructor expression in one expression has no type

- Status: `fixed upstream: abaplint/transpiler#1842`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/transpiler 2.13.86`, `@abaplint/core 2.120.5`
- Affected ABAP statement, runtime API or adapter: `CONV` (and any constructor expression resolved through an inferred type) when more than one appears in one expression
- Minimal ABAP reproducer: `foo = CONV f( 1 ) + CONV f( 2 ).`
- Exact command used to run it: `npx abap_transpile` over oisee/vivid-vibes; isolated with the transpiler's own `runSingle`
- Expected SAP behaviour: both are floats; ABAP has no opinion about how many of them fit in a statement
- Actual open-abap behaviour: the transpile ends with `TypeNameOrInfer, type not found: f`. The syntax check records an InferredType reference for the first name and none for the rest, and the transpiler had nothing else to fall back on
- Impact on open-steamgate: none of ours; 786 uses of `CONV f(` across 69 files of vivid-vibes, 136 of them with two in one expression, so the demo payload did not transpile at all
- Smallest safe workaround: split the expression into two statements
- Upstream issue: **PR [abaplint/transpiler#1842](https://github.com/abaplint/transpiler/pull/1842)**, opened 2026-09-14 from branch `fix/conv-builtin-type-name` inside the repo, so Regression runs. A built-in type name that names exactly one type (`i`, `f`, `string`, `xstring`, `d`, `t`, `int8`, `utclong`, `decfloat16/34`) is enough on its own when no reference was recorded
- Regression-test location: the transpiler's `test/single_statements.ts`, upstream since #1842 (`foo = CONV f( 1 ) + CONV f( 2 ).`, not skipped)
- Upstream version containing a fix: `2.13.88`
- **What actually landed, checked 2026-09-18.** #1842 was merged as three lines of test and no fix: the defect was closed by `@abaplint/core` recording an inferred type for every constructor expression rather than the first (abaplint#4290). So the `BUILT_IN` table this side carried in `expressions/type_name_or_infer.ts` is *not* upstream, and on 2.13.88 it is not needed either — the reproducer transpiles without it. The table was dropped with the link

### ANOMALY-2026-09-13-paren-before-conv — A parenthesised group before `* CONV ... /` generates unbalanced JavaScript

- Status: `fixed upstream: abaplint/transpiler#1843`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/transpiler 2.13.86`
- Affected ABAP statement, runtime API or adapter: arithmetic where a constructor expression sits between two operators
- Minimal ABAP reproducer: `foo = ( 1 - 2 ) * CONV f( 3 ) / 256.`
- Exact command used to run it: `npx abap_transpile`; the generated module then fails to parse with `Private field '#x' must be declared in an enclosing class`, which is V8 recovering from unbalanced parentheses somewhere above
- Expected SAP behaviour: `(( 1 - 2 ) * conv) / 256`, left to right
- Actual open-abap behaviour: the emitted JavaScript drops `( 1 - 2 ) *` and closes one bracket too many. The rearranger flattens a nested arithmetic Source into its parent so precedence can be decided across the whole chain, and a constructor expression is five children rather than one, so its type name and body landed beside the operators and were read as operands
- Impact on open-steamgate: none of ours; 15 of 85 effect classes in vivid-vibes emitted modules that could not be imported, and one broken module breaks the whole runtime because `init.mjs` imports every class
- Smallest safe workaround: assign the constructor expression to a variable first
- Upstream issue: none yet, branch `fix/rearranger-constructor-operand`, next in the queue. The head of the flattened chain is wrapped back into one Source before it is hoisted
- Regression-test location: the transpiler's `test/single_statements.ts`, local branch
- Upstream version containing a fix: `2.13.87`

### ANOMALY-2026-09-13-builtin-as-method — A built-in function in such an expression is emitted as a method of the class

- Status: `gone upstream on 2.13.88, not by our fix`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/transpiler 2.13.86`
- Affected ABAP statement, runtime API or adapter: any built-in function call (`cos`, `sin`, `nmax`, `lines`, `frac`) inside an expression carrying more than one constructor expression
- Minimal ABAP reproducer: in a class, `lv = CONV f( 1 ) + CONV f( 2 ) * nmax( val1 = 0 val2 = lv_ax * cos( lv_ax ) ).`
- Exact command used to run it: `npx abap_transpile`, then calling the method: `TypeError: this.cos is not a function`
- Expected SAP behaviour: `cos` is a built-in unless the class defines a method of that name, in which case the method wins
- Actual open-abap behaviour: emitted as `await this.cos( )`. The decision rests on a BuiltinMethodReference the syntax check records, and in this shape it records none, so the call fell through to the `this.` case. Same root as the two above: one reference per expression
- Impact on open-steamgate: none of ours; it is why several vivid-vibes effects failed at runtime rather than at build time, which is the worse of the two
- Smallest safe workaround: split the expression
- Upstream issue: none yet, PR deferred. Fixed in the same local branch: an unrecorded name is taken as a built-in only when it is the first call in its chain, `abaplint.BuiltIn.searchBuiltin` knows it, and the enclosing class has no method of that name. The chain condition matters, `mi_merge->get_result( )-stage->count( )` is a method called COUNT
- Regression-test location: the transpiler's `test/files.ts` on `fix/builtin-not-a-method`, both directions, still local
- Upstream version containing a fix: `2.13.88`, indirectly
- **Checked 2026-09-18, on published 2.13.88 with the link dropped.** The defect does not reproduce any more, and the reason is the same one as for `ANOMALY-2026-09-13-conv-second-in-expression`: the syntax check now records a reference for every call in the expression, so nothing falls through to the `this.` case. Measured over the whole build, 1499 objects: no `await this.(cos|sin|nmax|sqrt|frac|abs|lines)(` anywhere in `output/`. The branch `fix/builtin-not-a-method` is kept, because it also guards the case where a class *does* define a method of a built-in's name, which has no upstream test

### ANOMALY-2026-09-14-class-constructor-eager — A class constructor runs before the program, not at first use

- Status: `reported: abaplint/transpiler#1849`
- Discovery date: `2026-09-14`
- Affected versions: `@abaplint/transpiler 2.13.86`
- Affected ABAP statement, runtime API or adapter: `CLASS-METHODS class_constructor`
- Minimal ABAP reproducer:

```abap
CLASS lcl DEFINITION.
  PUBLIC SECTION.
    CLASS-METHODS class_constructor.
    CLASS-METHODS touch.
ENDCLASS.
CLASS lcl IMPLEMENTATION.
  METHOD class_constructor.
    WRITE / 'ctor'.
  ENDMETHOD.
  METHOD touch.
    WRITE / 'touch'.
  ENDMETHOD.
ENDCLASS.

START-OF-SELECTION.
WRITE / 'before'.
lcl=>touch( ).
WRITE / 'after'.
```

- Exact command used to run it: transpile and run; measured 2026-09-14
- Expected SAP behaviour: `before / ctor / touch / after`. The class constructor runs once, at the first access to the class, which here is inside the program's executable part. **Verified on A4H 2026-09-24** (ultra/events, `$ZOSG_TMP_0440`): `tools/gogen/testdata/zcl_gogen_t_cctor.clas.abap` with `_CC1`, `_CC2` (a subclass), `_CC3` and `_CCLOG` answered `a cc3 t3 t3 b cc1 cc2 t1 c ` — at the first static call, at the first CREATE OBJECT of a subclass (the superclass's first), once; the transpiler 2.13.89 answers `cc3 cc1 cc2 a t3 t3 b t1 c `. An exception out of a class constructor (`zcl_gogen_t_ccboom2.clas.abap`, `$ZOSG_TMP_0441`) is a runtime abortion on A4H that no CATCH takes, `CX_SY_ZERODIVIDE`, `CX_SY_NO_HANDLER` or `CX_ROOT`; the transpiler raises it while the modules load, before any statement of the program, so nothing can catch it either, but the program never starts
- Actual open-abap behaviour: `ctor / before / touch / after`. The constructor runs eagerly, before the program's own statements, which is what an ES module initialising at import time does
- Impact on open-steamgate: subtle and real, because a class constructor can touch `sy-tabix`. A registry filled with `APPEND` in a class constructor leaves `sy-tabix` at the last appended index; run lazily inside a loop body that reads `sy-tabix` afterwards, the first iteration sees that index rather than its own row number. Measured: `12` here where a system would give `32` for the same program. Found by larshp reviewing `abaplint/transpiler#1848`, who asked whether a test should expect `,a,b,c` — it depends entirely on this
- Smallest safe workaround: do not read `sy-tabix` after a call that may be a class's first access; or touch the class once before the loop, which is what that test now does
- Upstream issue: **[abaplint/transpiler#1849](https://github.com/abaplint/transpiler/issues/1849)**. Confirmed as a bug by larshp on #1848 the same day — "yea, its a bug, dont use class constructors" — so the expected column above is no longer only our reading. Filed as an issue rather than a pull request because deferring initialisation to first access changes how the transpiler emits and imports modules, which is his design call. His advice, avoid class constructors, is a good workaround and not one a repository being transpiled knows to have followed
- Regression-test location: none; the pull request that found it now avoids the dependency rather than pinning it
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-14-builtin-positional-argument — An unrecorded built-in is called positionally

- Status: `gone upstream on 2.13.88, not by our fix`
- Discovery date: `2026-09-14`
- Affected versions: `@abaplint/transpiler 2.13.86`, including the local build that already carried the earlier half of this fix
- Affected ABAP statement, runtime API or adapter: any built-in function taking a single argument — `sin`, `cos`, `sqrt`, `exp` — called from inside an expression that carries more than one constructor expression
- Minimal ABAP reproducer:

```abap
DATA lv_t TYPE f.
DATA lv_speed TYPE f.
DATA(a) = CONV f( '0.5' ) + sin( lv_t * lv_speed ) * CONV f( '0.3' ).
"        -> abap.builtin.sin(abap.operators.multiply(...))   wrong
DATA(b) = sin( lv_t * 3 + lv_t * 4 ) * 10.
"        -> abap.builtin.sin({val: abap.operators.add(...)}) right
```

- Exact command used to run it: `npx mocha build/test/builtin/cos.js`; found by open-steamgate driving her preload sequence, which died at frame 1281 in `zcl_o4d_twistzoomer`
- Expected SAP behaviour: n/a, this is an emitter defect rather than a semantic one. The runtime signature is `sin(input: {val})`
- Actual open-abap behaviour: the argument is emitted positionally, so `input.val` is undefined and the first line that touches it throws `Cannot read properties of undefined (reading 'get')`. Nineteen calls across eight of her classes, with correct calls in the same files three lines away
- Impact on open-steamgate: the whole timeline. Twistzoomer was simply the first of the eight her sequence reached; the other seven were queued behind it. Deterministic, not a race — they chased concurrency first and it was a blind alley
- Smallest safe workaround: `sin( val = x )` written out, or lift the argument into its own variable first
- Upstream issue: none yet, branch `fix/builtin-not-a-method`, which carries both halves — the name and the argument shape — since they are the same defect one layer apart. It sits on `fix/conv-builtin-type-name` (PR #1842) because a built-in only goes unrecorded in an expression that also loses a constructor expression's type, so the test cannot be written without it; four other shapes were tried. **This is the tail of a defect this session fixed earlier and did not fix far enough.** `isBuiltinMethod` was taught to recognise built-ins the syntax check had not recorded, so the *name* came out right; `findMethodReference` still returns nothing for them, and the parameter transpiler falls back to a positional argument when it has no definition. Right function, wrong shape. A built-in now brings its own definition via `BuiltIn.searchBuiltin`
- Regression-test location: `test/builtin/cos.ts` on the branch — runs the expression, and separately asserts that no `builtin.sin(` or `builtin.cos(` is followed by anything but a brace, so a regression fails on the shape rather than on a value that happens to be zero
- **Checked 2026-09-18, on published 2.13.88.** `zcl_o4d_twistzoomer` line 59, the class this was found in, is the reproducer verbatim (`CONV f( '0.5' ) + sin( lv_t * mv_zoom_speed ) * CONV f( '0.3' )`) and now emits `abap.builtin.sin({val: …})`. Over the whole build there is no `abap.builtin.<fn>(` followed by anything but `{`
- Upstream version containing a fix: `2.13.88`, indirectly

### DEBT-2026-09-14-no-push-to-abaplint — We can push a branch to the transpiler and not to abaplint

- Status: `open`
- Discovery date: `2026-09-14`
- Affected versions: n/a, a process fact
- Affected ABAP statement, runtime API or adapter: none
- Minimal ABAP reproducer: none
- Exact command used to run it: `gh api repos/abaplint/abaplint --jq .permissions` against `gh api repos/abaplint/transpiler --jq .permissions`
- Expected SAP behaviour: n/a
- Actual behaviour: `abaplint/transpiler` gives us `push: true`, `abaplint/abaplint` gives `push: false`. So Lars's advice — make the PR from a branch inside the repo, or the regression and performance workflows never run — **can be followed for the transpiler and cannot be followed for abaplint**. Their `regression.yml` skips forks by an explicit condition, `github.repository == 'abaplint/abaplint'`, with a comment in the file saying as much, and `coverage.yml` is push-only too. A fork PR there runs `main.yml` and `playground.yml` and nothing else
- Impact on open-steamgate: our first core fix, `fix/arithmetic-calculation-type`, cannot arrive with the evidence a transpiler PR arrives with. The mitigation is to run `.github/regression/run.js` locally, which is what the workflow does — build the CLI before and after and compare across real repositories — and put the result in the PR body. Roughly a thirty-minute job and it needs the network
- Smallest safe workaround: the fork `oisee/abaplint` exists as of 2026-09-14 and #4291 came from it. Asking Lars for push access would be better, since it is the only way the regression evidence can arrive with the pull request rather than pasted into it
- Upstream issue: none; nothing to file, this is about our access
- Regression-test location: `npm run parked` prints the constraint against each repository, so nobody has to remember which of the two rules applies
- Upstream version containing a fix: `n/a`

### ANOMALY-2026-09-14-arithmetic-typed-as-character — Arithmetic with a character literal is typed by the literal

- Status: `fixed upstream: abaplint/abaplint#4293, merged 2026-09-14, first released in @abaplint/core 2.120.53; this tree already has it`
- Discovery date: `2026-09-14`
- Affected versions: `@abaplint/core 2.120.50`
- Affected ABAP statement, runtime API or adapter: the inferred type of `DATA(x) = <arithmetic expression>`
- Minimal ABAP reproducer:

```abap
DATA lv_f TYPE f.
DATA(a) = lv_f * '0.25'.   " typed Character(4), should be f
DATA(b) = lv_f + '0.25'.   " typed Character(4), should be f
DATA(c) = lv_f * 2.        " typed f, correct
```

- Exact command used to run it: transpile and read the `let` line in the output; found by open-steamgate driving vivid-vibes, stack `Float.set` ← `Table.cloneRow` ← `APPEND` ← `zcl_o4d_sales_dance=>get_dancing_values`
- Expected SAP behaviour: the result of an arithmetic expression is never character-like. With an operand of type `f` the calculation type is `f`; a character operand is converted into it, it does not become the result type
- Actual open-abap behaviour: the inline declaration takes the character literal's type **and its length**, so `sin( x ) * '0.25'` yields `c(4)` and `lv_pulse * '0.3'` yields `c(3)`. An integer literal does not do this
- Impact on open-steamgate: two ways, and the quiet one is worse. Loud: appending such a variable to a table of `f` raised `CX_SY_CONVERSION_NO_NUMBER` and killed her channel at bar 6. Quiet: the value is truncated to the literal's length, so her dance bars were computed from `9,4` instead of `9.4983552631578956` — right shape, two significant digits, no complaint from anything
- Smallest safe workaround: `CONV f( '0.25' )` in the expression, or declare the variable rather than inferring it
- Upstream issue: **PR [abaplint/abaplint#4293](https://github.com/abaplint/abaplint/pull/4293)**, opened 2026-09-14 from the fork `oisee/abaplint`, rebased on #4290. This is `@abaplint/core`, not the transpiler: the transpiler asks the scope for the variable's type and faithfully emits the answer it gets. Reproduced independently by open-steamgate on 2026-09-14 with a fourth line that narrows it: `DATA(d) = lv_f * CONV f( '0.25' ).` gives `f`, so it is the bare character literal, not the mixed arithmetic. Two cases wider than the report, both found while fixing: `lv_f * lv_c` with a character **variable** gave `Character(10)`, and `lv_p * '0.25'` gave a character field rather than packed
- What the fix does: `Source.runSyntax` walked the operands and let each one replace the running context, so the last operand won. It now records that an `ArithOperator` has been seen and from that point combines rather than replaces, using ABAP's calculation type — decfloat34, decfloat16, f, p, int8, i — with character-like operands transparent. Outside arithmetic nothing changes, and the concatenation path still returns `StringType`. Conservative in two places: when neither operand is numeric the previous behaviour stands, and a void or unknown operand wins, because not knowing an operand means not knowing the result
- Verification: abaplint core's own suite, 10977 passing and none failing before, 10984 and none failing after, lint clean. Seven new tests in `basic_variables`, five of which fail without the change; the other two are the cases that were already right and could plausibly have broken
- Regression-test location: none here; belongs upstream
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-14-float-separator-not-inverse — A float could not read back what it had just written

- Status: `fixed upstream: abaplint/transpiler#1847`
- Discovery date: `2026-09-14`
- Affected versions: `@abaplint/runtime 2.13.86`
- Affected ABAP statement, runtime API or adapter: `Float.get`/`Float.set`, `DecFloat34.get`/`DecFloat34.set`, so any move of a float through a character field
- Minimal ABAP reproducer:

```abap
DATA float TYPE f.
DATA ch TYPE c LENGTH 30.
DATA back TYPE f.
float = '9.79440789'.
ch = float.      " 9,7944078900000004E+00
back = ch.       " CX_SY_CONVERSION_NO_NUMBER
```

- Exact command used to run it: `npx mocha build/test/types/float.js`; found by open-steamgate from a trace line that showed the comma one field before the exception
- Expected SAP behaviour: the pair round-trips. SAP localises the decimal separator on the way out and accepts it on the way back
- Actual open-abap behaviour: `get()` wrote a comma and `set()` accepted only a point. `DecFloat34` was worse and silent: `parseFloat` stops at the comma, so reading back `9,79440789` gave `9` with no error
- Impact on open-steamgate: this is what turned the type defect above into a dead channel rather than a wrong number. Her page reported it as "Disconnected", because a client cannot tell a handler that raised from a network that dropped
- Smallest safe workaround: none needed now
- Upstream issue: none yet, branch `fix/float-separator` in `abaplint/transpiler`. `set()` accepts both separators — the comma because that is what `get()` writes, the point because ABAP source literals carry one and `CONV f( '0.25' )` is everywhere. `get()` is unchanged: `test/statements/write.ts:209` asserts the comma at ABAP level, so the output side was verified against a system
- Regression-test location: `test/types/float.ts` (round trip, point still a point, `'1,2,3'` still raises) and `test/types/decfloat34.ts`
- Upstream version containing a fix: `2.13.87`

### ANOMALY-2026-09-14-source-position-without-raise — `get_source_position( )` crashes on an exception the runtime raised

- Status: `fixed upstream: open-abap/open-abap-core#1219`
- Discovery date: `2026-09-14`
- Affected versions: `open-abap-core` before #1219
- Affected ABAP statement, runtime API or adapter: `cx_root~get_source_position`, so every exception the runtime raises itself — `CX_SY_CONVERSION_NO_NUMBER`, `CX_SY_ZERODIVIDE` and the rest
- Minimal ABAP reproducer:

```abap
TRY.
    DATA(lv_f) = CONV f( 'not a number' ).
  CATCH cx_root INTO DATA(lx).
    lx->get_source_position( IMPORTING source_line = DATA(lv_line) ).
ENDTRY.
```

- Exact command used to run it: `npm run unit` in open-abap-core with that test class
- Expected SAP behaviour: a position, or at worst the fallback the method already writes
- Actual open-abap behaviour: `Cannot read properties of undefined (reading 'INTERNAL_LINE')`. `EXTRA_CX` is attached by the transpiled `RAISE` statement (`raise.ts:104`); an exception the runtime raises never goes through `RAISE`, so it has none, and `this.EXTRA_CX.INTERNAL_LINE || 1` throws on the property access before the fallback can be reached
- Impact on open-steamgate: this is the one that actually cost the three blind runs, not the missing text. Their channel logged an empty reason, and the natural next step — asking the exception where it came from — would have replaced a silent failure with a louder unrelated one
- **Correction, 2026-09-14.** This entry previously said the exception had *no text*, and that `throwError` not calling `constructor_` was why. Both were wrong, and measured to be wrong the next morning: `get_text( )` returns "Conversion no number" on a runtime-raised exception, constructed or not, because `cx_root~constructor` only sets `previous` and `textid` and `get_text` goes through `cl_message_helper`, which needs neither. The real empty-reason bug was open-steamgate's `String(error?.message ?? error)`, where `??` does not fire on `""` — see [[ANOMALY-2026-09-14-exception-with-no-message]] in their half. Two wrong causes for one symptom, and the entry named neither
- Smallest safe workaround: none needed now
- Upstream issue: **[open-abap/open-abap-core#1219](https://github.com/open-abap/open-abap-core/pull/1219)**, merged and approved 2026-09-14. Two question marks; the fallbacks were already written and unreachable
- Regression-test location: `src/exceptions/cx_root.clas.testclasses.abap`, raising through `CONV` rather than `RAISE` so it goes down the path that had no cover
- Upstream version containing a fix: the commit after #1219
- Related: the position it returns is still the fallback, because nothing attaches a real one. `tools/osd-where.mjs` answers the actual question from the source maps instead

### ANOMALY-2026-09-14-sy-tabix-hashed — `sy-tabix` is a row number in a loop over a hashed table

- Status: `fixed upstream: abaplint/transpiler#1848`
- Discovery date: `2026-09-14`
- Affected versions: `@abaplint/runtime 2.13.86`
- Affected ABAP statement, runtime API or adapter: `LOOP AT` over a hashed table, and `LOOP AT ... USING KEY` with a hash secondary key
- Minimal ABAP reproducer:

```abap
DATA lt TYPE HASHED TABLE OF ty WITH UNIQUE KEY id.
LOOP AT lt INTO DATA(ls).
  lv_out = lv_out && |{ sy-tabix }|.   " 123, a system writes 000
ENDLOOP.
```

- Exact command used to run it: `npx mocha build/test/statements/loop.js`
- Expected SAP behaviour: `000`. A hashed table has no row order, so ABAP reports no position rather than inventing one
- Actual open-abap behaviour: `123`. A position that looks usable and is not
- Impact on open-steamgate: compounded with [[ANOMALY-2026-09-13-sy-tabix-not-restored]] in her `send_megademo`. Her `gt_registry` is `HASHED TABLE OF REF TO zcl_o4d_demo`, so an inner loop over it both invented an index and kept it. Restoring already made her caller correct; this makes the value itself correct for anyone who reads it
- Smallest safe workaround: do not read `sy-tabix` in a loop over a hashed table, which is also the rule on a system
- Upstream issue: none yet, branch `fix/sy-tabix-restore` in `abaplint/transpiler`, alongside the restore fix, since the two are siblings and one test file covers both
- Regression-test location: `test/statements/loop.ts`, two cases: hashed gives `000`, sorted still gives `12`
- Upstream version containing a fix: `2.13.88`

### ANOMALY-2026-09-13-sy-tabix-not-restored — An inner loop keeps the outer loop's `sy-tabix`

- Status: `fixed upstream: abaplint/transpiler#1848`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/runtime 2.13.86`
- Affected ABAP statement, runtime API or adapter: `LOOP AT` and `sy-tabix`
- Minimal ABAP reproducer:

```abap
LOOP AT lt_outer INTO DATA(lv_o).
  LOOP AT lt_inner INTO DATA(lv_i).
  ENDLOOP.
  lv_out = lv_out && |{ sy-tabix }|.
ENDLOOP.
```

- Exact command used to run it: `npx mocha build/test/statements/loop.js` in the transpiler checkout; found by open-steamgate driving vivid-vibes' `send_megademo`
- Expected SAP behaviour: `123`. A loop owns `sy-tabix` only while it runs; leaving it, by `ENDLOOP` or `EXIT` or `RETURN` or an exception, restores what the enclosing loop had
- Actual open-abap behaviour: `333`. The inner loop leaves its own last index behind, so the outer body reads the inner loop's row number as its own
- Impact on open-steamgate: her `send_megademo` calls `zcl_o4d_demo=>get( )` in the loop body, which walks its own table, and then writes a separator when `sy-tabix > 1`. The separators land wrong, and the frame is a JSON array that is well formed everywhere except one character. Nothing on our side reports anything; the browser says `Expected ',' or ']' after array element in JSON at position 236`. Same family as the day's other findings: output that is valid-looking, plausible, the right size, and wrong
- Smallest safe workaround: read `sy-tabix` into a variable as the first statement of the loop body, before anything that might loop
- Upstream issue: none yet, branch `fix/sy-tabix-restore` in `abaplint/transpiler`, commit `be5d4db9`. Save on entry, restore in the `finally` that already runs, so every exit path is covered by construction. Full suite 2224/133 before, 2227/130 after, and the three that moved are the new tests
- Regression-test location: `test/statements/loop.ts`, three cases: nested, inner loop left with `EXIT`, and a method that loops called from a loop
- Upstream version containing a fix: `2.13.88`

### DEBT-2026-09-13-runtime-not-linked — The transpiler is linked from our clone, the runtime is not

- Status: `not live, 2026-09-18` — both are published 2.13.89 and neither is a symlink, so the two cannot disagree today. The entry stays because the shape comes back with the next carried fix, and `transpiler:which` is the thing that would catch it
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/transpiler-cli` linked, `@abaplint/runtime 2.13.86` published
- Affected ABAP statement, runtime API or adapter: none; a build-topology note
- Minimal ABAP reproducer: none
- Exact command used to run it: `ls -la node_modules/@abaplint/`
- Expected SAP behaviour: n/a
- Actual open-abap behaviour: only `transpiler-cli` is a symlink into `~/dev/transpiler`; `@abaplint/runtime` in each consuming tree is the published copy. So a fix in `packages/transpiler` or `packages/cli` reaches a rebuild immediately and a fix in `packages/runtime` does not, and the two feel identical from the outside. The `sy-tabix` fix above is a runtime fix and is therefore *not* in any running demo
- Impact on open-steamgate: a fix can be reported as done and still be absent from the process that needed it. Whoever wants a runtime fix locally has to link `@abaplint/runtime` too, deliberately, and say so here
- Smallest safe workaround: `npm run runtime:local`, which symlinks the path directly. **Not `npm link`**: that resolves through the global npm directory, a third place with its own idea of which checkout is current. open-steamgate linked the runtime that way on 2026-09-13 and got commit `1889911` beside a CLI at `058df744` — two checkouts in one tree, both `package.json` files saying `2.13.86`, nothing on the surface able to tell them apart. `transpiler:which` printed the two commits side by side and that is how it was found
- Third thing, and the one with no tool behind it: a checkout can also be pointed at an **unreleased abaplint**, which `transpiler:which` does not report because it only looks at the transpiler and the runtime. Done once on 2026-09-14 to check whether `abaplint/abaplint#4290` made the test in `abaplint/transpiler#1842` pass before its release — it did, and it also showed the test would still have been red for an unrelated reason, which is why it was worth doing. The recipe, and the trap in it: replace the worktree's `node_modules` symlink with a real directory symlinking every package except `@abaplint/core`, point that at the abaplint clone, **and do the same for `packages/extras`**, which has a second copy of core; then check all four resolution points agree before believing anything. Reverted immediately afterwards
- Second thing a linked tree does that a clean clone does not: **it changes under you**. The transpiler checkout is shared, and on 2026-09-13 open-steamgate measured all four CLI/runtime combinations while this session had HEAD briefly on a branch off `main` for an unrelated PR. Three of the four rows were real; the fourth said the two fixes could not coexist, and was reading a moved HEAD. Whoever moves that HEAD says so first
- Upstream issue: none; this is ours. Related: `DEBT-2026-09-13-linked-transpiler`
- Regression-test location: `tools/osd-transpiler.mjs` now prints both, and `npm run transpiler:which` says in two lines which transpiler wrote the code and which runtime will execute it. That is the check; it does not make the two match, it makes the mismatch visible. `npm run runtime:local` links the runtime deliberately, the same way `transpiler:local` does
- Upstream version containing a fix: `n/a`

### ANOMALY-2026-09-13-xstring-as-hex — An xstring costs two characters per byte, twice over

- Status: `open`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/runtime 2.13.86`
- Affected ABAP statement, runtime API or adapter: `xstring` itself, and anything that moves a large one: `WWWDATA_IMPORT`, `SCMS_BINARY_TO_XSTRING`, a media response
- Minimal ABAP reproducer: read a four megabyte W3MI object and send it as a response
- Exact command used to run it: open-steamgate serving her 4 MB MP3 through the SMW0 chain, measured over twenty-four requests
- Expected SAP behaviour: an xstring is bytes and costs bytes
- Actual open-abap behaviour: the runtime carries an xstring as a hex string, two characters to the byte, and the SMW0 path holds it twice at once, once sliced into a table and once joined back. Serving 4 MB costs about 24 MB of transient strings per request; the heap goes 744 MB to 901 MB over twenty-four requests and then flattens, so it is a plateau rather than a leak
- Impact on open-steamgate: nothing breaks. It is the reason a media-heavy page is expensive rather than cheap, and it will be the reason the browser bundle is heavy when the media go into it
- Smallest safe workaround: none worth having. Reading the file from disk instead was considered and rejected, because `WWWDATA_IMPORT` has to return a table the caller loops over and her CCP class does exactly that
- Upstream issue: none. The real fix is an xstring carried as a byte buffer rather than a hex string, which is the open-abap runtime's shape rather than something a caller can route around, and it is a large change. Recorded because the number is worth having before someone diagnoses it as a leak
- Regression-test location: none
- Upstream version containing a fix: `unknown`

### DEBT-2026-09-13-linked-transpiler — This tree may be built by a transpiler that is not published

- Status: `paid, 2026-09-18` — the tree builds with published `@abaplint/transpiler` / `@abaplint/runtime` 2.13.89 and nothing is linked. The banner and the two switches stay, because the next unreleased fix will want them
- Discovery date: `2026-09-13`
- What it is: four transpiler defects found on oisee/vivid-vibes are fixed in a local branch of `abaplint/transpiler` (`fix/conv-builtin-type`) and not released. `npm link @abaplint/transpiler-cli` puts that build in a tree, which is what makes SMW0 content, the vivid-vibes effects and anything else those four fixes touch work at all
- The cost, said plainly: a linked tree differs from a clean clone, so `npm test` can be green here and red in CI, and nothing about the repository says why. That is the same failure the W3MIMETABTYPE hunt cost a morning on, and it is worth having a rule about rather than a memory
- What keeps it honest: every transpile prints which transpiler produced it, published or local, and a local one prints the path, the branch and the commit (`tools/osd-transpiler.mjs`, first line of `npm run transpile`). `npm run transpiler:which` answers on demand. So a green run here and a red one in CI are one line apart from being explained rather than a mystery
- How to switch: `npm run transpiler:local` links the local build, `npm run transpiler:published` puts the released one back. `npm ci` and `npm install` silently drop the link, which the banner then says
- Who is on it: the transpiler session's tree is linked; open-steamgate's is its own choice
- How it ends: four pull requests upstream, one per fix, at which point the link comes out and this entry moves to the resolved section. The four are recorded above with their reproducers
- **How it actually ended, 2026-09-18.** Three of the four (`#1843` the rearranger, `#1844` the percent, `#1846` the W3MI name) went upstream and are released. The fourth, `fix/builtin-not-a-method`, was never sent and does not need to be: `@abaplint/core` closed the underlying defect from the other end, and the reproducer has stopped reproducing (see the two entries above). `node tools/osd-transpiler.mjs` now prints `published` on both lines
- Upstream issue: none yet, deferred by Alice 2026-09-13

### DEBT-2026-09-14-ci-pinned-transpiler — The public deployment is built by an unmerged branch

- Status: `half paid, 2026-09-18` — `OSD_TRANSPILER_REF` is empty and the build step is gone; `OSD_CORE_REF` and `OSD_GUI_REF` remain, and so does this entry until open-abap-core has `SCMS_BINARY_TO_XSTRING` and the `WWWDATA_IMPORT` walk, and open-abap-gui the inbound `sapevent`
- Discovery date: `2026-09-14`
- What it is: the preview deployment builds a transpiler from a pinned commit of `oisee/transpiler` (`osd-build`, `c5a2290f`) and links it, instead of taking what npm resolves. Decided by Alice: "можно сделать один раз (или добавить режим для этого) — и записать в техдолг"
- Why it had to happen: on a published transpiler a runner writes **no** `*.w3mi.data.*` files at all, so the bundle CI builds is not the bundle this repository tests. #1845 (a binary file survives the copy to output) and #1846 (a W3MI object keyed on its name, not its file name) are both still open. Measured on the runner: `ENOENT: output/zo4d_05_copper%2epng.w3mi.data.png`. Before this, the public site had been serving a build from before the media, the Zork channel and the two new tiles — 17.7 MB of `sw.js` against the 22.8 MB built here — and nobody had noticed, because a failed deployment leaves the previous one standing
- The cost, said plainly: the public site now depends on a branch nobody has reviewed. A commit rather than a branch name is pinned on purpose, so the site cannot change because somebody pushed to `osd-build` this morning; the price of that is that moving the pin is a commit here
- What keeps it honest: `OSD_TRANSPILER_REF` is a plain environment variable at the top of the workflow. Empty means "take what npm gives" and the whole step is skipped, so the day the fixes are released the debt is paid by deleting one line. `tools/osd-transpiler.mjs` runs at the end of the step and prints which transpiler produced the build, into the run log
- Related: `DEBT-2026-09-13-linked-transpiler`, which is the same divergence on a developer's machine. This one is that divergence made public
- How it ends: #1845 and #1846 merged and released, then `OSD_TRANSPILER_REF: ""` and the step goes
- **Half of it ended 2026-09-18**: 2.13.88 carries #1844, #1845, #1846, #1863 and #1869, and 2.13.87 carried #1843 and #1847, so the transpiler pin and the whole clone-and-compile step came out. What is left pinned is the two ABAP libraries, which are a different debt wearing this one's name: `OSD_CORE_REF` (open-abap-core, `SCMS_BINARY_TO_XSTRING` and the `WWWDATA_IMPORT` remainder) and `OSD_GUI_REF` (open-abap-gui, the `sapevent` branch). Neither has been offered upstream yet
- Upstream issue: the two pull requests above, both merged and released

### ANOMALY-2026-09-13-binary-file-to-output — A binary file is corrupted on the way to output

- Status: `fixed upstream: abaplint/transpiler#1845, released in 2.13.88`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/transpiler-cli 2.13.86`
- Affected ABAP statement, runtime API or adapter: the CLI's copy of non-ABAP files, `FileOperations.readAllFiles` and `writeFiles`
- Minimal ABAP reproducer: none; put a PNG in a W3MI object and transpile
- Exact command used to run it: `abap_transpile` on a tree with `*.w3mi.data.png`
- Expected SAP behaviour: n/a, a tooling defect. The bytes that went in should come out
- Actual open-abap behaviour: the file was read and written as UTF-8, so every byte above 0x7F became the replacement character: an 11770-byte PNG arrived as 20175 bytes and no image. Nothing reported an error, because a corrupted PNG is a perfectly valid file
- Impact on open-steamgate: every image and every sound in her demo. It is the reason the media chain could not be tested end to end until it was fixed
- Smallest safe workaround: none; exclude the binary objects from the transpile and copy them by hand
- Upstream issue: PR [abaplint/transpiler#1845](https://github.com/abaplint/transpiler/pull/1845), merged 2026-09-18 as `39af3f1c`, unchanged from the branch (`packages/cli/src/file_operations.ts` is byte-identical to `fix/binary-file-copy`). Files matching `\.(w3mi|smim)\.data\.` are read and written as `latin1`. `binary` was measured against `latin1` on Node and Bun and is the same alias, so the plainer name is used
- Regression-test location: `packages/cli` — the fix is in `file_operations.ts`; the end-to-end proof is open-steamgate serving the 11770-byte PNG byte-identical through the whole ABAP chain
- Upstream version containing a fix: `2.13.88`

### ANOMALY-2026-09-13-percent-in-filename — A percent in a file name is not escaped in the import specifier

- Status: `fixed upstream: abaplint/transpiler#1844, released in 2.13.88`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/transpiler 2.13.86`
- Affected ABAP statement, runtime API or adapter: not ABAP — any object whose abapGit file name carries a percent, which is every W3MI (Web Repository) object, because abapGit encodes the dot of `ZO4D_06_PLASMA.PNG` as `zo4d_06_plasma%2epng`
- Minimal ABAP reproducer: none needed; a file named `a%2eb.mjs`, imported as `./a%2eb.mjs`, is `ERR_MODULE_NOT_FOUND`, and as `./a%252eb.mjs` it is found
- Exact command used to run it: `npx abap_transpile` over a repository with any SMW0 image, then `node output/init.mjs`
- Expected SAP behaviour: n/a — a runtime resolution rule, not a SAP one. A module specifier is a URL and is percent-decoded before it resolves, so a percent in a name has to be escaped as `%25`
- Actual open-abap behaviour: `init.mjs` throws `ERR_MODULE_NOT_FOUND` at boot with the module sitting beside it, so adding an image to a build takes the whole runtime down: the ADT façade and the OData front never start, not only the images
- Impact on open-steamgate: found by open-steamgate on oisee/vivid-vibes, whose media are W3MI objects. Nothing of ours carries a percent today
- Smallest safe workaround: exclude `\.w3mi\.` from the transpile, which is what the vivid-vibes staging did until this was fixed
- Upstream issue: PR [abaplint/transpiler#1844](https://github.com/abaplint/transpiler/pull/1844), merged 2026-09-18 as `f6689840`. The percent is escaped before the slash in `escapeNamespaceFilename`, and the order matters because escaping it afterwards would corrupt the `%23` the same function writes for a namespace. Both specifier writers and the CLI's `sourceMappingURL` use it
- Regression-test location: the transpiler's `test/files.ts`, upstream since #1844
- Upstream version containing a fix: `2.13.88`

### ANOMALY-2026-09-13-w3mi-objid-encoded — The W3MI registry is keyed on the encoded file name, not the object name

- Status: `fixed upstream: abaplint/transpiler#1846, released in 2.13.88`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/transpiler 2.13.86`
- Affected ABAP statement, runtime API or adapter: `SELECT ... FROM wwwparams WHERE objid = ...` and the W3MI registry the transpiler generates
- Minimal ABAP reproducer: a W3MI object whose name carries a dot; read it back with the name that is in `<NAME>` in its own XML
- Exact command used to run it: reading an image through a handler that follows SAP's own API shape
- Expected SAP behaviour: **the plain name**, the one in `<NAME>`. Answered on 2026-09-13 by open-steamgate from the artefact rather than from a system: her page asks for `?audio=ZOISEE-EAR-02.MP3`, her handler passes that straight to `objid`, and that code runs on a real system. Evidence of that grade rather than a read of `wwwparams` on A4H, which is still worth one line the next time someone is on a system with Alice's say-so
- Actual open-abap behaviour: the registry and the `wwwparams` rows are keyed on the encoded name, `ZOISEE-EAR-02%2EMP3`, while the object's own XML carries `ZOISEE-EAR-02.MP3`, so a handler that asks the way SAP's API is asked finds nothing and returns empty rather than failing. The percent-escape is an abapGit filename spelling that should never have become a key
- Impact on open-steamgate: this is what stops the audio in the running demo. The images work only because they were asked for by the encoded name while testing, which is the failure mode in miniature: the wrong key looks like a working one until someone uses the right one
- Smallest safe workaround: ask with the encoded name
- **Addendum, 2026-09-16.** Seen again, from the other side: `npm i --no-save postject` (for a Node single-executable experiment) rewrote `node_modules` and replaced the link to the local build with the published `@abaplint/transpiler` 2.13.87, which does not carry this fix. The next build named the object `ZO4D_00_SALES%2EPNG` and `init.mjs` imported `./zo4d_00_sales%2epng.w3mi.mjs`, which Node decodes to a dot and cannot find while Bun resolves literally and can — so the compiled binary served the generation and every Node host failed at boot. `npm run transpiler:local` puts the link back; `node tools/osd-transpiler.mjs` says which build is in use. Both halves of the W3MI naming, this entry and `ANOMALY-2026-09-13-percent-in-filename`, were still local only, and this is the cost of that. Both are released in 2.13.88 (2026-09-18), so the link is gone and `npm install` can no longer undo them.
- Upstream issue: PR [abaplint/transpiler#1846](https://github.com/abaplint/transpiler/pull/1846), merged 2026-09-18 as `8a0df788`. The registry, `wwwparams` and `tadir` are all keyed on `<NAME>` now. **That merge commit also carried a change to `operators/mod.ts` that nobody on this side wrote — see `ANOMALY-2026-09-16-mod-result-integer`.** Corrected 2026-09-14: this was the transpiler's code all along, not open-steamgate's, and saying otherwise nearly left it unowned
- Regression-test location: `packages/transpiler/test/files.ts` upstream, four cases (the registry, `wwwparams`/`tadir`, a `<NAME>` inside the parameters, and the fall back to the file name)
- Upstream version containing a fix: `2.13.88`

### ANOMALY-2026-09-13-default-ignore — `DEFAULT IGNORE` is parsed and not honoured, and the project cannot switch the rule off

- Status: `fixed upstream: abaplint/abaplint#4291, merged 2026-09-14, first released in @abaplint/core 2.120.53; this tree already has it`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/core 2.120.5`, `@abaplint/transpiler-cli 2.13.86`
- Affected ABAP statement, runtime API or adapter: `METHODS m DEFAULT IGNORE` / `DEFAULT FAIL` in an interface
- Minimal ABAP reproducer: an interface with one `DEFAULT IGNORE` method and a class that implements the interface and not that method
- Exact command used to run it: `npx abaplint`, then `npx abap_transpile`
- Expected SAP behaviour: a class need not implement an optional interface method; calling it does nothing (`IGNORE`) or raises (`FAIL`)
- Actual open-abap behaviour: `implement_methods` demands it anyway, and turning the rule off in `abaplint.jsonc` changes nothing for the transpile, which runs its own mandatory rule set rather than the project's
- Impact on open-steamgate: none of ours; found by open-steamgate on vivid-vibes, where an interface grew two methods and fifty implementors were never updated. It is the reason the repository needs 154 written-out implementations rather than two words in the interface
- Smallest safe workaround: implement the method with an empty body, which is what the patch for that repository does
- Upstream issue: **PR [abaplint/abaplint#4291](https://github.com/abaplint/abaplint/pull/4291)**, opened 2026-09-14 from the fork `oisee/abaplint`, since we cannot push a branch there. The cause was a layer below the rule: `InfoMethodDefinition` did not carry the modifier at all, so `implement_methods` had nothing to read. Two fields beside `isForTesting` and `isFinal`, and the rule skips a method that has either; `DEFAULT FAIL` is included because it is equally optional to implement. Reproduced independently by open-steamgate on 2026-09-14 with a control: removing `DEFAULT IGNORE` gives the identical message, so `implement_methods` does not read the modifier at all, although the parser understands it (`method_def.js`, 7.40 SP08)
- Regression-test location: none
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-18-html-viewer-show-url — `cl_gui_html_viewer=>show_url` of an assigned url shows the url's text, not the document

- Status: `fixed in fork` — open-abap-gui branch `html-viewer-sapevent`, commit `0324e1c`, not yet offered upstream
- Discovery date: `2026-09-18`
- Affected versions: `open-abap-gui` at `ed96e89` (upstream `main`)
- Affected ABAP statement, runtime API or adapter: `cl_gui_html_viewer->load_data( )` followed by `show_url( assigned_url )`, which is how abapGit shows every page (`zcl_abapgit_gui=>cache_asset` then `render`)
- Minimal ABAP reproducer: `load_data( IMPORTING assigned_url = lv_url CHANGING data_table = lt_html )` then `show_url( lv_url )`, then `cl_gui_control=>render_html( )`
- Exact command used to run it: `STG_PORT=3080 npx mocha test/sapevent.mjs` before the fork fix: the frame's `srcdoc` read `abapgit.html`
- Expected SAP behaviour: `load_data` puts the document into the control's data cache under the url it assigns (or the one given), and `show_url` of that url shows the document; any other url is a link the control navigates to
- Actual open-abap behaviour: the substitute set the payload to the url's text at `show_url`, so the document loaded a line earlier was replaced by its own name. `load_data` without a url also assigned nothing, so abapGit's `show_url( '' )` had nothing to name
- Impact on open-steamgate: abapGit's own page flow drew an empty frame with a file name in it; the sapevent round trip (backlog G.2) could not be run against real markup until this was fixed
- Smallest safe workaround: none here; fixed in the fork, which the build takes from `.local/lars/open-abap-gui` and the preview workflow pins by commit (`OSD_GUI_REF`)
- Upstream issue: none yet. The branch carries two commits, the raise of `sapevent` and this; both go to open-abap/open-abap-gui as one PR after a critic pass (`docs/upstream.md`, "Beside the transpiler")
- Regression-test location: `cl_gui_html_viewer.clas.testclasses.abap` in the fork (`show_url_shows_what_was_loaded`), `test/sapevent.mjs` here
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-19-interface-call-without-interfaces — a call through an interface the class does not implement is accepted here and refused on a system

- Discovery date: `2026-09-19`
- What happened: `zcl_zstg_demo_dpc_ext` has, and has had since the search
  help was added, `me->/iwbep/if_sb_gendpc_shlp_data~get_search_help_values(
  ... )`, while no class in its hierarchy declares
  `INTERFACES /IWBEP/IF_SB_GENDPC_SHLP_DATA`. `npm test` is green, abaplint
  says nothing, and the request is served here. A4H refuses to activate it:
  *"The class ZCL_ZOSD_005_DEMO_DPC_EXT does not contain an interface
  /IWBEP/IF_SB_GENDPC_SHLP_DATA. However, there is a similarly named
  interface /IWBEP/IF_SB_GEN_DPC_INJECTION."*
- What is right: A4H. `me->intf~meth` requires the class to implement the
  interface; the interface existing is not enough. The interface does exist
  on A4H, in `/IWBEP/SB_GENDPC_SHLP`, and open-abap-odata has it too — so
  both sides resolve the **name**, and only one checks the **binding**
- Why it stayed invisible: the call is legal-looking and the type
  (`=>tt_result_list`) resolves either way, so nothing on this side has a
  reason to ask. It took a real system to ask
- What was done about it: not a workaround. The model was missing the data
  source the code already used — `StatusVH` now maps its query operation to
  `ZSTG_STATUS_SH` in `src/demo/zstg_demo.stg.yaml`, so segw-gen writes the
  `INTERFACES` line into the generated `_DPC`, which is where SEGW puts it.
  Measured before deciding where: the DPC of [GWSAMPLE_BASIC](https://help.sap.com/docs/ABAP_PLATFORM_NEW/68bf513362174d54b58cddec28794093/59283fc4528f486b83b1a58a4f1063c0.html)
  declares three interfaces (`IF_SB_DPC_COMM_SERVICES`,
  `IF_SB_GENDPC_SHLP_DATA`, `IF_SB_GEN_DPC_INJECTION`); eight corpus DPCs
  declare the first and third and **none** declares the second, and none of
  the eight maps a search help. So the third is conditional on the mapping,
  which is exactly what our generator already did with `hasShlp` — the
  generator was right and the tree was wrong
- Upstream: **needs an issue** in abaplint. A syntax rule for "call through
  an interface the class does not implement" would have caught this here,
  and would catch it for everyone generating ABAP for a real system. No fix
  proposed; the reproducer is four lines

### NOTE-2026-09-19-date-facets — one facet differs, and it took three readings to say which

Written down mostly as a record of getting the same small question wrong
twice out loud before reading the code that answers it.

- Discovery date: `2026-09-19`
- The tree, after `type: Date`, carries `Edm.DateTime`, `TYPE_NAME SYDATE`,
  `TYPE_KIND D`, `LENGTH 8` and **no** `PROP_PRECISION` — SAP's own sample
  projects' shape for a date
- A4H answers `<Property Name="FlightDate" Type="Edm.DateTime"
  Precision="0" sap:unicode="false" sap:label="Flight date"/>` — a
  precision nothing in the tree asked for, and no `sap:display-format`
- **`Precision` is not a divergence.** Said twice that it was, in opposite
  directions, both times from a reading rather than the code.
  `zcl_oao_http_handler` emits `Precision="{ mv_precision }"`
  *unconditionally* for `Edm.DateTime`, and `mv_precision` is an `i`, so a
  property whose MPC never calls `set_precison` gets `Precision="0"` here
  too. Same answer, different route
- **`sap:display-format` is the one that differs.** We derive it in
  `zcl_oao_entity_typ=>bind_structure` for a DATS-bound field; 38
  `Edm.DateTime` properties across 17 real `$metadata` documents in the
  corpus (measured by fable-osd) and one live A4H service carry it **zero**
  times. 39 observations, no occurrences, several vendors
- **And it is still not enough to act on.** All 39 could share a binding
  style; the case that would settle it is a SAP-delivered service with a
  DDIC-bound date. Tried on A4H: a Gateway demo service answers 403 and
  a test application service 500 for this user, and the EPM-RFC-SAMPLE
  service and GWSAMPLE_BASIC are not activated. So
  the measurement is blocked on an authorisation, not on an argument, and
  nothing changes until it is not
- What fable-osd's numbers do settle: `Precision` on `Edm.DateTime` is
  derived from the ABAP type, `0` for DATS (26 properties) and `7` for
  TIMESTAMP (9). The three with no `Precision` at all are Northwind in a
  `localService` copy, not a Gateway's answer

### ANOMALY-2026-09-12-transpiler-concat-chain — An `&`/`&&` chain nests one concat( ) call per operand

- Status: `fixed upstream, workaround removed`
- Discovery date: `2026-09-12`
- Affected versions: `@abaplint/transpiler-cli 2.13.85`
- Affected ABAP statement, runtime API or adapter: `a & b & c ...` (also `&&`), `abap.operators.concat`
- Minimal ABAP reproducer: the `IF_SADL_GW_DPC_UTIL~GET_DPC` segw-gen writes for a project with many entity sets (`gen/stg/zstg_segw/zcl_zstg_segw_dpc.clas.abap`, 55 sets, ~830 operands)
- Exact command used to run it: `npm run e2e:preview` (the service worker refuses the bundle: "ServiceWorker script evaluation failed", CDP says "Maximum call stack size exceeded"; Node and a dedicated worker parse the same file)
- Expected SAP behaviour: a chain of any length is one string expression
- Actual open-abap behaviour: `concat(a, concat(b, concat(c, ...)))`, one nesting level per operand; the runtime already accepts `concat([a, b, c])` (used for constant chains) but the Source transpiler does not emit it
- Impact on open-steamgate: the browser preview (GitHub Pages) fails to install its worker once any transpiled class carries a chain of ~800 operands
- Smallest safe workaround: `tools/segw-gen.mjs` builds a SADL definition longer than `SADL_CHUNK` (200) lines in pieces (`lv_sadl_xml = lv_sadl_xml & ...`); every SAP project we have is shorter (85 max), so their generated classes are unchanged
- Upstream issue: **[abaplint/transpiler#1836](https://github.com/abaplint/transpiler/pull/1836)**, merged and released in `@abaplint/transpiler 2.13.87` on 2026-09-14. The workaround is gone from both generators — `tools/segw-gen.mjs` and `src/segw/zcl_stg_segw_gen_dpc.clas.abap` — which had to move together, because a test compares them byte for byte. Measured before removing rather than after: 1200 operands now emit one `concat( )` call, where the nesting used to be one per operand. ZSTG_SEGW's definition is back to a single 836-line chain, past the 800 the service worker's stack used to give out at, and the whole Playwright suite is green
- Regression-test location: `test/e2e/preview.spec.mjs` (the preview installs), `test/stg-compile.mjs`
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-13-bun-percent-encoded-specifier — Bun does not decode `%23` in an ESM specifier

- Status: `workaround`
- Discovery date: `2026-09-13`
- Affected versions: `bun 1.4.2`, `@abaplint/transpiler-cli 2.13.86`
- Affected ABAP statement, runtime API or adapter: not ABAP — the transpiled output of any `/NAMESPACE/`-prefixed object, whose file name carries `#` and whose importers write it percent-encoded (`await import("./%23iwbep%23cl_mgw_data_util.clas.mjs")`)
- Minimal ABAP reproducer: none needed; two files, `mod.mjs` renamed to `#h#mod.mjs`, imported once as `"./%23h%23mod.mjs"` and once as `"./#h#mod.mjs"`
- Exact command used to run it: `node enc.mjs` / `bun enc.mjs` (percent-encoded) and `node lit.mjs` / `bun lit.mjs` (literal)
- Expected SAP behaviour: n/a — this is a runtime divergence, not a SAP one. Node resolves the percent-encoded form and refuses the literal; Bun does the exact opposite, so no single specifier satisfies both
- Actual open-abap behaviour: under Bun the run dies at the first such import with `Cannot find module "./%23iwbep%23cl_mgw_data_util.clas.mjs"`. 99 files in `output/` carry a `#` today
- Impact on open-steamgate: nothing today (we run Node), and **narrower than first written**. Measured 2026-09-14: it blocks the interpreted path (`bun entry.mjs`) and `bun build --compile` from the command line, which takes no plugin. It does **not** block packaging. `Bun.build({compile, plugins})` with a five-line `onResolve` that decodes `%23` produces a binary that runs and prints the value from the namespaced module. So single-binary packaging needs the plugin, not the upstream fix, and #1841 stops being a gate for it
- Smallest safe workaround: rename `#` out of the file names in a copy of `output/` and apply the same substitution inside relative `./*.mjs` specifiers (`.local/dehash.mjs`, ~20 lines, 99 renames and 22 rewrites). With it Bun runs the same 107 ABAP Unit tests as Node and serves the gateway over HTTP; see `docs/bun-spike.md`. For a bundled or compiled build the workaround is smaller and needs no copy of `output/`: a `Bun.build` plugin whose `onResolve` filter is `/%23/` rewrites the specifier at resolve time (`.local/bun-build.mjs`). The same plugin closes `ANOMALY-2026-09-13-percent-in-filename` with a second `/%25/` filter, which is why the 172 files carrying a percent are a bundler footnote rather than the blocker they were called
- Upstream issue: https://github.com/abaplint/transpiler/issues/1841 (open 2026-09-13, filed by the transpiler session, this spike cited as the evidence). Traced to `escapeNamespaceFilename` in `packages/transpiler/src/initialization.ts` and the source-map line in `packages/cli/src/index.ts`, both of which write `/` as `%23`. Filed as an issue rather than a patch because changing the character changes every mapping from a file back to an object name, so the choice is Lars's; `$`, `-` and `_` are the candidates that need no encoding anywhere. A Bun issue for the specifier decoding is the other half and is not filed
- Regression-test location: none
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-14-bun-bundler-module-output — Bun's bundler emits module-only syntax a classic worker cannot evaluate

- Status: `open`
- Discovery date: `2026-09-14`
- Affected versions: `bun 1.4.2`, `webpack 5.110.3` (the comparison)
- Affected ABAP statement, runtime API or adapter: not ABAP — the transpiled runtime as a whole. `output/` carries `import.meta` and 8893 top-level `await`s, both of which are legal only in an ES module
- Minimal ABAP reproducer: none needed; `bun build web/preview-worker.mjs --target=browser` against any entry point whose graph contains a top-level `await` or `import.meta`
- Exact command used to run it: `bun .local/bun-build.mjs`, then `navigator.serviceWorker.register("./sw.js")` in Chromium
- Expected SAP behaviour: n/a — a bundler divergence. webpack lowers both for a non-module target: `experiments.topLevelAwait` turns a top-level await into a promise chain, and `import.meta` is rewritten
- Actual open-abap behaviour: Bun bundles the same graph successfully and 166 times faster (337 ms against webpack's 56 s, 33.3 MB unminified against 22.8 MB minified) but emits the two module-only constructs verbatim. A service worker registered without `{type: "module"}` is a classic script, so evaluation dies with `Cannot use 'import.meta' outside a module` and registration fails as `ServiceWorker script evaluation failed`. All four preview e2e tests go red; the error surfaces only when the file is loaded as a classic `<script>`, because the registration failure itself says nothing
- Impact on open-steamgate: Bun cannot replace webpack for the browser preview today. It does not touch the binary path, where the target is a module and both constructs are legal (see the entry above). It also decides the single-file HTML question: `file://` refuses `<script type="module">`, so that build needs the same lowering and therefore webpack
- Smallest safe workaround: keep webpack for `web:preview`. The alternative, registering the worker with `{type: "module"}`, is not taken: module service workers are not supported across the browsers this preview is opened in
- Upstream issue: none filed. Two halves, as with the specifier defect: Bun could lower for non-module targets, and we could stop generating top-level awaits. Neither is ours to decide alone
- Regression-test location: `test/e2e/preview.spec.mjs` (four tests, which is what caught it)
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-14-general-get-random-int — `GENERAL_GET_RANDOM_INT` is not implemented

- Status: `fixed upstream elsewhere: open-abap-core#1221 was closed, and the module landed in open-abap/open-abap-deprecated#2 (merged 2026-09-18)`
- Discovery date: `2026-09-14`
- Affected versions: `open-abap-core` as cloned 2026-09-14
- Affected ABAP statement, runtime API or adapter: `CALL FUNCTION 'GENERAL_GET_RANDOM_INT'`
- Minimal ABAP reproducer: `CALL FUNCTION 'GENERAL_GET_RANDOM_INT' EXPORTING range = 10 IMPORTING random = lv_n.`
- Exact command used to run it: `npx playwright test --config playwright.preview.config.mjs -g walkthrough` — the MiniZork walkthrough replayed through the APC channel of the browser bundle
- Expected SAP behaviour: **measured on an AS ABAP 1909 sandbox rather than inferred, and the inference was wrong.** The parameter text says only "The random int will be <= range". It is uniform over `[0, range]` — `range + 1` values, not `range`: 300 calls each gave zero in 163 (range 1), 105 (range 2), 53 (range 6) and 3 (range 100), which is `1/(range+1)` at every point. `range = 0` answers `0`; `range = -5` answered `-2`, so a negative range is not an error and the span runs towards `range`. No exceptions are raised. Observed by calling it from a throwaway report and test class in `$TMP`, never by reading its implementation — an observation can be contributed upstream, an adaptation cannot
- Actual open-abap behaviour: the module does not exist, so the dynamic call raises `CX_SY_DYN_CALL_ILLEGAL_FUNC`
- Impact on open-steamgate: it is the Z-machine's `random` opcode (`local/zork/zcl_ork_00_zmachine.clas.abap:557`), so MiniZork plays perfectly until the first dice roll and then the channel dies. The first dice roll in the walkthrough is the troll fight, twenty-five commands in. Anything transpiled that needs randomness hits the same wall
- Smallest safe workaround: `src/fugr/openabap.fugr.general_get_random_int.abap` plus the FUNCNAME block in `openabap.fugr.xml`, three `@KERNEL` lines over `Math.random`. **Not** `cl_abap_random_int`, which was the first attempt and cannot express this: `cl_abap_random=>intinrange` opens with `ASSERT high > low` and `ASSERT low >= 0`, so a range of zero dumps and every negative range dumps. Reaching the contract through `abs( )` and a negation works and reads as cleverness hiding intent; it is the same `Math.random` either way, and `generate_sec_random` in that group is the precedent for the plain form. With it the whole MiniZork walkthrough plays in the browser bundle, every assertion, start to finish, three runs on the strict form of the test. The test still tolerates the old death, because a fresh clone of core does not have this file
- Upstream issue: https://github.com/open-abap/open-abap-core/pull/1221 (fork branch `general-get-random-int`; no write access on that repository, as with #1218). Agreed with the transpiler session before opening, per Alice, so the same fix is not offered twice
- Regression-test location: `test/e2e/preview.spec.mjs`, "the MiniZork walkthrough plays the same in the bundle"
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-14-exception-with-no-message — An ABAP exception reaches JavaScript with an empty `message`

- Status: `workaround`
- Discovery date: `2026-09-14`
- Affected versions: `@abaplint/runtime 2.13.86`
- Affected ABAP statement, runtime API or adapter: any `RAISE EXCEPTION` or runtime-raised `CX_*` crossing into host JavaScript
- Minimal ABAP reproducer: none needed; catch anything thrown out of transpiled code and read `error.message`
- Exact command used to run it: the APC channel of the browser bundle closing on a handler failure
- Expected SAP behaviour: n/a — a host-boundary question, not a SAP one
- Actual open-abap behaviour: the thrown value is an exception class instance, not an `Error`. It has no `message`, or one that is an ABAP string object. So the obvious host line, `String(error?.message ?? error)`, yields the empty string — the nullish coalescing does not fire on `""`
- Impact on open-steamgate: a channel closed with code 1011 and a blank reason, and a real crash in the transpiled Z-machine looked like an unexplained disconnect for an afternoon. The same shape would hide any handler failure in the bundle
- Smallest safe workaround: `tools/osd-describe.mjs`, now used by both the APC front and the service worker: it reads `constructor.INTERNAL_NAME` for the class, unwraps an ABAP string `message` through `.get()`, and appends the frames that point into `output/`. `CX_SY_DYN_CALL_ILLEGAL_FUNC (no text)` beats an empty string
- Upstream issue: none. Arguably the runtime could give exception instances a `message`; T is separately fixing `get_source_position( )`, which throws on anything the runtime raised itself
- Regression-test location: `test/osd-apc.mjs`
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-19-posted-form-has-no-fields — a form posted to a screen arrives with no form fields

- Status: `open`
- Discovery date: `2026-09-19`
- Affected versions: `express-icf-shim` as cloned 2026-09-19 (`cl_express_icf_shim`)
- Affected ABAP statement, runtime API or adapter: the request assembly of `cl_express_icf_shim~run`, seen through `if_http_entity~get_form_field` / `~get_form_fields_cs`
- Minimal ABAP reproducer: any handler that reads `get_form_field( 'name' )` behind a `<form method="post">`. The shim sets the form fields from the query string alone — `lt_fields = cl_http_utility=>string_to_fields( lv_value )` where `lv_value` is what followed the `?` — and the body, which it has already read into the request as data, is never looked at
- Exact command used to run it: `STG_PORT=3131 node test/run.mjs`, then a POST of `type=CLAS&name=ZCL_OSD_ST05&do=check` to `/sap/bc/osd/edit/`. The editor answered its **object list**: every field was empty, so the screen behaved exactly as though the person had typed nothing and pressed nothing
- Expected SAP behaviour: **documented, not measured.** No system was asked (the sandbox is only used when Alice asks), so this claims nothing about a particular release. It does not have to: the interface open-abap ships says it itself — `get_form_fields_cs` takes `search_option TYPE i DEFAULT co_body_before_query_string`. A default named "body before query string" is only meaningful if the body is a source of form fields, and here it never is
- Actual open-abap behaviour: the body survives intact as the request's data (`get_cdata` returns it), so nothing is lost — it is simply not parsed into fields. The failure is therefore **silent and total** for a posting screen: no error, no empty-ness anywhere a caller can see, just every field reading as if nobody filled it in
- Impact on open-steamgate: the editor screen (G.8) is the first page here that posts a form at all. The screens written before it did not meet this — SE16 navigates by GET, and the webgui posts through `sapevent`, which carries its payload in the URL. So the gap is one this tree could only find the day it wrote a text area
- Smallest safe workaround: `src/webgui/zcl_osd_form.clas.abap` — the query-string fields as the shim gives them, plus the body parsed when the method is POST or PUT and the content type is `application/x-www-form-urlencoded`. (Found first on 2026-09-18 in the AMDP sandbox, whose `zcl_osd_amdp_sbx=>posted_body` parses the pairs by hand; a form sends a space as `+`, and `REPLACE ... WITH ' '` replaces it with nothing, since a text literal loses its trailing blanks -- it has to be written `` WITH ` ` ``.) It is **not** `cl_http_utility=>string_to_fields`, and the two differences are required by the encoding rather than chosen: `+` is a space (that method decodes with `decodeURIComponent`, which leaves `+` alone, so a source posted through a text area would come back with its indentation turned into plus signs), and the **name** is unescaped too
- Upstream issue: none yet; the repository is open-abap/express-icf-shim. The fix belongs in the shim, where the request is assembled, and it is small — parse the body into fields when the content type says it is a form. `docs/upstream.md` carries it; it goes out under the critic gate like the rest
- Regression-test location: `test/unit/zcl_osd_form_test` — the decoding rules, and separately `the_gap_this_exists_for`, which asserts that `get_form_field` over a posted body answers **nothing**. That is the expiry: when the shim learns to parse a body, that test fails and says to delete the workaround rather than to adjust an expectation
- Upstream version containing a fix: `unknown`


### ANOMALY-2026-09-19-form-field-name-case — `get_form_field` lower-cases the question and not the answer

- Status: `fixed upstream: open-abap/open-abap-core#1253, merged 2026-09-19`
- Discovery date: `2026-09-19`
- Affected versions: `open-abap-core` as cloned 2026-09-19
- Affected ABAP statement, runtime API or adapter: `if_http_entity~get_form_field` / `~set_form_fields`
- Minimal ABAP reproducer: set a form field named `f_STATUS`, then ask for it by that exact name — nothing comes back. It is reachable by no spelling at all: `get_form_field` lower-cases what it is asked for, so the only name it can ever match is one already lower case
- Exact command used to run it: `STG_PORT=3131 npx mocha test/se16.mjs`, the data browser's per-field selection (`?t=ZC_STG_TRAVEL&f_STATUS=B*`), which silently filtered nothing
- Expected SAP behaviour: **not measured, and deliberately not claimed.** No system was asked, so this entry does not assert what SAP does. It does not need to: the inconsistency is *inside* open-abap-core and visible without any oracle — `cl_http_entity=>get_form_field` reads `READ TABLE mt_form_fields WITH KEY name = to_lower( name )`, while `set_form_fields` stores `mt_form_fields = fields` unchanged. One side normalises and the other does not, so a name that can be **set** can never be **got**. Whichever behaviour SAP has, it is not this one, because this one is not a behaviour — it is two halves disagreeing
- Actual open-abap behaviour: as above. `get_form_fields` (plural) lower-cases on the way out, which is a third spelling of the same decision and the reason the single getter's asymmetry is easy to miss
- Impact on open-steamgate: any page whose form field names are not already lower case reads them as empty. Found in the data browser (G.9 wave 2), where the field names come from DDIC and DDIC names are upper case. The failure is silent: the filter simply selected everything, which looks like a working screen with no filter typed
- Smallest safe workaround: name the form fields in lower case and ask for them that way — `f_{ to_lower( ls_field-name ) }` in `src/webgui/zcl_osd_se16.clas.abap`, both where the input is rendered and where it is read. One line each, no dependency on which half upstream fixes
- Upstream issue: https://github.com/open-abap/open-abap-core/issues/1252, opened 2026-09-19; **PR https://github.com/open-abap/open-abap-core/pull/1253** opened the same day when the maintainer asked for one. The fix compares the name case insensitively on both sides, with three tests, the first of which was checked failing on `main` by reverting the method rather than by reasoning about it. The issue names the side that looks right and says why — the header path normalises on both sides, and the interface ships `_cs` variants, which only makes sense if the plain getter is the case-insensitive one — and offers a PR with a test
- Regression-test location: `test/se16.mjs`, "filters through the same clause builder an OData $filter goes through"
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-19-bang-value — abaplint does not parse a method declared `!VALUE(x)`, and the method is lost

- Status: `fixed upstream: abaplint/abaplint#4311, merged 2026-09-20, first released in @abaplint/core 2.120.57; this tree still pins an older core`
- Discovery date: `2026-09-19`
- Affected versions: `@abaplint/core` 2.120.55
- Affected ABAP statement, runtime API or adapter: `METHODS` / `CLASS-METHODS` with a parameter written `!VALUE(name)`
- Minimal ABAP reproducer:
  ```abap
  CLASS c DEFINITION PUBLIC.
    PUBLIC SECTION.
      CLASS-METHODS m1 IMPORTING !VALUE(iv_x) TYPE i.
  ENDCLASS.
  ```
- Exact command used to run it: parse it with `new Registry().addFile(...).parse()` and read `getFirstObject().getABAPFiles()[0].getStatements()`
- Expected SAP behaviour: **not claimed, and not needed.** The `!` is the **identifier escape** — it stops the name being read as a keyword — and it carries no meaning for the interface. (It is not `PREFERRED PARAMETER`, which is a separate `METHODS` addition; abaplint's own rule for the escape is `no_exclamation_escape`. The first version of this entry got that name wrong, and a critic caught it before it went to the people who wrote that rule.) What makes this an anomaly does not need a system: abaplint parses `!iv_x` and parses `VALUE(iv_x)`, and does not parse the two **together**. `!REFERENCE(x)` fails the same way
- Actual open-abap behaviour: the `METHODS` / `CLASS-METHODS` statement comes back as `Unknown`, so **that method** is missing from `getClassDefinition().methods`. Other methods of the class are unaffected — the first version of this entry said "the whole class", which is an artefact of a reproducer with one method in it. Nor is it silent: `findIssues()` reports a `parser_error`, but it points at the `CLASS` token rather than at the parameter, and a caller using `getClassDefinition()` sees only a missing method
- Impact on open-steamgate: rare by file count and total where it occurs — 6 of 3052 classes read off a system contain the form at all, and in those it is generated for every parameter of every method, so abaplint parses 2 of 15 methods in one class and 1 of 9 in another. (Who generates it is **not** measured: the first version of this entry said SE24, which nobody asked. abaplint#2529 floats the same guess and it is still a guess.) A body then looks as though it read an **undeclared table variable** — the refusal names `:it_ddls`, declared three lines above it in the ABAP. Measured: 171 of 364 corpus bodies had a signature carrying parameters; with the workaround, **188**
- Smallest safe workaround: `withoutBangValue()` in `tools/amdp-extract.mjs` — `!VALUE(` becomes `VALUE(` for the parser and for nothing else. Deliberately a normalisation of one token for one parser rather than a parameter parser of our own: re-deriving what abaplint does is the failure mode this project is built to avoid, and it would go stale in silence the day upstream fixes this
- Upstream issue: https://github.com/abaplint/abaplint/issues/4308, opened 2026-09-19; **PR https://github.com/abaplint/abaplint/pull/4311** the same day, after Lars answered "PRs welcome". Three expressions matched the keyword as a literal and all three are fixed: `MethodParam`, `MethodDefReturning` and `PassByValue`. The second was found by a test — `RETURNING !VALUE(rv_x)` still failed after the first was fixed — which is why the test cases were written before the second site was looked for. That repository takes no branch from us and its regression workflow skips forks, so an issue is the whole of what we can offer there, and the issue offers a PR if the maintainer names the shape he wants. Related upstream: abaplint#2529, the same escape in front of a builtin function, open since 2022
- Regression-test location: `test/amdp.mjs`, "a parameter written `!VALUE(x)` is still a parameter" — **and, separately, "the abaplint gap the !VALUE workaround exists for"**, which asserts the upstream defect itself so that the workaround has an expiry. A workaround with no expiry is how a tree collects code nobody dares remove: the reason lives in a commit message, the commit message is read once, and later the normalisation looks load-bearing. When abaplint learns the form, that test fails and says to delete the workaround rather than to adjust the expectation
- Upstream version containing a fix: **merged 2026-09-20 (abaplint#4311, by larshp), not yet released.** Merged is not shipped: the workaround stays until a published `@abaplint/abaplint` carries it, and the expiry test -- "the abaplint gap the !VALUE workaround exists for" -- is what will say so, by going red on the release rather than on the merge. Checking the merge instead of the release is the same mistake as reading a build command's exit code for a built artefact


### NOTE-2026-09-19-shared-library-clone — a library clone shared by symlink has no private checkout

Not an anomaly in anybody's software; a property of how this tree is
arranged, written down because it produced a real disagreement about a
measurement and cost two sessions half an hour.

- Discovery date: `2026-09-19`
- What happened: two sessions counted the objects the store indexes and got
  **1134** and **1140** within a minute of each other. The repository content
  was identical — grouped by origin, the two agreed on **420** own objects
  and differed only in the libraries, 714 against 720
- Why: `.local/lars/*` are single working directories, and every worktree
  `osd-branch` makes points at them by symlink
  (`.local/worktrees/*/.local/lars -> <main>/.local/lars`). **There is no
  private checkout to differ**; there is one checkout that either session can
  move. This one was moved: a branch was created in
  `.local/lars/open-abap-core` to send open-abap-core#1253, which carried the
  clone from `4eec777` to `origin/main`, and the twenty commits in between
  added exactly six objects — `char5`, `char64`, `char100`, `char200`,
  `cx_osql_failure`, `if_ixml_text`
- What follows for `osd-branch`: a worktree is isolated **by repository and
  by `$HOME`, and not by libraries.** That is a real limit on what "a clean
  tree" means, and it is worth stating in the same breath as the Playwright
  browsers: a shared clone is shared files **and a shared checkout**, and a
  symlink makes the second look like the first
- What follows for measuring: a count of objects is only comparable when the
  library checkouts are named alongside it. The two readings were both
  correct and were about different systems
- The cheap check, which settled it in one step: print the count, the types,
  **and `git -C .local/lars/open-abap-core rev-parse HEAD` together**, so
  that a number can never travel without the state it was taken in


### NOTE-2026-09-20-generation-hash-moved — a test writes into `src/`, and the first cause I named was wrong

Not an anomaly in anybody's software yet, because it has not been isolated.
Written down because a **wrong explanation was published in a commit
message** (`735feed`) and a wrong explanation is worse than an open question:
the next person stops looking.

- What was observed: the i7's `/sap/bc/adt/core/http/build` reported
  `synchronized: false` three times, and `hashOf(root)` returned
  `0c3527a9` -> `3aa2efb4` -> `b0de031f` within a few minutes **with no
  build between them**. The last equals `liveHash`, and once the tree was
  quiet `source == live` without anything being rebuilt.
- What was in flight each time: a full `tools/osd-suites.mjs` run.
- **What I blamed, and it is not true:**
  `src/zosd_test/src/zosd_test_demo_inc.prog.abap` has been showing `M` all
  session, so I said the suites write it. They do not: its diff is
  `"comments added directly on FS` and `"+2`, a person's editor test, made
  before this session started and deliberately left alone. The file being
  dirty and the hash moving are two facts that happened to sit next to each
  other, and I joined them because one explained the other.
- What has since been ruled out, by measuring rather than reasoning: no file
  under any input folder or library folder was written in the last 90
  minutes (`find … -newermt`); `describeBuild()` is stable across repeated
  calls; and a suite that starts and recycles servers
  (`test/osd-runtime.mjs`) held the hash steady for 30 seconds of polling.
- **Isolated, 2026-09-20, in five seconds of the measurement described
  below.** `test/adt-devloop.mjs` writes `src/osd/zcl_osd_scratch.clas.abap`
  -- the state-changing half of the ADT façade is tested by locking, writing
  and activating a real class, and the façade's store writes an object where
  objects live. Its `after()` removes the file again ("the scratch object is
  a file like any other, so it is removed like one"), which is why
  `find … -newermt` afterwards shows nothing and why the hash returns to its
  old value on its own.
- **And it is not the only one.** Caught mid-run while writing this up:
  `test/cds-check.mjs` rewrites `src/cds/zc_osd_pack.ddls.asddls` to check
  that a changed annotation is noticed, and restores it -- it even carries
  an assertion of its own, "and the file is restored, or this suite breaks
  the tree it measures". Two suites, both deliberate, both tidy, and
  together they mean an input folder is in motion for part of every run.
- **So `hashOf` is right and the reader was wrong.** While that file exists
  it IS part of the tree, and a build would produce a different generation.
  Nothing to fix in the hash, nothing to fix in the test: what was missing
  is the precondition, now written down -- **`synchronized` is only readable
  when the tree is quiet.** A deploy is verified after the suites, not
  beside them.
- How it was found, kept because the shape generalises: snapshot the file
  list and sizes of `inputsOf(root)`, poll `hashOf` once a second, and on
  the first change diff the snapshot -- added, gone, resized. Thirty lines.
  It prints the file, or it prints "nothing changed under the inputs", which
  would have meant the defect was in `hashOf` itself. Either answer is one
  run away, which is the argument for writing it instead of reasoning.
- Why it matters beyond tidiness: `synchronized` is how this session decides
  whether the i7 is serving its own source, and it is read after every
  deploy. A field that is unreadable while a suite runs is a field whose
  false readings get explained away -- which is exactly what happened three
  times tonight, twice by blaming the deployment and once by blaming a test.

### NOTE-2026-09-20-i18n-not-intercepted — the preview's service worker does not see an app's i18n request

Found while giving the new ICF registry application an end-to-end check,
and **it is not that application's**: the same request fails the same way
for `zosd_status_app`, which has been deployed for a day.

- What is measured, in a persistent-context Chromium against a local
  preview build, watching every response under `/sap/bc/ui5_ui5/`:
  ```
  200 sw=true   /sap/bc/ui5_ui5/sap/zosd_status_app/Component.js
  200 sw=true   /sap/bc/ui5_ui5/sap/zosd_status_app/manifest.json
  404 sw=false  /sap/bc/ui5_ui5/sap/zosd_status_app/i18n/i18n.properties
  ```
  `fromServiceWorker` is **false** for the one that fails. The worker is in
  control (the two above it prove that), the path matches
  `SERVICE_PREFIXES` (`/sap/bc/ui5_ui5/sap` is in the generated list), and
  the page is served correctly when the same URL is fetched by hand from a
  page the worker controls -- 200, with the right content.
- So the request is **not reaching the worker at all**, rather than the
  worker answering 404. Why UI5's resource-bundle load is not intercepted
  while its module loads are is the open question. A synchronous XHR from
  `sap.ui.model.resource.ResourceModel` is the first thing to look at.
- Consequence, and it is small: the bundle falls back and the application
  renders with its default texts. Both applications list their rows. It is
  a red line in a network tab and a missing translation, not a broken app.
- Why it is written down rather than fixed now: the fix is in UI5's loading
  or in the worker's scope handling, neither of which is guessed at
  cheaply, and the application it was found on is new -- attaching an old
  defect to a new test would make the new test carry it forever.
- Where the check is: `test/e2e/preview.spec.mjs` excludes `/i18n/` from
  the 404 assertion and names this entry. When this is fixed, delete the
  exclusion; if the exclusion outlives the defect, the assertion has
  stopped testing what it says.

### NOTE-2026-09-22-packed-length-is-bytes — `P LENGTH n` is n bytes, and the portable IR reads it as n digits

- `tools/sqlscript-to-procedure-ir.mjs` (`irTypeFromAbap`) maps
  `P LENGTH n DECIMALS m` to `T.dec(n, m)`, and bare `P` to `dec(16, 2)`.
  In ABAP the length of a packed number is in **bytes**: `n` bytes hold
  `2n - 1` digits, and the default is 8 bytes = 15 digits. So a parameter
  `TYPE p LENGTH 8 DECIMALS 2` -- 15 digits -- becomes a `DECIMAL(8,2)` on
  the way to the database, which holds 8 digits: an amount above 999999.99
  overflows or is refused by the engine, depending on the dialect.
- Found by foreman-dell reading `c12329b..ddde7d7`, not by a test: no
  conformance case sends a packed parameter of more than six digits.
- Not changed in that branch, because it is the runtime's type boundary and
  a change there needs its conformance case (a `P LENGTH 8 DECIMALS 2`
  input of 15 digits through the destination, on HXE and DuckDB) before it
  is trusted. Until then, the mapping is wrong in a known direction --
  **narrower** than the ABAP type -- which fails loudly rather than
  silently for a value that does not fit.
- Where the fix goes: `irTypeFromAbap`, `scalarTypeOf` (the same literal
  form) and the DDIC catalogue's `DEC` mapping (`LENG` of a DEC field in DD03P is already digits, not bytes, so
  only the literal `P LENGTH n` form is affected).

### ANOMALY-2026-09-23-amdp-method-options — abaplint drops the whole class definition when an AMDP method uses an OPTIONS clause other than READ-ONLY

- Status: `open`
- Discovery date: `2026-09-23`
- Affected versions: `@abaplint/core` 2.120.55 (as installed; `npm ls @abaplint/core`)
- Affected ABAP statement, runtime API or adapter: `METHOD … BY DATABASE PROCEDURE|FUNCTION FOR HDB LANGUAGE SQLSCRIPT OPTIONS …` — the statement accepts `OPTIONS READ-ONLY` and nothing else; `OPTIONS SUPPRESS SYNTAX ERRORS`, `OPTIONS READ-ONLY SUPPRESS SYNTAX ERRORS`, `OPTIONS DETERMINISTIC` and `OPTIONS CDS SESSION CLIENT p_clnt` are all reported as "Statement does not exist in the configured ABAP version (or a parser error)". `LANGUAGE LLANG` and `BY DATABASE GRAPH WORKSPACE` are refused the same way.
- Minimal ABAP reproducer:
  ```abap
  CLASS cl_x DEFINITION PUBLIC.
    PUBLIC SECTION.
      INTERFACES if_amdp_marker_hdb.
      CLASS-METHODS m IMPORTING VALUE(iv) TYPE i EXPORTING VALUE(ev) TYPE i.
  ENDCLASS.
  CLASS cl_x IMPLEMENTATION.
    METHOD m BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT
    OPTIONS SUPPRESS SYNTAX ERRORS
    USING ztab.
      ev = 1;
    ENDMETHOD.
  ENDCLASS.
  ```
  With `OPTIONS READ-ONLY` in place of `OPTIONS SUPPRESS SYNTAX ERRORS` the same file parses and `getClassDefinition()` lists one method.
- Exact command used to run it: `new abaplint.Registry().addFile(new MemoryFile("cl_x.clas.abap", src)).parse()`, then `getFirstObject().getClassDefinition()` is `undefined` and `findIssues()` carries a `parser_error` on the METHOD line.
- Not a configuration matter: the same file fails identically under `syntax.version` `v702`, `v750`, `v755`, `v757`, `v758`, `open-abap` and `Cloud` (the extractor uses the default, `Newest`), so no version setting in `abaplint.json` parses the clause — the grammar lacks it (checked 2026-09-23 at foreman-dell's request).
- Expected SAP behaviour: all four OPTIONS forms are documented AMDP syntax (`SUPPRESS SYNTAX ERRORS`, `DETERMINISTIC` for functions, `CDS SESSION CLIENT` for CDS table functions); the class activates.
- Actual open-abap behaviour: the METHOD statement fails to parse, the method body is read as ABAP statements (more parser errors on `declare`, on a column name), and **`getClassDefinition()` answers `undefined` for the whole class**, so every method of it has no parameters.
- Impact on open-steamgate: measured on the A4H AMDP export, 17 of 181 AMDP classes lose their definition, 12 of them on exactly this clause (`SUPPRESS SYNTAX ERRORS` ×11, `DETERMINISTIC` ×1; the other 5 are GRAPH WORKSPACE and LLANG). Among them the classes of one package whose functions 15 corpus bodies call. The extractor (`tools/amdp-extract.mjs`) then had no signature for any of their methods, and a body's own `:it_configuration` was refused as an unknown table variable.
- Smallest safe workaround: `tools/amdp-extract.mjs` reads the method definitions as text (`definitionsByText`) when abaplint hands back no class definition, and for a single method abaplint dropped from a definition it did read; a section the reader cannot read whole yields no parameters for that method; the coverage instrument cross-checks that reader against abaplint on every class abaplint does read and prints the count of disagreements, so the fallback is measured where it is not the only source. It is gated, not preferred: abaplint resolves what the text reader cannot (types from includes, aliases, inheritance), and a runtime refusal on disagreement would make abaplint's right answer depend on the weaker parser (foreman-dell).
- The same clause in the **definition** has the same effect on that one method: `METHODS m AMDP OPTIONS READ-ONLY IMPORTING VALUE(iv) TYPE i EXPORTING VALUE(ev) TYPE i.` is a parser error, the class definition survives without `m`, and `m` has no parameters (two documentation demo classes and a family of compiler fixtures: 10 methods on the export, found by the cross-check below). `METHODS: a …, b ….` chains are fine.
- Upstream issue: **needs an issue** in `abaplint/abaplint` (the statement grammars `MethodImplementation` / `BY DATABASE` and `MethodDef` / `AMDP OPTIONS`); not yet filed — goes out through the critic gate. `oisee` has no push rights there, so it is a fork PR or an issue.
- Regression-test location: `test/sqlscript-table-function.mjs` ("method definitions read as text …" and "is what extract() falls back to …" — the second one carries the reproducer's shape and must start passing through abaplint, with the fallback no longer firing, once the grammar knows the clause)
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-23-amdp-scalar-optional — our compiler and abaplint accept OPTIONAL on an AMDP scalar input, which the kernel refuses

- Status: `workaround`
- Discovery date: `2026-09-23`
- Affected versions: `@abaplint/core` 2.120.55; `tools/sqlscript-to-procedure-ir.mjs` before this entry
- Affected ABAP statement, runtime API or adapter: `CLASS-METHODS m IMPORTING VALUE(iv) TYPE <scalar> OPTIONAL …` on an AMDP method (`BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT`)
- Minimal ABAP reproducer:
  ```abap
  CLASS zcl_opt DEFINITION PUBLIC FINAL CREATE PUBLIC.
    PUBLIC SECTION.
      INTERFACES if_amdp_marker_hdb.
      TYPES: BEGIN OF ty_seen, n TYPE i, END OF ty_seen,
             tt_seen TYPE STANDARD TABLE OF ty_seen WITH EMPTY KEY.
      CLASS-METHODS m IMPORTING VALUE(iv) TYPE i OPTIONAL EXPORTING VALUE(et) TYPE tt_seen.
  ENDCLASS.
  CLASS zcl_opt IMPLEMENTATION.
    METHOD m BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
      et = SELECT :iv AS n FROM dummy;
    ENDMETHOD.
  ENDCLASS.
  ```
- Exact command used to run it: on A4H, saving the class through ADT; in abaplint, `new Registry(Config.getDefault(v757|v758|Cloud))`, `addFile`, `parse()`, `findIssues()`.
- Expected SAP behaviour (measured on A4H, throwaway class, deleted): the class does not compile -- `Use DEFAULT instead of OPTIONAL for the optional parameter "IV" of the AMDP method "M".` -- for `i` and `string` alike. On a **table** input `OPTIONAL` compiles, and an omitted table arrives in the body as an empty table (`COUNT(*)` = 0; a passed two-row table counts 2). Every OPTIONAL in the A4H AMDP export is on a table input.
- Actual open-abap behaviour: abaplint reports no issue under `v757`, `v758` or `Cloud`. Our compiler accepted the scalar OPTIONAL and bound an omitted input as ABAP's initial value -- a case the kernel never lets happen -- and a clean-room fixture of ours was written that way.
- Impact on open-steamgate: none on the measured corpus (no scalar OPTIONAL there); a hand-written AMDP class would have run here and failed to activate on a system.
- Smallest safe workaround: the compiler refuses a scalar OPTIONAL in the kernel's words and a table OPTIONAL by name ("omitted it is an empty table (measured on A4H); not carried yet"); the fixture and the tests that leaned on the omission use `DEFAULT` or pass the initial value.
- Upstream issue: **needs an issue** in `abaplint/abaplint` (a syntax check for OPTIONAL on an AMDP method's scalar parameter); not yet filed -- goes out through the critic gate.
- Upstream version containing a fix: none yet (the workaround lives in our compiler; abaplint has no check to fix)
- Regression-test location: `test/sqlscript-procedure-scope.mjs` ("OPTIONAL on a scalar is refused in the kernel's words …"), `test/sqlscript-procedure-source.mjs`, `test/amdp-cleanroom-corpus.mjs`

### ANOMALY-2026-09-23-epoch-ms-overflow — `ZCL_STG_JSON=>EPOCH_MS` overflows `i` on a system, and the transpiler runtime lets it through

- Status: `fixed in OSG` (EPOCH_MS computes in p); the transpiler runtime's missing range check is still open
- Discovery date: `2026-09-23`
- Affected versions: `@abaplint/transpiler` 2.13.89 (npm) runtime; OSG's own `src/gateway/zcl_stg_json.clas.abap`
- Affected ABAP statement, runtime API or adapter: an arithmetic expression of `i` operands embedded in a string template, `rv_ms = |{ ( lv_days * 86400 + lv_seconds ) * 1000 }|` in `EPOCH_MS`, which every `Edm.DateTime` of a JSON answer goes through
- Minimal ABAP reproducer: `DATA li TYPE i VALUE 20713. DATA lv TYPE string. lv = |{ ( li * 86400 + 0 ) * 1000 }|.`
- Exact command used to run it: A4H, a throwaway ABAP Unit probe in `$ZOSG_TMP_0160` (deleted after); here, `node tools/gogen/semantics.mjs` (ZCL_GOGEN_T_RQDATE, part `d`) and `node tools/gogen/gateway.mjs '/sap/opu/odata/sap/ZSTG_DEMO_SRV/BookingSet?$format=json'`
- Expected SAP behaviour: measured on A4H: `CX_SY_ARITHMETIC_OVERFLOW`. The calculation type of the embedded expression is `i` (its operands' type; a template gives it no wider target), and 20713 * 86400 * 1000 is outside `i` for any date after 1970-01-25. The same probe measured that a `d` operand counts as `i` too: `( d / 7 ) * 7` into `i` rounds in between
- Actual open-abap behaviour: OSG answers `BookingSet` with `"FlightDate":"\/Date(1789430400000)\/"`; the JS runtime computes the product without the `i` range check
- Impact on open-steamgate: every entity with a date (`BookingSet`, `TravelSet('T0001')/to_Bookings`) answers here and would dump on a system; the Go backend of `tools/gogen` computes in `i` as A4H does and stops with the same exception
- Smallest safe workaround: not a workaround but the fix: `EPOCH_MS` computes the milliseconds in `p LENGTH 16`. Measured on A4H with the fixed method ($ZOSG_TMP_0021, deleted): 2026-09-15 is 1789430400000 (the value OSG answered before, so no answer changes), 1969-12-31 23:59:59 is -1000, 9999-12-31 23:59:59 is 253402300799000
- Upstream: the range check is the transpiler runtime's (**needs an issue** once reduced to the runtime alone); the `EPOCH_MS` fix is ours
- Regression-test location: `tools/gogen/semantics.mjs` on branch spike/go-backend, ZCL_GOGEN_T_RQDATE (`dOVF`); the Go backend computes `i` as A4H does and stopped at this method
- Upstream version containing a fix: none yet

### ANOMALY-2026-09-24-amdp-execution-failed-class — a data error in a portable AMDP run reaches ABAP as `CX_SY_DYN_CALL_ILLEGAL_FUNC`, where a system raises `CX_AMDP_EXECUTION_FAILED`

- Status: `open`
- Discovery date: `2026-09-24` (foreman-dell's critic on #44)
- Affected versions: `tools/amdp-destination.mjs` since the portable route; open-abap-core has no `CX_AMDP_EXECUTION_FAILED`
- Affected ABAP statement, runtime API or adapter: a call of an AMDP method that the portable runtime answers, inside `TRY. ... CATCH cx_amdp_execution_failed. ... ENDTRY.`
- Minimal ABAP reproducer: an AMDP procedure with `DECLARE a NVARCHAR(3) = 'abcdef';` (or an INT2 out of range, or `SELECT ... INTO` of two rows), called inside `CATCH cx_amdp_execution_failed`.
- Expected SAP behaviour (measured on A4H for the three cases, 2026-09-23): the call raises `CX_AMDP_EXECUTION_FAILED`, which the CATCH takes.
- Actual open-abap behaviour: the runtime raises `ScalarTooLong` / `Int2OutOfRange` / `SelectIntoRows`, and the destination hands every failure to ABAP as `CX_SY_DYN_CALL_ILLEGAL_FUNC`, so that CATCH does not take it and the program dumps where it would have recovered.
- Impact on open-steamgate: none on the measured corpus yet (no body catches it in a path we run); a program that recovers from a data error behaves differently here.
- Smallest safe workaround: none yet. The fix is to raise `CX_AMDP_EXECUTION_FAILED` for a data error the kernel raises, and to keep `CX_SY_DYN_CALL_ILLEGAL_FUNC` for "cannot be run here" (no engine, no procedure, a refusal).
- Upstream issue: the class is missing from open-abap-core -- **needs an issue** there (or a PR from the fork, per the branch-not-fork exception); not yet filed, goes out through the critic gate.
- Upstream version containing a fix: none yet
- Regression-test location: none yet

### NOTE-2026-09-24-view-client-node-vs-go — a CDS SQL view carries MANDT, and only the Go backend filters by it

- Status: `known`
- Discovery date: `2026-09-24` (critic on #45)
- Affected versions: `tools/cds2ddic.mjs` since #45
- Affected ABAP statement, runtime API or adapter: `SELECT ... FROM <cds sql view>` in the generated `zcl_stg_cds_*` sources, and every OData read over them
- Expected SAP behaviour: a CDS SQL view over a client-dependent table has the client as its first key field, and Open SQL reads only the logon client's rows through it (implicit client handling); the CDS entity itself exposes no client.
- Actual open-abap behaviour: the generated SQL view now carries MANDT (the CDS twin does not), but the transpiled Open SQL adds no client condition (no implicit MANDT, the known anomaly), so the Node runtime reads every client's rows through the view, while the Go backend filters by the column. The same request can answer different rows on the two when the data holds more than one client.
- Impact on open-steamgate: none on the seed data, which holds one client; a capture seeded with a second client's rows would show them on Node.
- Smallest safe workaround: seed one client per database; the fix is implicit client handling in the transpiled Open SQL.
- Upstream issue: part of the implicit-MANDT anomaly; no separate issue.
- Upstream version containing a fix: none yet
- Regression-test location: `test/cds-client.mjs` (the column itself)

### NOTE-2026-09-24-order-beyond-bmp — the sort order of text outside the Basic Multilingual Plane is not measured

- Status: `known`
- Discovery date: `2026-09-24` (critic on #53)
- Affected versions: every ORDER BY the portable lowering writes over text
- Affected ABAP statement, runtime API or adapter: an AMDP body sorting NVARCHAR values that hold characters outside the BMP (emoji and the like)
- Expected SAP behaviour: not measured. HANA stores Unicode as CESU-8 / UTF-16, where a character outside the BMP is a surrogate pair and may sort before U+E000..U+FFFF.
- Actual open-abap behaviour: SQLite and DuckDB compare UTF-8 bytes, which puts U+FF21 before U+1F600; HANA may put them the other way round.
- Impact on open-steamgate: a FOR loop over such a cursor would visit rows in a different order; the scalar runtime already refuses a non-BMP character in a text variable, so the case reaches only an ORDER BY over table data.
- Smallest safe workaround: none needed on the corpus; measure before relying on it.
- Upstream issue: none (ours)
- Upstream version containing a fix: none yet
- Regression-test location: none yet

### ANOMALY-2026-09-24-amdp-body-brace — one `}` or `|` in an AMDP body hides its ENDMETHOD from abaplint, and the next method is lost

- Status: `open`
- Discovery date: `2026-09-24`
- Affected versions: `@abaplint/core` 2.120.55 (as installed) and 2.120.59 (the latest on npm, checked the same day)
- Affected ABAP statement, runtime API or adapter: the body of `METHOD … BY DATABASE PROCEDURE|FUNCTION …` (and `EXEC SQL … ENDEXEC`), lexed by abaplint as ABAP. A `}` or a `|` outside an ABAP string -- in a SQLScript `--` or `/* */` comment too -- starts a string template in the lexer's normal mode, and a newline does not end it: each following line is one token until the next `|` or `{`, so `ENDMETHOD.` is not a statement and the next `METHOD … BY DATABASE …` is not one either. `)`, `]`, a lone `{` and `'}'` in a string do not do it (foreman-dell's critic read the lexer and measured the variants).
- Minimal reproducer (clean-room):
  ```abap
  CLASS zcl_r DEFINITION PUBLIC.
    PUBLIC SECTION.
      INTERFACES if_amdp_marker_hdb.
      CLASS-METHODS a.
      CLASS-METHODS b.
  ENDCLASS.
  CLASS zcl_r IMPLEMENTATION.
    METHOD a BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT.
      declare x integer;
      x = 1; -- closing }
    ENDMETHOD.
    METHOD b BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT.
      declare y integer;
    ENDMETHOD.
  ENDCLASS.
  ```
- Exact command used to run it: `new abaplint.Registry().addFile(new MemoryFile("zcl_r.clas.abap", src)).parse()`, then the statement kinds of the file: `ClassDefinition Public InterfaceDef MethodDef MethodDef EndClass ClassImplementation MethodImplementation NativeSQL` -- no `EndMethod`, no second `MethodImplementation`. With `-- closing )` in place of `-- closing }`: `… MethodImplementation NativeSQL EndMethod MethodImplementation NativeSQL EndMethod EndClass`.
- Expected SAP behaviour: the body is SQLScript and the kernel ends it at `ENDMETHOD.`; both methods exist.
- Actual open-abap behaviour: abaplint reports one method whose body runs to the end of the next one.
- Impact on open-steamgate: `tools/amdp-extract.mjs` cut bodies between abaplint's `MethodImplementation` and `EndMethod`, so on the A4H export **64 database methods were lost** (452 found, 516 there; 56 of them SQLScript), and 5 bodies came out merged with the method after them -- which the corpus oracle then counted as HXE refusing them ("incorrect syntax near <the next method's name>").
- Smallest safe workaround: the extractor now finds the database methods in the text -- from `METHOD m BY DATABASE …` to the last `ENDMETHOD` (pragmas allowed) before the next `METHOD` or `ENDCLASS` -- in copies with the ABAP comment lines blanked offset for offset (and `"` comments where the header is looked for; a `*` line inside a USING list is not a table, a header in a comment is none), and cuts the body from the source itself. Checked once, by hand, on this machine against the export under `.local` (not tracked, so not reproducible from the repository) and on every class of this tree: of the 452 methods the old cut found, all but the 5 merged ones came out with the same name, kind, USING list and body hash; foreman-dell's critic repeated the comparison on the tree's own AMDP classes (19 of 19 the same).
- Upstream issue: [abaplint/abaplint#4329](https://github.com/abaplint/abaplint/issues/4329) (filed 2026-09-24 after foreman-dell's critic pass), related #3486 and #4307
- Regression-test location: `test/amdp.mjs` ("the database methods are cut out of the text, not out of abaplint's statements")
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-24-raw-columns — a RAW(n) column holds what was written, of any length, in the transpiler runtime; a system holds n bytes and checks the length of a compared value

- Status: `workaround`
- Discovery date: `2026-09-24`
- Affected versions: `@abaplint/transpiler` 2.13.89 (`DatabaseSetup`: RAW(n) is `NCHAR(2n)` hex text, RAWSTRING `TEXT`) and `@abaplint/runtime` 2.13.89; OSG's `test/seed.mjs` wrote abapGit's hex as it stood until 2026-09-24 and now pads a RAW to its 2n upper-case digits
- Affected ABAP statement, runtime API or adapter: `SELECT` / `UPDATE ... SET` / `INSERT` on a RAW column, a RAW column in `WHERE` (static and dynamic); in OSG `packs/zvdb` (`ZVDB_100_VEC-QBITS RAW(192)`, seeded with 96 bytes for the 768-bit vectors)
- Minimal ABAP reproducer: [zcl_gogen_t_rawrd](https://github.com/oisee/open-steamgate/blob/spike/go-backend/tools/gogen/testdata/zcl_gogen_t_rawrd.clas.abap), `_rawsel`, `_rawstr`, `_rawdyn` over `zgogen_t_raw.tabl.xml` (on the branch `spike/go-backend`) (MANDT, ID CHAR4, R RAW4)
- Exact command used to run it: A4H ABAP Unit probes of the same classes (`$ZOSG_TMP_0300`, deleted); Node: the classes transpiled with open-abap-core and run over `@abaplint/database-sqlite` (`.local/ultra-wip/zvdb-tp`); Go: `node tools/gogen/semantics.mjs`
- Expected SAP behaviour (A4H): a RAW(4) written as x'12000000' reads back into an xstring as four bytes, an initial one as four 00 bytes; `SET r = x'12'` gives 12000000 and `SET r = x'1200000000'` 12000000 (00-padded, cut), a string is moved by the c -> x rule (`12ab` gives 12000000); `WHERE r = @xs` with an xstring of another length than 4 (empty too) raises CX_SY_OPEN_SQL_DATA_ERROR, an x of another length does not activate; a literal against R, static or in `WHERE (cond)`, must be exactly 8 upper-case hex digits, anything else CX_SY_OPEN_SQL_DATA_ERROR; `<` and `ORDER BY` are byte order
- Actual open-abap behaviour: `set1:1/1=12` (one byte stored), `set5:5=1200000000` (five bytes in a RAW(4)), `[12ab]=12`, `[1234567890AB]=1234567890AB`; `eqs1:` / `gts1:A B D` / `[r = '12']:` answer rows or none where a system raises; a seeded 96-byte value of a RAW(192) reads back as 96 bytes into an xstring. (The same runs also show CHAR read into a string keeping its trailing blanks, `new:0/[A   ]`, where A4H gives `[A]`.)
- Impact on open-steamgate: the zvdb pack reads and writes QBITS only through `x LENGTH 192` fields and validates the hex first, so its answers are the same on both hosts (checked request by request); a program that reads a RAW column into an xstring, compares one with an xstring or writes a shorter value sees other bytes than on a system
- Smallest safe workaround: the portable IR binds and compares a RAW as HANA does (`tools/ir-osql-where.mjs`, `tools/ir-writes.mjs`, the RAW pairs in `test/fixtures/ir-pairs/`), and `test/seed.mjs` pads seeded RAW values; the Go backend keeps the store as HANA does (`go/abap/dbraw.go`, `dbstore.go` pads seeded RAW values to 2n upper-case digits at open), binds every value at n bytes and raises where A4H raises
- Upstream: [abaplint/transpiler#1896](https://github.com/abaplint/transpiler/issues/1896), filed 2026-09-24; no fix offered
- Regression-test location: `test/ir-osql-where.mjs`, `test/ir-writes.mjs` (the RAW cases); on `spike/go-backend` `tools/gogen/semantics.mjs` ZCL_GOGEN_T_RAWRD, _RAWSEL, _RAWSTR, _RAWDYN
- Upstream version containing a fix: none yet

### ANOMALY-2026-09-24-c-to-x — a character value moved into an x keeps the characters after a non-hex one in the transpiler runtime

- Status: `reported` (transpiler#1857, fix offered in PR #1895)
- Discovery date: `2026-09-24`
- Affected versions: `@abaplint/runtime` 2.13.89 (`Hex.set` of a character value takes it as it stands and pads with 0)
- Affected ABAP statement, runtime API or adapter: `x = string`, `x = c` (and `UPDATE ... SET raw = string`, ANOMALY-2026-09-24-raw-columns)
- Minimal ABAP reproducer: [zcl_gogen_t_xconv](https://github.com/oisee/open-steamgate/blob/spike/go-backend/tools/gogen/testdata/zcl_gogen_t_xconv.clas.abap) (on the branch `spike/go-backend`)
- Exact command used to run it: A4H ABAP Unit probe of the same class (`$ZOSG_TMP_0300`, deleted); Node as in the entry above
- Expected SAP behaviour (A4H): the longest prefix of upper-case hex digits, an odd count padded with 0, then cut or 00-padded: `ABG1` gives AB000000, `AB CD` AB000000, `0a1B` 00000000, a c(6) `AB` AB000000; into an xstring the same prefix (`ABG1` is one byte AB)
- Actual open-abap behaviour: into x LENGTH 4, `ABG10000`, `AB CD000`, `0a1B0000` and `AB    00` (the blanks of the c kept), none of them hex; into an xstring the same as A4H
- Impact on open-steamgate: none seen; the zvdb DPC upper-cases and validates VectorHex before the move
- Smallest safe workaround: the IR writes a RAW by the A4H rule (`tools/ir-writes.mjs` bindValue); the Go backend has it too (`go/abap/conv.go` CToX)
- Upstream: [abaplint/transpiler#1857](https://github.com/abaplint/transpiler/issues/1857) (a related, older issue about conversion type c; the measured table is in a comment of 2026-09-24), fix offered as [PR #1895](https://github.com/abaplint/transpiler/pull/1895)
- Regression-test location: `test/ir-writes.mjs` ("binds a RAW as its upper-case hex"); on `spike/go-backend` `tools/gogen/semantics.mjs` ZCL_GOGEN_T_XCONV
- Upstream version containing a fix: none yet
