## The three places

There is one base system and zero or more workspace layers. A packaged extension uses its bundled copy as the base. When the open folder is the open-steamgate checkout, that checkout is the base at `osd.home`.

```text
packaged extension ──> bundled copy ──┐
                                      ├──> one built system
open-steamgate checkout ──> osd.home ─┘
                                               + your workspace packs as layers
```

Workspace folders with `osd-pack.json` load as full packs: ABAP, DDIC, TABU seed rows, a webapp at `/app/<name>/`, and launchpad tiles, as declared in the manifest. Folders without a manifest but with `.abapgit.xml` or ABAP source under `src/` remain ABAP layers. The extension keeps the SQLite file, projected packs, and TLS directory in its own VS Code storage, away from the source folders. Pack seed rows replace the rows in their named tables on each start.

The **Layers** node shows the chosen base and each workspace pack's contributions. **System overview** shows their full paths. Close a workspace folder and restart to remove its objects, page, and tiles.
