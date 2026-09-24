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
