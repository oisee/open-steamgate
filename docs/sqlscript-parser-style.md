# The SQLScript parser, written the way abaplint is written

*A standard, fixed before the first line (Alice, 2026-09-19: it must not look
like a dirty hack next to Lars's code). Everything below is read off
`@abaplint/core` rather than invented: if this parser ever goes upstream, or
even if it only sits beside the transpiler, it should look like it belongs.*

## What his code actually looks like

abaplint parses ABAP in **numbered stages**, one directory each: `1_lexer`,
`2_statements`, `3_structures`, `5_syntax`. Nothing skips a stage and nothing
reaches back into an earlier one.

Inside `2_statements`, the grammar is **combinators, not regular
expressions**. `combi.ts` exports `str`, `tok`, `seq`, `alt`, `altPrio`,
`opt`, `optPrio`, `per`, `star`, `plus`, `ver`, `stopBefore` -- and `regex`,
which matches **one token**, never a span of source. A construct is one file,
one class, one method:

```ts
export class SQLFrom extends Expression {
  public getRunnable(): IStatementRunnable {
    return seq("FROM", new SQLFromBody());
  }
}
```

A statement is thinner still -- it names the expression that matches it:

```ts
export class Select implements IStatement {
  public getMatcher(): IStatementRunnable {
    return new SelectExpression();
  }
}
```

That is the whole shape: **a grammar expressed as data, in files named after
the constructs, with one class per construct.**

## The four rules this gives us

1. **One construct, one file, one class, named after the construct.**
   `assignment.ts`, `table_variable.ts`, `for_loop.ts`, `exec_immediate.ts`.
   Somebody looking for how `UPSERT` is parsed opens `upsert.ts`. The
   docs/sqlscript-surface.md list is therefore also the file list, and the
   coverage numbers in docs/sqlscript-corpus.md say which files to write
   first: the 25 constructs that cover 80% of bodies, then the 62 that cover
   90%.

2. **No regular expression sees more than one token.** This is the rule that
   decides whether it reads as a hack. We have paid twice for the opposite --
   a transformation that must tell a literal from the rest of a statement
   cannot be done in one pass over text -- and the HANA client's identifier
   folding walks the statement for exactly that reason. A parser gets the
   same discipline for free if the grammar is combinators over a token
   stream.

3. **Lexing is its own stage, and it is where SQLScript differs most.** The
   token rules that are not ABAP's: `:var` host variables (the colon that
   abaplint reads as ABAP's chaining colon -- abaplint/abaplint#4307), `--`
   and `/* */` comments, `#tmp` names, doubled quotes inside literals,
   `"quoted identifiers"`. None of that belongs in the grammar; all of it
   belongs in the lexer, once.

4. **Dialect differences are `ver`, not `if`.** abaplint gates syntax on the
   ABAP version with `ver(Version.v754, ...)` inside the grammar. Ours gate
   on the engine the same way, in the same place -- not with a branch in a
   code generator downstream, which is where dialect handling goes to die.

## What the parser produces, and what it does not

It produces the tree the combinators produced -- **nodes named after the
expressions**, nothing rebuilt afterwards. The splitter
([`sqlscript-splitter.md`](sqlscript-splitter.md)) lowers **from that tree**
into the intermediate representation; it does not get a second, friendlier
tree invented for its convenience. Two trees means two places for the
semantics to disagree.

It does **not** do name resolution, typing, or planning. Those are later
stages, in the abaplint sense: a parser that starts resolving table names is
a parser that cannot be tested on a fragment.

## How we will know it is not a hack

- Every construct in `docs/sqlscript-surface.md` is either a file or an
  explicit, named refusal. No silent "not supported yet" holes.
- A refusal says what it refused and where, with a line and a column, because
  that is what HANA does and it is the standard the sandbox already meets.
- The tests are per construct and per file, the way abaplint's are, and a new
  construct arrives with its own test rather than with a line in a big one.
- Nothing in the parser knows what a database is.

## Order of work, from the numbers we already have

`docs/sqlscript-corpus.md`: 25 constructs cover 80% of the bodies measured,
62 cover 90%, and `CE_*` operators, `MAP_MERGE`, `MAP_REDUCE` and cursors
appear in **zero** bodies out of 509. So the first 25 files are known by
name, the refusals are known by name, and the order is a measurement rather
than a guess.
