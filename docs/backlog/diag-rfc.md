
## Track C — the side quest: RFC in, DIAG out

*Answer SAP GUI on the dispatcher port with a screen. Start by showing one
picture and nothing else.*

The point is not to implement DIAG. It is that this project already speaks the
gateway half of a system's front door, and the other half — the one SAP GUI
knocks on — is a protocol we can already *read*. Answering it at all, even with
one static screen that says the guru meditates, turns "an OData runtime with an
ADT façade" into "something a SAP client connects to", and tells us exactly how
big the real thing would be.

**What the oracle says.** A SAP GUI logon against a sandbox was captured
through a passive tap (40 frames, dispatcher port 3200, kept under `.local/`,
never here):

- the conversation is **NI-framed**, like RFC, and opens with the same
  `ffffffff` route request;
- **30 of 37 payload frames are SAP-LZH compressed** — the `1f 9d` magic with
  algorithm byte `0x12`, the same container `pkg/sapcompress` in vsp already
  decodes;
- the handshake frames that are *not* compressed carry readable items: the
  codepage (`4110`, `utf-8`), the protocol level (`4103`), a session id.

```
C.1  Decide the smallest honest goal                                     [A]
     ├─ proposal: SAP GUI connects, gets a logon screen or a single dynpro
     │  carrying one message, and stays connected long enough to read it
     └─ non-goal, explicitly: a usable GUI, transactions, or input handling

C.2  Read the oracle properly                                       [R] DONE
     ├─ done 2026-09-16: docs/diag-notes.md. Frame = 8-byte header + body,
     │  body optionally SAP-LZH (flag in the header; setup frames are
     │  UNCOMPRESSED, so a stub needs no writer). Items are (type, id, sid,
     │  len, value); 0x10 APPL / 0x12 APPL4 / 0x0c end. The screen chrome
     │  (title, menu, geometry, session/status) is mapped
     ├─ the SAPGUI capability shipped (9d232e5) made SAP GUI actually connect:
     │  it sends an NI route request carrying _NAVIGATION=…;D_WB_ACTION=EXECUTE
     │  and waits for a screen. diag-catch records it and never replies
     └─ ONE unknown left: the DYNT/DYNT_ATOM field-item layout, the text
        *in* a screen. That is the gap between reading a screen and writing
        one, and it is what C.4 needs

C.3  The LZH *writer* question                                     [A] ANSWERED
     └─ answered by the measurement in C.2: a DIAG setup frame is sent
        UNCOMPRESSED (the header's compress flag is zero), so a stub needs
        no LZH writer at all. The writer stays a want for parity with a real
        system's traffic, not a blocker for C.4

C.4  A dispatcher listener that says one thing                     [R] DONE
     ├─ done 2026-09-16, and not the way it was sized: nothing had to be
     │  measured. open-diag-go's lsd already is a self-contained DIAG server
     │  with an embedded, scrubbed wrapper and a screen writer; one flag,
     │  -stub guru|spectrum, makes it answer every frame with one still
     │  screen and end cleanly on close (branch osd-stub there)
     ├─ measured with Eclipse: F8 on ZOSD_TEST_DEMO_PROG hands SAP GUI to
     │  :3201 with a reentrance ticket in the hello, and the guru is painted.
     │  Three client frames, each answered with the same screen
     ├─ the local lab: façade :3030, bridge :3301, stub :3201, one instance
     │  (01) on one WSL address; the Eclipse project is Custom Application
     │  Server with that host and instance
     └─ docs/diag-notes.md: the stub as built, and what the hello carries

C.5  One ticket, three doors: SSO across HTTP, RFC and DIAG               [S+R]
     ├─ measured: the GUI logs on by cookie (<LOGIN COOKIE=…/> in the hello),
     │  RFC has a credential tag for a ticket (0x0670, open-rfc-go writes it),
     │  HTTP takes it as a cookie. Every door exists; no authority does
     ├─ the façade mints a signed claim (user, client, issued, nonce; HMAC,
     │  60 s, single use) instead of 24 random bytes; the stub, the bridge
     │  and the HTTP middleware verify with the shared secret, offline
     ├─ then the bridge checks a logon for the first time, the stub knows
     │  who pressed F8, and a page on the façade can jump into SAP GUI the
     │  way Eclipse does
     └─ docs/diag-notes.md, "SSO across the three doors"; about a session-day

C.6  Then, and only then, decide whether it goes further                 [A]
     └─ a real DIAG server is a large thing; this track is allowed to stop
        at C.4 having proved the point
```

---

## Track R — HTTP carried over RFC, and the ticket that gets us in

*Proposed by Alice 2026-09-19. Ideas, not a plan: what is measured is marked
as measured and what is a guess says so.*

Track D goes one way -- an RFC client calls **our** function modules. This is
the other: a server here that speaks ordinary HTTP to a browser and reaches a
real system **by RFC**, routing the request through function modules instead
of through that system's ICF port.

**Why it would be worth having.** A service that was never exposed on the
system's web port is unreachable for us today, and a great deal of what we
want to test against is exactly that: something switched on inside and not
published outside. RFC is often open where HTTP is not, and one credential
then reaches everything the RFC user may call. For testing this collapses
"ask somebody to publish the service" into "call it".

R.1  **The ticket, from the browser into RFC.**
     A web logon yields an SSO ticket; the question is whether it can be the
     RFC logon rather than a password.
     ├─ **Measured today**: our client is `open-rfc@0.2.3`, and the only
     │  authentication it names is **SNC** -- a search of the package for
     │  `mysapsso2`, `ssoticket` or `x509` finds nothing. So forwarding a
     │  ticket is **not** something we can do with what is installed; it is a
     │  change in the client or a different client
     ├─ what has to be measured next, in this order: does the RFC protocol
     │  carry a ticket at all as a logon parameter, and does `open-rfc`'s
     │  handshake have a place to put it. The first is a protocol fact and
     │  the sibling `open-rfc-go` is where to look; the second is our code
     └─ until both are answered, everything below runs as a named RFC user,
        which is enough for testing and not enough for anything else

R.2  **The dispatcher: an HTTP request executed through a function module.**
     **It is not unknown, and the answer was already in this repository.**
     Written here first as "whether such a module exists is not known", which
     Alice corrected in one sentence: it is the module that lets Eclipse in.
     Its name was in `docs/adt-over-rfc.md` and **twice in this very file**,
     once with a measurement beside it. The mistake was not memory this time,
     it was not reading our own notes -- and a search for the thing by its
     shape would have found it, while a search for it by name could not,
     because the name was what was missing.
     ├─ **`SADT_REST_RFC_ENDPOINT`**, remote-enabled, two recursive
     │  parameters: `REQUEST` of `SADT_REST_REQUEST` and `RESPONSE` of
     │  `SADT_REST_RESPONSE`. Both are the same three fields -- a line, a
     │  `TIHTTPNVP` table of name/value pairs, and an `RSTR` body. **An HTTP
     │  exchange**, which is why our own bridge for it "needs no opinion
     │  about ADT"
     ├─ function group `SADT_REST`, and it has been **exercised**, not only
     │  read: this file records `GET /sap/bc/adt/discovery` over RFC
     │  answering 200 with the atomsvc document (2026-09-14, Tier 2b). So
     │  the door exists, is stock, carries a generic HTTP exchange and has
     │  been opened once
     ├─ **what is still open is narrower, and it is the whole question**:
     │  that measurement used an **ADT** path. Does the module dispatch *any*
     │  ICF path -- `/sap/opu/odata/…`, `/sap/bc/ui5_ui5/…` -- or only
     │  `/sap/bc/adt/…`? The payload does not restrict it; the handler behind
     │  it may. One call with a non-ADT path answers it, and until that call
     │  is made this track reaches ADT and nothing that has been shown
     ├─ the bootstrap is documented too and is not free: `RFC_GET_FUNCTION_INTERFACE`
     │  for the parameters, then DDIC lookups for `SADT_REST_REQUEST`,
     │  `SADT_REST_RESPONSE` and `TIHTTPNVP`, and only then the call. A
     │  client that has never spoken to the system pays for all of it
     ├─ the payload is SAP Binary XML rather than text xRFC, which the same
     │  document works through -- so this is a decode we already own rather
     │  than one to invent
     └─ if the path does turn out to be restricted, the fallback stands:
        carry one function module of our own, deployed the way level 2
        already deploys objects. That turns the track from "use the door"
        into "carry our own", which is slower and entirely within reach

R.3  **The local front.** Ordinary `http`/`https` here, so a browser, a test
     and `abap-adt-api` all speak to it without knowing what is behind. This
     part is small: we already have the shim, the ICF mount and TLS.

**What it would change, if R.2 has an answer.** Every test that today needs a
published service could run against a system that publishes nothing. And it
would make the A4H round trip cheaper than it is now: no `Activate and
Maintain Services`, no publishing, no waiting for a human at a GUI.

**What to be careful about, said now rather than after.** This is a
credential that reaches everything the RFC user may call, over a channel that
is usually open. Destinations stay in `.local/`, the ticket never lands in a
tracked file, and the front listens on localhost until somebody has thought
about it properly. The A4H rule is unchanged: only when Alice asks.

---

## Track D — the RFC gateway: expose every RFC-enabled function module

*The ADT bridge terminates RFC for one function module. Make it a real gateway
for all of them: an external RFC client calls any exposed function module of
this project as if it were RFC-enabled, and gets a typed answer.*

Added 2026-09-16 (Alice). The point is that the door is already open — the
bridge is an RFC server, it already answers RFC_GET_FUNCTION_INTERFACE and
carries typed parameters, and its DefaultDispatcher already has a working
STFC_CONNECTION handler, which is exactly "call a function module over RFC and
get a typed answer". What is hardcoded to the one ADT function becomes generic.

What already exists, and is why this is a track and not a project:
 - OSD transpiles and runs function modules today (FUNCTION z_osd_test_status_text
   in src/zosd_test/, a FUNCTION-POOL that runs).
 - the fugr importer already reads a module's signature from a *.fugr.xml
   (zcl_stg_segw_fugr, tools/segw-gen-mapping.mjs, ZSTG_FM_PARAM).
 - the bridge has both metadata halves (RFC_GET_FUNCTION_INTERFACE / DDIF /
   RFC_GET_STRUCTURE_DEFINITION answered) and the codecs that encode arbitrary
   typed values (internal/xrfc, internal/classicrfc, internal/structure).

**Correction, 2026-09-19.** This paragraph used to end "all currently driven
by one hand-built graph (ADTRestGraph)". **There is no `ADTRestGraph` in the
bridge** — fable-osd read the clone (HEAD `1a0e11b`) and searched three
spellings; none of them appear in any file. What the bridge has is
`pkg/graph`, which is a **code dependency** graph: `Node{id,name,type,package}`
and `Edge{from,to,kind}` with kinds `CALLS`, `REFERENCES`, `LOADS`,
`CONTAINS_INCLUDE`, fed from the ADT API, `CROSS`/`WBCROSSGT` and `D010INC`.
It answers who references whom, not what `ZOSD_TEST_STATUS` means.

So **there is no consumer with the contract D.3 was written to match**, and
the type closure is not an `Edge` — it is a name resolved to a value, and
forcing it into `REFERENCES` would produce a graph a codec cannot read a
letter out of without a second pass. The contract the channel answers is
therefore **ours, declared**, which is the honest version of the choice: an
invented contract wears somebody else's name, and the first reader believes
there is a second party to it.

Feeding `pkg/graph` from this tree is a separate and cheap thing if it is
ever wanted — `Node{id:"DTEL:ZOSD_TEST_STATUS", type:"DTEL"}` plus an
`Edge{kind:"REFERENCES", ref_detail:"FM:..."}` — but that is an **export into
a graph**, not the channel's contract, and the two should not be mixed.

The one genuinely new piece: a **signature → metadata graph** builder. Every
handler today is fed a graph made by hand; a generic gateway builds that graph
from the module's real signature (its parameters and their DDIC types). That is
the meat of the track; everything else is wiring what exists.

```
D.1  A generic "call this module" endpoint in OSD             DONE 2026-09-17
     ├─ ICF service ZOSD_RFC at /sap/bc/osd/rfc/: GET /functions,
     │  GET /functions/<NAME>, POST /call/<NAME> {IMPORTING, CHANGING,
     │  TABLES} -> {EXPORTING, CHANGING, TABLES} or {EXCEPTION}, all JSON
     ├─ tools/osd-fm-registry.mjs reads the *.fugr.xml the way
     │  segw-registry.mjs reads *.iwsv.xml, and writes gen/rfc/: the
     │  registry (TFDIR/ENLFDIR of this tree, with the signature) and the
     │  typed dispatcher — generated because the transpiler resolves a CALL
     │  FUNCTION's parameter list at transpile time and has no
     │  PARAMETER-TABLE
     ├─ the gate: no REMOTE_CALL = 'R', no call, twice over — the channel
     │  refuses with 403 and the dispatcher has no method for it
     ├─ an exception is a field of a 200, not an HTTP error: the call
     │  reached the module and the conversation is intact, which is what an
     │  RFC client is told; only a system failure is a broken call
     ├─ src/rfc/ (channel + if_http_extension + the SICF node),
     │  test/osd-rfc.mjs, test/unit/zcl_osd_rfc_test, docs/rfc-channel.md
     └─ NOT in it: the RFC wire, the SOAP envelope, authentication, and
        calling out through the same channel

D.2  Which modules are exposed, and finding them             half done 09-17
     ├─ DONE: the registry is derived from the *.fugr.xml of the content
     │  folders, and GET /functions is the catalogue — every module with its
     │  group, its remote flag, whether the tree implements it, whether it is
     │  exposed, and the reason when it is not
     ├─ open: RFC_FUNCTION_SEARCH answered from it (a name mask -> the
     │  matches), so SE37's remote test, an SDK, or another system's CALL
     │  FUNCTION … DESTINATION can discover them
     └─ open: mode c) Alice named: a switch that drops the remote-enabled
        gate and exposes ANY transpiled module — a regeneration with a flag,
        since the dispatcher is generated from the same list

D.3  The signature -> metadata graph builder          [R]  half DONE 09-19
     ├─ **done**: `tools/osd-type-graph.mjs` resolves a DDIC type name to
     │  what it is, and `/sap/bc/osd/rfc/functions/<NAME>` carries the
     │  closure as `TYPES`. The chain is DTEL -> DOMA (the element usually
     │  carries no DATATYPE at all: it names a domain) and TABL/TTYP ->
     │  components, walked. A type the tree does not hold is `UNRESOLVED` by
     │  name rather than defaulted to CHAR, which is what a caller would
     │  then encode with
     ├─ generated into `gen/rfc/` rather than resolved at run time, for the
     │  reason everything there is: the dictionary is files and the runtime
     │  has no files
     ├─ **left**: the codecs, which are the bridge's half (D.4)
     ├─ feeds the generic metadata handlers (RFC_GET_FUNCTION_INTERFACE, DDIF,
     │  RFC_GET_STRUCTURE_DEFINITION) so they answer for ANY module
     └─ and feeds the codecs, so import params decode and exports encode

D.4  The bridge becomes a generic RFC server                            [R]
     ├─ one handler for any unknown FM name: look up the signature (D.3),
     │  decode the imports, call OSD (D.1), encode the exports
     ├─ STFC_CONNECTION and RFC_PING already work; this generalises them
     └─ result: `rfc call <ANY_FM>` through the bridge reaches a transpiled
        module. A4.b's "rfc call needs the recursive codec" is the same client
        gap and is shared

D.5  mode b) the SOAP-RFC facade — likely the easiest first win        [S]
     ├─ /sap/bc/soap/rfc: a SOAP envelope naming the module and its params ->
     │  the result, HTTP-only, no RFC transport and no bridge in the path
     ├─ reuses D.1 directly; provable with curl; the classic way any
     │  RFC-enabled module is also a web service
     └─ a good place to START the track: it exercises D.1 + D.3 without the
        RFC framing, so the marshalling is proven before the transport is

Smallest first win: taken, 2026-09-17. D.1 is done over z_osd_test_status_text
and a second demo module written for it (z_osd_test_item_list: an optional
import, a scalar export, a TABLES parameter and a classic exception), reachable
by curl. D.3/D.4 put it on RFC, where `rfc call` and SE37 reach it. The three
modes Alice named map to: a) = D.4 (full RFC gate), b) = D.5 (SOAP-RFC),
c) = the switch in D.2.

What D.1 measured, and what the two faces still need: both need DDIC *types*
rather than type names — internal length, decimals, output length, the line
type of a table type as a structure — which is what D.3 builds and neither the
registry nor JSON needs. Both also need authentication (S_RFC per function
group) and a third state between success and exception, namely SYSTEM_FAILURE.
docs/rfc-channel.md has that list in full.

Recommendation: D.3 next, then D.5 on top of it. D.5 needs no transport work
at all and would then be a second envelope in front of a proven core.
```

---
