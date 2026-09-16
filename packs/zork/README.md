# zork: a Z-machine in ABAP as a pack

`osd-pack.json` fetches `src/zork_00` of
[oisee/zork-abap](https://github.com/oisee/zork-abap) at a pinned commit into
`upstream/` (`node tools/osd-fetch.mjs`), minus the test classes and the two
loaders that read files through the GUI. `src/` layers over it:

- `zcl_apc_zork`, `zapc_zork.sapc.xml`: the push channel the terminal page
  speaks (`/sap/bc/apc/sap/zapc_zork`), written here.
- `zcl_zork_http_handler`, `zzork.sicf.xml`: the terminal page at
  `/sap/bc/zork/`, written here.
- `zork-mini%2ez3.w3mi.*`: the story file as an SMW0 object named with a dot,
  which is what the loader below looks for.
- `zcl_ork_00_game_loader_smw0`, `zif_ork_00_game_loader`: the loader finds
  the story by object id (`*.Z*`) rather than by a file name parameter.
- `zcl_ork_00_dict`, `zcl_ork_00_text`, `zcl_ork_00_zmachine`: declarations
  the transpiler needs written out (`DATA lv_x TYPE i` before an inline use,
  a local table type in place of `int4_table`) and one `ELSE` branch
  restructured. Candidates for upstream once each is reduced to a reproducer.
