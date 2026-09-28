// @abaplint/transpiler 2.13.89 calls Chunk.ensureStartMapping for every
// statement, but its fallback skips the statement when an expression inside
// it already made any mapping. A multiline call can then map only its final
// ABAP period to the generated semicolon, which is too late for a breakpoint.
// The traversal still hands ensureStartMapping the parsed statement itself:
// use that exact boundary to map the first generated token to the first
// source token. Keep this small shim until the upstream Chunk does so.
const installed = Symbol.for("osd.statementStartSourceMaps");

export function mapStatementStarts(Chunk) {
  if (Chunk === undefined || Chunk.prototype[installed]) return;
  const original = Chunk.prototype.ensureStartMapping;
  if (typeof original !== "function") throw new Error("transpiler Chunk.ensureStartMapping is unavailable");
  Chunk.prototype.ensureStartMapping = function (statement, traversal) {
    const result = original.call(this, statement, traversal);
    if (this.raw !== "" && traversal.isSourceMapEnabled?.() !== false
        && !this.mappings.some((mapping) => mapping.generated.line === 1 && mapping.generated.column === 0)) {
      this.mappings.push({
        source: traversal.getFilename(),
        generated: {line: 1, column: 0},
        original: this.originalPosition(statement),
      });
    }
    return result;
  };
  Chunk.prototype[installed] = true;
}
