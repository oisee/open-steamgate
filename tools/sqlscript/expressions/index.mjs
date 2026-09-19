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
    return seq(tok(TokenKind.identifier), "(",
      opt(altPrio("*", seq(new Expr(), star(seq(",", new Expr()))))), ")");
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
      new FunctionCall(),
      new Value(),
      seq("(", new Expr(), ")"),
      new ColumnRef());
  }
}

/** a comparison, which is what a WHERE is made of */
export class Predicate extends Expression {
  getRunnable() {
    return seq(new Expr(),
      opt(altPrio(
        seq(str("IS"), opt(str("NOT")), str("NULL")),
        seq(alt("=", "<>", "!=", "<", ">", "<=", ">="), new Expr()))));
  }
}

export class Condition extends Expression {
  getRunnable() {
    return seq(new Predicate(), star(seq(alt(str("AND"), str("OR")), new Predicate())));
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

/** `FROM "CL_X=>GET_ROWS"( :iv_a, 1 )` -- one AMDP table function calling
 *  another. The name arrives as a **quoted identifier** because that is how
 *  the generated procedure is named, which is why this is not an ordinary
 *  function call: 45 bodies stopped at the bracket after it. */
export class TableFunctionCall extends Expression {
  getRunnable() {
    return seq(new Name(), "(", opt(seq(new Expr(), star(seq(",", new Expr())))), ")");
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
    return seq(str("SELECT"), opt(str("DISTINCT")),
      new SelectItem(), star(seq(",", new SelectItem())),
      opt(seq(str("FROM"), new Source(), star(new Join()))),
      opt(seq(str("WHERE"), new Condition())),
      opt(seq(str("GROUP"), str("BY"), new Expr(), star(seq(",", new Expr())))),
      opt(seq(str("HAVING"), new Condition())),
      opt(seq(str("ORDER"), str("BY"), new OrderKey(), star(seq(",", new OrderKey())))));
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
      star(seq(altPrio(seq(str("UNION"), opt(str("ALL"))), str("INTERSECT"), str("EXCEPT")), new Select())));
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
      altPrio(new SetOperation(), new Expr()), ";");
  }
}

/** A type as a declaration writes it: NVARCHAR(10), INTEGER, DECIMAL(15,2) */
export class TypeName extends Expression {
  getRunnable() {
    return altPrio(new AbapType(), seq(tok(TokenKind.identifier),
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
        seq(new Name(), str("CURSOR"), str("FOR"), new SetOperation()),
        seq(new Name(), new TypeName(), opt(seq("=", new Expr())))),
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
    return altPrio(new Declare(), new Return(), new If(), new Block(), new Assignment(),
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
      "(", star(altPrio(tok(TokenKind.identifier), tok(TokenKind.number), ",")), ")");
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
