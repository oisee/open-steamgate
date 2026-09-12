# SEGW closure: generated classes of foreign projects compile against open-abap-odata

**Date:** 2026-09-12 · **Tool:** `npm run segw:closure` (`tools/segw-closure.mjs`) ·
**Corpus:** the eight public abapGit repositories with SEGW projects under
`.local/corpus/` (untracked; the repositories are public, their names are fine here).

The generator (`tools/segw-gen.mjs`) writes what transaction SEGW writes for a
project: `_MPC`, `_DPC` and the empty `_EXT` subclasses. The question this
answers: does that output compile against open-abap-odata without a single
edit, for every SEGW project we can find? If yes, "clone a SEGW repository,
serve it" needs nothing from the project author beyond what they already
committed.

## Method

For every `<project>.iwpr.xml` under the corpus the script generates the four
classes, adds the DDIC objects of the same repository (tables, structures,
table types, data elements, domains, views, search helps, lock objects), and
syntax-checks them with abaplint (`parser_error`, `check_syntax`,
`unknown_types`, `implement_methods`, `method_implemented_twice`,
`check_ddic`, `check_abstract`) against open-abap-core, express-icf-shim and
open-abap-odata (`.local/lars/open-abap-odata`, `--odata <folder>` to point at
a fork). Style rules are off: SEGW's output is lower case and tab indented.

Every issue lands in one bucket:

| Bucket | Meaning | Whose problem |
|---|---|---|
| `ddic` | a type the repository relies on and nobody ships: SAP-standard data elements, Gateway framework tables an application exposes as an entity, objects the repository did not commit | not ours; the project would need them on any system |
| `generator` | the generated class is wrong in itself: duplicate methods or types, a base class that does not compile | `segw-gen.mjs` |
| `odata` | the generated class calls something open-abap-odata does not have | the library; the actionable list |

The script exits 1 while `generator` or `odata` is non-zero; without a corpus
(CI) it prints skip and exits 0. `--names` lists the `ddic` names per project
and across the corpus.

The one project that also runs end to end (transpile, register the pair in
`zcl_oao_registry`, `GET $metadata`, `GET PersonSet`) is
`abap_simple_odata_service`: `$metadata` carries the model of the IWPR, the
entity set read raises `/IWBEP/CX_MGW_NOT_IMPL_EXC` from the base DPC because
the `_EXT` classes are empty, exactly as on a Gateway right after generation.

## Result, after open-abap-odata #49–#52

| Project | Repository | Entity types | Issues | ddic | generator | odata |
|---|---|---|---|---|---|---|
| Z_4_MONSTER | ABAPToTheFuture04 | 2 | 201 | 201 | 0 | 0 |
| Z_4_MONSTER_DELIVERY_CDS_PULL | ABAPToTheFuture04 | RDS | skip | | | |
| /MINDSET/FIORI_MONITOR | MindsetAppAnalyzerFree | 15 | 40 | 40 | 0 | 0 |
| ZSAP_TOOLS_CORE | abap-sap-tools | 2 | 4 | 4 | 0 | 0 |
| ZSAP_TOOLS_TRANS_ORDER | abap-sap-tools | 11 | 76 | 76 | 0 | 0 |
| ZSAP_TOOLS_TRANSLATE | abap-sap-tools | 8 | 83 | 83 | 0 | 0 |
| ZFTENT_HOWTO_ODATA | abap_simple_odata_service | 1 | 14 | 14 | 0 | 0 |
| YSL_PROBLEM_MANAGEMENT | spacelab-problem-management-backend-live | 18 | 622 | 622 | 0 | 0 |
| ZUI5_CODE_SEARCH | ui5-code-search | 3 | 99 | 99 | 0 | 0 |

Closed. The `ddic` counts are one line per use site of a missing type, not
one per type; the distinct names are below. The RDS project (reference data
source, SADL) is skipped because the generator has no RDS templates yet.

## What the library was missing

Found by this run on the corpus and added to open-abap-odata the same day:

- **#49** `set_type_edm_guid`, `set_type_edm_binary`, `set_type_edm_datetimeoffset` on
  `/iwbep/if_mgw_odata_property` (plus `int64`, `double`, `single`, `float`,
  `sbyte` for completeness), with the `$metadata` facets the Gateway prints.
- **#50** complex types: `create_complex_type` on the model,
  `/iwbep/if_mgw_odata_cmplx_type` with `create_property`, `bind_structure`,
  `get_property`, `get_properties`, `create_complex_property` on the entity
  type, `<ComplexType>` in `$metadata`.
- **#51** `bind_input_structure` on `/iwbep/if_mgw_odata_action`.
- **#52** `/IWBEP/SB_ODATA_TY_INT2`, the data element SEGW uses for `Edm.Int16`
  properties of entity types not bound to a DDIC structure.

Everything else a generated DPC references (`/IWBEP/IF_SB_DPC_COMM_SERVICES`,
`/IWBEP/IF_SB_GEN_DPC_INJECTION`, `/iwbep/cl_cos_logger`,
`/iwbep/cl_sb_gen_dpc_rt_util`, `/iwbep/sup_msg_longtext`, the
`/IWBEP/IF_MGW_REQ_ENTITY_C/_D/_U` contexts, `copy_data_to_ref`,
`ty_s_mgw_response_entity_cntxt`, `bapiret2`, `BAPI_TRANSACTION_COMMIT`) was
already in open-abap-odata or open-abap-core.

Two generator bugs surfaced the same way and are fixed (52899bc): the
`GC_`/`DEFINE_`/`TS_` suffixes came from the project's `TECH_NAME` instead of
the entity name, so `FLPLogIn`, `FLPBrowser`, `FLPDevice` collapsed into one
`DEFINE_FLPLOGIN` and `objectTranslate`, `objectText` into one
`DEFINE_OBJECTSTEXT`.

## Missing standard DDIC (the `ddic` bucket)

SAP-standard data elements, structures and table types the corpus projects
type their entities with, absent from open-abap-core. Names of standard
objects are public; a project that uses them needs them on any system it runs
on, so this is the list to consult when a cloned service does not compile,
not a to-do for the libraries. Customer namespaces of the projects themselves
(`Z*`, `Y*`) are not listed.

`/BOBF/CONF_KEY`, `/BOBF/S_FRW_KEY_INCL`, `/BOBF/UUID`, `/IWFND/SU_ERRLOG`
(the Gateway error log structure, exposed as an entity by Mindset),
`AC_BOOL`, `AC_STRING`, `AD_NAMTEXT`, `AD_SMTPADR`, `AICRM_IRT_STATUS_ICON`,
`AICRM_MPT_STATUS_ICON`, `AIC_S_ATTACHMENT_INCDNT_ODATA`,
`AIC_S_TEXT_INCDNT_ODATA`, `BU_MCNAME1`, `BU_PARTNER`, `CHAR100`, `CHAR1024`,
`CHAR200`, `CHAR258`, `CHAR5`, `CHAR50`, `CHAR64`, `CNAM`,
`COMT_PRODUCT_GUID`, `COMT_PRODUCT_ID`, `COMT_PRSHTEXTX`, `COSEL`,
`CRMDT_XSTRING`, `CRMT_DATE_TIMESTAMP_FROM`, `CRMT_OBJECT_GUID`,
`CRMT_OBJECT_ID_DB`, `CRMT_PRIORITY`, `CRMT_PROCESS_TYPE`,
`CRM_ERMS_CAT_CA_DESC`, `CRM_ERMS_CAT_CA_ID`, `CRM_ERMS_CAT_GUID`,
`DDPOSITION`, `HROBJID`, `IHTTPNAM`, `INTEGER`, `J_ESTAT`, `J_STSMA`,
`J_TXT30`, `KO100`, `LVC_FNAME`, `LVC_TIP`, `LVC_TITLE`, `LVC_T_STYL`,
`LXECHAR1024`, `LXEISOLANG`, `LXEOBJTYPE`, `LXETEXTKEY`, `NAME_FELD`,
`NAME_KOMP`, `NUMC7`, `O2APPLNAME`, `O2PAGEEXT`, `O2_PAGLINE`, `OTYPE`,
`PACKNAME`, `PD_OBJID_R`, `PERNR_D`, `PGMID`, `POSNR`, `POSNUMMER`,
`RDIR_CDATE`, `RDIR_UDATE`, `SALV_DE_SORT_GROUP`, `SAP_BOOL`, `SCUID`,
`SC_APTGUID`, `SC_TSTFRO`, `SC_ZONEFRO`, `SDRAFT_WRITE_DRAFT_ADMIN`,
`SHORT_D`, `SKWF_MIME`, `SLICINST`, `SLICSID`, `SLIC_SYSID`, `SLIS_VARI`,
`SO_OBJ_DES`, `SO_OBJ_TP`, `SO_SND_BC`, `SO_SND_CP`, `STEXT`, `SYSUUID_X`,
`TDID`, `TDOBNAME`, `TDSPRAS`, `TIMEDURA`, `TIMEUNITDU`, `TROBJTYPE`,
`TRSTATUS`, `TR_AS4USER`, `UNAM`, `USGRP_USER`, `UZEIT`, `VBELN`,
`W3CONTTYPE`, `XSTRINGVAL`, `XUBNAME`.

Where each name goes, after Lars's rule of 2026-09-12 (open-abap-core takes
only released data elements, the C1 contract, and stays small; everything
else is either taken from a dump or goes to open-abap/open-abap-deprecated):

- **Released**, in `abapedia/steampunk-2305-api`, so for open-abap-core:
  `CHAR5`, `CHAR64`, `CHAR100`, `CHAR200` (open-abap-core #1213), `BAPIWAIT`
  (with the `BAPI_TRANSACTION_COMMIT` PR).
- **In `abapedia/s4-private-2022-doma-and-dtel`** (released + deprecated DOMA
  and DTEL of S/4 2022, abapGit format, 23,661 data elements): not copied
  anywhere, the dump is added as a library. From this list: `UZEIT`, `VBELN`,
  `POSNR`, `PERNR_D`, `UNAM`, `CNAM`, `PGMID`, `TROBJTYPE` and most of the
  CRM/BOPF/LXE/SO names; the closure run with the dump as a library says
  exactly how much of the `ddic` bucket it removes.
- **Neither**, so open-abap-deprecated (#1 there): `CHAR50`, `CHAR258`,
  `CHAR1024`, `NUMC7`, `INTEGER`, `SAP_BOOL`, `BU_PARTNER`, `XUBNAME`,
  `SYSUUID_X`, `DDPOSITION`, `TRSTATUS`, `TR_AS4USER`. Structures such as
  `/IWFND/SU_ERRLOG` and the application-specific ones are not written
  from memory; they need a source with their field lists.
