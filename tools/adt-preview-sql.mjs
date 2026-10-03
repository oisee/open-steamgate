// Preview SELECTs run on the serving connection inside the current step.
import {Data} from './osd-data.mjs';
import {previewCells} from './adt-datapreview-cells.mjs';

export async function previewSQL(client, kind, input) {
  const statement = input.trim ? (String(input.statement).trim() || input.fallback) : input.statement;
  const data = new Data({client});
  const sqlite = client.sqlite ?? client.db;
  const pg = client.name === 'postgres' || client.constructor?.name === 'OsdPostgresClient' ? client.client : undefined;
  const exec = pg ? sql => pg.query(sql) : sqlite?.exec ? sql => sqlite.exec(sql) : undefined;
  const started = Date.now();
  if (exec) await exec('SAVEPOINT osd_adt_preview');
  try {
    const value = kind === 'SQLCHECK' ? (await data.check(statement), {ok: true})
      : previewCells(await data.query(statement, {max: Number(input.limit ?? '100')}));
    if (exec) await exec('RELEASE SAVEPOINT osd_adt_preview');
    return {...value, ms: Date.now() - started};
  } catch (error) {
    if (exec) {
      await exec('ROLLBACK TO SAVEPOINT osd_adt_preview');
      await exec('RELEASE SAVEPOINT osd_adt_preview');
    } else if (client.name === 'duckdb' && client.inTransaction) {
      await client.replayAfterFailure();
    }
    const message = String(error?.message?.get?.() || error?.message || error?.cause?.message || error?.code || '');
    return {error: {code: error?.code ?? 'SQL_ERROR', message}, code: error?.code ?? '', message, statement,
      rawMessage: String(error?.message?.get?.() ?? error?.message ?? error)};
  }
}
