# SEGW as an application: the editor

`webapp/segw/` is the Service Builder as a Fiori app: the project tree of
`ZSTG_SEGW_SRV` (`docs/segw-tree.md`: one entity set per `/IWBEP/I_SB*`
table, served from the `ZSTG_SB*` tables by the generic CRUD of
`zcl_stg_sadl_dpc`) shown as the tree transaction SEGW shows, every node the
row of the table it lives in, edited in place. Tile "SEGW" on the launchpad
(`webapp/flp.html`, intent `SegwProject-manage`), or
`/app/segw/index.html` directly.

## What it is

Freestyle SAPUI5 (`sap.m.Tree`, `sap.ui.layout.form.SimpleForm`, one XML
view, one controller), not Fiori Elements: the tree spans twenty entity
sets that have no navigation properties between them, and its shape is
SEGW's, not the model's. The controller holds that shape
(`TREE` in `controller/App.controller.js`): Data Model (entity types with
their properties and navigation properties, complex types, associations
with referential constraints, entity sets, association sets, function
imports with parameters), Service Implementation (service entities, their
operations, the mapping header and mapping rows of each), Data Sources,
Runtime Artifacts, Service Maintenance. A folder is an entity set plus the
property that points at the parent's `NODE_UUID` (`ParentUuid`,
`EntityGuid`, `AssociationGuid`, `FunctionImport`); a mapping row reads
`property -> parameter` (or `<-` for the output direction).

Loading a project is one `$batch` of GETs, every set with
`$filter=Project eq '...'&$orderby=StgSeq`, assembled into the tree in the
browser. Selecting a node binds the form to the entity
(`/PropertySet(Project='...',NodeUuid='...')`): one field per property of
the entity type from `$metadata`, the keys read-only, and below it the row
of the text table where SEGW keeps the label (`PropertyTextSet`,
`EntityTypeTextSet`...), when there is one. Save is the OData model's
`submitChanges`: a MERGE with the changed fields, in a `$batch` changeset.
Add property (on an entity type or a complex type) POSTs a `PropertySet`
row with a fresh 32-character node id, `StgSeq` after the project's last
row and SEGW's defaults (`Edm.String`, length 10, creatable / updatable /
sortable / filterable / nullable); Delete removes the selected row (the row
only: SEGW would take the subtree with it, this does not yet).

## Import, Export, Generate

- **Import IWPR** picks an abapGit `<project>.iwpr.xml` and POSTs it as one
  entity to `ImportSet` (`{Content}`); `zcl_stg_segw_import` replaces the
  project's rows in every table and the app selects the project. The whole
  file goes in the request body, so a 40 KB project is fine; a function
  import would have to carry it in the URL.
- **Export IWPR** and **Generate** are the local runtime's seam, not the
  service's: `test/start.mjs` serves `GET /segw/export/<PROJECT>` (the
  project's rows pulled back through the service and written as the IWPR,
  byte for byte what `segw-tree pull` gives) and
  `POST /segw/generate/<PROJECT>` (the same IWPR through `segw-gen`, the
  `_MPC`/`_DPC` pair plus the `_EXT` stubs written to
  `gen/segw-editor/<project>/`, answered as JSON with the file names,
  sources and warnings; `tools/segw-editor.mjs`). Function groups for
  RFC-mapped operations come from `STG_SEGW_LIBS` (folders, `:`-separated;
  default `test/fixtures/segw`). On a system this button is SEGW's own
  Generate; in the browser preview (no Node behind the service worker) both
  answer with a message. `gen/segw-editor/` is excluded from the transpiler
  and from abaplint: what the editor generates is a build product to look
  at or to take to a system, not part of this runtime.

## Tested

`test/e2e/segw.spec.mjs` over the seeded `ZSTG_MAPPED` (the generator
fixture): the tree with its properties and mapping rows, a property's
`MaxLength` edited and saved (MERGE, then read back), a property added
(POST below `et-1`) and deleted (DELETE), Generate showing the generated
files and the new property in the generated MPC, Export giving the IWPR
with it, Import of `zstg_mini.iwpr.xml` through `ImportSet` selecting
`ZSTG_MINI`; and the launchpad tile.

## Not yet

Adding nodes other than properties (entity types, sets, associations,
operations) and the wizards SEGW has for them (import from DDIC structure,
map to data source), subtree delete, drag order (`StgSeq`), the label
row created when there is none, a Generate that lands the classes in
`src/` and registers the service without a restart, and an `ExportSet`
of the service (the mirror of `ImportSet`, so Export needs no Node route).
