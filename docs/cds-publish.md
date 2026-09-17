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
GET /sap/opu/odata/sap/ZC_STG_TRAVEL_CDS/     -> {"EntitySets":["ZC_STG_TRAVEL","ZC_STG_BOOKING"]}
GET /sap/opu/odata/sap/ZC_STG_TRAVEL_CDS/$metadata
GET /sap/opu/odata/sap/ZC_STG_TRAVEL_CDS/ZC_STG_TRAVEL?$filter=STATUS eq 'A'
GET /sap/opu/odata/sap/ZC_STG_TRAVEL_CDS/ZC_STG_TRAVEL('T0001')/to_Bookings
GET /sap/opu/odata/sap/ZC_STG_TRAVEL_CDS/ZC_STG_TRAVEL?$expand=to_Bookings
```

The second entity set is not a second annotation: `ZC_STG_TRAVEL` exposes an
association to `ZC_STG_BOOKING`, and an exposed association pulls its target
into the same service. That is what a system does; the measured shape is
below.

## The chain

`tools/cds2ddic.mjs` sees the annotation and writes
`gen/cds/<view>_cds.stg.yaml`: the model of a service with one entity per
view reached, each bound to its view (`source: {cds: …}`, SADL delegation),
the view's fields as properties with their labels, its keys as keys,
read-only with the operations SADL serves (`R`, `Q`) unless the view's own
`@ObjectModel` switches ask for more. From there nothing is new:
`stg-compile --all` compiles that model like any hand-written one (the tree,
the `IWSV`/`IWMO` pair and the four classes through segw-gen), and
`tools/segw-registry.mjs` registers the service. Which means a published
view is described, generated and served by exactly the code paths a SEGW
project uses, and shows up in the SEGW editor like any other project.

Three details worth knowing:

- **Which views.** `publishedYaml()` walks the exposed associations breadth
  first from the annotated view and adds every view it reaches, with the
  visited set as the cycle guard — `ZC_STG_BOOKING` exposes `_Travel`
  straight back at `ZC_STG_TRAVEL`, and that is one association each way,
  not a loop.
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

`test/mocha.mjs`, "@OData.publish": the service document with both entity
sets, `$metadata` (entity types, the container, the association, its set and
the roles, the navigation property both ways), a filtered read with the
virtual element in it, `$expand=to_Bookings`, the navigation URL in both
directions, and the cube view published the same way.

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

Then Alice registered the service by hand in `/IWFND/MAINT_SERVICE` (Add
Service, system alias `LOCAL`, technical name `ZC_OSD_PROBE_HEAD_CDS`,
Local Object), and the rest could be read. **The external name has no
suffix**: the service answers at `/sap/opu/odata/sap/ZC_OSD_PROBE_HEAD_CDS`.

### What one published view with one exposed association produces

The annotation was on the head view only. The service that came out has
**two** entity sets: the association pulled its target into the same
service.

```xml
<EntityContainer Name="ZC_OSD_PROBE_HEAD_CDS_Entities" m:IsDefaultEntityContainer="true"
                 sap:message-scope-supported="true" sap:supported-formats="atom json xlsx">
  <EntitySet Name="ZC_OSD_PROBE_HEAD" EntityType="…ZC_OSD_PROBE_HEADType"
             sap:creatable="false" sap:updatable="false" sap:deletable="false"/>
  <EntitySet Name="ZC_OSD_PROBE_ITEM" EntityType="…ZC_OSD_PROBE_ITEMType" … />
  <AssociationSet Name="assoc_F71C19A5AE9C4F1DBF9256A6790FF2F4" …>
    <End EntitySet="ZC_OSD_PROBE_HEAD" Role="FromRole_assoc_F71C…"/>
    <End EntitySet="ZC_OSD_PROBE_ITEM" Role="ToRole_assoc_F71C…"/>
  </AssociationSet>
</EntityContainer>
```

The conventions, measured rather than assumed:

| thing | how SAP names it |
| --- | --- |
| entity set | the view's name, **as it is** — `ZC_OSD_PROBE_HEAD`, no `Set` suffix |
| entity type | `<VIEW>Type` |
| entity container | `<SERVICE>_Entities` |
| navigation property | the association alias with the underscore turned into a prefix: `_Items` → **`to_Items`** |
| association and its set | `assoc_<32 hex>` — a GUID, the same string in both, with roles `FromRole_<that>` / `ToRole_<that>` |
| multiplicity | `1` to `*` for `[0..*]` |
| read-only | `sap:creatable/updatable/deletable="false"` on the entity set |
| property | `sap:label` and `sap:quickinfo` from the DDIC data element, `sap:display-format="UpperCase"` for a CHAR key |

`$expand=to_Items` works and nests the target's `results`; so does the
navigation URL `ZC_OSD_PROBE_HEAD('<key>')/to_Items`. Keys are escaped in
the usual way (`/1BS/…` appears as `%2F1BS%2F…`).

That is the whole specification we were missing, and it says the gap is
narrower than it looked: **no service definition is needed for this case**.
One view, one annotation, and every view its exposed associations reach
joins the service.

The probe objects were deleted from the sandbox afterwards.

## What ours does with that, and where it differs on purpose

`publishedYaml()` follows the measured shape: entity set = the view's name,
entity type `<VIEW>Type`, container `<SERVICE>_Entities`, navigation
`to_<alias without its leading underscore>`, association and association set
both `assoc_<32 lower-case hex>` with `FromRole_`/`ToRole_` roles,
multiplicity `1` to `*` for `[0..*]`, `sap:creatable/updatable/deletable`
from the target view's own `@ObjectModel` switches. The CDS ON-condition
becomes the `ReferentialConstraint` of the association (the `constraint:` the
stg.yaml grammar already had), which the system's metadata carries too.

**One deliberate difference: the 32 hex digits are a hash, not a GUID.** A
system writes a fresh GUID there, so its `$metadata` changes on every
regeneration. `gen/` is an input to the generation hash here, and a build has
to be reproducible, so the hex is the first 32 characters of a sha256 over
the service name, the view the association is written on and the alias. Same
shape, same length, same place; stable across builds.

The navigation has to carry data, not only metadata. A hand-written
reference-data-source MPC writes the CDS alias into its definition
(`<sadl:association binding="_BOOKINGS">`); a SEGW-generated one does not —
the project tree has no field for it, and SEGW resolves it against the CDS
entity when it generates. `zcl_stg_sadl_dpc->navigation_where` therefore
falls back to the naming rule itself: with no `<sadl:association>` for the
navigation property, `to_Bookings` is read as the alias `_Bookings`, looked
up in `zcl_stg_cds_registry`, and its ON pairs become the WHERE. That is the
measured convention inverted, not a guess, and it only runs when the
definition is silent.

## Not yet

The `IWVB` service variant the annotation also writes on a system has no
equivalent here. The service name is `<view>_CDS`, which is what SAP uses,
but the generated class names are ours, not SAP's, because no corpus project
carries a published view to copy from. `sap:quickinfo` and
`sap:display-format="UpperCase"` are in the measured metadata and not in
ours: both come from the DDIC data element behind a field, which the
generated YAML does not carry yet.
