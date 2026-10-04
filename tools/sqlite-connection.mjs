// Open SQL and SADL LIKE are case-sensitive (docs/osql-where.md). Keep
// SQLite's matcher, value conversion and indexed prefix range optimisation.
// The pragma is deprecated and can be omitted at build time: verify its
// effect on every connection instead of accepting an ignored pragma.
export function setupSqliteConnection(db) {
  db.exec("PRAGMA case_sensitive_like = ON");
  const sql = "SELECT 'A' LIKE 'a' AS folded, 'A' LIKE 'A' AS exact";
  const row = typeof db.create_function === 'function'
    ? db.exec(sql)[0]?.values[0] : Object.values(db.prepare(sql).get());
  if (row?.[0] !== 0 || row?.[1] !== 1) {
    throw new Error('SQLite requires working PRAGMA case_sensitive_like (check SQLITE_OMIT_DEPRECATED)');
  }
}

// SQLite WAL readers can encounter recovery/last-close locks too. A work
// process waits for an independent holder, as the main business connection
// already does; it does not retry statements or discard an open LUW.
export function setupSqliteBusyTimeout(db) {
  db.exec("PRAGMA busy_timeout = 5000");
}
