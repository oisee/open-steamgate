# ADT request XML: T12 and T13

Clean-room implementation in `feat/adt-xml-namespaces`, based on main
`a79959a91f97cb4aa0e30d6c2cdbac3d53577be5`. Only repository code and public
XML/HTTP semantics were used. No SAP system or other ADT implementation was
consulted. No commit was made.

## Survey at the baseline

Line numbers in this table refer to **a79959a9**, before this change.
They identify request reads, not response writers or persisted abapGit XML.

| Request | Node baseline reader | ABAP baseline reader |
| --- | --- | --- |
| POST activation | `tools/adt-facade.mjs:2361`, `tools/adt-documents.mjs:1339`: global regex for literal `adtcore:uri="..."` | HOST route; no ABAP body reader. Node received the original body after ABAP routing. |
| POST checkruns, including inline content, include and package references | `tools/adt-facade.mjs:2250`, `tools/adt-documents.mjs:1149`, facade `:2271`: literal `chkrun:`/`adtcore:` regexes and double quotes | `src/adt/zcl_osd_adt_checkrun.clas.abap:47`, `:249`, `:325`: literal token `take` scans for checkObject/content/attributes and package URIs |
| POST source collections: classes, interfaces, programs, includes, DDL sources, service definitions; POST packages | `tools/adt-facade.mjs:1931`, `:1937`: regex attribute extractor, literal `adtcore:name`, `packageRef`, `pack:superPackage`, double quotes | HOST routes; no ABAP body reader. SRVD create already returns 501; this change preserves that capability refusal. |
| POST class includes | `tools/adt-facade.mjs:2135`, `:2140`: same literal attribute extractor for `class:includeType` | HOST route; no ABAP body reader |
| POST ABAP Unit run / evaluation | `tools/adt-facade.mjs:2532`, `:2550`: objectReferencesIn; evaluation also strips the selector with a regex; run counts reference tags with another prefix-tolerant regex | HOST routes; no ABAP body reader |
| POST transport checks | `tools/adt-facade.mjs:2184`, `tools/adt-documents.mjs:1413`: case-insensitive regex for unqualified URI/DEVCLASS/OPERATION | `src/adt/zcl_osd_adt_transport.clas.abap:31`, `:15`: case-insensitive unqualified field regex |
| POST repository nodestructure | `tools/adt-facade.mjs:2667`, `:2672`: literal unqualified TV_NODEKEY regex | `src/adt/zcl_osd_adt_tree.clas.abap:199`, `:235`: literal unqualified TV_NODEKEY string scans |
| POST virtual-folder contents | `tools/adt-facade.mjs:1028`, `tools/adt-vfs.mjs:25`: literal `vfs:` regexes for preselection/value/facet, unqualified objectSearchPattern | `src/adt/zcl_osd_adt_vfs.clas.abap:442`, `:121`, `:156`, `:169`: `zcl_osd_adt_scan` literal-prefix block/attribute/tag scans |
| POST lock/unlock on source objects and packages | `tools/adt-facade.mjs:1988`: body ignored; query `_action` and lockHandle control the operation | `src/adt/zcl_osd_adt_lock.clas.abap:72`: body ignored; host OBJECT retrieval preceded the operation |

The generic byte boundaries are
`src/adt/zcl_osd_adt_handler.clas.abap:106` (`get_data`) and
`tools/adt-abap-front.mjs:91` (buffer/string/stream forwarding). Neither
validated XML at the baseline.

Other surveyed bodies are not XML request envelopes: source PUTs are source
text (including DDIC XML stored as source), data-preview POSTs are SQL,
classrun takes no parsed XML body, core/http/unit/object/run accepts JSON
options, and JSON execution/debug endpoints parse JSON. Nodepath, debugger
listeners and other no-payload POSTs discard their bodies. Response XML and
DDIC/abapGit source readers are outside this request-envelope policy.

## Design

`tools/adt-request-xml.mjs` is the shared Node reader and route policy.
`zcl_osd_adt_request_xml` is the shared ABAP reader and route policy. All XML
request routes pass through them before dispatch or store work. Route
selection does not depend on Content-Type: ADT's `application/*` requests
still use the policy. Empty transport-check, node-key, virtual-folder and
lock/unlock bodies retain their existing meaning. Activation's missing-method and present non-activate
method behavior from #572 remains unchanged: those paths do not read XML.

The readers consume the **entire** document before returning any tokens.
Namespace scope resolves element and attribute expanded names (URI plus
local name); default namespaces apply to elements, never unprefixed
attributes. Required protocol elements reject a foreign URI. The readers
produce a private canonical token stream for the existing field extractors.
Its prefixes come only from resolved namespace URIs; client prefixes and
namespace declarations never reach those extractors. Empty elements become
explicit open/close pairs. Literal-prefix scans below the boundary therefore
operate on trusted internal tokens, not request XML. This avoids changing
response writers and preserves established byte comparisons.

Limits are **64 element levels, including the root**, and **16 MiB of original
request bytes**. Node constants `XML_DEPTH_LIMIT` and `XML_BODY_LIMIT` live
in the reader module. The raw parsers in `test/start.mjs` and
`tools/osd-serve.mjs` import the body limit and its shared error handler.
ABAP constants `c_depth_limit` and `c_body_limit` live in the reader class;
the ABAP/ICF entry also checks the original bytes. POST lock/unlock bodies
remain semantically unused, but any supplied body is validated before
OBJECT retrieval or enqueue work.

DOCTYPE is rejected before parsing. There is no external entity resolver,
network/file callback or DTD-defined entity expansion. Only XML's predefined
and numeric character references are read. Input is UTF-8; invalid UTF-8 is
refused. Namespace URIs remain case-sensitive.

The Node ABAP bridge now sends XML bodies even for HOST routes, in both
inline and serving-child execution. ABAP validates their original bytes
before handing over; the Node route then uses the Node reader. ABAP-owned
checkruns, transport, node-key and virtual-folder routes receive ABAP's
canonical tokens. Neither front can start checking/activation, compilation,
source writes, enqueue changes, Unit execution or entity retrieval on a
rejected request.

Both readers answer 400 with `application/xml; charset=utf-8`, using the
existing Node `exceptionDocument`/`refuse` and ABAP `zcx_osd_adt`/handler
refusal builders. `exc:exception` retains the communicationframework URI
used by #572. **ExceptionInvalidXML and its message are our clean-room
identifiers, not observed SAP XML-error type IDs.** The existing missing-method
400's observed bytes are unchanged.

## Substrate verification

The local open-abap-core implementations were read, not inferred from their
interfaces. `cl_ixml`'s local element/attribute namespace accessors assert
TODO (`cl_ixml.clas.locals_imp.abap:333`, `:804`); its parser does not validate
closing names (`:1342`). It is unsuitable for this request boundary.

`cl_sxml_string_reader=>create`, local reader `next_node` and `next_attribute`,
local XML parser `next`, namespace lookup/restore, attribute/value classes
and `get_value` are implemented on the path used here. Namespace declarations
are scoped, undeclared element/attribute prefixes fail, closing names are
checked, and unsupported declarations fail. Unrelated methods such as
`get_nsbindings`, current-node and writer operations still contain stubs;
this implementation does not call them. UTF-8 input conversion and UTF-16LE
(codepage 4103) output/input conversion were also inspected and exercised.

The inspected sXML classes are in
`.local/lars/open-abap-core/src/sxml/cl_sxml_string_reader.clas.abap` and its
`clas.locals_imp.abap`: the factory, `lcl_reader` (`constructor`, `next_node`,
`next_attribute`), `lcl_xml_parser` (`next`, `lookup`, `restore`, `decode`),
`lcl_attribute` (`constructor`, `get_value`), and `lcl_value_node`
(`constructor`, `get_value`). Each called method has executable code rather
than a TODO assertion. The JSON parser and stub reader/node operations are
outside the execution path.

T12 found the binary sXML quote-search defect recorded in
`ANORMALIES.md` as `ANOMALY-2026-10-04-sxml-byte-find`. After checking the
original UTF-8 bytes, the reader supplies BOM-marked UTF-16LE to select the
same parser's implemented character path. No dependency files were changed.
The depth/size/DOCTYPE policy remains in our reader, not in a host wrapper.
The second defect, `ANOMALY-2026-10-04-sxml-outside-root`, discards text outside
the document root. A private parser wrapper exposes that text to the reader,
which rejects it and multiple roots; the wrapper does not count toward the
64-level request limit.

## Acceptance evidence

The new HTTP suite is `test/adt-request-xml.mjs`, registered in
`test/suites.d/adt.json`. It covers every surveyed XML envelope and supplied
lock/unlock bodies. Five variants change every bound prefix, use a default
element namespace, change quotes, reverse attributes, or vary whitespace.
Supported creates also exercise 201 responses. SRVD creation's existing 501
is compared across variants. ABAP Unit protocol tests use a counted fixture
runner; existing Unit suites continue to cover real compilation/execution.

Every T13 case asserts both an unchanged digest and zero store-work calls.
The digest includes fixture files (source and active copies), inactive state,
held session handles, the complete enqueue table, the serving generation and
runtime epoch. A populated unrelated lock and an inactive save with an
active predecessor ensure the digest is not merely empty-state equality.
Mode 1 snapshots the actual serving child's enqueue table over a read-only
test transport. The external-entity case uses a live loopback listener and
asserts zero accepted connections. Node and ABAP responses are compared byte
for byte where deterministic.

Before production edits, the original 222 HTTP cases ran against unchanged
main a79959a9: **58 passed, 164 failed**, recorded in
`.local/t1213/red-main.log`. Examples include a renamed activation prefix or
single quotes returning 400, a DOCTYPE reaching activation and returning 200,
and the oversized body returning HTML 413. The suite was then expanded to
all create collections, successful creates, populated locks, work counters
and cross-front comparisons. The expanded focused mode-0 run passed
**422 tests** (`.local/t1213/focused-0.log`), including trailing-text rejection
on every envelope. ABAP Unit tests additionally cover
the accepted depth-64 / rejected depth-65 boundary and direct reader rejection.

Excerpt from the recorded red output:

```text
  58 passing (3s)
  164 failing

  1) T12/T13 XML requests node mode=0
       T12 activation?method=activate prefix:

      AssertionError: expected { status: 400, …(2) } to deeply equal { status: 200, …(2) }
```

The complete response diff and every failure remain in `red-main.log`.

Preparation used
`bash /home/alice/dev/osg-adt-abap/.local/codex/prep.sh "$PWD"` and
`npm run transpile`. Every transpile, Unit, mocha and lint invocation used
`OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 tools/osd-heavy.sh`.
The fragment runner reads every file from `test/suites.d/adt.json` and runs
mocha with `--retries 0`; modes 0 and 1 run sequentially.

| Check | Result | Local log |
| --- | --- | --- |
| Original acceptance suite on unchanged main | 58 passed, 164 failed | `.local/t1213/red-main.log` |
| Expanded focused acceptance, mode 0 | 422 passed | `.local/t1213/focused-0.log` |
| ABAP reader Unit | 3 passed, 0 failed | `.local/t1213/reader-unit.log` |
| Complete ADT fragment, mode 0 | 2,557 passed, 47 files, 7 minutes | `.local/t1213/fragment-0.log` |
| Complete ADT fragment, mode 1 | 2,557 passed, 47 files, 7 minutes; includes all 422 new XML cases against the serving child | `.local/t1213/fragment-1.log` |
| Corrected B5 node-key fixture, mode 0 | 157 passed | `.local/t1213/b5-final.log` |
| Changed-path suites outside the fragment, including vscode-extension | 689 cases passed after focused recheck; 2 pre-existing optional stand cases pending, 29 files | `.local/t1213/extra.log`, `.local/t1213/extra-recheck.log` |
| `npm run lint` | Exit 0; 79 warnings, no errors | `.local/t1213/lint.log` |
| Suite registration / changed ABAP ASCII / `git diff --check` | Passed | No manifest drift; all changed ABAP is 7-bit ASCII |

The changed-path `rg -l -F` scan and selected outside-fragment files are
recorded in `.local/t1213/affected-grep-final.json`. `test/run.mjs` is a server
harness with no mocha cases, rather than an omitted suite. Existing fixtures
that used undeclared prefixes, invented create namespaces or multiple bare
roots now send well-formed envelopes. Invalid UTF-8 cases explicitly assert
400. Node-key comparisons explicitly assert 200 so equal refusals cannot
masquerade as a successful behavior comparison.

The first outside-fragment run had 687 passes and two failures: route drift
did not yet explain the new error middleware, and a source-check case
exceeded its existing two-second timeout. The inventory now explicitly maps
that middleware in both HTTP hosts to ADT request refusal. Both affected
suites then passed all 49 cases with `--retries 0`, preserving the original
timeout and assertions. The two optional pending cases are the existing
ZO4D Node/Go stand probes: their generated artifacts are absent in this tree.
No required check was removed or skipped.

Logs live under `.local/t1213/`; no capture data is tracked.

## Remaining scope

The XML-error type ID is deliberately our own; no SAP observation was made.
SRVD create still returns its established 501 capability refusal, with syntax
equivalence and rejection covered. The two sXML substrate defects have local
workarounds and documented upstream follow-ups; no upstream filing was
requested. Lint retains 79 advisory warnings, including two for the new
reader's method length and complexity. Input encoding is UTF-8.
