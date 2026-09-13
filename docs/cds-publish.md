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

## Not yet

Associations of a published view are not exposed as navigation properties
(the hand-written `ZSTG_SADL_SRV` shows how that looks); no write side (see
the SADL write step); the service name is `<view>_CDS`, which is what SAP
uses, but the generated class names are ours, not SAP's, because no corpus
project carries a published view to copy from.
