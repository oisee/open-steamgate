# Changelog

## Unreleased

- The Test Explorer runs ABAP Unit by `RISK LEVEL`: HARMLESS objects in parallel (longest `DURATION` first), the rest one at a time after them; an undeclared level counts as DANGEROUS. A HARMLESS class that reaches a database write is warned about on its `RISK LEVEL` line and runs alone, and one that writes anyway fails with "RISK LEVEL HARMLESS but wrote to <table>". Cancel now stops the test run in flight.
- Stop (and Rebuild) no longer warn "the system stopped unexpectedly": a stop you asked for logs `--- osd stopped ---`, and only an exit nobody asked for warns.
- Add **osd: Generate taxi data...** and **osd: Reset taxi data to minimal**, also on the taxi data service in the OSD tree: the system no longer makes taxi sample rows at start.
- Ship the bundled system's cross-reference rows with its prebuilt generation, so the first start seeds them from a file instead of parsing the tree (5.1 s -> 0.1 s measured).
- Ship the bundled system's generation prebuilt, so the first start reuses it instead of transpiling (build step 21.7 s -> 0.35 s measured; first start 35 s -> 14 s).
- Warn when a breakpoint is set in an `.abap` file the running system does not run (another checkout, the bundled copy, or an overridden object), and offer to open the copy that runs.
- Add a Marketplace build profile with staged third-party notices and no web extension entry. The sample interactive-fiction pack now uses a story rebuilt from an MIT source release.
- Add publisher metadata, Marketplace README, screenshots, and optional prerelease manifest property.
