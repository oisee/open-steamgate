# Oracle for draft handling (OData V2, SEGW/SADL)

**Date:** 2026-09-13 · **Status:** research + plan, nothing built, nothing called.

> **Nobody touches A4H until Alice says go.** This document is a work order for a
> human sitting at the sandbox, not an instruction the agent may execute. No MCP
> action in §4 has been run. No export exists yet beyond what §2 already found.

The question: what must exist, and what must be obtained from A4H, before we can
implement Fiori Elements V2 draft handling in `src/gateway/` + `src/sadl/`
without inventing the shape of a single SAP artifact.

---

## 1. What we must see to implement draft without inventing anything

Draft in the ABAP Programming Model for Fiori is four layers. Each needs its own
oracle, and they come from **different** object types — this is the central fact
of this document.

### 1.1 Persistence (DDIC)

| Artifact | Why needed |
|---|---|
| The **active** table of a draft-enabled BO | the baseline; `Edit` copies from it, `Activation` writes back into it |
| The **draft** (shadow) table named by `@ObjectModel.writeDraftPersistence` | the shape is not free: active fields + a UUID key + the draft admin include. We must generate it from the CDS annotation, byte-compatible with what SE11/the BO generator produces |
| `SDRAFT_WRITE_DRAFT_ADMIN` (structure, `.INCLUDE` in every draft table) | its field list and types are the draft row's bookkeeping. Needed to generate draft tables at all |
| Data elements `SDRAFT_HAS_ACTIVE`, `SDRAFT_HAS_DRAFT`, `SDRAFT_IS_ACTIVE`, `SDRAFT_CONSISTENCY_STATUS`, `SDRAFT_ENTITY_NAME`, `SDRAFT_KEY`, `SADL_GW_DYNAMIC_ACTN_PROPERTY` | the EDM types of `HasActiveEntity` / `HasDraftEntity` / `IsActiveEntity` and of the four dynamic action-control properties follow from these. Getting `Edm.Boolean` vs `Edm.String` wrong breaks FE V2 binding |
| `/BOBF/UUID`, `/BOBF/S_FRW_KEY_INCL`, `/BOBF/CONF_KEY` | the key type of every draft-enabled node is a RAW16 UUID, not a CHAR key. Our `$filter`/JSON/key-parsing path has never seen one |
| The **draft administrative** persistence behind `I_DraftAdministrativeData` (`SDRAFT_ADMIN_CDS` and whatever table it reads) and `SDRAFT_ADMIN_LOG` | `DraftAdministrativeData` is a real entity in the service's `$metadata` and FE V2 reads `CreatedByUser` / `LastChangeDateTime` / `InProcessByUser` / `DraftIsCreatedByMe` from it |

### 1.2 Behaviour model (BOPF)

| Artifact | Why needed |
|---|---|
| The generated BO: `/BOBF/OBM_BO`, `_NODE`, `_ACTION`, `_ASSOC`, `_ALTKEY`, `_DETERMINATION` rows for one draft-enabled CDS view | the *names* of the actions the SADL exposure turns into function imports, and the alternative key by which the draft row finds its active sibling |
| The generated constants interface `ZIF_<view>_C` | abapGit *does* serialize this one; it is the readable index of the BO (actions, nodes, determinations, alternative keys) |
| The generated `/BOBF/CL_LIB_*` subclasses (auth, determination) | proof of what is generated code vs. framework code — i.e. what we must reimplement vs. what we may hard-wire |

### 1.3 Service exposure (SEGW / SADL)

| Artifact | Why needed |
|---|---|
| `<project>.iwpr.xml` of a SEGW project that exposes the draft-enabled CDS view as a **Reference Data Source** | our `tools/segw-gen.mjs` oracle format. Tells us whether SEGW stores anything draft-specific at all (finding in §2: it does not) |
| The generated `_MPC` with its `TS_<view>TYP` types and `define_rds_N` / `IF_SADL_GW_MODEL_EXPOSURE_DATA~GET_MODEL_EXPOSURE` | the **exposed field set**: which draft fields the generator adds to the CDS fields, and the `<sadl:definition>` text verbatim. This is the byte-for-byte target for `segw-gen`'s missing RDS templates |
| The generated `_DPC` with its `I_DRAFTADMINISTR_*` and `<view>_*` method blocks | the dispatch surface: which operations a draft service declares, and that all of them delegate to `if_sadl_gw_dpc_util~get_dpc( )` |
| `<service>.iwsv.xml` / `<model>.iwmo.xml` / `<anno>.iwvb.xml` | registry entries `tools/segw-registry.mjs` already consumes; the IWVB says whether an annotation provider class is in play (`CL_SADL_GW_CDS_EXPOSURE_APC`) |

### 1.4 The wire (the one we do not have)

| Artifact | Why needed |
|---|---|
| **`$metadata` of a live draft service** (`/sap/opu/odata/sap/<SRV>/$metadata?sap-language=EN`) | the only authority for: the compound key `(<Key>, IsActiveEntity)`; `sap:creatable`/`updatable`/`deletable` on a draft entity set; the four `<FunctionImport>` elements (`<Entity>Edit`, `<Entity>Activation`, `<Entity>Preparation`, `<Entity>Validation`) with `sap:action-for` and `sap:applicable-path` pointing at `A_EDIT` / `A_ACTIVATION` / …; the `SiblingEntity` and `DraftAdministrativeData` navigation properties and their association sets; the `Common.DraftRoot` / `Common.DraftNode` annotation with `EditAction` / `ActivationAction` / `PreparationAction` / `ValidationFunction` / `NewAction`; `Common.SemanticObject`-style extras SADL adds. Attribute order and naming cannot be guessed |
| A **`$batch` trace** of an FE V2 draft app doing Create / Edit / change / Save / Discard | the request flow: which calls sit in one changeset, whether `Edit` is POST to the function import or a POST to the set, what `Activation` returns, whether Discard is `DELETE <Set>(key=…,IsActiveEntity=false)`, and the exact `If-Match` / `x-http-method` headers |
| The **FE V2 draft app** that drives it (manifest + annotations) | so our Playwright e2e drives the same UI paths a real app does |

---

## 2. What already exists locally (grepped, 2026-09-13)

Better than expected. Three of the four layers already have an oracle on disk.

### 2.1 A complete draft-enabled SEGW/SADL service — in the **public** corpus

`.local/corpus/ABAPToTheFuture04/src/z4_01_business_objects/z4_015_delivery/`
(Paul Hardy's *ABAP to the Future* code; a public abapGit repo, already part of
the closure corpus — `docs/segw-closure.md` lists its second project as
`Z_4_MONSTER_DELIVERY_CDS_PULL | RDS | skip`).

- `z4cds_monster_deliveries.ddls.asddls` — the draft-enabled CDS view:
  `@ObjectModel.draftEnabled: true`, `@ObjectModel.writeActivePersistence: 'Z4T_DELIVERIES'`,
  `@ObjectModel.writeDraftPersistence: 'Z4T_DRAFT_DELS'`,
  `@ObjectModel.transactionalProcessingEnabled: true`, `@ObjectModel.compositionRoot: true`,
  `@ObjectModel.alternativeKey: [{element: ['DELIVERY_NUMBER']}]`.
- `z4t_draft_dels.tabl.xml` — **the draft table, in full**:
  `MANDT` (key), `DB_KEY` (key, `/BOBF/UUID`), every active field,
  `ACTIVEUUID` (`/BOBF/UUID`), `HASACTIVEENTITY` (`SDRAFT_HAS_ACTIVE`),
  `.INCLUDE SDRAFT_WRITE_DRAFT_ADMIN`. No `ISACTIVEENTITY` column (a draft row is
  always inactive), no `HASDRAFTENTITY` (derived).
- `zcl_z_4_monster_delive_mpc.clas.abap` — **the exposed field set**:
  `TS_Z4CDS_MONSTER_DELIVERIESTYP` = `INCLUDE TYPE Z4V_MONS_DELS` plus
  `ACTIVEUUID`, `DRAFTENTITYCREATIONDATETIME`, `DRAFTENTITYLASTCHANGEDATETIME`,
  `HASACTIVEENTITY` (`SDRAFT_HAS_ACTIVE`), `HASDRAFTENTITY` (`SDRAFT_HAS_DRAFT`),
  `ISACTIVEENTITY` (`SDRAFT_IS_ACTIVE`), and
  `A_ACTIVATION` / `A_EDIT` / `A_PREPARATION` / `A_VALIDATION`
  (`SADL_GW_DYNAMIC_ACTN_PROPERTY`) — the `sap:applicable-path` targets.
  A second entity type `TS_I_DRAFTADMINISTRATIVEDATATY TYPE SDRAFT_ADMIN_CDS`.
- `zcl_z_4_monster_delive_dpc.clas.abap` — the RDS DPC: method blocks
  `I_DRAFTADMINISTR_{GET,CREATE,UPDATE,DELETE}_ENTITY[SET]` and
  `Z4CDS_MONSTER_DE_*`, all delegating to `if_sadl_gw_dpc_util~get_dpc( )`.
  `execute_action` likewise. **No draft logic in generated code.**
- `zif_4cds_monster_deliveries_c.intf.abap` — the BO index:
  actions `EDIT` (attribute `PRESERVE_CHANGES`), `ACTIVATION`, `PREPARATION`
  (`SIDEEFFECTSQUALIFIER`), `VALIDATION` (`SIDEEFFECTSQUALIFIER`),
  plus `CREATE_*`/`UPDATE_*`/`DELETE_*`/`SAVE_*`/`LOCK_*`/`UNLOCK_*`/`VALIDATE_*`;
  alternative key `ACTIVE_ENTITY_KEY`; nodes `<view>`, `_LOCK`, `_MESSA`, `_PROPE`;
  determinations `DRAFT_ACTION_CONTROL`, `DRAFT_SYS_ADMIN_DATA`,
  `ACTION_AND_FIELD_CONTROL`, `CENTRAL_ADMIN_DATA`,
  `DELETE_DRAFT_WHN_ACTIVE_DELETE`, `DURABLE_LOCK_CLEANUP_*`;
  node attributes incl. `DRAFTENTITYCONSISTENCYSTATUS`.
  **This also yields the members of `SDRAFT_WRITE_DRAFT_ADMIN`** —
  `DRAFTENTITYCREATIONDATETIME`, `DRAFTENTITYLASTCHANGEDATETIME`,
  `DRAFTENTITYCONSISTENCYSTATUS` (types still to be confirmed, §4).
- `zs4cds_monster_deliveries.tabl.xml` / `_d` / `_dr` / `zsk_..._ac` —
  the BOPF combined / data / draft-read / alternative-key structures.
- `z_4_monster_delivery_cds_pull.iwpr.xml` (832 lines) — **contains no draft,
  action, `IsActiveEntity` or `Sibling` node whatsoever.** The SEGW tree only
  names the reference data source. Everything draft-shaped is derived by the
  generator from the CDS `@ObjectModel` annotations and by the SADL runtime at
  request time.
- `z_4_monster_delivery_cd_anno_mdl0001.iwvb.xml` — annotation provider
  `CL_SADL_GW_CDS_EXPOSURE_APC`.
- `zcl_au_4cds_monster_deliveries.clas.abap` (`/BOBF/CL_LIB_AUTH_DRAFT_ACTIVE`),
  `zcl_d_4cds_monster_deliveries0.clas.abap` (`/BOBF/CL_LIB_D_SUPERCL_SIMPLE`) —
  generated BOPF hooks, both empty.

**Not in that repo:** the BO model itself. No `/BOBF/OBM_*` content, no `.bobx`.
Confirms the AGENDA note that abapGit does not serialize the BO model.

### 2.2 `DraftAdministrativeData` — in `.local/corpus-sap/`

`.local/corpus-sap/<DRAFT-ADMIN-SAMPLE>/src/<draft-admin-sample>/`
(SAP-delivered, exported from A4H on 2026-09-12; already listed in `docs/segw-tree.md`).

This is the draft **monitoring** app, not a draft-enabled transactional service —
its exposure is `maxEditMode="RO"` over three consumption views. Still, it gives:

- `<draft admin CDS view>.ddls.asddls` — `<draft admin CDS view>` over
  `I_DraftAdministrativeData`, with `@UI.lineItem … {type: #FOR_ACTION, dataAction: 'MPC_EXT:TakeOverDraft'}`,
  `@ObjectModel.association.type: [#TO_COMPOSITION_CHILD / #TO_COMPOSITION_PARENT, #TO_COMPOSITION_ROOT]`.
- `<draft admin field view>.view.xml` — **the `DraftAdministrativeData` field list**, read
  from `SDRAFT_ADMIN_CDS`: `MANDT`, `DRAFTENTITYTYPE`, `DRAFTUUID`, `OBJECTKEY`,
  `CREATEDBYUSER`, `CREATEDBYUSERDESCRIPTION`, `CREATIONDATETIME`,
  `LASTCHANGEDBYUSER`, `LASTCHANGEDBYUSERDESCRIPTION`, `LASTCHANGEDATETIME`,
  `INPROCESSBYUSER`, `INPROCESSBYUSERDESCRIPTION`, `PROCESSINGSTARTDATETIME`,
  `ENQUEUESTARTDATETIME`, `DRAFTACCESSTYPE`.
- `<draft log view>.view.xml` — the log table `SDRAFT_ADMIN_LOG`
  (`CLIENT`, `DRAFT_ENTITY`, `DRAFT_KEY`, `LOGNUMBER`, `OBJECT_KEY`).
- `<draft config view>.view.xml` — `SDRAFT_LC_CONFIG` joined with `/BOBF/OBM_BO` and
  `/BOBF/OBM_OBJT`: the lifecycle/expiry configuration.
- `<draft takeover class>.clas.abap` — a real function-import
  implementation over `cl_draft_admin_access=>change_owner`, with
  `sdraft_entity_name` / `sdraft_key` as parameter types.
- `<draft object-key class>.clas.abap` — `cl_draft_lifecycle_handler=>get_bo_keys`,
  `if_draft_admin_access=>tt_sdraft_admin` (`draft_entity`, `draft_key`, `d_key`).
- `<draft admin MPC>.clas.abap` — a real SEGW **RDS** MPC verbatim:
  `define_rds_4`, `get_last_modified_rds_4`,
  `IF_SADL_GW_MODEL_EXPOSURE_DATA~GET_MODEL_EXPOSURE` with
  `<sadl:definition … syntaxVersion="">` and `cl_sadl_gw_model_exposure=>get_exposure_xml`.
  Together with §2.1's MPC this is a sufficient oracle for the RDS templates
  `tools/segw-gen.mjs` is missing.
- `<draft admin DPC_EXT>.clas.abap` — how a `_DPC_EXT` post-processes a
  SADL read (`super->` then enrich) and dispatches a function import.

### 2.3 `Common.DraftRoot` / `Common.DraftNode` as Gateway vocabulary

`.local/corpus-sap/<SEARCH-ODATA-SAMPLE>/src/<search-odata-sample>/<search-annotation-project>.iwpr.xml`
declares, in a `PROJECT_TYPE 3` annotation-reference model:
complex types `DraftRootType` and `DraftNodeType` (`DraftRootType.BASE_TYPE = DraftNodeType`),
term mappings `VALUE_NA = DraftRoot` / `DraftNode` under plugin `/IWBEP/ODATA`,
and a property `IsActiveEntity`.
**Their member properties are not in the export** — no `EditAction` /
`ActivationAction` / `PreparationAction` / `ValidationFunction` rows are present.
So the term *exists* in the tree format; its payload does not.

### 2.4 Nothing else

- `.local/corpus-sap/<EPM-SADL-TX-SAMPLE>/` — "TX" is BOPF-transactional
  (a plain `Address` entity over a `/BOBF/` `NODE_KEY`, generated 2014). **Not draft.**
- No `$metadata` capture, no `$batch` trace, no draft-enabled FE V2 app anywhere
  under `.local/`. `.local/capture/` does not exist yet.
- No draft support in our tree: `grep -ril draft src/ tools/ test/ webapp/` hits
  only prose in `docs/` and one unrelated line in `test/e2e/listreport.spec.mjs`.
- No draft support in `open-abap-odata`: `.local/lars/open-abap-odata/src/` has no
  draft/SADL-draft interface; `sap:action-for` appears only in
  `src/internal/zcl_oao_http_handler.clas.abap`.
- **None of the standard DDIC draft objects exist locally.**
  `find .local/{lars,corpus,corpus-sap} -iname '*sdraft*'` etc. returns nothing for
  `SDRAFT_WRITE_DRAFT_ADMIN`, `SDRAFT_HAS_ACTIVE`, `SDRAFT_HAS_DRAFT`,
  `SDRAFT_IS_ACTIVE`, `SADL_GW_DYNAMIC_ACTN_PROPERTY`, `SDRAFT_ADMIN_CDS`,
  `SDRAFT_ENTITY_NAME`, `SDRAFT_KEY`, `/BOBF/UUID`, `/BOBF/S_FRW_KEY_INCL`.
  `.local/lars/s4-private-2022-doma-and-dtel/src/` (23,851 DTEL) carries only
  `sdraft_uuid.dtel.xml` and `sdraft_consistency_status.dtel.xml` — the four types
  we need are **absent**.
  `docs/segw-closure.md` already lists `SDRAFT_WRITE_DRAFT_ADMIN` in the corpus-wide
  missing-DDIC bucket.
- `tools/segw-gen.mjs:1583` skips every RDS project
  (`"reference data source (SADL) project: the RDS templates are not generated yet"`),
  so both §2.1 and §2.2 projects are currently unverified by `--check`. The SADL XML
  it *does* emit (line 1275 ff., for `stg-compile`'s `cds:` sources) uses
  `syntaxVersion="V2"` and `maxEditMode="RO"`; real SEGW RDS output uses
  `syntaxVersion=""`. That gap is a **prerequisite**, not part of draft.

**Honest summary of what is missing:** the wire (§1.4) entirely, the standard
DDIC draft types, and the BO model. Everything else is already on disk.

---

## 3. Minimal build on A4H

Goal: one draft-enabled BO, exposed through SEGW as a reference data source,
registered so `$metadata` is fetchable — in **one transportable package** so that
`system git_export` yields the oracle in one shot.

Package: **`Z_STG_DRAFT`** (a real package, not `$TMP`; `$TMP` does not export).
Software component `HOME`, transport layer whatever the sandbox uses.

| # | Object | Tool | Contributes |
|---|---|---|---|
| 1 | `ZSTG_DRAFT_ROOT` — active table: `MANDT`, `DB_KEY` (key, `/BOBF/UUID`), `TRAVEL_ID` (CHAR10), `AGENCY` (CHAR20), `STATUS` (CHAR1), `PRICE` (CURR), `CURRENCY` (CUKY), `BEGIN_DATE` (DATS) | SE11 | the active persistence; deliberately mirrors the demo's `Travel` so the result drops onto our existing model |
| 2 | `ZSTG_DRAFT_ROOT_D` — draft table | SE11, **or leave to the generator** | the shadow table. Preferred: let activation of #3 generate it, so we see what the framework writes rather than what a human typed. If the generator will not create it, copy #1 and add `ACTIVEUUID`, `HASACTIVEENTITY`, `.INCLUDE SDRAFT_WRITE_DRAFT_ADMIN` per §2.1 |
| 3 | `ZSTG_I_DRAFTROOT` — CDS view over #1 with `@ObjectModel.modelCategory: #BUSINESS_OBJECT`, `compositionRoot: true`, `transactionalProcessingEnabled: true`, `draftEnabled: true`, `writeActivePersistence: 'ZSTG_DRAFT_ROOT'`, `writeDraftPersistence: 'ZSTG_DRAFT_ROOT_D'`, `createEnabled`/`updateEnabled`/`deleteEnabled`/`writeEnabled: true`, `alternativeKey`/`semanticKey` on `TRAVEL_ID`, plus `@UI.lineItem`/`@UI.facet`/`@UI.fieldGroup` so a Fiori app renders | ADT (Eclipse); DDLS cannot be created in SE11 | **the whole point.** Activating it triggers BO generation: the BOPF BO, `ZIF_ZSTG_I_DRAFTROOT_C`, the `/BOBF/CL_LIB_*` subclasses, the draft table if #2 was left out |
| 4 | SEGW project **`ZSTG_DRAFT`**, service `ZSTG_DRAFT_SRV`, model `ZSTG_DRAFT_MDL` | transaction **SEGW** → new project, type *Service with SAP Annotations* → *Data Model* → right-click → **Reference → Data Source**, type *Business Entity / Reference Data Source*, name `ZSTG_I_DRAFTROOT` → **Generate Runtime Objects** | the IWPR tree + the generated `_MPC`/`_DPC`/`_EXT` pair + IWSV/IWMO/IWVB: the `segw-gen` oracle for the RDS-with-draft shape |
| 5 | Service registration | `/IWFND/MAINT_SERVICE` → Add Service, system alias LOCAL, `ZSTG_DRAFT_SRV` | makes `$metadata` and `$batch` reachable over HTTP. Without this there is no §1.4 oracle |
| 6 | *(optional, second pass)* `ZSTG_DRAFT_ITEM` + `ZSTG_DRAFT_ITEM_D` + `ZSTG_I_DRAFTITEM` with `@ObjectModel.compositionParent`/`association [1..*]` from #3, added to the same SEGW project | SE11 + ADT + SEGW | draft of a **composition child**: `SiblingEntity` on two levels, draft-of-child creation, the `Create` case FE V2 only offers with draft. Skip on the first pass — root-only already answers every question in §1.4 |

That is **four to six objects**. Everything else (draft admin tables, the four
actions, the lock/message/property nodes) is standard and generated.

Naming rule: keep the `ZSTG_` prefix so the export is recognisable next to
`.local/corpus-sap/`, and so nothing collides with a real customer namespace.

---

## 4. Export and inspection, in terms of the two MCP actions

All output under `.local/` — **never committed** (`.gitignore` already covers it).

### 4.1 `system git_export`

```
package = Z_STG_DRAFT   →   .local/corpus-sap/ZSTG_DRAFT/
```

Same convention as the existing exports: a zip
`.local/corpus-sap/ZSTG_DRAFT_<YYYYMMDD_HHMMSS>.zip` plus the unpacked
abapGit-shaped tree `.local/corpus-sap/ZSTG_DRAFT/src/z_stg_draft/`.

Expected contents, and what each is for:

| File | Use |
|---|---|
| `zstg_draft.iwpr.xml` | `npm run segw:gen -- .local/corpus-sap/ZSTG_DRAFT/src/z_stg_draft --check` — does our generator reproduce a draft RDS project? |
| `zcl_zstg_draft_mpc.clas.abap` | the exposed field set + `<sadl:definition>` verbatim. The byte target |
| `zcl_zstg_draft_dpc.clas.abap` | the dispatch surface |
| `*_mpc_ext` / `*_dpc_ext` | whether SEGW puts anything draft-specific in the `_EXT` pair |
| `zstg_draft_srv*.iwsv.xml`, `zstg_draft_mdl*.iwmo.xml`, `*.iwvb.xml` | `tools/segw-registry.mjs` input; which annotation provider is used |
| `zstg_i_draftroot.ddls.asddls` + `.ddls.xml` + `.ddls.baseinfo` | `tools/cds2ddic.mjs` input |
| `zstg_draft_root.tabl.xml`, `zstg_draft_root_d.tabl.xml` | **the generated draft table** — the shape `cds2ddic` must learn to emit |
| `zif_zstg_i_draftroot_c.intf.abap` | the BO index (actions, alt key, determinations) |
| `zcl_au_*`, `zcl_d_*` | generated BOPF hooks |
| `zs*_d.tabl.xml`, `zs*_dr.tabl.xml`, `zsk_*_ac.tabl.xml` | the BOPF combined/draft-read/alt-key structures |

Cross-check completeness with one `query`:
`SELECT object, obj_name FROM tadir WHERE devclass = 'Z_STG_DRAFT'` —
anything in TADIR that abapGit did not serialize is a known blind spot to record.

### 4.2 `query` — the DDIC the export cannot carry

Read-only SQL, results to `.local/oracle/draft/ddic/*.json` (new folder, untracked).
These are the standard objects §2.4 proved absent locally.

1. **The draft admin include** — the one blocker for generating draft tables:
   `SELECT fieldname, position, rollname, comptype, precfield, datatype, leng, decimals, keyflag FROM dd03l WHERE tabname = 'SDRAFT_WRITE_DRAFT_ADMIN' ORDER BY position`
2. **The draft flag/marker data elements:**
   `SELECT rollname, domname, datatype, leng, decimals FROM dd04l WHERE rollname IN ('SDRAFT_HAS_ACTIVE','SDRAFT_HAS_DRAFT','SDRAFT_IS_ACTIVE','SDRAFT_CONSISTENCY_STATUS','SDRAFT_ENTITY_NAME','SDRAFT_KEY','SDRAFT_UUID','SADL_GW_DYNAMIC_ACTN_PROPERTY')`
   plus the domains from `dd01l` for those `domname`s (fixed values via `dd07l` for
   `DRAFTACCESSTYPE` / consistency status).
3. **The BOPF key types:** the same two queries for `/BOBF/UUID`, `/BOBF/CONF_KEY`,
   and `dd03l` for `/BOBF/S_FRW_KEY_INCL`.
4. **The draft administrative persistence:**
   `SELECT tabname, tabclass FROM dd02l WHERE tabname LIKE 'SDRAFT%'` — to learn
   which of `SDRAFT_ADMIN_CDS` / `SDRAFT_ADMIN*` is a table and which a view;
   then `dd03l` for the table(s) found, and `dd25l`/`dd27s` for the views.
   Also `SDRAFT_ADMIN_LOG` and `SDRAFT_LC_CONFIG`.
5. **What the BO generator produced** (the layer abapGit drops):
   - `SELECT bo_key, bo_name, root_node FROM /bobf/obm_bo WHERE bo_name = 'ZSTG_I_DRAFTROOT'`
   - `SELECT node_key, node_name, data_table, data_type, node_cat FROM /bobf/obm_node WHERE bo_key = '<bo_key>'`
   - `SELECT act_key, act_name, impl_class, param_type, card FROM /bobf/obm_action WHERE bo_key = '<bo_key>'`
     — expect `EDIT`, `ACTIVATION`, `PREPARATION`, `VALIDATION`, `LOCK_*`, `SAVE_*`, `CREATE_*`, `UPDATE_*`, `DELETE_*`, `VALIDATE_*` per §2.1
   - `SELECT assoc_key, assoc_name, target_node, card FROM /bobf/obm_assoc WHERE bo_key = '<bo_key>'`
   - `SELECT altkey_key, altkey_name, key_struct FROM /bobf/obm_altkey WHERE bo_key = '<bo_key>'`
     — expect `ACTIVE_ENTITY_KEY`
   - `SELECT det_key, det_name, impl_class, pattern FROM /bobf/obm_determination WHERE bo_key = '<bo_key>'`
   (exact column names to be discovered with a `SELECT *` on one row; the table
   names are confirmed by `<draft config view>.view.xml` referencing `/BOBF/OBM_BO`
   and `/BOBF/OBM_OBJT`.)
6. **Release fingerprint**, to judge oracle validity (§6):
   `SELECT * FROM cvers` / the component release of `SAP_BASIS`, and
   `SELECT COUNT(*) FROM tadir WHERE object = 'BDEF'` (a non-zero BDEF count means
   RAP is present and the sandbox may prefer the RAP draft model).

### 4.3 What the two MCP actions cannot give — a human with a browser must

Neither `git_export` nor `query` reaches HTTP. These are hand steps for Alice,
results under `.local/oracle/draft/` (untracked):

1. `GET /sap/opu/odata/sap/ZSTG_DRAFT_SRV/$metadata?sap-language=EN`
   → `.local/oracle/draft/metadata.xml`. **The single most valuable artifact in
   this whole document.** Also the annotation document if the IWVB provider adds one
   (`/sap/opu/odata/sap/ZSTG_DRAFT_SRV/$metadata` vs. the `Annotation` service).
2. `GET .../ZSTG_DRAFT_SRV/` (service document) → `service.xml`.
3. A browser network trace (HAR, or the raw multipart bodies) of an FE V2 draft app
   on that service doing Create → change → Save, Edit → change → Save,
   Edit → Discard, and a leave-page-with-draft → resume
   → `.local/oracle/draft/batch-*.http`. The SEGW/gateway client
   (`/sap/opu/odata/sap/ZSTG_DRAFT_SRV/`) plus a generated Fiori Elements V2
   *List Report Object Page* app is enough; no deployment needed if run from
   the local UI5 tooling against the sandbox.
4. `GET .../ZSTG_DRAFT_SRV/ZSTG_I_DRAFTROOT(TravelId='…',IsActiveEntity=false)?$expand=DraftAdministrativeData,SiblingEntity`
   → one JSON payload showing the real property names and null conventions.

Scrub before anything is quoted in a tracked file: no hostnames, no user names
(the existing corpus carries a real author's user id — that is why it stays in
`.local/`), no session ids, no transport ids. Only protocol facts move into
`docs/` or `ANORMALIES.md`.

---

## 5. What can be settled without A4H at all

**Already settled (§2):**
- The draft table's physical shape, field for field (`z4t_draft_dels.tabl.xml`).
- The exposed entity type's field set, including the four `A_*` action-control
  properties (`zcl_z_4_monster_delive_mpc.clas.abap`).
- The `DraftAdministrativeData` field set (`<draft admin field view>.view.xml`).
- The BOPF action / determination / alternative-key inventory and the member names
  of `SDRAFT_WRITE_DRAFT_ADMIN` (`zif_4cds_monster_deliveries_c.intf.abap`).
- That the SEGW tree stores **nothing** draft-specific — so `stg-compile`'s
  `draft: true` will be our own extension with no IWPR oracle to match, and
  `segw-gen --check` will only ever verify the *generated classes*.
- That all draft behaviour lives in the SADL/BOPF framework, never in generated
  code — so our implementation is a clean-room framework, not a transpiled DPC.
- The real SEGW RDS class templates (`define_rds_N`, `get_model_exposure`,
  `syntaxVersion=""`), from two independent projects.

**Settleable from public sources, no sandbox:**
- The `Common` vocabulary terms: `github.com/SAP/odata-vocabularies`,
  `vocabularies/Common.xml` — `Common.DraftRoot` / `Common.DraftNode` /
  `Common.DraftAdministrativeData` with their exact member names and types. This is
  the authority for the annotation payload §2.3 is missing.
- The FE V2 client behaviour: SAPUI5 1.120 is already loaded from the CDN by our
  apps. `sap/ui/generic/app/transaction/DraftController.js`,
  `sap/ui/generic/app/util/DraftUtil.js` and
  `sap/suite/ui/generic/template/**` are readable source and state exactly which
  requests the templates issue, in which changesets, with which headers, and which
  annotations they require before they will render Edit/Save/Discard. **This can
  substitute for a large part of the §4.3 `$batch` trace.** Worth doing first — it
  is free.
- SAP Help, *ABAP Programming Model for SAP Fiori* → *Draft Handling*: the
  documented requirement that a draft table be the active table plus
  `SDRAFT_WRITE_DRAFT_ADMIN` and a UUID key; the documented meaning of
  `@ObjectModel.draftEnabled` / `writeDraftPersistence`.
- `SAP/abap-file-formats` (AGENDA's un-swept list) for the serialization formats.
- OData V2 + `sap:` extension semantics for `action-for` / `applicable-path`:
  public `sap-vocabularies` / the *SAP Annotations for OData Version 2.0* spec.

**Genuinely cannot be settled without the sandbox:**
- The byte shape of a draft service's `$metadata` — element and attribute order,
  which of the four function imports SADL actually emits and under which names
  (`<Entity>Edit` vs `Edit` vs `<Set>_Edit`), whether `SiblingEntity` is an
  association or a referential-constraint navigation, whether the draft
  annotations arrive inline or through the annotation service.
- The exact types of `SDRAFT_*` / `SADL_GW_DYNAMIC_ACTN_PROPERTY` (we know the
  names, not the EDM mapping — and `SDRAFT_IS_ACTIVE` being `CHAR1`-backed vs
  `Edm.Boolean` changes the key literal in every URL).
- Whether the draft table is generated by CDS activation or must be hand-built.
- The real `$batch` grouping and `If-Match`/ETag behaviour of the Gateway's draft
  path (the UI5 source says what the client sends, not what the server tolerates).
- Anything about BOPF determinations/validations in customer code.

---

## 6. Risks and open questions

Ordered by how much damage each does, with the cheap early detector.

**R1 — `maxEditMode="RO"`: the exposure may be read-only and the target artifact
may not be a SEGW service at all.** Both draft-related SADL exposures we have
(§2.1 and §2.2) say `maxEditMode="RO"`, and `docs/prior-art.md` / AGENDA already
note that *every* corpus SADL exposure is RO. If SEGW's reference-data-source
exposure of a draft BO is read-only on the wire, then the writable draft service
comes from somewhere else (`@OData.publish: true`, or a BOPF/SADL transactional
exposure generated outside SEGW), and the whole "SEGW project as the oracle"
framing collapses for draft.
*Detect:* step 1 of §4.3. Fetch `$metadata` and look for the four function
imports and `sap:updatable="true"` on the set. Five minutes, before any code.
If they are absent, stop and re-scope: the oracle is then the exposure mechanism,
not SEGW.

**R2 — the draft tables and the actions are framework artifacts, not SEGW
artifacts.** Confirmed already in §2.1: the IWPR has nothing, abapGit drops the BO
model. Consequence: our `--check` harnesses can verify the generated classes but
can never verify draft *semantics*; those get tests, not a byte diff. And the BO
model must be read through `query` (§4.2 step 5) or inferred from the constants
interface.
*Detect:* already detected. Plan accordingly — this is a fact, not a risk.

**R3 — release drift / RAP coupling.** A4H's release decides which draft model is
generated. The BOPF-based model (7.5x, *ABAP Programming Model for Fiori*) is what
§2.1's 2021-generated code shows and is what a V2 SEGW service needs. If the
sandbox prefers RAP (`managed … with draft`, BDEF, `SRVD`/`SRVB`), the generated
service is V4 and reaches V2 only through an adapter — a different protocol, a
different runtime, and out of v1 scope per AGENDA.
*Detect:* §4.2 step 6 (`SAP_BASIS` release, BDEF count) plus: does ADT even accept
`@ObjectModel.draftEnabled` and generate a BO on activation? If the CDS activates
but no `/BOBF/OBM_BO` row appears, it is the RAP path.

**R4 — the missing standard DDIC cannot be committed.** `SDRAFT_WRITE_DRAFT_ADMIN`
and the `SDRAFT_*` data elements are SAP standard DDIC; the clean-room rule in
CLAUDE.md forbids bundling them. We may record their *shape* as a protocol fact in
`docs/`, but the runtime needs types. Options, in order of preference:
(a) declare our own `ZSTG_*` equivalents with the same field names and widths and
generate draft tables against those (nothing SAP ships, and a real system already
has the SAP ones); (b) a PR to `open-abap/open-abap-deprecated` *only if* Lars's
routing rule covers unreleased `SDRAFT_*` — note that `s4-private-2022-doma-and-dtel`
does not contain them and itself has no license file, so it is not a precedent.
*Open question for Alice.* Default to (a).

**R5 — fixed `sy-uname` / `sy-uzeit` / client 123.** `DraftIsCreatedByMe`,
`InProcessByUser`, `CreatedByUser`, the enqueue/expiry logic and the draft lock are
all user- and time-dependent. Our runtime has one fixed user and a pinned clock
(the preview deployment pins it deliberately). Every draft will look like "mine",
"just created", never locked by another user. That is acceptable for a demo and
must be an `ANORMALIES.md` entry before any workaround, per CLAUDE.md.

**R6 — RAW16 keys and boolean keys.** `DB_KEY`/`ACTIVEUUID` are `/BOBF/UUID`
(RAW16) and the compound key carries `IsActiveEntity`. Our URL parser, key
serializer, `$filter` bridge and JSON `__metadata.uri` writer have only ever seen
CHAR and DATS keys. `guid'…'` literal form, hyphenation, upper/lower case, and
`IsActiveEntity=false` as a key literal are all new.
*Detect:* a unit test on `zcl_stg_url` + `zcl_stg_json` with a GUID key *before*
any draft work; AGENDA already budgets 1 day for it.

**R7 — no LUW bracket around `Activation`.** `$batch` changesets are still
executed one by one with no rollback (AGENDA, `$batch` section). Activation is
inherently multi-statement (write active, delete draft, delete admin row). On
DuckDB we have a real LUW with replay-based savepoints; on SQLite we do not.
*Detect:* decide up front that `Activation` runs inside the DuckDB LUW path, or
budget the SQLite transaction bracket as part of the work.

**R8 — the RDS generator is a prerequisite, not part of draft.**
`tools/segw-gen.mjs:1583` skips RDS projects. Until that is implemented, neither
§2.1 nor §2.2 nor the new `ZSTG_DRAFT` export can be `--check`ed, so we would be
building draft with the oracle harness switched off.
*Mitigation:* do the RDS templates first, against the two projects we already
have. It is verifiable today, with no sandbox.

**R9 — the export may be incomplete.** abapGit does not serialize the BO model; it
may also skip the generated `_D`/`_DR` structures or the SICF node. The `TADIR`
cross-check in §4.1 is the detector; whatever is missing gets a line in
`docs/segw-closure.md`'s ddic bucket.

---

## 7. Effort once the oracle exists

Assumes R1 comes back favourable, the RDS-generator prerequisite (R8) is counted
separately, and one developer-day is a working day in this repo's rhythm.

| Block | Work | Days |
|---|---|---|
| **Prerequisite (R8)** | RDS templates in `tools/segw-gen.mjs`: `define_rds_N`, `get_last_modified_rds_N`, `IF_SADL_GW_MODEL_EXPOSURE_DATA~GET_MODEL_EXPOSURE`, `syntaxVersion=""`, the RDS DPC method blocks; `--check` byte-identical against `DRAFT-ADMIN-SAMPLE` and `Z_4_MONSTER_DELIVERY_CDS_PULL`; both projects leave the skip list in `docs/segw-closure.md` | **1.5** |
| **Model / metadata** | draft-field injection into the exposed entity type (`ActiveUuid`, `DraftEntityCreationDateTime`, `DraftEntityLastChangeDateTime`, `HasActiveEntity`, `HasDraftEntity`, `IsActiveEntity`, `A_EDIT`/`A_ACTIVATION`/`A_PREPARATION`/`A_VALIDATION`); compound key `(<key>, IsActiveEntity)`; the `DraftAdministrativeData` entity type + set; `SiblingEntity` and `DraftAdministrativeData` navigations + association sets; four function imports with `sap:action-for` + `sap:applicable-path`; `Common.DraftRoot`/`DraftNode` through `vocab_anno_model`; the open-abap-odata setters this needs (expect 1–2 upstream PRs, as with `set_is_media` / `sap:semantics`) | **3** |
| | `draft: true` in `*.stg.yaml` → tree + generated classes + annotations (`tools/stg-compile.mjs`, `docs/stg-compile.md`) | **0.5** |
| **Runtime** | RAW16/GUID + boolean keys end to end (`zcl_stg_url`, `zcl_stg_json`, `zcl_stg_filter`, `zcl_stg_entry_provider`) — R6 | **1** |
| | draft table generation from `@ObjectModel.writeDraftPersistence` in `tools/cds2ddic.mjs` + a shared draft-admin table (`ZSTG_DRAFT_ADMIN`, the `SDRAFT_ADMIN_CDS` field set) + `zcl_stg_tab_*`-style access | **1** |
| | routing by `IsActiveEntity` in `zcl_stg_sadl_dpc`: GET from active vs. draft table, `$filter` over the union, MERGE/PATCH only on drafts, POST creating a draft, DELETE = discard, `$expand` of `SiblingEntity` / `DraftAdministrativeData` | **2** |
| | the four actions once, generically: `Edit` (active → new draft row + admin row, `PreserveChanges`), `Activation` (draft → active, delete draft + admin, inside the LUW — R7), `Preparation` / `Validation` (recompute `A_*`, messages through the message container — note the `get_message_container` gap in AGENDA's extension-point backlog) | **2** |
| **Fiori** | a draft object page app in `webapp/` (or draft on the existing `Travel`), Edit/Save/Discard, draft indicator, Create-as-draft, inline create in the bookings table (draft-only in FE V2 — the one item AGENDA's "Demo parity" listed as not done by choice) | **1** |
| | debugging FE V2's draft flow against our gateway (the part that always costs more than it looks: `DraftController` is strict about annotations and about what `Activation` returns) | **1.5** |
| **Tests** | ABAP Unit: routing, the four actions, key handling, admin-row lifecycle | **1** |
| | mocha wire test: full Create → Edit → Save → Discard over `$batch`, plus `$metadata` assertions against the captured oracle | **0.5** |
| | Playwright e2e (`test/e2e/`) + the preview build (service worker, sql.js) | **1** |
| | `ANORMALIES.md` entries (fixed user/clock — R5), `docs/draft.md` | **0.5** |

**Total: ~17.5 days**, of which 1.5 is the RDS prerequisite. Call it three to
four weeks of calendar at this repo's pace. Plus roughly **half a day of A4H work
by a human** (§3 + §4) and half a day to fold the export into the harnesses.

This is higher than AGENDA's earlier "~9 days to a working draft app". The
difference is the RDS generator prerequisite, the `$metadata`/`$batch` oracle
capture that estimate assumed away, the GUID key work, and the FE V2 draft
debugging — none of which the earlier figure priced.

**Cheapest order:** R1's `$metadata` check (five minutes, decides everything) →
read the UI5 `DraftController` source from the CDN (free, no sandbox) → the RDS
templates (verifiable today) → the A4H build and export → metadata → runtime →
Fiori → tests.

---

## Appendix — the paths named in this document

Oracles already on disk (untracked, read-only):

```
.local/corpus/ABAPToTheFuture04/src/z4_01_business_objects/z4_015_delivery/
  z4cds_monster_deliveries.ddls.asddls        draft-enabled CDS, @ObjectModel.*
  z4t_draft_dels.tabl.xml                     the draft table, field for field
  zs4cds_monster_deliveries{,_d,_dr}.tabl.xml BOPF combined / data / draft-read
  zsk_4cds_monster_deliveries_ac.tabl.xml     alternative-key structure
  zcl_z_4_monster_delive_mpc.clas.abap        exposed field set + sadl:definition
  zcl_z_4_monster_delive_dpc.clas.abap        RDS dispatch surface
  zif_4cds_monster_deliveries_c.intf.abap     BO index: actions, altkey, dets
  z_4_monster_delivery_cds_pull.iwpr.xml      SEGW tree — no draft content
  z_4_monster_delivery_cd_anno_mdl0001.iwvb.xml  CL_SADL_GW_CDS_EXPOSURE_APC
  zcl_au_4cds_monster_deliveries.clas.abap    /BOBF/CL_LIB_AUTH_DRAFT_ACTIVE
  zcl_d_4cds_monster_deliveries0.clas.abap    /BOBF/CL_LIB_D_SUPERCL_SIMPLE

.local/corpus-sap/<DRAFT-ADMIN-SAMPLE>/src/<draft-admin-sample>/
  <draft admin CDS view>.ddls.asddls      <draft admin CDS view>
  <draft admin field view>.view.xml       DraftAdministrativeData field set
  <draft log view>.view.xml               SDRAFT_ADMIN_LOG
  <draft config view>.view.xml            SDRAFT_LC_CONFIG + /BOBF/OBM_BO
  <draft admin MPC>.clas.abap             real SEGW RDS MPC template
  <draft admin DPC_EXT>.clas.abap         _EXT post-processing a SADL read
  <draft takeover class>.clas.abap        a real draft function import
  <draft object-key class>.clas.abap      cl_draft_lifecycle_handler

.local/corpus-sap/<SEARCH-ODATA-SAMPLE>/src/<search-odata-sample>/
  <search-annotation-project>.iwpr.xml    DraftRoot/DraftNode as CTYP+term
```

Ours, to be touched when the work starts:

```
tools/segw-gen.mjs:1583        the RDS skip that must go away first
tools/cds2ddic.mjs             draft table generation
tools/stg-compile.mjs          draft: true
src/sadl/zcl_stg_sadl_dpc.clas.abap        IsActiveEntity routing, the actions
src/sadl/cl_sadl_gw_model_exposure.clas.abap  draft metadata
src/gateway/zcl_stg_url.clas.abap          GUID + boolean keys
src/gateway/zcl_stg_json.clas.abap         GUID keys, __metadata.uri
src/gateway/zcl_stg_entry_provider.clas.abap
docs/segw-closure.md           the two RDS projects leave the skip list
ANORMALIES.md                  fixed user / pinned clock vs. draft semantics
```

To be created, untracked:

```
.local/corpus-sap/ZSTG_DRAFT/            git_export of package Z_STG_DRAFT
.local/oracle/draft/metadata.xml         the one thing MCP cannot fetch
.local/oracle/draft/service.xml
.local/oracle/draft/batch-*.http         FE V2 draft flow
.local/oracle/draft/ddic/*.json          the query results of §4.2
```
