A local ABAP application server inside VS Code. No SAP or ADT connection needed.

SAP kernel rejections now appear as red squiggles while typing, with a Problems link to the support section. `osg.kernelStrict` defaults to `error` and allows runs; choose `warning`, `off`, or `refuse` (also stops object runs and tests). Desktop VSIX installs include the scanner and its dependencies.

# open-steamgate

Start a bundled ABAP runtime, explore its OData services, run ABAP Unit, and open local Fiori apps. The extension carries its own system seed and builds it on first start.

<!-- real capture pending: OSD tree with a selected service card in VS Code desktop -->

![Fiori list report captured from the local demo](https://raw.githubusercontent.com/oisee/open-steamgate/main/editors/vscode/media/screenshots/fiori-list-report.png)

<!-- real capture pending: VS Code desktop debugger stopped on an ABAP source line -->

## Quick start

1. Install **open-steamgate** from the VS Code Marketplace, or install the downloaded `.vsix` with **Extensions: Install from VSIX...**.
2. Open the **OSD** Activity Bar view and select **Start**. The first start builds the bundled system; later starts reuse its cache.
3. Try the services in the tree, or open an ABAP project such as [osg-demo](https://github.com/oisee/osg-demo) as a workspace layer.

VS Code 1.101 or newer is required. The system runs locally on desktop or in a Remote-WSL or Remote-SSH workspace. It does not need a SAP or ADT connection.

## What works

- Start and stop the local server; inspect its services and generation in the OSD tree.
- Run ABAP Unit in Test Explorer; check, activate, and run ABAP files with familiar keys.
- Open local OData and Fiori apps, inspect short dumps, use SQL notebooks, and debug ABAP through VS Code's Node debugger.
- Add an abapGit-style workspace layer over the bundled source.

## Current limits

- Portable AMDP support is limited. HANA-specific SQLScript needs HANA, and some methods are not portable to SQLite.
- Warm rebuild requires upstream transpiler fixes [#1900](https://github.com/abaplint/transpiler/pull/1900) and [#1921](https://github.com/abaplint/transpiler/pull/1921) to be released. Until then activation uses the cold build path.
- The Marketplace build has no browser extension entry. The separate web gateway probe remains a development experiment.

The extension is MIT licensed. Bundled dependency declarations and licence review items are in `THIRD-PARTY-NOTICES.md` inside the VSIX.

### Background jobs

**osd: Start system** also starts the job worker, restarts it after a crash,
and stops it with the system or extension. Serving generation changes restart
the worker after its active job finishes, with a bounded shutdown wait.
No terminal command is needed.
`osd.jobs.worker` defaults to `auto`; use `off` to disable it or `on` to enable
it explicitly. Both modes require durable file SQLite. The default `osd.database.system=sqlite` stores a shared file.
Other backends leave the worker stopped and show one message to use file SQLite.
The **OSD jobs** status bar shows idle, running/queued counts, or a stopped
worker. Click it to open the **OSD jobs** output channel.
