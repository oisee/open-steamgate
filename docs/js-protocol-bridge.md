# Built-in DIAG and RFC-to-ADT bridge in JavaScript

*Implementation branch: `feat/js-protocol-bridge`, 2026-09-21.*

## Goal

Remove the architecture-specific Go protocol sidecar from the OSD runtime.
One Node.js/Bun process should serve HTTP, HTTPS, DIAG on 32nn and the ADT RFC
bridge on 33nn. The implementation in this repository is MIT-licensed and
uses no SAP SDK, proprietary library or redistributed SAP server component.

The first RFC profile is intentionally the Eclipse/ADT subset already used by
OSD:

- `SADT_REST_RFC_ENDPOINT`;
- `RFC_GET_FUNCTION_INTERFACE`;
- `DDIF_FIELDINFO_GET`;
- `RFC_GET_STRUCTURE_DEFINITION`.

The dispatcher is a registry so later function modules can be added without
changing NI, CPIC or RFC record handling. The first merge does not claim to be
a universal SAP RFC implementation.

## Layers

```text
TCP
 └─ NI: four-byte length framing, keepalives and bounds
     ├─ DIAG: handshake, message/items, one generated tape screen
     └─ RFC: APPC/CPIC/FastRFC conversation
          └─ function registry
               └─ ADT-over-HTTP profile (four FMs)
```

NI is shared code. DIAG must not carry its own framing copy, and RFC must not
reach into DIAG. Each connection owns its decoder and state machine.

## Oracle and private captures

The existing Go programs remain test oracles while the JS implementation is
being built:

- SAP-TUI must render `Tape loading error, 0:1` from JS DIAG;
- the existing `rfc-probe` must receive the ADT build through JS 33nn;
- a stock Eclipse client is the final RFC acceptance test.

i7 contains separate DIAG, RFC and combined wire captures. They are private
research inputs: raw captures stay outside git and are never copied into test
output. A committed fixture must be a minimal structural vector generated or
scrubbed of host, address, user, client, session, cookie and credential data,
and must pass the repository leak scanner.

## Delivery slices

1. **NI groundwork:** independent MIT encoder/stream decoder, hard payload
   bound, fragmented/coalesced reads, exact keepalive recognition.
2. **DIAG tape stub:** generated structural handshake and screen; acceptance
   with existing SAP-TUI.
3. **RFC transport:** NI + conversation parsing against scrubbed vectors.
4. **ADT profile:** four registered function handlers and HTTP cookie/session
   continuity; acceptance with `rfc-probe` and Eclipse.
5. **Runtime integration:** OSD opens 32nn/33nn itself; Docker and Bun stop
   requiring the Go sidecar, while an explicit fallback remains for one
   release.
6. **JS SAP-TUI:** client parser, screen model and ANSI renderer are ported
   after the runtime no longer depends on Go.

## Acceptance rules

- A TCP listener is not protocol success: DIAG must render the expected screen
  and RFC must carry a real ADT response from the same serving generation.
- Peer-declared lengths are bounded before allocation.
- Truncated, unknown and out-of-order records fail the connection explicitly.
- Tests cover arbitrary stream fragmentation; no test assumes one frame per
  socket read.
- Protocol logs contain direction, layer and byte counts, never payload bodies
  by default.
- All new suites are registered in `test/suites.json` when created.
- amd64 and arm64 use identical JavaScript sources; no platform dispatch is
  allowed in the protocol semantics.

