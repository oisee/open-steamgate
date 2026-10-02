# data-preview

- Recommendation: **port-to-abap**
- Effort: L
- Owner: dell
- Depends on: front-up (slice 3: ABAP front resolves session + CSRF; until then POSTs pass Node's CSRF gate first, which is fine), B8 (ZCL_OSD_ADT_DDIC=>TABLE_FIELDS, the ABAP tableFieldsOf) for C4b, or carried by C4b if B8 slips, PARSE command with kind DDLS (port-map section 3); first introduced by C4b if no other slice has, C1 checkruns, optionally: share ZCL_OSD_ADT_CHECKREPORT; C4a can ship a minimal one first

## Routes

### GET `/sap/bc/adt/datapreview/ddic/:name/metadata` (adt-facade.mjs ~2881)

Wrapped in answered(): store.read('TABL', name) and then tableFieldsOf(store, entry) (adt-documents.mjs:909). tableFieldsOf parses DD02V/DD03P out of the abapGit XML and resolves a ROLLNAME through osd-type-graph resolveType (DTEL, then DOMA). It SKIPS rows whose FIELDNAME starts with '.', so .INCLUDE/.APPEND fields are missing, and a port must keep that. letter = ABAP_TYPE_LETTER[dataType] || INTTYPE || 'C'. Answer: 200, 'application/vnd.sap.adt.datapreview.table.v1+xml; charset=utf-8', tableDataDocument({rows:[], columns: field names}, {fields, name: entry.name (the store's spelling), maxRowsLink:true}). The body has the atom:link maxrows, an empty executedQueryString, queryExecutionTime 0, and every column has an empty dataSet ('<dataPreview:dataSet>\n\n    </dataPreview:dataSet>'). There is a blank line after </dataPreview:name> because the cdsEntityName slot is empty. ETag is Express's automatic weak tag from res.send. A missing table is the store's NotFound: 404 ExceptionResourceNotFound 'TABL <name> does not exist', and the miss is recorded as 'object' in facade.missed, which an ABAP route cannot reach yet. Any other throw is 500 ExceptionInternalError in ns org.open-steamgate.osd. HEAD is served by Express's GET route.

### POST `/sap/bc/adt/datapreview/ddic` (adt-facade.mjs ~2890)

name = String(query.ddicEntityName ?? '').toUpperCase(). Body = rawBody, UTF-8, .trim() (JS trim, which also strips Unicode whitespace and BOM). Fields: tableFieldsOf(store.read('TABL', name)). On ANY throw it falls back to cdsEntityOf(store, name), because the raw-data page uses the ddic relation for CDS too. If neither exists: 404 ExceptionResourceNotFound 'TABL or DDLS <NAME> does not exist'. query = body or 'SELECT * FROM <NAME>'. data.query(query, {max: Number(query.rowNumber ?? 100)}) runs tools/osd-data.mjs Data.query, which does the following: openSqlToSql rewrites a comma-less field list and turns UP TO n ROWS into LIMIT n; anything that is not a SELECT is refused with NotAllowed; ' LIMIT <max>' is appended unless a LIMIT is already present; client.select runs it; the rows are sliced to max; string cells are trimEnd'ed. 200 answers 'application/vnd.sap.adt.datapreview.table.v1+xml; charset=utf-8' with tableDataDocument(result, {ms: Date.now()-started, fields: table.fields, name: NAME}). It has no cdsEntityName even on the CDS fallback, and no maxRows link. A failure answers 400 ExceptionResourceWrongData, or 503 ExceptionResourceNoAccess for NOT_BUILT, with message String(e.message || e.cause?.message || e.code || 'the statement was refused: <query>'), content type 'application/xml; charset=utf-8'. Columns are Object.keys(rows[0]), so a zero-row answer has NO columns even when the fields are known. The CSRF gate is Node's until slice 3.

### GET `/sap/bc/adt/datapreview/cds/:name/metadata` (adt-facade.mjs ~2926)

cdsEntityOf(store, name) (tools/adt-cds.mjs) takes the abaplint registry object DDLS <NAME>, by object name only and NOT by entity alias. It walks the parse tree for CDSElement / CDSAs pairs: an association ('_x') and an expression are skipped, camelCaseName is the alias as written, and key comes from parsed.fields. When exactly one source exists it joins the base with tableFieldsOf of TABL, else VIEW. A VIEW's XML has no DD03P, so the map comes back empty. Defaults: dataType '', length 0, letter 'C', description falls back to camelCaseName. Undefined gives 404 ExceptionResourceNotFound 'DDLS <NAME> does not exist'. 200 answers 'application/vnd.sap.adt.datapreview.table.v1+xml; charset=utf-8' with tableDataDocument({rows:[], columns}, {fields, name: entity.name, cdsEntityName: entity.name, maxRowsLink:true}), with no cdsCamelCaseName on this route. Each metadata element carries camelCaseName as its first attribute.

### POST `/sap/bc/adt/datapreview/cds` (adt-facade.mjs ~2938)

name = upper(query.ddlSourceName ?? ''). cdsEntityOf runs, and undefined gives 404 'DDLS <NAME> does not exist'; this check comes BEFORE the body is read. The body is trimmed, or 'SELECT * FROM <entity.name>' is used. data.query is the same as on the ddic POST. 200 answers 'application/vnd.sap.adt.datapreview.table.v1+xml; charset=utf-8' with tableDataDocument(result, {ms, fields, name, cdsEntityName: name, cdsCamelCaseName: name}). Refusals and their message formula are the same as on the ddic POST.

### POST `/sap/bc/adt/datapreview/freestyle` (adt-facade.mjs ~2961)

Body raw UTF-8, NOT trimmed here; Data.query trims it later. When query.action === 'checkSyntax' (case-sensitive): uri = String(query.uniqueURI ?? '/sap/bc/adt/datapreview/freestyle/sqlconsole0'), and data.check(query) prepares without executing (client.checkSelect, sql.js prepare, else CHECK_UNAVAILABLE). The answer is ALWAYS 200 'application/vnd.sap.adt.checkmessages+xml; charset=utf-8' with checkReportDocument and omitEmptyList. A clean check is a self-closed checkReport with status processed and statusText 'processed'. A code of NOT_BUILT, NOT_SERVING or CHECK_UNAVAILABLE gives status 'notProcessed' with the message as statusText and no list. Any other error gives one E message, '#start=1,1', statusText '1 error(s)', with message String(e.message || e.cause?.message || e.code || 'SQL syntax check failed'). Without checkSyntax, data.query runs with max Number(rowNumber ?? 100). 200 answers 'application/xml; charset=utf-8' (Express adds the charset) with tableDataDocument(result, {ms}) and no name element, so totalRows is followed by a bare blank line; columns are guessed (type from the JS typeof of the first non-null cell, I/X/C; description = UPPER(name); no length attribute). Errors give 400 ExceptionResourceWrongData, or 503 NoAccess for NOT_BUILT. The message here is String(e?.message ?? e), a DIFFERENT formula from the ddic/cds POSTs. An empty body gives NotAllowed 'only SELECT is allowed here, not ' (400).

## Host dependencies

- READ (exists): TABL <name> for its abapGit XML, then DTEL and DOMA for the resolveType chain. The ABAP table_fields() port uses only READ, so no new command is needed for the ddic metadata. The NotFound text 'TABL <name> does not exist' is rebuilt in ABAP from READ's EV_ERROR / not-found state.
- OBJECT (exists): optional cheap existence check before READ. It is not needed if READ's not-found answer is distinguishable.
- NEW command PARSE with IV_TYPE = 'DDLS' and IV_NAME = the entity, answering EV_JSON = {found, name, sqlView, description, sources:[...], elements:[{name, camelCaseName, base, key}]}. It is the abaplint half of cdsEntityOf: registry.getObject('DDLS', NAME) by object name, the same lookup as today. The base-table join stays in ABAP over table_fields(). Port-map section 3 already plans PARSE with the kind DDLS; this family is its first user. Refactor adt-cds.mjs into elementsOf/entityHeadOf, export both, and let the Node cdsEntityOf call them too so the two cannot drift.
- NEW command SQL (query). IV_SOURCE = the statement as ABAP decided it (trim or fallback already applied: see the design). IV_LIMIT = the rowNumber text: '100' when the parameter is absent, the single value as given, several occurrences joined by ',' (what String(array) gives, so Number() answers NaN exactly as Express+qs does today). It answers EV_JSON = {sql, columns:[{name, letter}], cells:[[string,...] per column]}, plus EV_MS (an existing parameter) = Date.now()-started measured around the query. EV_ERROR is set on refusal, with EV_JSON = {code, message: String(e.message||e.cause?.message||e.code||''), raw: String(e?.message ?? e)}, so that ABAP can apply each route's own message formula. The rendering (String(v), hex upper for bytes, '' for null) and the I/X/C guess are done host-side, by the SAME function the Node tableDataDocument uses: move render() and type() out of adt-facade.mjs into a shared module (e.g. tools/adt-datapreview-cells.mjs) and use it in both places.
- NEW command SQLCHECK: IV_SOURCE = the statement, answering EV_JSON {ok:true} or EV_ERROR + EV_JSON {code, message}. It is named in port-map section 3 and wraps Data.check.
- CRITICAL host detail for both SQL commands: they must run on the RAW step connection, globalThis.abap.context.databaseConnections.DEFAULT, through new Data({client: raw}). They must NOT go through the facade's `data`. In inline mode that object is new Data({client: lockedClient(...)}) (test/start.mjs:194), and lockedClient calls exclusive(), which inside the ADT dialog step throws 'a nested dialog step (the ADT facade's data preview)'. In child mode `data` goes through the /osd/sql door, which waits on exclusive() in the child. The ABAP front runs only inline today, so the command binds to the raw client of the process it runs in.
- CAPABILITIES (extend): add SQL, SQLCHECK and PARSE to the list so a host that lacks them (OSGo, the binary) is detectable. The route rows still exist, and on such a host the route answers 501 or 500 rather than being hidden: decide with the slice-3 front.
- No SYSTEM kind is needed. No second destination: the webgui ST05 screen's DESTINATION 'SQLTRACE' is not to be copied.

## Rationale

All five routes are request-in, document-out, with no generation swap and no long wait beyond the query itself. They can be served by ABAP rows inside the step, and no continuation is needed, because nothing has to happen after the answer. Today the SQL runs in Node: in inline mode tools/osd-data.mjs Data.query calls client.select on the shared DEFAULT connection through lockedClient (one exclusive step per call), and in child mode it goes through POST /osd/sql in tools/osd-serve.mjs, also exclusive(). Moving it inside the ADT step costs no FIFO time that it does not already take.

What runs the SQL in ABAP: NOT ADBC. port-map section 3 says 'Running SQL is native: ADBC cl_sql_statement is in open-abap-core', and that is wrong for this use. In open-abap-core 8b397be, cl_sql_statement->execute_query works, but cl_sql_result_set->next() copies only Object.values(current)[0] (the first column) into a set_param scalar, and get_metadata, set_param_table, set_param_struct, get_struct_ref and next_package are all ASSERT 1 = 'todo'. Even with those filled in, byte-equality needs two things ADBC cannot give: the JS typeof-based I/X/C guess and the JS String(number) rendering. Native dynamic Open SQL cannot take arbitrary freestyle text either. And the dialect rewrite (openSqlToSql: the comma-less 7.x field list, UP TO -> LIMIT, the appended LIMIT) is backend-specific and uses lazy regexes that 7.02 POSIX REGEX lacks.

So the split is this. The host executes and renders cells through two new STORE commands, SQL and SQLCHECK, the 'DatabaseClient seam' that port-map already names for SQLCHECK. ABAP owns everything else:
- route matching and query-parameter semantics;
- name resolution (TABL via READ, DDLS via the new PARSE DDLS);
- tableFieldsOf ported to ABAP over READ, shared with B8;
- the base-table join of cdsEntityOf;
- the default statement and trimming;
- the refusal mapping (ZCX_OSD_ADT);
- the tableData and checkReport documents, byte for byte.

On a real system the SQL and SQLCHECK commands would be replaced by a native implementation behind the same ABAP interface. That is ADBC over Open SQL, or SAP's own freestyle classes, and it is out of scope here. This keeps the host to the one thing that is genuinely the host's: the database dialect and the JS value model of the rows.

## ABAP design

The route classes:
- ZCL_OSD_ADT_PREVIEW serves the 4 ddic/cds rows, with a branch on path and method.
- ZCL_OSD_ADT_FREESTYLE serves POST freestyle, with a branch on action = 'checkSyntax', compared case-sensitively.
- ZCL_OSD_ADT_TABLEDATA renders the document as a pure function. Its input is name/cds_entity/cds_camel (each with a 'given' flag), max_rows_link, sql, ms, fields[] and columns[{name, letter, cells[]}]. It reproduces every byte of tableDataDocument: the blank line after name or totalRows from the empty cds slot; the description fallbacks f.description||f.name and UPPER(name) for an unknown column; keyAttribute 'true'/'false'; length as an integer; camelCaseName first when present; caseSensitive="false" only on known fields; an empty dataSet as '\n\n    '; '\n\n' before </dataPreview:tableData> when there are no columns; the trailing LF.
- ZCL_OSD_ADT_CHECKREPORT is a minimal checkRunReports renderer with omitEmptyList. Share it with the checkruns slice (C1) if that lands first.
- ZCL_OSD_ADT_DDIC=>TABLE_FIELDS( name ) is the ABAP tableFieldsOf over READ TABL / DTEL / DOMA. It is B8's to own; if B8 has not landed, it lands here and B8 reuses it. It must keep the '.'-row skip and the ABAP_TYPE_LETTER table, which moves with it as a constant table.

ZCL_OSD_ADT_HOST gains three methods:
- sql( iv_statement, iv_limit_text ) RETURNING ty_sql_result {sql, ms, columns}. It parses EV_JSON with zcl_ajson and RAISES zcx_osd_adt carrying the code and both message forms.
- sql_check( iv_statement ).
- parse_ddls( iv_name ) RETURNING ty_ddls.

ZCX_OSD_ADT gains the factories wrong_data (400 ExceptionResourceWrongData) and no_access( status ) (503 ExceptionResourceNoAccess, kept for parity although NOT_BUILT cannot occur inside a running step).

Router rows, written by hand and placed before the HOST catch-all. They are not per type:
- GET /sap/bc/adt/datapreview/ddic/:name/metadata, ZCL_OSD_ADT_PREVIEW
- POST /sap/bc/adt/datapreview/ddic, ZCL_OSD_ADT_PREVIEW
- GET /sap/bc/adt/datapreview/cds/:name/metadata, ZCL_OSD_ADT_PREVIEW
- POST /sap/bc/adt/datapreview/cds, ZCL_OSD_ADT_PREVIEW
- POST /sap/bc/adt/datapreview/freestyle, ZCL_OSD_ADT_FREESTYLE

HEAD falls back to GET.

The flow per route:
- The ddic POST does table_fields( upper(ddicEntityName) ). On any not-found or other failure it falls to parse_ddls plus the join, then to 404 'TABL or DDLS <N> does not exist'.
- The statement is the body as UTF-8 with JS-trim semantics, or 'SELECT * FROM <N>'. Either do JS trim in ABAP over the full Unicode whitespace set including U+FEFF and NBSP (U+00A0), with ASCII source via hex constants, or, simpler and safer, pass IV_FILTER='TRIM' and the fallback in IV_NAME and let the host apply asked.trim()===''?fallback:trimmed. Pick the host variant and say so in the code.
- On a SQL failure the ddic and cds POSTs answer message||cause||code||'the statement was refused: <q>', and freestyle answers the raw String(e?.message ?? e).
- The cds POST checks the entity before it reads the body, and the 404 text is 'DDLS <N>'.
- The rowNumber text goes to the host as described under host_dependencies, so Number() semantics, NaN included, stay byte-equal.
- The checkSyntax uniqueURI uses the default when the parameter is absent; repeated values are joined by ','.

The JSON parse of up to rowNumber x columns cells through zcl_ajson must be measured (see risks).

The order is two slices:
1. C4a: freestyle (SQL + SQLCHECK commands, the shared cell module, ZCL_OSD_ADT_TABLEDATA, ZCL_OSD_ADT_CHECKREPORT, the freestyle row). It covers vsp's and ABAP-FS's 'data.freestyle'.
2. C4b: ddic and cds, metadata and POST (TABLE_FIELDS if B8 has not landed, PARSE DDLS, four rows). It covers ABAP-FS's 'data.table'.

After both, delete the duplicate renderer in web/preview-runtime.mjs only once the preview runs the ABAP front. Today the preview/OSGo claims /sap/bc/adt and has no front, so that copy stays, and note that it already differs (no blank line, different empty-name handling).

## Test plan

Extend test/adt-abap-diff.mjs: two adtRouters over one store and one seeded runtime, ported and Node. Compare status, content-type, content-length, ETag and body. Assert that ABAP answered (marker or step count) for every ported row.

queryExecutionTime is wall-clock on both sides. Use the lock-handle pattern already in the file (:640): assert each side's ETag === weakTag(its own raw body), then replace '<dataPreview:queryExecutionTime>\d+<' with a fixed value, and compare the normalised bodies and normalised lengths. Metadata GETs and checkSyntax are deterministic and are compared raw, ETag included.

Cases:
1. GET ddic metadata: a seeded table (ZSTG_FLIGHTFACT), a table whose field resolves via DTEL->DOMA (ZOSD_TEST_ITEM-STATUS CHAR 1), a table with a .INCLUDE row (proves the skip is kept), a lower-case and a %-encoded name, an unknown name (404 text), and HEAD.
2. POST ddic: an empty body (default SELECT), a whitespace-only body, a comma-less 'SELECT A B FROM T', 'SELECT COUNT( * ) FROM T', 'UP TO 5 ROWS', rowNumber absent / 5 / '' / 'abc' / repeated, a zero-row WHERE (no columns at all), a CDS name through ddicEntityName (the fallback, with no cdsEntityName element), a non-SELECT (400 NotAllowed text), a syntax error (400; the message must come from the same client error), an unknown name (404 'TABL or DDLS X does not exist'), an empty ddicEntityName.
3. GET cds metadata: ZC_STG_TRAVEL (camelCaseName attrs), a view with an association (skipped), a view over a join (no base types), and 404.
4. POST cds: the same matrix, plus the 404 before the body.
5. Freestyle: rows with an integer, real, null, string with trailing blanks, RAW/hex and XML-special characters (& < > " in cells and column names); a duplicate column name; an empty body; a DELETE (400 'only SELECT ...'); a syntax error (raw-message formula).
6. checkSyntax: a clean statement (self-closed report), a broken one (one E message '#start=1,1', '1 error(s)'), a non-SELECT, a custom and an absent uniqueURI with XML-special characters, and action=checksyntax in lower case (must run the query, not the check).

Run the whole matrix with STG_DB=duckdb as well, especially the refusal cases: an error inside the step must not poison the step's commit and turn a 400 into a 500.

Store-destination unit tests (test/store-destination.mjs) for SQL / SQLCHECK / PARSE DDLS, including 'not bound to the raw connection'. A red proof: route the command through lockedClient and the inline test must fail with the nested-step error.

ABAP Unit for ZCL_OSD_ADT_TABLEDATA against fixture strings produced by the Node tableDataDocument for the edge cases (no name, cds with and without camel, no columns, empty dataSet, maxRowsLink). This was port-map's 'ABAP Unit for tableDataDocument'.

Red proofs, each mutation taken out once and seen to fail:
- drop the blank line after name;
- emit length on unknown columns;
- trim the freestyle body before the empty check;
- use the ddic message formula for freestyle;
- let '.'-rows through;
- drop the zero-rows-means-no-columns rule.

Gate: test/adt-facade.mjs F8 cases (:548, :1259, :1313, :1326), test/osd-data.mjs, test/vscode-extension.mjs preview consumer, test/zosd-test.mjs and the ABAP-FS conformance entries data.freestyle and data.table must stay PASS. vsp freestyle through adt-devloop (:871, :947).

## Risks

- Deadlock or refusal by nesting. The facade's `data` in inline mode is lockedClient-wrapped (test/start.mjs:194), and in child mode it is the /osd/sql door. Either one used from inside the ADT dialog step throws 'a nested dialog step' (tools/osd-dialog-step.mjs:228). The SQL and SQLCHECK commands must use the raw DEFAULT connection, and a test must pin this.
- port-map section 3 is wrong that ADBC runs the SQL natively. open-abap-core's cl_sql_result_set is a stub for anything beyond the first column (next() reads Object.values(row)[0]; get_metadata, set_param_table and next_package are ASSERT todo). Correct the map, or anyone picking 'native' hits it mid-slice. Completing ADBC upstream needs a fork (no write access to open-abap-core) and still would not give byte-equal cells.
- queryExecutionTime is wall-clock, and the measured interval moves from around data.query in the facade to inside the host command (EV_MS). The values are not comparable, so the diff test normalises them. A body whose ms digit count differs changes content-length and ETag, so the test must check ETag against each side's own body.
- Inside the step on DuckDB (and possibly Postgres/HANA), a failed statement may abort the open transaction. dialogStep's commit could then throw and turn a 400 into a 500 or a dump. Today the read runs in its own exclusive() without a dialog commit. Run the refusal cases on STG_DB=duckdb before switching the rows.
- Long queries now hold the ADT step, on the same FIFO that /osd/sql and lockedClient already hold. There is no regression, but an unbounded aggregate (COUNT over STG_DATA_SCALE=1e6 facts, HANA backend) blocks every OData and ADT request while it runs, so a statement timeout is a later item.
- zcl_ajson parse cost for big previews: rowNumber is client-chosen (Eclipse 'Max Rows Increase'), and 10k rows x 30 cols means 300k JSON nodes in transpiled ABAP. Measure at 100, 1,000 and 10,000 rows. If it is slow, return cells column-major as one EV_SOURCE string with a length-prefixed or escaped encoding, decoded with SPLIT. Do not put XML-escaping in the host: escaping is ABAP's (ZCL_OSD_ADT_XML=>ESC).
- Query-string semantics: the ABAP request gets get_form_fields_cs from express-icf-shim, while Node used qs. They may differ on '+', malformed %, repeated keys and arrays. ddicEntityName, ddlSourceName, rowNumber and uniqueURI (echoed into the check report) need diff cases with '+', '%2B', '%zz' and repeats.
- JS-only semantics to emulate:
- String.prototype.trim covers Unicode whitespace, including U+FEFF and NBSP; put it in the host.
- toUpperCase on non-ASCII column or entity names: 'ß' becomes 'SS' in JS.
- Number() on rowNumber.
- Cell rendering of BigInt and boolean (DuckDB) and of Date objects, where Buffer.from(Date) throws today. The last is an existing Node defect that the shared cell module must reproduce or fix on both sides at once.
- Known Node quirks that the port must keep byte-equal, not fix:
- a zero-row result has no columns, even when the fields are known;
- the ddic POST on a CDS name has no cdsEntityName;
- tableFieldsOf drops .INCLUDE fields;
- the two different refusal-message formulas;
- the blank line in the header.
Fix them later in both places at once.
- Dependency on B8 (tableFieldsOf in ABAP) and on whoever owns PARSE. If B8 slips, C4b carries ZCL_OSD_ADT_DDIC itself, and B8 must reuse it, not write a second one.
- facade.missed: a 404 from the ddic metadata route is recorded as an 'object' miss in Node, and an ABAP 404 is not (skeleton 'not in slice 1'). This is not on the wire, but /osd/not-served loses those entries.
- Preview/OSGo: web/preview-runtime.mjs:101 keeps its own tableData renderer, which already differs from the facade (no blank line, different handling of an empty name). It cannot be deleted until the preview mounts the ABAP front, so it is not part of 'done' for 0.7.
