// The generated DDL is deliberately small: named columns, a primary key,
// optional defaults/collations and indexes. Reject shapes we cannot compare.
export const ident = (name) => '"' + String(name).replaceAll('"', '""') + '"';
export const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
export function splitDDL(text) {
  const parts = []; let start = 0, depth = 0, quote;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) { if (text[i + 1] === quote) i++; else quote = undefined; } }
    else if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(text.slice(start).trim()); return parts;
}
function typeOf(type, engine) {
  let t = type.toUpperCase().replace(/\s+/g, '').replace(/^INTEGER$/, 'INT').replace(/^CHARACTER/, 'CHAR')
    .replace(/^NUMERIC/, 'DECIMAL');
  // DuckDB does not enforce/store VARCHAR lengths. The ledger preserves
  // DDIC lengths after the first upgrade; old unstamped files have TEXT.
  if (engine === 'duckdb' && /^(?:VARCHAR|TEXT|STRING)(?:\(\d+\))?$/.test(t)) t = 'TEXT';
  return t;
}
export function tableDDL(sql, engine = 'sqlite') {
  const match = /^\s*CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["']?([\w]+)["']?\s*\(([\s\S]*)\)\s*;?$/i.exec(sql);
  if (!match) throw new Error(`Cannot compare table DDL: ${sql.slice(0, 120)}`);
  const columns = [], key = [], constraints = [];
  for (const piece of splitDDL(match[2])) {
    const primary = /^PRIMARY KEY\s*\((.*)\)$/i.exec(piece);
    if (primary) { key.push(...splitDDL(primary[1]).map(s => s.replace(/["']/g, '').toLowerCase())); continue; }
    const column = /^["']?(\w+)["']?\s+((?:\w+)(?:\s*\([^)]*\))?)(.*)$/i.exec(piece);
    if (!column || /^(CONSTRAINT|UNIQUE|CHECK|FOREIGN)$/i.test(column[1])) { constraints.push(piece); continue; }
    const tail = column[3].trim();
    if (/PRIMARY KEY/i.test(tail)) key.push(column[1].toLowerCase());
    columns.push({name: column[1].toLowerCase(), type: typeOf(column[2], engine),
      notnull: /NOT NULL/i.test(tail), default: /\bDEFAULT\s+(.+?)(?=\s+(?:COLLATE|NOT NULL|PRIMARY KEY)|$)/i.exec(tail)?.[1],
      extra: tail.replace(/\b(?:NOT NULL|PRIMARY KEY|DEFAULT\s+.+?(?=\s+(?:COLLATE|NOT NULL|PRIMARY KEY)|$))/ig, '').trim().toUpperCase(),
      sql: piece});
  }
  return {name: match[1].toLowerCase(), sql, columns, key, constraints};
}
export function classifyTable(old, wanted) {
  if (!old) return {kind: 'create'};
  const incompatible = (reason) => ({kind: 'incompatible', reason});
  if (JSON.stringify(old.key) !== JSON.stringify(wanted.key)) return incompatible('primary key changed');
  if (JSON.stringify(old.constraints) !== JSON.stringify(wanted.constraints)) return incompatible('constraints changed');
  const added = [], widened = [];
  for (const before of old.columns) {
    const after = wanted.columns.find(c => c.name === before.name);
    if (!after) return incompatible(`column dropped: ${before.name}`);
    if (before.notnull !== after.notnull || before.default !== after.default || before.extra !== after.extra) {
      return incompatible(`column constraints changed: ${before.name}`);
    }
    if (before.type !== after.type) {
      const a = /^(NCHAR|CHAR|VARCHAR|RAW|VARBINARY)\((\d+)\)$/.exec(before.type);
      const b = /^(NCHAR|CHAR|VARCHAR|RAW|VARBINARY)\((\d+)\)$/.exec(after.type);
      if (!a || !b || a[1] !== b[1] || Number(b[2]) < Number(a[2])) return incompatible(`type changed: ${before.name}`);
      widened.push(after);
    }
  }
  for (const column of wanted.columns) if (!old.columns.some(c => c.name === column.name)) {
    if (column.notnull && column.default === undefined) return incompatible(`required column added: ${column.name}`);
    added.push(column);
  }
  return {kind: added.length || widened.length ? 'compatible' : 'same', added, widened};
}
export function generatedTables(insert) {
  return new Set([insert].flat().map(s => /^\s*INSERT INTO ["']?([\w]+)["']?/i.exec(s)?.[1]?.toLowerCase()).filter(Boolean));
}

// Read actual catalog DDL on the first upgrade. Later upgrades use the ledger
// because DuckDB's catalog loses declared character lengths.
export async function catalog(access, engine) {
  if (engine === 'sqlite') return access.query("SELECT name, type, sql, tbl_name AS table_name FROM sqlite_master WHERE type IN ('table','view','index','trigger') AND sql IS NOT NULL");
  if (engine === 'duckdb') {
    const tables = await access.query("SELECT table_name AS name, 'table' AS type, sql FROM duckdb_tables() WHERE schema_name = 'main'");
    const views = await access.query("SELECT view_name AS name, 'view' AS type, sql FROM duckdb_views() WHERE schema_name = 'main' AND NOT internal");
    const indexes = await access.query("SELECT index_name AS name, 'index' AS type, sql FROM duckdb_indexes() WHERE schema_name = 'main'");
    return [...tables, ...views, ...indexes];
  }
  const columns = await access.query(`SELECT c.table_name, c.column_name, c.data_type, c.character_maximum_length,
    c.numeric_precision, c.numeric_scale, c.is_nullable, c.column_default
    FROM information_schema.columns c JOIN information_schema.tables t
    ON t.table_schema=c.table_schema AND t.table_name=c.table_name
    WHERE c.table_schema='public' AND t.table_type='BASE TABLE' ORDER BY c.table_name,c.ordinal_position`);
  const keys = await access.query(`SELECT tc.table_name, k.column_name FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage k ON k.constraint_name=tc.constraint_name AND k.table_schema=tc.table_schema
    WHERE tc.table_schema='public' AND tc.constraint_type='PRIMARY KEY' ORDER BY tc.table_name,k.ordinal_position`);
  const tables = new Map();
  for (const c of columns) {
    let type = c.data_type.toUpperCase();
    if (type === 'CHARACTER') type = `NCHAR(${c.character_maximum_length})`;
    else if (type === 'CHARACTER VARYING') type = c.character_maximum_length ? `VARCHAR(${c.character_maximum_length})` : 'TEXT';
    else if (type === 'NUMERIC') type = `DECIMAL(${c.numeric_precision},${c.numeric_scale})`;
    else if (type === 'INTEGER') type = 'INT';
    else if (type === 'DOUBLE PRECISION') type = 'FLOAT';
    if (!tables.has(c.table_name)) tables.set(c.table_name, []);
    tables.get(c.table_name).push(`${ident(c.column_name)} ${type}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}${c.column_default == null ? '' : ` DEFAULT ${c.column_default}`}`);
  }
  const constraints = await access.query(`SELECT t.relname AS table_name, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND c.contype IN ('u','c','f')`);
  const result = [...tables].map(([name, fields]) => {
    const key = keys.filter(k => k.table_name === name).map(k => ident(k.column_name));
    fields.push(...constraints.filter(c => c.table_name === name).map(c => c.definition));
    if (key.length) fields.push(`PRIMARY KEY(${key.join(',')})`);
    return {name, type: 'table', sql: `CREATE TABLE ${ident(name)} (${fields.join(',')})`};
  });
  result.push(...await access.query("SELECT viewname AS name, 'view' AS type, definition AS sql FROM pg_views WHERE schemaname='public'"));
  result.push(...await access.query(`SELECT indexname AS name, 'index' AS type, indexdef AS sql FROM pg_indexes
    WHERE schemaname='public' AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE contype IN ('p','u'))`));
  return result;
}
