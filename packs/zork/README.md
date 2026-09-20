# zork: a Z-machine in ABAP as a pack

`osd-pack.json` fetches [oisee/zork-abap](https://github.com/oisee/zork-abap)
at a pinned commit (`node tools/osd-fetch.mjs`): `src/zork_00`, the
interpreter, into `upstream/` minus the test classes and the two loaders that
read files through the GUI; `src/zork_02`, the story files as SMW0 objects,
into `games/`. `src/` layers over both and is what OSD adds:

- `zcl_apc_zork`, `zapc_zork.sapc.xml`: the push channel the terminal page
  speaks (`/sap/bc/apc/sap/zapc_zork`); it loads `ZORK-MINI-Z3` through the
  SMW0 loader.
- `zcl_zork_http_handler`, `zzork.sicf.xml`: the terminal page at
  `/sap/bc/zork/`.

Nothing of upstream is changed. An earlier pack carried five classes from an
older commit of the same repository; at the pinned commit they need nothing.

## Story-file provenance

The packaged `games/zork-mini-z3.w3mi.data.z3` has SHA-256
`c74f01a232e8df4b05d7ebcba14870143f49b3c9a25f194f7a7d2c69e31ea4a6`.
The [Z-Machine Standards Document, Appendix F](https://www.inform-fiction.org/zmachine/standards/z1point1/appf.html)
describes Mini-Zork as public domain. That statement concerns the Mini-Zork
story file; the separate MIT release of Zork I–III source is not its license.

## Browser replay smoke test

**Replay SPEEDRUN** loads the existing `ZORK-MINI-SPEEDRUN-TXT` SMW0 resource
through `/sap/bc/zork/speedrun.txt` and executes its full 37-command route,
including the house, cellar, troll and final `score`. The source remains
`packs/zork/games/zork-mini-speedrun-txt.w3mi.data.txt`; it is not copied into
JavaScript. Progress follows each prompt and rendering completion. This script
has no expectation directives and combat is random: completion means the
commands ran, not that the player won. A game-over before completion stops the
replay with an error instead of waiting indefinitely for another prompt.

The long-route browser test compares the served resource with the pack file,
asserts every real APC WebSocket command in order, and checks the displayed
score. The packaged `zork-mini-test-txt` expectation script remains separate;
it is not yet an HTML replay mode.

The HTML terminal has a **Replay short route** action. After confirmation it
discards the current game, opens a fresh APC session, opens the mailbox and
reads the leaflet. Progress follows actual prompt responses and terminal
render completion, with a 30-second response timeout. Cancel opens a fresh
session for manual play; declining the confirmation preserves the existing game.
This is a two-command regression route, not a complete Zork speed-run.

`test/e2e/zork.spec.mjs` checks real terminal input, APC/engine responses, fresh
session state, rendered output, return to manual play, decline and cancellation.
The checked-in fixture is compared with the page route to detect drift. Main
CI runs this suite alongside launchpad navigation; no mock game is substituted.
The HTML still obtains xterm from its existing CDN, so browser checks need access
to that dependency. The direct CLI WebSocket runner remains a separate test path.
