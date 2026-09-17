# `@OData.publish`: a CDS view is a service

One annotation on a view, and there is an OData service over it — no SEGW
project, no classes written by hand. On a system the annotation generates
`<view>_CDS` with its MPC/DPC and registers it; here it goes through the
tooling this repository already has.

```
@AbapCatalog.sqlViewName: 'ZVSTGTRAVEL'
@OData.publish: true
define view ZC_STG_TRAVEL as select from zstg_demo { ... }
```

```
GET /sap/opu/odata/sap/ZC_STG_TRAVEL_CDS/           -> {"EntitySets":["Zc_Stg_TravelSet"]}
GET /sap/opu/odata/sap/ZC_STG_TRAVEL_CDS/$metadata
GET /sap/opu/odata/sap/ZC_STG_TRAVEL_CDS/Zc_Stg_TravelSet?$filter=STATUS eq 'A'
```

## The chain

`tools/cds2ddic.mjs` sees the annotation and writes
`gen/cds/<view>_cds.stg.yaml`: the model of a service with one entity bound
to the view (`source: {cds: …}`, SADL delegation), the view's fields as
properties with their labels, its keys as keys, read-only with the
operations SADL serves (`R`, `Q`). From there nothing is new:
`stg-compile --all` compiles that model like any hand-written one (the tree,
the `IWSV`/`IWMO` pair and the four classes through segw-gen), and
`tools/segw-registry.mjs` registers the service. Which means a published
view is described, generated and served by exactly the code paths a SEGW
project uses, and shows up in the SEGW editor like any other project.

Two details worth knowing:

- **Class names.** `ZCL_<project>_MPC_EXT` would be over 30 characters for
  most view names, so the generated classes are named after the SQL view
  (`ZCL_ZVSTGTRAVEL_MPC_EXT`), through the `classes:` override the YAML
  grammar already had.
- **The bound structure** is the row type of the generated source class
  (`ZCL_STG_CDS_<view>=>TY_ROW`), not the view itself, so virtual elements
  are part of the service (`docs/virtual-elements.md`). The YAML grammar
  gained `struct:` next to a source for that.

A CDS entity is also a DDIC object of its own now: next to the SQL view
(`ZVSTGTRAVEL`) `cds2ddic` writes the view under the CDS name
(`ZC_STG_TRAVEL`), because that is the name ABAP code selects from and
declares types with on a system.

## Tested

`test/mocha.mjs`, "@OData.publish": the service document, `$metadata`, a
filtered read with the virtual element in it, and the cube view published
the same way.

## Measured on a system, 2026-09-17

Two DDIC-based CDS views in `$TMP` on the sandbox — a head over `TDEVC`
with `@OData.publish: true` and an exposed `association [0..*] to` an item
view over `TADIR` — activated cleanly (with the warning that DDIC-based CDS
views are obsolete) and left this in `TADIR`:

| object | name |
| --- | --- |
| DDLS, VIEW, STOB | the view, its SQL view, the CDS entity — one set per view |
| **IWMO** | `ZC_OSD_PROBE_HEAD_CDS 0001` — the gateway model |
| **IWSV** | `ZC_OSD_PROBE_HEAD_CDS 0001` — the gateway service |
| **IWVB** | `ZC_OSD_PROBE_HEAD_CDS_VAN 0001` — the service variant |

So the annotation generates exactly the object kinds `stg-compile` writes
here (IWSV and IWMO), plus a variant we have no equivalent for. What it does
**not** do is publish: reading
`/sap/opu/odata/sap/ZC_OSD_PROBE_HEAD_CDS/$metadata` on that system answers
**403, `/IWFND/MED/170` "No service found"** — the service still has to be
registered in the hub (`/IWFND/MAINT_SERVICE`), and
`/IWFND/FM_ACTIVATE_SERVICE` is screen-bound, so it cannot be done from a
headless session. Here the service is served the moment it is generated,
which is a difference in our favour and worth keeping in mind when comparing
behaviour.

Whether SAP's generated model turns the exposed association into a
navigation property was **not** measured: without the hub registration there
is no `$metadata` to read, and `CL_SADL_GW_CDS_ANALYZER` (through
`CL_SADL_GW_MODEL_CDS`) answers an empty `get_exposure( )` for such a view —
it is the design-time reporting analyzer, not the model builder. The probe
objects were deleted afterwards; `TADIR` shows nothing left.

## Not yet

Associations of a published view are not exposed as navigation properties:
`publishedYaml()` in `tools/cds2ddic.mjs` emits one entity, its properties
and its keys, and never an association, although the parser reads them and
knows which the projection exposes. A service of several CDS views with
navigation is possible today only the way the hand-written `ZSTG_SADL_SRV`
does it (a reference data source with an exposure XML in a hand-written
MPC — four entity sets, two associations, real `NavigationProperty` entries)
or through a `stg.yaml` that declares the navigation itself, which is what
`ZOSD_STATUS_SRV` does. The missing piece has a name in ABAP: a **service
definition** (SRVD) — "these views, this service" — and the transpiler
refuses SRVD objects today (`ANOMALY-2026-09-15-srvd-not-allowed`).

No write side (see the SADL write step); the service name is `<view>_CDS`,
which is what SAP uses, but the generated class names are ours, not SAP's,
because no corpus project carries a published view to copy from.
