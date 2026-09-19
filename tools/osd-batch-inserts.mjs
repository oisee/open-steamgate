// Merge consecutive one-row INSERTs into multi-row ones.
//
// The seed learnt this an hour ago (test/seed.mjs, e088c4d: 2521 statements
// became 36). This is the same trick one layer up, on the statements the
// **transpiler** hands `setup()` -- the object directory and the sources,
// which are not ours and arrive one row at a time. Measured on a real
// `npm run unit` after the seed was fixed: of 4315 statements, 1542 were
// TADIR and 907 REPOSRC, worth 298 ms between them.
//
// **The values are never parsed, and that is the whole design.** A statement
// is split at `VALUES ` and everything after it is carried verbatim, so a
// comma or a bracket inside a quoted string cannot be misread -- the defect
// the seed's own test had, where splitting a five-column row on commas found
// seven parts. A check that needs a parser to be right must use one or not
// exist; here the answer is to need no parser at all.
//
// Anything that does not match the shape passes through **unchanged and in
// place**. A batcher that dropped what it could not read would be a silent
// data loss, which is worse than the cost it saves.

/** the part before the values: the table and the column list, textually */
const SHAPE = /^(\s*INSERT\s+INTO\s+[^()]+\([^)]*\)\s+VALUES\s*)(\(.*)$/is;

/**
 * @param rows how many rows one statement may carry. Not unbounded: a
 *   statement is parsed once but it is also held in memory once, and an
 *   engine has its own limits on length. 200 is where the measurement stops
 *   improving.
 */
export function batchInserts(statements, {rows = 200} = {}) {
  const out = [];
  // One bucket per shape, in the order the shapes first appeared. The rows
  // the transpiler hands over are **interleaved** -- a directory entry, then
  // its source, then the next object's -- so merging only consecutive runs
  // caught barely a third of them (1542 TADIR statements became 942 and
  // REPOSRC did not move at all). Merging across other INSERTS catches the
  // rest.
  //
  // **Why that is safe, stated rather than assumed:** an INSERT reads
  // nothing, so two inserts into different tables commute and the rows that
  // end up in the database do not depend on which went first. Order WITHIN a
  // shape is kept, which is what a unique constraint or a last-write could
  // depend on. And anything that is not an INSERT is a **barrier**: every
  // bucket is flushed before it, because a CREATE, a DELETE or a statement
  // this function cannot read may well depend on what came before it.
  const buckets = new Map();

  const flushAll = () => {
    for (const [prefix, values] of buckets) {
      for (let at = 0; at < values.length; at += rows) {
        out.push(prefix + values.slice(at, at + rows).join(", ") + ";");
      }
    }
    buckets.clear();
  };

  for (const statement of statements) {
    const match = SHAPE.exec(String(statement ?? ""));
    if (match === null) {
      // not a shape we recognise: a barrier, and it keeps its place untouched
      flushAll();
      out.push(statement);
      continue;
    }
    const [, head, tail] = match;
    // the trailing semicolon belongs to the statement, not to the row
    const row = tail.replace(/;\s*$/, "");
    const bucket = buckets.get(head);
    if (bucket === undefined) buckets.set(head, [row]);
    else bucket.push(row);
  }
  flushAll();
  return out;
}

/** how much it did, for a caller that wants to say so out loud */
export function batchedCount(before, after) {
  return {before: before.length, after: after.length, saved: before.length - after.length};
}
