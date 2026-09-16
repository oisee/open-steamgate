# o4d: the ZO4D demos as a pack

`osd-pack.json` fetches [oisee/vivid-vibes](https://github.com/oisee/vivid-vibes)
at a pinned commit into `upstream/` (`node tools/osd-fetch.mjs`), minus the
two programs that need the GUI and two effects that do not compile at that
commit. `src/` layers over it and holds one change against upstream:

- `zcl_o4d_http_handler`: the megademo page asks the handler for
  `?img=<NAME>.PNG`, which is the route the handler serves; upstream's page
  asks `?image=<name>` and no route answers it. To send upstream.

The demo is `/sap/bc/zo4d_demo/`, the push channel `/sap/bc/apc/sap/zo4d_demo`.
