import {ident, literal} from './osd-db-schema.mjs';

// Foreign keys must be disabled before BEGIN, then checked before COMMIT.
// Restore connection settings on success and rollback alike.
export async function sqliteRebuildSettings(access) {
  const [{foreign_keys: foreignKeys}] = await access.query('PRAGMA foreign_keys');
  await access.execute('PRAGMA foreign_keys=OFF');
  return async () => access.execute(`PRAGMA foreign_keys=${Number(foreignKeys) ? 'ON' : 'OFF'}`);
}

export async function widenSqliteTable(access, before, want) {
  // Capture all views/triggers: indirect references and trigger bodies can
  // depend on this table too. SQLite permits forward references in views.
  const dependents = await access.query("SELECT name, type, sql FROM sqlite_master WHERE type IN ('view','trigger') AND sql IS NOT NULL");
  const indexes = await access.query(`SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=${literal(want.name)} AND sql IS NOT NULL`);
  for (const row of [...dependents].sort((a, b) => (a.type === 'trigger' ? -1 : 1) - (b.type === 'trigger' ? -1 : 1))) {
    await access.execute(`DROP ${row.type.toUpperCase()} ${ident(row.name)}`);
  }
  const temporary = `${want.name}__osd_widen`;
  await access.execute(want.sql.replace(/(CREATE TABLE\s+)["']?\w+["']?/i, `$1${ident(temporary)}`));
  const cols = before.columns.map(c => ident(c.name)).join(',');
  await access.execute(`INSERT INTO ${ident(temporary)} (${cols}) SELECT ${cols} FROM ${ident(want.name)}`);
  await access.execute(`DROP TABLE ${ident(want.name)}`);
  await access.execute(`ALTER TABLE ${ident(temporary)} RENAME TO ${ident(want.name)}`);
  for (const row of [...indexes, ...dependents.filter(row => row.type === 'view'), ...dependents.filter(row => row.type === 'trigger')]) {
    await access.execute(row.sql);
  }
}
