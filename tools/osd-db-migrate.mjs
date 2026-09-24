// Column renames a database file made by an earlier build still carries.
//
// A backend that stamps its schema (SQLite in memory with STG_DB_PATH, the
// SQLite file, PostgreSQL) already notices any change of the DDIC and
// rebuilds, sets the file aside or refuses, each by its own policy. DuckDB
// with STG_DB_PATH does not: test/setup.mjs checks only that every table is
// there, so a file made before a column was renamed opens, and the first
// SELECT naming the new column fails. That file is also the one a real import
// fills (tools/import-nyc-taxi.mjs), which is why it gets a migration rather
// than "import again".
//
// One list, applied where every host opens such a file: the DuckDB branch of
// test/setup.mjs (server, binary, unit run) and the import tool, which opens
// the file itself. Idempotent: a rename whose old column is gone is done; a
// table that has both columns is not guessed at.
//
// One-way: a build from before a rename cannot read a migrated file (its
// first SELECT of the old column fails). HANA (STG_DB=hana, a kept schema) is
// not migrated; refuseUnmigratedHana says so instead of failing later.

export const COLUMN_RENAMES = [
  // ZONE is a reserved word in the dictionary of a system: the table does not
  // activate there (ANORMALIES zone-reserved-word).
  {table: "zosd_taxifact", from: "zone", to: "pickup_zone"},
];

function quote(name) {
  return '"' + String(name).replaceAll('"', '""') + '"';
}

function columnsOf(rows) {
  const columns = new Map();
  for (const row of rows) {
    const table = String(row.table_name).toLowerCase();
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table).add(String(row.column_name).toLowerCase());
  }
  return columns;
}

/** The renames `rows` (table_name, column_name) still need. */
export function pendingRenames(rows, renames = COLUMN_RENAMES) {
  const columns = columnsOf(rows);
  const pending = [];
  for (const rename of renames) {
    const have = columns.get(rename.table);
    if (have === undefined || !have.has(rename.from)) continue;
    if (have.has(rename.to)) {
      throw new Error(`${rename.table} has both ${rename.from} and ${rename.to}; an old column next to the new one is not migrated automatically`);
    }
    pending.push(rename);
  }
  return pending;
}

/** `query(sql)` returns row objects, `execute(sql)` runs a statement; both
 *  against DuckDB (information_schema, ALTER TABLE ... RENAME COLUMN).
 *  Returns the renames applied, as "table.from -> to". Runs in whatever
 *  transaction the caller has open. */
export async function migrateDuckdbColumns({query, execute}, renames = COLUMN_RENAMES) {
  const rows = await query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'main'");
  const applied = [];
  for (const {table, from, to} of pendingRenames(rows, renames)) {
    await execute(`ALTER TABLE ${quote(table)} RENAME COLUMN ${quote(from)} TO ${quote(to)}`);
    applied.push(`${table}.${from} -> ${to}`);
  }
  return applied;
}

function viewsOf(statements) {
  return [statements].flat().map(String)
    .map((sql) => ({sql, name: sql.match(/^\s*CREATE\s+VIEW\s+"?([A-Za-z_][A-Za-z_0-9]*)"?/i)?.[1]}))
    .filter((view) => view.name !== undefined);
}

/** A view holds no rows, and DuckDB keeps a view's SQL as it was written: a
 *  renamed column leaves every view over it failing at its first read, and a
 *  CDS view a later build changed is served in its old shape. So a file made
 *  earlier gets the running generation's views, dropped and created again
 *  from `statements` (the DuckDB schema, in its own order). Views the
 *  generation does not have (a deleted CDS view, one somebody made by hand)
 *  are left alone and returned by name, since they may name an old column.
 *  Runs in whatever transaction the caller has open. */
export async function refreshDuckdbViews({query, execute}, statements) {
  const views = viewsOf(statements);
  for (const {name} of [...views].reverse()) {
    await execute(`DROP VIEW IF EXISTS ${quote(name)}`);
  }
  for (const {sql} of views) {
    await execute(sql);
  }
  const ours = new Set(views.map((view) => view.name.toLowerCase()));
  const present = await query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_type = 'VIEW'");
  const foreign = present.map((row) => String(row.table_name)).filter((name) => !ours.has(name.toLowerCase())).sort();
  return {refreshed: views.length, foreign};
}

/** Both of the above in one transaction: DuckDB's DDL is transactional, so a
 *  failure half-way leaves the file as it was, with its views, rather than
 *  renamed and without them. */
export async function migrateDuckdbFile(access, statements) {
  await access.execute("BEGIN TRANSACTION");
  try {
    const renamed = await migrateDuckdbColumns(access);
    const views = await refreshDuckdbViews(access, statements);
    await access.execute("COMMIT");
    return {renamed, ...views};
  } catch (error) {
    await access.execute("ROLLBACK");
    throw error;
  }
}

/** A kept HANA schema is not migrated: say which rename it lacks and how to
 *  get a schema this build can read, before the first SELECT fails. */
export async function refuseUnmigratedHana({query}, schema) {
  const rows = await query(`SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name FROM SYS.TABLE_COLUMNS WHERE SCHEMA_NAME = '${String(schema).replaceAll("'", "''")}'`);
  const pending = pendingRenames(rows);
  if (pending.length > 0) {
    const names = pending.map(({table, from, to}) => `${table}.${from} (now ${to})`).join(", ");
    throw new Error(`HANA schema ${schema} was made before a column rename: ${names}. It is not migrated; recreate it with STG_DB_FRESH=1 or use a new HANA_SCHEMA`);
  }
}
