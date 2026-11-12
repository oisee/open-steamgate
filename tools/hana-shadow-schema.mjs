// The shadow schema: the client lives in HANA, in a schema of our own (H3,
// docs/db-backends.md, "Shadow schema: the client lives in HANA"). For every
// table the build knows, connect() makes sure our own schema holds a view
// `SELECT * FROM <tenant>.T WHERE MANDT = SESSION_CONTEXT('CLIENT')` when the
// tenant's DD02L calls the table client-dependent, a synonym otherwise -- and
// a DDIC view (H5d) takes the synonym whatever its client dependence says,
// the tenant's object being a read-only database view of its own; the
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

// the rule a table name must pass before it becomes SQL: the probe's
// plain identifier shape plus the `/` of an SAP namespace (/DMO/TRAVEL).
// Quoted identifiers carry the slashes and the 259 parser keeps the
// namespace; the eager filter and the lazy check use this same rule, so
// a name that parses is a name we shadow (critic SHOULD 4 at f0a248af1:
// they refused what the parser had faithfully carried).
const NAME = /^[A-Za-z_/][A-Za-z_0-9/]*$/;
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

/** CLIDEP and TABCLASS for the names the tenant actually holds, in as many
 *  reads as there are chunks: an IN list is not unbounded, and the answer
 *  is also the filter -- the build knows tables of its own (ZSTG_*) that
 *  must not get a shadow over a tenant table that does not exist. TABCLASS
 *  (H5d) tells a DDIC view from a table: the view is shadowed as a synonym
 *  whatever its client dependence says. */
async function clidepOf(db, tenant, names) {
  const found = new Map();
  for (let at = 0; at < names.length; at += CHUNK) {
    const list = names.slice(at, at + CHUNK).map((name) => `'${name}'`).join(",");
    const rows = await db.query(
      `SELECT TABNAME, CLIDEP, TABCLASS FROM "${tenant}"."DD02L" WHERE TABNAME IN (${list}) AND AS4LOCAL = 'A' AND AS4VERS = '0000'`);
    for (const row of rows) {
      found.set(String(row.tabname).toUpperCase(), {
        clidep: String(row.clidep).toUpperCase() === "X",
        view: String(row.tabclass ?? "").toUpperCase() === "VIEW",
      });
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

// SYS.VIEWS.DEFINITION holds the view's query string -- the text after AS,
// with `SELECT *` expanded into the quoted column list. Measured on the bed
// 2026-11-12 (FIX-3): the SCARR view this module sent as SELECT * FROM
// "<tenant>"."SCARR" WHERE MANDT = SESSION_CONTEXT('CLIENT') reads back as
// SELECT "MANDT" , "CARRID" , "CARRNAME" , "CURRCODE" , "URL" FROM
// "<tenant>"."SCARR" WHERE MANDT = SESSION_CONTEXT('CLIENT'), so round 2's
// textual compare of the query part still recreated every view on every
// connect (round 1 compared the whole CREATE text; critic MUST 3 at
// f0a248af1 -- and two hosts connecting at once would race on the replace).
// The decision is structural now: the query, whitespace-normalised, must
// read SELECT <columns or *> FROM "<tenant>"."<T>" WHERE MANDT =
// SESSION_CONTEXT('CLIENT'), with <columns> any quoted column list. The FROM
// target and the predicate are the contract; the projection is HANA's to
// spell. A view whose FROM names another schema or table, or whose predicate
// differs (a hard-coded client), is drifted and recreated. A DEFINITION
// still carrying the full CREATE VIEW prefix (the fakes' spelling before
// the bed run) loses exactly that prefix first, so that spelling stays
// current too.
const isCurrentView = (definition, tenant, table) => {
  const query = normalized(String(definition).replace(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+"[^"]+"\s*\.\s*"[^"]+"\s+AS/i, ""));
  const schema = String(tenant).toUpperCase();
  const name = String(table).toUpperCase();
  // both pass assertSchema's NAME rule (letters, digits, underscore, slash):
  // no regex metacharacters, safe to embed.
  return new RegExp(
    `^SELECT (?:\\*|"[^"]+"(?:\\s*,\\s*"[^"]+")*) FROM "${schema}"\\."${name}" WHERE MANDT = SESSION_CONTEXT\\('CLIENT'\\)$`)
    .test(query);
};

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
    const kind = clidep.get(name);
    if (kind.view === true || kind.clidep === false) {
      // a DDIC view (H5d) or a client-independent table: a synonym. The
      // tenant's view is itself a read-only database view; the shadow names
      // it, it does not wrap it -- a synonym has no definition of its own
      // to drift, and the view the dumps carry is client-independent. A
      // client-dependent view would read across clients through the
      // synonym; none is in the dumps, and if one arrives the filtered
      // shape is one branch away (docs/db-backends.md).
      if (there.synonyms.has(name) === false) {
        await db.execute(synonymSql(name, own, tenant));
        report.created.push(name);
      }
    } else {
      const wanted = viewSql(name, own, tenant);
      const current = there.views.get(name);
      if (current === undefined) {
        await db.execute(wanted);
        report.created.push(name);
      } else if (isCurrentView(current, tenant, name) === false) {
        await db.execute(replaceViewSql(name, own, tenant));
        report.replaced.push(name);
      }
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
  const kind = clidep.get(table);
  const there = await existingObjects(db, own);
  if (kind.view === true || kind.clidep === false) {
    // the eager half's rule (H5d): a DDIC view is named, not wrapped
    if (there.synonyms.has(table) === false) {
      await db.execute(synonymSql(table, own, tenant));
    }
  } else {
    const wanted = viewSql(table, own, tenant);
    const current = there.views.get(table);
    if (current === undefined) {
      await db.execute(wanted);
    } else if (isCurrentView(current, tenant, table) === false) {
      await db.execute(replaceViewSql(table, own, tenant));
    }
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
