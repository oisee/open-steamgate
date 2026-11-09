import {randomBytes} from "node:crypto";
import {adtHandleMigration} from "./osd-adt-handle-migrate.mjs";
// Standalone migrations take the write lock; startup holds it across the
// whole chain and the drift decision. Savepoints keep each migration's
// rollback local without releasing the startup transaction.
function withSchemaMigrationLock(native, migrate) {
  const nested = native.isTransaction;
  native.exec(nested ? "SAVEPOINT osd_schema_migration" : "BEGIN IMMEDIATE");
  try {
    const result = migrate();
    native.exec(nested ? "RELEASE osd_schema_migration" : "COMMIT");
    return result;
  } catch (error) {
    if (nested) {
      native.exec("ROLLBACK TO osd_schema_migration");
      native.exec("RELEASE osd_schema_migration");
    } else {
      native.exec("ROLLBACK");
    }
    throw error;
  }
}

export function migrateAdtHandleFile(native, found, wanted, ddl, fingerprintOf) {
  const table = adtHandleMigration(found, wanted, ddl, fingerprintOf);
  if (!table) return false;
  return withSchemaMigrationLock(native, () => {
    const current = native.prepare("SELECT fingerprint FROM osd_schema LIMIT 1").get()?.fingerprint;
    if (current === wanted) return true;
    if (current !== found) return false;
    // These rows are transient session handles, so discarding them on an
    // upgrade is acceptable. No business table or session row is dropped.
    native.exec("DROP TABLE zosd_adt_shdl");
    native.exec(table);
    native.prepare("UPDATE osd_schema SET fingerprint = ?, at = ?")
      .run(wanted, new Date().toISOString());
    return true;
  });
}

// Add the permanent job key to the previous business schema without moving
// useful rows aside. Backfill unacknowledged intents before a new OPEN can
// allocate their count. The operations ledger covers already acknowledged
// pre-upgrade intents at candidate selection time.
export function migrateJobIdentityFile(native, found, wanted, ddl, fingerprintOf) {
  const identity = ddl.find((statement) => /^CREATE TABLE ['"]zosd_job_identity['"] /i.test(statement));
  const step = ddl.find((statement) => /^CREATE TABLE ['"]zosd_job_step['"] /i.test(statement));
  const parent = ddl.find((statement) => /^CREATE TABLE ['"]zosd_job_outbox['"] /i.test(statement));
  if (!identity || !step || !parent || fingerprintOf(ddl) !== wanted) return false;
  const oldParent = parent.replace(/,\s*['"]step_count['"]\s+NCHAR\(2\)/i, "");
  const previous = ddl.filter((statement) => statement !== identity);
  const oneStep = previous.filter((statement) => statement !== step)
    .map((statement) => statement === parent ? oldParent : statement);
  const prior = fingerprintOf(previous) === found ? "multistep" :
    fingerprintOf(oneStep) === found && oldParent !== parent ? "one-step" : undefined;
  if (!prior) return false;
  return withSchemaMigrationLock(native, () => {
    const current = native.prepare("SELECT fingerprint FROM osd_schema LIMIT 1").get()?.fingerprint;
    if (current === wanted) return true;
    if (current !== found) return false;
    if (native.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'zosd_job_identity'").get()) {
      return false;
    }
    if (prior === "one-step") {
      native.exec("ALTER TABLE zosd_job_outbox ADD COLUMN step_count NCHAR(2)");
      native.exec(step);
    }
    native.exec(identity);
    const insertIdentity = native.prepare(`INSERT INTO zosd_job_identity
      (mandt, jobname, jobcount, owner, intent_id) VALUES (?, ?, ?, ?, ?)`);
    for (const row of native.prepare(`SELECT mandt, jobname, jobcount, owner, intent_id
      FROM zosd_job_outbox`).all()) {
      insertIdentity.run(row.mandt, String(row.jobname ?? "").trim().toUpperCase(),
        row.jobcount, row.owner, row.intent_id);
    }
    native.prepare("UPDATE osd_schema SET fingerprint = ?, at = ?")
      .run(wanted, new Date().toISOString());
    return true;
  });
}

// The predecessor columns are additive. Existing committed outbox rows have
// no dependency and keep their original import digest.
export function beforeJobPredecessorDDL(ddl) {
  const parent = ddl.find((statement) => /^CREATE TABLE ['"]zosd_job_outbox['"] /i.test(statement));
  if (!parent) return ddl;
  const previousParent = parent
    .replace(/,\s*['"]pred_jobname['"]\s+NCHAR\(32\)\s+COLLATE RTRIM/i, "")
    .replace(/,\s*['"]pred_jobcount['"]\s+NCHAR\(8\)\s+COLLATE RTRIM/i, "")
    .replace(/,\s*['"]pred_intent_id['"]\s+NCHAR\(32\)\s+COLLATE RTRIM/i, "");
  return ddl.map((statement) => statement === parent ? previousParent : statement);
}

export function migrateJobPredecessorFile(native, found, wanted, ddl, fingerprintOf) {
  if (fingerprintOf(ddl) !== wanted) return false;
  const previous = beforeJobPredecessorDDL(ddl);
  if (fingerprintOf(previous) === wanted) return false;
  if (fingerprintOf(previous) !== found) return false;
  return withSchemaMigrationLock(native, () => {
    const current = native.prepare("SELECT fingerprint FROM osd_schema LIMIT 1").get()?.fingerprint;
    if (current === wanted) return true;
    if (current !== found) return false;
    native.exec(`ALTER TABLE zosd_job_outbox ADD COLUMN pred_jobname NCHAR(32) COLLATE RTRIM`);
    native.exec(`ALTER TABLE zosd_job_outbox ADD COLUMN pred_jobcount NCHAR(8) COLLATE RTRIM`);
    native.exec(`ALTER TABLE zosd_job_outbox ADD COLUMN pred_intent_id NCHAR(32) COLLATE RTRIM`);
    native.exec("UPDATE zosd_job_outbox SET pred_jobname = '', pred_jobcount = '', pred_intent_id = ''");
    native.prepare("UPDATE osd_schema SET fingerprint = ?, at = ?")
      .run(wanted, new Date().toISOString());
    return true;
  });
}

export function beforeJobEventDDL(ddl) {
  const parent = ddl.find((statement) => /^CREATE TABLE ['"]zosd_job_outbox['"] /i.test(statement));
  if (!parent) return ddl;
  const previousParent = parent
    .replace(/,\s*['"]source_instance['"]\s+NCHAR\(32\)\s+COLLATE RTRIM/i, "")
    .replace(/,\s*['"]wait_seq['"]\s+NCHAR\(16\)/i, "")
    .replace(/,\s*['"]event_id['"]\s+NCHAR\(32\)\s+COLLATE RTRIM/i, "")
    .replace(/,\s*['"]event_param['"]\s+NCHAR\(64\)\s+COLLATE RTRIM/i, "");
  return ddl.map((statement) => statement === parent ? previousParent : statement);
}

export function migrateJobEventFile(native, found, wanted, ddl, fingerprintOf) {
  if (fingerprintOf(ddl) !== wanted) return false;
  const previous = beforeJobEventDDL(ddl);
  if (fingerprintOf(previous) === wanted || fingerprintOf(previous) !== found) return false;
  return withSchemaMigrationLock(native, () => {
    const current = native.prepare("SELECT fingerprint FROM osd_schema LIMIT 1").get()?.fingerprint;
    if (current === wanted) return true;
    if (current !== found) return false;
    native.exec("ALTER TABLE zosd_job_outbox ADD COLUMN source_instance NCHAR(32) COLLATE RTRIM");
    native.exec("ALTER TABLE zosd_job_outbox ADD COLUMN wait_seq NCHAR(16)");
    native.exec("ALTER TABLE zosd_job_outbox ADD COLUMN event_id NCHAR(32) COLLATE RTRIM");
    native.exec("ALTER TABLE zosd_job_outbox ADD COLUMN event_param NCHAR(64) COLLATE RTRIM");
    native.exec("UPDATE zosd_job_outbox SET source_instance = '', wait_seq = '', event_id = '', event_param = ''");
    native.prepare("UPDATE osd_schema SET fingerprint = ?, at = ?")
      .run(wanted, new Date().toISOString());
    return true;
  });
}

export function beforeJobStepInputDDL(ddl) {
  return ddl.map((statement) => /^CREATE TABLE ['"]zosd_job_step['"] /i.test(statement) ?
    statement.replace(/,\s*['"]input_json['"]\s+TEXT(?:\s+COLLATE\s+RTRIM)?/i, "") : statement);
}

export function migrateJobStepInputFile(native, found, wanted, ddl, fingerprintOf) {
  if (fingerprintOf(ddl) !== wanted) return false;
  const previous = beforeJobStepInputDDL(ddl);
  if (fingerprintOf(previous) === wanted || fingerprintOf(previous) !== found) return false;
  return withSchemaMigrationLock(native, () => {
    const current = native.prepare("SELECT fingerprint FROM osd_schema LIMIT 1").get()?.fingerprint;
    if (current === wanted) return true;
    if (current !== found) return false;
    native.exec("ALTER TABLE zosd_job_step ADD COLUMN input_json TEXT COLLATE RTRIM");
    native.exec("UPDATE zosd_job_step SET input_json = '[]'");
    native.prepare("UPDATE osd_schema SET fingerprint = ?, at = ?")
      .run(wanted, new Date().toISOString());
    return true;
  });
}

// Start by date and time and periodic starts (2026-10-01): eight additive
// outbox columns. A committed intent written before has none of them and
// keeps its import digest: an empty column is a job that is not timed.
const JOB_SCHEDULE_COLUMNS = [["sdlstrtdt", 8], ["sdlstrttm", 6], ["laststrtdt", 8], ["laststrttm", 6],
  ["prdmins", 2], ["prdhours", 2], ["prddays", 3], ["prdweeks", 2]];

export function beforeJobScheduleDDL(ddl) {
  const parent = ddl.find((statement) => /^CREATE TABLE ['"]zosd_job_outbox['"] /i.test(statement));
  if (!parent) return ddl;
  let previousParent = parent;
  for (const [column, width] of JOB_SCHEDULE_COLUMNS) {
    previousParent = previousParent.replace(new RegExp(`,\\s*['"]${column}['"]\\s+NCHAR\\(${width}\\)\\s+COLLATE RTRIM`, "i"), "");
  }
  return ddl.map((statement) => statement === parent ? previousParent : statement);
}

export function migrateJobScheduleFile(native, found, wanted, ddl, fingerprintOf) {
  if (fingerprintOf(ddl) !== wanted) return false;
  const previous = beforeJobScheduleDDL(ddl);
  if (fingerprintOf(previous) === wanted || fingerprintOf(previous) !== found) return false;
  return withSchemaMigrationLock(native, () => {
    const current = native.prepare("SELECT fingerprint FROM osd_schema LIMIT 1").get()?.fingerprint;
    if (current === wanted) return true;
    if (current !== found) return false;
    for (const [column, width] of JOB_SCHEDULE_COLUMNS) {
      native.exec(`ALTER TABLE zosd_job_outbox ADD COLUMN ${column} NCHAR(${width}) COLLATE RTRIM`);
    }
    native.exec(`UPDATE zosd_job_outbox SET ${JOB_SCHEDULE_COLUMNS.map(([column]) => `${column} = ''`).join(", ")}`);
    native.prepare("UPDATE osd_schema SET fingerprint = ?, at = ?")
      .run(wanted, new Date().toISOString());
    return true;
  });
}

// The release order of the outbox (DSL L3 slice 5d, 2026-10-02): RELEASE_SEQ,
// which JOB_CLOSE writes and the drain sorts by, and in the same change the
// gate table's RUN_BIND, the binding a DSL L3 run started with. Both are
// additive; a pending intent written before has an empty RELEASE_SEQ and
// drains first, in the order it drained before.
export function beforeJobReleaseDDL(ddl) {
  return ddl.map((statement) => /^CREATE TABLE ['"]zosd_job_outbox['"] /i.test(statement)
    ? statement.replace(/,\s*['"]release_seq['"]\s+NCHAR\(16\)/i, "")
    : /^CREATE TABLE ['"]zosd_l3_stage['"] /i.test(statement)
      ? statement.replace(/,\s*['"]run_bind['"]\s+NCHAR\(255\)\s+COLLATE RTRIM/i, "") : statement);
}

export function migrateJobReleaseFile(native, found, wanted, ddl, fingerprintOf) {
  if (fingerprintOf(ddl) !== wanted) return false;
  const previous = beforeJobReleaseDDL(ddl);
  if (fingerprintOf(previous) === wanted || fingerprintOf(previous) !== found) return false;
  return withSchemaMigrationLock(native, () => {
    const current = native.prepare("SELECT fingerprint FROM osd_schema LIMIT 1").get()?.fingerprint;
    if (current === wanted) return true;
    if (current !== found) return false;
    native.exec("ALTER TABLE zosd_job_outbox ADD COLUMN release_seq NCHAR(16)");
    native.exec("UPDATE zosd_job_outbox SET release_seq = ''");
    if (native.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'zosd_l3_stage'").get()) {
      native.exec("ALTER TABLE zosd_l3_stage ADD COLUMN run_bind NCHAR(255) COLLATE RTRIM");
      native.exec("UPDATE zosd_l3_stage SET run_bind = ''");
    }
    native.prepare("UPDATE osd_schema SET fingerprint = ?, at = ?")
      .run(wanted, new Date().toISOString());
    return true;
  });
}

export function ensureJobEventMetadata(native) {
  native.exec("BEGIN IMMEDIATE");
  try {
    native.exec(`CREATE TABLE IF NOT EXISTS zosd_job_source_instance (id TEXT PRIMARY KEY)`);
    if (!native.prepare("SELECT id FROM zosd_job_source_instance LIMIT 1").get()) {
      native.prepare("INSERT INTO zosd_job_source_instance (id) VALUES (?)")
        .run(randomBytes(16).toString("hex"));
    }
    native.exec("COMMIT");
  } catch (error) { native.exec("ROLLBACK"); throw error; }
}
