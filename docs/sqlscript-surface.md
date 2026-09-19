# The SQLScript surface, enumerated

*What the language has, in our words, so that translating it stops being an
open-ended job and becomes a list with a known length. Written 2026-09-18 for
the AMDP work (G.8, W.3) and for the `FOR DUCKDB` question.*

**Why this document exists.** A probe can confirm a construct we already know
about; it cannot tell us a construct exists. That half comes from the
reference — Brandeis, *SQLScript for SAP HANA*, 2nd ed., which is on the
network disk as plain text. The section numbers below point into it; nothing
of its text or its examples is reproduced here, and none belongs in this
repository. What is ours: this list in our own words, the probes we write, and
what the engine answers when we run them. **A measured fact about an engine
belongs to nobody.**

**How the table is meant to be filled.** Five columns, and three different
sources, because each catches something the other two miss:

| source | what only it can give |
| --- | --- |
| the reference | that a construct **exists** — the enumeration |
| the corpus (194 AMDP classes on the sandbox) | how **often** it is actually used |
| the engine itself | what **this version** really does, including the error text and position when it refuses |

The third is the one that is easy to forget and the cheapest to run: a
`CREATE PROCEDURE` that fails answers with a line and a column. Columns:
**construct · corpus frequency · our plan · probe · what the engine said.**
This file carries the first and third of those; the frequency column is filled
on the machine that has the sandbox.

---

## The line the language draws itself

The reference separates **declarative** programming (chapter 3) from
**imperative** programming (chapter 6), and that is exactly the split our
translation needs, which is a good sign that the split is real rather than
convenient:

- **Declarative** — a chain of table variables assigned from `SELECT`s. This
  maps onto a chain of common table expressions almost one for one, and it
  runs on any SQL engine. It is the shape most AMDP is written in.
- **Imperative** — loops, branches, cursors, arrays, exceptions. No engine we
  target has a procedural language at all (neither DuckDB nor ClickHouse has
  stored procedures), so this half is not a dialect question: **we interpret
  the shell and hand the engine plain statements**.

So "SQLScript on DuckDB" is not a port. It is an interpreter for the second
half plus a translator for the first, and the same interpreter works over
SQLite, which is what the browser preview already has.

---

## A. Declarative core — translate to SQL

| construct | ref | plan |
| --- | --- | --- |
| table variables: declare, assign from a `SELECT`, read in a `FROM` | 3.1 | a CTE, or a temp table when it is read more than once |
| `SELECT` clauses, field list, `FROM`, joins | 3.2.1–3.2.4 | pass through, dialect differences only |
| `WHERE`, `WITH`, `GROUP BY`, `HAVING`, `ORDER BY` | 3.2.5–3.2.9 | pass through |
| set operators, subqueries, alias names | 3.2.10–3.2.12 | pass through |
| `INSERT` single and multi-row | 5.1 | multi-row `VALUES` is **not** portable — measured against HANA Express already; bind an array instead |
| `UPDATE`, simple and with reference to other tables | 5.2 | `UPDATE … FROM` differs per engine |
| `UPSERT` / `REPLACE`, `MERGE INTO` | 5.3, 5.4 | no portable form; per-engine |
| `DELETE`, `TRUNCATE TABLE` | 5.5, 5.6 | pass through |

## B. Imperative shell — interpret

| construct | ref | plan |
| --- | --- | --- |
| local scalar variables, local table variables | 6.1.1, 6.1.2 | interpreter state |
| session variables, temporary tables | 6.1.3, 6.1.4 | session row; temp tables per connection |
| `IF` / `ELSE` | 6.2 | interpreter |
| `FOR`, `WHILE`, loop control (`BREAK`, `CONTINUE`) | 6.3 | interpreter — this is where a Z80-shaped body gets slow |
| cursors: `FOR` over a cursor, explicit open/fetch/close, updatable | 6.4 | interpreter over a result set; updatable cursors probably refused |
| arrays: build, index, as locals, split and concatenate, array ↔ column | 6.5 | interpreter; `UNNEST` is the bridge to tables |
| transaction control, autonomous transactions | 6.6 | ours already (the LUW bracket); autonomous ones have no counterpart — refuse loudly |
| dynamic SQL and its parameters | 6.7 | interpreter, and a hazard: it defeats static analysis |
| exceptions: what they are, raising, catching | 6.8 | interpreter, mapped onto our own error type |

## C. HANA's own operators — special, or refused

| construct | ref | plan |
| --- | --- | --- |
| calculation engine plan operators | 3.3.1 | refuse; they name an engine we do not have |
| `MAP_MERGE` | 3.3.2 | rewritable as a join in most uses — check the corpus before deciding |
| `MAP_REDUCE` | 3.3.3 | refuse until something in the corpus needs it |

## D. Types and built-ins — the largest hidden cost

Not one construct but hundreds of small ones, and the place where a
translation quietly returns a different number rather than an error. Strings
and their conversions and functions, plus the `SQLSCRIPT_STRING` library
(4.1); dates and times, and processing them (4.2); numbers — arithmetic, roots
and exponents, logarithms, rounding and trimming, trigonometry, random, sign,
quantities and amounts (4.3); binary data, hex ↔ string, bits and bytes (4.4);
and conversions between types (4.5).

**Rank this by the corpus, but enumerate it from the reference**, and the
difference matters. The corpus says what will diverge *for us*; the reference
says what *can* diverge, and the dangerous remainder is the third set — a
function that is in the reference, absent from the corpus, and present in the
first outside class somebody brings. So a construct nobody uses gets a row
with **frequency zero**, not no row at all: a missing row reads as "we have
not looked", a zero reads as "we looked and it was not there". What does
appear needs a probe each, because this is exactly the class of difference we
have already been bitten by twice — the character-literal calculation type and
the date conversions.

## E. Containers and database objects — mostly outside a read-only body

Blocks, procedures, user-defined functions, libraries (2.3); creating,
changing and dropping tables (7.1); table types (7.2); views (7.3); sequences
and their increment, limits, overflow behaviour and reset (7.4); triggers and
whether they fire per row or per statement (7.5).

A read-only body touches almost none of this, which is another argument for
taking read-only bodies first.

## F. The ABAP boundary — measured on the ABAP sandbox, not on the engine

| construct | ref | why it matters here |
| --- | --- | --- |
| AMDP methods, the objects they generate, their lifecycle | 8.1.1–8.1.4 | our bridge already cuts the body out and deploys it; the lifecycle is what makes redeployment safe |
| AMDP calling AMDP | 8.1.6 | composition — a body is not always a leaf |
| CDS table functions and the objects behind them | 8.2.1, 8.2.2 | we generate these already |
| **implicit client handling in CDS table functions** | 8.2.3 | this is the MANDT question in its SQLScript form; whatever it does is what our detector should expect. Measured on the **ABAP** sandbox, not on the engine: a bare HANA knows nothing about a client, so this row has two answers — what the engine said and what the application server said — and needs a column for each |
| AMDP table functions, scalar AMDP functions | 8.3 | two more shapes the bridge must recognise |

## G. Basics that bite without announcing themselves

Literals, identifiers, access to locals and parameters with the colon prefix,
system variables, reserved words, operators, predicates, data types, `NULL`,
and the `DUMMY` table (2.2). The colon is already a known hazard on our side:
abaplint reads a SQLScript colon as an ABAP chain colon, which cuts the
statement in two and loses the colons — reported upstream.

---

## Two things read here that belong to other tracks

**There is an AMDP debugger in the ABAP development tools** (11.2.2), and a
SQLScript debugger besides (11.2.1, 11.2.3). Whatever protocol the first one
speaks is a thing a façade will eventually be asked for, and it shares its
schemas with the step-trace oracle. Worth knowing before designing either.

**Chapter 9 is entirely about Business Warehouse transformation routines** —
start, end, expert and field routines written as AMDP. If the corpus on the
sandbox turns out to be mostly these, it is mostly **generated** code, and a
frequency count over it measures a generator's habits rather than how people
write SQLScript. Check what the classes are before trusting the histogram.

---

## What the frequency column is for, and the number it is not

A frequency per construct says how often a thing appears. It does **not** say
how much of the corpus we can translate, and the difference is not small: a
body needs **all** of its constructs, so implementing the three most frequent
ones can still leave every body blocked by its own fourth. The number that
answers "what do we build first" is cumulative and per body:

- **bodies fully covered** by the top *n* constructs — the only progress
  curve that means anything, and it starts lower and rises later than the
  per-construct percentages suggest;
- **bodies blocked by exactly one missing construct** — the cheapest work
  available at any moment, and the list changes every time something lands;
- **bodies that can never be covered**, because what they use has no portable
  form at all. `XMLTABLE` and `HIERARCHY` are in this class. That is a
  ceiling, not a backlog item, and stating it early keeps it from being
  rediscovered as a disappointment.

## Where the numbers live

**Not here.** Every measured figure belongs to `docs/sqlscript-corpus.md`,
which is produced by `tools/amdp-corpus.mjs` on the machine that has the
sandbox. This file owns the enumeration and the method; that one owns the
counts. Two files carrying the same numbers is how two files come to disagree,
and the first draft of this section made exactly that mistake — it copied a
first-pass table that the full export then superseded within the hour.

What the counts have settled so far, in one line each, with the detail and the
sample size over there: the calculation engine operators, `MAP_MERGE`,
`MAP_REDUCE` and cursors are **measured zeros** across the whole corpus, so
section C is refused on evidence rather than on preference; the imperative half
of section B is thinner than it looks, branching and assignment first; and the
teaching corpus turned out **poorer** than the work corpus rather than richer,
because the corners of the language are spread across the set of demo classes
rather than packed into each body.

That last fact has a use neither of us expected. A corpus that is small,
real, and **completely covered by the first dozen constructs** is not a
surface list — it is an **acceptance suite**. Build the interpreter, run it
over those bodies, and the target is not a percentage to argue about but
100%, on code somebody else wrote.

## Reading the coverage curve without being misled by it

Two cautions about the shape, both of which change what gets built:

- **The curve has no cliff.** Each construct adds a few points and the line
  keeps climbing, so the corpus will never tell us where to stop. That
  decision has to come from outside it — from what a demo needs, or a time
  box, or a named target — and pretending the data chose it is how a project
  ends up implementing a language for its own sake.
- **Order by cost, not by count.** The greedy curve treats every construct as
  costing the same, and they do not: `GROUP BY` and the joins are pass-through
  to the engine, while dynamic SQL and `CALL` are real machinery. Re-read the
  same table with an effort estimate beside each row and the order changes.
  Worth noticing while reading it: most of the top of that curve is **plain
  SQL**, which the engine already does. The genuinely SQLScript-specific work
  in the first dozen is a short list — table variables, scalar `DECLARE`,
  `IF`/`ELSE`, `CALL`, session variables, dynamic SQL — and of those only
  `CALL` is structural, because it needs a procedure registry and a call
  stack. The coverage is bought far more cheaply than the row count suggests.

---

## The language here is not SQLScript. It is SQLScript as ABAP hands it over

This document enumerates the language from the reference, and for most
questions that is the right source. For one class of question it is not the
last word, and the class is easy to miss because it does not look like a
language question at all.

An AMDP body lives **inside an ABAP method**, and ABAP's own lexical
conventions reach into it. Two cases, both found by the corpus rather than by
reading:

- **`*` in column one is a comment**, because ABAP says so. SQLScript says
  nothing of the kind, and `*` anywhere else is multiplication — so the rule
  is positional, not textual, and it was the single largest blocker in the
  corpus at one point (40 bodies) while looking like a parser bug.
- **`"` is *not* a comment**, although in ABAP it usually is. Settled by
  counting rather than by argument: of 473 corpus bodies, 232 contain a double
  quote and **189 contain something shaped like a quoted identifier** —
  `"STATUS"`, `"OBJECT"`, generated procedure names — in SQL positions. Those
  bodies run in production; if the scanner ate the rest of the line they would
  not. A lexer that treated `"` as a comment would silently destroy two bodies
  in five.

**So for this class the reference is what reaches the database, not the
book.** Where the two disagree, the one that executes wins, and the cheap way
to settle such a question is to count the corpus or to look at the deployed
procedure text — both of which have now answered one each, in opposite
directions, which is exactly why neither could be guessed.

It is worth stating because it moves the source of truth for a whole family of
questions, and the next person to open the reference should know that the
reference is not the last authority here.
