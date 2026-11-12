// The shadow schema: the client lives in HANA, in a schema of our own (H3,
// docs/db-backends.md, "Shadow schema: the client lives in HANA"). For every
// table the build knows, connect() makes sure our own schema holds a view
// `SELECT * FROM <tenant>.T WHERE MANDT = SESSION_CONTEXT('CLIENT')` when the
// tenant's DD02L calls the table client-dependent, a synonym otherwise; the
// session then does SET SCHEMA <own> and every unqualified name the runtime
// emits resolves to the filtered object. What SESSION_CONTEXT('CLIENT') reads
// is the node-hdb connect option 'SESSIONVARIABLE:CLIENT', set from OSD_CLIENT
// (HANA refuses `SET 'CLIENT'`, 455, measured on the bed). A table touched
// that is not in the eager set is caught by the lazy fallback in
// tools/hana-client.mjs: HANA's error 259 (invalid table name) carries the
// name, the tenant's DD02L says whether it is ours to shadow, and the
// statement retries once.
//
// The DDL shapes below are the whole contract the read-only guard admits: the
// guard (tools/hana-client.mjs) allows CREATE [OR REPLACE] VIEW / CREATE
// SYNONYM / DROP VIEW / DROP SYNONYM only when the owning schema is our own,
// never the tenant's. Anything else DDL stays refused in existing-schema mode.
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {layers} from "./osd-inputs.mjs";

// the same rule the probe applies to a table name before it becomes SQL
const NAME = /^[A-Za-z_][A-Za-z_0-9]*$/;
// the DD* reads name only the columns H1 measured on the bed and pinned in
// test/hana-ddic-probe.mjs; DD02L's TABNAME and CLIDEP are on that list. The
// SYS catalog columns (VIEW_NAME, DEFINITION, SYNONYM_NAME) are per HANA's
// own documentation and get their bed confirmation with the acceptance run.
const CHUNK = 500;

const qualified = (schema, name) => `"${schema}"."${name}"`;

/** the shadow object for a client-dependent table: the predicate is what SAP's
 *  own client handling puts in the view, so joins, FOR ALL ENTRIES and
 *  aggregates inherit it with no change in generated SQL. */
export function viewSql(name, own, tenant) {
  return `CREATE VIEW ${qualified(own, name)} AS SELECT * FROM ${qualified(tenant, name)} WHERE MANDT = SESSION_CONTEXT('CLIENT')`;
}

/** the recreate form: one statement, and idempotent by itself. */
export function replaceViewSql(name, own, tenant) {
  return `CREATE OR REPLACE VIEW ${qualified(own, name)} AS SELECT * FROM ${qualified(tenant, name)} WHERE MANDT = SESSION_CONTEXT('CLIENT')`;
}

/** the shadow object for a client-independent table: no predicate needed. */
export function synonymSql(name, own, tenant) {
  return `CREATE SYNONYM ${qualified(own, name)} FOR ${qualified(tenant, name)}`;
}

/** the owning schema of a shadow DDL statement, upper case -- undefined when
 *  the statement is not one of the shapes this module sends. The read-only
 *  guard admits a CREATE or DROP only when this is HANA_OWN_SCHEMA, so a
 *  CREATE against the tenant schema stays refused (test/hana-shadow-schema
 *  .mjs). This is a shape check on our own statements, not SQL parsing: the
 *  runtime's arbitrary SQL never gets here. */
export function shadowDdlSchema(sql) {
  const match = /^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:VIEW|SYNONYM)|DROP\s+(?:VIEW|SYNONYM))\s+"([^"]+)"\s*\.\s*"([^"]+)"/i.exec(sql);
  return match === null ? undefined : match[1].toUpperCase();
}

/** HANA error 259 is "invalid table name" and the message carries the name;
 *  the lazy fallback reads it from here and never from the statement. The
 *  shape the bed measured (acceptance 2026-11-12) reads first:
 *
 *    invalid table name:  Could not find table/view SFLIGHT in schema OSD: line 1 col 15 (at pos 14)
 *
 *  The plain `invalid table name: <name>` the fakes sent before the bed run
 *  stays as the fallback. The name may be namespaced (/DMO/TRAVEL) and
 *  quoted; quotes come off, the namespace stays. The schema in the message
 *  is our own -- the session sits there after SET SCHEMA -- so the name
 *  alone decides what the lazy fallback shadows. */
export function tableFrom259(error) {
  if (Number(error?.code) !== 259) return undefined;
  const message = String(error?.message ?? "");
  const measured = /Could not find table\/view (\S+) in schema (\S+)/i.exec(message);
  const match = measured ?? /invalid table name:?[\s"']*([A-Za-z0-9_.$#]+)/i.exec(message);
  if (match === null) return undefined;
  const name = match[1].split(".").pop().replace(/[^A-Za-z0-9_/#$]/g, "");
  return name === "" ? undefined : name.toUpperCase();
}

function assertSchema(what, value) {
  if (NAME.test(String(value ?? "")) === false) {
    throw new Error(`hana-shadow-schema: ${what} ${JSON.stringify(value)} is not a schema name this tool will send to the database`);
  }
}

/** CLIDEP (=> view or synonym) for the names the tenant actually holds, in as
 *  many reads as there are chunks: an IN list is not unbounded, and the
 *  answer is also the filter -- the build knows tables of its own (ZSTG_*)
 *  that must not get a shadow over a tenant table that does not exist. */
async function clidepOf(db, tenant, names) {
  const found = new Map();
  for (let at = 0; at < names.length; at += CHUNK) {
    const list = names.slice(at, at + CHUNK).map((name) => `'${name}'`).join(",");
    const rows = await db.query(
      `SELECT TABNAME, CLIDEP FROM "${tenant}"."DD02L" WHERE TABNAME IN (${list}) AND AS4LOCAL = 'A' AND AS4VERS = '0000'`);
    for (const row of rows) {
      found.set(String(row.tabname).toUpperCase(), String(row.clidep).toUpperCase() === "X");
    }
  }
  return found;
}

/** what our own schema already holds: view definitions (for the drift check)
 *  and synonym names. */
async function existingObjects(db, own) {
  const views = new Map();
  for (const row of await db.query(`SELECT VIEW_NAME, DEFINITION FROM SYS.VIEWS WHERE SCHEMA_NAME = '${own}'`)) {
    views.set(String(row.view_name).toUpperCase(), String(row.definition ?? ""));
  }
  const synonyms = new Set();
  for (const row of await db.query(`SELECT SYNONYM_NAME FROM SYS.SYNONYMS WHERE SCHEMA_NAME = '${own}'`)) {
    synonyms.add(String(row.synonym_name).toUpperCase());
  }
  return {views, synonyms};
}

// HANA stores a view's text in its own spacing; the drift comparison reads
// shapes, not bytes. Only our own view texts are ever compared, so folding
// case is safe (the one literal, 'CLIENT', is already upper).
const normalized = (sql) => String(sql).replace(/\s+/g, " ").trim().toUpperCase();

/** the eager half: every table of the generation that exists in the tenant
 *  gets its shadow object, unless it is already there and current. Idempotent
 *  by construction: the second run reads the catalog and sends nothing. */
export async function ensureShadow(db, {own, tenant, tables}) {
  assertSchema("own schema", own);
  assertSchema("tenant schema", tenant);
  const names = [...new Set([...(tables ?? [])].map((table) => String(table).toUpperCase()))]
    .filter((table) => NAME.test(table)).sort();
  const report = {created: [], replaced: [], skipped: []};
  if (names.length === 0) return report;
  const clidep = await clidepOf(db, tenant, names);
  const there = await existingObjects(db, own);
  for (const name of names) {
    if (clidep.has(name) === false) {
      report.skipped.push(name); // one of ours, not in the tenant: no shadow
      continue;
    }
    if (clidep.get(name) === true) {
      const wanted = viewSql(name, own, tenant);
      const current = there.views.get(name);
      if (current === undefined) {
        await db.execute(wanted);
        report.created.push(name);
      } else if (normalized(current) !== normalized(wanted)) {
        await db.execute(replaceViewSql(name, own, tenant));
        report.replaced.push(name);
      }
    } else if (there.synonyms.has(name) === false) {
      await db.execute(synonymSql(name, own, tenant));
      report.created.push(name);
    }
  }
  return report;
}

/** the lazy half, one table: the 259 fallback's answer to "is this name ours
 *  to shadow?" Returns true when the shadow object now exists (made or
 *  already there) and the caller may retry. */
export async function ensureShadowFor(db, {own, tenant, name}) {
  assertSchema("own schema", own);
  assertSchema("tenant schema", tenant);
  const table = String(name).toUpperCase();
  if (NAME.test(table) === false) return false;
  const clidep = await clidepOf(db, tenant, [table]);
  if (clidep.has(table) === false) return false;
  const there = await existingObjects(db, own);
  if (clidep.get(table) === true) {
    const wanted = viewSql(table, own, tenant);
    const current = there.views.get(table);
    if (current === undefined) {
      await db.execute(wanted);
    } else if (normalized(current) !== normalized(wanted)) {
      await db.execute(replaceViewSql(table, own, tenant));
    }
  } else if (there.synonyms.has(table) === false) {
    await db.execute(synonymSql(table, own, tenant));
  }
  return true;
}

/** the DDIC set the build knows: every TABL object of the layers, the winner
 *  of a name only (a hand-written src table shadows a generated one, and it
 *  is the same table for the shadow). Read at connect by test/setup.mjs. */
export function ddicTables(root = process.cwd()) {
  const config = JSON.parse(readFileSync(join(root, "abap_transpile.json"), "utf8"));
  const stack = layers(root, config);
  return [...stack.owner.keys()].filter((key) => key.startsWith("TABL ")).map((key) => key.slice(5)).sort();
}
