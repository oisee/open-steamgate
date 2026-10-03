# B2a: source read and bare object documents

B2a moves 22 GET rows (and their HEAD fallback) to ABAP: source/main,
includes/:include, and includes/:include/source/main for all six SOURCES
collections; bare CLAS, PROG, INTF and DDLS documents. The router generates
rows in the Node collection-loop order, before the HOST catch-all. Only the
B2a block was removed from the existing coverage allow-list.

Already present on base `0537100413cb2f6f6d5edc68dc6f4dadb55514a4`:
ENTITY SEND/TAG/NORMALIZED, URI ENCODE_COMPONENT, READ's name/changedBy/empty
JSON, OBJECT's package/changedAt/changedBy/version/includes JSON and its
extended HOST wrapper, request-uri, and the X-OSD-Miss flag and front wiring.
The typed HOST READ wrapper was absent and is added here. The existing miss
recorder is extended to retain the object exception message; resource misses
keep their existing detail behavior. No STORE command,
FM parameter, host destination or Go binding is added.

Empty source entities use Express send on HEAD to retain Content-Length: 0
and wildcard freshness. A direct Node diff first failed with
`content-length: null` versus `content-length: "0"`; the added empty-include
GET/HEAD case now checks the initial response, the exact tag, and wildcard 304.

SOURCE reads through the bound STORE. Include keys and Accept values retain
Node's case sensitivity. Include XML uses the canonical store name and the
encoded request name. Object misses use the existing object-miss flag.
OBJECT preserves host include order and existing empty include files. Property
documents retain Node's literal 1970 timestamp and active version. The report
line scan uses the shared JavaScript whitespace trim, including BOM and NBSP;
the DDLS word tokenizer uses ASCII word boundaries and whitespace separators,
without FIND REGEX.

ENTITY now avoids duplicate charsets, normalizes string-response MIME casing
on 200, and retains the caller's original type on an explicit 304. B2a passes
an explicit charset for text and a bare XML type. The DDIC caller is adjusted
to pass its explicit charset, preserving that route's different 304 contract.
The existing diff and front tests now expect B2a's source GET to be ABAP;
the front test releases its lock in finally so a failed assertion cannot
contaminate later session cases. The existing stop/recycle test waits for the
in-flight request to finish its context cleanup before asserting an empty map;
its assertion remains mandatory.

Go parity is deferred: osgo does not mount ADT. Its STORE supports READ but
lacks OBJECT and the extended B2a contract. B2a guards OBJECT/READ with HOST
REQUIRE and refuses an older host with 501 before interpreting its metadata.
No Go implementation is changed.

The fixture contains Cyrillic, a non-BMP character, NUL, CRLF, a UTF-8 BOM,
and no final newline. Node and ABAP share one ObjectStore. The second facade
uses a different tree to detect an unbound READ. One-runtime mode uses the
actual ServingRuntime child, with per-facade stores carried through IPC.
The harness strips a trailing empty query marker from both served-by strings
for Node 22. The PUT/GET conditional case writes through live Node, then
checks the PUT ETag through ABAP, and compares the inactive class document.

## Red proofs

Each mutant was temporary, in memory, and restored by the test's after hook.
The following are the actual failing output lines from separate runs:

| Mutant | Failing output line | Failures |
| --- | --- | ---: |
| Remove 200 charset | `1) bare row oo/classes GET/HEAD and URL variants` | 1 |
| Append 304 charset | `1) conditional class exact` | 1 |
| Quote the ETag | `1) row oo/classes/source/main GET/HEAD, upper-case collection and trailing slash` | 1 |
| Use the store's upper-case name in 404 | `1) missing oo/classes preserves request case and miss record` | 1 |
| Lower-case the include key | `1) class include Definitions` | 2 |
| Omit existing empty include files | `1) class includes are existing files, including an empty testclasses file` | 1 |
| Apply inactive state to properties | `1) PROG report scan zreport, inactive properties stay 1970/active` | 2 |
| Ignore BOM/NBSP in the report scan | `1) PROG report scan zbom, inactive properties stay 1970/active` | 2 |
| READ through the destination's unbound tree | `1) READ binds each facade's store` | 1 |
| Mark every moved row HOST | `1) row oo/classes/source/main GET/HEAD, upper-case collection and trailing slash` through `22) bare row ddic/ddl/sources GET/HEAD and URL variants` | 22 |

B2b objectstructure, its INCL/SRVD bare aliases, PARSE OUTLINE, and its three
structure red proofs are excluded, as requested. Writes and activation remain
host orchestration under variant C.

## Validation

All commands ran through `OSD_HEAVY_RANGE=90-99 tools/osd-heavy.sh`.
The complete 38-file ADT fragment ran in manifest order in one Mocha process:
1,803 passing in default mode and 1,803 passing with
`OSD_ADT_ONE_RUNTIME=1`. This includes the new B2a cases, coverage, diff,
editor, devloop, facade, preview, and ABAP-FS checks. The final one-runtime
run ran on its own, with the original assertions and timeouts.

XML well-formedness and STORE destination checks passed together: 27 tests
in each runtime mode. B2a's ABAP Unit invocation passed 27 methods across
SOURCE, OBJECT, ENTITY, HOST, and ROUTER, including four methods in the new
classes. The JavaScript backend compatibility run of editor, devloop,
facade, and offline ABAP-FS checks passed 231 tests. Lint passed in both
modes, with no new method_length or complexity warnings in the changed
classes; the new ABAP is 7-bit ASCII.

The live ABAP-FS conformance probe returned 30 PASS, 1 FAIL, 16 MISSING of
47, exactly matching the isolated base at
`0537100413cb2f6f6d5edc68dc6f4dadb55514a4`. The existing debugger
coreDiscovery parse failure remains. Coverage reports 76 ABAP rows,
65 pending host rows, and one host row by design out of 142.
