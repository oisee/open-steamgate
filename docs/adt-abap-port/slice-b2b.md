# B2b: objectstructure

Eight GET registrations now use ZCL_OSD_ADT_STRUCTURE: objectstructure
for CLAS, INTF, PROG, DDLS, SRVD and INCL, plus the bare INCL/SRVD aliases.
HEAD, collection case and trailing slashes follow the existing matcher.
B2a's source and property routes remain outside this slice.

No STORE command is added. PARSE gains OUTLINE, calling the same exported
structureOf as Node. Its recursive children retain parser order; extra and
links are arrays. ABAP renders attributes and links in that order, adds
Block/Identifier twins, preserves the empty-children line and escapes the
raw request URI including its query. It sends no ETag and leaves freshness
to the Express front. Missing names retain request case and record an object
miss. DDLS entity aliases do not resolve here.

Variant C mutations remain on the host. Successful source writes (including
class include creation) and activation prime store.registry() before the
response. store.warm() is compiler state, not the outline registry. A failed
prime is logged without turning a completed write into a failed write; the
next outline retries the parse. The cold parse therefore stays outside the
ABAP step on the ordinary host save/activate path.

Go's objstore has no PARSE dispatcher and already refuses PARSE with
NOT_SUPPORTED. No Go code or new binding is needed; the ABAP route requires
PARSE before requesting an outline. osgo does not mount ADT.

The B2b test mounts the live Node and ABAP facades over one parser-backed
store, and checks response bytes, headers, ABAP provenance, misses, freshness,
refusals, registry priming and cold/warm latency. Timings use the small fixture
tree and are observations, not production throughput assertions.

Temporary renderer mutants were restored after each run: sorted extras
failed 6 cases, missing Identifier twins 14, dropped query in xml:base 32,
and wrong indentation 24. The dropped-query mutant fails GET/HEAD on every
one of the eight moved registrations. The tests compare the live Node body,
not a second copy of the outline algorithm.

Live ABAP-FS conformance against the base's checked-in matrix: 30 PASS,
1 FAIL, 16 MISSING out of 47 (38.2 seconds); no regressions or improvements.
Repository hashes and system cleanup were verified. The existing debugger
core-discovery parse failure remains outside B2b.

A fixture-tree observation from the manifest run (milliseconds): Node cold
5.82, warm 1.12; ABAP cold 12.89, warm 9.69. The test writes the same source
before each side's cold request and verifies all four bodies are identical.
On the full repository, host priming exceeds the old two-second default in
two development-loop save tests; those two retain all assertions with a
30-second limit (observed saves: 6.55 and 6.30 seconds). This moves parse
latency to the host save rather than the next ABAP outline step; it does not make whole-tree parsing cheaper.
With OSD_ADT_ONE_RUNTIME=1, the fixture observation was Node cold 5.98 /
warm 1.20 ms and ABAP cold 14.11 / warm 9.47 ms, again byte-identical.

Validation: the entire ADT fragment ran in manifest order in one Mocha
invocation per mode: 1,764 passing with the switch unset and 1,764 with
OSD_ADT_ONE_RUNTIME=1. B2b contributes 57 checks, including two focused ABAP
Unit methods. The fragment includes coverage, editor, development-loop,
facade, ABAP-FS expectation checks and F3. ASCII/7.02 lint passes with the
base's 75 warnings and none in the new class; suite registration has no drift.
XML metadata and STORE destination checks: 27 passing in each mode.
