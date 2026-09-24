# The AMDP corpus on A4H: what it is before it is counted

The other half of the SQLScript table (`docs/sqlscript-surface.md`, which is
the surface read off the book) is **frequency**: which constructs appear, how
often, and which never appear at all. This file is the step before that count,
and it exists because the count would otherwise have been confidently wrong.

## The warning that prompted it

fable-osd, reading the book, found that its whole chapter 9 is about BW
transformation routines written as AMDP -- start, end, expert and field
routines. Those are **generated**, so a corpus dominated by them would measure
a generator's habits and be read as "how people write SQLScript". A histogram
like that is worse than none: it is round, it is well distributed, and it
answers a question nobody asked.

So the corpus was classified before it was counted.

## What is actually there, measured 2026-09-18

195 classes implement `IF_AMDP_MARKER_HDB` on the A4H sandbox (`SEOMETAREL`
joined to `TADIR`). Three of them are ours.

| package | classes | what it is |
| --- | --- | --- |
| the ABAP documentation's demo packages | 31 | the demos of the ABAP documentation |
| the compiler's test packages | 23 | kernel compiler test fixtures |
| several machine-learning packages | 33 | machine learning / predictive |
| the ABAP Unit test-double demos | 7 | test-double demos for ABAP Unit |
| a custom-code analysis package | 8 | custom-code analysis |
| workflow packages | 11 | workflow |
| everything else (48 packages) | ~79 | dictionary, CTS, security, MDG, search, ... |
| `$ZADT_VSP`, `$Z80_00`, `$ZADT_AMDP` | 3 | ours |

**`GENFLAG` is empty for all 195.** Nothing here is marked generated in
`TADIR`, and there is **not one BW transformation routine**: the four
BW-adjacent classes are none of them a transformation routine, and this sandbox has
no BW content activated at all. So the warning does not materialise here.

## The bias I predicted, and the measurement that refuted it

**This section is kept with its error in it.** The reasoning below was written
before the count and is wrong; erasing it would send the next reader down the
same path.

What I argued: about 60 of the 195 -- a third -- are demos and compiler test
fixtures (the documentation demos, the compiler tests, the unit-double demos). They are
written on purpose to cover the corners of the language, so they would make
rare constructs look common, and a histogram over them would say "support
everything equally" -- the mirror image of the generated-code bias, and in the
direction that flatters us.

**Measured, it is the other way round: the teaching corpus is poorer than the
working one, not richer.** 104 teaching bodies against 405 working ones:

| construct | working | teaching |
| --- | ---: | ---: |
| table variable assigned from a `SELECT` | 70% | 30% |
| `UNION` / `UNION ALL` | **38%** | **0%** |
| `DECLARE` scalar variable | 36% | 4% |
| `IF` / `ELSE` | **32%** | **0%** |
| `CROSS JOIN` | 15% | 0% |
| dynamic SQL | 9% | 0% |
| common table expression | 6% | 0% |
| exceptions | 6% | 0% |

The reason is obvious afterwards: the documentation demos are **deliberately
minimal**. Each shows one feature in the simplest body that can show it, which
is why none of them branches and none of them unions. "Written to cover the
corners of the language" is true of the **set** of classes and false of each
**body**: the corners are many, and each is shown in a body with nothing else
in it. I carried a property of the collection onto its elements.

It is also visible in the coverage curve below: thirteen constructs cover
**100%** of the teaching corpus and only 65% of the working one.

So the teaching corpus is not a second surface list. What it is, is the
minimal set SAP uses to explain AMDP -- which makes it a good answer to
"where does an interpreter start?", and a poor one to "what does real code
need?".

**So the count is two histograms and not one:**

- **the teaching corpus** -- demos, compiler tests, unit-double demos. This is
  close to a second surface list, arrived at independently of the book, and it
  is the right place to look for constructs the book does not mention.
- **the working corpus** -- the remaining ~135 classes, SAP standard code
  written to do a job. This is the one that answers "which ten constructs
  cover ninety percent of bodies".

Where only the working corpus has a construct, that is the most interesting
row in the table -- it is neither emphasised by the book nor shown by a demo.
In the event, that is most of them.

## The number that actually answers "what first"

fable-osd's correction, and it matters more than the frequency table: a body
needs **all** of its constructs at once. Implementing the three commonest can
translate **zero** bodies, because each trips over its own fourth. So the
curve worth having is cumulative and counted in whole bodies.

Measured over the 405 working bodies, greedily taking the construct that
completes the most bodies at each step:

| after adding | bodies fully covered |
| --- | ---: |
| (nothing: bodies that are a plain `SELECT`) | 26 (7%) |
| `WHERE` | 46 (12%) |
| + table variable from a `SELECT` | 68 (18%) |
| + `UNION` | 83 (22%) |
| + `INNER JOIN` | 98 (26%) |
| + `DECLARE` scalar | 112 (29%) |
| + `ORDER BY` | 127 (33%) |
| + `CALL` | 141 (37%) |
| + `IF` / `ELSE` | 168 (44%) |
| + `CROSS JOIN` | 184 (48%) |
| + `GROUP BY` | **201 (52%)** |
| + outer join | 222 (58%) |
| + dynamic SQL | 237 (62%) |
| + scalar subquery | 249 (65%) |
| + session variable | 261 (68%) |

**Ten constructs cover 52% of bodies, not 90%.** The comfortable sentence we
were about to write was about occurrences; this is about bodies, and it is the
one that predicts how much of the corpus actually runs.

After those fourteen, the cheapest work available is the set of bodies short
of exactly one more construct: `FOR` loop unlocks 12, `UPDATE` 10, `UPSERT`
8, common table expression 8, `DECLARE TABLE` 7, `INTERSECT`/`EXCEPT` 6. That
list is worth printing after every construct implemented, because it changes
each time.

**The ceiling: 21 of the 405 bodies (5%) can never be covered**, because they
use `XMLTABLE` or `HIERARCHY`, which have no portable form at all. That is a
ceiling and not a backlog item, and it is recorded now so that it is not
rediscovered later as a disappointment.

## Measured zeroes, which are not missing rows

A construct with a zero here was looked for in 405 working and 104 teaching
bodies and not found. An absent row would mean "not looked at"; these are
"looked at, not there":

- **calculation engine (`CE_*`) operators: 0.** `MAP_MERGE`: 0. `MAP_REDUCE`:
  0. The plan to refuse them is now supported by a measurement rather than by
  taste.
- **cursors: 0.** Arrays: 2 bodies. `COMMIT`/`ROLLBACK`: 1. `TRUNCATE`: 1.
- The imperative half is thinner than we had budgeted for: `IF` 32%, dynamic
  SQL 9%, exceptions 6%, `WHILE` 5%, `FOR` 6%, `BREAK`/`CONTINUE` 4%. An
  interpreter that does branching and assignment and nothing else reaches most
  of what the imperative half is used for.

## Where the real obstacle is

Not the imperative shell -- the **types and built-in functions** (chapter 4 of
the reference). In the working corpus: `XMLTABLE` 22 bodies, `TO_NVARCHAR`
27, `IS_EMPTY` 29, `RECORD_COUNT` 33, `SUBSTR` 33, `CONCAT` 38, `IFNULL` 13,
`REPLACE_REGEXPR` 12, `TO_TIMESTAMP` 12, `XMLNAMESPACE` 11, `STRING_AGG` 7,
`SECONDS_BETWEEN` 6, `HIERARCHY` 5. This is the class where a translation
**silently returns a different number instead of failing**, which this project
has already paid for twice. Every row here needs its own probe, and the probe
must compare the **value**, not that it ran.

(The function list is indicative rather than exact: the scan counts an
upper-case name followed by a bracket, so a few keywords -- `INSERT`,
`ELSEIF`, `SOURCE`, `MAP` -- and a few identifier prefixes are in it.)

## Limits of this classification, stated rather than implied

- `GENFLAG` empty is not proof of "hand-written": generated objects are not
  always flagged. The absence of BW routines is the stronger evidence, and it
  is an absence in **this** sandbox, not in the world.
- One system, one release. A customer's system would have a different
  distribution, and almost certainly the BW routines this one lacks.
- SAP standard code is written by people who know the database. A customer
  corpus would likely be simpler and narrower, not wider.
- **How the packages were chosen:** all of them. Every package on the sandbox
  holding at least one class that implements `IF_AMDP_MARKER_HDB` was
  exported -- 66 of the 67. The one missing is a compiler package (one class),
  whose export timed out; it is a teaching package, so its absence moves the
  teaching numbers and not the working ones. This is not an alphabetical or
  otherwise systematic sample: it is the whole set.
- The construct patterns are regular expressions over the body text with
  comments stripped, not a parser. `CROSS JOIN` at 15% was checked by hand
  against the bodies and is real: joining a one-row select to pull a scalar
  into a set is an ordinary AMDP idiom.
- Counted in **bodies, not occurrences**: nine `UNION`s in one method are one
  problem, not nine, because the question is how many bodies we fail to
  translate.
- Reproduce with `node tools/amdp-corpus.mjs`; the exports live under
  `.local/` and are never tracked -- they are somebody else's source.

## Measured against the parser that exists: 0 of 405

*2026-09-19, `node tools/sqlscript/coverage.mjs`. Until the front end existed
this could only be estimated; the curve above counts **constructs** and
infers. This counts **bodies that go through whole**, which is the only
number that predicts how much of the corpus runs.*

| | bodies | parse whole |
| --- | ---: | ---: |
| working | 405 | **0 (0%)** |
| teaching | 104 | 11 (11%) |

**Zero.** Not a disappointing number -- a useful one, and it says the
frequency curve was answering a different question. A body needs all of its
constructs at once, so a construct in 80% of bodies buys nothing on its own,
and the grammar so far covers the *relational* half of a language whose
bodies are mostly **not** relational at the top level.

What stops them, ranked by bodies rather than by occurrences:

| stopped at | working | teaching |
| --- | ---: | ---: |
| `DECLARE` | **132** | 9 |
| `BEGIN` | **91** | - |
| `RETURN` | **47** | 21 |
| `*` (in `COUNT(*)` and friends) | 24 | 14 |
| `CALL` | 4 | 15 |
| `UPSERT` / `DELETE` / `MERGE` / `IF` | 16 | 5 |

So the next three constructs are decided by measurement and they are not the
three the frequency table would have picked: **`DECLARE`, `BEGIN … END`, and
`RETURN`** -- the imperative shell, which the frequency count made look thin
because it counted how often each *appears* rather than how often it is the
thing in the way. `COUNT(*)` is a fourth and nearly free: the grammar accepts
`*` as a select item and not as a function argument.

This is the curve to re-run after each construct, and the question it answers
after each one is the same: **which construct is now the only thing missing
in the most bodies.** That list changes every time, which is why the order
cannot be fixed in advance from a frequency table.

### What the zero does not mean

- Not that the front end is wrong: the chain runs a body end to end on three
  engines and answers the same values (`test/sqlscript-end-to-end.mjs`). It
  means the grammar covers a smaller part of the language than the frequency
  table suggested.
- Not that the corpus is exotic. The three blockers are the plainest
  statements in the imperative half.
- And it is one sandbox of SAP-authored code; a customer corpus would answer
  its own question, as ever.

### The number above was mine and it was too kind: parsed is not runs

*Correction, same day, fable-osd's catch. The figures in this section counted
bodies that **parse**. Stage 3 refuses `Declare`, `Return` and `Block` by
name, so a body can go through the grammar whole and never reach an engine.
Published as one number called "coverage", "8%" would have been quoted a week
later as "eight percent of the corpus works" -- and we would have been the
ones quoting it. The name of a metric being wider than what it measures is
the defect this project keeps paying for, and this time it was ours.*

`tools/sqlscript/coverage.mjs` now prints three:

| | bodies | parsed | **lowered** |
| --- | ---: | ---: | ---: |
| working | 405 | 34 | **0 (0%)** |
| teaching | 104 | 40 | **5 (5%)** |

Of the 34 working bodies that parse, **none** lowers: 17 stop at `Return`, 9
at `Block`, and 8 end without a statement that produces rows. Only the third
column is showable to anybody.

### After the first four constructs: 0 → 34 parsed (and 0 lowered)

`DECLARE`, `BEGIN … END`, `RETURN` and `*` as a function argument, chosen by
the table above rather than by frequency:

| | before | after |
| --- | ---: | ---: |
| working | 0 of 405 | **34 (8%)** |
| teaching | 11 of 104 | **40 (38%)** |

And the loop immediately earned its keep by contradicting itself. `BEGIN`
blocked 91 bodies before the block grammar existed and blocks **115** after
it -- which can only mean the grammar written for it does not match the shape
real bodies use, and that more bodies now get far enough to reach a `BEGIN`
at all. A frequency table could not have told us that; only re-running
against the corpus could.

The list to work from now, by bodies blocked: `BEGIN` 115, `DECLARE` 58,
`*` 31, `RETURN` 29, `IF` 11, `CALL` 6, `UPSERT`/`DELETE` 10. The first four
are the same names as before, which means each was **partly** implemented --
the grammar accepts a form and the corpus writes another.

### Lowering `RETURN` and flattening `BEGIN`: 0 → 17, and what is left says why

| | bodies | parsed | lowered |
| --- | ---: | ---: | ---: |
| working | 405 | 34 | **17 (4%)** |

`RETURN :lt` names what the body answers with, and a `BEGIN … END` block
contributes its statements to the body rather than introducing a scope the
lowering can see -- a table variable declared inside one is still a name the
statements after it use.

**The refusals that remain are one finding, not seven.** Of the 17 bodies
that parse and still do not lower, 8 "end without a statement that produces
rows" and 7 refuse an "unknown table variable" -- and both are the **method
signature**, which the binder is not given:

- an AMDP procedure answers through its `et_*` **OUT table parameter**, so it
  assigns and never selects at the end. There is no missing statement; there
  is a parameter we do not know about.
- `:it_*` is an **IN table parameter**. It is unassigned in the body because
  it arrives from the caller.

So the next step is not a construct at all: hand the binder the signature
`tools/amdp-extract.mjs` already reads, bind the IN parameters as sources and
treat the OUT parameter as what the body returns. Fourteen of the fifteen
remaining refusals go with it, and none of them needed grammar.

### The signature, handed over: 17 → 30, and a denominator that moved

| | bodies | parsed | lowered |
| --- | ---: | ---: | ---: |
| working | **370** | 34 | **30 (8%)** |
| teaching | 103 | 40 | 23 (22%) |

The binder now gets the method signature `tools/amdp-extract.mjs` already
read: an IN table parameter is a relation the caller supplies, and a body
that assigns to its OUT table parameter and never selects is answering
through it rather than missing a statement. Thirteen more bodies lower, and
not one line of grammar was written for them.

**The denominator moved and that is worth saying rather than hiding**: 405
became 370, because the bodies are now taken from the extractor, which reads
a class, instead of from a regular expression that matched one. So 30/370
is not comparable with the earlier 17/405 as a percentage; what is
comparable is that seventeen became thirty on the same corpus.

**And the `str()` trap was paid for a third time**, which is the part worth
keeping. `SELECT *` arrives as a **word**, because the grammar matches it
with `str()`; the code looked only for an `operator` child, so the star was
not seen, the item fell through to `expression(undefined)`, and the stage
crashed with "cannot read properties of undefined". Every test used a column
list, which is the one shape that cannot expose it -- it was found by corpus
bodies. There is now a table of the three forms a `*` takes, and an
`undefined` reaching the expression walker is a **named refusal** rather than
a crash, because a stack trace tells a reader nothing.

### The instrument, pointed at the corpus: four bodies, and nothing to say

`tools/sqlscript/check-corpus.mjs` takes the bodies that lower, keeps the ones
that read **nothing but their own IN table parameters** -- a body reading
somebody else's table would need a schema we invent, and an invented schema
answers an invented question -- and asks each plan for the rows that would
make a difference show up (`adversarialRows`).

**Four bodies qualify, and not one of them has an expression that can
diverge.** All four are projections and filters over a parameter. The
instrument is correct to say nothing.

That is a finding rather than a failure, and it is worth stating plainly
because the opposite reading is so available: "we ran the comparison on the
corpus and found no differences" would be true and would mean nothing. The
bodies with a cast, a division or a null-sensitive expression are the ones
still blocked at `BEGIN`, `DECLARE` and `IF` -- so the divergence-finder has
nothing to find **until the grammar reaches them**, and any reassurance taken
from today's silence would be reassurance about four projections.

The order that follows is therefore unchanged and now has a second reason:
grammar first, because it is what puts anything interesting in front of every
other instrument we built.

### The histogram that decided the order was an artefact

*Found by going to look at a body rather than at a number.*

`BEGIN` topped the blocker list with 115 bodies, and `DECLARE` followed with
58. Neither was true. A parse failure reported the position where the
**outermost alternative** gave up -- for a body that is one large
`BEGIN … END`, that is character one -- so every body whose block failed
anywhere inside it was recorded as "stopped at BEGIN". The ranking we were
choosing work from was a property of the error reporting.

The combinators now track the furthest position **anything** reached, across
every alternative tried, and a failure points there: the token where the
input stopped making sense to any rule, which is the one a person has to look
at. The same corpus, the same parser, the honest histogram:

| stopped at | bodies |
| --- | ---: |
| `(` | 45 |
| `*` | 33 |
| `EXECUTION` (`BEGIN SEQUENTIAL/PARALLEL EXECUTION`) | 33 |
| `:=` | 27 |
| `AS` | 11 |
| `$ABAP.TYPE( … )` | 11 |
| `=` / `IN` / `LIKE` / `WITH` | 35 |

Not one of those is `BEGIN` or `DECLARE`. `:=` is SQLScript's assignment
operator, which the grammar never had; `BEGIN SEQUENTIAL EXECUTION` is a real
construct we had not heard of; `$ABAP.TYPE( )` is AMDP's own typing syntax,
which exists in no SQL dialect at all.

**The lesson is not about parsers.** A measurement can be wrong in a way that
still produces a plausible, stable, well-ordered table -- the same number came
out every run, and it named constructs that really do occur. What made it
false was that it measured our diagnostics rather than the corpus. The check
that found it was cheap and is the one we keep having to relearn: **open one
of the things the number is about and look at it.**

### Constructs named by the honest histogram: 30 → 37 lowered

| | bodies | parsed | lowered |
| --- | ---: | ---: | ---: |
| working | 370 | 34 → **48** | 30 → **37 (10%)** |

Five constructs, every one of them named by the corpus rather than chosen:

- **`:=`**, SQLScript's assignment operator, which the grammar simply lacked.
- **`BEGIN SEQUENTIAL EXECUTION` / `PARALLEL EXECUTION`** -- real SQLScript
  that nobody here had heard of.
- **`$ABAP.TYPE( … )`** -- AMDP's own typing syntax, in no SQL dialect. It is
  a *type*, so the lowering must make it disappear at the boundary; a
  statement carrying it that still ran would be the case of "works and means
  something else".
- **a table function call in `FROM`**, `FROM "CL_X=>GET_ROWS"( … )`: one AMDP
  calling another, its name a quoted identifier because that is how the
  generated procedure is named.
- **`IF … THEN … END IF`**, which had been hiding behind its opening bracket.

**And the new top of the list was not a construct either.** Following the
rule that has now paid three times -- open one of the bodies the number is
about -- the 40 bodies "stopping at `*`" begin with `* a comment`: an **ABAP**
full-line comment, because an AMDP body lives inside an ABAP method and the
ABAP conventions leak into it. Unambiguous only by column: a `*` anywhere
else is multiplication, and `SELECT *` has to keep working.

The other ABAP comment is deliberately **not** handled: `"` begins a comment
in ABAP and a quoted identifier in SQLScript, so the same character is a name
in one language and a comment in the other. Guessing would silently delete
half a statement, which is the shape of defect this project keeps paying for.

### The double quote: measured, not guessed

The question was whether `"` inside an AMDP body is an ABAP comment (ABAP)
or a quoted identifier (SQLScript). Counting settles it without a probe:

| | |
| --- | --- |
| bodies in the corpus | 473 |
| containing a double quote | 232 |
| containing something shaped like a quoted identifier | **189** |

`"STATUS"`, `"OBJECT"`, `"CL_X=>METHOD"`
-- names, in SQL positions, in 189 bodies. So the ABAP scanner does **not**
treat `"` as a comment inside an AMDP body, and a lexer that did would
destroy two bodies in five. The caution was right and is now a measurement.

This does not make the surrounding point wrong: the language being parsed is
**SQLScript as ABAP hands it over**, and `*` in column one is a comment
because ABAP says so and SQLScript does not. The reference for that class of
question is what reaches the database, not the book.

### The signature was the instrument's, not the corpus's: 18 → 31 lowered

*2026-09-22, branch `feat/amdp-corpus-width`. Measured with
`tools/sqlscript/coverage.mjs`, which now prints the dictionaries it was
given, because the numbers below depend on them.*

The top of the "parsed and then refused" list read `unknown scalar
:p_sapclient` (12), `:p_clnt` (6), `:i_db_schema` (3). Not one of those was
a property of a body. The coverage instrument handed the binder **no scalar
types at all**: `toIr` took them only from an option the procedure compiler
sets, and derived nothing from the signature it was given. So every scalar
parameter of every method was "unknown" -- the histogram measured the
instrument again (foreman-dell, reading `coverage.mjs:125` against
`to-ir.mjs:92`).

Two things were behind the one line, and they came apart on looking:

| | bodies | what it was |
| --- | ---: | --- |
| `:p_sapclient`, `:p_clnt` | 24 | methods declared `FOR TABLE FUNCTION x`: the class has no signature, the DDLS has it (`with parameters @Environment.systemField: #CLIENT P_SAPClient : abap.clnt`) |
| `:i_db_schema`, `:iv_schema_name`, `:ip_client`, ... | 12 | ordinary signatures typed by **data elements** (`db_schema`, `char25`, `mandt`), which need a dictionary |

Both are now read, and the rule for what cannot be read is the one that
matters: a type no dictionary resolves is a **named refusal** ("data element
DB_SCHEMA is not in any dictionary this run was given"), never STRING. A
client field read as text would compare and pad differently on every
dialect and the body would run and answer something else.

| | before | signature scalars (1a) | + DDLS table functions (1b) |
| --- | ---: | ---: | ---: |
| working, lowered | 16 (4%) | 18 (5%) | **31 (9%)** |
| teaching, lowered | 17 | 17 | 18 |

1a unlocked two bodies (one package's two methods, `iv_schema_name : char25`,
resolved through the released DOMA/DTEL dump) and moved the rest into true
refusals. 1b read 97 table-function signatures off the exports (12 DDLS are
not in them) and unlocked thirteen. **Lowered is not runnable**: those
thirteen take a `CLNT` input, and the portable runtime still admits only
INTEGER and STRING inputs. CHAR inputs wait for a conformance case with
trailing blanks measured on HXE against DuckDB, because ABAP pads, HANA
compares without the padding and DuckDB with it; `systemField: CLIENT` is a
flag on the parameter and binds nothing (`sy-mandt` is 123 here and 001 on
A4H, ANORMALIES).

The dictionaries are folders of abapGit XML with the `input_folder` rule --
the later folder wins a shared name and says so: the released dump, then
`--ddic` folders, then the package's own export, which was taken off the
system that runs the code. On this machine: 26 names taken over, 21 + 5
resolutions answered by dump + exports.

What the honest list says next, working corpus: 23 × a table function call
in `FROM` (the callee's RETURNS is now read off its DDLS, indexed by name
and by `implemented by method`, which is what that slice needs), 6 + 3 ×
`IT_CONFIGURATION` (an `IN` table whose type the class does not hold),
5 × `CURRENT_SCHEMA`, 4 × `CALL`.

### The catalogue, closed over the dictionary: 31 → 41 lowered, and 7 of them honestly

*2026-09-22, later. Same branch, same instrument, one more column in it.*

The bodies read three things the instrument described with nothing: the
tables their `USING` names, their table parameters, and through both every
data element and include. The exports carry 1980 `TABL` and 726 `TTYP`
beside the classes, so the folder dictionary indexes them too and the
catalogue is built per body the way `amdp-gen` builds it for the tree:
`USING` tables through `ddicCatalogue`, table parameters through the class's
own `TYPES` or a `TTYP` → `TABL` of the dictionary.

Two things were under the walk that reads a table, both older than this
branch. `osd-type-graph` skipped every `DD03P` row whose name begins with a
dot -- `.INCLUDE`, `.INCLU--AP`, `.INCLU-XXX` -- and 349 of the 1970 tables
have one; the runtime catalogue was missing **2966 columns** (one workflow table:
1 field seen, 77 there), and a column not in the schema is what the
non-strict binder reads as STRING. And its cycle guard was a set for the run
rather than for the path, so a structure included twice or a data element
used by two fields came back `CYCLE`. Both fixed with tests; the generated
RFC dispatcher, which reads the same graph, is byte-identical before and
after. An include that does not resolve is a missing *set* of columns whose
names nobody knows, so that table is refused whole (90 of the 349).

**The number that matters is the strict one.** foreman-dell asked for a
second column: the same body bound with `strictColumns`, every column
required to be in a typed scope. It says how many bodies lower only because
a column nobody described was read as STRING:

| working corpus | lowered | of which every column typed |
| --- | ---: | ---: |
| after 1b | 31 (9%) | *not measured* |
| after 2a | 41 (11%) | **7 (2%)** |

So the headline moved from 31 to 41, and 34 of the 41 are guesses. The
strict column is now printed first and quoted as the number; the other one
is there so the gap stays visible. A column whose data element is in no
dictionary is carried **marked** and refused by name when a body reads it
(or when `SELECT *` would carry it), the rule scalars already had -- so a
table is not refused for a field nobody touches.

What the strict refusals name, working corpus: `MANDT` ×8, `NULL` ×4,
`ROW_NR` ×2, `HOST` ×2. The `MANDT` ones are not a dictionary gap in the
data element (it is in the dump) but in the **table**: `USING` names
standard tables of other packages -- `SCARR`, `SFLIGHT`, `TADIR`, `SPFLI`,
`SWWCNTP0` -- and 97 of the 230 `USING` names are in no export at all. The
instrument now prints the **wanted** list: absent tables ranked by the
bodies they would let be typed, with the bodies that need two or more
flagged. Today it is short -- two tables with 2 bodies each, then ones -- because
most of the 34 guessing bodies fail strict on something else first
(`NULL`, aliases, expressions). Exporting those tables from the sandbox is
a decision, not a build step; the list is what to decide with.

The `.INCLU-XXX` rule was read off the export rather than assumed:
a demo table includes one day structure five times as `.INCLU-_MO` … `.INCLU-_FR`,
and its columns are `WORK_MO`, `FREE_MO`, … -- the suffix is appended to
every included field. Expanding without it would have produced column names
that look right and are not.

### The strict histogram, read body by body: 7 → 10, and 41 → 27 guesses

*2026-09-23, early. Slices (b) and (c) of the same branch.*

With the strict column in place the honest question became "why do the
other 34 lower only by guessing", and the answer came from reading each
one (`strict-why`, a probe over `coverage.measure().bodies`) rather than
from the histogram line, which said `column X is not present` 33 times and
nothing else. Four kinds:

| kind | bodies | what it was |
| --- | ---: | --- |
| tables in no dictionary here | 14 | `USING` names standard tables of other packages; by package: **one package 8 bodies / 8 tables**, then 2/1, 2/1, 1/3 |
| the binder, ours | 13 | an alias **without AS** (`FROM :it_x a`), NULL and TRUE read as columns called NULL and TRUE, a table qualified by its own name (`t.mandt` with no alias), ORDER BY over a projected alias (`row_nr`) |
| HANA's own views | 7 | `sys.m_host_information`, `"PUBLIC"."TABLES"`, `M_*` -- not portable in principle |
| the rest | – | `$ABAP.TYPE` casts, functions without a measured rendering |

The binder kind is fixed and the view kind is refused by name -- schema
qualifier `SYS` / `PUBLIC` / `_SYS_*`, and an unqualified `M_*` only when
the catalogue does not describe it, because the dictionary has old
matchcode views named so. `sys.dummy` stays DUMMY. NULL is an untyped
literal that a CAST, a CASE branch or a comparison types; a bare `NULL AS
x` is refused ("CAST(NULL AS <type>) says which"), and a final walk over
the IR refuses any NULL that reached the end untyped, so a path nobody
remembered (a function argument, arithmetic) cannot pass `type: undefined`
on. TRUE / FALSE are refused by name: HANA has BOOLEAN and SQLite has not.

| working corpus | every column typed | lowered with guesses |
| --- | ---: | ---: |
| after 2a | 7 (2%) | 41 (11%) |
| after (b): binder | 10 (3%) | 36 |
| after (c): views refused | **10 (3%)** | **27 (7%)** |

The second column shrinks because a guess became a named refusal, which is
the direction it should move. What is left in it is the 14 bodies whose
tables an export would bring, and the **wanted** list now prints them per
package: one package's 8/8 is one decision. The tables of HANA's own views are
kept out of that list.

Two things learned on the way, both about instruments. The "diamond" the
include expansion seemed to produce -- 16 tables with a doubled field --
was the expansion's own marker rows for two unresolved includes, both
named `.INCLUDE`; DDIC does not activate a real duplicate, and the
measurement was of the marker. And a false ambiguity: a table read bare in
both branches of a UNION was "a source twice without an alias", because
the set lived on the body rather than on the SELECT. Both found by the
count moving the wrong way and reading one body.

### 2b: a table function called in FROM, bound against a registry: 10 → 14

*2026-09-23, morning. The line that had topped the working list since the
grammar learned the bracket: 23 bodies, "a table function call in FROM is
parsed but not lowered yet".*

Looking at the 23 before writing anything: 15 call one class's functions
(one utility class's table function and two siblings),
declared in the **class** -- `CLASS-METHODS … IMPORTING value(it_configuration)
TYPE … RETURNING value(rt) TYPE …`, `METHOD … BY DATABASE FUNCTION` -- and
called with the caller's own IN table as the argument; 1 calls a DDLS table
function; 1 calls `sys.series_generate_date`. A registry built from DDLS
alone would have moved 15 bodies from one refusal to another.

So the registry has both sources (`tools/sqlscript/table-function-registry.mjs`):
every `define table function` the dictionary holds, keyed by its name and
by `implemented by method`; and every `BY DATABASE FUNCTION` method with a
RETURNING table type, keyed `CLASS=>METHOD`, its RETURNING type read through
the class's TYPES or the dictionary. On this export: **147 declarations**,
95 of them DDLS (an earlier figure of 242 counted registry keys, and a DDLS
with `implemented by method` is keyed twice). The binder looks the callee up as the body spells it -- `"CL=>M"`
and the DDLS entity are different objects on HANA, so nothing is normalised
-- binds each argument against the declared parameter (a scalar against the
parameter's resolved type, refused on a mismatch or when no dictionary
types the parameter; a table only as a table variable or an IN table of
this body), lets a
trailing OPTIONAL or DEFAULT parameter be omitted as the corpus does, and
refuses by name: a callee not in the registry, a count that does not fit,
a table argument that is an expression, a system function (`SYS.*`). The
result carries the callee's declared RETURNS as its schema.

Lowering renders the call as the source spells it, **on HANA only** and
only with scalar arguments; on DuckDB and SQLite it is "not compiled for
<dialect>", and a table-valued argument is refused everywhere: on HANA it
would have to be a table variable, which one statement does not have.

Two things were under it. abaplint reads no class definition at all out of
the classes of one package, so their methods had **no parameters**, and the body's
own `:it_configuration` was an unknown variable. The first cause I named
(a multi-line `USING` list) was wrong -- tried in isolation it parses; the
measured one is the **OPTIONS clause**: `OPTIONS SUPPRESS SYNTAX ERRORS`,
`DETERMINISTIC` and `CDS SESSION CLIENT` are all refused by the statement
grammar, and with the METHOD statement the whole class definition goes
(ANOMALY-2026-09-23-amdp-method-options: 17 of 181 AMDP classes in the
export, 12 on this clause). The extractor reads the definitions as text
when abaplint hands back none, and for a method abaplint dropped from a
definition it did read (`definitionsByText`; a section it cannot read whole
yields no parameters for that method) -- and the instrument cross-checks that reader against
abaplint on every class abaplint does read, so its trust is a printed
number rather than an assumption. And DEFAULT did not count as OPTIONAL:
`iv_convertvalues TYPE i DEFAULT 0` is why every call of
that function passes one argument.

| working corpus | every column typed | lowered with guesses |
| --- | ---: | ---: |
| after (c) | 10 (3%) | 27 |
| after 2b | **14 (4%)** | 32 |

Of the 23 bodies, the call was the *first* refusal and rarely the only one:
now that it binds, 8 stop at `CALL` (a procedure call statement), 7 at a
bare `NULL AS x`, 2 at `:im_obj` whose data element is in no dictionary
here, and exactly **one** at the table-valued argument itself. The
histogram moved to the next honest line, which is what a slice is for.

**The DuckDB route, measured by foreman-dell (DuckDB 1.5.5, `@duckdb/node-api`).**
Scalar-input table functions: yes -- `CREATE MACRO f(p) AS TABLE SELECT …`,
called as `FROM f(?)` with a bound parameter, inlined by the planner with
the caller's filters pushed into the scan, nesting works, named and
defaulted arguments work, cost against an inlined subquery 1.008×. A
relation parameter: **no** -- `CREATE MACRO f(tbl) AS TABLE SELECT * FROM
tbl` fails at CREATE, `f((SELECT …))` fails ("cannot contain subqueries");
what works is `query_table(name)` over a table, a view or **the caller's
CTE**, so an IN table has to be named first. A direct self-reference fails
at CREATE, a two-macro cycle only at call ("max expression depth"), so the
cycle guard is ours. Dependencies are not tracked (DROP MACRO succeeds
under a user). An untyped macro parameter takes the type of whatever is
bound; declare them typed. And DuckDB has no blank-padded CHAR: `'A  ' =
'A'` is false, which settles the DuckDB column of the trailing-blank
conformance case before the HXE column exists.

### The wanted tables, read off the sandbox: 14 → 27

*2026-09-23. Alice's standing permission for A4H reads, with foreman-dell
as the critic of the plan.*

The wanted list named 17 standard tables in no dictionary we had. Exporting
their packages was the wrong granularity: the owning packages hold 424 to
2225 objects each, far past the 500 we agreed as
the stop line, and a package export brings same-package includes only. The
route taken reads the **runtime dictionary** instead: one `vsp query DD03L`
per table (active version). DD03L on the system already carries the fields
of every include expanded as rows of their own, each with DATATYPE / LENG /
DECIMALS inline -- so there is no closure to walk over DTEL, DOMA and
included structures, and the `.INCLUDE` rows are dropped when the table is
written in abapGit shape, or the type graph would splice them a second
time. The definitions (no contents) live in `.local/a4h-ddic/`, never
tracked, and `coverage.mjs --ddic .local/a4h-ddic` reads them unchanged.

| | every column typed | on all four dialects |
| --- | ---: | ---: |
| working, before | 14 (4%) | 6 |
| working, with the 17 tables | **27 (7%)** | 18 |
| teaching, before | 16 | 14 |
| teaching, with the 17 tables | **18** | 16 |

The wanted list is empty except TADIR (one teaching body), left out on
purpose. The next strict line was the binder's: a bare `NULL AS x`, whose
type on HANA comes from the other branch of a UNION or from the declared
output it is assigned to. Typed that way: working, every column typed,
**27 -> 32**.

### What the runtime compiles: 0 → 13, and the number to quote from now on

*2026-09-23. foreman-dell: "0 of 364 is the most important number of the branch".*

Every figure above counted what the **relational binder** lowers to SQL.
`compileProcedure` -- the compiler `amdp-gen` and the runtime use -- had
never been pointed at the corpus. Pointed at it, it accepted **none**:

| working corpus | compiles as a procedure |
| --- | ---: |
| `main` after #23 | 0 |
| + dictionary-typed table parameters, DDLS RETURNS as the output | 1 |
| + a final `RETURN`, a body wrapped whole in `BEGIN … END` | **13 (4%)** |

The refusals, looked at before anything was built: 222 bodies stop in the
grammar (the binder's boundary too); 126 have no output in the class at all,
and 77 of those are CDS table functions whose output is the DDLS `RETURNS`;
table-typed parameters named table types of the **dictionary**, which the
compiler did not read; and every table function ends in `RETURN`, which it
did not compile, inside a `BEGIN … END` around the whole body, which it
refused. Each is now handled narrowly:

- a dictionary table type (TTYP → TABL) is admitted only when every field's
  DDIC datatype is one of the measured ones (CHAR, DATS, TIMS, INT4, STRG,
  DEC); anything else refuses the parameter by name;
- a `RETURN` only as the last statement, only into a table output;
- only the outermost block, plain or `SEQUENTIAL EXECUTION`, is unwrapped.

Tested as procedures on DuckDB and SQLite; `gen/amdp` for this tree differs
from `main` in one refusal's wording only. The coverage report now prints
this number first; the binder's numbers follow it and say "lowers, not yet
runs". Next walls, working corpus: CLNT parameters (`mandt`, `abap.clnt`,
24 bodies -- milestone 3, the CHAR input case), and signatures with more
than one output (19 left after the table functions; 28 of the multi-output
ones are two tables).

### Character inputs at the runtime gate: 13 → 15, and what is under them

*2026-09-23. The rule measured on A4H (docs/sqlscript-hana-observed.md), put
where the runtime binds.*

The procedure compiler and the runtime admitted INTEGER and STRING inputs
only. They now admit a fixed-length character input `C(n)` -- CHAR, and
CLNT, DATS and TIMS, which all arrive as `C(n)` -- bound as the kernel
binds it: trailing blanks removed, a leading blank kept, `''` when initial
and not NULL, a value longer than the field refused rather than cut, a
text-literal DEFAULT right-trimmed. The trim happens **only at the input
boundary**: a scalar the body declares is an NVARCHAR, and HANA keeps its
blanks. CLNT joined the measured datatypes. Tested as procedures on DuckDB
and SQLite against a column of right-trimmed values.

| | compiles as a procedure |
| --- | ---: |
| working, before | 13 |
| working, after | **15** |
| teaching, before / after | 0 / 2 |

What moved, counted per body against `main` rather than read off the
histogram: of the two working bodies that newly compile, one has a client
parameter and the other a character, date or RAW input that was refused
before; the two teaching ones have no client parameter.

The 47 working bodies with a client parameter, before and after:

| | `main` | this change |
| --- | ---: | ---: |
| compile | 0 | 1 |
| stop in the grammar | 22 | 22 |
| refused on a parameter type | 22 | 20 |
| other refusals | 3 | 4 |

So the client input was rarely the only thing missing: of the 22 refused
on it, one now compiles, one moved to an unknown column, and 20 name
another element type not measured yet (NUMC among them, and the GUIDs of
one package, which RAW now admits as inputs but which stop elsewhere). RAW
was measured the same day (docs/sqlscript-hana-observed.md) and is admitted
the same way. The grammar is the next bulk.

### Named arguments in a table-function call, and the data elements behind them: 15 → 17

*2026-09-23. The first grammar step, bucketed by the construct behind the
stop token rather than by body order, and reported per body.*

The grammar stopped at `=>` in 12 working bodies: a table function called
with named arguments (`p => :v`) or through an unquoted `CL=>M` callee. Both
parse now, and the binder binds named arguments by the parameter's name and
refuses a mix, an unknown or repeated name and a missing required one. Per
body against `main`: 12 bodies newly parse (working 140 → 145, teaching
60 → 67), and **none** compiled -- 11 of them stopped at a parameter typed
by a data element that no dictionary here held.

So the next step was the dictionary again. Every data-element name a
signature, a RETURNS list or a class-local structure of the corpus names
and nothing resolves was collected (394), the class-local and interface
type names set aside (191; not data elements), and the other 203 read from
the sandbox's DD04L, active version, definitions only, into
`.local/a4h-ddic`. 171 were found; the 32 the sandbox has no DD04L entry
for are table types, type-pool types and local names -- real gaps, not
fetch misses.

| | before | after the DD04L read |
| --- | ---: | ---: |
| working, compiles as a procedure | 15 | **17** |
| teaching, compiles as a procedure | 2 | **3** |
| working, lowers with every column typed | 32 | 33 |

Twelve bodies changed their parameter-type refusal: three now compile, the
rest moved on -- to HANA's own views (refused by name), to columns no
catalogue describes, to a STRING scalar in a DECLARE (host string scalars
are the milestone that opens those), to an untyped CAST.

### WITH, TOP n and the type pool ABAP: parses more, compiles the same

*2026-09-23. The next grammar bucket, measured per body against the step
before it.*

`WITH name AS (...)` binds its common table expressions in order, each
seeing the ones before it, scoped to the select that carries them, and
shadowing a table of the same name as SQL does; a column list
`x (a, b) AS (...)` renames the projected columns in order. A name defined
twice, a column-count mismatch, a reference to a CTE defined later and
`WITH RECURSIVE` are refused by name. `SELECT TOP n` takes n rows after the
statement's ORDER BY, which is where HANA applies it; the count must be an
INTEGER literal or input, and TOP together with LIMIT, or TOP inside one
branch of a set operation, is refused by name rather than given a reading.
Both run as procedures on DuckDB and SQLite (`test/sqlscript-procedure-scope.mjs`).
`abap_bool` is the type pool ABAP's `c LENGTH 1` and binds as a CHAR 1.

Not lowered yet, and refused by name rather than blamed on a column: a
statement-level `ORDER BY a.id`, a source qualifier after the projection.
The statement's ORDER BY sees the projected columns only; `ORDER BY id`
works. No body of the corpus is known to need it; a verifier found it
while testing a self-join on a CTE.

Per body: 6 bodies newly parse, and **none** compiled -- three stop at an
output whose table type is not resolved, two at a parameter type, one at a
column no catalogue describes. `abap_bool` alone moved no body. Compiles
stays at 17 working and 3 teaching. Parsed, for the whole branch against
`main`: working 140 → 149, teaching 60 → 69.

What that says about the next step: after the grammar, the largest single
refusal is not a construct but the procedure's shape. 46 bodies
(19 working, 27 teaching) stop at "exactly one OUT or RETURNING output";
more than one output table is the next runtime milestone, ahead of more
grammar. Parameter types (67) and unresolved output table types (23) are
the dictionary's share.

### A table function is found by the entity it defines: 17 → 18

*2026-09-23. Measured before building: of the 83 working bodies with more
than one output, 72 do not parse and only 2 would pass their signature,
and those 2 need INT2. So multiple outputs, planned next, would have moved
no body. The measurement pointed elsewhere.*

Twelve table functions parsed and still stopped at "exactly one OUT or
RETURNING output", because no RETURNS list reached them. Their DDLS was
reported "not in the export". For five of them it was never missing:
**a DDL source's file name need not be the entity it defines.** The AMDP
names the entity in `FOR TABLE FUNCTION`, and the dictionary looked it up
by file name. The folder dictionary now also indexes a DDLS by its
`define ... <entity>` name, with the file name still taken first
(`test/sqlscript-table-function.mjs`). The twelve sources and the 22 data
elements their RETURNS lists name were read from the sandbox, definitions
only, into the gitignored `.local/a4h-ddic`.

| | before | after |
| --- | ---: | ---: |
| working, compiles as a procedure | 17 | **18** |
| teaching, compiles as a procedure | 3 | 3 |

**Which change moved the body.** The one body that now compiles names a
table function whose DDL source is called like its entity. It moved
because its source was read from the sandbox, not because of the entity
lookup. The five bodies the lookup reaches stop further on, at NUMC (3), a
HANA system view and a RAW data element. The twelfth DDLS also needed `--`
comments stripped: a source written on a system uses them, and its
commented-out parameter list was read as a parameter. One quote-aware
comment stripper now serves the entity lookup and the table-function
reader (`tools/ddls-entity.mjs`).

All twelve bodies now reach their signature and stop here:

| now stops at | bodies |
| --- | ---: |
| a column typed INT2 (`xunumber`) | 4 |
| NUMC in a RETURNS list | 3 |
| INT8 in a RETURNS list | 1 |
| a RAW data element in a RETURNS list | 1 |
| a HANA system view | 1 |
| a column the scope does not type | 1 |
| compiles | 1 |

INT2 blocks table parameters in 38 bodies across the corpus and now these
4 as well. It is the next measurement on the sandbox.

### INT2, measured: 18 → 21

*2026-09-23. INT2 blocked a table parameter in 38 bodies and a RETURNS
column in 4 more. It was measured on the sandbox first
(`docs/sqlscript-hana-observed.md`); INT2 is now a measured datatype, an
INTEGER in every expression, range-checked at the input bind and at the
output boundary.*

| | before | after |
| --- | ---: | ---: |
| working, compiles as a procedure | 18 | **21** |
| teaching, compiles as a procedure | 3 | 3 |

Three bodies went from an INT2 field to compiling. The others moved on:
four to a column the scope does not type, three to a table function the
registry does not hold, one to another untyped column, one to a field
still unresolved.

### SELECT ... INTO: the largest parse bucket, 149 → 183 read

*2026-09-23. The bodies the grammar stopped were re-bucketed by the
statement they stopped in, not by the token (with a local script, kept out
of the repository, over the corpus). The largest group was `SELECT … INTO` scalars, 53 bodies,
nearly all `SELECT COUNT(*) INTO lv FROM …`. Measured on A4H first.*

`SELECT … INTO a, b [DEFAULT x, y]` parses and compiles into a step of its
own: the engine is asked for two rows, one assigns, none raises unless a
DEFAULT is given, two raise always, as on A4H. The targets must be declared
scalars of the columns' types; a BIGINT fills an INTEGER, range-checked. Two
items of one name in any select are refused where it is bound, since they
collapse into one key of the schema and of an answer's row (a critic found
the first version of that check taking the `*` of `count(*)` for a
`SELECT *`). COUNT, MIN and MAX are typed in every relation now, not only
here. The same
step fixed an old grammar defect: a body whose statements went on after a
bare `SELECT …;` could not be read at all, because the first reading of the
body matched that prefix and committed.

| | before | after |
| --- | ---: | ---: |
| working, parsed | 149 | **183** |
| teaching, parsed | 69 | 71 |
| working, compiles as a procedure | 21 | 21 |

No new body compiles yet. Of the 34 that now read: 16 have more than one
output, 5 a table parameter with a field still unresolved, 4 a scalar that
is not an INTEGER (host string scalars), and single ones a scalar output
that is not a table, a system view, an untyped column. The rest still stop
in the grammar, further on. Multiple outputs are now worth building: 16
bodies wait on them, against 0 when they were first measured.

### Several OUT tables, and five domains: 21 → 25

*2026-09-23. Multiple outputs, measured on A4H first
(`docs/sqlscript-hana-observed.md`), then the dictionary gaps the newly
compiled signatures reached.*

Several OUT tables compile and run: each OUT is what the body assigned, an
empty table where the path taken assigned none, an OUT assigned nowhere is
refused as HANA refuses it. The results travel back through the AMDP
destination into ABAP, one target per OUT, which the demo class now
exercises (`split_amounts`, ABAP Unit on DuckDB).

On its own that moved no body -- the 23 bodies it reached stopped at the
next thing: 13 at table-type fields whose domain no dictionary here held.
Five domains and one data element read from the sandbox (definitions only,
gitignored) resolved them.

| | before | after |
| --- | ---: | ---: |
| working, compiles as a procedure | 21 | **25** |
| teaching, compiles as a procedure | 3 | 3 |

What the moved bodies stop at now: a UTCL timestamp field (10, a datatype
not measured yet), a non-INTEGER DECLARE (6, host string scalars), a table
function not in the registry (6), a scalar OUT beside table OUTs.

### String scalars and scalar outputs: 25 → 29

*2026-09-24. The largest single runtime feature by body count, measured on
A4H first (`docs/sqlscript-hana-observed.md`).*

A body may now declare text, BIGINT and BOOLEAN variables, assign them by
the measured rules (a text kept as it is, a number into a text its digits,
too long raised), fill them by `SELECT ... INTO`, test them in IF / WHILE,
and hand text or INTEGER scalars back: a STRING or `c LENGTH n` RETURNING,
and scalar OUTs beside table OUTs (`abap_bool`, `string`, `i`), each its
initial value where the path left it alone. What the host does not
evaluate goes to the engine as a one-row SELECT.

| | before | after |
| --- | ---: | ---: |
| working, compiles as a procedure | 25 | **29** |

What the moved bodies stop at now: a nested `BEGIN ... END` block (9),
several scalar OUTs with no table OUT (4), a scalar OUT of an unmeasured
type, and single ones further on.
