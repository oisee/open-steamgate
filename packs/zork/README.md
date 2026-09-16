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
