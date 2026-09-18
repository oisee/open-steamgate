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

## Measured zeros, kept as rows

A construct nobody uses is a row with a zero in it, never a missing row —
see the rule above. Measured on the ABAP sandbox, 15 packages of 67, 246
work bodies and 82 teaching bodies (a first pass; the final count supersedes
these):

| construct | work corpus | teaching corpus |
| --- | ---: | ---: |
| calculation engine operators (`CE_*`) | 0 | 0 |
| `MAP_MERGE`, `MAP_REDUCE` | 0 | 0 |
| cursors | 0 | 0 |
| arrays | 0 | 0 |
| `BREAK` / `CONTINUE` | 0 | 0 |

So the plan for section C above — refuse the calculation engine operators —
is now measured rather than preferred, and the imperative half of section B
is thinner than it looks: branching and assignment first, loops and cursors
whenever.

**And one measured surprise, worth keeping because it corrects a plausible
guess.** The teaching classes were expected to be *richer* than the work
corpus, on the argument that they are written to show the corners of the
language. They are poorer: no `UNION` at all against 51% of work bodies, no
`IF` against 30%. The corners are in the *set* of classes, not in each body —
every demo shows one feature in the simplest body that can show it. A
property of a collection was read onto its elements.
