# B5: packages and repository tree

Three new ABAP rows: GET (and HEAD) `packages/:name`, POST
`repository/nodepath`, and POST `repository/nodestructure`.
`ZCL_OSD_ADT_PACKAGE` and `ZCL_OSD_ADT_TREE` own the documents and tree rules.

STORE PACKAGE uses the slice 0b IV_JSON/EV_JSON envelope:
`{name, mode: "raw" | "local", user}`. It reads the request's bound store,
returns full strings and described subpackages, and preserves the host's
order. Raw skips the local view; local applies packageOf, including $TMP
ownership and local roots. No ABAP sorting is added. Existing OBJECT metadata
and the resolved request-session user supply the other route inputs.

B1 is not in this stack; its `packages/settings` ABAP row must precede
`packages/:name`. Until it lands, the matcher reserves the literal settings
path for the HOST catch-all (encoded package names still reach the package
row, as in Express). There remains exactly one HOST row. This preserves
Node's static settings response without relaxing the coverage gate.

Go PACKAGE/OBJECT parity remains outside this slice. The Go store now
answers COMMANDS without opening a tree and omits both commands. These ABAP
routes probe COMMANDS and return 501 when the required command is absent;
the focused Go destination test and the live 501 route tests pass.

Validation: 148 route tests and three PACKAGE destination tests, including
$ZT_A before $ZTA, a namespaced package, a library, two $TMP users, nullish
query chains, class includes, inactive versions, node keys with fresh ids,
flat roots, malformed URI names, repeated/array URI parameters, tolerant
UTF-8 decoding, and the bound-store envelope. Explicit success assertions
prevent matching 404s from masquerading as fixture coverage. Nodepath's
existing /includes stripping also strips the INCL collection form, yielding
400 on both fronts; the test pins that behavior. The Node URIError fix was
already in the base and was not changed.

The focused ABAP Unit run passes 26 methods across DDIC, router, package,
and tree (two methods each in the new package and tree classes). The combined
route baseline is 48 B8b + 151 B5 + 23 B8a + 29 existing diffs; 20 existing
store-destination tests and one focused Go COMMANDS test also pass. Lint has
no errors; repository complexity warnings remain.

Red proofs: `OSD_ADT_RED=package`, `path`, or `tree` on
`test/adt-abap-b5.mjs` appends one LF in the actual corresponding ABAP
renderer. Each selected live route comparison failed once; the unmutated
comparisons passed. All six moved routes in the batch have a red proof.

Only target tests were run through the 80-89 heavy runner, with no full
suite or separate ABAP-FS conformance run. #498 landed during the final
fetch; the stack was rebased onto main, and
B5's HOST_ALLOWED block removed. B8a and B8b also remove their entries.
The new coverage gate passes all 11 checks without modifying any of its
required checks (282 Mocha tests total on the rebased stack).
