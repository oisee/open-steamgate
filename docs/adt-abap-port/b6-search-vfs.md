# B6: quick search and virtual folders

B6 is stacked on B5. Two router rows now answer ABAP: GET (and implicit
HEAD) `repository/informationsystem/search`, and POST
`repository/informationsystem/virtualfolders/contents`. The virtualfolders
facets registration remains B1's slice; Node has no GET virtualfolders
registration, only links pointing there.

STORE PACKAGES and SEARCH are separate commands, advertised in COMMANDS,
not the screen-button CAPABILITIES. Both use IV_JSON/EV_JSON and the bound
store. Neither puts identifiers in ET_OBJECT.

- PACKAGES input `{objects: true|false}` (omitted means false), output an
  array of `{name,parent?,description?,library,subpackages}` in the host's
  order, with raw `store.package(name).objects` when requested. No local
  package/user view is applied.
- SEARCH input `{seed,type,limit}`. An empty type means unrestricted.
  `limit` is a Number-compatible string; null means NaN/unbounded. Output
  is `store.search(seed,{type,max})` in index insertion order, including
  full names and library flags.

Search selection and XML rendering are ABAP. It retains Node's package-first
arithmetic, including the second slice for a negative package limit, NaN's
empty package slice and unbounded object scan, fractional cutoffs, Infinity,
and the seed limit of four times the remaining maximum. Ajson arrays are parsed with `iv_keep_item_order = abap_true` and traversed
through the shared `ZCL_OSD_ADT_JSON=>ORDERED_MEMBERS` helper. Its array-index
key preserves numeric position without a caller-specific traversal.

VFS uses the S0b SYSTEM raw channel. SYSTEM VFS takes the request XML in
IV_NAME and returns the finished document untouched in EV_SOURCE. The live
Node route and the bound SYSTEM answer call the extracted
`tools/adt-vfs.mjs` renderer. The ABAP route owns dispatch, refusal, lenient
UTF-8 decoding and response metadata. The raw-channel guard fails if the
full tree or finished XML enters ajson. Host throws produce the same 500 as
the Node route; the hang fix already exists in the stacked base.

## Measurement

On this clone, Node 26, 20 warm samples after one warm-up:

| Work | Median |
|---|---:|
| Ajson parse, PACKAGES with objects | 325.21 ms |
| Node search wire request | 4.74 ms |
| ABAP search wire request | 167.83 ms |
| Node VFS wire request | 100.20 ms |
| ABAP VFS wire request, SYSTEM raw | 102.49 ms |

The parse payload held 159 packages and 1,936 objects (201,927 UTF-8 bytes).
Nineteen parses alone would cost about 6,179 ms per cloud tree build. This
exceeds the 5 ms VFS threshold, so VFS's filtering and finished document
remain in the shared host renderer rather than porting them through ajson.
Search's smaller two-envelope path remains ABAP, and its measured latency
is recorded above; no performance improvement is claimed for search.
Reproduce with `OSD_HEAVY_RANGE=80-89 tools/osd-heavy.sh
node_modules/.bin/mocha test/adt-abap-b6-cost.mjs`.

## Verification and scope

The B6 real-front matrix mounts live Node and ABAP over one store and checks
status, normalized content type, byte length, ETag, Location, cookies and
body, plus the ABAP served-by verdict. It covers maxResults (including
NaN), seed oversampling, library DEVC index hits, host order, all facet
orders, repeated Map selections, raw XML values, patterns and fault replies.
New envelopes are also checked with two concurrent bound stores and long
identifiers. Both B6 rows were removed from HOST_ALLOWED.

`OSD_ADT_RED=search|vfs` adds one newline at each ABAP document boundary;
`seed` changes only the ABAP STORE SEARCH seed limit from max*4 to max;
`nan` changes its null/unbounded limit to zero. Each mutant must fail its
focused diff case. They are test-only environment switches.

OSGo parity is out of scope: it does not mount ADT or implement these
commands. Both routes call HOST REQUIRE for their required commands and
refuse with 501 if unavailable. No Go implementation or binding change was
needed. Non-ASCII repository case conversion remains outside this slice,
as in the family specification. Only the requested target suites ran;
ABAP-FS conformance and the full suite were not run under the slice's
explicit test restriction.

Final target run: 697 passing (632 B6 route/envelope tests and 65 existing
ADT diff/coverage/XML/store-destination checks), plus two measurement tests
and three B6 ABAP Unit methods. All four focused mutants exited 1 with
exactly one failing diff. `npm run lint` passed with no issues in the new
classes; existing repository warnings remain. New class XML carries
WITH_UNIT_TESTS and was staged before the strict XML test ran.

## Ordering regression follow-up

The rebased `ce670a3f` already used numeric positions for search and the raw
shared renderer for VFS; its two new 12-item live Node byte comparisons pass
before the helper change. Both search array traversals now use the main-branch
ordered-member helper. VFS has no array MEMBERS call.

`OSD_ADT_RED=search-order|vfs-order` permutes XML rows at the ABAP document
boundary in string-index order (`1,10,11,12,2,...`). Before the helper change,
each focused 12-item test failed with exactly one byte-comparison failure.
These are mutation red proofs, not a claim that `ce670a3f` reproduced the bug.

Follow-up verification: 763 passing (634 B6 route/envelope cases, two B6
measurement cases, 91 ADT diff, 11 coverage, five XML, 20 store-destination),
plus three ABAP Unit methods (two search, one VFS). All runs used
`OSD_HEAVY_RANGE=80-89 tools/osd-heavy.sh`; no full suite ran.

Coverage gate: `ADT on ABAP: 97 of 142 registrations still on the host
(44 ABAP, 1 host by design)`. The B6 allowlist block was already absent.
Both new class XMLs have `WITH_UNIT_TESTS=X`; neither local test class
has a superclass. Go does not advertise PACKAGES/SEARCH, so both ABAP routes
refuse unsupported hosts through REQUIRE. Lint passed with 68 existing
warnings after the store-destination temporary fixture was removed.
No `osd-serve.mjs` process belonging to this clone remained after the tests.
