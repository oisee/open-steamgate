# The browser bundle, handed over

Her demo already runs on OSD through the server route. This is the other one:
the same demo as a single page with **no server at all** — her transpiled ABAP,
her APC handler, and a WebSocket that reaches the handler instead of a network.

Handed from the transpiler session to open-steamgate on 2026-09-14. It builds
and it does not yet run. What is here, what is missing, and the two traps.

## What works

- `webpack.config.cjs` bundles the transpiled output into one file. Measured:
  **12.6 MiB**, compiled in 8.8 s.
- `entry.mjs` boots the runtime and installs the WebSocket shim from
  `open-abap-apc/web/apc-socket.mjs`, synchronously, before the page's own
  script can call `new WebSocket`, and hands it a `ready` promise so it waits
  for the boot rather than racing it.
- `bundle.mjs` runs webpack through its Node API, because the tree has
  `webpack` and no `webpack-cli`, and installing one would change a checkout
  that is not ours.
- `shot.mjs` serves `build/` and drives it in Chromium: reads `#info` and
  `#part-info`, clicks START, and counts lit pixels on the WebGL canvas with
  `readPixels`. A screenshot alone cannot tell a black canvas from a canvas
  that is not there — the earlier `getContext("2d")` probe answered "no 2d
  context" for a WebGL canvas, which is true and useless.

## What is missing

1. **The page does not load the bundle.** `build/index.html` is her original
   and has no `<script src="vivid.js">`, so `install()` never runs, her code
   opens a real socket and gets a 404, and the canvas stays black. That is the
   whole of the first failure, and it is one line. It is also why "it builds"
   meant nothing: the 12.6 MiB sat beside the page, unloaded.

2. **Media are fetched over HTTP.** Her page does `au.src = '?audio=' + name`
   and `img.src = '?image=' + name`. With no server those are 404s. They have
   to be answered from `abap.W3MI` inside the page — a blob URL per object,
   built once and cached. Watch the size: the mp3 is 4 MB and the runtime
   carries an xstring as a hex string, two characters to the byte, so the naive
   route costs about 24 MB of transient string per media object. See
   `ANOMALY-2026-09-13-xstring-as-hex`.

3. **Nobody has measured the start-up cost** of a 12.6 MiB bundle. It may be
   fine and it may be ten seconds; it is unknown, and unknown is not fine.

## The two traps

- The percent. abapGit writes `ZO4D_06_PLASMA.PNG` as `zo4d_06_plasma%2epng`,
  the transpiler escapes the percent in the specifier, and the file on disk
  carries it raw. The `NormalModuleReplacementPlugin(/%25/)` in the config
  puts it back. Remove it and the build fails on a file that is right there.
- Paths in `webpack.config.cjs` are absolute into
  `/home/alice/dev/open-steamgate-shlp/node_modules`. That is deliberate for a
  scratch build and wrong for anything permanent.

## Running it

    node bundle.mjs        # writes build/vivid.js
    node shot.mjs          # serves build/ and drives Chromium
