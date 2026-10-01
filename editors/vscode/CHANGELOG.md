# Changelog

## Unreleased

- Show DPC_EXT entity-set redefinitions and their source lines on service Details, using the same owner lookup as the HTTP lens; count services registered directly to a class in its readers lens.
- Register `.abap` as ABAP with breakpoint support, so VS Code accepts breakpoint toggles in a fresh profile.
- Refresh the Test Explorer and test-count lenses after Start and workspace layer changes.
- The Test Explorer runs ABAP Unit by `RISK LEVEL`: HARMLESS objects in parallel (longest `DURATION` first), the rest one at a time after them; an undeclared level counts as DANGEROUS. A HARMLESS class that reaches a database write is warned about on its `RISK LEVEL` line and runs alone, and one that writes anyway fails with "RISK LEVEL HARMLESS but wrote to <table>". Cancel now stops the test run in flight.
- Debugging switches itself on; `osd.debug` is gone. A breakpoint in an `.abap` file or **Run with debugger** opens the running system's inspector (127.0.0.1 only) and attaches, with no restart; once no `.abap` breakpoint is left and the debug session has ended, it is closed again. `OSD_INSPECT=1` opens it at start, and an existing `"osd.debug": true` is still read for one release.
- The OSD tree opens its pages inside VS Code by default (the Fiori Launchpad, apps, services, `$metadata`, the `/osd/*` endpoints): one tab per page, reused on a second click. The launchpad, endpoint and service nodes have an inline link-external action, and every page node an "... in External Browser" context item, for the system browser. `osd.openIn: browser` restores the old default. The System overview's launchpad button and the details panel's `$metadata` link follow the same rule; page tabs close on Stop and reload after a rebuild.
- Stop (and Rebuild) no longer warn "the system stopped unexpectedly": a stop you asked for logs `--- osd stopped ---`, and only an exit nobody asked for warns.
- Add **osd: Generate taxi data...** and **osd: Reset taxi data to minimal**, also on the taxi data service in the OSD tree: the system no longer makes taxi sample rows at start.
- Ship the bundled system's cross-reference rows with its prebuilt generation, so the first start seeds them from a file instead of parsing the tree (5.1 s -> 0.1 s measured).
- Ship the bundled system's generation prebuilt, so the first start reuses it instead of transpiling (build step 21.7 s -> 0.35 s measured; first start 35 s -> 14 s).
- Warn when a breakpoint is set in an `.abap` file the running system does not run (another checkout, the bundled copy, or an overridden object), and offer to open the copy that runs.
- Add a Marketplace build profile with staged third-party notices and no web extension entry. The sample interactive-fiction pack now uses a story rebuilt from an MIT source release.
- Add publisher metadata, Marketplace README, screenshots, and optional prerelease manifest property.
