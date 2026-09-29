# ABAP ZIP/XML converter spike, after background jobs

## Outcome

Write a small converter in ABAP, run it inside OSG and compare a deterministic
output with an independently checked fixture. Keep the conversion core separate
from input transport: it receives bytes plus a source label, reads ZIP members
and XML, validates the expected structure, and emits a documented target
format. A private DJ-50 input may be used for local acceptance, but CI and the
repository use a synthetic fixture with the same relevant shapes.

## Three input adapters

1. **Server file:** an explicit path available to the OSG server process,
   including a mounted private directory when configured. The current
   transpiler rejects `OPEN`/`READ`/`CLOSE DATASET`, so implement a narrow OSG
   host port that returns bytes or add and verify those statements. Require an
   explicit allowed root and reject paths outside it, including symlink escapes.
2. **Client file:** a user selects a local file in the VS Code extension or
   browser and uploads its bytes to the running OSG instance. Present this to
   ABAP through `CL_GUI_FRONTEND_SERVICES=>FILE_OPEN_DIALOG` and `GUI_UPLOAD`.
   A dedicated host port may implement those methods underneath, but the
   acceptance test must call the ABAP methods, select and upload binary bytes,
   and exercise cancel. Do not silently choose a server file. The currently
   bundled `open-abap-gui` methods are stubs that cancel/clear data, so this
   path needs implementation and byte-preserving tests.
3. **HTTP download:** an explicit HTTPS URL supplies bytes to the same core.
   Probe the existing `CL_HTTP_CLIENT` behavior with a local fixture server
   first, then define status, redirect, timeout, size and credential handling.
   Keep credentials outside ABAP source and logs; do not fetch arbitrary URLs
   from a server without an explicit destination policy. The current client
   imports Node HTTP modules, so a browser worker would need a separate
   transport or a clearly server-only contract.

## First experiment and acceptance

- Inventory the actual OSG file, ZIP, XML and HTTP APIs with executable probes.
  `CL_ABAP_ZIP` exists. `CL_SXML_STRING_READER` currently handles JSON only;
  probe real XML with `CL_IXML` and compare against an independent parser.
  Its current parser is simplified, so existence alone proves no XML fidelity.
- Feed the same small synthetic ZIP/XML through server file, client upload
  and HTTP. Check that the byte digest and parsed records match for all three.
- Convert it with ABAP and compare the emitted target format to a golden
  fixture. Include malformed/mismatched XML tags, namespaces and encoding
  relevant to the input, missing ZIP members, corrupt archive, unsupported
  compression method, excessive expanded size or member name, empty ZIP,
  client cancel, non-2xx HTTP and path rejection cases.
- For HTTP, reject a redirect to a disallowed host, an oversized response and
  a response that never completes. Verify that size and time limits apply
  while receiving data, before the whole response is buffered.
- Measure peak memory and elapsed time on representative sizes before choosing
  whole-file `xstring` or a streaming host seam. Current `CL_ABAP_ZIP` retains
  compressed and uncompressed member bytes in its internal table, and the
  current HTTP client buffers a response, so large inputs need measured limits.
- Run a private local acceptance with the intended input only after the public
  fixture path works. Log counts, timings and digests, never content, secrets
  or full private paths. Do not publish the private fixture or output.

OSG currently uses the abaplint ABAP-to-JavaScript transpiler and runs that
JavaScript under Node/Bun or in a browser worker. Compiling the same ABAP
directly to Go is not an existing OSG path and is outside this spike.
