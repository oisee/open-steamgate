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
