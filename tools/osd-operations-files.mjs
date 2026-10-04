// A retained WAL reader must be closed BEFORE replacing a ledger's main
// file. An inode check after rename cannot stop its old WAL being replayed
// over the replacement, and Windows refuses the rename while it is open.
import {DatabaseSync} from 'node:sqlite';
import {existsSync, renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {setupSqliteBusyTimeout} from './sqlite-connection.mjs';

const readers = new Map();

export function retainOperationsReader(path, close) {
  const key = resolve(path);
  if (!readers.has(key)) readers.set(key, new Set());
  readers.get(key).add(close);
  return () => {
    const callbacks = readers.get(key);
    callbacks?.delete(close);
    if (!callbacks?.size) readers.delete(key);
  };
}

// Callers first stop workers/servers in other processes and prevent new
// opens until the file change finishes. Synchronous preparation closes ALL
// local retained monitors, checkpoints through a writer, then closes it.
// Switching out of WAL also refuses still-open foreign WAL connections;
// a busy checkpoint or journal-mode change must abort the file operation.
// Business databases have their own drift lifecycle; only ledgers enter it.
export function prepareOperationsFileChange(path) {
  const key = resolve(path);
  const closeReaders = () => { for (const close of [...(readers.get(key) ?? [])]) close(); };
  if (!existsSync(key)) { closeReaders(); return; }
  const probe = new DatabaseSync(key, {readOnly: true});
  let ledger;
  try {
    setupSqliteBusyTimeout(probe);
    ledger = probe.prepare("SELECT 1 FROM sqlite_master WHERE name = 'batch_runs'").get();
  } finally { probe.close(); }
  if (!ledger) { closeReaders(); return; }
  const writer = new DatabaseSync(key);
  try {
    setupSqliteBusyTimeout(writer);
    // Keep a writer present while readers close, avoiding a final read-only
    // close's WAL cleanup lock; it owns the explicit checkpoint below.
    closeReaders();
    if (writer.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy !== 0) {
      throw new Error('Operations ledger is busy; stop its workers and readers before changing files');
    }
    const mode = writer.prepare('PRAGMA journal_mode = DELETE').get().journal_mode;
    if (mode !== 'delete') throw new Error('Operations ledger still has an open WAL connection');
  } finally { writer.close(); }
}

export function replaceOperationsDatabase(from, to) {
  if (resolve(from) === resolve(to)) throw new Error('Operations replacement needs two different paths');
  prepareOperationsFileChange(from);
  prepareOperationsFileChange(to);
  renameSync(from, to);
}
