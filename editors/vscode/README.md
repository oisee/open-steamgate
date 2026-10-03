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

## ABAP values in the debugger

When stopped on an ABAP line, Variables, Watch and hover show ABAP values:
`'ABC' (c20)`, `12.50 (p8,2)`, `42 (i)`, `9223372036854775807 (int8)`,
`2026-10-03 (d)`, `12:34:56 (t)`, and `ABCDEF (xstring)`. Character values
omit trailing padding; strings preserve it. Float values use scientific notation with a locale-independent decimal point, and fixed hex includes its byte length (`ABCD0000 (x4)`).

Expand `{…} (structure)` to see its declared lowercase components. Tables
show `[3 rows] (standard table)` (or sorted) and expand to rows `1`,
`2`, `3`. Field symbols and data references show `->` followed by the target
value and expand through a `->` child. Unassigned/initial references say so.
Objects show their class name and expand to ABAP attributes, including private
attributes exposed by the transpiler.

The view shows the first 100 standard/sorted table rows, with a `…more` count
for the rest; that node does not load more rows. Hashed tables show a summary
without enumerating rows: the installed runtime has no bounded iterator or
maintained count. Text and hex previews stop after 256 storage characters.
CHAR previews omit trailing padding, so the projected view is not an exact
padded-storage display; inspecting never changes that storage. CASTING field
symbols use their declared type for supported hex/character reinterpretations. Reference previews stop after eight links or a cycle.
Dates use ISO order rather than a user-specific SAP date format. Float fixtures
are derived from SAP's [scientific type-f formatting rules](https://help.sap.com/doc/abapdocu_816_index_htm/8.16/en-US/ABENWRITE_FORMATS.html),
with a fixed decimal point; they are not captured SAP debugger output or a
claim of exact parity across debugger versions and locales. Bundled constructors
must have their runtime names restored by `bin/osd.mjs`; the tests bundle the
runtime and execute that exact startup block. Unknown values
and failed formatting keep VS Code's default rendering. The view uses the
built-in Node debugger's [custom generator options](https://github.com/microsoft/vscode-js-debug/blob/main/OPTIONS.md),
which js-debug currently marks deprecated. It applies to desktop system and
ABAP Unit sessions started by the extension; it does not change Watch expression
syntax or provide a browser debugger. Custom child properties are for inspection;
edit ABAP values in source rather than using Set Value on the projected children.

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
