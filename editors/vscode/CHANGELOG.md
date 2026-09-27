# Changelog

## Unreleased

- The OSD tree opens its pages inside VS Code by default (the Fiori Launchpad, apps, services, `$metadata`, the `/osd/*` endpoints): one tab per page, reused on a second click. Each such node has an inline link-external action and an "Open in External Browser" context item for the system browser. `osd.openIn: browser` restores the old default.
- Add **osd: Generate taxi data...** and **osd: Reset taxi data to minimal**, also on the taxi data service in the OSD tree: the system no longer makes taxi sample rows at start.
- Ship the bundled system's cross-reference rows with its prebuilt generation, so the first start seeds them from a file instead of parsing the tree (5.1 s -> 0.1 s measured).
- Ship the bundled system's generation prebuilt, so the first start reuses it instead of transpiling (build step 21.7 s -> 0.35 s measured; first start 35 s -> 14 s).
- Warn when a breakpoint is set in an `.abap` file the running system does not run (another checkout, the bundled copy, or an overridden object), and offer to open the copy that runs.
- Add a Marketplace build profile with staged third-party notices and no web extension entry. The sample interactive-fiction pack now uses a story rebuilt from an MIT source release.
- Add publisher metadata, Marketplace README, screenshots, and optional prerelease manifest property.
