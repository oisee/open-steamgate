# Regression cases as `.http`: plan

The working plan for B18 (`docs/ideas.md`): which parts of the regression reference are reused and which are built, and in what order. It was decided on 2026-09-29 by Alice, dell and stoker, in three design rounds with gpt-6-sol at xhigh plus a tools survey. Every claim was checked against the code it names. This plan extends `docs/devux-gateway-regression.md` (GW0/GW1) and does not replace it: the OData executor stays an OSG path of the Gateway regression kernel.

## The rule: reuse the hands, build the eyes

External tools own what they already do well: the file format, sending requests, the editor, the CI runner. We build only what needs knowledge they do not have: the model (`$metadata`), the generation, the data, the LUW and the ABAP that answered.

**Tipping point.** Writing JavaScript inside an HTTP client to normalise OData responses means writing our tool badly, in the wrong place.

## Tools, measured 2026-09-29

| Tool | Licence | Same file in VS Code and CI | Usable from Node | Golden compare |
|---|---|---|---|---|
| httpYac | MIT | yes (extension + CLI) | yes: `HttpFileStore.parse`, then `send()`; `onResponse` hook | no |
| REST Client | MIT | editor only, no CLI | no | no |
| JetBrains HTTP Client | proprietary | CLI exists, no VS Code | no | no |
| Hurl | Apache-2.0 | CLI; a VS Code notebook extension | Rust only | no |
| Bruno | MIT (paid tier) | desktop + CLI | no programmatic runner | no |
| Newman | Apache-2.0 | Postman collections only, no v3 | yes | no |

- None of them compares a whole response against a golden. **The comparator is ours**: the strict GW matcher, which is GET-only in GW0 today.
- No maintained HAR → `.http` converter keeps OData sessions and `$batch` parts. That is a small piece to build.
- JMeter and k6 are for load only; they are out of scope here.

## Case format: `.http` is the contract, OSD parses it

- The case file is a plain `.http` file. REST Client and JetBrains ignore unknown `# @…` and `// @…` lines, and httpYac keeps them as inert metadata. So the same file opens and sends in all three.
- **OSD's runner parses a defined subset itself.** httpYac is an optional adapter, never a runtime dependency. The subset:
  - `###` blocks;
  - `#` and `//` comments;
  - `# @name`;
  - `@var = value`;
  - `METHOD URL [HTTP/1.1]`, then headers, then one blank line and an opaque body;
  - `{{var}}` in the URL, headers and body.

  Anything outside it fails: an unresolved variable, a duplicate case id, unsupported syntax.
- **Our metadata:** `# @osd.*` annotations before the request line. The OSD parser rejects an unknown `@osd.*` key, so a typo cannot silently change a case.
- **Chaining.** The three clients chain requests with different syntax, so a case uses a plain `{{csrfToken}}` plus `# @osd.extract csrfToken response.headers.x-csrf-token`. The runner gets explicit variables; environment files differ between clients too.
- **Grouping:** one `.http` file per business flow, one named `###` block per request, and a service folder as a suite. Intent goes in plain comments.
- **Goldens:** a sibling `<case>.golden.json`. Synthetic goldens are tracked. Anything derived from a real capture stays under `.local/` only. A response pasted into a `.http` file is not a golden: httpYac treats it as display text.

```http
### Read a seeded travel
# @name travel_read
# Intent: show the travel selected in the list
# @osd.id travel.read
# @osd.kind read
# @osd.clock 2026-09-21T10:00:00.000Z
GET {{baseUrl}}/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T-001')
Accept: application/json
```

## Determinism is the core, not an add-on

A frozen clock and frozen UUIDs are what make a golden trustworthy without masks. The hooks go on the ABAP-visible sources, never on a global `Date`:

- **Clock.** The runtime's `getTime` fills `sy-datum`, `sy-datlo`, `sy-uzeit`, `sy-timlo` and `GET TIME STAMP`. A case provider serves those, and refreshes the `sy` fields at the entry of every dialog step. `CL_ABAP_TSTMP` only does arithmetic; `CL_ABAP_CONTEXT_INFO` reads `sy`.
- The implemented provider is `tools/osd-case-determinism.mjs`. In the disposable case server, it replaces that runtime instance's `abap.statements.getTime` inside the serialized dialog step for one request, refreshes `sy`, and restores the real statement and `sy` before releasing the step. It leaves `Date` untouched, so host elapsed time and deadlines continue to advance.
- **UUIDs.** open-abap-core's `CL_SYSTEM_UUID` calls `crypto.randomUUID`. A case supplies an ordered sequence (`# @osd.uuid …`), and running out of it, or leaving entries unused, fails the case. No `GUID_CREATE` implementation exists yet, so a case that reaches it is ineligible.
- The provider replaces `CL_SYSTEM_UUID.CRYPTO.randomUUID` on the loaded class only during the case request. The server reports how many values were used, and the runner rejects unused values even if an HTTP response was already sent.
- **Host time stays real:** work-process age, `WAIT` deadlines, `GET RUN TIME`, watchdogs and network timeouts.
- **Out of scope for v1.** Cases that reach these are marked ineligible, not trusted:
  - APC;
  - daemons and timers;
  - `WAIT`, which commits;
  - database-side clocks (`CURRENT_UTCTIMESTAMP`, `NOW()`, column defaults);
  - the job candidate pick, which uses `crypto.randomInt`.

## Isolation: disposable state, not rollback

Rolling back a case's LUW is not real isolation today:
- every successful dialog step commits, and `WAIT` commits;
- `BP_EVENT_RAISE` writes the separate operations store and survives a rollback.

**v1:** one case flow per disposable local server, with fresh copies of the business database **and** the operations database, destroyed afterwards. Remote targets never claim a rollback; their writes need an allowlist and verified cleanup (B18).

## CodeLens in `.http`: from URL to code

The forward CodeLens now resolves plain entity-set and keyed GET requests to the owning DPC method and source line, labelled as a static prediction.

- **Forward lens,** above each request: service → registration (IWSV → DPC, IWMO → MPC) → entity set → the **owning** method (`_DPC_EXT` if redefined, otherwise `_DPC`) and its line, plus the data source behind it (hand-written DPC, SADL over a table or CDS, an RFC-mapped module, a search help) and the case's last result.
- **Reverse lens,** on the DPC method: "covered by N cases, M red", counted from the latest stored results only.
- **Static resolution is a candidate, not an observation.** It is enough for plain `GET /Set` and `GET /Set(key)`. It is wrong or incomplete for:
  - `$expand` overrides that call other methods;
  - a deep insert, which becomes `CREATE_DEEP_ENTITY`;
  - function imports, which branch inside `EXECUTE_ACTION`;
  - PATCH and MERGE, which read before `UPDATE_ENTITY`;
  - navigation, which reaches the target set's method with a source key;
  - SADL, where the generated method is only an entry point;
  - `$batch`, where each part resolves on its own.
- **Knowing what really ran** needs a method-entry trace: class, method, line and request or part id. A dev-only `X-OSD-Handler` header is built from the trace, and for `$batch` it is per part or a trace id. A static prediction is never labelled as observed. The local `$batch` does not call `CHANGESET_BEGIN`/`PROCESS`/`END`; whether SAP does needs a probe.
- **Remote reference.** ADT alone plausibly suffices. `/IWBEP/I_MGW_SRH` and `/IWBEP/I_MGW_OHD` hold the DPC and MPC class names, as our IWSV and IWMO exports show. The hub-to-backend join is unverified.
- A known gap in the existing map: SEGW truncates generated method names to 16 characters, so matching a set name to a method prefix can miss.

## Remote lookup: measured on the SAP sandbox (2026-09-29)

These are read-only ADT SQL probes, run by dell with Alice's authorisation. Tables and fields are the contract. No SAP-delivered service or class names are recorded here.

| Table | Key | What the lookup reads |
|---|---|---|
| `/IWBEP/I_MGW_SRH` (backend service, IWSV) | `TECHNICAL_NAME` CHAR35, `VERSION` NUMC4 | `CLASS_NAME` CHAR30 = the runtime `_DPC_EXT`; `NAMESPACE` CHAR10; `EXTERNAL_NAME` CHAR40; `EXT_4_TECH_NAME`/`EXT_4_VERSION` = the service it extends |
| `/IWBEP/I_MGW_OHD` (backend model, IWMO) | `TECHNICAL_NAME` CHAR32, `VERSION` NUMC4 | `CLASS_NAME` CHAR30 = the `_MPC_EXT` |
| `/IWBEP/I_MGW_SRG` (service group → model) | all four fields: `GROUP_TECH_NAME`, `GROUP_VERSION`, `MODEL_TECH_NAME`, `MODEL_VERSION` | the model of a service |
| `/IWFND/I_MED_SRH` (hub registration) | `SRV_IDENTIFIER` CHAR40, `IS_ACTIVE` | `OBJECT_NAME` CHAR35 = the hub name, which may be an alias; `NAMESPACE`; `SERVICE_NAME` CHAR40 + `SERVICE_VERSION` = the backend service |

The join, verified on six active customer rows:
- `hub.SRV_IDENTIFIER = OBJECT_NAME || '_' || SERVICE_VERSION`.
- The backend key is **`NAMESPACE || SERVICE_NAME`**, not `SERVICE_NAME` alone: `concat(hub.namespace, hub.service_name) = backend.technical_name AND backend.version = hub.service_version` matched all six, and the join without the namespace matched none. `backend.EXTERNAL_NAME = hub.SERVICE_NAME`.
- Hub aliases are real. One hub row carried a Z-prefixed `OBJECT_NAME` for a namespaced backend service. So resolution goes URL → hub row → backend row → `CLASS_NAME`, and never by matching the URL to a backend name as a string.

Still open:
- The model hop `SRG → OHD` has not been run yet.
- For an aliased row, it is unverified whether the URL path uses `OBJECT_NAME` or `NAMESPACE`/`SERVICE_NAME`. Resolve both, and prefer the hub row.
- Probes 3–4, the `$expand` call stack and whether `$batch` calls `CHANGESET_BEGIN`/`PROCESS`/`END`, need a debugger session and come later.

## Producing cases

| Source | Gives | Still needed |
|---|---|---|
| `$metadata` | one bounded GET per entity set | a reviewed golden on pinned seed data |
| HAR (Playwright `recordHar`, DevTools) | the observed sequence | filter, redact, rebuild CSRF and cookies as steps, parse multipart |
| SE37 test directory, report variants (B18, via ADT) | saved inputs | the A4H probes first; not an OData recorder |
| [fiori_automator](https://github.com/oisee/fiori_automator) sessions | clicks as intent, plus the requests | a draft to review, not a faithful capture (below) |
| SAP Gateway Client (`/IWFND/GW_CLIENT`) saved test cases (B18, 0.5 nice) | requests developers already keep: method, URI, headers, body | an A4H probe first: where and in what format the cases are stored, and whether an expected response is stored at all; then a converter to `###` blocks with `# @osd.id` plus a draft golden; writes, CSRF and `$batch` stay behind steps 5 and 6. First client: osg-demo's fleet suite (chapter 15) |

### fiori_automator

Its export is JSON, `formatVersion` 1.1: a session with events (DOM id, selector, values, screenshot references) and requests (URL, method, status, selected headers, bodies). A bundle is a ZIP of that JSON, Markdown and screenshots. Small fixes to the owner's repository, in order of value:

1. Keep the parsed `$batch` operations, which the save cleaner drops, and filter the boundary-only records.
2. Do not truncate response bodies silently (50 KB fetch, 10 KB cleaned). Record truncation and the original length at least.
3. XHR capture writes `responseText` where the consumer reads `responseData`.
4. Copy the UI5 control id and binding info from `ui5Context.elementUI5Info`; the cleaner reads fields that are not there.
5. Correlate a click with the same-tab requests after it and before the next interaction, instead of a ±10 s window. Label heuristic matches as tentative.
6. Add a `LICENSE` file: `package.json` declares MIT, but there is no file.

Where to capture:
- **The browser extension on a real Fiori:** best for human intent, but high privacy exposure. The SAP sandbox only with Alice's yes.
- **Our apps inside a VS Code webview:** the app runs in an iframe, so record in the served page or at the gateway.
- **Playwright:** reproducible.

Captures are never tracked. The best use beyond regression, per unit of effort, is osg-demo tutorial chapters and screenshots: the bundle already produces both.

## Order of work

1. **Done: one GET through our own parser.** `tools/osd-http-case.mjs` parses the bounded format; `tools/osd-reference-generation.mjs` sends a plain `.http` case to two pinned generations on separately seeded, disposable business and operations databases. The server loads the addressed generation's `output/` directly without switching `build/live`.
   - Its golden holds an **unmasked** ABAP-derived timestamp, and a UUID if the endpoint makes one, driven by `# @osd.clock` and `# @osd.uuid`.
   - Exits: 0 equal, 1 difference, 2 error. The generation header is checked.
   - Negative controls:
     - a mutated timestamp or UUID in the golden goes red;
     - two cases back to back in one process, with distinct clocks and UUIDs, then an unscoped call must show real time.
   - The fixture is `test/fixtures/http-cases/clock-read.http` and its sibling golden. The dedicated read-only `ZOSD_REF_SRV/ClockSet('CLOCK')` returns an ABAP-derived `ObservedAt` and `CL_SYSTEM_UUID`-derived `Token`; both stay unmasked in the golden. The service is defined by `src/regression/zosd_ref.stg.yaml` and registered through `stg-compile --all`.
   - Run `npm run transpile`, then `HASH=$(basename "$(readlink build/live)")` and `node tools/osd-reference-generation.mjs test/fixtures/http-cases/clock-read.http "$HASH" "$HASH"`. Run the checks with `node tools/osd-unit-run.mjs` and `npx mocha test/http-case.mjs test/reference-generation.mjs test/replay-compare.mjs test/osd-suites.mjs test/stg-compile.mjs`.
2. **In parallel, a small PR: the `.http` forward CodeLens** for `GET /Set` and `/Set(key)`. It opens the owning method, shows "unresolved" for any other shape and "last: not run" until results are stored. Test: `test/http-codelens.mjs`.
3. **Conformance** of the `.http` subset and the `@osd` annotations against REST Client, httpYac and JetBrains.
4. **One fiori_automator session** imported as a reviewed draft, with `# osd.source` hints validated against the registry.
5. **Writes, CSRF, cookies and `$batch`,** only with disposable business and side stores, plus part-aware matching.
6. **Broader determinism** (database clocks, jobs, APC, other UUID sources) and the runtime trace behind the "ran:" lens, before those cases are trusted.

## Probes on the SAP sandbox (Alice's yes first; none have been run)

1. ~~The DDIC fields and keys of the service registration tables, and the hub → backend join.~~ Done 2026-09-29; see "Remote lookup" above. The `SRG → OHD` model hop is still to run.
2. Fetch `_DPC_EXT`, `_DPC` and MPC, and compare the method lines with a prediction.
3. Debug one `$expand` request and compare the prediction with the real stack.
4. Does a SAP `$batch` call `CHANGESET_BEGIN`/`PROCESS`/`END`?
5. From B18: the SE37 test directory (EUFUNC) and report variants (VARID/VARIT/VARI) decoded against SE37 and the variant screen.

## Open decisions for Alice

- The fiori_automator licence file and its attribution.
- Consent and redaction rules for any capture from a real system.
- Whether the six fiori_automator fixes go ahead as small PRs to that repository.
