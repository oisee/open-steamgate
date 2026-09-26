## The three places

There is one base system and zero or more workspace layers. A packaged extension uses its bundled copy as the base. When the open folder is the open-steamgate checkout, that checkout is the base at `osd.home`.

```text
packaged extension ──> bundled copy ──┐
                                      ├──> one built system
open-steamgate checkout ──> osd.home ─┘
                                               + your abapGit folders as layers
```

Workspace folders with `.abapgit.xml` or ABAP source under `src/` are layers. They load after the base and can replace its objects. The extension keeps the SQLite file, generated layer manifests, and TLS directory in its own VS Code storage, away from the source folders.

The **Layers** node shows the chosen base and each workspace layer. **System overview** shows their full paths.
