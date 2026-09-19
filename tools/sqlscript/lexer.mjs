// Stage 1 of the SQLScript front end: text into tokens.
//
// Written in the shape of abaplint's `1_lexer` and for the reason set out in
// docs/sqlscript-parser-style.md: the grammar above this is combinators over
// a token stream, and **no regular expression above this stage sees more than
// one token**. Everything that makes SQLScript lexically unlike ABAP is
// settled here, once:
//
//   :name        a host variable. ABAP reads a colon as the chaining colon,
//                which is why a SQLScript body handed to an ABAP parser comes
//                back split and missing its colons (abaplint/abaplint#4307).
//                Here it is one token and it keeps its colon.
//   -- and /**/  comments. ABAP has neither.
//   #name        a local temporary table. A '#' is not an ABAP identifier
//                character at all.
//   'it''s'      a string literal, with the doubled quote as the escape.
//   "NAME"       a quoted identifier, which is a *name* and not a value --
//                the distinction this project has paid for twice, most
//                recently when a regex folding identifiers rewrote the inside
//                of a JSON value.
//
// Every token carries its line and column, because a refusal has to name a
// position the way HANA does -- that is the standard the sandbox already
// meets and the one a parser of ours has to meet to be worth using.

export const TokenKind = {
  identifier: "identifier",        // SELECT, lt_rows, DUMMY
  quoted: "quoted",                // "MY NAME"
  host: "host",                    // :lt_rows
  temp: "temp",                    // #scratch
  string: "string",                // 'a value'
  number: "number",                // 42, 0.5
  operator: "operator",            // = <> <= || * ( ) , ;
  comment: "comment",              // -- ...  /* ... */
};

/** one token, with where it was */
class Token {
  constructor(kind, value, line, col) {
    this.kind = kind;
    this.value = value;
    this.line = line;
    this.col = col;
  }
  toString() {
    return `${this.kind}(${this.value})`;
  }
}

export class LexError extends Error {
  constructor(message, line, col) {
    // the shape HANA answers in, because that is what a person reading our
    // refusal will be comparing it against
    super(`${message}: line ${line} col ${col}`);
    this.line = line;
    this.col = col;
  }
}

const OPERATORS_2 = ["<=", ">=", "<>", "!=", "||", ":=", "=>"];
const OPERATORS_1 = "=<>+-*/%(),;.[]{}?@&|";

/** is this a character an unquoted name may contain */
const isNameChar = (c) => /[A-Za-z0-9_$]/.test(c);
const isDigit = (c) => c >= "0" && c <= "9";

/**
 * @param {string} source a SQLScript body
 * @param {{comments?: boolean}} [options] comments: keep them as tokens
 * @returns {Token[]}
 */
export function lex(source, options = {}) {
  const keepComments = options.comments === true;
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const push = (kind, value, atLine, atCol) => tokens.push(new Token(kind, value, atLine, atCol));
  const advance = (n) => {
    for (let k = 0; k < n; k += 1) {
      if (source[i] === "\n") {
        line += 1;
        col = 1;
      } else {
        col += 1;
      }
      i += 1;
    }
  };

  while (i < source.length) {
    const c = source[i];
    const startLine = line;
    const startCol = col;

    // whitespace
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      advance(1);
      continue;
    }

    // An ABAP full-line comment: `*` in **column one**.
    //
    // A SQLScript body is not written in a file of its own -- it lives
    // inside an ABAP method, so the ABAP comment conventions leak into it,
    // and 40 corpus bodies begin with one. It is unambiguous only because of
    // the column: `*` anywhere else is multiplication, and `SELECT *` must
    // keep working.
    //
    // The other ABAP comment, `"` to the end of the line, is **not** handled
    // and must not be guessed at: in SQLScript a double quote opens a quoted
    // identifier, so the same character means a name in one language and a
    // comment in the other. Treating it as a comment would silently delete
    // half a statement.
    if (c === "*" && col === 1) {
      let j = i;
      while (j < source.length && source[j] !== "\n") {
        j += 1;
      }
      const text = source.slice(i, j);
      advance(j - i);
      if (keepComments) {
        push(TokenKind.comment, text, startLine, startCol);
      }
      continue;
    }

    // -- to the end of the line
    if (c === "-" && source[i + 1] === "-") {
      let j = i;
      while (j < source.length && source[j] !== "\n") {
        j += 1;
      }
      const text = source.slice(i, j);
      advance(j - i);
      if (keepComments) {
        push(TokenKind.comment, text, startLine, startCol);
      }
      continue;
    }

    // /* ... */, and it does not nest
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) {
        throw new LexError("unterminated block comment", startLine, startCol);
      }
      const text = source.slice(i, end + 2);
      advance(end + 2 - i);
      if (keepComments) {
        push(TokenKind.comment, text, startLine, startCol);
      }
      continue;
    }

    // 'a string, with '' inside'
    if (c === "'") {
      let j = i + 1;
      let value = "";
      for (;;) {
        if (j >= source.length) {
          throw new LexError("unterminated string literal", startLine, startCol);
        }
        if (source[j] === "'" && source[j + 1] === "'") {
          value += "'";
          j += 2;
          continue;
        }
        if (source[j] === "'") {
          j += 1;
          break;
        }
        value += source[j];
        j += 1;
      }
      advance(j - i);
      push(TokenKind.string, value, startLine, startCol);
      continue;
    }

    // "a quoted identifier", which is a NAME and never a value
    if (c === "\"") {
      const close = source.indexOf("\"", i + 1);
      if (close === -1) {
        throw new LexError("unterminated quoted identifier", startLine, startCol);
      }
      const value = source.slice(i + 1, close);
      advance(close + 1 - i);
      push(TokenKind.quoted, value, startLine, startCol);
      continue;
    }

    // :host_variable -- one token, colon kept
    if (c === ":" && isNameChar(source[i + 1] ?? "")) {
      let j = i + 1;
      while (j < source.length && isNameChar(source[j])) {
        j += 1;
      }
      const value = source.slice(i, j);
      advance(j - i);
      push(TokenKind.host, value, startLine, startCol);
      continue;
    }

    // #local_temporary_table
    if (c === "#" && isNameChar(source[i + 1] ?? "")) {
      let j = i + 1;
      while (j < source.length && isNameChar(source[j])) {
        j += 1;
      }
      const value = source.slice(i, j);
      advance(j - i);
      push(TokenKind.temp, value, startLine, startCol);
      continue;
    }

    // a number: digits, one dot, an optional exponent
    if (isDigit(c) || (c === "." && isDigit(source[i + 1] ?? ""))) {
      let j = i;
      while (j < source.length && isDigit(source[j])) {
        j += 1;
      }
      if (source[j] === ".") {
        j += 1;
        while (j < source.length && isDigit(source[j])) {
          j += 1;
        }
      }
      if (source[j] === "e" || source[j] === "E") {
        let k = j + 1;
        if (source[k] === "+" || source[k] === "-") {
          k += 1;
        }
        if (isDigit(source[k] ?? "")) {
          j = k;
          while (j < source.length && isDigit(source[j])) {
            j += 1;
          }
        }
      }
      const value = source.slice(i, j);
      advance(j - i);
      push(TokenKind.number, value, startLine, startCol);
      continue;
    }

    // an unquoted name
    if (isNameChar(c) && !isDigit(c)) {
      let j = i;
      while (j < source.length && isNameChar(source[j])) {
        j += 1;
      }
      const value = source.slice(i, j);
      advance(j - i);
      push(TokenKind.identifier, value, startLine, startCol);
      continue;
    }

    // operators, longest first
    const two = source.slice(i, i + 2);
    if (OPERATORS_2.includes(two)) {
      advance(2);
      push(TokenKind.operator, two, startLine, startCol);
      continue;
    }
    if (OPERATORS_1.includes(c) || c === ":") {
      advance(1);
      push(TokenKind.operator, c, startLine, startCol);
      continue;
    }

    throw new LexError(`unexpected character ${JSON.stringify(c)}`, startLine, startCol);
  }

  return tokens;
}
