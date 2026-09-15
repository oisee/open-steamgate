# DIAG, from the dispatcher's side: what a stub screen would take

The compatibility graph now tells Eclipse this system can drive SAP GUI
([`adt-facade.mjs`](../tools/adt-facade.mjs), `COM.SAP.ADT.SAPGUI`), so running
a report from the editor hands off to SAP GUI, which opens **DIAG** on the
dispatcher port — `32NN` for instance NN, where the ADT bridge answers the
gateway port `33NN`. Two different doors; we have built the first and this is
the survey of the second.

These are protocol facts measured from a passive tap of one SAP GUI session
against a sandbox, and from what SAP GUI sent our own recorder when it tried.
No captures are in this repository; nothing below names a system, a user or a
session. This is the C.2 measurement of the DIAG side quest (backlog track C):
enough to size C.4, not itself a screen.

---

## The opening, and where SAP GUI stops against us

```
SAP GUI ──▶ dispatcher :32NN
  C→S  NI route request (ffffffff…)   the connect, carrying the intent
  S→C  DIAG frame                      session setup + the first screen
  C→S  DIAG frame                      the user's first action
  …
```

The recorder (`diag-catch`, in open-rfc-go) accepts the connection, writes the
frame down and deliberately never replies, so SAP GUI says as much as it will
before giving up. What it said, on an F8 from Eclipse: an **NI route request**,
317 bytes, of which 221 are byte-identical to the same request against a real
system — same shape, same terminal id. Its payload carries the navigation
intent in clear text, `_NAVIGATION=X;D_WB_ACTION=EXECUTE;D_ECLIPSE_PROJECT=…`,
which is Eclipse telling SAP GUI to run the object and come back.

So the client reaches us and waits for a screen. It never gets one, which is
the whole of why the result is a blank window.

## The frame

A DIAG frame is an **8-byte header** and a body. The body is optionally
SAP-LZH compressed, and the header says which: one of its bytes is a
compression flag, and the setup frames a real system sends are **uncompressed**
(flag zero). That matters more than anything else here — a stub can answer
uncompressed, so it needs no LZH *writer*, which is the one piece this side of
the family only has a *reader* for (`vsp/pkg/sapcompress`, decode-only).

When a frame is compressed it is the same container the RFC metadata tables
use: the `1f 9d` magic, algorithm `0x12`, a length, then a two-bit prefix and
raw DEFLATE. It decodes with the same code and, in Python, with
`zlib.decompressobj(-15)` after the prefix shift.

## The items

The body is a stream of items, each a type byte and then its payload. Two
carry a length and are how everything variable travels:

| type | name | operand |
| --- | --- | --- |
| `0x10` | APPL | id, sid, 16-bit length, value |
| `0x12` | APPL4 | id, sid, 32-bit length, value |
| `0x0c` | end of message | — |

An APPL item is addressed by an **(id, sid)** pair — a category and a subtype.
Measured over the setup and screen frames, the categories a screen is built
from are:

| id | what it carries (by its sids) |
| --- | --- |
| session-parameters | the codepage, the protocol level, the system id, the host, the client, the whole function-key table, the dynpro defaults — the frame that sets a session up |
| menu | the menu bar and menus, one sid per top-level entry, the text inline |
| title | the window title and the transaction/screen title, the text inline |
| session/status | language, user, and the status bar line |
| screen-geometry | the screen's rows and columns |

The first server frame is the biggest: it is the session parameters and the
first dynpro together, which is why a real one runs to thousands of bytes
decompressed. A smaller screen is a title, a geometry, the fields, and the end
marker.

## What a stub still needs, and does not

**Does not need:** an LZH writer (answer uncompressed), and does not need to
implement DIAG — only to emit one frame SAP GUI will paint.

**Still needs:** the encoding of the **field items** — the DYNT / DYNT_ATOM
that place text at a row and column on the screen. The categories above are
the chrome around a screen; the text *in* it is a field item, and its exact
byte layout is the one part not yet read out of the capture to the byte. That
is the gap between "we can read a DIAG screen" and "we can write one", and it
is where the private DIAG sibling's screen writer already lives — the note in
[`layers-we-own.md`](layers-we-own.md) records it as ready there.

So C.4 — "Sorry, the guru meditates" on a screen SAP GUI renders — is a
focused piece: complete the NI handshake, emit an uncompressed frame of a
title, a geometry, one DYNT_ATOM carrying the text, and the end marker. The
only unknown left is that one item's layout, by measurement or by lifting the
writer from the sibling. Everything else in this file is settled.

## See also

- [`layers-we-own.md`](layers-we-own.md) — the DIAG reader/writer split across the family
- [`backlog.md`](backlog.md) — track C, the side quest and its steps
- [`adt-over-rfc.md`](adt-over-rfc.md) — the gateway door, which is built
