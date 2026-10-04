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

## Design after critic round 1

Node (`tools/adt-request-xml.mjs`) and ABAP (`zcl_osd_adt_request_xml`) implement
one restricted XML 1.0 grammar in two tokenizers. They share the acceptance
corpus `test/fixtures/adt-request-xml-corpus.json`: each case has original
bytes as hexadecimal, an accept/refuse verdict, and, for accepted documents,
an expected expanded-name element table. The mocha suite
`test/adt-request-xml-corpus.mjs` reads that same file, calls Node directly and
the transpiled ABAP class directly, and checks both verdicts and structures.
A disagreement fails the test. The corpus is an executable acceptance set,
not a claim of exhaustive coverage of all possible XML documents.

The grammar follows [XML 1.0 fifth edition](https://www.w3.org/TR/REC-xml/)
and [Namespaces 1.0 third edition](https://www.w3.org/TR/REC-xml-names/), with
UTF-8 input only and no DTD. XML S is exactly space, tab, CR and LF. Names
use the fifth-edition Unicode ranges; QNames have one or two nonempty
NCNames. Namespace declaration prefixes and PI targets are NCNames.
Declarations accept version 1.0, optional UTF-8 encoding, then optional
standalone yes/no, with XML S and either quote delimiter. The reserved xml
and xmlns bindings, raw and expanded-name duplicate attributes, namespace
scope, character validity, numeric references, closing names, a single root,
and all bytes after that root are checked. One initial UTF-8 BOM is allowed.
Line endings and literal attribute whitespace receive XML normalization;
whitespace from character references is preserved.

Limits remain **64 element levels including the root** and **16 MiB of original
bytes**. Route selection does not depend on Content-Type. Empty transport,
node-key, virtual-folder and lock/unlock bodies retain their old meanings.
Activation with a missing or non-activate method retains #572's behavior.
Source PUTs, including DDIC XML stored as source, remain outside this envelope
policy, as do SQL and JSON endpoints.

DOCTYPE is refused when encountered as declaration markup. Its spelling in
comments, CDATA and escaped source text is ordinary data. There is no DTD
parser, external resolver, network/file callback or entity expansion. Only
predefined and numeric character references are decoded, after checking the
Unicode scalar. ABAP constructs complete UTF-16 pairs for supplementary
references and converts both units together. Its tokenizer uses ABAP 7.02
syntax and ASCII source; it does not call sXML for any part of parsing.

## Structured consumers and admission order

The reader returns a flat element table: namespace URI, local name, one-based
parent index (zero for the root), immediate element text, and attributes with
URI/local/value. Namespace declarations are bindings rather than attributes
in this table. Node's `requestElements`, `elementsNamed` and `attributeValue`
provide access to it; ABAP uses `zif_osd_adt_xml` types and the reader's
`attribute` method. The original byte body is retained. Canonical text remains
available for diagnostics and existing direct reader tests; downstream
request extractors do not scan it.

Checkrun source and artifact URIs, transport URI/package/operation, VFS
preselection/value/facet/pattern, tree TV_NODEKEY, activation references,
create attributes and package references, and Unit references all consume
expanded names and element text. Decorating text elements with xml:space or
xml:lang cannot hide their values. Unit object identity and selector come
from the same `{http://www.sap.com/adt/core}uri` attribute of the objectReference;
foreign URI attributes and their order have no effect. Activation, create
and Unit are HOST routes on the ABAP front; after ABAP admission their Node
consumers parse the original bytes into the same structured representation.

The Node route profile normalizes the base path before matching, including
uppercase spellings accepted by Express. The Node-only front verifies local
Bearer credentials, admits XML, then
resolves the session and runs CSRF checks. The ABAP handler admits XML before
session resolution, statefulness upgrades, cookies, token issuance, enqueue
binding or dispatch. This also applies when ANSWER has no session adapter,
as in the real preview adapter. XML refusal is 400 with no Set-Cookie or
CSRF header, leaves existing sessions and enqueue contexts untouched, and
opens no fresh session even when the malformed POST has no token. Valid XML
continues through the existing session and CSRF gates.

Both readers use `ExceptionInvalidXML` / `invalid XML request`, our clean-room
identifiers, with `application/xml; charset=utf-8`. The exception namespace
remains the communicationframework URI from #572. No SAP XML error type was
observed or inferred.

## Confirmed substrate defects

The original sXML choice was insufficient. The critic independently
reproduced malformed-input acceptance on ABAP-owned routes and preview, and
numeric supplementary-reference corruption. The strict tokenizer replaces
that substrate path. `ANORMALIES.md` retains the confirmed byte-quote-search
and outside-root-text defects, explaining that their former transcoding and
wrapper workarounds are superseded. A third entry records numeric-reference
truncation. No dependency source was edited and no upstream filing was made.

## Round 1 acceptance evidence

The working branch remains `feat/adt-xml-namespaces` at
`11e0cb77f380cc20e3fb62aeb8d3d07bccbdbec8`; `.git` was not written and no commit
was made. All heavy commands use
`OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 tools/osd-heavy.sh`.
Local logs and the final report are under `.local/fix-round1/`.

Before the production fixes, direct critic probes reproduced the reader
acceptance differences and supplementary-reference truncation. The initial
119-case corpus on 11e0cb77 had 32 passing / 87 failing: failures include both
incorrect verdicts and the absent structured-output API. The strengthened
HTTP F1-F7 regressions were then run with the exact baseline production files
and its built generation: **0 passing / 384 failing**, recorded in
`http-red-11e0cb77.log`. That run includes unchanged-session digest assertions;
its failures are not relabeled as isolated syntax failures. All temporary
baseline file and generation substitutions were restored before fixing and
verification. The original critic's failing inline and foreign-URI assertions
also reproduced in `adversarial-before.log`.

The HTTP suite deliberately saves valid source and submits different invalid
inline source. It covers text-element attributes on all surveyed envelopes,
foreign Unit attributes in both orders, and legal DOCTYPE text. Every refused
kind checks zero store work and a digest of fixture/source/active files,
inactive state, held handles, **all session metadata including tokens and
statefulness**, enqueue locks and contexts, xref tables CROSS/WBCROSSGT/
WBCROSSGTX/D010INC, generation and runtime epoch. Mode 1 reads the actual
serving child's tables and contexts over read-only test IPC. Existing
stateless-session upgrade attempts and fresh no-token malformed requests
add explicit no-cookie/no-token assertions. Preview has direct malformed
admission tests without a Sessions adapter.

The final reader corpus has 310 byte cases plus 14 real preview-adapter
probes. The initial complete-fragment attempts exposed two regressions in the
conversion: direct-child-only content selection missed nested artifacts, and
stream admission did not retain bytes for hosts without express.raw. Both
were corrected and targeted checks passed. Those initial runs remain failed:
3,316 pass / 16 fail in mode 0, 3,319 pass / 17 fail in mode 1.

After those fixes, complete fragments passed 3,339 cases in each mode.
An extra uppercase-base-path probe then found a Node policy bypass; its
recorded red responses were 500 for an existing session and 403 for a fresh
one. Normalizing the base before matching closes it. Both focused modes
passed all 1,208 XML/corpus/preview cases after that fix. Final full-fragment
runs including the four extra cases each passed all 3,343 tests, sequentially,
with zero failures and zero retries.

| Check | Result | Local log under `.local/fix-round1/` |
| --- | --- | --- |
| Final transpile | exit 0, 2,333 objects | `transpile-final.log` |
| Final lint | exit 0, 79 advisory warnings | `lint-final.log` |
| XML, corpus, preview and C1, mode 0 | 1,230 pass | `focused-final-0.log` |
| Same, mode 1 | 1,230 pass | `focused-final-1.log` |
| Last XML/corpus/preview recheck, each mode | 1,208 pass | `uppercase-focused-{0,1}.log` |
| Affected consumers and host seams, mode 0 | 249 pass | `affected-final-0.log` |
| Critic full adversarial matrix, mode 0 | 540 pass | `adversarial-final-0.log` |
| Same, mode 1 | 540 pass | `adversarial-final-1.log` |
| Complete ADT fragments, each mode, before the casing cases | 3,339 pass | `fragment-final-{0,1}.log` |
| Final complete ADT fragments, each mode, including casing cases | 3,343 pass | `fragment-complete-{0,1}.log` |

No required assertion or check was removed or relaxed. An intermediate
transpile detected the scratch class changing during an overlapping test,
refused publication and left live untouched. Subsequent build and checks
ran sequentially. Suite registration, changed ABAP ASCII and whitespace
checks passed.
The latency harness is the critic's `cost-stable.mjs`: sequential HTTP,
nine discarded warmups and median of nine measurements, with the same
ObjectStore fixture, payloads, auth, activation/checkrun work and
`transpileOnActivate:false`. The before/after comparison uses reader-enabled
measurements on 11e0cb77 and the fixed tree. Reader-off measurements are not
used to compare the two implementations. These numbers exclude cold child
startup and full-system activation transpilation/publication.

## Sequential median-of-nine latency

| Front | Mode | Request | Before (ms) | After (ms) | Delta (ms) |
| --- | --- | --- | ---: | ---: | ---: |
| node | 0 | activation | 7.227 | 7.333 | +0.107 |
| node | 0 | checkruns | 1.519 | 1.677 | +0.158 |
| abap | 0 | activation | 9.227 | 12.715 | +3.488 |
| abap | 0 | checkruns | 6.966 | 10.130 | +3.165 |
| node | 1 | activation | 7.342 | 7.311 | -0.031 |
| node | 1 | checkruns | 1.601 | 1.695 | +0.094 |
| abap | 1 | activation | 13.329 | 23.615 | +10.286 |
| abap | 1 | checkruns | 9.323 | 12.417 | +3.094 |

These are before/after reader-enabled measurements on 11e0cb77 and the fixed
tree. Node deltas are small; the negative delta is noise. The strict ABAP
checkrun path adds about 3 ms in this fixture. ABAP activation adds about
3.5 ms inline and 10.3 ms through the serving child. Raw samples and logs
remain in `.local/fix-round1/`; each median contains exactly nine samples.
The benchmark scope excludes cold startup and full-system publication.

## Remaining scope

The input encoding remains UTF-8. SRVD create retains its existing 501
capability refusal. The three sXML defects need upstream follow-up; no
upstream action is authorized here. The corpus checks the acceptance grammar
and structure on both implementations; direct preview probes check its real
adapter, without claiming a new built browser or binary was executed.
