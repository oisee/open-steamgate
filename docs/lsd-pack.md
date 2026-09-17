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
the way the ZO4D demo hands out its frames. The video of the same show
driving a real SAP GUI is at
<https://www.youtube.com/watch?v=Pszxxj-OUAk>.

## The recording

`sap-tui --record show.ndjson --size 36x120 --record-seconds 215` (the flag
added for this) connects to a running `sap-lsd`, composes every screen the
server sends for a fixed 36x120 terminal, and writes one JSON object per
line:

```
{"v":1,"rows":36,"cols":120}                  header
{"s":[[0,231,24,1],[1,16,254,0]]}             styles as first seen: id, fg, bg, flags
{"t":1234,"r":{"4":[["Hello",0],["   ",3]]}}  a frame: ms since the first, changed rows only
{"t":5678,"k":1,"r":{...every row...}}        a key frame, every hundred, for seeking
```

A row is a list of runs, text and style id; only rows that differ from the
previous frame are written. Colours are the xterm 256-colour indexes the
viewer already uses; flags are 1 bold, 2 underline, 4 reverse.

**Record the whole show, not a fixed guess at its length** (2026-09-17). The
first recording stopped at 118 seconds because that is what it was told, and
the finale — `greetstorm`, the tornado of greetings that `sap-lsd` plays for
82 seconds and then loops forever — was cut in the middle of its first pass.
The show is a timeline (`assets/show.json` of sap-lsd, scene and seconds),
so the length is known before recording: here the finale was given 140
seconds on the timeline, the recording ran 215, and the stream was then cut
at 209.5 seconds, which is the music. 2422 screens, 5.2 MB of text.

The object is stored **gzip**, `ZLSD-SHOW`, 225 KB — twenty-three times
smaller, and a pack that a public repository carries has to be worth its
size. Neither side inflates it: the channel hands the bytes out as base64 and
the page inflates them with `DecompressionStream`, which is the browser's own
zlib. That is what makes the compression free here — `cl_abap_gzip` is Node's
zlib on a server and nothing at all in a service worker, so anything that had
to inflate in ABAP would work in one deployment and not in the other.

## The channel and the page

`ZCL_LSD_APC_HANDLER` (`/sap/bc/apc/sap/zapc_lsd`, stateful) loads the object
once per session — `WWWDATA_IMPORT`, `SCMS_BINARY_TO_XSTRING` — and answers
two commands:

```
{"cmd":"info"}                     -> {"type":"show","bytes":N,"encoding":"gzip"}
{"cmd":"bytes","from":a,"to":b}    -> base64 of the bytes a..b-1
```

The page asks in 64 KB chunks and shows the percentage. An offset on an
xstring is not allowed where a method's actual parameter is expected, so the
slice goes into a variable of its own before `cl_http_utility=>encode_x_base64`
sees it; the syntax check says so plainly and it is the only ABAP subtlety in
the pack.

`ZCL_LSD_HTTP_HANDLER` (`/sap/bc/lsd/`) is the player: a canvas the size of
the grid, a monospace font, the 256-colour palette computed the xterm way,
rows painted from their runs, and a clock that applies each frame at its
recorded time; `?audio` serves the pack's music object (`ZLSD-MUSIC`).

What the page does on its own (2026-09-17):

- **It starts when the show is in.** A light-show that waits to be asked is a
  screenshot. The music cannot start by itself — every browser refuses audio
  without a gesture — so when `play()` is rejected the show runs on, the
  status line says *click anywhere for the music*, and the first click or key
  brings the sound in at the second the show has reached.
- **Stop and Play, not pause.** Stop returns to the first screen and Play
  replays the show, which is what a demo on a wall needs.
- **The finale is replayed, not the show.** If the recording runs out while
  the music is still going, the page jumps back to the first frame of the
  finale (measured: frame 1191, 111.0 s, where the LED wall ends) and
  restores the screen as it stood there, rather than restarting at the logon
  screen. The recording is longer than the track now, so this is a guard
  rather than something anybody sees.
- **Links, small, at the bottom**: sap-lsd, open-steamgate, and the video of
  the same show in a real SAP GUI.

Measured 2026-09-17 in Chromium against the tree: the page inflates 225 KB
into 2422 screens and starts by itself in about a second; the LED wall at
1:38 and the finale at 2:30 paint as recorded.

## What is not there yet

- Icons: the viewer expands `@XX@` tokens into glyphs the page paints as
  boxes; a small icon font or the viewer's own glyph table would fix it.
- A real DIAG decoder in JavaScript (a port of `pkg/diag` and the LZH
  reader), so the page could follow a live dispatcher rather than a
  recording. That is the second milestone, if wanted.
