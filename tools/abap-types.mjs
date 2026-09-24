// ABAP's type codes, read the way they are written.
//
// The codes the seam passes are mostly single letters -- `I`, `P(15,2)`,
// `C(10)`, `X` -- so every client wrote `type.charAt(0)` and switched on it.
// One of them is a WORD: `STRING`. Its first letter is `S`, which is a short
// integer, so a text parameter was bound as a number. On sql.js and SQLite
// `Number("aa")` is NaN and lands quietly; HANA refuses the statement with
// "Cannot set parameter at row: 1. Argument must be a string", which is how
// it was finally seen (2026-09-19).
//
// The same defect was found and fixed in `declaredAs()` a day earlier, and
// the retro wrote it down: "a test on the first letter is wider than the
// letters it means". It was fixed in the one place it had been noticed, and
// four binds that were never looked at kept it. That is the other rule this
// tree keeps paying for -- a rule written next to its one caller does not
// survive the second -- so it lives here, where all four reach it.

/** the codes that are words rather than letters, and must not be initialled */
const WORDS = new Set(["STRING"]);

/** the ABAP type letter, or "" for a code that is a word */
export function abapTypeLetter(type) {
  const code = String(type ?? "").toUpperCase();
  return WORDS.has(code) ? "" : code.charAt(0);
}

/** does this type bind as a number? `STRING` does not, whatever its first letter says */
export function isNumericType(type) {
  return ["I", "B", "S", "P", "F"].includes(abapTypeLetter(type));
}

/** a hex string that binds as bytes (`X`, `XSTRING`) */
export function isHexType(type) {
  return abapTypeLetter(type) === "X";
}

/** one parameter, as every client's bind wants it. A packed value the IR
 *  carries as its decimal string (tools/ir-writes.mjs, ir-osql-where.mjs)
 *  binds as that string: Number() would round a P(31,14) to a double's 15
 *  digits before the engine saw it. The engine casts the text to its
 *  DECIMAL (DuckDB, HANA, PostgreSQL exactly; SQLite by NUMERIC affinity,
 *  which is a REAL again -- SQLite has no decimal type). */
export function bindValue(p, {hex} = {}) {
  if (p.isNull === true) return null;
  if (abapTypeLetter(p.type) === "P" && typeof p.value === "string") return p.value;
  // an INT8 past 2^53 arrives as a BigInt (ir-writes bindValue); Number()
  // would make 9007199254740993 into ...992, and every client binds a BigInt
  if (typeof p.value === "bigint") return p.value;
  if (isNumericType(p.type)) return Number(p.value);
  if (hex !== undefined && isHexType(p.type)) return hex(String(p.value));
  return p.value === undefined ? null : String(p.value);
}
