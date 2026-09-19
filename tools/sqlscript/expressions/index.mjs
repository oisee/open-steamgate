// One construct, one file, one class, named after the construct
// (docs/sqlscript-parser-style.md). The order these arrive in is the order
// docs/sqlscript-corpus.md measured: the 25 constructs that cover 80% of the
// bodies on the sandbox, starting with the two that cover the most.
import {Expression, seq, alt, altPrio, opt, star, str, tok} from "../combi.mjs";
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
    return altPrio(tok(TokenKind.string), tok(TokenKind.number), tok(TokenKind.host), "?");
  }
}

/** FN(a, b) -- the call shape, which the corpus says is most of the work */
export class FunctionCall extends Expression {
  getRunnable() {
    return seq(tok(TokenKind.identifier), "(",
      opt(seq(new Expr(), star(seq(",", new Expr())))), ")");
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
      tok(TokenKind.host),
      tok(TokenKind.temp),
      new ColumnRef()),
      opt(seq(opt(str("AS")), tok(TokenKind.identifier))));
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
    return seq(new Name(), "=", new SetOperation(), ";");
  }
}

/** a body: assignments and a final statement */
export class Body extends Expression {
  getRunnable() {
    return seq(star(new Assignment()), new SetOperation(), opt(";"));
  }
}
