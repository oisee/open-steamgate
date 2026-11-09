// Call under the startup transaction/lock, before treating any table as ours.
// DuckDB and HANA historically used ZSTG_DEMO as their schema identity;
// SQLite and PostgreSQL persisted an OSD fingerprint instead.
import {ident, literal} from './osd-db-schema.mjs';

export async function requireDatabaseOwnership(access, engine, stamp, schema, file) {
  if (stamp) return true;
  let relations;
  if (engine === 'sqlite') {
    relations = [];
    for (const database of await access.query('PRAGMA database_list')) {
      const rows = await access.query(`SELECT name, type FROM ${ident(database.name)}.sqlite_master WHERE type IN ('table','view') AND name NOT GLOB 'sqlite_*'`);
      relations.push(...rows.map(row => ({...row, schema: database.name})));
    }
  } else if (engine === 'postgres') {
    // Include relations outside search_path, without privilege filtering.
    relations = await access.query(`SELECT c.relname AS name, ns.nspname AS schema, CASE WHEN c.relkind IN ('r','p') THEN 'table' ELSE 'relation' END AS type FROM pg_class c
      JOIN pg_namespace ns ON ns.oid=c.relnamespace
      WHERE ns.nspname NOT IN ('pg_catalog','information_schema')
        AND ns.nspname NOT LIKE 'pg_toast%' AND ns.nspname NOT LIKE 'pg_temp_%'`);
  } else if (engine === 'hana') {
    relations = await access.query(`SELECT TABLE_NAME AS name, 'table' AS type FROM SYS.TABLES WHERE SCHEMA_NAME=${literal(schema)}
      UNION ALL SELECT VIEW_NAME AS name, 'view' AS type FROM SYS.VIEWS WHERE SCHEMA_NAME=${literal(schema)}`);
  } else {
    relations = await access.query(`SELECT table_name AS name, table_schema AS schema, CASE WHEN table_type='BASE TABLE' THEN 'table' ELSE 'view' END AS type
      FROM information_schema.tables WHERE table_catalog=current_database()
        AND table_schema NOT IN ('information_schema','pg_catalog')`);
  }
  if (!relations.length) return false;
  // An identity in a customer schema cannot authorize writes to our schema.
  const ownSchema = schema ?? (engine === 'postgres' ? 'public' : 'main');
  const names = new Set(relations.filter(row => row.type === 'table' && (!row.schema || row.schema === ownSchema))
    .map(row => String(row.name).toLowerCase()));
  if (engine === 'hana' && names.has('osd_schema')) {
    const rows = await access.query('SELECT fingerprint FROM osd_schema LIMIT 1');
    if (rows[0]?.fingerprint?.trim()) return true;
  }
  if ((engine === 'duckdb' || engine === 'hana') && names.has('zstg_demo')) return true;
  if (names.has('zosd_job_source_instance')) {
    const rows = await access.query('SELECT id FROM zosd_job_source_instance LIMIT 1');
    if (/^[a-f0-9]{32}$/i.test(rows[0]?.id?.trim() ?? '')) return true;
  }
  throw Object.assign(new Error(`${engine} database${file ? ` ${file}` : schema ? ` schema ${schema}` : ''} has tables but no OSD schema stamp or identity; use a fresh dedicated database. Existing data left intact. Keep the old database, start fresh at a new database path/schema, then copy application rows after checking their definitions.`), {code: 'DATABASE_NOT_OWNED'});
}
