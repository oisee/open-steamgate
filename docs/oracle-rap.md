# RAP: what an oracle would take, and whether it is worth it

Research note, 2026-09-13. **Nothing in here has been run against A4H. Nobody
touches A4H until Alice says go.** Everything below was established from the
tree, from `node_modules/@abaplint/core`, from `.local/lars/`, and from public
sources.

Method is the project's usual one (`docs/segw-mapping.md`, `docs/segw-tree.md`):
never invent the shape of an SAP artifact — take a real one and make a generator
reproduce it, `--check` in CI.

---

## 0. Fact base (verified in-tree today)

RAP artifacts in the local corpora:

| | `*.ddls.asddls` | `*.bdef.asbdef` | `*.srvd.srvdsrv` | `*.srvb.xml` | `*.ddlx.asddlxs` |
|---|---|---|---|---|---|
| `.local/corpus/` (8 public repos) | 19 | 0 | 0 | 0 | 0 |
| `.local/corpus-sap/` (7 SAP packages) | 13 | 0 | 0 | 0 | 0 |
| `.local/lars/` (17 clones) | 4 | 0 | 0 | 0 | 0 |

Confirmed and extended: **RAP has no oracle here at all.** Not one behavior
definition, service definition or service binding. The 32 CDS views in the two
corpora are classic `define view` with `@AbapCatalog.sqlViewName`, i.e. the SADL
shape `tools/cds2ddic.mjs` already handles — not view entities.

One asset not in the brief: **`.local/lars/open-abap-rap` exists.** 540 lines,
one commit (`2062f99 wip (#7)`), `"license": ""` in `package.json` — the same
trap as `open-abap-odata` (`CLAUDE.md`, "Known traps"). Contents: `cl_abap_behv`,
`cl_abap_behavior_handler` (constants only), `cl_abap_behavior_saver` (8 method
signatures, every body `RETURN. " todo`), `if_abap_behv` (the `t_phase`,
`t_fail_cause`, `t_permissions_only` enums), `if_abap_behv_message`, eight
`if_rap_query_*` (the custom-entity query provider), four `cx_rap_query_*`, and
eight `abp_behv_*` DTEL/TABL. **Signatures, zero runtime.** Spec, not a base.

---

## 1. A minimal RAP service as files, and what we can parse today

File names verified against `SAP-samples/abap-platform-refscen-flight`, branch
`ABAP-platform-2022`, `src/managed/` (Apache-2.0, see §7).

| artifact | abapGit files | abaplint today |
|---|---|---|
| interface root view entity | `<n>.ddls.asddls` + `<n>.ddls.xml` (+ `<n>.ddls.baseinfo` on newer abapGit) | **full CDS parse** |
| projection view | same | **full CDS parse** |
| metadata extension (UI annotations) | `<n>.ddlx.asddlxs` + `<n>.ddlx.xml` | source file found, content not evaluated |
| **behavior definition** | `<n>.bdef.asbdef` + `<n>.bdef.xml` | **one regex** — see below |
| behavior pool (behavior implementation) | `<n>.clas.abap` + `<n>.clas.locals_imp.abap` + `<n>.clas.xml` | **full ABAP parse** |
| service definition | `<n>.srvd.srvdsrv` + `<n>.srvd.xml` | XML only; **source ignored** |
| service binding | `<n>.srvb.xml` (no source file) | XML only |
| persistence table | `<n>.tabl.xml` | full |

Notes that matter:

- **BDEF is not parsed.** `node_modules/@abaplint/core/build/src/objects/behavior_definition.js`
  strips `//` comments and runs exactly one regex:
  `/\bdefine\s+(?:\w+\s+)*?behavior\s+for\s+([\w/]+)(?:\s+alias\s+(\w+))?/gi`.
  It yields `{name, alias}` pairs and nothing else. Not understood: `managed` /
  `unmanaged` / `projection` / `abstract`, `strict(2)`, `persistent table`,
  `mapping for … corresponding`, `field ( readonly | mandatory )`,
  `create/update/delete`, `action`, `factory action`, `internal action`,
  `determination … on modify|on save`, `validation … on save`, `lock master` /
  `lock dependent by`, `etag master`, `authorization master(global)` /
  `dependent by`, `early numbering`, `with additional save` /
  `with unmanaged save`, `draft table`, `association _X { create; }`, and the
  projection dialect `use create; use action X;`. The regex exists only so
  `basic_types.js:704 resolveRAPAlias()` can map an alias back to a DDLS name.
- **SRVD source is ignored.** `service_definition.js` has no `findSourceFile()`.
  The `expose <CDS> as <Alias>` list — the whole content of a service definition
  — is never read. Same for `service_binding.js` (SRVB is XML-only anyway; its
  `<BIND_TYPE>ODATA</BIND_TYPE>`, `<BIND_TYPE_VERSION>V2</BIND_TYPE_VERSION>`,
  `<SRVD_REF>` are the interesting fields).
- **The CDS half is genuinely covered.** `build/src/cds/expressions/` has
  `cds_define_view.js` (with `ROOT`), `cds_define_projection.js` (`REDEFINE`,
  `ROOT`, `COMPOSITION`), `cds_provider_contract.js`
  (`TRANSACTIONAL_QUERY` / `TRANSACTIONAL_INTERFACE` / `ANALYTICAL_QUERY` /
  `SQL_QUERY` / `STRUCTURED_QUERY`), `cds_composition.js`, `cds_define_custom.js`
  (`CUSTOM ENTITY`), `cds_define_abstract.js`, `cds_define_hierarchy.js`. RAP's
  DDL surface parses today. That is a real head start.
- **Our own CDS generator does not cover view entities.** `tools/cds2ddic.mjs:85`
  derives the SQL view from `@AbapCatalog.sqlViewName`. RAP uses view *entities*,
  which have no SQL view, plus `composition`/`association to parent` and the
  provider contract. A view-entity path would have to be added.
- Behavior pools put the real code in `.clas.locals_imp.abap` (`lhc_<entity>`
  inheriting `cl_abap_behavior_handler`, `lsc_<root>` inheriting
  `cl_abap_behavior_saver`). abaplint parses locals_imp normally, so this is fine.
- The `<n>.bdef.xml` is thin: `NAME`, `TYPE` = `BDEF/BDO`, `DESCRIPTION`,
  `ABAP_LANGU_VERSION`, `SOURCE_TYPE` = `ABAP_SOURCE`, plus ADT `LINKS`. The
  `<n>.srvb.xml` is fat and carries `<RESPONSIBLE>` — **a real username**, so
  even the public oracle must stay under `.local/`.

---

## 2. What the runtime would have to provide, and where "parse" stops

### Already there (free)

- **The EML grammar is complete.** `build/src/abap/2_statements/statements/`:
  `modify_entities.js` (CREATE/UPDATE/DELETE FROM, `CREATE BY \_assoc`,
  `UPDATE FIELDS ( … ) WITH`, `UPDATE SET FIELDS WITH`, `EXECUTE <action> FROM`,
  `AUGMENTING`, `IN LOCAL MODE`, dynamic `ENTITIES … OPERATIONS`,
  `FAILED/RESULT/MAPPED/REPORTED`), `read_entities.js`, `commit_entities.js`,
  `rollback_entities.js`, `raise_entity_event.js`.
- **They are allowed in our language version.** Each is gated
  `ver(Release.v754, …, {also: AlsoIn.OpenABAP})` — so with
  `abaplint.jsonc` `"syntax": {"version": "open-abap"}` EML lints clean with **no
  downport step**. (`raise_entity_event.js` lacks the `OpenABAP` flag.)
- **Behavior-pool method definitions are complete.** `method_def.js` covers
  `FOR MODIFY … FOR CREATE|UPDATE|DELETE|ACTION`, `FOR READ … RESULT … LINK`,
  `FOR FUNCTION`, `FOR DETERMINE ON MODIFY|ON SAVE`, `FOR VALIDATE ON SAVE`,
  `FOR PRECHECK`, `FOR NUMBERING`, `FOR FEATURES`, `FOR LOCK`,
  `GLOBAL/INSTANCE AUTHORIZATION`, `FOR ENTITY EVENT`. `class_definition.js`
  covers `FOR BEHAVIOR OF`.

### The wall

- **Derived types are void.** `basic_types.js:490 rapTableFor()` returns
  `TableType(VoidType.get("RAP-TODO"))` when the DDLS resolves, `VoidType`
  otherwise. `parseType()` (≈ line 538) sends `TYPE STRUCTURE FOR`,
  `TYPE RESPONSE FOR`, `TYPE REQUEST FOR` straight to `VoidType`. So
  `TYPE TABLE FOR CREATE travel`, `TYPE TABLE FOR FAILED`,
  `TYPE RESPONSE FOR REPORTED EARLY …` have **no components**. abaplint is happy;
  the transpiler has nothing to emit.
- **The transpiler stubs EML out.**
  `.local/lars/transpiler/packages/transpiler/src/statements/modify_entities.ts`
  and `read_entities.ts` are three lines each:
  `return new Chunk('throw new Error("ModifyEntities, not supported, transpiler");')`.
  `COMMIT ENTITIES` and `ROLLBACK ENTITIES` have **no transpiler at all**
  (`statements/index.ts` lists only `commit`, `modify_entities`,
  `read_entities`, `rollback`).
- **The transpiler emits only CLAS / INTF / PROG / FUGR / TABL / VIEW / TTYP**
  (`packages/transpiler/src/initialization.ts`, `index.ts`). No DDLS, no BDEF, no
  SRVD/SRVB — the same reason `tools/cds2ddic.mjs` exists.

**Plainly: parsing is free, running is entirely ours.** Six things would have to
be built.

1. **A real BDEF parser** → a JSON model (entities, aliases, implementation type,
   `persistent table`, `mapping`, field control, standard ops, actions,
   determinations/validations with their trigger sets, lock/etag/authorization
   inheritance, compositions). Offline, house style, `--check` against an oracle.
2. **Derived-type generation.** From BDEF + DDLS, emit real ABAP types for the
   eight `TYPE TABLE FOR …` families and their `%cid`, `%key`, `%tky`,
   `%control`, `%msg`, `%fail`, `%is_draft` components, into `gen/rap/`. The
   transpiler will never know them, so they must exist as generated source —
   exactly the `gen/cds/`, `gen/stg/` pattern.
3. **A transactional buffer.** Per-entity before/after images keyed by
   `%key`/`%cid`, plus the phase model (`if_abap_behv=>t_phase`: `finalize` →
   `check_before_save` → `adjust_numbers` → `save` → `cleanup`) and the
   interaction-phase / save-sequence split. `open-abap-rap`'s
   `cl_abap_behavior_saver` gives the exact eight signatures to fill.
4. **An EML path.** Either a transpiler PR rewriting `MODIFY/READ/COMMIT
   ENTITIES` into calls on a runtime shim class, or a v1 rule that forbids EML in
   transpiled sources and has the OData layer call handler/saver methods
   directly. Unmanaged BOs need the former (their handlers call EML on other
   BOs); a managed-only slice does not.
5. **`cl_abap_behavior_handler` / `cl_abap_behavior_saver` with bodies**, plus the
   `failed/mapped/reported` message plumbing.
6. **An OData V4 stack.** v4 CSDL `$metadata` (XML and JSON), v4 URL conventions,
   v4 `$batch` (JSON), nested `$expand`/`$select`, deep insert, `@odata.etag` /
   `If-Match`, bound actions and functions, draft actions, and `@UI` annotations
   in v4 shape. `src/gateway/` is **v2 only** — 6113 lines across
   `zcl_stg_url`, `zcl_stg_model_info`, `zcl_stg_json`, `zcl_stg_batch`,
   `zcl_stg_dispatcher`, `zcl_stg_filter`, … plus a Fiori Elements V4 app in
   `webapp/`. **Item 6 alone is roughly the size of everything at and above the
   `/IWBEP/` line that this repo has built so far.**

---

## 3. Can A4H (ABAP Platform 1909) host a usable RAP example?

A4H is ABAP Platform 1909 developer edition, SAP_BASIS 7.54. 7.54 is exactly
RAP's floor — abaplint gates every EML statement at `Release.v754`. So RAP
exists there. The question is which flavour.

**Finding: 1909 is unmanaged-only. No managed, no draft.**

Evidence, strongest first:

1. SAP's own reference scenario, `SAP-samples/abap-platform-refscen-flight`,
   branch **`ABAP-platform-2019`** (= 1909), has subpackages
   `legacy`, `readonly`, `reuse`, `unmanaged` — and **no `managed`, no `draft`**.
   Branch **`ABAP-platform-2020`** adds both (`managed/`, `draft/`) and is also
   the first branch in which abapGit serialized `*.bdef.asbdef` at all.
2. Secondary sources agree: RAP shipped unmanaged on-premise with 1909; managed
   and draft arrived with 2020.
3. Counter-evidence, weighed and discounted: SAP product management's March-2020
   deck *OData service development options* (Andre Fischer) shows both "Managed
   RAP BO" and "Unmanaged RAP BO" under "SAP S/4HANA 1909 and higher" for V2 and
   V4 — but every such slide carries "This is the current state of planning and
   may be changed by SAP at any time." Forward-looking, not a feature list.

**Confidence: high** that draft is absent on 1909. **Medium-high** that managed is
absent or not usable. Both must be checked on the sandbox before any commitment
(§5, step 1) — the check is two read-only queries and costs nothing.

Unmanaged on 1909 is real and complete enough to be an oracle. From the 2019
branch, `src/unmanaged/#dmo#bp_travel_u.clas.abap` is literally

```abap
CLASS /dmo/bp_travel_u DEFINITION PUBLIC ABSTRACT FINAL
  FOR BEHAVIOR OF /dmo/i_travel_u .
```

and its `.clas.locals_imp.abap` has `lhc_travel` (`create_travel`,
`update_travel`, `delete_travel`, `set_travel_status`, `cba_booking`,
`read_travel`), `lsc_saver` (`finalize`, `check_before_save`, `save`, `cleanup`),
and `TYPES tt_travel_failed TYPE TABLE FOR FAILED /dmo/i_travel_u.`

**What a 1909 oracle would *not* teach us** (present in modern releases, so a
generator grounded only on 1909 must not claim to reproduce modern BDEFs):
`strict(1)`/`strict(2)`, `with additional save` / `with unmanaged save`, managed
numbering and late numbering, draft tables and `draft action Edit/Activate/
Discard/Resume/Prepare`, `%is_draft`, the `%tky` shorthand, `%pid`/`%pky`,
abstract and custom entities as RAP query providers, the RAP BO test double
framework (`cl_abap_behv_test_*`), and the breadth of dynamic
`field ( features: instance )` control. A 1909 BDEF is a **1909-dialect** oracle.

Consequence: for the modern dialect, the public 2022 branch (§7) is a *better*
oracle than A4H. A4H's unique value is (a) a live `$metadata` and live payloads
from a real SRVB, and (b) the ADT-generated behavior-pool skeleton, which is the
RAP analogue of what `segw-gen --check` reproduces.

---

## 4. The minimal build on A4H

Only if Alice says go. Package `ZSTG_RAP`, one transportable request, every name
inside `ZSTG_*` / `ZBP_STG_*`.

Smallest set that yields a real oracle — an **unmanaged** BO, root + one child
(a single-entity BO teaches nothing about the transactional buffer, so the child
earns its cost):

| # | object | type | what it contributes to the oracle |
|---|---|---|---|
| 1 | `ZSTG_RAP_T` | TABL | the persistence; the DDIC end of `mapping for` |
| 2 | `ZSTG_RAP_B` | TABL | the child's persistence |
| 3 | `ZSTG_I_TRAVEL` | DDLS | `define root view entity … composition [0..*] of ZSTG_I_BOOKING as _Booking`; **and** the `.ddls.xml` of a *view entity* — its `SOURCE_TYPE` differs from the `V` that `tools/cds2ddic.mjs` writes for classic views |
| 4 | `ZSTG_I_BOOKING` | DDLS | `association to parent`, the child half of the composition |
| 5 | **`ZSTG_I_TRAVEL`** | **BDEF** | **the primary oracle**: the exact `.bdef.asbdef` text 1909 accepts (`implementation unmanaged;`, `etag master`, `lock master`, field control, `create/update/delete`, `action … result [1] $self`, `association _Booking { create; }`) and the exact `.bdef.xml` abapGit writes |
| 6 | `ZBP_STG_I_TRAVEL` | CLAS | **the generator oracle**: ADT's quick-fix-generated skeleton — the exact `lhc_*`/`lsc_*` local-class shape and the exact `FOR MODIFY`/`FOR READ`/`FOR LOCK` signatures and `TYPE TABLE FOR …` spellings 1909 emits. This is what a `bdef-gen --check` would diff against |
| 7 | `ZSTG_C_TRAVEL` | DDLS | `define view entity … as projection on …` + `provider contract transactional_query` |
| 8 | `ZSTG_C_TRAVEL` | BDEF | the **projection dialect** — `projection;` + `use create; use update; use action …` — a second grammar our parser must handle |
| 9 | `ZSTG_C_TRAVEL` | DDLX | `.ddlx.asddlxs`; and how `@UI` reaches `$metadata` |
| 10 | `ZSTG_UI_TRAVEL` | SRVD | `.srvd.srvdsrv` + `.srvd.xml`; the `expose … as …` grammar |
| 11 | `ZSTG_UI_TRAVEL_O2` | SRVB | `.srvb.xml` with `BIND_TYPE_VERSION` = `V2`, and a **live v2 `$metadata` + payload** — directly comparable to what `src/gateway/` already produces |
| 12 | `ZSTG_UI_TRAVEL_O4` | SRVB | the same with `V4` — the **wire oracle** a future v4 serializer must match |

Skip: managed, draft (unsupported per §3). Add nothing else — the point is the
smallest set that grounds a parser and a generator.

---

## 5. Exact export and inspection steps

Precondition: **Alice says go.** Nothing here runs unasked.

1. **`query` (read-only) — three probes, before creating anything.**
   - Is the managed runtime there at all?
     `SELECT obj_name FROM tadir WHERE object = 'CLAS' AND obj_name LIKE 'CL_ABAP_BEHV%'`
     and `… LIKE '%BEHV_DRAFT%'`. Settles §3 empirically.
   - **Can abapGit even serialize a BDEF on this release?** abapGit's
     `zcl_abapgit_object_bdef` does `CREATE OBJECT mi_persistence TYPE
     ('CL_BDEF_OBJECT_PERSIST')` and `CREATE DATA … TYPE
     ('CL_BLUE_SOURCE_OBJECT_DATA=>TY_OBJECT_DATA')`, catching
     `cx_sy_create_error` → `zcx_abapgit_type_not_supported`. So:
     `SELECT clsname FROM seoclass WHERE clsname IN ('CL_BDEF_OBJECT_PERSIST',
     'CL_BLUE_SOURCE_OBJECT_DATA', 'CL_WB_OBJECT_OPERATOR')`. **If any is
     missing, `git_export` drops the BDEF silently and the whole exercise is
     void.** This is plausibly why SAP's own 2019 branch carries no `.asbdef`.
   - Is the flight scenario installed? `SELECT devclass FROM tdevc WHERE
     devclass LIKE '/DMO/%'`.
2. **Create objects 1–12 in ADT.** Not an MCP `SAP` action — ordinary ADT work
   (by hand, or through the vsp sibling). One request, `ZSTG_RAP`.
3. **`system git_export` on `ZSTG_RAP`** → lands under `.local/corpus-sap/` as
   `ZSTG_RAP/` plus `ZSTG_RAP_<YYYYMMDD>_<HHMMSS>.zip`, matching the existing
   exports (e.g. `.local/corpus-sap/<EPM-FG-PACKAGE>_<timestamp>.zip`).
4. **If `/DMO/` is installed, `system git_export` on `/DMO/FLIGHT`** (and
   `/DMO/FLIGHT_UNMANAGED`, `/DMO/FLIGHT_REUSE`, `/DMO/FLIGHT_LEGACY`) →
   `.local/corpus-sap/DMO_FLIGHT/`. SAP-authored 1909 BDEFs and behavior pools
   are a better oracle than anything we hand-write. On on-premise the scenario is
   usually *not* pre-installed (it is pulled from the public repo via abapGit),
   so expect this to be skipped — the GitHub 2019 branch covers it, minus the
   BDEF files.
5. **Verify the export** actually contains `*.bdef.asbdef`, `*.srvd.srvdsrv`,
   `*.srvb.xml`. A missing BDEF is step 1's answer showing up late.
6. **Offline from there.** `npm run probe -- .local/corpus-sap/ZSTG_RAP` for the
   behavior pool's class closure; `npm run segw:closure -- --corpus
   .local/corpus-sap` to lint. A new `tools/bdef-probe.mjs` would count BDEF
   constructs and report the parser's required surface — the same first move as
   the SEGW closure probe.
7. **Nothing is committed.** `.local/` is gitignored and stays that way. The
   SRVB XML's `<RESPONSIBLE>` is exactly the live identifier the repo rule bans,
   and the export zips carry timestamps and system context.

---

## 6. Recommendation

**Do not build a RAP slice into open-steamgate v1. Do build the parsing slice —
it is cheap, and it is the only part that actually needs an oracle.**

Stages, each independently shippable:

| stage | size | what it is | what it unlocks |
|---|---|---|---|
| **R0** — BDEF parser + `--check` | **~2–4 days** | `tools/bdef-parse.mjs` (BDEF → JSON model) and `tools/bdef-gen.mjs --check` regenerating the ADT behavior-pool skeleton and diffing it against an oracle, exactly as `tools/segw-gen.mjs --check` does | a *factual* size for RAP; a `docs/bdef-mapping.md` in the house style; and a plausible upstream PR — abaplint's BDEF support is one regex today, and a real parser is what would let `TYPE TABLE FOR …` resolve to components instead of `VoidType("RAP-TODO")`. That single fix is the highest-leverage RAP contribution available to anyone. **Needs no A4H** if the public 2022 branch is the oracle |
| **R1** — derived types | ~1 week | generate the eight `TYPE TABLE FOR …` families and `%cid/%key/%tky/%control/%msg/%fail` into `gen/rap/` | a 1909 behavior pool compiles *and transpiles*; its signatures stop being void. Still nothing runs |
| **R2** — managed behavior over one table, no EML | ~2–3 weeks | `zcl_stg_rap_buffer` (transactional buffer + phase model) and `zcl_stg_rap_runtime` (standard ops against `persistent table` + `mapping for`, field control, saver sequence), served through the **existing v2 gateway** by reusing `src/sadl/zcl_stg_sadl_dpc.clas.abap` — which already does GET / GET-by-key / POST / PUT / DELETE over a CDS projection | **a RAP BO in a real Fiori Elements V2 app, with zero V4 work.** The cheapest honest demo, and it fits the repo as it stands (v2 UI service bindings are a real SAP thing, so this is not a fiction) |
| **R3** — EML | medium | a transpiler PR rewriting `MODIFY/READ/COMMIT ENTITIES` onto a runtime shim, or an ABAP `zcl_stg_eml` façade plus a lint rule banning raw EML | unmanaged BOs (their handlers call EML on other BOs) and RAP unit tests |
| **R4** — OData V4 | **large, ≈ the size of `src/gateway/` again** | v4 CSDL `$metadata`, v4 URL/JSON, v4 `$batch`, ETag/`If-Match`, bound actions, `@UI` in v4 shape, a Fiori Elements V4 app | SRVD/SRVB served the way a system serves them. Draft is a further large chunk on top |

**Verdict.** R0 is worth doing now; it needs almost nothing and it retires the
open question. R1–R2 are a bounded new milestone, worth it only if Alice wants a
RAP demo. **R3–R4 are a separate project.** The V4 stack plus draft plus an EML
interpreter is larger than everything open-steamgate has built so far, and it
shares almost no code with the `/IWBEP/` line that is this repo's thesis — the
v2 gateway, the `$filter` bridge, the SEGW toolchain. Calling it
`open-steamgate-v4` and not starting it is a defensible answer. The current
scope guard in `AGENDA.md` ("v1 = classic code-based SEGW only … RAP deferred")
survives this analysis intact.

**Smallest useful slice, named precisely:** parse a BDEF and reproduce the
ADT-generated behavior pool byte-for-byte (R0). Smallest slice that *runs*:
R0+R1+R2 — a managed behavior over one table, served read-write as OData **v2**
through the existing gateway and SADL DPC.

---

## 7. What can be learned without touching A4H

This is the finding that most changes the plan.

1. **`SAP-samples/abap-platform-refscen-flight` — Apache-2.0, public, and
   abapGit-shaped.** A complete RAP oracle, no system needed.
   - Branch **`ABAP-platform-2022`**, `src/managed/`: three `*.bdef.asbdef` +
     `*.bdef.xml` (`#dmo#i_travel_m`, `#dmo#c_travel_processor_m`,
     `#dmo#c_travel_approver_m` — interface *and* projection dialects), two
     `*.srvd.srvdsrv` + `*.srvd.xml`, two `*.srvb.xml` (both `V2`), the behavior
     pools with `locals_imp` and `testclasses`, projection views with
     `.ddls.baseinfo`, the persistence tables, a number range, an update-task
     function group.
   - Branch **`ABAP-platform-2020`**: first branch with `*.bdef.asbdef`, first
     with `managed/` and `draft/` packages.
   - Branch **`ABAP-platform-2019`** = 1909, the closest match to A4H: packages
     `legacy`, `readonly`, `reuse`, `unmanaged`; the behavior pools and
     `FOR BEHAVIOR OF` are there, but SAP did **not** serialize BDEF/SRVD/SRVB.
     So the 1909 *BDEF text* is the one thing only A4H can supply.
   - Clone all four branches into `.local/corpus-rap/` (untracked) and stage R0
     can start today. Apache-2.0 changes nothing about the repo rule: SAP
     content stays under `.local/`.
2. **`SAP/abap-file-formats`** (Apache-2.0) — has `file-formats/bdef/`, `srvd/`,
   `srvb/`, `ddls/`, `ddlx/`, `dtel/`, with JSON Schemas, plus
   `SAP/abap-file-formats-tools`. Already on the un-swept list at
   `AGENDA.md:691`; sweep it now. **Caveat:** it specifies the new ADT/gCTS
   format, **not** the abapGit format our corpus uses — a field dictionary, not
   the byte-for-byte oracle.
3. **abapGit's own serializers** — `zcl_abapgit_object_bdef.clas.abap`, `_srvd`,
   `_srvb` in `abapGit/abapGit`. These *are* the contract for the `.xml` halves,
   and they name the SAP APIs to probe on A4H before trusting an export
   (`CL_WB_OBJECT_OPERATOR`, `CL_BLUE_SOURCE_OBJECT_DATA`,
   `CL_BDEF_OBJECT_PERSIST`, `IF_WB_OBJECT_DATA_MODEL`).
4. **`SAP-samples/abap-platform-rap-opensap`** — the openSAP RAP course repo,
   per-week solutions; the second-best public oracle. And
   **`SAP-samples/abap-cheat-sheets`, `08_EML_ABAP_for_RAP.md`** — the most
   compact authoritative EML surface list, exactly what R3 needs for scoping.
5. **SAP Help, `abap-cloud/abap-rap`** — `business-object-implementation-types`,
   **`rap-business-object-contract`** (the normative phase model our buffer must
   obey), `draft-enabling-managed-business-object`.
6. **`.local/lars/open-abap-rap`** — already cloned. The `if_abap_behv` enums and
   `cl_abap_behavior_saver`'s eight signatures are precisely what R2 implements,
   already in a form abaplint accepts. Licence empty → **spec, not a base**, same
   handling as `open-abap-odata`.
7. **abaplint itself** — `node_modules/@abaplint/core/build/src/cds/` is a
   RAP-grade CDS DDL parser. The cheapest way to learn the exact boundary is to
   read `build/src/abap/5_syntax/basic_types.js` lines ~484–540 and ~690–720 and
   see where it gives up.

And what nobody has: **no open-source ABAP RAP runtime exists anywhere.** The
2026-09-11 ecosystem audit already found this (`docs/2026-09-11-lars-ecosystem-audit.md`
§3: `open-abap-sadl` / `-cds` / `-rap` are interface stubs) and nothing found
today contradicts it. The nearest analogue in another language is CAP
(`@sap/cds`), whose core is proprietary — and CAP's model is not RAP's.

---

## Open questions, stated as such

- Whether 1909 supports the **managed** implementation type at all (§3).
  Medium-high confidence it does not; settled by one `query`.
- Which **SRVB binding versions** 1909 offers (V2 UI, V4 UI, Web API). The 2019
  branch has no `.srvb` to check, and SAP's 2020 deck is planning material.
  Medium confidence both V2 and V4 UI exist. Settled by opening the ADT
  new-service-binding wizard.
- Whether **abapGit on A4H can serialize BDEF/SRVD/SRVB** (§5 step 1). Unknown
  and load-bearing: the whole export plan depends on it.
- Whether an ADT-generated behavior pool skeleton is **deterministic** enough to
  be a `--check` target the way SEGW's generated classes are. Unknown until we
  have two of them.

**Nobody touches A4H until Alice says go.** Stage R0 and all of the sizing above
need no system at all.

### Sources

- [SAP-samples/abap-platform-refscen-flight](https://github.com/SAP-samples/abap-platform-refscen-flight) (Apache-2.0; branches `ABAP-platform-2019` … `-2025`, `-cloud`)
- [SAP/abap-file-formats](https://github.com/SAP/abap-file-formats) and [specification.md](https://github.com/SAP/abap-file-formats/blob/main/docs/specification.md)
- [SAP/abap-file-formats-tools](https://github.com/SAP/abap-file-formats-tools)
- [abapGit `zcl_abapgit_object_bdef`](https://github.com/abapGit/abapGit/blob/main/src/objects/zcl_abapgit_object_bdef.clas.abap), [abapGit file formats](https://docs.abapgit.org/development-guide/serializers/file-formats.html)
- [SAP-samples/abap-cheat-sheets — EML for RAP](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/08_EML_ABAP_for_RAP.md)
- [SAP-samples/abap-platform-rap-opensap](https://github.com/SAP-samples/abap-platform-rap-opensap)
- [SAP Help — Business Object Implementation Types](https://help.sap.com/docs/abap-cloud/abap-rap/business-object-implementation-types), [RAP Business Object Contract](https://help.sap.com/docs/abap-cloud/abap-rap/rap-business-object-contract), [Draft-Enabling the Managed Business Object](https://help.sap.com/docs/abap-cloud/abap-rap/draft-enabling-managed-business-object)
- [SAP Community — RAP topic page](https://pages.community.sap.com/topics/abap/rap), [RAP FAQ](https://community.sap.com/t5/technology-blog-posts-by-sap/abap-restful-application-programming-model-rap-faq/bc-p/13484537)
- [SAP PM deck, *OData service development options*, March 2020](https://abap-blog.ru/wp-content/uploads/2020/04/2020.04.09-Overview-OData-Development-Options-On-ABAP-Platform.pdf) — planning material, treated as such
