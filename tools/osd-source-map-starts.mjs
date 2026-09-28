// @abaplint/transpiler 2.13.89 calls Chunk.ensureStartMapping for every
// statement, but its fallback skips the statement when an expression inside
// it already made any mapping. A multiline call can then map only its final
// ABAP period to the generated semicolon, which is too late for a breakpoint.
// The traversal still hands ensureStartMapping the parsed statement itself:
// use that exact boundary to map the first generated token to the first
// source token. Keep this small shim until the upstream Chunk does so.
const installed = Symbol.for("osd.statementStartSourceMaps");

export function mapStatementStarts(Chunk) {
  if (Chunk === undefined || Chunk.prototype === undefined) {
    throw new Error("transpiler Chunk export is unavailable for source maps");
  }
  if (Chunk.prototype[installed]) return;
  const original = Chunk.prototype.ensureStartMapping;
  if (typeof original !== "function") throw new Error("transpiler Chunk.ensureStartMapping is unavailable");
  // Check the API and its behavior on a disposable chunk. If a later
  // transpiler already fixes statement starts, leave its implementation
  // alone; if its chunk shape changes, fail before producing misleading maps.
  const probe = new Chunk("await call();");
  if (probe.raw !== "await call();" || !Array.isArray(probe.mappings)
      || typeof probe.originalPosition !== "function") {
    throw new Error("transpiler Chunk source-map shape changed");
  }
  probe.mappings.push({source: "probe.abap", generated: {line: 1, column: 12}, original: {line: 3, column: 12}});
  const token = {getRow: () => 1, getCol: () => 1};
  const traversal = {getFilename: () => "probe.abap", isSourceMapEnabled: () => true};
  if (original.call(probe, {getFirstToken: () => token}, traversal) !== probe) {
    throw new Error("transpiler Chunk.ensureStartMapping return value changed");
  }
  if (probe.mappings.some((mapping) => mapping.generated.line === 1 && mapping.generated.column === 0)) {
    Chunk.prototype[installed] = true;
    return;
  }
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
