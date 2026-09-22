// One construct, one file, one class, named after the construct
// (docs/sqlscript-parser-style.md). The order these arrive in is the order
// docs/sqlscript-corpus.md measured: the 25 constructs that cover 80% of the
// bodies on the sandbox, starting with the two that cover the most.
import {Expression, seq, alt, altPrio, opt, star, plus, str, tok} from "../combi.mjs";
import {TokenKind} from "../lexer.mjs";

/** a name: unquoted, or quoted and therefore exact */
export class Name extends Expression {
  getRunnable() {
    return altPrio(tok(TokenKind.quoted), tok(TokenKind.identifier));
  }
}

/** t.col, "T"."COL", col */
export class ColumnRef extends Expression {
  getRunnable() {
    return seq(new Name(), star(seq(".", new Name())));
  }
}

/** a value: a literal, a host variable, or a bound parameter placeholder */
export class Value extends Expression {
  getRunnable() {
    // the placeholder is matched as an **operator token**, not with str():
    // str() produces a `word` node whatever the token was, and a `?` that
    // arrives as a word is indistinguishable downstream from the keyword it
    // is not. It cost one failing case to notice.
    return altPrio(tok(TokenKind.string), tok(TokenKind.number), tok(TokenKind.host),
      tok(TokenKind.operator, /^\?$/));
  }
}

/** FN(a, b) -- the call shape, which the corpus says is most of the work */
export class FunctionCall extends Expression {
  getRunnable() {
    // `*` is an argument as well as a select item: COUNT(*) stopped 24
    // working bodies and 14 teaching ones, and the grammar accepted `*` in
    // only one of the two places it appears (tools/sqlscript/coverage.mjs)
    // `STRING_AGG(x, ',' ORDER BY position)` -- an ordering **inside** the
    // call, which is not decoration: without it the concatenation order is
    // unspecified on every engine, so the ORDER BY is the only thing that
    // makes the answer a value rather than a sample.
    return seq(tok(TokenKind.identifier), "(",
      opt(altPrio("*", seq(new Expr(), star(seq(",", new Expr()))))),
      opt(seq(str("ORDER"), str("BY"), new OrderKey(), star(seq(",", new OrderKey())))), ")",
      opt(new Window()));
  }
}

/** HANA's regex replacement is function-shaped but uses keyword arguments:
 * `REPLACE_REGEXPR(pattern IN subject WITH replacement OCCURRENCE ALL)`.
 * Only the all-occurrences form measured for the portable transform branch
 * is admitted here; flags, offsets and numbered occurrences remain named
 * future capabilities rather than being silently discarded. */
export class ReplaceRegexpr extends Expression {
  getRunnable() {
    return seq(str("REPLACE_REGEXPR"), "(", new Expr(), str("IN"), new Expr(),
      str("WITH"), new Expr(), str("OCCURRENCE"), str("ALL"), ")");
  }
}

/** `OVER ( PARTITION BY a, b ORDER BY c DESC )`.
 *
 *  Measured on all three engines before it was written: ROW_NUMBER, RANK,
 *  DENSE_RANK and an aggregate over a window answer identically, ties
 *  included, and the syntax is the same on each. The frame clause
 *  (`ROWS BETWEEN ...`) is deliberately absent -- nobody has measured it. */
export class Window extends Expression {
  getRunnable() {
    return seq(str("OVER"), "(",
      opt(seq(str("PARTITION"), str("BY"), new Expr(), star(seq(",", new Expr())))),
      opt(seq(str("ORDER"), str("BY"), new OrderKey(), star(seq(",", new OrderKey())))),
      ")");
  }
}

/** an expression, with the precedence SQL gives it */
export class Expr extends Expression {
  getRunnable() {
    return seq(new Term(), star(seq(alt("+", "-", "||"), new Term())));
  }
}

export class Term extends Expression {
  getRunnable() {
    return seq(new Factor(), star(seq(alt("*", "/", "%"), new Factor())));
  }
}

export class Factor extends Expression {
  getRunnable() {
    return altPrio(
      new Cast(),
      new Case(),
      new ReplaceRegexpr(),
      new FunctionCall(),
      new Value(),
      seq("(", new Expr(), ")"),
      new ColumnRef());
  }
}

/** `CAST(x AS NVARCHAR(36))`, and the AMDP spelling
 *  `CAST(x AS "$ABAP.type( cds_get_rsau_log-sal_data )")`.
 *
 *  It is not a FunctionCall with a funny argument: `AS` is a keyword in the
 *  middle, so the ordinary call shape fails at it -- which is precisely what
 *  the histogram was saying with "at AS", 12 bodies. And it earns its own
 *  node downstream, because a cast is one of the two places the three engines
 *  measurably disagree (tools/sqlscript-lower.mjs). */
export class Cast extends Expression {
  getRunnable() {
    return seq(str("CAST"), "(", new Expr(), str("AS"), new TypeName(), ")");
  }
}

/** `CASE x WHEN a THEN b ELSE c END` and `CASE WHEN p THEN b ... END`.
 *
 *  The searched form is tried first, and the order is load-bearing rather
 *  than tidy: a keyword is an identifier to the lexer, so `opt(Expr)` in
 *  front would happily swallow the `WHEN` of the searched form and then fail
 *  looking for one. Writing the alternative that cannot mis-start first is
 *  the cheap fix; the same trap has cost this grammar three defects. */
export class Case extends Expression {
  getRunnable() {
    return seq(str("CASE"),
      altPrio(
        plus(seq(str("WHEN"), new Condition(), str("THEN"), new Expr())),
        seq(new Expr(), plus(seq(str("WHEN"), new Expr(), str("THEN"), new Expr())))),
      opt(seq(str("ELSE"), new Expr())), str("END"));
  }
}

/** a comparison, which is what a WHERE is made of */
export class Predicate extends Expression {
  getRunnable() {
    return altPrio(
      seq(str("EXISTS"), "(", new SetOperation(), ")"),
      seq(new Expr(),
        opt(altPrio(
          seq(str("IS"), opt(str("NOT")), str("NULL")),
          // `... LIKE :pattern ESCAPE '_'` -- the escape clause is not
          // decoration in this corpus: every LIKE that stopped a body had one,
          // because the patterns are built from names that contain underscores
          seq(opt(str("NOT")), str("LIKE"), new Expr(), opt(seq(str("ESCAPE"), new Expr()))),
          seq(opt(str("NOT")), str("IN"), "(",
            altPrio(new SetOperation(), seq(new Expr(), star(seq(",", new Expr())))), ")"),
          // BETWEEN eats its own AND before the enclosing Condition sees one
          seq(opt(str("NOT")), str("BETWEEN"), new Expr(), str("AND"), new Expr()),
          seq(alt("=", "<>", "!=", "<", ">", "<=", ">="),
            altPrio(seq("(", new SetOperation(), ")"), new Expr()))))));
  }
}

/** One side of an AND/OR: a predicate, or a parenthesised condition.
 *
 *  Twelve working bodies stopped at an `=` that was inside `and ( a = b or
 *  c = d )` -- the grammar could read the comparison and had nowhere to put
 *  the brackets around a group of them. The histogram said "at =", which read
 *  as though equality itself were missing; it was not. */
export class ConditionTerm extends Expression {
  getRunnable() {
    return altPrio(seq("(", new Condition(), ")"), new Predicate());
  }
}

export class Condition extends Expression {
  getRunnable() {
    return seq(opt(str("NOT")), new ConditionTerm(),
      star(seq(alt(str("AND"), str("OR")), opt(str("NOT")), new ConditionTerm())));
  }
}

/** one thing in a select list: an expression, optionally named */
export class SelectItem extends Expression {
  getRunnable() {
    return altPrio("*", seq(new Expr(), opt(seq(opt(str("AS")), new Name()))));
  }
}

/** What a FROM names: a table, a temporary table, a table variable, or a
 *  parenthesised select.
 *
 *  The last one is not decoration: the cross-join idiom that 60 bodies of the
 *  corpus use is `CROSS JOIN (SELECT ? AS v) p` -- a scalar carried into a set
 *  through a one-row derived table. Leaving it out made the grammar refuse the
 *  single most common shape in the measurement, which is how it was found. */
export class Source extends Expression {
  getRunnable() {
    return seq(altPrio(
      seq("(", new SetOperation(), ")"),
      new TableFunctionCall(),
      tok(TokenKind.host),
      tok(TokenKind.temp),
      new ColumnRef()),
      opt(seq(opt(str("AS")), tok(TokenKind.identifier))));
  }
}

/** The first measured SQLScript array-to-relation form.
 *
 * `UNNEST(:a) WITH ORDINALITY AS ("VALUE", "POSITION")` deliberately has
 * its own node: treating it as a generic table function would lose both the
 * array binding and HANA's one-based ordinal column. */
export class UnnestCall extends Expression {
  getRunnable() {
    return seq(str("UNNEST"), "(", tok(TokenKind.host), ")",
      str("WITH"), str("ORDINALITY"), str("AS"),
      "(", new Name(), ",", new Name(), ")");
  }
}

/** `FROM "CL_X=>GET_ROWS"( :iv_a, 1 )` -- one AMDP table function calling
 *  another. The name arrives as a **quoted identifier** because that is how
 *  the generated procedure is named, which is why this is not an ordinary
 *  function call: 45 bodies stopped at the bracket after it. */
export class TableFunctionCall extends Expression {
  getRunnable() {
    // `sys.series_generate_date( ... )` -- a built-in table function is
    // reached through its schema, so the name is a ColumnRef and not a Name
    return seq(new ColumnRef(), "(", opt(seq(new Expr(), star(seq(",", new Expr())))), ")");
  }
}

export class Join extends Expression {
  getRunnable() {
    return seq(
      altPrio(seq(str("CROSS"), str("JOIN")),
        seq(opt(altPrio(str("INNER"), seq(altPrio(str("LEFT"), str("RIGHT"), str("FULL")), opt(str("OUTER"))))), str("JOIN"))),
      new Source(), opt(seq(str("ON"), new Condition())));
  }
}

/** SELECT ... FROM ... [WHERE] [GROUP BY] [ORDER BY] */
export class Select extends Expression {
  getRunnable() {
    // **`altPrio`, not `opt`, for DISTINCT.** With `opt` the grammar admits
    // two readings of `SELECT DISTINCT k` -- the keyword, or a column named
    // DISTINCT with `k` as its alias -- and the second won, so `hasWord` did
    // not see it and the binder built a projection of a column called
    // DISTINCT. `altPrio` commits to the first branch that matches, which is
    // the keyword. Found by fable-osd running the same body on HANA twice,
    // once through HANA's own compiler and once through our lowering.
    return seq(str("SELECT"),
      altPrio(seq(str("DISTINCT"), new SelectItem(), star(seq(",", new SelectItem()))),
        seq(new SelectItem(), star(seq(",", new SelectItem())))),
      // `FROM a, b` is a cross join written with a comma, and the corpus uses
      // it for exactly that -- `FROM public.m_services s, public.m_volume_files v`
      // with the join written out in the WHERE
      opt(seq(str("FROM"), new Source(), star(seq(",", new Source())), star(new Join()))),
      opt(seq(str("WHERE"), new Condition())),
      opt(seq(str("GROUP"), str("BY"), new Expr(), star(seq(",", new Expr())))),
      opt(seq(str("HAVING"), new Condition())),
      opt(seq(str("ORDER"), str("BY"), new OrderKey(), star(seq(",", new OrderKey())))),
      opt(seq(str("LIMIT"), new Expr(), opt(seq(str("OFFSET"), new Expr())))),
      opt(new Hint()));
  }
}

/** `WITH HINT ( NO_USE_HEX_PLAN )`, `WITH hint(inline)`.
 *
 *  A hint is a **request to one engine**, not part of what the program means,
 *  so it is read here and never rendered -- carrying it to another engine
 *  would either be refused or, worse, change a plan where the author meant
 *  HANA. The two that are not plan-only are `INLINE` and `NO_INLINE`: those
 *  change observable behaviour, measured (docs/sqlscript-hana-observed.md),
 *  and the binder keeps them as a fact about the node rather than dropping
 *  them with the rest. A hint the binder has not been told about is refused
 *  by name; silently dropping an unknown one is how a hint that mattered
 *  would disappear. */
export class Hint extends Expression {
  getRunnable() {
    return seq(str("WITH"), str("HINT"), "(",
      opt(seq(new HintName(), star(seq(",", new HintName())))), ")");
  }
}

export class HintName extends Expression {
  getRunnable() {
    return seq(tok(TokenKind.identifier),
      opt(seq("(", star(altPrio(tok(TokenKind.identifier), tok(TokenKind.number), tok(TokenKind.string), ",", ".")), ")")));
  }
}

export class OrderKey extends Expression {
  getRunnable() {
    return seq(new Expr(), opt(altPrio(str("ASC"), str("DESC"))));
  }
}

/** UNION, which the corpus puts third and both local engines needed */
export class SetOperation extends Expression {
  getRunnable() {
    return seq(new Select(),
      star(seq(altPrio(seq(str("UNION"), opt(str("ALL"))), str("INTERSECT"), str("EXCEPT")), new Select())),
      opt(seq(str("ORDER"), str("BY"), new OrderKey(), star(seq(",", new OrderKey())))),
      opt(seq(str("LIMIT"), new Expr(), opt(seq(str("OFFSET"), new Expr())))));
  }
}

/** `lt = SELECT ...;` -- the assignment that the measurement put first, and
 *  that HANA showed is **not** an observable barrier
 *  (docs/sqlscript-hana-observed.md) */
export class Assignment extends Expression {
  getRunnable() {
    // `:=` is SQLScript's assignment operator and the grammar simply did not
    // have it: 27 bodies, named by the corpus once failures pointed at the
    // right token
    return seq(new Name(), altPrio(":=", "="),
      altPrio(new UnnestCall(), new SetOperation(), new Expr()), ";");
  }
}

/** A type as a declaration writes it: NVARCHAR(10), INTEGER, DECIMAL(15,2) */
export class TypeName extends Expression {
  getRunnable() {
    // `"$ABAP.type( cds_get_rsau_log-sal_data )"` is ONE quoted token: inside
    // a CAST the whole thing is written between double quotes, so it never
    // reaches AbapType below and has to be accepted as the quoted name it is
    return altPrio(new AbapType(), tok(TokenKind.quoted), seq(tok(TokenKind.identifier),
      opt(seq("(", tok(TokenKind.number), star(seq(",", tok(TokenKind.number))), ")"))));
  }
}

/** `DECLARE lv_x INTEGER;` and `DECLARE lt_x TABLE (a INT, b NVARCHAR(3));`
 *
 *  First on the measured list: 132 of 405 working bodies stop here, which is
 *  more than any other single construct and was invisible in the frequency
 *  table -- that counted how often DECLARE appears, not how often it is the
 *  thing in the way. */
export class Declare extends Expression {
  getRunnable() {
    return seq(str("DECLARE"),
      altPrio(
        seq(new Name(), str("TABLE"), "(", new ColumnDef(), star(seq(",", new ColumnDef())), ")"),
        seq(str("CURSOR"), new Name(), str("FOR"), new SetOperation()),
        seq(new Name(), new TypeName(), opt(str("ARRAY")), opt(seq(altPrio(":=", "="), new Expr())))),
      ";");
  }
}

export class ColumnDef extends Expression {
  getRunnable() {
    return seq(new Name(), new TypeName());
  }
}

/** `RETURN :lt;` and `RETURN SELECT ...;` -- third on the list, 47 bodies */
export class Return extends Expression {
  getRunnable() {
    return seq(str("RETURN"), opt(altPrio(new SetOperation(), new Expr())), ";");
  }
}

/** one thing a body may contain */
export class Statement extends Expression {
  getRunnable() {
    return altPrio(new Declare(), new Return(), new If(), new While(), new Block(), new Assignment(),
      seq(new SetOperation(), ";"));
  }
}

/** `BEGIN … END`, and the two forms HANA allows in front of it.
 *
 *  `BEGIN SEQUENTIAL EXECUTION` and `BEGIN PARALLEL EXECUTION` are real
 *  SQLScript and nobody here had heard of either: they were named by the
 *  corpus once the failure positions stopped lying (33 bodies). */
export class Block extends Expression {
  getRunnable() {
    return seq(str("BEGIN"),
      opt(seq(altPrio(str("SEQUENTIAL"), str("PARALLEL")), str("EXECUTION"))),
      star(new Statement()), str("END"), opt(";"));
  }
}

/** `IF cond THEN … ELSEIF … ELSE … END IF;` -- the imperative conditional,
 *  which the honest histogram put at the top through its opening bracket */
export class If extends Expression {
  getRunnable() {
    return seq(str("IF"), opt("("), new Condition(), opt(")"), str("THEN"),
      star(new Statement()),
      star(seq(str("ELSEIF"), opt("("), new Condition(), opt(")"), str("THEN"), star(new Statement()))),
      opt(seq(str("ELSE"), star(new Statement()))),
      str("END"), str("IF"), ";");
  }
}

/** `WHILE condition DO ... END WHILE;` -- the smallest imperative loop and
 *  the one used by the portable AMDP acceptance method. Its body contains
 *  Statements, not a second special grammar: nesting and later BREAK /
 *  CONTINUE support therefore have one place to live. */
export class While extends Expression {
  getRunnable() {
    // Condition already owns balanced parenthesised groups. Independent
    // optional opening/closing tokens accepted both half-open spellings.
    return seq(str("WHILE"), new Condition(), str("DO"),
      star(new Statement()), str("END"), str("WHILE"), ";");
  }
}

/** `$ABAP.TYPE( SWP_INITIA )` -- AMDP's own typing syntax.
 *
 *  It exists in **no SQL dialect**. It is a type, not an expression, so it
 *  has to disappear at the boundary rather than travel to an engine: a
 *  statement carrying it that still runs would be the case of "works and
 *  means something else". */
export class AbapType extends Expression {
  getRunnable() {
    // `$ABAP` lexes as one identifier, because `$` is a name character
    return seq(str("$ABAP"), ".", str("TYPE"),
      "(", star(altPrio(tok(TokenKind.identifier), tok(TokenKind.number), ",", "-")), ")");
  }
}

/** A body: statements, and the value of the body is the last statement that
 *  produces one. Written as statements rather than as "assignments then a
 *  select" because the measurement said the bodies are not shaped that way
 *  (docs/sqlscript-corpus.md, 0 of 405). */
export class Body extends Expression {
  getRunnable() {
    return altPrio(
      seq(star(new Statement()), new SetOperation(), opt(";")),
      plus(new Statement()));
  }
}
