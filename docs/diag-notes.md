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
session. This began as the C.2 measurement of the DIAG side quest (backlog track C);
the stub it sized is now built and measured, below.

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

## The stub, as built (C.4, done 2026-09-16)

No field-item layout had to be measured after all. The family already had
the writer: [open-diag-go](https://github.com/oisee/open-diag-go)'s `lsd`
is a self-contained DIAG server — the setup and wrapper frames it splices
its screens into are embedded, scrubbed of every identifier, so it needs no
capture and no external file — and its `pkg/frame` builds a dynpro from
`Text`, `Frame`, `Lines` and the rest. What was added is one flag,
`-stub guru|spectrum`: answer *every* client frame with the same still
screen, push nothing, and end the session cleanly on the window close.

```
lsd -listen :3201 -stub guru        # instance 01: 3201 is DIAG, 3301 the RFC bridge
```

Measured with a stock Eclipse: F8 on `ZOSD_TEST_DEMO_PROG` hands the
embedded SAP GUI to that port, and the guru is what it paints — the box
with "Software Failure. Press left mouse button to continue." and
`Guru Meditation #4F534400.000000F8` (4F5344 spells OSD; F8 is the key).
The GUI sent three frames: the hello (317 bytes, 7 items), one after the
first screen (454 bytes, 22 items), and 51 bytes on close. Each got the
same screen; the last got the session end. A "connection held" is nothing
more than that: DIAG is request and answer, and the socket stays open until
the client says it is leaving.

What the light-show did before the flag existed is worth recording, because
it is the failure mode of every stub that thinks it is a game: it treated the
GUI's second frame as a keypress and froze mid-scene, which is the "junk"
screen a plain SAP GUI showed on a double-click.

## Who is calling: the session identity in the hello

The two client frames of the F8 oracle (a real system, tapped on its
dispatcher port) answer the question "how does the dispatcher know it is
you" to the byte.

**Frame 1, the hello — 403 bytes, uncompressed.** The NI route request, a
200-byte DP header, and seven `ST_USER` items. The one that matters is
`ST_USER.14`, 88 bytes of XML:

```
<LOGIN CLIENT="001" LANGUAGE="E" COOKIE="…"/>
```

`COOKIE` is a **reentrance ticket**. Before it starts SAP GUI, Eclipse asks
the ADT server for one — `GET /sap/bc/adt/core/http/reentranceticket`, which
here travels over the RFC bridge to the façade — and passes it to the GUI on
its command line. The GUI presents it in the hello instead of a password,
and the dispatcher's logon turns it into a user. Beside it ride
`GUI_SESSION_UUID` (16 bytes) and `RFC_PARENT_UUID` (32 bytes): the identity
of the session the hand-off came from.

**Frame 2, after the session screen — 595 bytes, compressed.** `VARINFO.04`
carries the OK-code, which is a transaction with its parameters:

```
/n*SADT_START_WB_URI D_OBJECT_URI=/sap/bc/adt/programs/programs/<prog>/source/main;
  D_ECLIPSE_NAVIGATION=X;D_WB_ACTION=EXECUTE;D_ECLIPSE_PROJECT=<project>;
  D_TID=;D_IDE_ID=;D_REQUEST_USER=<user>;D_IDE_USER=<user>;D_GUID=<uuid>
```

What to run and who asks. `D_REQUEST_USER` is what the client *claims*; the
`COOKIE` in frame 1 is what the system *checks*. Around it: the Windows, IE
and Office versions (`ST_USER.1f/20/21`), a `DYNN` item and a 263-byte
`DATAMANAGER` XML.

**Two things worth knowing about that cookie.** The hello is uncompressed,
so the ticket lies on the wire in clear — compression was never protection,
and the protection DIAG has is SNC, which is out of scope here. And a
reentrance ticket is meant to be short-lived and single-use: it exists to
re-enter the same system from another channel within seconds, not to be a
credential.

## SSO across the three doors: what the cookie could do for us

The measurement above says the same ticket shape logs on through every
door a system has, and this project now has all three doors:

| door | who answers | how a ticket travels | today |
| --- | --- | --- | --- |
| HTTP (ADT, OData, a Web GUI page) | the façade, `:3030` / `:44300` | a cookie on the request | the façade mints a reentrance ticket (24 random bytes, base64url) and forgets it: bound to nothing, checked by nobody |
| RFC (Eclipse over the gateway port, an RFC client) | the bridge, `:33NN` | the logon record's credential field as `TagTicket` (0x0670): a ticket instead of a password. `open-rfc-go` already encodes it on the client side (`internal/cpic/logon.go`, `Ticket`) | the bridge checks no logon at all — every caller is anonymous |
| DIAG (SAP GUI, F8) | the stub, `:32NN` | `<LOGIN … COOKIE="…"/>` in the hello — **measured** | the stub reads nothing and lets everyone in |

So the answer to "can we enter SAP GUI by cookie" is yes, it is the only way
the GUI enters on F8; and "RFC under the same cookie" is yes as well, the
wire has a tag for it and our client already writes it. What is missing is
not a channel, it is an **authority**: one place that mints tickets and one
rule that verifies them, shared by all three doors.

**The design, small on purpose.** The façade is the identity authority; it
already owns sessions, CSRF and the reentrance endpoint.

1. **A ticket is a signed claim, not a random string**: `user | client |
   issued-at | nonce`, HMAC-signed with a secret the façade generates on
   first start and keeps under `.local/`. Sixty seconds of life, single use
   (the façade remembers the nonce until it expires).
2. **Every door verifies with the same secret, offline**: the DIAG stub
   checks `COOKIE`, the RFC bridge checks `TagTicket`, the HTTP middleware
   accepts the same value as a cookie. No door calls the façade to ask
   "whose ticket is this"; they share the secret through the same config
   file the sidecar already reads. A door that cannot verify refuses — an
   unknown ticket is a 401, not an anonymous session.
3. **The reentrance endpoint issues for the session that asks**: the user of
   the ADT session (today `DEVELOPER`, client 001, from the façade's
   identity) goes into the claim. That closes the loop Eclipse expects: the
   GUI arrives as the user who pressed F8, and the stub can say so on the
   screen and cross-check `D_REQUEST_USER`.
4. **The jump from a page works the same way**: a Web GUI or launchpad page
   served by the façade asks the same endpoint for a ticket and starts SAP
   GUI with it, which is exactly what Eclipse does. The GUI-side switch that
   takes the ticket is the client's business and was not measured here;
   the DIAG side is settled.
5. **The reverse direction, RFC and DIAG into HTTP**: a session that logged
   on by ticket at the bridge or the stub can be handed a cookie of the same
   shape, so a client that came in over RFC and then opens a browser is the
   same person to the façade.

What this buys beyond correctness: dumps and where-used answers per user,
a personalised guru, and — the real one — the bridge finally checking a
logon, which is the precondition for OSD ever facing anything but a laptop.
It is a session-day of work across the three repositories, and the order is
the façade first (mint and verify), then the stub (one `COOKIE` check), then
the bridge (one `TagTicket` check).

## See also

- [`layers-we-own.md`](layers-we-own.md) — the DIAG reader/writer split across the family
- [`backlog.md`](backlog.md) — track C, the side quest and its steps
- [`adt-over-rfc.md`](adt-over-rfc.md) — the gateway door, which is built
