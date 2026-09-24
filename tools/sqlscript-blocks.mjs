// The statement lists a procedural IR statement holds: a loop's body, an
// IF's branches and its ELSE. Every walker of the tree goes through this --
// the compiler's checks, the runtime's, the destination's search for nested
// CALLs -- so a new kind of block is not missed by the one walker nobody
// updated: a numeric FOR was invisible to four of them (the #56 critic).
// A module of its own so the destination, which loads the runtime lazily,
// can import it without the runtime.
export const childBodies = (statement) => [
  ...(["while", "for-range", "for-cursor"].includes(statement?.stmt) ? [statement.body ?? []] : []),
  ...(statement?.stmt === "if" ? [...(statement.branches ?? []).map((branch) => branch.body ?? []), statement.otherwise ?? []] : []),
];

/** a relational statement anywhere in these statements: an assignment of a
 *  table variable, or a CALL (whose output is one) */
export const containsRelationStatement = (statements) => statements.some((statement) =>
  statement.stmt === "assign-relation" || statement.stmt === "call-procedure"
    || childBodies(statement).some(containsRelationStatement));

/** something that consumes relations: a FOR over a cursor, SELECT ... INTO,
 *  or a write (its rows, its condition) -- what makes a scalar output over
 *  relations carried */
export const readsRelations = (statements) => statements.some((statement) =>
  statement.stmt === "for-cursor" || statement.stmt === "select-into" || statement.stmt === "write"
    || childBodies(statement).some(readsRelations));

/** a write to a database table anywhere in these statements */
export const containsWrite = (statements) => statements.some((statement) =>
  statement.stmt === "write" || childBodies(statement).some(containsWrite));
