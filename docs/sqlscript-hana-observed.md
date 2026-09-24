# What HANA actually does, measured

*The engine's own answers, for the SQLScript splitter
([`sqlscript-splitter.md`](sqlscript-splitter.md)) and the conformance table.
Run on HANA Express through the AMDP sandbox, 2026-09-19. Everything here is
a measurement; where it contradicts something we assumed, the assumption is
named.*

## 1. Is an assignment to a table variable an observable barrier?

The question decides the shape of the whole intermediate representation: if
an assignment is a barrier, a lowering must materialise at each one; if it is
not, splicing is not a liberty an optimiser takes but the semantics of the
language.

The probe is three steps: a projection that can fail (`TO_INTEGER` over a
column holding one non-numeric row), a filter that removes the failing row,
and an observation.

| what was run | HANA Express answered |
| --- | --- |
| the failing cast, observed directly | **raises** `invalid number` |
| assign, then filter, then observe | **two rows**, no error |
| the same with `WITH HINT(NO_INLINE)` | **raises** `invalid number` |
| assign, then read the variable **twice** | **two rows**, no error |

**An assignment is not a barrier.** The default answer is rows: the filter is
pushed into the projection and the failing expression is never evaluated. So
a lowering that materialises every assignment would not be "faithful to
HANA" -- it would be **wrong in the expensive direction**, computing values
HANA never computes and paying for temporary tables HANA never builds.

**And the exception is a property of the plan, not of the program.** The
third row is the finding: one hint, no change to code or data, turns a
successful run into a failure. `NO_INLINE` is the documented way to ask HANA
*not* to inline, and asking produces the exception that inlining avoided.

Two consequences, and the second is uncomfortable:

- **The conformance table must compare values, not exceptions.** If HANA's
  own answer to "does this raise?" depends on a hint -- and, since inlining
  is heuristic, on the plan the optimiser happens to choose -- then byte
  faithfulness on exceptions is unattainable **for anyone, including HANA
  against itself on another day**. This was predicted as the third possible
  outcome before the probe was run, which is the reason to trust it.
- **"Materialise when a variable is read more than once" is not HANA's
  rule.** The fourth row was designed to push the optimiser towards
  materialising and did not: reading `:lt_cast` twice still produced rows
  rather than the exception. Whatever makes HANA materialise, a second read
  is not enough on its own, so our planned heuristic cannot be justified by
  calling it what HANA does.

### What this does not say

- One version of one engine, on a single-node HANA Express with small tables.
  Inlining is heuristic and the heuristic is free to differ with statistics,
  table size and release.
- It says nothing about *which* plan HANA picks, only that two plans exist
  and that they differ in whether an exception is observed.
- `#src` here is a local temporary column table, not a real application
  table; a projection over a large partitioned table may be planned
  differently.

## 2. Notes for the probes that follow

The sandbox holds its HANA session across calls, so a `CREATE LOCAL TEMPORARY
TABLE` survives into the next body and a fixed name collides with itself on
the second run -- which is how the first attempt at the table above failed,
with an error about a duplicate table name that looked like a defect in the
body under test. Every probe gives its temporary tables a name of their own.

## 3. Is the trailing blank stored at all?

fable-osd's hypothesis, 2026-09-19, and it is the cheapest thing measured all
day: the padding of a CHAR column may live in **our data** rather than in the
expressions, in which case the four conformance rows about padding are one
decision at the write boundary rather than four compatibility functions.

Measured on **A4H**, which is a real ABAP system on HANA -- not a probe of
our own writing, which is the point:

| | |
| --- | --- |
| `TADIR-DEVCLASS` in DDIC (`DD03L`) | `CHAR`, length **30** |
| `SELECT LENGTH(devclass) ... WHERE devclass = '$TMP'` | **4** |
| `SELECT COUNT(*) ... WHERE devclass = '$TMP' AND LENGTH(devclass) = 4` | **12132 rows** |

The second form matters more than the first: the predicate is evaluated in
the database, so 12132 rows come back only if HANA itself agrees the stored
value is four characters long. A value trimmed on the way out by the ABAP
layer could not satisfy a filter the database applied.

**So a real ABAP system on HANA does not store the trailing blanks**, and the
local engines' agreement with each other -- `LENGTH` 10, `'abc       |'`,
a padded column not equal to its unpadded literal -- is agreement about a
value that a real system would never have written.

### What follows, and it is cheaper than the alternative

The correct local behaviour is **not to write the padding**, rather than to
emulate trimming inside `CONCAT`, `SUBSTR`, `LENGTH` and every comparison.
One rule at the write boundary for CHAR columns, and four of the five real
conformance differences collapse on their own, leaving the arithmetic family
(browser engine only) and the refusal for casts that cannot fail.

### The limits of this one

- One column of one table on one system. The rule "ABAP CHAR is stored
  unpadded on HANA" is what the evidence supports; whether anything in the
  stack ever stores a padded CHAR deliberately is not settled by it.
- It says nothing about what our own runtime currently writes -- that is the
  thing to change, and changing it is a data-shape change, so it needs its
  own check that nothing reads the padding on purpose.

## 4. Where the padding comes from, and who reads it on purpose

The one unmeasured thing in the plan (fable-osd): "do not write the padding"
is a change of data shape, so before making it — is there anything that reads
the padding deliberately? Measured rather than reasoned about, and the answer
has two halves.

**The padding is not ours. It is the runtime's type.**

```
Character(10).set("abc")  ->  "abc       "   (length 10)
```

`@abaplint/runtime`'s `Character` pads to the declared length on assignment,
which is correct — an ABAP `CHAR(10)` *is* ten characters in memory. So every
value an ABAP program hands to a database client is already padded before any
client of ours sees it. `test/seed.mjs` says so in its own comment and pads to
match; it is following the runtime, not inventing anything.

**And something does read it on purpose — upstream.** The transpiler's SQLite
schema generator emits

```
NCHAR(n) COLLATE RTRIM
```

That collation exists precisely *because* the padded value is stored: it makes
comparisons ignore trailing blanks, papering over the difference that storing
the padding creates.

**So the rule belongs exactly where the real kernel puts it.** On A4H, ABAP
holds `CHAR(30)` padded in memory and HANA stores four characters (section 3).
A real system therefore trims on the way **to** the database, not in memory
and not in every expression. Our clients currently store what they are given,
which is the padded form, and that is the single divergence.

Consequences, stated so the cost is not discovered later:

- The change is **per client, at the write boundary** — the same place
  `trimLiterals` already trims literals in the HANA and DuckDB clients. It is
  not a change to `Character`, which is right as it is.
- Upstream's `COLLATE RTRIM` becomes harmless rather than wrong: with nothing
  padded stored, there are no trailing blanks for it to ignore.
- It is still a data-shape change, so it needs its own before-and-after on a
  real read path rather than only on the conformance fixture.

**Why it is safe, as a reason rather than a hope** (fable-osd): the circle
closes by itself. The client trims on write, the database stores `"abc"`, and
on the way back the value lands in a `Character(10)` whose `set()` pads it to
ten again. The in-memory shape does not change at all -- only the stored one
does -- and ABAP already treats trailing blanks in a `CHAR` as insignificant.
The argument rests on exactly the runtime behaviour measured above.

**And the boundary that makes it dangerous, which has to be drawn before the
code is written: trim `CHAR`, never `STRING`.** In ABAP a `STRING`'s trailing
blanks are **significant** -- they are content, not padding. A rule that keys
on "the column is character-like" rather than on "the column is mapped from a
DDIC `CHAR`" would send `"abc   "` in a string field to the database as
`"abc"` and hand it back changed. No suite here would notice: the defect
looks like tidiness.

So the rule reads the **DDIC type, not the SQL type**, and it arrives with a
two-line test:

| | stored | read back |
| --- | --- | --- |
| `CHAR(10)` set to `"abc"` | 3 characters | 10 |
| `STRING` set to `"abc   "` | **6** | **6** |

If the second row is green the change is safe. Without that row we would
learn about it from the first person who has a significant blank in a string
field.

---

## Three more divergences, measured when CAST and LIKE were added (2026-09-19)

Adding two constructs to the grammar meant deciding how to render them on the
three engines. The decision was measured rather than argued, and all three
answers were surprising -- every one of them a **silent wrong answer** rather
than an error, which is the only kind that survives a test suite.

| probe | HANA | DuckDB | sql.js |
| --- | --- | --- | --- |
| `'ABC' LIKE 'abc'` | no match | no match | **match** |
| `CAST('abcdef' AS NVARCHAR(3))` | `abc` | **`abcdef`** | **`abcdef`** |
| `CAST(1.7 AS INTEGER)` | `1` | **`2`** | `1` |
| `CAST(-1.5 AS INTEGER)` | `-1` | **`-2`** | `-1` |
| `x LIKE 'A#_B' ESCAPE '#'` | as HANA | same | same |

The third row is the uncomfortable one. `tools/sqlscript-lower.mjs` had passed
casts through to DuckDB since the day the dialect was written, on the stated
grounds that "it raises like HANA, so it passes through". It does raise like
HANA. It also **rounds** where HANA **truncates**, and nothing had ever asked.
The test that covered that line asserted the text of the pass-through, so it
was green for exactly as long as the divergence existed -- a test can hold a
defect in place as easily as it can catch one, when it asserts what the code
does instead of what the engine does.

### What was written, after measuring the fix back against HANA

| | HANA | DuckDB | sql.js |
| --- | --- | --- | --- |
| cast to `INTEGER` | `CAST(x AS INTEGER)` | `CAST(TRUNC(CAST(x AS DOUBLE)) AS INTEGER)` | refused: cannot raise |
| cast to `CHAR(n)` | `CAST(x AS NVARCHAR(n))` | `SUBSTR(CAST(x AS VARCHAR), 1, n)` | same as DuckDB |
| `LIKE` | pass through | pass through | pass through, **and the connection sets a pragma** |

The DuckDB integer cast still raises on a value that will not convert, which
was checked and not assumed: `CAST('x' AS DOUBLE)` raises before `TRUNC` ever
sees it. Six probes, all six agreeing with HANA, before the renderings were
written down.

`LIKE` is the one where the fix does not live in the dialect. SQLite's `LIKE`
is case-insensitive for ASCII unless `PRAGMA case_sensitive_like = ON`, which
is connection-scoped and survives transactions (measured). So the two SQLite
native channels -- `tools/sqljs-native.mjs` and `tools/sqlite-file-client.mjs`
-- set it when they open, and the dialect passes a `LIKE` straight through on
the strength of that. A per-statement workaround was the alternative and it
would have had to be right in every future statement; a connection that means
the same thing by `LIKE` as HANA does has to be right once. It also makes the
emulation more faithful everywhere else, because Open SQL's `LIKE` on a real
system is case-sensitive too.

## The oracle answered every row, and seven of fifteen were one decision

*2026-09-19. The HANA column had owed fifteen rows for three sessions. It was
not laziness: `runHana()` carried its own copy of the fixture DDL, two
columns were added to the other two engines for the LIKE and narrow-cast
rows, and HANA's table kept the old thirteen. The next `--hana` run did not
skip those rows -- it failed on the INSERT and **lost the entire column**,
which reads exactly like "nobody has run it yet". One column list now writes
all three DDLs, and a count of values per row fails where the mistake is
made rather than five minutes into a run on another machine.*

With all 33 rows measured on HANA 2.00.088, against the fixture as our
runtime writes it today:

| engine | differs from HANA, padded | differs from HANA, unpadded |
| --- | --- | --- |
| DuckDB | 11 | 4 |
| sql.js (browser) | 15 | 8 |
| node:sqlite (server) | 15 | 8 |

**Seven divergences per engine are one decision.** `concat_padded`,
`substr_padded`, `length_padded`, `char_equals`, `fn_upper`, `fn_ltrim` and
`fn_min` all agree with HANA the moment the fixture stops padding. HANA holds
`'abc'` in an `NCHAR(10)` and answers `LENGTH` **3**: it does not store the
blanks, so every question asked about them differed for one reason and not
seven. The measurement is now on both sides of that boundary
(`--padded` asks the historical question now that the boundary is fixed),
which is what turns "we should stop padding" from a plan
into a number.

It also clears three names that were under suspicion. `UPPER`, `LTRIM` and
`MIN` are in the lowering's `PORTABLE` list, they differed from HANA on the
padded fixture, and they differ for the padding and not for themselves. The
list survives the oracle -- **measured**, which is the only way it was ever
going to be worth having.

Two rows are ours and remain open: `div_zero` (HANA raises; sql.js cannot,
by decision) and `cast_round` on DuckDB (answered in the dialect). `fn_log`
is not a divergence to fix -- it is the row that keeps the two SQLite
columns honest, and HANA's answer to it is a **refusal**: `LOG(10)` is
"wrong number of arguments", because HANA's `LOG` takes a base. That refusal
is also what found the last defect of the day: the table classified it as the
engine rejecting the **data**, because `normalise()` carried a second copy of
the "was the statement refused" predicate and only the copy in
`sqlscript-eager.mjs` had ever been taught HANA's wording. Two copies of a
predicate is one predicate and one stale opinion.

## The padding was ours, and it was written in two of four clients

*2026-09-19, the other half of the finding above.* If HANA does not keep the
trailing blanks, the question is where ours came from -- and it came from the
write boundary, which had been implemented twice and skipped twice.

Measured, with the same ABAP-facing `insert` on each client:

| client | what `'abc       '` stored |
| --- | --- |
| `tools/duckdb-client.mjs` | 3 |
| `tools/hana-client.mjs` | 3 |
| `tools/sqlite-file-client.mjs` (**the deployed showcase**) | 10 |
| `@abaplint/database-sqlite` (**the default, and the browser**) | 10 |

So the system's own behaviour depended on `STG_DB`, and the two engines that
disagreed with a real system are the two that serve people. `trimLiterals()`
existed character-for-character in the DuckDB and HANA clients and nowhere
else; it is now `tools/sql-literals.mjs`, called by both SQLite clients too
-- the second of them through `installTrim()`, since the package is not ours
and wrapping it in `test/setup.mjs` reaches every host at once.

**Why it survived so long:** SQLite declares these columns `COLLATE RTRIM`,
so *comparisons* already ignored the padding. Comparisons were never the
question. `LENGTH`, `SUBSTR` and `||` see the blanks, and an application that
concatenates two CHARs got ten characters of one and three of the other
depending on which database it had been started with.

`npm run unit` and `npm run unit:file` are both green after it, which is the
evidence that mattered: the whole transpiled ABAP suite does not depend on
the padding it was being handed.

`test/write-boundary.mjs` is the guard -- the same write on every client,
asserted to store the same thing, with each engine demanded by name.

And the table now records **which fixture** a column was measured on.
Merging a padded HANA column into an unpadded run compares two different
questions and answers confidently; the two differ by seven rows, which is
exactly the size of a finding. It is refused, and the refusal names a flag
that exists.

## The whole table, counted both ways (2026-09-19)

The hypothesis was that the padding explains most of the list. Counting the
two recorded runs -- the same 39 cases, one fixture padded and one not, HANA
answering in both -- says how much, and the number is exact.

**HANA's own answer moved in 0 of 39 cases.** Hand it a padded value or an
unpadded one and it replies identically, which is the measurement the
hypothesis actually needed: it does not store the trailing blank, so there is
nothing for it to disagree about. Nine cases moved for everybody else.

| engine | agrees, padded | agrees, unpadded |
|---|---|---|
| DuckDB | 20 / 39 | 29 / 39 |
| sql.js | 18 / 39 | 27 / 39 |
| node:sqlite | 18 / 39 | 27 / 39 |

Nine up, for each of the three, and they are the same nine: `concat_padded`,
`substr_padded`, `length_padded`, `char_equals`, `fn_upper`, `fn_ltrim`,
`fn_min`, `agg_concat_ordered`, `agg_concat_unordered`. Every one of them
agrees with HANA once the fixture is unpadded. So the nine were never nine
divergences between engines -- they were **one decision at the write
boundary, counted nine times** by a list that asks nine questions about the
same stored byte.

### What is left is smaller than it looks, and has two kinds in it

Ten cases for DuckDB, twelve for the two SQLite builds. Counting them as one
number would overstate them, because two different things are in there:

- **Scale only** -- the same number, printed with a different number of
  decimals: `0.5` against `0.500000`, `3` against `3.0`, `2.35` against
  `2.350`, `1` against `1.000000`. Six for DuckDB, four for the SQLite
  builds. Numerically these agree. They are still worth a line, because a
  caller that compares the *text* of a result sees a difference where there
  is no difference in value -- which is the same trap as the padding, one
  layer up.
- **Genuinely different** -- integer division truncating (`0` against
  `0.5`), binary float against decimal (`0.30000000000000004`), a CAST that
  HANA refuses and SQLite answers `0` to, division by zero (raise against
  `Infinity` against `NULL`), case-sensitive `LIKE`, a CAST to `CHAR(3)` that
  HANA truncates and nobody else does, half-even against half-up rounding,
  and `LOG` with the wrong arity.

The second list is the real work, and it is eight entries rather than
twenty-two. Naming which is which is the point of counting both ways: a
remainder of "12 divergences" would have sent somebody to fix rounding
**presentation** at the same priority as integer division, and only one of
those can give a wrong answer to an application.

## What the kernel binds for a CHAR-like AMDP input (measured on A4H, 2026-09-23)

Measured with a throwaway `$TMP` class holding one AMDP procedure and a
program whose ABAP Unit test called it with three sets of values; each
answer was read back from the assertion text (`fail( quit = no )`), and
both objects were deleted afterwards. The procedure returned, per input,
`LENGTH(:iv)`, `'[' || :iv || ']'` and a few comparisons.

| ABAP parameter type | value passed | what the procedure sees |
| --- | --- | --- |
| `c LENGTH 3` | `'A'` | `A`, length 1 -- trailing blanks are gone |
| `c LENGTH 3` | initial | `''`, length 0, and **not NULL** (`IS NULL` false, `= ''` true) |
| `c LENGTH 3` | `' A'` | ` A`, length 2 -- a leading blank stays |
| `n LENGTH 3` | `'7'` / `'12'` / initial | `007` / `012` / `000` -- zero-padded to the length |
| `d` | initial | `00000000` (length 8), not `''` |
| `t` | initial | `000000` |
| `mandt` | `sy-mandt` | the logon client, equal to `SESSION_CONTEXT('CLIENT')` |
| `mandt` | initial | `''` |
| `string` | `` `A  ` `` / `` ` A` `` | `A  ` (length 3) / ` A` -- STRING keeps its blanks |
| `tabname` (CHAR 30) | `'T000'` | length 4, and `WHERE tabname = :iv` finds the DD02L row |

`'A'` and `'A  '` are one value for a `c` parameter; ABAP cannot tell them
apart, so the question was only ever what the kernel binds, and the answer
is the right-trimmed value. The last row is the one that matters for a
body: a dictionary CHAR column holds right-trimmed values too, so the
trimmed input compares equal to it under HANA's unpadded NVARCHAR
comparison.

What the portable runtime must do at the bind, therefore: CHAR-like inputs
(CHAR, CLNT, LANG, CUKY, UNIT) right-trimmed, never left-trimmed, the
initial value as `''` and not NULL; NUMC left-padded with zeros to its
length; DATS and TIMS as their fixed-width digits (`00000000` initial);
STRING unchanged. DuckDB and SQLite compare VARCHAR without padding, like
HANA, so with the trim at the bind no rewriting of comparisons is needed
(foreman-dell's DuckDB column: `'A  ' = 'A'` is false there).

## What the kernel binds for a RAW AMDP input (measured on A4H, 2026-09-23)

Same method: a throwaway `$TMP` class and an ABAP Unit driver, deleted
afterwards.

| ABAP parameter type | value passed | what the procedure sees |
| --- | --- | --- |
| a RAW 16 data element | `0123…CDEF` | 16 bytes; `BINTOHEX` gives the upper-case hex |
| a RAW 16 data element | initial | **16 zero bytes** -- not NULL, not empty |
| `x LENGTH 4` | initial | 4 zero bytes |

The comparison is byte-wise: the input equals `X'0123…CDEF'` and
`HEXTOBIN('0123…cdef')` in either case of hex, and not `X''`. Going the
other way, a shorter VARBINARY returned into an `x LENGTH 16` component
arrives padded with zero bytes on the right, and an empty one as 16 zero
bytes.

An ABAP `x LENGTH 16` input is always 16 bytes, so a shorter value can only
come from a JavaScript caller of the portable runtime. For that case the
runtime applies ABAP's own assignment rule for `x`: a shorter value moved
into a longer field is padded with hex `00` on the right. The ABAP database
seam here holds fixed RAW as canonical upper-case hex text, so the portable
bind is: the value as upper-case hex, padded with `00` on the right to the
field's length, initial all zeros, a longer value or one that is not hex
refused. String equality on that canonical form is byte equality.

## What the kernel does with INT2 at an AMDP boundary (measured on A4H, 2026-09-23)

Same method: a throwaway class with AMDP procedures and an ABAP Unit
driver, in their own package, deleted afterwards.

| case | what happens |
| --- | --- |
| an `int2` input of -32768, 32767, 0, 7 | seen exactly, not NULL |
| `:iv + 1` with 32767 | 32768: the arithmetic is INTEGER's, no SMALLINT overflow |
| `:iv + :iv` with 32767 | 65534, likewise |
| an `int2` input with `DEFAULT 5`, omitted | 5 |
| an INTEGER of 32767 or -32768 into an `int2` output component | kept |
| an INTEGER of 32768, 40000, -40000 or 65536 into that component | `CX_AMDP_EXECUTION_FAILED` |
| `:iv + :iv` with 20000, into that component | `CX_AMDP_EXECUTION_FAILED` |

So INT2 is an INTEGER everywhere inside a body, and its range is checked
where ABAP meets it. On the way out, the kernel **raises** for a value
outside -32768..32767; it does not wrap and does not truncate. The
portable runtime does the same: an INT2 column is checked on the rows it
returns, with an error that names
the exception HANA raises. An ABAP `int2` input cannot carry a value
outside the range, so a JavaScript caller's value that does is refused at
the bind. A nested CALL hands its relation on unevaluated, so an INT2
output of a nested CALL is refused rather than passed on unchecked.

A by-product: an AMDP method parameter declared `OPTIONAL` does not
compile on A4H ("Use DEFAULT instead of OPTIONAL for the optional
parameter"). Only `DEFAULT` makes an AMDP input optional.

Refused by name until measured, around INT2: a CAST or DECLARE to
SMALLINT or TINYINT; INT1 on every path (unsigned 0..255 in ABAP); a
UNION of an INT2 and an INTEGER column (HANA unifies them; the IR does not
yet); an INTEGER assigned to an INT2 scalar (so a scalar INT2 output only ever
holds an INT2 value and needs no check of its own). Not INT2 but found on
the way: a CAST to BIGINT is typed as a plain INTEGER, which is narrower
than BIGINT; it is a known gap, recorded here until it is measured. An INT2 column of a table
input is range-checked at the bind with one query; across a nested CALL,
INT2 inputs and outputs are refused.
## OPTIONAL on an AMDP input (measured on A4H, 2026-09-23)

| declaration | on A4H |
| --- | --- |
| a scalar input (`i`, `string`) with `OPTIONAL` | does not compile: `Use DEFAULT instead of OPTIONAL for the optional parameter "IV" of the AMDP method "M".` |
| a table input with `OPTIONAL` | compiles |
| that table input, omitted by the caller | the body sees an empty table (`COUNT(*)` is 0) |

So an AMDP scalar is optional only through `DEFAULT`, and the portable
compiler refuses a scalar `OPTIONAL` in the same words. A table
`OPTIONAL` is refused by name until it is carried as an empty relation.

## SELECT ... INTO, and the types of COUNT, MIN and MAX (measured on A4H, 2026-09-23)

Two throwaway classes with AMDP procedures and ABAP Unit drivers, in their
own packages, deleted afterwards.

| `SELECT … INTO v` | on A4H |
| --- | --- |
| exactly one row | assigns it |
| no row | `CX_AMDP_EXECUTION_FAILED` |
| two rows | `CX_AMDP_EXECUTION_FAILED` |
| `INTO v DEFAULT 42`, no row | 42 |
| `INTO v DEFAULT 42`, two rows | `CX_AMDP_EXECUTION_FAILED` |
| `COUNT(*) INTO v`, v INTEGER | always one row; 0, 1, 2 |
| `INTO la, lb` | the columns in order |
| a NULL in the row | the variable becomes NULL |
| `'a  '` into an NVARCHAR variable | `a  `, blanks kept |

The portable runtime asks the engine for two rows and decides the same way;
its error names the exception HANA raises.

For the result types, one expression was run over a one-row INTEGER table:
`X * 2147483647 + X * 2147483647`. With `X` = `COUNT(*)` or `COUNT(k)` the
answer is 4294967294; with `MAX(k)`, `MIN(k)` or `SUM(k)` the procedure
raises. So COUNT is wider than INTEGER (BIGINT), and MIN, MAX and SUM of an
INTEGER stay INTEGER. `AVG` of 1 and 2 is `1.500000`. A plain INTEGER
column in the same expression did **not** overflow, so HANA widens column
arithmetic and not an aggregate's: the comparison stands between the
aggregates, not against the column.

The binder types COUNT as INT8 and MIN / MAX as their argument -- in every
relation and in window forms too, not only for `SELECT … INTO`; a BIGINT
fills an INTEGER scalar through `SELECT … INTO`, range-checked. SUM and AVG
stay typed STRING, the binder's default for a call it has not measured, so
`SELECT SUM(k) INTO v` with v INTEGER is refused as a type mismatch: DuckDB
widens `SUM(INTEGER)` where HANA overflows, and that difference has no answer
in the lowering yet. An unnamed expression is called `V` in the binder's
messages; two of them in one select are refused as two items of one name.

## What the kernel sends for `col IN ranges` (read off A4H's plan cache, 2026-09-23)

The SQL a range table becomes was read from `M_SQL_PLAN_CACHE` right after
each SELECT, one case per statement (a distinct table alias through a
dynamic FROM kept the statements apart; the bound values are not kept by
the plan cache, so what is below is the statement's shape). Which rows each
case selects was measured separately by foreman-dell on a table of its own
(the result sets agree with the shapes).

| range row | what the kernel sends |
| --- | --- |
| CP `D*`, `+`, `A+`, `T*   `, `D E*`, `D*` with HIGH `Z` | `col LIKE ?` |
| CP with a literal `%` or `_` (`5%*`) | `col LIKE ? ESCAPE ?`, and only then |
| CP with no wildcard left: `DE`, `A#`, `D#*`, an initial LOW | `col = ?` |
| CP `*` | `1 = 1` |
| CP with a leading blank (` *`), `X` with HIGH `*` | `(col LIKE ? OR col LIKE ? AND (N'_' <> ? OR col <> N''))` |
| EQ (a HIGH is ignored), BT, NE | `col = ?`, `col BETWEEN ? AND ?`, `col <> ?` |
| NP, or SIGN E | `NOT col LIKE ?` |

From that and the result sets: the CP pattern is LOW at the declared width
of the range's LOW (not the column's: a char45 range on a CHAR10 column put
44 blanks between `X` and `*`) with HIGH after it (so `X*` with HIGH `Z` asks for `X`, anything, blanks,
`Z`, and finds nothing); a trailing `#` escapes a padding blank (`A#` is
`= 'A'`); trailing blanks do not count. `tools/ir-ranges.mjs` renders the
same shapes. The special OR form serves blanks that meet the padding and
the initial value stored as `''`; its bound values would be needed to copy
it, so such a pattern is refused by name, and so is `+` alone, which
matched the initial value through a plain `LIKE ?` -- the difference is in
a value the plan cache does not keep.

Measured by foreman-dell and adopted: SIGN and OPTION are exactly `I` / `E`
and the ten options in upper case; a lower-case one, an unknown one or an
initial row is an uncatchable dump (`SAPSQL_IN_ITAB_ILLEGAL_SIGN` /
`_OPTION`), never "no restriction". A value longer than the column raises
`CX_SY_OPEN_SQL_DATA_ERROR`; a CP pattern too long raises
`CX_SY_DYNAMIC_OSQL_SEMANTICS` -- measured at one width only (on CHAR10, 12
and 20 characters pass, 46 raise), so "longer than twice the column" is an
extrapolation from CHAR10 and is labelled so in the code.

Two differences from the kernel's text are deliberate and do not change the
meaning: `tools/ir-ranges.mjs` renders BT / NB as `(>= AND <=)` where the
kernel sends `BETWEEN ? AND ?`, and inlines an INTEGER where the kernel
binds it. The pairs file says so, so that a port does not "fix" them. LOW and HIGH are converted to the
column's type (a NUMC column gets `0005`..`0010` for `5`..`10`).

## Several OUT tables (measured on A4H, 2026-09-23)

A throwaway class with AMDP procedures, called through `execute_abap`,
deleted afterwards.

| case | on A4H |
| --- | --- |
| an OUT table assigned in one branch of an IF, the other branch taken | an empty table; the caller's rows are replaced |
| an OUT table assigned nowhere in the body | does not compile: `some out table variable is not assigned: ET_A` |
| a scalar OUT the path taken did not assign | its initial value (0), the caller's value replaced |
| an OUT read in the body (`:et_a`) and assigned again | allowed; a reader sees the value before the reassignment |

The portable compiler carries several OUT tables: each is what the body
assigned, an empty relation where the path assigned none, and an OUT
assigned nowhere is refused in HANA's words. A scalar OUT beside table OUTs
and a nested CALL inside such a procedure are refused by name for now.

## String and other scalar variables (measured on A4H, 2026-09-23)

A throwaway class with AMDP procedures, called through `execute_abap`,
deleted afterwards.

| case | on A4H |
| --- | --- |
| `DECLARE v NVARCHAR(10);` | NULL until assigned |
| `DECLARE c NVARCHAR(10) = 'x  '` | kept: length 3; `'x  ' = 'x'` is false |
| `DECLARE d CHAR(5) = 'a'` | `'a'`, length 1 -- a variable is never padded |
| `e = :e \|\| :b` with `b` NULL | NULL |
| `f = 42` into an NVARCHAR | `'42'` |
| `DECLARE a NVARCHAR(3) = 'abcdef'` | raises (`CX_AMDP_EXECUTION_FAILED`), not truncated |
| `DECLARE i NCLOB = 'long text'`, `DECLARE j BIGINT = 3000000000` | as given |
| `DECLARE g BOOLEAN = TRUE; IF :g THEN` | a syntax error: `IF :g = TRUE THEN` |
| a STRING OUT assigned `'ab  '` | `'ab  '` in ABAP, the blanks kept |
| a `c LENGTH 3` OUT assigned `'ab '` / `'abcdef'` | `'ab'` / raises |
| a scalar OUT the path left alone | its initial value (`''`, `0`) |
| a scalar OUT or RETURNING assigned NULL (`i`, `string`, `c LENGTH 3`; alone or beside others; a scalar function) | its initial value, no raise (2026-09-24) |
| `UPPER(NCHAR(228) \|\| NCHAR(246))` / `LOWER` of the capitals | `'ÄÖ'` / `'äö'`: DuckDB agrees, SQLite and sql.js do not |
| `UPPER('stra' \|\| NCHAR(223) \|\| 'e')` | `'STRAßE'`, length 6: one character in, one out (DuckDB writes the capital sharp s, JavaScript writes SS) |
| `:i \|\| :i` with `i = 5` | `'55'` |
| `''` in an NVARCHAR, `IS NULL` | false: an empty text is not NULL |
| `NCHAR(128512) \|\| NCHAR(128512)` into NVARCHAR(2) or NVARCHAR(10) | raises in both |

The portable runtime declares NVARCHAR / VARCHAR / CHAR / NCHAR of a length,
NCLOB / CLOB, BIGINT and BOOLEAN. The host evaluates what is measured here
itself -- literals, variables, `||`, `=` / `<>` between two texts, IS NULL,
COALESCE, UPPER / LOWER with the one-to-one mapping measured above -- so those mean what they mean on HANA on every backend and the IR
needs no engine for them. Anything else (ordering a text, a CASE, a function)
still goes to the engine as `SELECT <expr> FROM DUMMY` through the same
lowering as a query, and is refused where the run has no engine; each such
route moves to the host once it is measured and paired (foreman-dell's
review of #44).

Two limits, written down so they are not mistaken for measurements:

- **Inside a SELECT the engine still decides.** A text compared with a
  number in a WHERE (`WHERE txt = 5`: DuckDB raises, SQLite answers no row)
  and UPPER / LOWER in a projection (DuckDB writes the capital sharp s,
  SQLite maps ASCII only) are lowered as they are. The host rules above
  cover scalar statements, not queries; a refusal at lowering is the next
  step.
- **The host's UPPER / LOWER beyond the measured cases is a decision.**
  Measured: `äö`, `ÄÖ`, `ß`. Not measured, and handled by the one-to-one
  rule (a mapping that would change the length keeps the character): the
  dotted and dotless i (`İ`, `ı`), ligatures (`ﬀ`), `ŉ`, `ǰ`, `ΐ`, and the
  Greek final sigma (`ΣΑΣ` lowers to `σασ`, no `ς`).

## A nested block and its variables (measured on A4H, 2026-09-24)

A throwaway AMDP class, deleted afterwards. A plain `BEGIN ... END` inside a
procedure body does not hide the procedure's variables from it, nor its own
from the procedure:

| body | what the procedure returned |
| --- | --- |
| `BEGIN lt_x = SELECT 2 ...; END; et = SELECT n FROM :lt_x;` | activates; `n = 2`: a table variable first assigned inside is visible after END |
| `lt_x = SELECT 1 ...; BEGIN lt_x = SELECT 2 ...; END; et = SELECT n FROM :lt_x;` | `n = 2`: the inner assignment is the outer variable's |
| `DECLARE v INTEGER = 1; BEGIN v = 2; END; ev = :v;` | `2` |

So a nested block that declares nothing is the same as its statements
written in place, which is how the portable compiler carries it. One that
declares (a scope of its own, shadowing, an EXIT HANDLER) was not
measured and is refused; `BEGIN AUTONOMOUS TRANSACTION`, a handler and a
label do not parse here, so they are refused before any rule applies.

## The kernel's own wrapper around an AMDP body (read on A4H, 2026-09-24)

Read off a generated procedure in the system's HANA catalog
(`SYS.PROCEDURES.DEFINITION` of a documented SAP AMDP demo with a
CHANGING table; which one is in the local notes), not guessed. This is the
form of a procedure; the form the oracle writes for a function and a table
function is ours and was not read off a system:

- a CHANGING table parameter becomes two: `in "X__IN__"` and `out "X"`, and
  the procedure starts with `"X" = select * from :X__IN__;`;
- the method's body sits in a `begin ... end;` block of its own inside the
  procedure;
- a table named in USING is read through a generated view
  (`...=>TABLE#covw`), and that view is a plain projection of the table's
  columns (`select "MANDT", "CARRID", ... from "SCARR"`, read off
  `SYS.VIEWS`): it fixes the column list, and it does **not** restrict the
  client. An AMDP has no implicit client handling -- the body joins or
  filters on MANDT itself, as the demo does (`s.mandt = c.mandt`) -- so a
  portable run that scans the table itself reads the same rows;
- parameter types are generated table types (`...=>P00000#ttyp`);
- `$ABAP.type( x )` in a body is replaced by x's HANA type, and a full-line
  ABAP comment (`*` in column one) is removed, before HANA sees it -- but
  not inside a SQLScript block comment: the line `*/` in column one that
  closes one is kept (read off a generated procedure's body, 2026-09-24);
- an IN parameter's ABAP `DEFAULT` becomes a HANA `DEFAULT`: an INTEGER
  `DEFAULT 1` is `DEFAULT '1'` -- the literal's text, quoted -- and an
  optional table parameter is `DEFAULT EMPTY` (both read off
  `SYS.PROCEDURES`, 2026-09-24). Not measured, and written by the stand on
  the same pattern: a negative or decimal literal (`-1` as `'-1'`, `1.5` as
  `'1.5'`), a quoted text literal; a constant or a system field
  (`abap_true`, `sy-datum`) gets none. Not measured either: that a `*` line
  inside a SQLScript string is kept, which the stand assumes.

`tools/amdp-corpus-oracle.mjs` creates every corpus body on the local HANA
Express in that form (one schema, dropped and recreated per run), with an
empty table of the system's shape for each table it reads, and sorts every
refusal into whose fault it is. First full run: HANA accepts 204 of the 364
working bodies; every body the portable compiler accepts, HANA accepts too;
84 that HANA accepts stop in our parser, which is the grammar backlog, by
construct. The report and the shapes read off the system stay under
`.local/amdp-oracle/`.

## The order a cursor's rows come in (observed, 2026-09-24)

Observed, not a documented guarantee: HANA promises no order without
ORDER BY. A cursor over a table variable whose rows were put in a known,
shuffled order (a permutation key), counted as inversions of that order
over the loop, on HANA Express 2.00.088 and on A4H's HANA (a throwaway AMDP
class, deleted; the table variable was the method's IN table, as in the
corpus):

| cursor `SELECT ... FROM :lt` | HXE 3 / 1000 / 100 000 rows | A4H 3 / 1000 / 100 000 rows |
| --- | --- | --- |
| as it is | 0 / 0 / 0 | 0 / 0 / 0 |
| `WHERE` (a filter) | 0 / 0 / 0 | 0 / 0 / 0 |
| a projection (`n * 2 AS m`) | 0 / 0 / 0 | -- |
| `DISTINCT` | 0 / **7** / **12 799** | 0 / 0 / 0 |
| a join with a small table | 0 / **7** / **791** | 0 / 0 / 0 |

So a scan, a filter and a projection kept the table variable's order on
both, at every size; DISTINCT and a join kept it on one HANA and lost it on
the other, and at three rows every form looked ordered. The portable runtime
therefore carries order as a property of a relation: *defined* (ORDER BY, or
rows put in an order), *inherited* through a scan, filter or projection of a
relation whose order is defined, and *unknown* after DISTINCT, a join, a
union, grouping, or a scan of a database table without ORDER BY. A FOR loop
over a cursor of unknown order is refused ("order"), since its result can
depend on an order no HANA promises.

Two more, measured on HXE the same afternoon:

- **Ties are not kept.** A table variable in a known order, a cursor
  `ORDER BY g` over a key with ten values: within each group, about half
  the rows came out of their original order, at 100 rows and at 100 000.
  So ORDER BY defines an order only up to its keys; a loop that reads a
  column the keys do not include is refused ("order").
- **NULL is the smallest value.** `ORDER BY v` gives `NULL, 1, 2` and
  `ORDER BY v DESC` gives `2, 1, NULL`. PostgreSQL and DuckDB put NULL last
  ascending by default, so every ORDER BY the lowering writes now says
  `ASC NULLS FIRST` / `DESC NULLS LAST`, on every engine.

## A numeric FOR loop (measured on HXE 2.00.088, 2026-09-24)

`FOR i IN [REVERSE] a .. b DO ... END FOR`, each case a procedure created and
called on HANA Express:

| body | HANA |
| --- | --- |
| `FOR i IN 1 .. 3` | 1, 2, 3 -- inclusive |
| `FOR i IN 3 .. 1` | no turn |
| `FOR i IN REVERSE 1 .. 3` | 3, 2, 1 |
| `n = 3; FOR i IN 1 .. :n DO n = 1; ...` | 1, 2, 3 -- the bounds are read once |
| `FOR i IN 1..:n` (no blanks) | accepted |
| `FOR i IN 1 .. 3 DO i = 5; ...` | 5, 5, 5 -- three turns: the counter is the loop's own |
| after `FOR i IN 1 .. 2` | `:i` is 2 -- the declared variable keeps the last value |
| `i = 7; FOR i IN 3 .. 1 ...` | `:i` is still 7 |
| after `FOR i IN REVERSE 1 .. 3` | `:i` is 1 |
| a loop variable not declared before | does not compile: `identifier must be declared` |
| `FOR i IN 1 .. 2.7`, `FOR i IN 1 .. NULL` | does not compile: a non-integer bound |
| a BIGINT loop variable over 2147483646 .. 2147483647 | accepted |
| `v = :v \|\| i` -- the variable without its colon | accepted in a scalar statement |
| `IF i > 1 THEN ...`, `WHILE i < 3 DO i = i + 1; ...` -- without the colon | accepted, the variable read |
| `FOR i IN 1 .. 3 DO v = :v \|\| i; i = 5; END FOR` | 1, 2, 3 -- the next turn's value is the counter's, not `i + 1` |
| `FOR i IN REVERSE 3 .. 1` | no turn |
| after `FOR i IN 1 .. 3 DO i = 5; END FOR` | `:i` is 5 -- the last value given, by the body |
| `FOR i IN 1 .. :nn`, `FOR i IN :nn .. 3`, `FOR i IN REVERSE 1 .. :nn`, `nn` NULL | no turn, no error; `:i` as it was |
| `FOR i IN REVERSE (1) .. 3` | 3, 2, 1 -- REVERSE is the keyword before a parenthesis too |
| an INTEGER variable, a BIGINT bound | accepted |
| an INTEGER variable over `2147483646 .. 2147483648` | `numeric overflow` |
| a BIGINT variable over `9007199254740991 .. 9007199254740993` | three turns |
| `FOR i IN -2 .. 0` | -2, -1, 0 |

(the second block of rows measured 2026-09-24 for the #56 critic's follow-up)

What the portable runtime does beyond the table, none of it measured on
HANA (the #56 critic):

- every spelling of the range is read: `1..3`, `1 ..3`, `:n..3` -- a dot
  right after a dot never starts a number, so `.3` does not swallow the
  upper bound;
- a BIGINT bound past 2^53 is refused, not counted: a JavaScript number
  stops changing at `c + 1` there (HANA counts it, above);
- an INTEGER variable past 2^31 is refused at the turn that overflows,
  after the turns before it ran -- HANA raises `numeric overflow`, and when
  it raises was not measured;
- a range with more turns than what is left of the step budget is refused
  before its first turn, the turns counted by arithmetic;
- a table assigned inside any loop -- WHILE, a numeric FOR, a FOR over a
  cursor -- has no order a cursor inside the loop can rely on;
- a FOR inside a FOR over the same variable is refused;
- `BREAK` and `CONTINUE` are not carried (the body does not parse);
- each turn costs a step, as a WHILE's does, and the body's statements cost
  theirs: `FOR i IN 1 .. 5000 DO n = :n + 1; END FOR;` already reaches the
  default limit of 10000 steps.

## DECLARE ... DEFAULT and CONSTANT, and a leading minus (measured on HXE 2.00.088, 2026-09-24)

| body | HANA |
| --- | --- |
| `DECLARE x INTEGER DEFAULT 5` | 5 -- DEFAULT is `=` |
| `DECLARE x CONSTANT INTEGER = 7`, `... CONSTANT INTEGER DEFAULT 8` | 7, 8 |
| `DECLARE x CONSTANT INTEGER;` | accepted; `:x` is NULL |
| `x = 2` on a CONSTANT | does not compile: `cannot modify constant variable` |
| `FOR x IN 1 .. 3` on a CONSTANT | does not compile: `cannot modify constant variable` |
| `SELECT 5 INTO x` on a CONSTANT | does not compile: `Not allowed expression for INTO-target: cannot modify constant variable` |
| `DECLARE x ...; DECLARE x ...` | does not compile: `at most one declaration is permitted in the declaration section` |
| `-(-3) + 1`, `-(2 + 3) * 2` | 4, -10 |
| `-:n`, n = -2147483648 | `numeric overflow` |
| `-:n`, n NULL | NULL |
| `-:s`, s = '5' | -5 -- the text converted; the portable compiler refuses a minus before a text |
| `-x`, `0 - x`, x DECIMAL(10,3) = 1.555 | -1.555, -1.555 -- the scale is kept |

The last row says the binary rule of `tools/sqlscript/to-ir.mjs` -- any
arithmetic with a packed operand is P(15,2) -- is wrong for a scale above 2:
HANA keeps 1.555's three decimals in `0 - x`, and SQLite's rounding to the
declared scale cuts it to 1.55 (DuckDB widens the type and keeps the value).
The leading minus takes its operand's type and is right; the binary rule is
an older defect, left for its own change with its own measurements.

## Writes: DELETE, UPDATE, INSERT, UPSERT (measured on HXE 2.00.088, 2026-09-24)

A table T (K INTEGER PRIMARY KEY, V NVARCHAR(10)) holding (1, a), (2, b):

| body | HANA |
| --- | --- |
| `lt = SELECT k, v FROM t; DELETE FROM t;` then `COUNT(*)` of `:lt` | 2 -- a table variable keeps the rows it read |
| `lt = SELECT ... WHERE k = 1; UPDATE t SET v = 'z' WHERE k = 1;` then `MAX(v)` of `:lt` | a -- the old value |
| `INSERT INTO t VALUES (3, 'c');` then `COUNT(*)` of `t` | 3 |
| `UPDATE t SET v = 'q';` | every row |
| `DELETE FROM t AS a WHERE EXISTS (SELECT ... FROM :lt AS b WHERE a.k = b.k)` | the alias is the target's |
| `INSERT INTO t VALUES (1, 'dup')` | `unique constraint violated` |
| `UPSERT t VALUES (1, 'u') WITH PRIMARY KEY` | updates 1; a new key inserts |
| `UPSERT t VALUES (1, 'x')` -- no WITH PRIMARY KEY, no WHERE | `unique constraint violated` |
| `UPSERT t SELECT ...` | by the primary key: updates the keys there, inserts the others |
| `UPSERT t (k, v) VALUES (2, 'w') WHERE k = 2` | updates the rows the WHERE finds |
| `UPSERT n VALUES ...` twice, N without a key | one row -- the second updated it |
| `DELETE FROM t WHERE k > 1;` then `::ROWCOUNT` | 1 |
| `DELETE` in a FUNCTION (a table function) | does not compile: `INSERT/UPDATE/DELETE is/are not supported in table function` |
| `DELETE` in a `READS SQL DATA` procedure (an AMDP OPTIONS READ-ONLY) | does not compile: `... not supported in read-only procedure` |
| `DELETE FROM t WHERE k = 2; INSERT INTO t VALUES (1, 'dup');` -- the CALL raises | the DELETE stays in the transaction; a ROLLBACK takes it back |

A write runs in the caller's LUW, as an Open SQL write does
(`client.write`: the transaction opened, and on DuckDB the statement kept
for the replay a later failure makes), so a ROLLBACK WORK, or a dump ending
the dialog step, takes it back -- and a failed statement leaves the earlier
writes pending, as HANA does. What the runtime does not check that HANA
does: an arithmetic overflow in a SET (DuckDB raises, SQLite stores the
wider value); a text written from an expression rather than a literal is
not checked against the column's length. A SQL error of a write reaches ABAP
through the destination as the refusal it makes of any failed portable run,
not as CX_AMDP_EXECUTION_FAILED with its SQL code -- the same gap as
ANOMALY-2026-09-24-amdp-execution-failed-class. MERGE, TRUNCATE,
`::ROWCOUNT` and a scalar subquery in a SET do not parse yet; a procedure
whose only work is writes, with no OUT, is not carried.

The first two rows are the rule the portable runtime has to keep on purpose:
it holds a table variable as a plan and runs the plan late, so a plan that
reads the table written is materialised before the write
(`tools/sqlscript-procedure-ir.mjs`, `snapshot`) and dropped when the call
ends. Which plans: every one that reads the database at all -- a view or a
table function reads the table under it, and which tables a view reads is
not known here. The snapshot is a table of the columns' types filled by
INSERT ... SELECT (SQLite keeps CHAR's RTRIM comparison), made inside the
LUW. UPSERT, `::ROWCOUNT`, `INSERT INTO :lt` and MERGE are not carried yet:
UPSERT needs the table's key, which the catalogue does not hold.
