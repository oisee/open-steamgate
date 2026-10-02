# Original ABAPiti repros

Unchanged ABAPiti sources at 0facf0e, with one provenance header added.
The recursive ABAP Unit runner discovers these classes here. They have no
static RUN entry for the top-level IR Go/JS semantics harness; the JS check
uses the real transpiler instead ([byte-section-js-check.mjs](../../byte-section-js-check.mjs)).
