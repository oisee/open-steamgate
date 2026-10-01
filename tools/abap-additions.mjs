// Helpers for the free-text "additions" of a selection-screen statement.

// Blank out '...' and `...` literals (a doubled quote is an escaped quote
// inside the literal) so keyword tests do not see words inside a default.
// The length is kept, so offsets into the result match the input.
export const stripLiterals = (additions) => String(additions ?? "")
  .replace(/'(?:''|[^'])*'|`(?:``|[^`])*`/g, (literal) => " ".repeat(literal.length));
