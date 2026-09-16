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

## What it took to make it stable, and what each defect taught

The first screen appeared within the hour. Making it survive a second F8
took five more defects, and every one of them was found by measurement —
the tap on the dispatcher port, which records both directions, and once,
decisively, SAP GUI's own crash dump. None was visible by reading the code.

| what was wrong | how it showed | how it was found |
| --- | --- | --- |
| `isClose` knew only the OK-code `/i` | the stub answered the goodbye with another screen and the GUI tore down its command pipe | the closing frame in our capture carries `/NEX`, not `/i` |
| every frame had 200 bytes cut off its front | `compress=72` on a frame that is not compressed, the body failing to decompress, and a screen sent in reply to something we had not understood | the log line, once the capture showed the frame was well formed |
| the page was painted 24×80 | the first F8 was clean and the second glitched: columns past our width kept the previous session | the wrapper's `CHL` declares 26 rows and 120 columns, twice |
| the whole wrapper was re-sent every frame | SAP GUI died painting a toolbar button it had already freed | **the crash dump**: an access violation in `COldToolBar::DoPaintExternalButton` by way of `CMyPFBitmapButton::SetSystemToolbarIconTextWithKey`, with `CTextfield2::Parse: Invalid object type!` beside it |
| the stub waited to be closed | Eclipse reported a broken pipe on every second and third F8 | the control experiment, below |

The first of those is the reason the DP header matters at all: **the
client's first frame carries a 200-byte DP header and no later one does**,
so "have we answered yet" has to be its own flag. The light-show could
infer it from whether it had started pushing frames; a stub starts nothing.

### The one that needed a control experiment

The pipe complaint survived every protocol fix, and our farewell frame was
byte-identical to the real system's — `000a000000010000`, header only —
with the client sending nothing after it. Measurement inside our own
capture had run out.

So: the same jump against a real system. It was clean. That made it ours,
and told us where to look — not at how we answer the close, but at whether
the close should happen at all.

**A real F8 session ends server-side.** In the whole A4H capture the client
never sends `/NEX`. The server answers the last exchange, the `RFC_TR`
payload disappears because there is nothing more to show, and about two
seconds later it sends the bare end-of-session frame on its own. SAP GUI
then shuts its own window and hands control back to Eclipse. That is what
"jumping into SAP GUI and back" is.

Our stub sat there until somebody closed the window, and *that* path — the
client asking to leave — is the one Eclipse complains about. So the stub
holds its screen for a while and then ends the session itself. Which is
also the better experience: F8 shows the tape error for a few seconds and
puts you back in the editor.

### Where the line fell: a dynpro, not a list

The classic list channel gives what a dynpro cannot — a fixed-pitch grid,
colour bands that are foreground and background together, and therefore a
filled screen and a border. The Spectrum's striped loading border came out
of it exactly right, all four bands confirmed on the wire.

It also has more to go wrong, and it did: a list is cumulative, it is
written a row at a time and never painted over, and it has a declared page
geometry that must be filled. Each of those was a defect of its own.

So the default is the least the protocol can be asked to do: one dynpro, a
group box and a line of text, 4.6 KB against the list's 9.6. A group box
is a single atom and needs no colour, so the border survives the move to
monochrome. The list version is a flag (`-stub-list`), because it is a
thing to opt into rather than a thing to inherit.

```
lsd -listen :3201                  # one still screen, a frame, and the tape error
lsd -listen :3201 -stub-list       # the same in colour, with the striped border
lsd -listen :3201 -stub-hold 0     # wait for the window to be closed instead
```

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

**But that hello is not the one that reaches us.** The 403-byte hello with
the `LOGIN COOKIE` is the *initial, authenticated* logon (connection 1 of the
oracle). A reconnection an hour later (connection 3) is **317 bytes and
carries no `ST_USER.14` at all** — no cookie, just the UUIDs and the
language. And 317-bytes-no-cookie is exactly what a stock Eclipse sent our
own recorder, and the stub, on F8 against OSD. So the honest state of things:

| where | first hello | cookie present |
| --- | --- | --- |
| Eclipse → real A4H, initial logon | 403 bytes, `ST_USER.14` | yes, `<LOGIN … COOKIE=…/>` |
| Eclipse → real A4H, later reconnect | 317 bytes | no |
| Eclipse → OSD (bridge + stub), F8 | 317 bytes | **no** |

That means **a ticket check bolted on today would reject Eclipse**, because
Eclipse is not sending us a ticket — it opens SAP GUI against OSD anonymously
and it works only because the stub admits everyone. The cookie is real and
measured, but it is the real system's *initial* logon, and we have not made
Eclipse produce it against us.

Why the difference is client-side: Eclipse builds the SAP GUI connection
(the shortcut it hands the GUI) from what it knows about the system's
authentication. Against A4H it had an SSO ticket to pass; against OSD it
decided none was needed. So "make SSO work" is two steps, not one, and the
check is the *second*:

1. **Make the launch carry the ticket.** This is the missing half and it is
   about what ADT tells Eclipse at the `COM.SAP.ADT.SAPGUI` navigation event
   and the reentrance endpoint, so that Eclipse puts a ticket in the GUI
   connection. It has to be measured — the 403 hello is the target, and the
   difference between the A4H navigation response and ours is where it lives.
   Until this lands, there is nothing to verify.
2. **Then verify it.** Once the cookie arrives, the check below is what makes
   it mean something.

Beware the two "reentrance tickets" are not obviously the same one. The
`GET …/core/http/reentranceticket` we serve answers with a **307 redirect to
a loopback URL** carrying the ticket in its query — that is for Eclipse's
*embedded browser* to re-enter the HTTP session (a Fiori or Web Dynpro view
inside Eclipse), measured on both A4H and OSD. Whether the SAP-GUI `COOKIE`
is the same value by another road, or a distinct MYSAPSSO2, is the first
thing step 1 must settle.

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
| DIAG (SAP GUI, F8) | the stub, `:32NN` | `<LOGIN … COOKIE="…"/>` in the hello — **measured against A4H's initial logon, but not yet produced against OSD** | the stub reads nothing and lets everyone in; today's F8 hello carries no cookie |

So "can we enter SAP GUI by cookie" is yes in principle — the wire has the
field and a real system uses it — but two things are missing, not one. An
**authority**: one place that mints tickets and one rule that verifies them,
shared by all three doors. And, for DIAG specifically, the **launch path**:
Eclipse must be made to put the ticket in the GUI connection, which it does
against a real system and does not yet against us (see above). RFC is further
along: the wire has the tag (0x0670) and our client already writes it, so
there the only gap is the authority.

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
