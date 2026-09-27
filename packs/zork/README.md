# zork: a Z-machine in ABAP as a pack

`osd-pack.json` fetches [oisee/zork-abap](https://github.com/oisee/zork-abap)
at a pinned commit (`node tools/osd-fetch.mjs`): `src/zork_00`, the
interpreter, into `upstream/` minus the test classes and the two loaders that
read files through the GUI. The `games/` source excludes every file at this
pinned commit, including all obsolete Mini-Zork assets. `src/` layers over the
interpreter and is what OSD adds:

- `zcl_apc_zork`, `zapc_zork.sapc.xml`: the push channel the terminal page
  speaks (`/sap/bc/apc/sap/zapc_zork`); it loads `ZORK1-Z3` through the
  SMW0 loader.
- `zcl_zork_http_handler`, `zzork.sicf.xml`: the terminal page at
  `/sap/bc/zork/`.

Nothing of upstream is changed. An earlier pack carried five classes from an
older commit of the same repository; at the pinned commit they need nothing.

## Story-file provenance

The pack carries `src/zork1-z3.w3mi.data.z3`, rebuilt from Microsoft's
MIT-licensed Zork I source release. [STORY-BUILD.md](STORY-BUILD.md) records
the pinned source and toolchain, two matching fresh builds, the SHA-256, and
the ZILF library license audit. `ZORK1-LICENSE.txt` is Microsoft's verbatim
MIT notice. The obsolete Mini-Zork files are not fetched by `osd-pack.json`.

## Browser replay smoke test

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
