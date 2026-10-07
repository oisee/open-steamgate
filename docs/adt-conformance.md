# Shared ADT conformance cases

The runner uses one case list for JS, osgo and an explicitly requested reference
system. This first slice covers discovery, HEAD, identity, package browsing,
search, class documents, default/active/inactive source, includes, versions,
objectstructure and five lock/session contracts. It never writes source or
activates an object. X2 ABAP Unit and activation are later slices.

Run heavy commands one at a time, waiting for the wrapper's slot:

```sh
OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 tools/osd-heavy.sh npm run transpile
OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 tools/osd-heavy.sh node test/adt-conformance/js.mjs
OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 tools/osd-heavy.sh node tools/osd-suites.mjs --group adt-conformance-only
```

`js.mjs` starts the existing `test/start.mjs` server helper and places the
synthetic #642 outline fixture in a disposable additional source layer. It
pins the already-transpiled output so adding parser fixtures does not publish a
new live generation. It restores the layer/output settings and closes the server
on success or failure; the
private `.local/lars` is never relinked. `suite.mjs` runs the same HTTP cases
plus focused checks for the harness. The manifest registers it as required;
the group entry is a small import wrapper for selecting this fragment alone.

For an already running target:

```sh
node test/adt-conformance/run.mjs --target js --base http://127.0.0.1:8091
node test/adt-conformance/run.mjs --target osgo --base http://127.0.0.1:8091 \
  --expected test/adt-conformance/expected/osgo.json --only C1-discovery,C3-head
node test/adt-conformance/square.mjs
```

The base may include `/sap/bc/adt`. An external server must expose the repository's
`ZCL_OSD_ADT_URI` and `$STG_ADT`, plus the synthetic class/includes exported by
`test/adt-conformance/fixtures/source.mjs` in its source index for O1–O5.
Each case gets a fresh cookie jar and CSRF-fetch handshake. Cookies are updated
from every repeated Set-Cookie header. All requests have a timeout and stateful
session affinity unless a case explicitly requests stateless behavior. Additional
sessions exercise contention. Cleanup runs after assertion and setup failures;
all opened sessions log off. Transport, login and cleanup errors fail the suite.

Case modules export arrays of `{id, point, title, setup?, request, expect, after?}`.
IDs remain stable; `point` groups the parity square. Requests take `method`
(default GET), `path`, `query`, `headers`, `body` and optionally a named `session`.
A request may be a function of the per-case context for values from setup.
`setup(ctx)` and `after(ctx, response)` may call `ctx.session.request()` and
`ctx.newSession()`. Cleanup must preserve handles before making assertions.

Expectations specify `status`, optional `contentType`, `headers`, `body` (value
or RegExp), `json` (top-level facts), `xml`, `bodyBytes` and `normalize`.
XML rules are `{xpath, value}`, `{xpath, regexp}` or `{xpath, count}`; all selected
values must satisfy the rule. XPath supports `/`, `//`, qualified element names,
`*`, an attribute equality predicate, and terminal `/@attribute` or `/text()`.
Prefixes resolve through the runner's namespace map plus `expect.namespaces`;
the response's prefix spelling does not matter. Unsupported XPath is rejected.
There is no external entity resolver. Missing matches fail. Byte assertions
compare the raw Buffer and bypass normalization.

Normalization masks host, client, user, ISO timestamps, ETags, lock handles,
session and generation IDs. JSON identity keys are masked recursively. For XML,
volatile attributes and handle/ID elements are masked; `normalize.values` allows
explicit identity substitutions and `normalize.host` replaces the target origin.
Opaque identifiers keep their length. Protocol namespaces, object names and
source coordinates are retained. Assertions for handle shape use the unmasked
response so a wrong handle length cannot pass.

`expected/osgo.json` maps every ID to `pass`, `known-gap: reason` or `n/a: reason`.
Unknown IDs, missing entries and invalid values are errors. JS cannot supply a
gap file. A known gap that passes fails with “update the expected file”. An n/a
entry is reported as not-applicable without running it. The suite writes
`suite-results/adt-conformance-<target>.json`; reports retain only status,
content type, byte count and assertion messages, never payloads, cookies,
credentials, tokens or handles. Exit codes: 0 expectations satisfied, 1 failed
cases (including unexpected passes), 2 invalid invocation or harness startup.

At base main `0de1f89b`, osgo has no `-adt` flag or ADT mount. The 2026-10-07
measurement found host route 404s; stoker case #5 identifies the router trap.
The expected file records those route gaps and the missing host commands or
adapters underneath them. Do not pretend an absent mounting flag is a successful
HTTP test. Record the inventory explicitly:

```sh
node test/adt-conformance/run.mjs --target osgo \
  --unavailable 'osgo: not mountable on this main'
```

Every resulting row is a known gap with `observed: false`; the square labels it
unobserved. Once slice 1a provides `-adt`, build the osgo binary from the tested
tree using `tools/gogen/osgo.mjs`, start it with that flag and the wrapper's
`STG_PORT`, and run the same case list by URL. Promote expectations individually
with each implementation change. No osgo build is claimed for this base.

O1–O5 reuse PR #642's synthetic source and hand-entered A4H 7.58 coordinates,
attributes and links. `fixtures/bytes.mjs` deterministically serializes those
facts independently of the serving serializer. Each response is compared in
full, across media negotiation and active-version requests. These are our own
facts and synthetic code; no SAP-captured payload is tracked. The byte contracts
require #642's implementation, which is not on the starting main. The runner
does not replace that implementation or silently soften those assertions.

The square merger reads schema-1 reports from `suite-results/*.json`, chooses
the newest observation per target/case, and prints A4H / JS / osgo columns.
Unrelated suite report schemas are ignored. Conflicting results with the same
timestamp are rejected. Missing evidence remains `not-measured`; the renderer
never infers A4H pass from JS pass. No live SAP call is part of this runner's
local/CI verification. Future reference fixtures must use this same normalization
and clean-room facts rather than tracked captures.

Proposed CI job (no workflow change in this slice): keep the JS integration
fragment required after transpile. Add a separate initially advisory osgo job
which builds the current tree, starts its binary with `-adt` once available,
runs the common list with `expected/osgo.json`, uploads both result artifacts
and prints the merged square. Decide when to require this job with the owners;
unexpected improvements must continue to fail until their gap data is updated.

Verification on the starting main: transpile exits 0. JS passes all 18 read/lock
cases outside objectstructure; O1–O5 fail because #642 is not merged (three byte
mismatches and two media-negotiation mismatches). These remain required failures,
not skipped tests or JS gap expectations. The permitted file scope cannot apply
that product fix. osgo is recorded as not mountable, with all 23 cases unobserved
known gaps. The focused suite runs only this fragment; no six-shard run or
workflow edit is part of this slice.
