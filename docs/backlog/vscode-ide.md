

### Desktop VS Code OSD supervisor extension (2026-09-21)

Create an extension for real desktop VS Code, distinct from the browser
code-server image. Use the desktop Node extension host only as a thin lifecycle
supervisor for a pinned OSD runtime: `Start`, `Stop`, `Status`, `Open Launchpad`
and `Connect with abap-fs`. Run against the currently opened Git checkout so
source, Git diff and ADT object state describe the same files. Require Workspace
Trust, bind loopback by default, allocate/check instance-derived ports, keep
database state outside the extension install directory, and terminate children
on explicit stop or extension shutdown.

Do not perform npm/git downloads or a source build during extension activation.
Evaluate two explicit distribution modes: a signed/checksummed per-platform OSD
archive fetched by exact version, and an externally installed `osd` CLI. Show
the runtime/source revision and mismatch in the status UI. Never auto-commit or
push. Acceptance must cover Windows x64, macOS arm64, Linux x64 and Raspberry
Pi arm64, including restart/persistence, port collision, failed startup, stale
child cleanup and upgrading the runtime without touching the user database.

### Browser workbench product entry and operator docs (2026-09-21)

The W2 code-server/abap-fs developer loop is reproducible and documented in
`docs/vscode-workbench-spike.md`, but it is not yet a normal product entry.
Before calling it discoverable, add a short operator path to both `README.md`
and `docs/spin.md`: start OSD and the opt-in workbench Compose from the same
checkout, create the IDE secret, keep the default loopback bind, use an SSH
tunnel for another workstation, and explain the separate OSD and IDE ports.
Link to the detailed spike document instead of duplicating its security model.

Add a Launchpad **Workbench** tile which opens the authenticated IDE in a new
tab. Its URL must be deployment configuration rather than a baked-in host or
port. Keep `/sap/bc/osd/edit/` as the small in-system repair editor and make it
discoverable too, but do not call either surface SE80. Do not iframe code-server
until WebSocket upgrades, service workers, CSP, cookies and logout have browser
coverage. Add Playwright checks for the configured link, new-tab navigation and
the disabled/absent state when no workbench URL is configured.
