# The lsd pack: SAP GUI screens replayed over a push channel

*Backlog E.8, first milestone, 2026-09-17.*

[sap-lsd](https://github.com/oisee/sap-lsd) is a rogue dispatcher: it speaks
enough DIAG for a real SAP GUI to connect and draw a demoscene light-show
from its frames. [sap-tui](https://github.com/oisee/sap-tui) is its terminal
viewer, which decodes the same frames and composes each screen — window
chrome, dynpro elements, list colours, icons — onto a grid of styled cells.

This pack puts that show on the launchpad without a SAP GUI, without DIAG in
the browser and without Go anywhere near it, by recording at the level of
the composed screen and replaying the recording over an ABAP push channel,
the way the ZO4D demo hands out its frames.

## The recording

`sap-tui --record show.jsonl.gz --size 36x120 --record-seconds 118` (the
flag added for this) connects to a running `sap-lsd`, composes every screen
the server sends for a fixed 36×120 terminal, and writes one JSON object per
line:

```
{"v":1,"rows":36,"cols":120}                  header
{"s":[[0,231,24,1],[1,16,254,0]]}             styles as first seen: id, fg, bg, flags
{"t":1234,"r":{"4":[["Hello",0],["   ",3]]}}  a frame: ms since the first, changed rows only
{"t":5678,"k":1,"r":{…every row…}}            a key frame, every hundred, for seeking
```

A row is a list of runs, text and style id; only rows that differ from the
previous frame are written. Colours are the xterm 256-colour indexes the
viewer already uses; flags are 1 bold, 2 underline, 4 reverse. The whole
show, 118 seconds and 1278 screens, is 2.8 MB raw and 141 KB gzipped.

The recording is an SMW0 object of the pack, `ZLSD-SHOW`, kept uncompressed
because the runtime's `cl_abap_gzip` is Node's zlib and the browser preview
has none; the wire stays small anyway, since a frame is its changed rows.
Compressing the stored object is the obvious next step once the browser
side can inflate it (`DecompressionStream`) or the page fetches it over HTTP
instead of the channel.

## The channel and the page

`ZCL_LSD_APC_HANDLER` (`/sap/bc/apc/sap/zapc_lsd`, stateful) loads the object
once per session — `WWWDATA_IMPORT`, `SCMS_BINARY_TO_XSTRING`,
`cl_abap_codepage=>convert_from`, `SPLIT` at newlines — and answers two
commands:

```
{"cmd":"info"}                     -> {"type":"show","lines":1287}
{"cmd":"lines","from":a,"to":b}    -> lines a..b-1, newline-separated
```

`ZCL_LSD_HTTP_HANDLER` (`/sap/bc/lsd/`) is the player: a canvas the size of
the grid, a monospace font, the 256-colour palette computed the xterm way,
rows painted from their runs, and a clock that applies each frame at its
recorded time; `?audio` serves the pack's music object when there is one
(`ZLSD-MUSIC`), and PLAY starts both. The page asks for the show in batches
of 200 lines and is ready in well under a second: the channel answers the
length in about 100 ms and a batch in a few.

Measured 2026-09-17 in Chromium against the tree on port 3040 and against
the preview build: the page reaches "Ready: 1278 screens", PLAY paints the
logon screen with its chrome and the show moves on; the preview test opens
the channel and checks the length and the header lines.

## What is not there yet

- Music: the object is wired, the file is not in the pack yet.
- Icons: the viewer expands `@XX@` tokens into glyphs the page paints as
  boxes; a small icon font or the viewer's own glyph table would fix it.
- A real DIAG decoder in JavaScript (a port of `pkg/diag` and the LZH
  reader), so the page could follow a live dispatcher rather than a
  recording. That is the second milestone, if wanted.
