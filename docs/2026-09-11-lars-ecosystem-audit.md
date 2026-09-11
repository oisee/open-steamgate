# Hand audit of the Lars Hvam / open-abap ecosystem

**Date:** 2026-09-11 · **Method:** shallow-cloned 17 repos into `.local/lars/`
(gitignored), built five of them with `npm install && npm test`, read source,
probed the running OData server with curl. Everything below is
*verified-in-repo* or *verified-by-run* unless marked otherwise. This closes
the Sprint-0 item "clone + hand-audit `open-abap-odata`" from `AGENDA.md` and
supersedes the *claimed* rows about it in `docs/prior-art.md`.

## 1. Build results

| Repo | `npm test` | Notes |
|---|---|---|
| `open-abap/open-abap-odata` | green (3 mocha + 1 ABAP unit) | fetches `open-abap-core` + `express-icf-shim` by URL at transpile time |
| `open-abap/open-abap-core` | green | 433 classes, 255 `ASSERT 1 = 'todo'` in 46 files |
| `open-abap/express-icf-shim` | green (10 mocha) | Express → `if_http_server` bridge, 21 files |
| `larshp/hithub` | green (lint + unit + fixtures + smoke) | git server in ABAP, dual runtime, 256 ABAP files, pushed today |
| `open-abap/open-abap-gui` | unit green, Playwright red (chromium not installed) | SAP GUI in the browser, 1091 files, pushed daily |

Pinned toolchain everywhere: `@abaplint/transpiler-cli` 2.13.83–85,
`@abaplint/database-sqlite` 2.13.83, `@abaplint/cli` 2.120.46–48, Node 22 in CI.
Node 26 works locally.

## 2. The house style (what to copy for Phase 0)

Every runnable repo has the same skeleton. Adopt it verbatim so contributions
flow both ways.

- **`package.json` scripts:** `lint` = `abaplint`; `unit` = `rm -rf output &&
  abap_transpile && node output/index.mjs` (ABAP Unit runs inside the
  transpiled bundle); `test` = `lint && unit && mocha test/mocha.mjs` for HTTP
  integration.
- **`abap_transpile.json`:** `input_folder: "{src,test}"`, `libs: [{url:
  github.com/open-abap/open-abap-core}, {url: .../express-icf-shim}]`,
  `options.setup: {filename: "../test/setup.mjs", preFunction: "setup"}`.
- **`test/setup.mjs`:** creates `SQLiteDatabaseClient`, assigns it to
  `abap.context.databaseConnections.DEFAULT`, executes `schemas.sqlite` then
  `insert`. That is the entire DB bootstrap.
- **`test/start.mjs`:** Express app, `express.raw({type: "*/*"})`, one
  `app.all("/sap/opu/odata/sap/*")` route calling
  `cl_express_icf_shim.run({req, res, class: "/IWFND/CL_SODATA_HTTP_HANDLER"})`.
  The ICF handler is plain `if_http_extension~handle_request`, so the same
  class deploys to a real ICF node unchanged.
- **JS interop from ABAP:** `WRITE '@KERNEL <js>'.` lines (see
  `express-icf-shim/src/cl_express_icf_shim.clas.abap`). This is how headers,
  body and status cross the boundary. No separate JS adapter layer.
- **Dual target:** `steampunk:*` scripts copy `src/` + test classes, run
  `abaplint --rename` to move `/iwbep/` into a Z namespace, then lint with a
  Steampunk profile. Same ABAP, three runtimes (Node, on-prem, Steampunk).
- **Stub convention:** unimplemented methods are `ASSERT 1 = 'todo'.`; base
  class no-ops are bare `RETURN.`. Grep for both when computing coverage.
- **Schema recovery trick** (`hithub/scripts/local-database.mjs`): the
  transpiler writes DDL into `output/init.mjs` as `sqlite.push(\`...\`)` lines;
  grep them back out to open a DB outside the generated `initializeABAP()`.
- **Agent-driven repos** (`hithub`, `open-abap-gui`, abap2UI5 `playground`)
  carry `PLAN.md`…`PLAN8.md`, `ANORMALIES.md` (a transpiler-anomaly ledger
  with a fixed entry template: reproducer, expected SAP vs actual open-abap
  behaviour, workaround, upstream issue, regression test) and
  `SUGGESTIONS.md` (upstream-refactor ledger). Guiding rule written into
  `hithub/PLAN.md`: *"ABAP owns behavior; Node.js only adapts Express requests,
  persistence and process lifecycle."* Hexagonal boundaries, native tools used
  only as test oracles. This is exactly the shape open-steamgate wants.

## 3. What is on his mind (September 2026)

- **`open-abap-gui`** is the active front. Classic SAP GUI in the browser:
  `cl_gui_*`, ALV/SALV (73 SALV classes), Dynpro/selection-screen builders,
  and a workbench with SE01/SE09/SE11/SE16/SE38 as real transactions
  (`scaffold/PLAN8.md`). It is the Dynpro counterpart of what open-steamgate
  does for Gateway/Fiori. Complementary, not competing; a shared "workbench
  shell" later is plausible.
- **`hithub`** (pushed today, "wip"): GitHub-like server in ABAP over
  Smart HTTP, same ABAP on ICF and on Node. Its process docs are the best
  template for how to run an LLM-assisted ABAP/open-abap project.
- **`open-abap-odata`** is dormant. Commit log since 2024 is "add method",
  "update", "more types": it is being kept *compiling*, not made to work. Its
  README states the intent: "OData shims for Node.js and Steampunk", i.e. make
  SEGW-generated classes compile off-platform, not run them.
- **`open-abap-sadl` / `-cds` / `-rap` / `-rest` / `-adt`** are interface
  transcriptions only: sadl = 1 interface (20 lines); cds = 4 DDLS sources, no
  runtime; rap = 540 lines of `if_rap_query_*` / `cl_abap_behv*` with 5 todos;
  rest = 124 lines of `if_rest_*`; adt = 267 lines. **Gap 5 confirmed
  ecosystem-wide: no SADL/CDS/RAP runtime exists.** The v1 = code-based SEGW
  decision stands.
- **License:** `open-abap-odata/LICENSE` still reads `todo` (file last touched
  2025-07-16); `package.json` license is `""`. `open-abap-gui` and
  `express-icf-shim` are `""` / ISC. Core, transpiler, hithub are MIT.

## 4. Verified state of `open-abap-odata`

Source is 2,010 lines across 40 `/iwbep/` interfaces, 6 `if_sadl_gw_*`
interfaces, 21 DDIC objects, 6 `zcl_oao_*` internals, 5 exception classes.

| Piece | State | Evidence |
|---|---|---|
| `/iwfnd/cl_sodata_http_handler` | routes on `iv_path CP '*$metadata'`, everything else → `data()`. No verb, no entity-set parse, no query options | `src/#iwfnd#cl_sodata_http_handler.clas.abap` |
| `zcl_oao_http_handler=>data` | `DATA lo_dpc TYPE REF TO zcl_zsegw_dpc_ext` (the **test** class), entity set `'zsegwSet'` literal, empty filter/paging/order passed in. **The JSON inside `LOOP AT <tab>` is a literal HELLO/WORLD string**; row fields are never read | lines 62–125 |
| `zcl_oao_http_handler=>metadata` | real walk of `model->get_entity_type()->get_properties()`, but `<Key>/<PropertyRef>` hardcoded `Something1`, `<EntitySet>` hardcoded, `sap:label="todo"` | lines 127–176 |
| `zcl_oao_request_context` | 9 of 10 methods `ASSERT 1 = 'todo'`; only `get_entity_set_name` works | 56 lines |
| `zcl_oao_model` | `create_entity_type`, `get_entity_type`, namespace get/set work; `create_association`, `create_association_set`, `create_action` todo | 52 lines |
| `zcl_oao_property` | `set_type_edm_string`, maxlength, key, and the five flags work; 11 setters todo (int16/32, decimal, datetime, time, boolean, byte, precision, conversion exit, content type, disable_conversion) | 100 lines |
| `/iwbep/cl_mgw_push_abs_data` | present; `get_entityset/get_entity/create/update/delete` are bare `RETURN` (so SEGW's `WHEN OTHERS → super->…` silently yields nothing); `execute_action`, `get_expanded_*`, `patch_entity`, `get_dp_facade` todo | 107 lines |
| `/iwbep/cl_mgw_request` | every method `RETURN` | 114 lines |
| `/iwbep/cl_mgw_data_util=>orderby` | `ASSERT 1 = 2` | |
| `/iwbep/cl_mgw_push_abs_model` | constructor creates `zcl_oao_model`; `get_last_modified` todo | |
| DDIC (`s_mgw_select_option`, `t_mgw_name_value_pair`, `s_mgw_paging`, `s_mgw_sorting_order`, `t_mgw_tech_order`, …) | complete for the entity-set signatures | `src/ddic/` |

**Live probe** (server from `node test/run.mjs`): `?$filter=Something1 eq
'HELLO'`, `?$top=1&$skip=0`, `zsegwSet('HELLO')`, `zsegwSet/$count`, the
service root, and a `POST` all return the identical hardcoded payload with
status 200. The mocha "get data" test is a tautology.

**Only open issue, #33 (2026-06-14):** an external user configured the lib and
transpilation crashed with `target variable "lo_dpc" not a object reference`,
because the handler names the test-only `zcl_zsegw_dpc_ext`. The repo cannot be
consumed as a library today.

**Verdict, sharper than prior-art §0:** the value of the repo is the
transcription of ~50 SAP interface signatures and 21 DDIC types plus the SEGW
sample (`test/test1/`, a genuine SEGW-generated MPC/DPC pair with `.iwpr`,
`.iwmo`, `.iwsv`, `.iwsg`, `.sicf` XML). The runtime is a smoke-test stub. The
interfaces are SAP's public contract either way, so the license question only
matters if we want to *copy files*; reimplementing them from the same public
signatures is equivalent work.

## 5. Substrate facts re-verified today

- **Transpiler 2.13.85** (`packages/transpiler/src/statements/select.ts`):
  `SELECT … UNION` compiles to a runtime `throw` ("not supported, todo");
  FOR ALL ENTRIES is handled (line 133); joins, GROUP BY, ORDER BY, UP TO,
  DISTINCT are compiled; `UP TO n ROWS` → `LIMIT n` in the sqlite client.
- **Fixed system fields** in `packages/runtime/src/builtin/sy.ts`: `sy-mandt =
  '123'`, `sy-sysid = 'ABC'`. No MANDT is injected into SQL anywhere.
- **`unknownTypes: "runtimeError"`** (`packages/transpiler/src/types.ts`): a
  transpiler option that compiles code whose types are unresolved and throws
  only when the missing type is touched. **This is the dependency-closure
  tool for Sprint 0**: transpile a real `_DPC_EXT` with it on, run the
  entity-set, and the first throw names the next class to shim.
- **DDIC → SQLite** (`db/schema_generation/sqlite_database_schema.ts`):
  `CREATE TABLE '<name>' (fields…, PRIMARY KEY(keys))`; unsupported field
  types throw `"todo toType handle"`, so every real table type gap surfaces at
  build time.
- **`open-abap-core`** has what the Gateway needs: `if_http_extension`,
  `if_http_server`, `cl_http_entity` (header/cdata/status/form-fields work; 65
  todos are cookies/cache/multipart), `cl_http_utility`, RTTI
  (`cl_abap_structdescr` / `tabledescr` / `typedescr`, 13 todos), `/ui2/cl_json`
  (4 todos), `cl_sxml_string_writer`. Missing: `cl_salv_*`/`cl_gui_*` (live in
  `open-abap-gui`), `cl_abap_syst`, `cl_bali_log`, `cl_web_http_client`.
- **`express-icf-shim`** populates `~request_method`, `~request_uri`,
  `~query_string`, `~path`, `~path_info`, all headers, and form fields via
  `cl_http_utility=>string_to_fields`; body arrives as hex xstring. Sufficient
  for OData v2 GET/POST/PUT/DELETE without changes.
- **abap2UI5 `playground`** (`tools/build-*.mjs`, esbuild + sql.js + pinned
  OpenUI5) is the browser-side harness for a Phase-4 offline PWA; it runs the
  transpiler *in the page*. Not needed before Phase 4.

## 6. Quick wins, ranked

Each is small, self-contained, and either unblocks us or is a useful upstream
contribution regardless of the license answer.

| # | Win | Size | Why it pays |
|---|---|---|---|
| **QW0** | Open an issue on `open-abap-odata` asking for MIT (matching core). Point at the `todo` LICENSE and empty `package.json` field. | 1 h | Decides fork-and-fill vs reimplement. Ask once, do not wait on it. |
| **QW1** | Fix issue #33: replace the hardcoded `zcl_zsegw_dpc_ext` / `zsegwSet` with a registry (`service name → MPC class, DPC class`) and `CREATE OBJECT … TYPE (lv_class)`. PR upstream. | 1 day | Makes the repo consumable as a lib; goodwill; forces the registry design we need anyway (Phase 1). |
| **QW2** | Generic entity serializer: walk `er_entityset` with `cl_abap_structdescr`, emit `__metadata.id/uri` from the model's key properties, real field values, `d.results`. | 2–3 days | Turns the tautological GET into a real one. Everything in core exists. |
| **QW3** | URL + query-option parser into a *populated* `zcl_oao_request_context`: verb, `Set(key)` → `it_key_tab`, `$top/$skip/$orderby/$inlinecount/$count/$select`. Not `$filter`. | 2–3 days | With QW2, a Fiori Elements list report can already page and sort against a transpiled code-based DPC. |
| **QW4** | The crux: `$filter` → `/iwbep/t_mgw_select_option` (SIGN/OPTION/LOW/HIGH) + `get_filter_select_options` + `get_osql_where_clause`. Start with `eq/ne/gt/ge/lt/le/and/or/startswith/endswith/substringof`; reference grammar = fe-mockserver `filterParser.ts`. | 1–2 wk, timebox | Phase 2. Differential-test against fe-mockserver as oracle. |
| **QW5** | `$metadata` from the model, not literals: keys from `mv_is_key`, entity sets from the registry, the 11 EDM-type setters (two lines each), labels from `load_text_elements`. | 1 day | Makes `$metadata` truthful for any MPC, which FE needs before anything else. |
| **QW6** | Scaffold open-steamgate Phase 0 in the house style (§2): scripts, `abap_transpile.json` with libs by URL, `setup.mjs`, `start.mjs`, `ANORMALIES.md` template copied from hithub (MIT). | 1 day | Zero-friction upstream PRs; Lars's tooling works on our tree unchanged. |
| **QW7** | Sprint-0 closure probe as a script: transpile each candidate `_DPC_EXT` with `unknownTypes=runtimeError`, run its `GET_ENTITYSET`, log the first missing type, repeat. | ½ day to build, then per-DPC | Automates the "real long pole" measurement instead of hand-grepping. |

Recommended order: QW0 + QW6 + QW7 first (they cost a day and change what we
know), then QW1 → QW5 → QW2 → QW3 as the Phase-1 slice, then QW4.

## 7. Corrections to `docs/prior-art.md`

- §0 "validated skeleton": still accurate, but *weaker* than described. The
  data path does not serialize the DPC result at all; the interface files are
  the whole asset.
- §1 `dpc-dispatch` row "only GET_ENTITYSET, one hardcoded set": add "and the
  response body is a literal". Verdict unchanged (FORK & BUILD or reimplement).
- §3 "un-swept: open-abap org base-class impl of `CL_MGW_ABS_DATA`": swept.
  `cl_mgw_push_abs_data` exists in both `deps` (lint stub) and `open-abap-odata`
  (no-op base). No fuller gateway exists in any branch (single `main`, 40
  commits).
- §3 "confirm SADL/RAP gap is ecosystem-wide": the `open-abap-sadl/cds/rap`
  repos are interface stubs, which confirms it inside the ecosystem. The
  "no independent non-abaplint runtime" caveat remains unaddressed.

## 8. Where the clones are

`.local/lars/<repo>` (gitignored). Built `node_modules` and `output/` exist in
the five tested repos. Build logs are in the session scratchpad, not the tree.
Re-run any of them with `npm test` from the repo directory.
