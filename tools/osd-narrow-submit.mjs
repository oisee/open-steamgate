// Lower only the synchronous, static SUBMIT slice that the one-shot report
// registry can execute. The upstream transpiler still throws for SUBMIT; a
// broader rewrite here would make unsupported SAP syntax appear to work.
// Parse statements with abaplint so comments and string literals are never
// mistaken for an operator. Keep the line count stable for source maps.

const IDENT = /^[A-Z_][A-Z0-9_]*(?:-[A-Z0-9_]+)*$/i;
const PROGRAM = /^[A-Z][A-Z0-9_]*$/i;
const SCALAR = /^(?:[A-Z_][A-Z0-9_]*(?:-[A-Z0-9_]+)*|'(?:[^']|'')*'|`[^`]*`|\d+(?:\.\d+)?)$/i;

function offsetAt(source, position) {
  let offset = 0;
  for (let row = 1; row < position.getRow(); row++) {
    const next = source.indexOf("\n", offset);
    if (next < 0) throw new Error("ABAP source position exceeds the file");
    offset = next + 1;
  }
  return offset + position.getCol() - 1;
}

function replacement(statement, filename) {
  const words = statement.getTokens().map((token) => token.getStr());
  const line = statement.getStart().getRow();
  const unsupported = () => {
    throw new Error(`${filename}:${line}: supported SUBMIT form is static PROG [WITH field = scalar ...] AND RETURN; got ${statement.concatTokens()}`);
  };
  if (words[0]?.toUpperCase() !== "SUBMIT" || !PROGRAM.test(words[1] ?? "") || words.at(-1) !== ".") unsupported();
  const program = words[1].toUpperCase();
  const values = [];
  let at = 2;
  while (words[at]?.toUpperCase() === "WITH") {
    const name = words[at + 1];
    const value = words[at + 3];
    if (!IDENT.test(name ?? "") || words[at + 2] !== "=" || !SCALAR.test(value ?? "")) unsupported();
    if (values.some((row) => row.name === name.toUpperCase())) unsupported();
    values.push({name: name.toUpperCase(), value});
    at += 4;
  }
  if (words[at]?.toUpperCase() !== "AND" || words[at + 1]?.toUpperCase() !== "RETURN" || at + 2 !== words.length - 1) unsupported();
  const input = values.length === 0 ? "" : ` it_input = VALUE #( ${values.map(({name, value}) => `( name = '${name}' value = CONV string( ${value} ) )`).join(" ")} )`;
  return `zcl_osd_batch_report=>submit( iv_program = '${program}'${input} iv_batch = sy-batch ).`;
}

export function lowerNarrowSubmit(source, filename, core) {
  if (!/\.abap$/i.test(filename) || !/\bSUBMIT\b/i.test(source)) return source;
  const registry = new core.Registry().addFile(new core.MemoryFile(filename, source)).parse();
  const file = registry.getFirstObject()?.getABAPFiles().find((entry) => entry.getFilename() === filename);
  if (file === undefined) return source;
  const changes = [];
  for (const statement of file.getStatements()) {
    if (statement.get().constructor.name !== "Submit") continue;
    const start = offsetAt(source, statement.getStart());
    const end = offsetAt(source, statement.getEnd());
    const original = source.slice(start, end);
    // A comment inside a multi-line statement is part of the developer's
    // source, so ask for it to be moved above instead of deleting it. A
    // literal may contain a quote character and is not a comment.
    if (file.getTokens().some((token) => token.constructor.name === "Comment"
        && offsetAt(source, token.getStart()) >= start
        && offsetAt(source, token.getStart()) < end)) {
      throw new Error(`${filename}:${statement.getStart().getRow()}: move comments above SUBMIT before lowering it`);
    }
    const lowered = replacement(statement, filename) + "\n".repeat((original.match(/\n/g) ?? []).length);
    changes.push({start, end, lowered});
  }
  for (const change of changes.reverse()) {
    source = source.slice(0, change.start) + change.lowered + source.slice(change.end);
  }
  return source;
}
