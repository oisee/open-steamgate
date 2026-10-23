// Startup compares and migrates individual tables under one engine lock.
// The historical DuckDB column/view helpers remain usable by import tools;
// runtime startup uses the general planner below, including those renames.
// HANA keeps its explicit refusal checks (docs/db-migrations.md).

export const COLUMN_RENAMES = [
  // ZONE is a reserved word in the dictionary of a system: the table does not
  // activate there (ANORMALIES zone-reserved-word). The CDS element is
  // PickupZone for the same reason, which the file's views get at boot.
  {table: "zosd_taxifact", from: "zone", to: "pickup_zone"},
  // HANDLER, SECTION and PARAMETER are reserved the same way (TRESE; A4H
  // refuses each in a transparent table, ANORMALIES zone-reserved-word). The
  // status tables and the APC inventory are refilled at every boot, the
  // aside records and the module signatures are not; all of them are renamed
  // so no file is left with a column the build no longer names.
  {table: "zosd_icf_apc", from: "handler", to: "class_name"},
  {table: "zosd_icf_aside", from: "handler", to: "icf_handler"},
  {table: "zosd_svc", from: "handler", to: "handler_name"},
  {table: "zosd_db", from: "section", to: "category"},
  {table: "zstg_fm_param", from: "parameter", to: "param_name"},
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
    const columns = await access.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'main' AND table_name = 'zosd_job_step'");
    if (columns.length && !columns.some((row) => String(row.column_name).toLowerCase() === "input_json")) {
      await access.execute('ALTER TABLE "zosd_job_step" ADD COLUMN "input_json" TEXT');
      await access.execute("UPDATE zosd_job_step SET input_json = '[]'");
    }
    // DSL L3 slice 5d: the outbox's release order and the binding a DSL L3
    // run started with. A file from before has neither; its pending outbox
    // rows get an empty RELEASE_SEQ (so they drain first, in their old order)
    // and its gate rows an empty RUN_BIND (a run from before the record: real)
    for (const [table, column] of [["zosd_job_outbox", "release_seq"], ["zosd_l3_stage", "run_bind"]]) {
      const present = await access.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'main' AND table_name = '${table}'`);
      if (present.length && !present.some((row) => String(row.column_name).toLowerCase() === column)) {
        await access.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" TEXT`);
        await access.execute(`UPDATE "${table}" SET "${column}" = ''`);
      }
    }
    const views = await refreshDuckdbViews(access, statements);
    await access.execute("COMMIT");
    return {renamed, ...views};
  } catch (error) {
    await access.execute("ROLLBACK");
    throw error;
  }
}

/** A kept HANA schema is not migrated: say which rename it lacks and how to
 *  get a schema this build can read, before the first SELECT fails. It looks
 *  at table columns only; the HANA branch of setup does not remake views, so
 *  a schema whose table is already renamed but whose views are older (made by
 *  a build between the column rename and the CDS element rename, #67 without
 *  #69) passes here and fails at `SELECT ... PICKUPZONE`. Recreate that one
 *  with STG_DB_FRESH=1 too. */
export async function refuseUnmigratedHana({query}, schema) {
  const rows = await query(`SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name FROM SYS.TABLE_COLUMNS WHERE SCHEMA_NAME = '${String(schema).replaceAll("'", "''")}'`);
  const pending = pendingRenames(rows);
  if (pending.length > 0) {
    const names = pending.map(({table, from, to}) => `${table}.${from} (now ${to})`).join(", ");
    throw new Error(`HANA schema ${schema} was made before a column rename: ${names}. It is not migrated; recreate it with STG_DB_FRESH=1 or use a new HANA_SCHEMA`);
  }
  const stepColumns = new Set(rows.filter((row) => String(row.table_name).toLowerCase() === "zosd_job_step")
    .map((row) => String(row.column_name).toLowerCase()));
  if (stepColumns.size && !stepColumns.has("input_json")) {
    throw new Error(`HANA schema ${schema} lacks zosd_job_step.input_json; recreate it with STG_DB_FRESH=1 or use a new HANA_SCHEMA`);
  }
}

// General startup migration. Every read and every write below belongs to the
// caller's one startup transaction, including generated rows and the stamp.
import {fingerprintOf} from './osd-persist.mjs';
import {catalog, tableDDL, classifyTable, generatedTables, ident, literal} from './osd-db-schema.mjs';
import {requireDatabaseOwnership} from './osd-db-ownership.mjs';
import {sqliteRebuildSettings, widenSqliteTable} from './osd-db-sqlite-rebuild.mjs';

export async function startupDatabase(db, ddl, insert, {seed = [], reseed = async () => {}, scale = async () => {}, strict = false, log = console.log} = {}) {
  const engine = db.name === 'postgres' ? 'postgres' : db.name === 'duckdb' ? 'duckdb' : 'sqlite';
  const access = {
    execute: (sql) => db.execute(sql),
    query: async (sql) => { const result = await db.query(sql); return result.rows ?? result; },
  };
  const restoreSettings = engine === 'sqlite' ? await sqliteRebuildSettings(access) : async () => {};
  // PostgreSQL uses one checked-out session, at READ COMMITTED. A waiter
  // gets its catalog snapshot AFTER the advisory lock, never before it.
  if (engine === 'postgres') {
    await db.beginTransaction();
    try {await access.query('SELECT pg_advisory_xact_lock(1869833316, 1)');}
    catch(error) {await db.rollback();throw error;}
  } else {
    await db.startupLock?.();
    try { await access.execute(engine === 'sqlite' ? 'BEGIN IMMEDIATE' : 'BEGIN TRANSACTION'); }
    catch (error) { await db.startupUnlock?.(); await restoreSettings(); throw error; }
    db.inTransaction = true;
  }
  const wanted = fingerprintOf(ddl);
  const boot = fingerprintOf([ddl, insert, seed]);
  // Seed/refresh helpers may call commit; they must not release our lock.
  const held = new Proxy(db, {get(target, key) {
    if (key === 'commit' || key === 'beginTransaction') return async () => {};
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const result = {migrated: false, created: [], rebuilt: [], aside: [], changed: []};
  try {
    // Existence probe avoids an exception aborting a PostgreSQL transaction.
    const stampExists = engine === 'sqlite'
      ? await access.query("SELECT name FROM sqlite_master WHERE name='osd_schema'")
      : await access.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='${engine === 'postgres' ? 'public' : 'main'}' AND table_name='osd_schema'`);
    const found = stampExists.length ? (await access.query('SELECT fingerprint FROM osd_schema LIMIT 1'))[0]?.fingerprint?.trim() : undefined;
    await requireDatabaseOwnership(access, engine, found, undefined, db.path);
    const bootExists = engine === 'sqlite'
      ? await access.query("SELECT name FROM sqlite_master WHERE name='osd_schema_boot'")
      : await access.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='${engine === 'postgres' ? 'public' : 'main'}' AND table_name='osd_schema_boot'`);
    const lastBoot = bootExists.length ? (await access.query('SELECT fingerprint FROM osd_schema_boot LIMIT 1'))[0]?.fingerprint?.trim() : undefined;
    if (found !== wanted || lastBoot !== boot) {
      const present = await catalog(access, engine);
      const fresh = !present.some(t => t.type === 'table' && !t.name.startsWith('osd_schema'));
      const desired = [ddl].flat().filter(s => /^\s*CREATE TABLE\b/i.test(s)).map(s => tableDDL(s));
      const owned = generatedTables(insert);
      // These tables contain only derived inventory/cross references, filled
      // by the runtime startup writers. Never infer ownership from a Z prefix.
      for (const name of ['zosd_sys','zosd_proc','zosd_port','zosd_svc','zosd_pack','zosd_db',
        'cross','wbcrossgt','wbcrossgtx','d010inc','zosd_icf_apc']) owned.add(name);
      const ledgerExists = present.some(t => t.name === 'osd_schema_tables');
      const ledger = new Map(ledgerExists ? (await access.query('SELECT name, ddl FROM osd_schema_tables')).map(t => [t.name, t.ddl]) : []);
      // Drop only views owned by this generation, reverse dependency order.
      const views = [ddl].flat().filter(s => /^\s*CREATE VIEW\b/i.test(s));
      const viewNames = new Set(views.map(sql => /^\s*CREATE VIEW\s+["']?(\w+)/i.exec(sql)?.[1]?.toLowerCase()));
      const viewTriggers = engine === 'sqlite' ? present.filter(t => t.type === 'trigger' && viewNames.has(t.table_name.toLowerCase())) : [];
      for (const sql of [...views].reverse()) {
        const name = /^\s*CREATE VIEW\s+["']?(\w+)/i.exec(sql)?.[1];
        await access.execute(`DROP VIEW IF EXISTS ${ident(name)}`);
      }
      const actual = new Map(present.filter(t => t.type === 'table').map(t => [t.name.toLowerCase(), t]));
      // Preserve the documented column renames, also for old unstamped files.
      // They are explicit knowledge of an earlier DDIC, never guesses.
      for (const rename of COLUMN_RENAMES) {
        const old = actual.get(rename.table), want = desired.find(t => t.name === rename.table);
        if (!old || !want || !want.columns.some(c => c.name === rename.to)) continue;
        const shape = tableDDL(old.sql, engine);
        if (!shape.columns.some(c => c.name === rename.from)) continue;
        if (shape.columns.some(c => c.name === rename.to)) throw new Error(`${rename.table} has both ${rename.from} and ${rename.to}`);
        await access.execute(`ALTER TABLE ${ident(rename.table)} RENAME COLUMN ${ident(rename.from)} TO ${ident(rename.to)}`);
        const replace = s => s.replace(new RegExp(`(["'])${rename.from}\\1`, 'gi'), `$1${rename.to}$1`)
          .replace(new RegExp(`\\b${rename.from}\\b`, 'gi'), rename.to);
        old.sql = replace(old.sql);
        if (ledger.has(rename.table)) ledger.set(rename.table, replace(ledger.get(rename.table)));
      }
      for (const want of desired) {
        const stored = actual.get(want.name);
        const before = stored ? tableDDL(ledger.get(want.name) ?? stored.sql, ledger.has(want.name) ? 'sqlite' : engine) : undefined;
        if (before && engine === 'duckdb' && !ledger.has(want.name)) {
          for (const col of before.columns) {
            const wantedCol = want.columns.find(c => c.name === col.name);
            if (col.type === 'TEXT' && /^(?:VARCHAR|TEXT)/.test(wantedCol?.type ?? '')) col.type = wantedCol.type;
          }
        }
        // Catalogs can mark PK fields NOT NULL implicitly.
        if (before) for (const col of before.columns) if (before.key.includes(col.name)) col.notnull = want.columns.find(c => c.name === col.name)?.notnull ?? col.notnull;
        const change = classifyTable(before, want);
        if (change.kind === 'same') continue;
        result.changed.push(want.name);
        if (engine === 'sqlite') await access.execute('SAVEPOINT osd_table_migration');
        if (change.kind === 'create') {
          await access.execute(want.sql); result.created.push(want.name);
        } else if (change.kind === 'incompatible') {
          if (owned.has(want.name)) {
            await access.execute(`DROP TABLE ${ident(want.name)}`); result.rebuilt.push(want.name);
          } else {
            if (strict) throw Object.assign(new Error(`Schema drift in ${want.name}: ${change.reason} (STG_DB_STRICT=1)`), {code: 'SCHEMA_DRIFT'});
            const stem = `${want.name.slice(0, 32)}__drift_${fingerprintOf(before.sql)}`;
            let aside = stem, n = 0;
            while ((await catalog(access, engine)).some(t => t.name === aside)) aside = `${stem}_${++n}`;
            // PG indexes/constraints retain their names after RENAME TABLE.
            // Rename indexes before making the replacement's primary key.
            if (engine === 'postgres') {
              const indexes = await access.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename=${literal(want.name)}`);
              for (const [i, index] of indexes.entries()) await access.execute(`ALTER INDEX ${ident(index.indexname)} RENAME TO ${ident(`${aside.slice(0, 53)}_i${i}`)}`);
            }
            await access.execute(`ALTER TABLE ${ident(want.name)} RENAME TO ${ident(aside)}`);
            result.aside.push({table: want.name, backup: aside, reason: change.reason});
          }
          await access.execute(want.sql);
        } else {
          if (engine === 'sqlite' && change.widened.length) {
            await widenSqliteTable(access, before, want);
          } else {
            for (const col of change.added) {
              const definition = engine === 'duckdb' ? col.sql.replace(/\s+NOT NULL/ig, '') : col.sql;
              await access.execute(`ALTER TABLE ${ident(want.name)} ADD COLUMN ${definition}`);
              if (engine === 'duckdb' && col.notnull) await access.execute(`ALTER TABLE ${ident(want.name)} ALTER COLUMN ${ident(col.name)} SET NOT NULL`);
            }
            for (const col of change.widened.filter(() => engine !== 'duckdb')) await access.execute(`ALTER TABLE ${ident(want.name)} ALTER COLUMN ${ident(col.name)} TYPE ${col.type}`);
          }
          // Old pending jobs must retain their initial-value semantics.
          for (const col of change.added) if (want.name.startsWith('zosd_job_') || want.name === 'zosd_l3_stage') {
            const value = col.name === 'input_json' ? '[]' : /^INT|DECIMAL|FLOAT/.test(col.type) ? 0 : '';
            await access.execute(`UPDATE ${ident(want.name)} SET ${ident(col.name)}=${typeof value === 'number' ? value : literal(value)} WHERE ${ident(col.name)} IS NULL`);
          }
        }
        if (engine === 'sqlite') await access.execute('RELEASE osd_table_migration');
      }
      // Index DDL belongs to the current generation. Unknown user indexes
      // are retained; only indexes recorded in the prior ledger can disappear.
      const wantedIndexes = [ddl].flat().filter(s => /^\s*CREATE (?:UNIQUE )?INDEX\b/i.test(s));
      const indexName = s => /^\s*CREATE (?:UNIQUE )?INDEX\s+["']?(\w+)/i.exec(s)?.[1];
      const oldIndexes = [...ledger].filter(([name]) => name.startsWith('@index:'));
      for (const [name, sql] of oldIndexes) if (!wantedIndexes.includes(sql)) await access.execute(`DROP INDEX IF EXISTS ${ident(name.slice(7))}`);
      for (const sql of wantedIndexes) {
        const old = present.find(t => t.type === 'index' && t.name === indexName(sql));
        if (!old || oldIndexes.some(([name, prior]) => name === `@index:${indexName(sql)}` && prior !== sql) || result.changed.some(name => new RegExp(`\\b${name}\\b`, 'i').test(sql))) {
          await access.execute(`DROP INDEX IF EXISTS ${ident(indexName(sql))}`); await access.execute(sql);
        }
      }
      for (const sql of views) await access.execute(sql);
      for (const trigger of viewTriggers) await access.execute(trigger.sql);
      // Seed only new/replaced tables. Application rows in surviving tables
      // are never overwritten by an upgrade.
      const seedTables = new Set([...result.created, ...result.rebuilt, ...result.aside.map(t => t.table)]);
      await access.execute(seed.filter(sql => fresh || seedTables.has(/^\s*INSERT INTO ["']?(\w+)/i.exec(sql)?.[1]?.toLowerCase())));
      // The transpiler owns every table its generated INSERTs target.
      for (const name of generatedTables(insert)) await access.execute(`DELETE FROM ${ident(name)}`);
      await access.execute(insert);
      if (!fresh) {
        // Pack captures may include application data. Refresh only generated
        // tables or replacements: an unrelated upgrade must keep user rows
        // in a surviving pack table as well as a surviving root table.
        const refresh = new Proxy(held, {get(target, key) {
          if (key !== 'execute') return Reflect.get(target, key);
          return async statements => {
            for (const sql of [statements].flat()) {
              const name = /^\s*(?:DELETE FROM|INSERT INTO) ["']?(\w+)/i.exec(sql)?.[1]?.toLowerCase();
              if (!name || owned.has(name) || seedTables.has(name)) await access.execute(sql);
            }
          };
        }});
        await reseed(refresh);
      }
      if (fresh) await scale(held);
      if (result.created.includes('zosd_job_identity') && actual.has('zosd_job_outbox')) {
        await access.execute(`INSERT INTO zosd_job_identity (mandt,jobname,jobcount,owner,intent_id)
          SELECT mandt,UPPER(TRIM(jobname)),jobcount,owner,intent_id FROM zosd_job_outbox`);
      }
      await access.execute('CREATE TABLE IF NOT EXISTS osd_schema_tables (name VARCHAR(128) PRIMARY KEY, fingerprint VARCHAR(16), ddl TEXT)');
      await access.execute('DELETE FROM osd_schema_tables');
      for (const table of desired) await access.execute(`INSERT INTO osd_schema_tables VALUES (${literal(table.name)},${literal(fingerprintOf(table.sql))},${literal(table.sql)})`);
      for (const sql of wantedIndexes) await access.execute(`INSERT INTO osd_schema_tables VALUES (${literal(`@index:${indexName(sql)}`)},${literal(fingerprintOf(sql))},${literal(sql)})`);
      await access.execute('CREATE TABLE IF NOT EXISTS osd_schema_drift (table_name VARCHAR(128), backup VARCHAR(128), reason TEXT, migrated_at VARCHAR(32))');
      for (const drift of result.aside) await access.execute(`INSERT INTO osd_schema_drift VALUES (${literal(drift.table)},${literal(drift.backup)},${literal(drift.reason)},${literal(new Date().toISOString())})`);
      await access.execute('CREATE TABLE IF NOT EXISTS osd_schema (fingerprint VARCHAR(16))');
      if (found !== undefined) await access.execute(`UPDATE osd_schema SET fingerprint=${literal(wanted)}`);
      else {
        await access.execute('DELETE FROM osd_schema');
        await access.execute(`INSERT INTO osd_schema (fingerprint) VALUES (${literal(wanted)})`);
      }
      await access.execute('CREATE TABLE IF NOT EXISTS osd_schema_boot (fingerprint VARCHAR(16))');
      await access.execute('DELETE FROM osd_schema_boot');
      await access.execute(`INSERT INTO osd_schema_boot VALUES (${literal(boot)})`);
      result.migrated = found !== wanted;
    }
    if (engine === 'sqlite') {
      await access.execute('CREATE TABLE IF NOT EXISTS zosd_job_source_instance (id TEXT PRIMARY KEY)');
      const rows = await access.query('SELECT id FROM zosd_job_source_instance LIMIT 1');
      if (!rows.length) {
        const {randomBytes} = await import('node:crypto');
        await access.execute(`INSERT INTO zosd_job_source_instance VALUES (${literal(randomBytes(16).toString('hex'))})`);
      }
    }
    const driftExists = engine === 'sqlite'
      ? await access.query("SELECT name FROM sqlite_master WHERE name='osd_schema_drift'")
      : await access.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='${engine === 'postgres' ? 'public' : 'main'}' AND table_name='osd_schema_drift'`);
    db.schemaDrift = driftExists.length ? await access.query('SELECT table_name, backup, reason FROM osd_schema_drift ORDER BY migrated_at') : [];
    // Enforcement is disabled for the startup transaction, including a
    // generated-row refresh with unchanged DDL. Validate every such commit.
    if (engine === 'sqlite' && (await access.query('PRAGMA foreign_key_check')).length) {
      throw new Error('Database migration failed SQLite foreign_key_check; existing data left intact');
    }
    await db.commit();
    for (const drift of result.aside) log(`Database migration: ${drift.table} preserved as ${drift.backup}: ${drift.reason}`);
    return result;
  } catch (error) {
    await db.rollback(); throw error;
  } finally { await restoreSettings(); await db.startupUnlock?.(); }
}
