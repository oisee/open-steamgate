# Named ABAP transformations: ST and XSLT

This is a general OSG runtime track, independent of any one XML converter.
Keep the observable `CALL TRANSFORMATION` contract and named repository
objects separate from the choice of XML engine underneath.

## Current boundary

The bundled `open-abap-core` kernel implements `CALL TRANSFORMATION ID` with
ABAP/XML and some JSON paths, exercised by its ABAP Unit corpus. Its dispatcher
asserts that the transformation name is `ID`; it does not execute named ST or
XSLT programs. OSG currently has no runtime registry for their source objects.
The transpiler lowers `CALL TRANSFORMATION` to that kernel, but currently emits
only a static name and omits `PARAMETERS`. Dynamic names and parameters require
transpiler work; dynamic SOURCE/RESULT binding tables need focused tests too.

The bundled iXML parser/renderer and sXML writer cover useful pieces, but
`CL_SXML_STRING_READER` currently reads JSON rather than general XML. Do not
infer complete XML validation or streaming from an available class name.

## Staged implementation

1. **Registry, static dispatch and oracle (medium):** carry named
   transformation source files through packs, Node and browser builds into a
   pinned generation. Resolve static names through `CALL TRANSFORMATION` and
   fail explicitly for unsupported kinds and source/target forms. Test case,
   duplicate and missing names, and activation/reload lifetime. Keep `ID`
   behavior unchanged. Build a small A4H corpus first. Dynamic names and
   `PARAMETERS` require a separate transpiler change before their fixtures
   can run.
2. **Useful ST subset (medium–large):** start with literal elements and
   attributes, ABAP roots/values, structures, internal tables and the minimal
   conditions/loops demonstrated by the corpus. Support XML → ABAP and
   ABAP → XML; define namespaces, whitespace, missing/extra nodes, encodings,
   initial values and exceptions from measured cases. Streaming and the full
   ST language remain separate work.
3. **XSLT slice (medium for XML → XML, large for SAP parity):** evaluate an
   existing, maintained XSLT engine for the Node host and browser build rather
   than writing an XSLT interpreter. First prove ordinary XSLT 1.0 templates,
   XPath, namespaces, parameters and output modes on XML → XML. ABAP data
   binding, SAP extensions, exact errors and any wider XSLT dialect need
   separate measured contracts. Record engine version and licences.

SAP documents ST as a declarative ABAP ↔ XML language and XSLT as a more
general transformation language. Using another XSLT engine alone does not
establish SAP compatibility. See [ST](https://help.sap.com/docs/abap-cloud/abap-keyword/simple-transformations-st)
and [CALL TRANSFORMATION](https://help.sap.com/doc/abapdocu_750_index_htm/7.50/en-US/abapcall_transformation.htm).

## A4H comparison and acceptance

Create original, small ST/XSLT repository objects and a public ABAP Unit
driver. Run the same fixtures on A4H and OSG. Use a matrix by transformation
kind and direction: ST XML → ABAP and ABAP → XML; XSLT also XML → XML and
ABAP → ABAP. Include static and dynamic names, `PARAMETERS`, typed ABAP
values, static and dynamic SOURCE/RESULT bindings, `string`, `xstring`, and
reader/writer objects. Mark unsupported forms as explicit refusals in each
slice. Capture results and exception class/messages without private data.

Compare XML as parsed structure where formatting is incidental, retaining
namespace URI, element order, attributes and text; also compare exact bytes
where output options, encoding or canonical form are the behavior under test.
Compare ABAP values and tables structurally, and record exceptions separately.
For XSLT, add template priority, XPath and output-mode cases. For ST, add
missing/extra nodes, initial values and repeated table elements, measuring
how an existing target changes. For canonical ID/XSLT deserialization, test
`OPTIONS clear = 'all'` versus preserving existing target values. Keep
performance and large-input memory probes separate from semantic parity.

The first deliverable is a green, named transformation fixture on both hosts
with an explicit supported subset and readable refusals for everything else.
