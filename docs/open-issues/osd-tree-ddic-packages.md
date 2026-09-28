# OSD tree: DDIC preview and package navigation

The `osg-demo` pack already has three seeded tables (`ZOSD_FLEET_SHIP`,
`ZOSD_FLEET_VOY`, `ZOSD_FLEET_STAT`) and the `ZC_OSD_FLEETCUBE` CDS view.
Their definitions can be opened from its README; F8 on a TABL/DDLS definition
uses the extension's Data Preview. The OSD tree currently shows layer counts,
but has no route from those counts to the definitions.

Proposed first slice for the VS Code extension:

1. Add `System > DDIC > Tables / CDS` with definitions discovered from the
   active source layers. Selecting a definition opens its source. Offer the
   existing Data Preview action for a runnable TABL or DDLS; preserve the
   existing error when a definition has no database object behind it.
2. Add a `Packages` node, or a package action under `Layers`, that uses each
   pack's declared package and actual source folder. Its action reveals that
   folder in VS Code Explorer. It need not duplicate the file tree in OSD.
3. For a source folder outside the open workspace, show its location and an
   explicit open/reveal action. Do not silently replace the current workspace.

The existing `revealInExplorer` call for service app sources in
`editors/vscode/extension.js` is a useful precedent. Check both a pack at the
workspace root (`osg-demo`) and a pack nested in a larger workspace. Keep this
navigation change separate from the Test Explorer classification fix (#186).
