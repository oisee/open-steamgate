# Sprint 0: dependency closure of real `_DPC_EXT` classes

**Date:** 2026-09-11 · **Tool:** `npm run probe -- --closure <repo>`
(`tools/closure-probe.mjs`) · **Corpus:** eight public abapGit repositories
that contain SEGW-generated MPC/DPC pairs, shallow-cloned into
`.local/corpus/` (untracked; the repos are public, their names are fine here).

The critic's claim in `docs/prior-art.md` §3 was that the dependency closure
of a real DPC (base classes, BAPIs, utils, auth checks, message classes) would
dwarf the `$filter` work. This measures it.

## Method

`--closure <repo>` seeds the abaplint registry with the repo's `*_DPC*` and
`*_MPC*` classes as main files, the open-abap libs (`open-abap-core`,
`express-icf-shim`, our `open-abap-odata` fork, this repo's `src/`) as
dependencies, and then pulls the repo's *own* objects the seeds reference
(classes, interfaces, tables, data elements, domains, table types) into the
main set until nothing own is missing any more. What is still unresolved is
the SAP-standard closure of the service itself, not of the whole repository.
Cascade messages (method-not-found on an unresolved receiver, unknown local
symbols in generated FUGR includes) are counted separately and not listed.
"Standard" is a heuristic: anything not starting with `Z`/`Y`, so a customer
namespace such as `/MINDSET/` is counted as standard; read the tables with
that in mind.

## Result

| Repo | Service shape | DPC/MPC seeds + own objects pulled | Standard closure of the service | Standard classes | Verdict |
|---|---|---|---|---|---|
| [grahamrobbo/building_gateway_services](https://github.com/grahamrobbo/building_gateway_services) | hand-written DPC over EPM (SNWD_*) demo tables, BO helper classes | 35 files (27 pulled, 4 rounds) | 40 (dtel 13, type 9, other 8, tabl 8, class/intf 2) | 2 | runnable after a DDIC capture; classes to shim: `CL_OO_OBJECT`, `CX_CLASS_NOT_EXISTENT` |
| [jasper07/Teched17](https://github.com/jasper07/Teched17) | SADL-mapped (cl_sadl_gw_dpc_factory), no hand-written GET_ENTITYSET | 16 files (0 pulled, 1 rounds) | 6 (class/intf 5, other 1) | 5 | out of v1 scope (SADL) |
| [Voelkerdo/abap_simple_odata_service](https://github.com/Voelkerdo/abap_simple_odata_service) | minimal hand-written CRUD over an internal table | 12 files (4 pulled, 3 rounds) | 1 (dtel 1) | 0 | runnable after a DDIC capture |
| [yunus-tuzun/ui5-code-search](https://github.com/yunus-tuzun/ui5-code-search) | reads BSP/O2 repository tables via CL_O2_API_PAGES | 18 files (10 pulled, 3 rounds) | 14 (dtel 9, type 2, tabl 1, class/intf 2) | 2 | runnable after a DDIC capture; classes to shim: `CL_BSP_API_GENERATE`, `CL_O2_API_PAGES` |
| [MindsetConsulting/MindsetAppAnalyzerFree](https://github.com/MindsetConsulting/MindsetAppAnalyzerFree) | Fiori monitoring over /IWFND/ log tables; partly SADL | 8 files (0 pulled, 1 rounds) | 10 (type 7, tabl 1, class/intf 1, other 1) | 1 | out of v1 scope (SADL) |
| [irodrigob/abap-sap-tools](https://github.com/irodrigob/abap-sap-tools) | transport/translation tooling: E070/E071, TRWBO_*, LXE_*, ALV | 54 files (30 pulled, 4 rounds) | 65 (type 50, tabl/view 4, tabl 8, dtel 2, other 1) | 0 | runnable after a DDIC capture |
| [hardyp/ABAPToTheFuture04](https://github.com/hardyp/ABAPToTheFuture04) | BOPF-backed business objects, ALV/SALV UI in the same package | 102 files (86 pulled, 6 rounds) | 38 (doma 5, tabl/view 3, type 15, class/intf 11, dtel 1, other 3) | 11 | out of v1 scope (BOPF); the DDIC part is capturable |
| [simplicity-goodness-truth/spacelab-problem-management-backend-live](https://github.com/simplicity-goodness-truth/spacelab-problem-management-backend-live) | product on CRM one-order API (CL_AGS_CRM_1O_API), view-maintenance FUGRs | 253 files (245 pulled, 8 rounds) | 195 (dtel 25, type 122, doma 1, class/intf 11, tabl 20, other 14, tabl/view 2) | 11 | out of v1 scope (CRM framework) |

Top of each standard closure:

- **building_gateway_services**: `SNWD_NODE_KEY` (dtel, 80), `SEOCLSNAME` (type, 6), `SNWD_SO_ID` (dtel, 6), `SNWD_SO_ITEM_POS` (dtel, 5), `NODE_KEY` (other, 4), `SNWD_BPA` (tabl, 4), `SNWD_PARTNER_ID` (dtel, 4), `SNWD_SO` (tabl, 4), `LTEXT` (type, 3), `OSREFTAB` (type, 3), `SNWD_AD` (tabl, 3), `SNWD_SO_I` (tabl, 3), `BAPIRET2_TAB` (type, 2), `CL_OO_OBJECT` (class/intf, 2)
- **Teched17**: `/IWBEP/IF_ANA_ODATA_TYPES` (class/intf, 12), `CL_SADL_GW_DPC_FACTORY` (class/intf, 2), `CL_SADL_GW_MODEL_EXPOSURE` (class/intf, 2), `CX_SADL_EXPOSURE_ERROR` (class/intf, 2), `GC_SAP_NAMESPACE` (other, 2), `IF_SADL_GW_MODEL_EXPOSURE_DATA` (class/intf, 2)
- **abap_simple_odata_service**: `PERNR_D` (dtel, 29)
- **ui5-code-search**: `O2APPLNAME` (dtel, 54), `O2PAGEEXT` (dtel, 10), `SKWF_MIME` (dtel, 10), `NUMC7` (dtel, 6), `O2_PAGLINE` (dtel, 6), `CNAM` (dtel, 4), `PACKNAME` (type, 4), `RDIR_CDATE` (dtel, 4), `RDIR_UDATE` (dtel, 4), `UNAM` (dtel, 4), `O2APPL` (tabl, 2), `CL_BSP_API_GENERATE` (class/intf, 1), `CL_O2_API_PAGES` (class/intf, 1), `O2PAGKEY` (type, 1)
- **MindsetAppAnalyzerFree**: `/IWBEP/SB_ODATA_TY_INT2` (type, 57), `/MINDSET/FEEDBCK` (type, 29), `/MINDSET/FLPINFO` (type, 29), `/IWFND/SU_ERRLOG` (type, 21), `/MINDSET/INFO_V` (type, 20), `USGRP_USER` (type, 20), `/MINDSET/APPINFO` (tabl, 4), `/MINDSET/CL_FIORI_MONITOR_UTIL` (type, 1), `CL_SADL_GW_DPC_FACTORY` (class/intf, 1), `LV_MEAN` (other, 1)
- **abap-sap-tools**: `TROBJTYPE` (type, 109), `PGMID` (type, 49), `TRSTATUS` (type, 48), `SAP_BOOL` (type, 27), `LXE_PCX_S1` (type, 26), `LXEISOLANG` (type, 26), `KO100` (type, 25), `LXE_T002X` (tabl/view, 18), `AD_NAMTEXT` (type, 17), `DDPOSITION` (type, 17), `LVC_T_FCAT` (type, 16), `LXE_PCX_S2` (type, 16), `TR_AS4USER` (type, 16), `LXE_TT_LXEISOLANG` (type, 13)
- **ABAPToTheFuture04**: `VBELN` (doma, 101), `INT4` (doma, 30), `/BOBF/S_FRW_KEY_INCL` (tabl/view, 22), `SDRAFT_ADMIN_CDS` (type, 19), `BOOLE` (doma, 18), `/BOBF/CX_DAC` (class/intf, 16), `/BOBF/CONF_KEY` (dtel, 9), `STCD1` (doma, 9), `POSNR` (doma, 8), `COSEL` (tabl/view, 7), `/BOBF/CX_FRW` (class/intf, 5), `/BOBF/T_FRW_MODIFICATION` (type, 5), `/BOBF/CL_FRW_FACTORY` (class/intf, 4), `/BOBF/IF_CONF_C` (class/intf, 4)
- **spacelab-problem-management-backend-live**: `CRMT_OBJECT_GUID` (dtel, 242), `J_ESTAT` (dtel, 120), `BU_PARTNER` (dtel, 92), `CHAR50` (dtel, 69), `CRMT_PRIORITY` (dtel, 58), `SC_APTGUID` (dtel, 55), `PD_OBJID_R` (dtel, 42), `AC_STRING` (dtel, 38), `SC_RULEWFR` (type, 34), `AIC_S_ATTACHMENT_INCDNT_ODATA` (type, 32), `INTEGER` (type, 28), `CHAR5` (type, 27), `AIC_S_TEXT_INCDNT_ODATA` (type, 24), `COMT_PRODUCT_ID` (type, 24)

Objects missing in two or more repos: `CL_SADL_GW_DPC_FACTORY` (class/intf, 3 repos), `T005T` (tabl, 2 repos), `CL_SADL_GW_MODEL_EXPOSURE` (class/intf, 2 repos), `CX_SADL_EXPOSURE_ERROR` (class/intf, 2 repos), `IF_SADL_GW_MODEL_EXPOSURE_DATA` (class/intf, 2 repos), `/IWBEP/SB_ODATA_TY_INT2` (type, 2 repos), `USR21` (tabl, 2 repos), `USR02` (tabl, 2 repos).

## What this says

1. **The closure is DDIC, not code.** For the five services that are
   hand-written and not bound to a framework, the unresolved standard objects
   are almost entirely data elements, domains, tables and table types
   (`PERNR_D`, `SNWD_*`, `O2APPLNAME`, `TROBJTYPE`, `E070`). Standard
   *classes* on the DPC path are rare and small: `CL_OO_OBJECT`,
   `CL_O2_API_PAGES`, `CL_BSP_API_GENERATE`. The BAPI/util/auth-check fan-out
   the critic expected shows up in one repo only, the transport tooling, and
   even there it is mostly types.
2. **DDIC is capturable, not shimmable.** The scope guard in `CLAUDE.md` says
   no standard DDIC is bundled, and none needs to be: abapGit serializes DTEL,
   DOMA, TABL and TTYP as XML, the transpiler already consumes exactly that,
   and `load-table-contents` proves TABU data goes the same way. The probe
   output is the pick list for a per-user capture into `.local/`. That closes
   the loop with a script, not with weeks of shims.
3. **Framework-bound services are out of scope by the v1 decision, and the
   probe identifies them mechanically.** `CL_SADL_GW_DPC_FACTORY` and
   `IF_SADL_GW_MODEL_EXPOSURE_DATA` (Teched17, MindsetAppAnalyzer) is the
   SADL signature; `/BOBF/*` (ABAPToTheFuture04) is BOPF; `CL_AGS_CRM_1O_API`
   plus `CRMT_*` (spacelab) is CRM one-order. Confirming "classic code-based
   SEGW" for a target corpus is now one probe run and a grep for those names.
4. **Cascades are where the noise is.** View-maintenance function groups and
   ALV screens in the same package produce hundreds of unknown-symbol issues
   that have nothing to do with the service. Seeding from the DPC/MPC pair
   instead of the package is what makes the number honest: spacelab shows
   3,736 issues for the repository and 195 standard objects for the service.
5. **A small generic DDIC set recurs everywhere** and is worth adding to the
   libs once, in our fork or a `ddic-common` folder: `SAP_BOOL`, `BOOLE`,
   `INT4`, `CHAR01` to `CHAR64`, `NUMC7`, `STRING`, `INTEGER`, `BOOL`,
   `FIELDNAME`, `SEOCLSNAME`, `BAPIRET2` and `BAPIRET2_TAB`, `T005T`,
   `USR02`, `USR21`. `DISVARIANT` and `LVC_*` appear only because ALV classes
   ride along and are not needed on the DPC path.

## Consequences for the plan

- **Sprint 0 checkbox "dependency-closure probe": measured.** The long pole
  is not the closure. It is the capture step, and that is tooling.
- **Next tool, `capture`:** take the probe's JSON, emit an abapGit data
  config that pulls exactly those DTEL/DOMA/TABL/TTYP objects, plus TABU rows
  for the tables the DPC selects from, into `.local/capture/<system>/`, then
  add that folder as a lib. System access and deploy-back stay SAP-side, as
  decided.
- **`unknownTypes: runtimeError`** remains the fallback for the last few
  objects a capture misses: transpile anyway, fail on first touch.
- **Non-goals confirmed:** SADL, BOPF, CRM one-order. The probe flags them.

## Limits of this measurement

- Public repos skew small; the enterprise DPC with forty BAPI calls is not in
  the sample. The transport-tool repo is the closest proxy and still came out
  as types.
- The probe is static. A `CALL FUNCTION` to a missing function module is
  reported only when abaplint knows it should exist; dynamic calls are
  invisible until runtime.
- "Standard" is a name heuristic. Customer namespaces need an `--own <prefix>`
  option before the numbers are quoted for a real customer corpus.
