# open-abap and transpiler anomaly log

Behaviour that differs between a real SAP system and open-abap / the abaplint
transpiler / its database adapter. Add an entry as soon as the discrepancy is
isolated and before hiding it behind a workaround. Ordinary open-steamgate
defects that reproduce identically on both runtimes do not belong here.

Resolved entries stay as compatibility history. Review all open entries before
upgrading `@abaplint/*` and before every release.

Format adapted from `larshp/hithub` (MIT).

## Entry template

### ANOMALY-YYYY-MM-DD-short-name — Short title

- Status: `open` | `workaround` | `reported` | `fixed` | `not-an-anomaly`
- Discovery date: `YYYY-MM-DD`
- Affected versions: `@abaplint/transpiler-cli x.y.z`, `@abaplint/runtime x.y.z`, `@abaplint/database-sqlite x.y.z`
- Affected ABAP statement, runtime API or adapter: `...`
- Minimal ABAP reproducer: `path/to/reproducer`
- Exact command used to run it: `...`
- Expected SAP behaviour: `...`
- Actual open-abap behaviour: `...`
- Impact on open-steamgate: `...`
- Smallest safe workaround: `...` or `none`
- Upstream issue: `link` or why it has not been reported
- Regression-test location: `path/to/test`
- Upstream version containing a fix: `...` or `unknown`

## Open anomalies

### ANOMALY-2026-09-11-no-implicit-mandt — Client-dependent tables are read across all clients

- Status: `open`
- Discovery date: `2026-09-11`
- Affected versions: `@abaplint/transpiler-cli 2.13.85`, `@abaplint/runtime 2.13.85`, `@abaplint/database-sqlite 2.13.83`
- Affected ABAP statement, runtime API or adapter: `SELECT` on a table with `CLIDEP = X`; `sy-mandt` is the constant `123` (`runtime/src/builtin/sy.ts`)
- Minimal ABAP reproducer: `src/demo/zcl_zstg_demo_dpc_ext.clas.abap` `travelset_get_entityset` against `data/zstg_demo.tabu.json` (3 rows in client 123, 1 in client 001)
- Exact command used to run it: `npm run unit`
- Expected SAP behaviour: 3 rows; the database interface adds `MANDT = sy-mandt` to every Open SQL statement on a client-dependent table unless `CLIENT SPECIFIED`
- Actual open-abap behaviour: 4 rows; no client predicate is generated, `INSERT`/`UPDATE`/`DELETE` likewise touch every client
- Impact on open-steamgate: every real business table is client-dependent; a seeded multi-client capture leaks rows across clients, and any DPC that branches on `sy-mandt` sees `123`
- Smallest safe workaround: seed captures with a single client and set every row's `mandt` to `123`; do not rely on client isolation in tests
- Upstream issue: not reported yet; check `abaplint/transpiler` for an existing MANDT issue before opening one
- Regression-test location: `test/unit/zcl_stg_phase0_test.clas.testclasses.abap` `entityset_reads_sqlite` pins the current 4-row result and will fail when the runtime starts filtering
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-11-oao-handler-hardcodes-test-dpc — open-abap-odata cannot be consumed as a library

- Status: `workaround`
- Discovery date: `2026-09-11`
- Affected versions: `open-abap/open-abap-odata` main at `7b20ba2` (2026-08-27)
- Affected ABAP statement, runtime API or adapter: `zcl_oao_http_handler=>data` declares `lo_dpc TYPE REF TO zcl_zsegw_dpc_ext`, a class that only exists in that repo's `test/` folder
- Minimal ABAP reproducer: add the repo as a lib in `abap_transpile.json` without `exclude_filter`
- Exact command used to run it: `npm run transpile`
- Expected SAP behaviour: n/a (library packaging)
- Actual open-abap behaviour: `Error: CreateObjectTranspiler, target variable "lo_dpc" not a object reference`
- Impact on open-steamgate: blocks using the interface transcription as a lib
- Smallest safe workaround: `"exclude_filter": ["zcl_oao_http_handler"]` on the lib entry (applied)
- Upstream issue: https://github.com/open-abap/open-abap-odata/issues/33 (open, same crash); QW1 in `AGENDA.md` is the fix, sent upstream as https://github.com/open-abap/open-abap-odata/pull/40 (merged 2026-09-12)
- Regression-test location: `npm run transpile` itself
- Upstream version containing a fix: open-abap-odata main from 5467424 (2026-09-12); open-steamgate consumes upstream directly since #48

### ANOMALY-2026-09-11-doubled-quote-literal — A literal holding two quotes is transpiled as one character

- Status: `fixed` in `@abaplint/transpiler` 2.13.86 (2026-09-12); workaround removed the same day
- Discovery date: `2026-09-11`
- Affected versions: `@abaplint/transpiler-cli 2.13.85`
- Affected ABAP statement, runtime API or adapter: any character literal whose content is escaped quotes, e.g. `''''''` (two quotes) used in `REPLACE ALL OCCURRENCES OF '''''' IN lv WITH ''''`
- Minimal ABAP reproducer (inline):

  ```abap
  rv_result = `x''y`.
  REPLACE ALL OCCURRENCES OF '''''' IN rv_result WITH ''''.
  " SAP: x'y   open-abap: x''y
  ```

- Exact command used to run it: `abap_transpile` + `node output/index.mjs` on a class with the two lines above in a FOR TESTING method
- Expected SAP behaviour: `''''''` is a `c LENGTH 2` literal containing `''`; the replace yields `x'y`
- Actual open-abap behaviour: the literal is emitted as `abap.CharacterFactory.get(1, '\'\'')`, a `c LENGTH 1`, so the pattern degenerates to a single quote and the statement is a no-op. Length is computed before the escape sequence is folded.
- Impact on open-steamgate: OData key predicates and `$filter` literals escape quotes by doubling; un-doubling silently failed
- Smallest safe workaround: build the two-quote string at runtime, `lv_two = |''|`, and use the variable in `REPLACE` (was applied in `zcl_stg_url`, `zcl_stg_json`, `zcl_stg_request_context`, `zcl_stg_sadl_dpc`; the literal is back since 2.13.86)
- Upstream issue: https://github.com/abaplint/transpiler/pull/1829 (fix + test, open 2026-09-12)
- Regression-test location: `test/unit/zcl_stg_gateway_test.clas.testclasses.abap` `ltcl_url->keys_named`
- Upstream version containing a fix: 2.13.86

### ANOMALY-2026-09-12-fae-dedupe-by-db-key — FOR ALL ENTRIES de-duplicates by the DB key on the target table

- Status: `fixed` in `@abaplint/transpiler` 2.13.86 (2026-09-12); workaround removed the same day
- Discovery date: `2026-09-12`
- Affected versions: `@abaplint/transpiler-cli 2.13.85`, `@abaplint/runtime 2.13.85`
- Affected ABAP statement, runtime API or adapter: `SELECT <fields> FROM tab INTO CORRESPONDING FIELDS OF TABLE lt FOR ALL ENTRIES IN ...` where the target line type lacks a key field of `tab` (typically MANDT)
- Minimal ABAP reproducer: `src/demo/zcl_zstg_demo_dpc_ext.clas.abap` `get_expanded_entityset` before this entry's workaround
- Exact command used to run it: `npm run unit`
- Expected SAP behaviour: the union of the per-entry selects with duplicates removed, target fields filled by name
- Actual open-abap behaviour: the generated code runs `SORT lt BY mandt travel_id booking_id` + `DELETE ADJACENT DUPLICATES` with the DB key's component names on the *target* table: `Error: sort compare, wrong component name, mandt`
- Impact on open-steamgate: any DPC that FAE-selects into a projection structure crashes the request; very common in hand-written DPCs
- Smallest safe workaround: select into a table typed like the DB table (`TYPE STANDARD TABLE OF tab`) and MOVE-CORRESPONDING afterwards (was applied in the demo; `INTO CORRESPONDING FIELDS` is back since 2.13.86)
- Upstream issue: https://github.com/abaplint/transpiler/pull/1830 (fix + test, open 2026-09-12)
- Regression-test location: `test/unit/zcl_stg_gateway_test.clas.testclasses.abap` `ltcl_navigation->expand_by_the_dpc`
- Upstream version containing a fix: 2.13.86

### ANOMALY-2026-09-12-fae-empty-driver — FOR ALL ENTRIES with an empty driving table throws

- Status: `fixed` in `@abaplint/transpiler` 2.13.86 (2026-09-12); workaround removed the same day
- Discovery date: `2026-09-12`
- Affected versions: `@abaplint/transpiler-cli 2.13.85`
- Affected ABAP statement, runtime API or adapter: `SELECT ... FOR ALL ENTRIES IN lt` with `lt` empty
- Minimal ABAP reproducer: the same SELECT as above with an empty `lt_travel` (guarded by `IF lt_travel IS NOT INITIAL` in the demo)
- Exact command used to run it: `npm run unit` without the guard
- Expected SAP behaviour: the WHERE condition with the FAE table is dropped, all rows are selected (the classic FAE trap)
- Actual open-abap behaviour: `throw new Error("FAE, todo, empty table")` in the generated code
- Impact on open-steamgate: a DPC that relies on the SAP behaviour (or forgets the guard) crashes instead of over-selecting
- Smallest safe workaround: guard every FAE with `IF lt IS NOT INITIAL`, as good ABAP does anyway (kept: since 2.13.86 an unguarded empty driver selects everything, like on SAP)
- Upstream issue: https://github.com/abaplint/transpiler/pull/1832 (SAP semantics: empty driver ignores the WHERE; Lars may prefer an option, offered in the PR)
- Regression-test location: none
- Upstream version containing a fix: 2.13.86

### ANOMALY-2026-09-12-create-data-ddic-view — CREATE DATA with a DDIC view type is unknown at runtime

- Status: `fixed` in `@abaplint/transpiler` 2.13.86 (2026-09-12); workaround removed the same day
- Discovery date: `2026-09-12`
- Affected versions: `@abaplint/transpiler-cli 2.13.85`, `@abaplint/runtime 2.13.85`
- Affected ABAP statement, runtime API or adapter: `CREATE DATA rr TYPE STANDARD TABLE OF <ddic view>` (VIEW object)
- Minimal ABAP reproducer: `tools/cds2ddic.mjs` generated source classes before this entry's workaround
- Exact command used to run it: `npm run unit`
- Expected SAP behaviour: a table of the view's line type
- Actual open-abap behaviour: `Error: CREATE DATA, unknown type ZVSTGTRAVEL` (the transpiler resolves the view statically for SELECT, but the runtime DDIC lookup has no entry for views)
- Impact on open-steamgate: generic code that creates data by a view name fails
- Smallest safe workaround: declare `TYPES ty_line TYPE <view>` in the class and `CREATE DATA ... TYPE ty_line` / a local table type (was applied in the generator; `CREATE DATA ... TYPE STANDARD TABLE OF <view>` is back since 2.13.86)
- Upstream issue: https://github.com/abaplint/transpiler/pull/1831 (two fixes: views were never imported by the init script, and the runtime ignored the TABLE flag for static DDIC names, so plain `CREATE DATA ... TYPE STANDARD TABLE OF t100` was broken too)
- Regression-test location: `test/unit/zcl_stg_gateway_test.clas.testclasses.abap` `ltcl_sadl->entity_set_with_filter`
- Upstream version containing a fix: 2.13.86

### ANOMALY-2026-09-13-conv-second-in-expression — The second constructor expression in one expression has no type

- Status: `PR open: abaplint/transpiler#1842`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/transpiler 2.13.86`, `@abaplint/core 2.120.5`
- Affected ABAP statement, runtime API or adapter: `CONV` (and any constructor expression resolved through an inferred type) when more than one appears in one expression
- Minimal ABAP reproducer: `foo = CONV f( 1 ) + CONV f( 2 ).`
- Exact command used to run it: `npx abap_transpile` over oisee/vivid-vibes; isolated with the transpiler's own `runSingle`
- Expected SAP behaviour: both are floats; ABAP has no opinion about how many of them fit in a statement
- Actual open-abap behaviour: the transpile ends with `TypeNameOrInfer, type not found: f`. The syntax check records an InferredType reference for the first name and none for the rest, and the transpiler had nothing else to fall back on
- Impact on open-steamgate: none of ours; 786 uses of `CONV f(` across 69 files of vivid-vibes, 136 of them with two in one expression, so the demo payload did not transpile at all
- Smallest safe workaround: split the expression into two statements
- Upstream issue: **PR [abaplint/transpiler#1842](https://github.com/abaplint/transpiler/pull/1842)**, opened 2026-09-14 from branch `fix/conv-builtin-type-name` inside the repo, so Regression runs. A built-in type name that names exactly one type (`i`, `f`, `string`, `xstring`, `d`, `t`, `int8`, `utclong`, `decfloat16/34`) is enough on its own when no reference was recorded
- Regression-test location: the transpiler's `test/single_statements.ts`, local branch
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-13-paren-before-conv — A parenthesised group before `* CONV ... /` generates unbalanced JavaScript

- Status: `fixed locally, PR parked`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/transpiler 2.13.86`
- Affected ABAP statement, runtime API or adapter: arithmetic where a constructor expression sits between two operators
- Minimal ABAP reproducer: `foo = ( 1 - 2 ) * CONV f( 3 ) / 256.`
- Exact command used to run it: `npx abap_transpile`; the generated module then fails to parse with `Private field '#x' must be declared in an enclosing class`, which is V8 recovering from unbalanced parentheses somewhere above
- Expected SAP behaviour: `(( 1 - 2 ) * conv) / 256`, left to right
- Actual open-abap behaviour: the emitted JavaScript drops `( 1 - 2 ) *` and closes one bracket too many. The rearranger flattens a nested arithmetic Source into its parent so precedence can be decided across the whole chain, and a constructor expression is five children rather than one, so its type name and body landed beside the operators and were read as operands
- Impact on open-steamgate: none of ours; 15 of 85 effect classes in vivid-vibes emitted modules that could not be imported, and one broken module breaks the whole runtime because `init.mjs` imports every class
- Smallest safe workaround: assign the constructor expression to a variable first
- Upstream issue: none yet, branch `fix/rearranger-constructor-operand`, next in the queue. The head of the flattened chain is wrapped back into one Source before it is hoisted
- Regression-test location: the transpiler's `test/single_statements.ts`, local branch
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-13-builtin-as-method — A built-in function in such an expression is emitted as a method of the class

- Status: `fixed locally, PR parked`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/transpiler 2.13.86`
- Affected ABAP statement, runtime API or adapter: any built-in function call (`cos`, `sin`, `nmax`, `lines`, `frac`) inside an expression carrying more than one constructor expression
- Minimal ABAP reproducer: in a class, `lv = CONV f( 1 ) + CONV f( 2 ) * nmax( val1 = 0 val2 = lv_ax * cos( lv_ax ) ).`
- Exact command used to run it: `npx abap_transpile`, then calling the method: `TypeError: this.cos is not a function`
- Expected SAP behaviour: `cos` is a built-in unless the class defines a method of that name, in which case the method wins
- Actual open-abap behaviour: emitted as `await this.cos( )`. The decision rests on a BuiltinMethodReference the syntax check records, and in this shape it records none, so the call fell through to the `this.` case. Same root as the two above: one reference per expression
- Impact on open-steamgate: none of ours; it is why several vivid-vibes effects failed at runtime rather than at build time, which is the worse of the two
- Smallest safe workaround: split the expression
- Upstream issue: none yet, PR deferred. Fixed in the same local branch: an unrecorded name is taken as a built-in only when it is the first call in its chain, `abaplint.BuiltIn.searchBuiltin` knows it, and the enclosing class has no method of that name. The chain condition matters, `mi_merge->get_result( )-stage->count( )` is a method called COUNT
- Regression-test location: the transpiler's `test/files.ts`, local branch, both directions
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-14-builtin-positional-argument — An unrecorded built-in is called positionally

- Status: `fixed locally, PR parked`
- Discovery date: `2026-09-14`
- Affected versions: `@abaplint/transpiler 2.13.86`, including the local build that already carried the earlier half of this fix
- Affected ABAP statement, runtime API or adapter: any built-in function taking a single argument — `sin`, `cos`, `sqrt`, `exp` — called from inside an expression that carries more than one constructor expression
- Minimal ABAP reproducer:

```abap
DATA lv_t TYPE f.
DATA lv_speed TYPE f.
DATA(a) = CONV f( '0.5' ) + sin( lv_t * lv_speed ) * CONV f( '0.3' ).
"        -> abap.builtin.sin(abap.operators.multiply(...))   wrong
DATA(b) = sin( lv_t * 3 + lv_t * 4 ) * 10.
"        -> abap.builtin.sin({val: abap.operators.add(...)}) right
```

- Exact command used to run it: `npx mocha build/test/builtin/cos.js`; found by open-steamgate driving her preload sequence, which died at frame 1281 in `zcl_o4d_twistzoomer`
- Expected SAP behaviour: n/a, this is an emitter defect rather than a semantic one. The runtime signature is `sin(input: {val})`
- Actual open-abap behaviour: the argument is emitted positionally, so `input.val` is undefined and the first line that touches it throws `Cannot read properties of undefined (reading 'get')`. Nineteen calls across eight of her classes, with correct calls in the same files three lines away
- Impact on open-steamgate: the whole timeline. Twistzoomer was simply the first of the eight her sequence reached; the other seven were queued behind it. Deterministic, not a race — they chased concurrency first and it was a blind alley
- Smallest safe workaround: `sin( val = x )` written out, or lift the argument into its own variable first
- Upstream issue: none yet, branch `fix/builtin-not-a-method`, which carries both halves — the name and the argument shape — since they are the same defect one layer apart. It sits on `fix/conv-builtin-type-name` (PR #1842) because a built-in only goes unrecorded in an expression that also loses a constructor expression's type, so the test cannot be written without it; four other shapes were tried. **This is the tail of a defect this session fixed earlier and did not fix far enough.** `isBuiltinMethod` was taught to recognise built-ins the syntax check had not recorded, so the *name* came out right; `findMethodReference` still returns nothing for them, and the parameter transpiler falls back to a positional argument when it has no definition. Right function, wrong shape. A built-in now brings its own definition via `BuiltIn.searchBuiltin`
- Regression-test location: `test/builtin/cos.ts` — runs the expression, and separately asserts that no `builtin.sin(` or `builtin.cos(` is followed by anything but a brace, so a regression fails on the shape rather than on a value that happens to be zero
- Upstream version containing a fix: `unknown`

### DEBT-2026-09-14-no-push-to-abaplint — We can push a branch to the transpiler and not to abaplint

- Status: `open`
- Discovery date: `2026-09-14`
- Affected versions: n/a, a process fact
- Affected ABAP statement, runtime API or adapter: none
- Minimal ABAP reproducer: none
- Exact command used to run it: `gh api repos/abaplint/abaplint --jq .permissions` against `gh api repos/abaplint/transpiler --jq .permissions`
- Expected SAP behaviour: n/a
- Actual behaviour: `abaplint/transpiler` gives us `push: true`, `abaplint/abaplint` gives `push: false`. So Lars's advice — make the PR from a branch inside the repo, or the regression and performance workflows never run — **can be followed for the transpiler and cannot be followed for abaplint**. Their `regression.yml` skips forks by an explicit condition, `github.repository == 'abaplint/abaplint'`, with a comment in the file saying as much, and `coverage.yml` is push-only too. A fork PR there runs `main.yml` and `playground.yml` and nothing else
- Impact on open-steamgate: our first core fix, `fix/arithmetic-calculation-type`, cannot arrive with the evidence a transpiler PR arrives with. The mitigation is to run `.github/regression/run.js` locally, which is what the workflow does — build the CLI before and after and compare across real repositories — and put the result in the PR body. Roughly a thirty-minute job and it needs the network
- Smallest safe workaround: the fork `oisee/abaplint` exists as of 2026-09-14 and #4291 came from it. Asking Lars for push access would be better, since it is the only way the regression evidence can arrive with the pull request rather than pasted into it
- Upstream issue: none; nothing to file, this is about our access
- Regression-test location: `npm run parked` prints the constraint against each repository, so nobody has to remember which of the two rules applies
- Upstream version containing a fix: `n/a`

### ANOMALY-2026-09-14-arithmetic-typed-as-character — Arithmetic with a character literal is typed by the literal

- Status: `PR open: abaplint/abaplint#4293`
- Discovery date: `2026-09-14`
- Affected versions: `@abaplint/core 2.120.50`
- Affected ABAP statement, runtime API or adapter: the inferred type of `DATA(x) = <arithmetic expression>`
- Minimal ABAP reproducer:

```abap
DATA lv_f TYPE f.
DATA(a) = lv_f * '0.25'.   " typed Character(4), should be f
DATA(b) = lv_f + '0.25'.   " typed Character(4), should be f
DATA(c) = lv_f * 2.        " typed f, correct
```

- Exact command used to run it: transpile and read the `let` line in the output; found by open-steamgate driving vivid-vibes, stack `Float.set` ← `Table.cloneRow` ← `APPEND` ← `zcl_o4d_sales_dance=>get_dancing_values`
- Expected SAP behaviour: the result of an arithmetic expression is never character-like. With an operand of type `f` the calculation type is `f`; a character operand is converted into it, it does not become the result type
- Actual open-abap behaviour: the inline declaration takes the character literal's type **and its length**, so `sin( x ) * '0.25'` yields `c(4)` and `lv_pulse * '0.3'` yields `c(3)`. An integer literal does not do this
- Impact on open-steamgate: two ways, and the quiet one is worse. Loud: appending such a variable to a table of `f` raised `CX_SY_CONVERSION_NO_NUMBER` and killed her channel at bar 6. Quiet: the value is truncated to the literal's length, so her dance bars were computed from `9,4` instead of `9.4983552631578956` — right shape, two significant digits, no complaint from anything
- Smallest safe workaround: `CONV f( '0.25' )` in the expression, or declare the variable rather than inferring it
- Upstream issue: **PR [abaplint/abaplint#4293](https://github.com/abaplint/abaplint/pull/4293)**, opened 2026-09-14 from the fork `oisee/abaplint`, rebased on #4290. This is `@abaplint/core`, not the transpiler: the transpiler asks the scope for the variable's type and faithfully emits the answer it gets. Reproduced independently by open-steamgate on 2026-09-14 with a fourth line that narrows it: `DATA(d) = lv_f * CONV f( '0.25' ).` gives `f`, so it is the bare character literal, not the mixed arithmetic. Two cases wider than the report, both found while fixing: `lv_f * lv_c` with a character **variable** gave `Character(10)`, and `lv_p * '0.25'` gave a character field rather than packed
- What the fix does: `Source.runSyntax` walked the operands and let each one replace the running context, so the last operand won. It now records that an `ArithOperator` has been seen and from that point combines rather than replaces, using ABAP's calculation type — decfloat34, decfloat16, f, p, int8, i — with character-like operands transparent. Outside arithmetic nothing changes, and the concatenation path still returns `StringType`. Conservative in two places: when neither operand is numeric the previous behaviour stands, and a void or unknown operand wins, because not knowing an operand means not knowing the result
- Verification: abaplint core's own suite, 10977 passing and none failing before, 10984 and none failing after, lint clean. Seven new tests in `basic_variables`, five of which fail without the change; the other two are the cases that were already right and could plausibly have broken
- Regression-test location: none here; belongs upstream
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-14-float-separator-not-inverse — A float could not read back what it had just written

- Status: `fixed locally, PR parked`
- Discovery date: `2026-09-14`
- Affected versions: `@abaplint/runtime 2.13.86`
- Affected ABAP statement, runtime API or adapter: `Float.get`/`Float.set`, `DecFloat34.get`/`DecFloat34.set`, so any move of a float through a character field
- Minimal ABAP reproducer:

```abap
DATA float TYPE f.
DATA ch TYPE c LENGTH 30.
DATA back TYPE f.
float = '9.79440789'.
ch = float.      " 9,7944078900000004E+00
back = ch.       " CX_SY_CONVERSION_NO_NUMBER
```

- Exact command used to run it: `npx mocha build/test/types/float.js`; found by open-steamgate from a trace line that showed the comma one field before the exception
- Expected SAP behaviour: the pair round-trips. SAP localises the decimal separator on the way out and accepts it on the way back
- Actual open-abap behaviour: `get()` wrote a comma and `set()` accepted only a point. `DecFloat34` was worse and silent: `parseFloat` stops at the comma, so reading back `9,79440789` gave `9` with no error
- Impact on open-steamgate: this is what turned the type defect above into a dead channel rather than a wrong number. Her page reported it as "Disconnected", because a client cannot tell a handler that raised from a network that dropped
- Smallest safe workaround: none needed now
- Upstream issue: none yet, branch `fix/float-separator` in `abaplint/transpiler`. `set()` accepts both separators — the comma because that is what `get()` writes, the point because ABAP source literals carry one and `CONV f( '0.25' )` is everywhere. `get()` is unchanged: `test/statements/write.ts:209` asserts the comma at ABAP level, so the output side was verified against a system
- Regression-test location: `test/types/float.ts` (round trip, point still a point, `'1,2,3'` still raises) and `test/types/decfloat34.ts`
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-14-exception-without-text — An exception raised by the runtime has no text

- Status: `open`
- Discovery date: `2026-09-14`
- Affected versions: `@abaplint/runtime 2.13.86`
- Affected ABAP statement, runtime API or adapter: `throw_error.ts`, so every exception the runtime raises itself — `CX_SY_CONVERSION_NO_NUMBER`, `CX_SY_ZERODIVIDE` and the rest
- Minimal ABAP reproducer: catch any runtime-raised exception and call `get_text( )`
- Exact command used to run it: open-steamgate's channel log, which printed a line with a blank where the reason should be
- Expected SAP behaviour: a system exception carries a text from its message class
- Actual open-abap behaviour: `throwError` does `throw new abap.Classes[name]()` without calling `constructor_`, so the object is never constructed and has no text. Not a blank reason — an unconstructed exception
- Impact on open-steamgate: a log line with an empty cause, which reads as "the reason was nothing" and is worse than silence. Three runs told them only that something had failed. Their logger now names the exception class and says when there is no text, which is the right defence regardless
- Smallest safe workaround: log the class name rather than the text
- Upstream issue: none yet. The fix wants an async `constructor_` in a synchronous throw path, which is a deliberate change rather than a quick one
- Regression-test location: none
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-14-sy-tabix-hashed — `sy-tabix` is a row number in a loop over a hashed table

- Status: `fixed locally, PR parked`
- Discovery date: `2026-09-14`
- Affected versions: `@abaplint/runtime 2.13.86`
- Affected ABAP statement, runtime API or adapter: `LOOP AT` over a hashed table, and `LOOP AT ... USING KEY` with a hash secondary key
- Minimal ABAP reproducer:

```abap
DATA lt TYPE HASHED TABLE OF ty WITH UNIQUE KEY id.
LOOP AT lt INTO DATA(ls).
  lv_out = lv_out && |{ sy-tabix }|.   " 123, a system writes 000
ENDLOOP.
```

- Exact command used to run it: `npx mocha build/test/statements/loop.js`
- Expected SAP behaviour: `000`. A hashed table has no row order, so ABAP reports no position rather than inventing one
- Actual open-abap behaviour: `123`. A position that looks usable and is not
- Impact on open-steamgate: compounded with [[ANOMALY-2026-09-13-sy-tabix-not-restored]] in her `send_megademo`. Her `gt_registry` is `HASHED TABLE OF REF TO zcl_o4d_demo`, so an inner loop over it both invented an index and kept it. Restoring already made her caller correct; this makes the value itself correct for anyone who reads it
- Smallest safe workaround: do not read `sy-tabix` in a loop over a hashed table, which is also the rule on a system
- Upstream issue: none yet, branch `fix/sy-tabix-restore` in `abaplint/transpiler`, alongside the restore fix, since the two are siblings and one test file covers both
- Regression-test location: `test/statements/loop.ts`, two cases: hashed gives `000`, sorted still gives `12`
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-13-sy-tabix-not-restored — An inner loop keeps the outer loop's `sy-tabix`

- Status: `fixed locally, PR parked`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/runtime 2.13.86`
- Affected ABAP statement, runtime API or adapter: `LOOP AT` and `sy-tabix`
- Minimal ABAP reproducer:

```abap
LOOP AT lt_outer INTO DATA(lv_o).
  LOOP AT lt_inner INTO DATA(lv_i).
  ENDLOOP.
  lv_out = lv_out && |{ sy-tabix }|.
ENDLOOP.
```

- Exact command used to run it: `npx mocha build/test/statements/loop.js` in the transpiler checkout; found by open-steamgate driving vivid-vibes' `send_megademo`
- Expected SAP behaviour: `123`. A loop owns `sy-tabix` only while it runs; leaving it, by `ENDLOOP` or `EXIT` or `RETURN` or an exception, restores what the enclosing loop had
- Actual open-abap behaviour: `333`. The inner loop leaves its own last index behind, so the outer body reads the inner loop's row number as its own
- Impact on open-steamgate: her `send_megademo` calls `zcl_o4d_demo=>get( )` in the loop body, which walks its own table, and then writes a separator when `sy-tabix > 1`. The separators land wrong, and the frame is a JSON array that is well formed everywhere except one character. Nothing on our side reports anything; the browser says `Expected ',' or ']' after array element in JSON at position 236`. Same family as the day's other findings: output that is valid-looking, plausible, the right size, and wrong
- Smallest safe workaround: read `sy-tabix` into a variable as the first statement of the loop body, before anything that might loop
- Upstream issue: none yet, branch `fix/sy-tabix-restore` in `abaplint/transpiler`, commit `be5d4db9`. Save on entry, restore in the `finally` that already runs, so every exit path is covered by construction. Full suite 2224/133 before, 2227/130 after, and the three that moved are the new tests
- Regression-test location: `test/statements/loop.ts`, three cases: nested, inner loop left with `EXIT`, and a method that loops called from a loop
- Upstream version containing a fix: `unknown`

### DEBT-2026-09-13-runtime-not-linked — The transpiler is linked from our clone, the runtime is not

- Status: `open`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/transpiler-cli` linked, `@abaplint/runtime 2.13.86` published
- Affected ABAP statement, runtime API or adapter: none; a build-topology note
- Minimal ABAP reproducer: none
- Exact command used to run it: `ls -la node_modules/@abaplint/`
- Expected SAP behaviour: n/a
- Actual open-abap behaviour: only `transpiler-cli` is a symlink into `~/dev/transpiler`; `@abaplint/runtime` in each consuming tree is the published copy. So a fix in `packages/transpiler` or `packages/cli` reaches a rebuild immediately and a fix in `packages/runtime` does not, and the two feel identical from the outside. The `sy-tabix` fix above is a runtime fix and is therefore *not* in any running demo
- Impact on open-steamgate: a fix can be reported as done and still be absent from the process that needed it. Whoever wants a runtime fix locally has to link `@abaplint/runtime` too, deliberately, and say so here
- Smallest safe workaround: `npm run runtime:local`, which symlinks the path directly. **Not `npm link`**: that resolves through the global npm directory, a third place with its own idea of which checkout is current. open-steamgate linked the runtime that way on 2026-09-13 and got commit `1889911` beside a CLI at `058df744` — two checkouts in one tree, both `package.json` files saying `2.13.86`, nothing on the surface able to tell them apart. `transpiler:which` printed the two commits side by side and that is how it was found
- Third thing, and the one with no tool behind it: a checkout can also be pointed at an **unreleased abaplint**, which `transpiler:which` does not report because it only looks at the transpiler and the runtime. Done once on 2026-09-14 to check whether `abaplint/abaplint#4290` made the test in `abaplint/transpiler#1842` pass before its release — it did, and it also showed the test would still have been red for an unrelated reason, which is why it was worth doing. The recipe, and the trap in it: replace the worktree's `node_modules` symlink with a real directory symlinking every package except `@abaplint/core`, point that at the abaplint clone, **and do the same for `packages/extras`**, which has a second copy of core; then check all four resolution points agree before believing anything. Reverted immediately afterwards
- Second thing a linked tree does that a clean clone does not: **it changes under you**. The transpiler checkout is shared, and on 2026-09-13 open-steamgate measured all four CLI/runtime combinations while this session had HEAD briefly on a branch off `main` for an unrelated PR. Three of the four rows were real; the fourth said the two fixes could not coexist, and was reading a moved HEAD. Whoever moves that HEAD says so first
- Upstream issue: none; this is ours. Related: `DEBT-2026-09-13-linked-transpiler`
- Regression-test location: `tools/osd-transpiler.mjs` now prints both, and `npm run transpiler:which` says in two lines which transpiler wrote the code and which runtime will execute it. That is the check; it does not make the two match, it makes the mismatch visible. `npm run runtime:local` links the runtime deliberately, the same way `transpiler:local` does
- Upstream version containing a fix: `n/a`

### ANOMALY-2026-09-13-xstring-as-hex — An xstring costs two characters per byte, twice over

- Status: `open`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/runtime 2.13.86`
- Affected ABAP statement, runtime API or adapter: `xstring` itself, and anything that moves a large one: `WWWDATA_IMPORT`, `SCMS_BINARY_TO_XSTRING`, a media response
- Minimal ABAP reproducer: read a four megabyte W3MI object and send it as a response
- Exact command used to run it: open-steamgate serving her 4 MB MP3 through the SMW0 chain, measured over twenty-four requests
- Expected SAP behaviour: an xstring is bytes and costs bytes
- Actual open-abap behaviour: the runtime carries an xstring as a hex string, two characters to the byte, and the SMW0 path holds it twice at once, once sliced into a table and once joined back. Serving 4 MB costs about 24 MB of transient strings per request; the heap goes 744 MB to 901 MB over twenty-four requests and then flattens, so it is a plateau rather than a leak
- Impact on open-steamgate: nothing breaks. It is the reason a media-heavy page is expensive rather than cheap, and it will be the reason the browser bundle is heavy when the media go into it
- Smallest safe workaround: none worth having. Reading the file from disk instead was considered and rejected, because `WWWDATA_IMPORT` has to return a table the caller loops over and her CCP class does exactly that
- Upstream issue: none. The real fix is an xstring carried as a byte buffer rather than a hex string, which is the open-abap runtime's shape rather than something a caller can route around, and it is a large change. Recorded because the number is worth having before someone diagnoses it as a leak
- Regression-test location: none
- Upstream version containing a fix: `unknown`

### DEBT-2026-09-13-linked-transpiler — This tree may be built by a transpiler that is not published

- Status: `accepted, with a banner`
- Discovery date: `2026-09-13`
- What it is: four transpiler defects found on oisee/vivid-vibes are fixed in a local branch of `abaplint/transpiler` (`fix/conv-builtin-type`) and not released. `npm link @abaplint/transpiler-cli` puts that build in a tree, which is what makes SMW0 content, the vivid-vibes effects and anything else those four fixes touch work at all
- The cost, said plainly: a linked tree differs from a clean clone, so `npm test` can be green here and red in CI, and nothing about the repository says why. That is the same failure the W3MIMETABTYPE hunt cost a morning on, and it is worth having a rule about rather than a memory
- What keeps it honest: every transpile prints which transpiler produced it, published or local, and a local one prints the path, the branch and the commit (`tools/osd-transpiler.mjs`, first line of `npm run transpile`). `npm run transpiler:which` answers on demand. So a green run here and a red one in CI are one line apart from being explained rather than a mystery
- How to switch: `npm run transpiler:local` links the local build, `npm run transpiler:published` puts the released one back. `npm ci` and `npm install` silently drop the link, which the banner then says
- Who is on it: the transpiler session's tree is linked; open-steamgate's is its own choice
- How it ends: four pull requests upstream, one per fix, at which point the link comes out and this entry moves to the resolved section. The four are recorded above with their reproducers
- Upstream issue: none yet, deferred by Alice 2026-09-13

### ANOMALY-2026-09-13-binary-file-to-output — A binary file is corrupted on the way to output

- Status: `fixed locally, PR parked`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/transpiler-cli 2.13.86`
- Affected ABAP statement, runtime API or adapter: the CLI's copy of non-ABAP files, `FileOperations.readAllFiles` and `writeFiles`
- Minimal ABAP reproducer: none; put a PNG in a W3MI object and transpile
- Exact command used to run it: `abap_transpile` on a tree with `*.w3mi.data.png`
- Expected SAP behaviour: n/a, a tooling defect. The bytes that went in should come out
- Actual open-abap behaviour: the file was read and written as UTF-8, so every byte above 0x7F became the replacement character: an 11770-byte PNG arrived as 20175 bytes and no image. Nothing reported an error, because a corrupted PNG is a perfectly valid file
- Impact on open-steamgate: every image and every sound in her demo. It is the reason the media chain could not be tested end to end until it was fixed
- Smallest safe workaround: none; exclude the binary objects from the transpile and copy them by hand
- Upstream issue: none yet, branch `fix/binary-file-copy`. Files matching `\.(w3mi|smim)\.data\.` are read and written as `latin1`. `binary` was measured against `latin1` on Node and Bun and is the same alias, so the plainer name is used
- Regression-test location: `packages/cli` — the fix is in `file_operations.ts`; the end-to-end proof is open-steamgate serving the 11770-byte PNG byte-identical through the whole ABAP chain
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-13-percent-in-filename — A percent in a file name is not escaped in the import specifier

- Status: `fixed locally, PR parked`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/transpiler 2.13.86`
- Affected ABAP statement, runtime API or adapter: not ABAP — any object whose abapGit file name carries a percent, which is every W3MI (Web Repository) object, because abapGit encodes the dot of `ZO4D_06_PLASMA.PNG` as `zo4d_06_plasma%2epng`
- Minimal ABAP reproducer: none needed; a file named `a%2eb.mjs`, imported as `./a%2eb.mjs`, is `ERR_MODULE_NOT_FOUND`, and as `./a%252eb.mjs` it is found
- Exact command used to run it: `npx abap_transpile` over a repository with any SMW0 image, then `node output/init.mjs`
- Expected SAP behaviour: n/a — a runtime resolution rule, not a SAP one. A module specifier is a URL and is percent-decoded before it resolves, so a percent in a name has to be escaped as `%25`
- Actual open-abap behaviour: `init.mjs` throws `ERR_MODULE_NOT_FOUND` at boot with the module sitting beside it, so adding an image to a build takes the whole runtime down: the ADT façade and the OData front never start, not only the images
- Impact on open-steamgate: found by open-steamgate on oisee/vivid-vibes, whose media are W3MI objects. Nothing of ours carries a percent today
- Smallest safe workaround: exclude `\.w3mi\.` from the transpile, which is what the vivid-vibes staging did until this was fixed
- Upstream issue: none yet, branch `fix/percent-in-filename`. The percent is escaped before the slash in `escapeNamespaceFilename`, and the order matters because escaping it afterwards would corrupt the `%23` the same function writes for a namespace. Both specifier writers and the CLI's `sourceMappingURL` use it
- Regression-test location: the transpiler's `test/files.ts`, local branch
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-13-w3mi-objid-encoded — The W3MI registry is keyed on the encoded file name, not the object name

- Status: `fixed locally, PR parked`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/transpiler 2.13.86`
- Affected ABAP statement, runtime API or adapter: `SELECT ... FROM wwwparams WHERE objid = ...` and the W3MI registry the transpiler generates
- Minimal ABAP reproducer: a W3MI object whose name carries a dot; read it back with the name that is in `<NAME>` in its own XML
- Exact command used to run it: reading an image through a handler that follows SAP's own API shape
- Expected SAP behaviour: **the plain name**, the one in `<NAME>`. Answered on 2026-09-13 by open-steamgate from the artefact rather than from a system: her page asks for `?audio=ZOISEE-EAR-02.MP3`, her handler passes that straight to `objid`, and that code runs on a real system. Evidence of that grade rather than a read of `wwwparams` on A4H, which is still worth one line the next time someone is on a system with Alice's say-so
- Actual open-abap behaviour: the registry and the `wwwparams` rows are keyed on the encoded name, `ZOISEE-EAR-02%2EMP3`, while the object's own XML carries `ZOISEE-EAR-02.MP3`, so a handler that asks the way SAP's API is asked finds nothing and returns empty rather than failing. The percent-escape is an abapGit filename spelling that should never have become a key
- Impact on open-steamgate: this is what stops the audio in the running demo. The images work only because they were asked for by the encoded name while testing, which is the failure mode in miniature: the wrong key looks like a working one until someone uses the right one
- Smallest safe workaround: ask with the encoded name
- Upstream issue: none yet, branch `fix/w3mi-objid` in `abaplint/transpiler`. The registry, `wwwparams` and `tadir` are all keyed on `<NAME>` now. Corrected 2026-09-14: this was the transpiler's code all along, not open-steamgate's, and saying otherwise nearly left it unowned
- Regression-test location: none
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-13-default-ignore — `DEFAULT IGNORE` is parsed and not honoured, and the project cannot switch the rule off

- Status: `PR open: abaplint/abaplint#4291`
- Discovery date: `2026-09-13`
- Affected versions: `@abaplint/core 2.120.5`, `@abaplint/transpiler-cli 2.13.86`
- Affected ABAP statement, runtime API or adapter: `METHODS m DEFAULT IGNORE` / `DEFAULT FAIL` in an interface
- Minimal ABAP reproducer: an interface with one `DEFAULT IGNORE` method and a class that implements the interface and not that method
- Exact command used to run it: `npx abaplint`, then `npx abap_transpile`
- Expected SAP behaviour: a class need not implement an optional interface method; calling it does nothing (`IGNORE`) or raises (`FAIL`)
- Actual open-abap behaviour: `implement_methods` demands it anyway, and turning the rule off in `abaplint.jsonc` changes nothing for the transpile, which runs its own mandatory rule set rather than the project's
- Impact on open-steamgate: none of ours; found by open-steamgate on vivid-vibes, where an interface grew two methods and fifty implementors were never updated. It is the reason the repository needs 154 written-out implementations rather than two words in the interface
- Smallest safe workaround: implement the method with an empty body, which is what the patch for that repository does
- Upstream issue: **PR [abaplint/abaplint#4291](https://github.com/abaplint/abaplint/pull/4291)**, opened 2026-09-14 from the fork `oisee/abaplint`, since we cannot push a branch there. The cause was a layer below the rule: `InfoMethodDefinition` did not carry the modifier at all, so `implement_methods` had nothing to read. Two fields beside `isForTesting` and `isFinal`, and the rule skips a method that has either; `DEFAULT FAIL` is included because it is equally optional to implement. Reproduced independently by open-steamgate on 2026-09-14 with a control: removing `DEFAULT IGNORE` gives the identical message, so `implement_methods` does not read the modifier at all, although the parser understands it (`method_def.js`, 7.40 SP08)
- Regression-test location: none
- Upstream version containing a fix: `unknown`

## Resolved anomalies

(none yet)

### ANOMALY-2026-09-12-transpiler-concat-chain — An `&`/`&&` chain nests one concat( ) call per operand

- Status: `workaround`
- Discovery date: `2026-09-12`
- Affected versions: `@abaplint/transpiler-cli 2.13.85`
- Affected ABAP statement, runtime API or adapter: `a & b & c ...` (also `&&`), `abap.operators.concat`
- Minimal ABAP reproducer: the `IF_SADL_GW_DPC_UTIL~GET_DPC` segw-gen writes for a project with many entity sets (`gen/stg/zstg_segw/zcl_zstg_segw_dpc.clas.abap`, 55 sets, ~830 operands)
- Exact command used to run it: `npm run e2e:preview` (the service worker refuses the bundle: "ServiceWorker script evaluation failed", CDP says "Maximum call stack size exceeded"; Node and a dedicated worker parse the same file)
- Expected SAP behaviour: a chain of any length is one string expression
- Actual open-abap behaviour: `concat(a, concat(b, concat(c, ...)))`, one nesting level per operand; the runtime already accepts `concat([a, b, c])` (used for constant chains) but the Source transpiler does not emit it
- Impact on open-steamgate: the browser preview (GitHub Pages) fails to install its worker once any transpiled class carries a chain of ~800 operands
- Smallest safe workaround: `tools/segw-gen.mjs` builds a SADL definition longer than `SADL_CHUNK` (200) lines in pieces (`lv_sadl_xml = lv_sadl_xml & ...`); every SAP project we have is shorter (85 max), so their generated classes are unchanged
- Upstream issue: PR "Source: flatten & / && chains into concat([...])" from `oisee/transpiler`
- Regression-test location: `test/e2e/preview.spec.mjs` (the preview installs), `test/stg-compile.mjs`
- Upstream version containing a fix: `unknown`

### ANOMALY-2026-09-13-bun-percent-encoded-specifier — Bun does not decode `%23` in an ESM specifier

- Status: `workaround`
- Discovery date: `2026-09-13`
- Affected versions: `bun 1.4.2`, `@abaplint/transpiler-cli 2.13.86`
- Affected ABAP statement, runtime API or adapter: not ABAP — the transpiled output of any `/NAMESPACE/`-prefixed object, whose file name carries `#` and whose importers write it percent-encoded (`await import("./%23iwbep%23cl_mgw_data_util.clas.mjs")`)
- Minimal ABAP reproducer: none needed; two files, `mod.mjs` renamed to `#h#mod.mjs`, imported once as `"./%23h%23mod.mjs"` and once as `"./#h#mod.mjs"`
- Exact command used to run it: `node enc.mjs` / `bun enc.mjs` (percent-encoded) and `node lit.mjs` / `bun lit.mjs` (literal)
- Expected SAP behaviour: n/a — this is a runtime divergence, not a SAP one. Node resolves the percent-encoded form and refuses the literal; Bun does the exact opposite, so no single specifier satisfies both
- Actual open-abap behaviour: under Bun the run dies at the first such import with `Cannot find module "./%23iwbep%23cl_mgw_data_util.clas.mjs"`. 99 files in `output/` carry a `#` today
- Impact on open-steamgate: nothing today (we run Node); it blocks the whole Bun path, so it blocks `bun build --compile` and any single-binary packaging of the OSD
- Smallest safe workaround: rename `#` out of the file names in a copy of `output/` and apply the same substitution inside relative `./*.mjs` specifiers (`.local/dehash.mjs`, ~20 lines, 99 renames and 22 rewrites). With it Bun runs the same 107 ABAP Unit tests as Node and serves the gateway over HTTP; see `docs/bun-spike.md`
- Upstream issue: https://github.com/abaplint/transpiler/issues/1841 (open 2026-09-13, filed by the transpiler session, this spike cited as the evidence). Traced to `escapeNamespaceFilename` in `packages/transpiler/src/initialization.ts` and the source-map line in `packages/cli/src/index.ts`, both of which write `/` as `%23`. Filed as an issue rather than a patch because changing the character changes every mapping from a file back to an object name, so the choice is Lars's; `$`, `-` and `_` are the candidates that need no encoding anywhere. A Bun issue for the specifier decoding is the other half and is not filed
- Regression-test location: none
- Upstream version containing a fix: `unknown`
