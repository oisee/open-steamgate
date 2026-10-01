# pAMDP corpus value parity

Run on 2026-10-01 with `node tools/amdp-corpus-oracle.mjs --parity` under the
HXE schema lock. The complete per-object report is
`.local/amdp-oracle/parity-2026-10-01.json`; this tracked page contains counts
and behavior only. The `origin/research/amdp-lift` ref was not available in
this checkout or on `origin` at the time of this run.

The parity runner uses the signatures and typed catalogue already extracted
by the corpus oracle. It exercises four deterministic cases per body: empty
table inputs, initial scalar and table values, a three-row edge case with
negative integers, full-length fixed strings and full-precision decimals,
and a case with NULL scalars and cells. Physical `USING` tables receive the
same generated rows and are reset before each HXE case. HXE executes the
original SQLScript; SQLite and DuckDB
execute the compiled pAMDP IR. Tables are compared as multisets unless the
body specifies ordering. Decimal values are compared as text at the declared
scale. The report keeps each input and the first differing cell.

## Results

| class | bodies |
| --- | ---: |
| `equal` | 16 |
| `differs` | 1 |
| `hana-error` | 2 |
| `portable-error` | 12 |
| `skipped` | 368 |

The run covered 399 corpus bodies. HXE created 252; the portable compiler
accepted 33; their intersection was 31. All 31 received generated inputs.
The `skipped` group is 221 bodies the portable compiler refused and 147 HXE
did not create. HXE's refusals were 104 unresolved DDIC types, 32 bodies
requiring an absent HANA library, 9 missing objects and 2 other failures.
The handover's earlier 327-created count is a different measurement; this
run's 104 DDIC-type refusals show that the current local stand still lacks
shapes needed to recreate many bodies. These counts describe this run, not a
claim about the corpus's validity on its source system.

The one observed cell difference was **NULL concatenation in a scalar
function**: direct HXE SQL returned NULL, while the portable AMDP scalar
output boundary returned ABAP's initial empty string. The synthetic HXE
probe and portable regression are recorded in
`docs/sqlscript-hana-observed.md` and `test/amdp-value-parity.mjs`. A
different edge case of the same body raised on HXE for an overlong result;
the per-case report retains that error separately.

The 12 `portable-error` bodies divide into 5 whose nested table function is
not in the portable registry and 7 that reach a function with no measured
portable rendering: `FLOOR` (1), `LEFT` (1), `ESCAPE_SINGLE_QUOTES` (2),
`TO_NCHAR` (1), `TO_NCLOB` (1), and `ESCAPE_DOUBLE_QUOTES` (1). One of the
`hana-error` bodies also reached an unmeasured `TO_BINARY` rendering on
other input cases. The HXE errors were a `SELECT INTO` that wants exactly one
row in one body (no row on the empty and null inputs, two rows on the
defaults) and an invalid datatype on an edge input in another: what HANA does
with the generated inputs, not a fault of either side. These remain open.

An earlier run handed HXE the procedure inputs under the compiled program's
upper-case names, which `amdp-run` does not read for a procedure whose
parameters are written in lower case: HXE got `NULL` and empty tables there.
`hanaInputsFor` now keys them by the signature's own names (test in
`test/amdp-value-parity.mjs`); the counts above are from the run after that
fix, and they did not move.

The cheap fix in this slice is two-argument `SUBSTR`: the portable renderer
used to emit `undefined` as the missing length. A hand-written case first
failed on SQLite and DuckDB, then passed after each dialect emitted the
two-argument form. HXE returned `cdef` for `SUBSTR('abcdef', 3)` under the
lock. This moved one body from `portable-error` to `equal`.

## Limits

Bodies that HXE does not create, that the compiler refuses, or whose inputs
cannot be populated are `skipped` with a reason. A HXE execution failure is
`hana-error`; a portable execution failure is `portable-error`. These are
execution findings, not claims that output values differ.
