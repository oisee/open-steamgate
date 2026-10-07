# Source layers

The build, object store, generators and route readers use the same ordered
layers. Later layers replace a complete object, including all of its files.
Libraries fill names absent from source and remain read-only.

| Input | Discovery | Writes |
| --- | --- | --- |
| Project `input_folder` | `abap_transpile.json`, later folders win | Existing objects stay in their owning root; new objects use the requested package or first writable root. `gen` is read-only. |
| Workspace / content pack | `osd-pack.json`, including linked VS Code workspaces | Writable source roots; changes reach the workspace. |
| ABAP library | Configured libraries and pinned files/exclusions | Read-only. |
| Explicit abapGit folder | `--layer` / `OSD_LAYERS`, repository `.abapgit.xml` | Writable, using the repository's starting folder and package layout. |
| abapGit ZIP | `--layer` / `OSD_LAYERS`, verified and extracted inside the instance | Immutable base; writes copy the entire winning object into its writable overlay first. |

## Archive layers (implemented)

Treat an abapGit archive as a content-named, immutable extracted source layer.
`tools/osd-source-zip.mjs` checks the complete ZIP directory and local headers
before extraction: no absolute paths, drive paths, `..`, backslashes, symlinks
or other special files, duplicate paths or file/directory collisions. Stored
and deflated entries are supported, with CRC/size verification and a 512 MiB
expanded size limit, 128 MiB compressed archive limit, 64 MiB per-entry limit,
20,000-entry limit and 1000:1 expansion ratio limit (entries under 1 MiB
expanded are exempt from the ratio limit). Encrypted, multi-disk and ZIP64 archives are refused.
An archive needs `.abapgit.xml` at its root; wrapper directories are refused.

The SHA-256 of the exact archive bytes names `build/source-layers/<sha256>`.
Extraction stages beside the cache and publishes by rename; files are read-only.
The source root is read-only in ObjectStore. Reusing bytes reuses this cache;
changing even the ZIP comment creates a different archive identity. The build
manifest records the source layers, archive identity, package rules and order.
With all other effective inputs fixed, the generation changes iff ZIP bytes
change. Effective overlay edits also change the generation, as ordinary source
edits do. Archive hashes are input identities, not ADT version identifiers;
ADT active source continues to use generation snapshots (#638).

Every archive revision has an overlay at `local/overlays/<sha256>`, immediately
above its base in layer order. The first write copies the **whole object**:
main source, XML header, local definitions/implementations, macros and tests,
with package headers established at mount time before the first build. A `.clas.abap` edit therefore retains its `.clas.xml`.
Creation in an archive package uses the mounted overlay package header.
The active-source provenance of a copied object is retained before its saved
bytes change; failed activation keeps serving the old active source.

An identical archive shares/reuses its overlay even when supplied at a different
path. A byte change starts a clean overlay; previous cache and overlay revisions
are retained. Inactive records and pre-save active copies stay owned by the
revision that wrote them. Unmounted drafts remain durable in `inactive.json`
without suppressing same-named objects in a replacement ZIP; remounting their
original archive restores the draft and its active source. The stable "same layer" key is the resolved abapGit root package
(explicit DEVCLASS, one-prefix inference, or OSD_LAYER_PACKAGE); archive paths
and versioned basenames may change. Repositories using the same root package
share this key. At startup, a replaced revision with changed objects produces
one WARNING with its old SHA-256, overlay path, object count and recovery steps.
`osd doctor` lists edited orphan overlays from both replaced and removed layers.
The mount list represents the complete current configuration, including simultaneous
revisions of the same package, and drops historical mounts. This includes pre-metadata revisions whose
package can be recovered from the retained archive cache. Counts compare overlay
files with their old base and deduplicate class includes; unchanged package
headers do not count. Resume by mounting the original ZIP, or open the overlay
directory and manually diff/reapply the edits against the retained old archive
sources under build/source-layers/<old-sha>. No export or automatic
carry-over/rebase command is implemented. There is no implicit migration, cache eviction or delete tombstone:
a base object cannot be deleted, and deleting an overlay override reveals the
base. These policies keep dependency updates and source deletion explicit.

## abapGit packages and node identity

`STARTING_FOLDER` selects the source root and must stay inside the repository.
`FOLDER_LOGIC FULL` uses each subfolder's full package name; `PREFIX` appends the
subfolder to its parent with `_`. A `DEVCLASS`/`PACKAGE` declaration in
`package.devc.xml` wins over that mapping; named `*.devc.xml` also supplies a root
package name. Ordinary abapGit root headers contain only a description: SAP asks
the importing user for the name. For a standalone archive with one shared custom
object prefix, OSG derives its local package (`ZCL_DEMO_*`, `ZIF_DEMO_*`,
`ZDEMO_*` → `$ZDEMO`). `OSD_LAYER_PACKAGE` supplies the fallback for ambiguous
archives. An explicit declared package wins. Ordinary folders retain their
folder-derived fallback. Objects and package descriptions come from these rules,
not a synthetic pack package or `$TMP`.

SICF object identity is the full abapGit filename stem: node name padded to 15
characters plus the 25 hex parent hash. Spaces are preserved through store,
import, input selection/exclusion and export. The node label remains separate;
ICF rows use the filename parent hash for this shape. Bare `*.sicf.xml` names
retain their existing identity and URL-derived rows. A handler-less generated
APC SICF node coexists with its SAPC object: SAPC owns the WebSocket implementation
and links to the SICF row by URL. SAMC and SAPC are indexed repository objects,
while their runtime readers remain the existing channel readers.

## Related implementation

- `tools/osd-source-layers.mjs`: archive cache, overlays and explicit roots.
- `tools/osd-packs.mjs`: layer order, shared by build and generators.
- `tools/osd-store.mjs`: package mapping and whole-object copy before writes.
- `tools/osd-store-versions.mjs`: retained active source after relocation.
- [Generations](generations.md): immutable build artifacts and source snapshots.
- [ADR 0001](adr/0001-osd-version-and-data-model.md): Git source history and the
  separate per-process liveness counter.
