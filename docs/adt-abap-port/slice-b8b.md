# B8b: DDIC documents

Three new ABAP rows: GET (and HEAD) `ddic/dataelements/:name`,
`ddic/tables/:name`, and `ddic/tables/:name/source/main`.
`ZCL_OSD_ADT_DDIC` branches on the matched pattern; parser/info stays B8a.

READ is the only STORE command needed. The shared scanner, XML escaping,
URI encoder, typed error envelope, and strong entity helper are reused.
The public TABLE_FIELDS parser retains each element name as the C4 resolver
hook; these routes never call the resolver. No STORE TABLE_FIELDS command
is needed. TABL audit metadata is deliberately active/epoch even after a
WRITE, and missing names keep the decoded request's case.

Validation: 48 live Node/ABAP byte diffs, including UTF-8, all DTEL type
kinds, flags, first-match texts, numeric defaults/NaN, namespaced $TMP,
zero-field and structure tables, inactive metadata, mixed-case misses,
HEAD, and conditional entity tags. The DDIC ABAP Unit class has four
methods. B8a's 23 diffs and the existing 29 diff tests also pass in the
combined branch; lint has no errors (existing complexity warnings remain).

Red proofs are runnable with `OSD_ADT_RED=data_element`, `table_document`,
or `table_source` on `test/adt-abap-b8b.mjs`: appending one LF in each actual
ABAP renderer makes its live route comparison fail. Each was run and failed
one selected test. Normal comparisons then passed.

Only the requested target tests were run, through the 80-89 heavy runner;
no full suite or separate ABAP-FS conformance run. #498 landed during the final fetch. The stack was rebased onto main and
the B8b entries removed from HOST_ALLOWED. The stacked B8a base also drops
its already-ported entries. The coverage gate passes after B5.
