# VSP contracts relevant to the OSD ADT facade

Source review of the sibling VSP `pkg/adt` checkout, paired with the offline
tools described in [adt-corpus.md](adt-corpus.md). The generated `vsp.json`
records exact source hashes and line references; this document explains the
important distinctions. VSP is one consumer, not a specification for Eclipse.

## Main operations

Paths below are relative to `/sap/bc/adt`. `{object}` means an encoded object
name; query values are part of the operation, not disposable URL noise.

| Operation | Request | What VSP consumes / requires | Source |
| --- | --- | --- | --- |
| SearchObjectByType | GET repository/informationsystem/search; operation=quickSearch, query, maxResults, optional objectType | objectReferences/objectReference, name/type/uri and optional metadata | client.go, xml.go |
| GetPackage | POST repository/nodestructure; parent_type=DEVC/K, parent_name, withShortDescriptions | ABAP serialization values/DATA/TREE_CONTENT/SEU_ADT_REPOSITORY_OBJ_NODE; OBJECT_NAME/TYPE/URI/DESCRIPTION. Unnamed grouping nodes skipped | client.go:1042 |
| GetClass | GET oo/classes/{object}/source/main | Plain source returned as map entry main. Does not fetch the class property document | client.go:449 |
| GetProgram / GetInterface / GetDDLS | GET typed collection/{object}/source/main | Plain source; program reading can fall back to the includes collection on 404 | client.go |
| GetClassObjectStructure | GET oo/classes/{object}/objectstructure; Accept objectstructure.v2+xml | objectStructureElement root, direct child elements and links | client.go:500, xml.go:184 |
| GetClassMethodSource | Structure/method lookup followed by source read | Correct method type, source relation and line ranges; successful XML parsing alone does not establish these | client.go:517, xml.go GetMethods |
| Class include source | GET oo/classes/{object}/includes/{kind} | Non-main includes do not append /source/main; main does | crud.go GetClassIncludeSourceURL |
| LockObject / UnlockObject | POST object URL; _action=LOCK/UNLOCK; accessMode or lockHandle | Stateful context; LOCK result values/DATA/LOCK_HANDLE and metadata. MODIFY requires a nonempty handle, not a particular modification-support label | crud.go:28 |
| UpdateSource | PUT source URL, lockHandle and optional transport | Mutation policy and source-change guard; stateful write. Needs an actual lock/write/read scenario | crud.go:187 |
| SyntaxCheck | POST checkruns?reporters=abapCheckRun; Content-Type application/* | Base64 source in checkObjectList request; checkRunReports/checkReport/checkMessageList/checkMessage response, uri/type/shortText | devtools.go:32 |
| Activate | POST activation?method=activate&preauditRequested=true | objectReferences request; empty success or parsed refusal/messages in response. HTTP 200 alone is not success | devtools.go:167 |
| RunUnitTests | POST abapunit/testruns; application/* | runConfiguration request, test classes/methods and alerts in result | devtools.go:741 |
| GetFunctionGroup | GET functions/groups/{object}; versioned vendor Accept | abapFunctionGroup document. Generic application/xml is not assumed interchangeable | client.go:584 |

The transport (`http.go`) handles CSRF, cookies and session-type headers.
`LockObject` explicitly requests stateful/fresh context. `UnlockObject` stays
stateful and can retire the proxy context after success. These dependencies
cannot be checked by sorting unique URLs or replaying a recorded token.

## What not to infer from these sources

`crud.go`'s `rootName` map and `packageRef` templates construct CREATE payloads.
They are useful evidence about names and namespaces, but not complete schemas
for GET property documents. Likewise, VSP can read class source successfully
while Eclipse fails to open the class property document and its links.

VSP's package reader and an Eclipse virtual-folder request are different
operations. A `nodestructure` document that VSP reads is not evidence that
`repository/informationsystem/virtualfolders/contents` is correct.

The class structure parser exposes direct children, not a recursive object
tree. Method navigation additionally needs correct `CLAS/OM` types and source
block relation/range values. Comparing counts is useful but intentionally less
strong than testing method extraction against matching source.

SyntaxCheck can validly return no messages, and unit tests can validly return
no classes. To prove error/test reporting, fixtures must include a syntax error
and nonempty test results (both passing and failing), respectively. Two empty
results provide no evidence that those paths work.

Source inspection also finds resource-specific namespace handling: syntax-check
parsing uses XML local names, while the unit-result parser still strips some
literal prefixes from text before unmarshalling. This is another reason not
to treat all VSP parsing as a universal namespace-aware ADT validator.

## Evidence produced by the tools

The source inventory is lexical: URL literals, surrounding function context,
XML tags and source locations. Comments and tests are separately marked. It
helps find the relevant consumer code; it cannot resolve every dynamically
constructed URL or prove that a literal is executed.

The Go helper then calls real VSP operations against recorded successful
responses. The Python join checks nonempty output counts, reports empty results
as inconclusive, and records grouping/nested rows outside those specific
consumer contracts. It does not simulate SAP or accept real requests from VSP
on behalf of OSD: the captured response is deliberately substituted.

For an OSD compatibility verdict, supplement those checks with an isolated OSD
fixture store and actual VSP request sequences. Include class includes, named
objects in packages, method extraction, a negative syntax check, lock/write/
activate/read/unlock, and positive/negative unit results. Eclipse and abap-fs
then need their own request/link-following scenarios.
