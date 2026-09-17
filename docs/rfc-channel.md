# The RFC channel: calling any function module of this tree

*Backlog D.1. The first stone of the RFC gateway track: one light channel
that can call any remote-enabled function module of this tree, over plain
HTTP and JSON. The RFC face (D.4) and the SOAP face (D.5) are two envelopes
around this, and neither is in this step.*

Built and measured 2026-09-17.

---

## Why a channel before a protocol

This project can already call *out*: `tools/rfc-live.mjs` reaches a real
system, `tools/rfc-replay.mjs` plays a recorded call back from a capture, and
`.local/rfc-destinations.json` decides per destination which of local /
replay / live / record / fallback applies. And the vsp bridge already acts as
an RFC *server* — for exactly one function module, the one Eclipse uses to
tunnel ADT over RFC (`docs/adt-over-rfc.md`).

What did not exist is the general case: nothing could call an arbitrary module
of ours from outside. That is three problems, and only the third of them is
about a wire protocol:

1. which modules exist, and which may be called from outside;
2. what a named module's parameters are, so a client can build a call;
3. the call itself, and what an exception is.

The channel answers all three over HTTP and JSON, where a failure is a `curl`
and a diff. When the marshalling is proven there, the RFC framing and the SOAP
envelope are transport work on a known-good core, which is exactly the order
backlog D recommends.

## The shape of it

One ICF service, `ZOSD_RFC` at `/sap/bc/osd/rfc/` (`src/rfc/zosd_rfc.sicf.xml`),
four routes:

| route | answers |
| --- | --- |
| `GET /` | what this channel is, how many modules are declared and how many exposed |
| `GET /functions` | every function module this tree declares, with its group, its remote flag, whether this tree implements it, whether it is exposed, and if not, why not |
| `GET /functions/<NAME>` | its interface: parameters by kind with their DDIC types, exceptions last |
| `POST /call/<NAME>` | call it |

A call names its parameters by class, the way ABAP does. The request is what
goes in, the answer is what comes out:

```
$ curl -s -X POST http://localhost:3030/sap/bc/osd/rfc/call/Z_OSD_TEST_ITEM_LIST \
       -d '{"IMPORTING":{"IV_STATUS":"N"}}'
{"FUNCTION":"Z_OSD_TEST_ITEM_LIST",
 "EXPORTING":{"EV_COUNT":2},
 "TABLES":{"ET_ITEM":[{"ITEM_ID":"I0001","NAME":"Bearing, 6203-2RS","STATUS":"N","QUANTITY":12},
                      {"ITEM_ID":"I0005","NAME":"Washer, nylon","STATUS":"N","QUANTITY":250}]}}
```

`IMPORTING`, `CHANGING` and `TABLES` go in; `EXPORTING`, `CHANGING` and
`TABLES` come back. Parameter names are upper case, as an RFC client writes
them, and are matched case-insensitively on the way in. An `abap_bool` travels
as a JSON boolean and an integer as a number, because the marshalling is
`/ui2/cl_json` over the real, typed parameters rather than a string table.

## Where it lives

| file | what it is |
| --- | --- |
| `tools/osd-fm-registry.mjs` | the generator: `*.fugr.xml` in the content folders → `gen/rfc/` |
| `gen/rfc/zcl_osd_fm_registry` | what a system keeps in TFDIR/ENLFDIR: every module, its group, its remote flag, whether this tree implements it, whether it is exposed and why not, and the signature |
| `gen/rfc/zcl_osd_fm_call` | one private method per **exposed** module: the parameters declared with their real types, the request JSON deserialized into them, `CALL FUNCTION`, the outputs serialized back |
| `src/rfc/zcl_osd_rfc_channel` | the routes, the gate, the status codes, the envelopes |
| `src/rfc/zcl_osd_rfc_http` | `if_http_extension`, and nothing else |
| `src/rfc/zosd_rfc.sicf.xml` | the service node that says which class answers on which URL |
| `test/osd-rfc.mjs` | the generator's unit tests, and the channel over a real listener |
| `test/unit/zcl_osd_rfc_test` | the registry and the channel in ABAP, without a listener |

The generator follows `tools/segw-registry.mjs` (`*.iwsv.xml` → the service
registry) and `tools/segw-shlp.mjs` (`*.shlp.xml` → the value-help registry):
the object in the tree is the source of truth and the ABAP class is derived,
so a cloned repository exposes its own modules and nobody registers anything
by hand. It runs inside `npm run transpile` (`tools/osd-build.mjs`), and
`npm run osd:fm -- --list` prints what a tree would expose without writing
anything.

Everything at and above the route is ABAP on purpose. The request path of this
project is ABAP end to end so that the same classes run in a system's ICF
(`CLAUDE.md`, "Wire layer — dropped on purpose"), and a gateway that only
worked on Node would be a gateway this project cannot deploy. The Node side of
this work is a code generator, which is the one thing transpiled ABAP cannot
be.

## Why the call is generated and not reflected

A real system builds the call at runtime: `CALL FUNCTION name PARAMETER-TABLE
ptab`. The transpiler cannot. `packages/transpiler/src/statements/
call_function.ts` resolves a `CALL FUNCTION`'s parameter list at transpile
time into a literal JavaScript object, and `PARAMETER-TABLE` appears nowhere in
it. A dynamic *name* works (`abap.FunctionModules[name]`); a dynamic
*parameter list* does not.

So the generic call is generated rather than reflected: `gen/rfc/
zcl_osd_fm_call` is a `CASE` over the module name with one statically typed
method per module behind it. This is not a workaround for a missing feature so
much as the same thing SEGW does when it maps an entity set to an RFC — it
writes the typed call into the generated DPC. It also means the typing is
real: a `TABLES` parameter is declared `STANDARD TABLE OF <its line type>`,
and a wrong value fails in ABAP rather than in a marshaller.

## What it refuses, and why

| situation | answer |
| --- | --- |
| no module of that name | `404 FU_NOT_FOUND` |
| the module is not remote-enabled | `403 FUNCTION_NOT_REMOTE_ENABLED` |
| remote-enabled, but this tree cannot carry it | `501 FUNCTION_NOT_CALLABLE_HERE`, with the reason |
| `GET /call/<NAME>` | `405`, a call is a POST |
| `POST /functions` | `405`, metadata is read |
| any other path | `404 NO_SUCH_ROUTE` |

**The remote-enabled gate is the important one.** A function module without
`<REMOTE_CALL>R</REMOTE_CALL>` in its function group is refused, and that is
not security theatre: it is the contract a real system enforces, and behaving
like one is the whole value of this project. It is enforced twice, in two
places that cannot drift apart, because both are derived from the same XML:
the channel refuses the call with a reason worth reading, and the generated
dispatcher has no method for that module at all. The door is not locked; it
was never built. `Z_OSD_TEST_LOCAL_ONLY` exists in `src/zosd_test/` for no
other purpose than to be refused, and both halves of the refusal are asserted.

Two refusals that are about this tree rather than about the caller:

- **declared but not implemented.** A function group may list a module whose
  body is not in the tree (the SEGW generator fixtures are exactly that). It
  is in the catalogue, marked not exposed, with that as its reason.
- **nothing to marshal it as.** A parameter with no `TYP`, `DBFIELD` or
  `DBSTRUCT` is generically typed, and a channel that guessed a type for it
  would be inventing the contract. `DOCU_GET` in open-abap-core is one.

The catalogue lists every module, exposed or not, each carrying the reason it
is not. A refusal nobody can see is a refusal nobody can debug, and this
channel is a development door: there is no authentication in front of it yet
(see below), so nothing it says is a secret it was keeping.

## An exception is not an HTTP error

Decided here, because the two faces to come inherit it.

```
$ curl -s -X POST .../call/Z_OSD_TEST_ITEM_LIST -d '{"IMPORTING":{"IV_STATUS":"Q"}}'
{"FUNCTION":"Z_OSD_TEST_ITEM_LIST","EXCEPTION":"UNKNOWN_STATUS"}   # HTTP 200
```

A classic exception comes back as a field of a **200** answer, with no
outputs. The reason is what a real RFC client is told. `CALL FUNCTION ...
EXCEPTIONS` returns through `sy-subrc`: the call reached the module, the
module ran, the module declined, and the conversation is intact. An RFC client
distinguishes that from `SYSTEM_FAILURE` and `COMMUNICATION_FAILURE`, which
are the transport and the short dump — those are what an HTTP error code is
for. Mapping an application exception onto a 4xx would tell a client its
request was malformed when it was not, and would make a retry look sensible
when it is not.

A module that raised returns no outputs, the way a raising module does; the
answer carries the exception name and nothing else. `OTHERS` is reported
verbatim as `OTHERS`, so a caller can tell "the module raised something I was
not told about" from "the module raised the thing I expected".

## What is deliberately not in this step

Named so that the next session does not go looking for them:

- **the RFC wire protocol.** No NI/CPIC framing, no gateway record, no
  `RFC_GET_FUNCTION_INTERFACE` over RFC. That is D.3/D.4 and it belongs in
  the bridge, which already speaks the transport.
- **the SOAP envelope.** No `/sap/bc/soap/rfc`, no WSDL. That is D.5.
- **authentication.** The channel accepts anyone who can reach the port.
  There is no logon, no CSRF token, no authority check, and the remote-enabled
  gate is a fidelity rule and not a security boundary. Do not put this on a
  public address.
- **calling out through the same channel.** `DESTINATION` still belongs to
  `tools/rfc-live.mjs` and `tools/rfc-replay.mjs`. The channel is a door
  inward only.
- **`$` and update-task modules, and generically typed parameters.** An
  update-task module is refused as not synchronously callable; a generically
  typed parameter is refused for want of a type.
- **an optional parameter's `DEFAULT` is honoured only when it is a literal.**
  A deserialize cannot tell "absent" from "initial", so the generator writes
  the module's `DEFAULT` into the structure before deserializing — but only
  when it is a literal, a number, or one of `SPACE` / `ABAP_TRUE` /
  `ABAP_FALSE`. Anything else is left at the type's initial value rather than
  guessed at, and the registry still reports the declared default in
  `DEF_VAL`.

## The next three steps

1. **D.3 — the signature → metadata graph.** The registry now answers a
   module's parameters with their DDIC type *names*. The bridge's codecs need
   the types themselves: field lists, lengths, decimals, the nested
   `LINES_DESCR` of a table type. That is `DDIF_FIELDINFO_GET` territory, and
   it is what turns `RFC_GET_FUNCTION_INTERFACE` from a hand-built graph
   (ADTRestGraph) into one built from a real signature.
2. **D.5 — the SOAP face.** `/sap/bc/soap/rfc` is a second ICF node and a
   second envelope in front of the same `zcl_osd_fm_call`: an XML request
   naming the module and its parameters, an XML answer, an application
   exception as a named element and a system failure as a SOAP Fault. It needs
   the field-level types from D.3 to write an element per component, and it
   needs no transport work at all, which is why backlog D calls it the easiest
   win.
3. **D.4 — the generic RFC server.** One handler in the bridge for any unknown
   function module name: look the signature up, decode the imports, call this
   channel, encode the exports. `STFC_CONNECTION` and `RFC_PING` already work
   there; this generalises them.

## What the two faces will each need that this does not have

Honestly: both need **types, not type names**. This channel gets away with
names because JSON is self-describing and `/ui2/cl_json` reads the type off
the ABAP structure at runtime. Neither of the faces can.

- The **RFC face** must answer `RFC_GET_FUNCTION_INTERFACE` with 402-byte
  `PARAMS` rows and `DDIF_FIELDINFO_GET` with a 416-byte `X030L_WA` header,
  1350-byte `DFIES` rows and a nested `LINES_DESCR` — before the client will
  call anything (`docs/adt-over-rfc.md`, "The bootstrap nobody mentions").
  Every one of those fields is a DDIC fact the registry does not carry today:
  internal type, internal length, output length, decimals, the line type of a
  table type as a structure rather than as a name. It also needs the
  parameters' **offsets in the classic RFC layout**, which is a property of
  the structure and not of the interface, and it needs a `PARAMETER-TABLE`
  equivalent on the *decode* side — which we have, in the shape of a generated
  method per module, but only for modules that were in the tree at build time.
- The **SOAP face** needs less, but not nothing: an element per component
  means walking the structure, so the same DDIC walk; a WSDL means the same
  facts again as XSD; and it needs a decision this channel did not have to
  make, namely what a `TABLES` parameter is called in a document where
  `IMPORTING` and `TABLES` are one parameter list.
- Both need **authentication and an authority check**, because both are
  addressed by clients that assume a system on the other end. `S_RFC` is the
  object a real system checks, per function group, and nothing here checks
  anything.
- Both need a **third state between success and exception**: a system failure.
  This channel raises nothing and would let a short dump reach the ICF shell.
  An RFC client expects `SYSTEM_FAILURE` with a message, and a SOAP client
  expects a Fault; the channel should grow a `TRY ... CATCH cx_root` and a
  500 with that shape before either face is built on it.

## See also

- [`docs/backlog.md`](backlog.md) track D — the rest of the track
- [`docs/adt-over-rfc.md`](adt-over-rfc.md) — the RFC transport the bridge speaks
- [`docs/segw-mapping.md`](segw-mapping.md) — how SEGW writes a typed call into a generated DPC
- [`docs/rfc-destinations.example.json`](rfc-destinations.example.json) — calling *out*, which is the other direction
