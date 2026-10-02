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

Go PACKAGE/OBJECT parity remains outside this slice. osgo does not mount
`/sap/bc/adt` at all: `src/icf/nodes.json` claims it as a HOST node, and
`tools/gogen/osgo.mjs` skips SICF nodes under claimed paths. These routes
therefore answer 404 on osgo as before. The Go store answers COMMANDS
without opening a tree and omits both commands; the probe exists for a
future ABAP-ADT host on Go. On an ABAP-ADT front, the routes probe COMMANDS
and return 501 when the required command is absent.

Validation: 149 route tests and three PACKAGE destination tests, including
$ZT_A before $ZTA, a namespaced package, a library, two $TMP users, nullish
query chains, class includes, inactive versions, node keys with fresh ids,
flat roots, malformed URI names, repeated/array URI parameters, tolerant
UTF-8 decoding, and the bound-store envelope. Explicit success assertions
prevent matching 404s from masquerading as fixture coverage. Nodepath's
existing /includes stripping also strips the INCL collection form, yielding
400 on both fronts; the test pins that behavior. The Node URIError fix was
already in the base and was not changed.

Review validation: the focused ABAP Unit run passes 16 methods across
DDIC (4), package (2), tree (2), typestructure (2), XML (3), and host (3).
The combined Mocha run passes 288 tests: 48 B8b + 152 B5 (149 route and
three destination tests) + 23 B8a + 29 existing diffs + 11 coverage +
5 XML well-formedness + 20 store-destination tests. `packages/%zz` is
compared by status only, as a deliberate non-equality for `:param` decode
failures. The six touched classes parse as ABAP 7.02 and are 7-bit ASCII.
Lint has no errors. TREE's two method-length and two complexity warnings
are gone; the other five touched classes have no warnings before or after.
The repository's 68 unrelated warnings remain.

Red proofs: `OSD_ADT_RED=package`, `path`, or `tree` on
`test/adt-abap-b5.mjs` appends one LF in the actual corresponding ABAP
renderer. Each selected live route comparison failed once; the unmutated
comparisons passed. All six moved routes in the batch have a red proof.

Only target tests were run through the 80-89 heavy runner, with no full
suite or separate ABAP-FS conformance run. #498 landed during the final
fetch; the stack was rebased onto main, and
B5's HOST_ALLOWED block removed. B8a and B8b also remove their entries.
The new coverage gate passes all 11 checks without modifying any of its
required checks; the review validation above includes the added status case
and XML checks.
