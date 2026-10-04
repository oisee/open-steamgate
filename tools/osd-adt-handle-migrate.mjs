// Derive the last DDIC from this generation, preserving statement order,
// quoting and every unrelated definition in the schema fingerprint.
export function beforeAdtHandleDDL(ddl) {
  return [ddl].flat().map((statement) => /^CREATE TABLE ['"]zosd_adt_shdl['"] /i.test(statement)
    ? statement.replace(/(['"]handle['"]\s+NCHAR\()40(\))/i, (_match, head, tail) => `${head}36${tail}`) : statement);
}

export function adtHandleMigration(found, wanted, ddl, fingerprintOf) {
  if (fingerprintOf(ddl) !== wanted) return undefined;
  const previous = fingerprintOf(beforeAdtHandleDDL(ddl));
  if (previous === wanted || previous !== found) return undefined;
  return [ddl].flat().find((statement) => /^CREATE TABLE ['"]zosd_adt_shdl['"] /i.test(statement));
}

// sql.js and PostgreSQL share the same recognition rule. The caller supplies
// transaction operations so PostgreSQL keeps all statements on one session.
export async function migrateAdtHandle(access, found, wanted, ddl, fingerprintOf, postgres = false) {
  const table = adtHandleMigration(found, wanted, ddl, fingerprintOf);
  if (!table) return false;
  await access.begin();
  try {
    const rows = await access.query(`SELECT fingerprint FROM osd_schema LIMIT 1${postgres ? " FOR UPDATE" : ""}`);
    const current = rows[0]?.fingerprint?.trim();
    if (current === wanted) { await access.commit(); return true; }
    if (current !== found) { await access.commit(); return false; }
    if (postgres) {
      // Widen in place: previous 36-character handles remain opaque strings.
      await access.execute('ALTER TABLE "zosd_adt_shdl" ALTER COLUMN "handle" TYPE CHARACTER(40)');
    } else {
      // Handles are transient session state; dropping them on upgrade is
      // acceptable. Business rows and the session table are left intact.
      await access.execute("DROP TABLE zosd_adt_shdl");
      await access.execute(table);
    }
    await access.execute(`UPDATE osd_schema SET fingerprint = '${wanted}'${postgres ? "" : `, at = '${new Date().toISOString()}'`}`);
    await access.commit();
    return true;
  } catch (error) { await access.rollback(); throw error; }
}
