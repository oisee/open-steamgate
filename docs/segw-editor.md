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
What SEGW's Create makes is a button on the folder or the row it belongs
to (`ADDS` in the controller: the dialog's fields and the rows they
become, POSTed in one `$batch`, every row with a fresh 32-character node
id and `StgSeq` after the project's last row): an entity type (`SBO_ET` +
text), an entity set (`SBO_ES` + text, its service implementation node
`SBD_SE` below the service node and the five `SBD_OP` operations with
SEGW's method names), an association (`SBO_ASO` with the cardinalities
and, when both types have a set, its association set), a navigation
property on an entity type (`SBO_NP` on an association), a function import
(`SBO_FI`, method, optional return entity type) and its parameters
(`SBO_FP`), a property on an entity or complex type (`SBO_PR` with SEGW's
defaults: `Edm.String`, length 10, creatable / updatable / sortable /
filterable / nullable). The row shapes are the ones `stg-compile` writes,
so a project made in the editor exports as SEGW would write it and
generates like one. Delete is `DELETE NodeSet(P, uuid)`, the
service's subtree delete (`zcl_stg_segw_tree`: the rows below the node in
every table, its text rows, the mapping rules), the way SEGW deletes; an
entity type still used by an entity set is refused in the app first.

## Import, Export, Generate

- **Import IWPR** picks an abapGit `<project>.iwpr.xml` and POSTs it as one
  entity to `ImportSet` (`{Content}`); `zcl_stg_segw_import` replaces the
  project's rows in every table and the app selects the project. The whole
  file goes in the request body, so a 40 KB project is fine; a function
  import would have to carry it in the URL. The same button takes an
  abapGit `*.fugr.xml`: it goes to `FunctionGroupSet` and its module
  signatures to `ZSTG_FM_PARAM`, which Generate reads for the operations
  mapped to a function module.
- **Export IWPR** is `GET ExportSet('P')`: the IWPR written in ABAP by
  `zcl_stg_segw_export` (byte for byte what `ImportSet` took in), handed
  over as the abapGit file `<project>.iwpr.xml`.
- **Generate** is `GET GenerateSet?$filter=Project eq 'P'`: segw-gen in
  ABAP (`zcl_stg_segw_gen`, byte-identical to `tools/segw-gen.mjs` over the
  corpus), one row per file (`Name`, `Content`): the `_MPC`/`_DPC` pair,
  their class XMLs and the four `_EXT` files. The dialog lists them, a
  file opens as source, and **Save to gen/** asks the local runtime to
  write them to `gen/segw-editor/<project>/` (`POST /segw/generate/<P>` in
  `test/start.mjs`, `tools/segw-editor.mjs`: the rows of `GenerateSet`
  onto disk). That last step is the only one that needs Node: in the
  browser preview Generate shows the files and Save says why it cannot.
  On a system the button is SEGW's own Generate. `gen/segw-editor/` is
  excluded from the transpiler and from abaplint: what the editor
  generates is a build product to look at or to take to a system, not part
  of this runtime.

## Tested

`test/e2e/segw.spec.mjs` over the seeded `ZSTG_MAPPED` (the generator
fixture): the tree with its properties and mapping rows, a property's
`MaxLength` edited and saved (MERGE, then read back), a property added
(POST below `et-1`), an entity type, an entity set with its operations, a
function import returning it, an association with its set and a
navigation property created from the folders and rows (all of them in the
generated MPC/DPC afterwards), the property deleted (`DELETE NodeSet`, an entity type with
sets refused), the fixture's function group imported through
`FunctionGroupSet`, Generate listing `GenerateSet`'s files, the MPC source
with the new property, Save to gen/ landing them (the DPC with the RFC
call of the mapped operation), Export downloading the IWPR through
`ExportSet`, Import of `zstg_mini.iwpr.xml` through `ImportSet` selecting
`ZSTG_MINI`; and the launchpad tile.

## Not yet

The wizards SEGW has (import from DDIC structure, map to data source,
referential constraints, complex types, data sources), drag order
(`StgSeq`), the label
row created when there is none, and a Generate that lands the classes in
`src/` and registers the service without a restart (or, on a system, in
the class builder).
