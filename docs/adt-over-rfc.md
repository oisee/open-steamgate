# ADT over RFC: how Eclipse reaches a system that has no ICM

A stock Eclipse ABAP project can be configured two ways. An **ABAP Cloud
Project** opens HTTPS and talks to the ICM. A **Custom Application Server**
project does not: it logs on over RFC on the gateway port and tunnels every
ADT request inside one RFC call. That second kind never touches an HTTP port
at all — measured on a full session, 579 KB crossed the gateway and not one
byte the ICM.

open-steamgate answers the first kind directly (`docs/adt-surface.md`). This
document is the second kind: the protocol facts that let a bridge accept the
RFC conversation, unwrap the HTTP exchange inside it, and answer.

The shipping bridge is the MIT JavaScript implementation under
`tools/protocols/`. The earlier Go implementation in the sibling
[open-rfc-go](https://github.com/oisee/open-rfc-go) remains a test oracle, not
a runtime dependency. Everything below is protocol, and was measured against
a developer sandbox through a passive tap. No captures are in this repository
and none should be.

---

## The shape of it

```
Eclipse ──RFC/CPIC──▶ gateway port ──▶ bridge ──HTTP──▶ /sap/bc/adt/…
        ◀─────────────────────────────         ◀──────
```

The bridge is a gateway and an RFC server at once: it accepts the gateway
record, answers the APPC handshake, accepts a logon it does not verify, and
then serves exactly one function module.

## The function

Everything arrives as `SADT_REST_RFC_ENDPOINT`, whose interface is two
recursive parameters:

| parameter | class | type | contents |
| --- | --- | --- | --- |
| `REQUEST` | importing | `SADT_REST_REQUEST` | request line, header table, body |
| `RESPONSE` | exporting | `SADT_REST_RESPONSE` | status line, header table, body |

Both structures are the same three fields: a line, a `TIHTTPNVP` table of
name/value pairs, and an `RSTR` body. An HTTP exchange, in other words, which
is why a bridge for it needs no opinion about ADT.

## The bootstrap nobody mentions

Eclipse will not call a function it has not been described. A destination
whose metadata cache does not match the system answering — and a bridge is
always such a destination — opens with two dictionary calls before the first
ADT request:

1. `RFC_GET_FUNCTION_INTERFACE` for the function's parameters. The answer is
   a `PARAMS` table of 402-byte rows, plus `REMOTE_BASXML_SUPPORTED`.
2. `DDIF_FIELDINFO_GET`, once per structure the parameters name, for
   `SADT_REST_REQUEST`, `SADT_REST_RESPONSE` and `TIHTTPNVP`. The answer is
   `DDOBJTYPE`, an `X030L_WA` nametab header of 416 bytes, a `DFIES_TAB` of
   1350-byte rows, and a nested `LINES_DESCR` describing the table types.

Only then does `SADT_REST_RFC_ENDPOINT` get called. A workspace that already
holds the metadata skips straight to it, which is why this step is easy to
miss: the first session against a fresh project needs it and the next does
not.

**The output order is the function's parameter order, not the caller's request
order.** A `DDIF_FIELDINFO_GET` answer returns `DFIES_WA`, then the
`LINES_DESCR` recursive parameter, then `X030L_WA` — even when the caller asked
for them in another order.

## The payload is SAP Binary XML, not the text xRFC

A recursive parameter normally travels as XML between `0x3c02` boundaries in
`0x3c05` chunks. This one does not. It travels in its own tag family:

| tag | meaning |
| --- | --- |
| `0x4000` | two bytes: `01` and a flag — `00` the payload follows as it is, `01` it is a raw DEFLATE stream |
| `0x4001` | the request payload, in chunks of at most 16384 bytes |
| `0x4002` | the response payload, chunked the same way |
| `0x4004` | empty, closes the parameter |

Eclipse sends `00` and the system answers `01`. The compression is **raw
DEFLATE** (RFC 1951, no zlib or gzip framing) — readable with
`inflateRaw` / `zlib.decompress(data, -15)` / Go's `compress/flate`. An older
note in this project called it an unknown SAP format; that was wrong.

Inside is **SAP Binary XML 0.7**: a token stream with a name table and UTF-8
payloads.

| token | byte | operand |
| --- | --- | --- |
| header pair | `3f` | length+key, length+value |
| declare name | `2b` | length, name — appended to the name table |
| open element | `3c` | two bytes: name reference, namespace reference |
| close element | `3e` | — |
| attribute | `40` | two bytes; its value follows as `41` |
| attribute value | `41` | length, value |
| bind namespace | `3a` | two bytes |
| xmlns marker | `2a` | one byte |
| text | `54` | length, text |
| message body | `42` | length, content — opaque, not parsed as markup |

Two rules that cost time to find:

- **A name reference is the name's table index plus two.** Indices zero and
  one are reserved, so the first declared name is referenced as `2`.
- **A length is the byte count written as a UTF-8-encoded scalar**: one byte
  below `0x80`, two up to `0x7ff`, and four for a body of a few hundred
  kilobytes. Not a fixed-width integer.

Every document opens with the same 144-byte envelope — the magic, `VER` and
`ENC` headers, the `asx` namespace, `<asx:abap version="1.0">` and
`<asx:values>` — and the payload root is the single grandchild.

### What the documents say

A request root is `REQUEST`, with `REQUEST_LINE` (`METHOD`, `URI`, `VERSION`),
`HEADER_FIELDS` whose rows are `item` elements of `NAME` and `VALUE`, and
`MESSAGE_BODY`.

A response root is `RESPONSE`, and differs in three details worth copying
exactly:

- `STATUS_CODE` is **four characters**: the code and a trailing blank,
  `"200 "`, `"304 "`, `"404 "`.
- the header rows are named after their line type, **`IHTTPNVP`**, not `item`,
  and the first row is always `~server_protocol`, the ICF's own.
- an **empty body is an empty element**, not an empty body token.

## The record a response travels in

This is the part that refuses quietly. A response leaves in a record header the
gateway writes, and there are **two shapes, belonging to two connection roles,
not two protocols**. The connection that carries the ADT calls uses the one
below; the other role uses a variant whose length is eight less and which
appends an eight-byte trailer. Sending the wrong one gets the whole answer
refused at the CPIC receive — the client reports `CPIC-CALL: 'CMRCV'` and
aborts the conversation with an `F_0x0b`, having never looked at the content.

The header of a final `F_SAP_SEND` response, at byte offsets:

| offset | value |
| --- | --- |
| 0 | `06` protocol |
| 1 | `cb` F_SAP_SEND, or `09` F_RECEIVE on a continued record |
| 2 | `02` |
| 4..6 | the caller's uid |
| 6..8 | a gateway id (varies, not checked) |
| 12..16 | `00010000` |
| 16 | `01` |
| 17..21 | a timeout (`ffffffff` or `000001f4`, varies) |
| 21 | `02` |
| 22..26 | `00000001` |
| 26..28 | `0008` on the last record of a message, `0000` otherwise |
| 30 | `05` on the last record, `01` otherwise |
| 31 | `0c` on the last record, `08` otherwise |
| 40..48 | the conversation id |
| 48..80 | the operation-info block |

The operation-info block is `00006d60`, `00000002`, **this record's own data
length**, `00000001`, `00000000`, `00` and `"4103"` (the gateway protocol
level), then a word that varies.

The chain inside ends `… 0523 ffff 0000 ffff` and carries **no trailer**, even
though the header advertises eight bytes of final SAP parameters. That value
alone does not imply eight more bytes.

A message longer than **28000 bytes** continues: the first record is an
`F_SAP_SEND` that is not final, the rest are `F_RECEIVE`, and the last is
final. A call arriving that way must be joined before it is read.

## The response chain

```
0500                        start
0331 <first table number>   only when the call carried tables
0503                        response context
0514 <session GUID>         the one the call carried, echoed
0420 00000000               success
0512                        call context
0205 <name> …               one per output returned, in output order
0201 <name> 0203 <value> …  scalar exports
3c02 3c05 … 3c02            an xRFC export: "<NAME>" alone in the first chunk
4000 0101  4002 … 4004      a compact export: raw DEFLATE of the document
0130 <program, 40 chars>
0335 0302 0303 … 0336       each table: its number and its rows
0667 <8 bytes>
0523                        after a compact export
ffff
```

Tables may go back uncompressed as `0303` rows; the system does exactly that
for the small `PARAMS` table and compresses only larger ones (as `0305`
chunks, SAP-LZH). A client reads both.

## Telling a call from a logon, and Eclipse from SM59

Three distinctions that each cost a wrong guess:

- **A logon is not a call.** Eclipse opens the conversation and then sends its
  logon *inside* an `F_SAP_SEND`, so it arrives where calls arrive. It is told
  apart by what it **is** — a logon opens `d9 c6 c3`, "RFC" in EBCDIC — not by
  the absence of a CUT prefix, because Eclipse's calls have no CUT prefix
  either.
- **Text byte order is declared, in the chain's opening field, at index 1:**
  `02` from Eclipse (UTF-16 big-endian), `01` from the system (little-endian).
  Reading the other way does not garble a name, it produces a *different* one,
  which reaches the dispatcher as an ordinary lookup miss.
- **Eclipse-ness is a property of the conversation, not of a call.** A metadata
  call's chain opens with a `0502` field of length zero, which is byte for byte
  the classic CUT request prefix, so it cannot be told from an SM59 call by its
  bytes. Once a conversation has accepted an Eclipse logon, every call on it is
  Eclipse's.

## The session, and why the bridge owns it

Over HTTPS Eclipse runs the CSRF dance itself: it asks for a token and sends it
back. Over RFC **it does not, and cannot** — there is no HTTP session between
Eclipse and anything. It hands over a request and expects the far side to
already be somebody.

A bridge terminates HTTP and re-originates it, so the session, its cookies and
its CSRF token are the bridge's. Without that, every read succeeds and the
first write comes back `403` with `X-CSRF-Token: Required`.

What that means in practice:

- probe an ADT resource with `X-CSRF-Token: fetch`, HEAD first and GET after —
  some systems mint nothing on a HEAD;
- keep the token beside the cookie jar whose session it belongs to, one per
  conversation, because a jar shared between two clients shares an ADT context
  between them;
- send it on `POST`, `PUT`, `DELETE` and `PATCH`;
- `"Required"` arrives in the same header as a token and **is not one**;
- a `403` that is *not* a CSRF refusal is the backend's own answer and belongs
  to the caller unaltered;
- a backend that mints no token is not an error, it is a backend without CSRF
  protection — this project's own façade is one — so the request goes without
  the header.

## Identity

The logon answer says what system this is, and Eclipse is configured with a
system id before it ever connects. Answer with a different one and the project
refuses to log on. So the identity is configuration, not a property of the
backend: a bridge in front of this project's façade can call itself whatever
the project expects.

The session GUID is **sixteen bytes**, found by its `0514` tag rather than by
an offset, and echoed back in the answer. Ten bytes of it vary between clients
and six do not, because those six are the client host's own address packed into
the uuid's node field — which is also why a capture of one client is not
evidence that an offset is fixed.

## What this buys

With the above, a Custom Application Server project against this project's
façade completes the sequence a real one does: logon, `core/discovery`,
`compatibility/graph`, `discovery`, `feeds`, the object-type list,
`repository/typestructure`, `repository/nodestructure` to expand the tree, and
`ddic/ddl/sources/<name>` plus `/source/main` to open an object — every one of
them answered, plus unit-test metadata and check runs.

## See also

- [`docs/adt-surface.md`](adt-surface.md) — the HTTP surface these requests land on
- [`docs/adt-facade.md`](adt-facade.md) — what the façade answers, and the contract
- [`docs/layers-we-own.md`](layers-we-own.md) — the SAP-protocol layers the siblings carry
