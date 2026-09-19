// The native channel (docs/db-seam-native.md) for the sql.js client.
//
// Why this is a separate module rather than a class of ours: the client that
// runs sql.js is **upstream's** (`@abaplint/database-sqlite`), and sql.js is
// the engine that actually executes ABAP in the browser preview --
// `node:sqlite` does not go there at all. So the column of the conformance
// table that claims to describe "the browser" has to be measured on this
// engine, not on a different SQLite with a different build.
//
// The capability is added to an instance we do not own, in one named place,
// through the one thing it exposes: `client.sqlite`, the sql.js Database.
// Nothing upstream is patched and nothing is subclassed -- if the field ever
// goes away, this module fails loudly at install time rather than quietly at
// the first query.
//
// **Nothing transpiled from ABAP may reach these methods.** Open SQL goes
// through select()/insert()/update()/delete(); a statement arriving here is
// sent to the engine untouched, which is the point and also the reason.

/** ABAP's type letters into values sql.js will bind */
function bind(params = []) {
  return params.map((p) => {
    if (p.isNull === true) {
      return null;
    }
    switch ((p.type ?? "").charAt(0).toUpperCase()) {
      case "I": case "B": case "S": case "P": case "F": return Number(p.value);
      default: return p.value === undefined ? null : String(p.value);
    }
  });
}

/** Give a client holding a sql.js Database the four native methods. */
export function installNative(client) {
  const db = client?.sqlite;
  if (db === undefined || typeof db.prepare !== "function") {
    throw new Error("installNative: this client does not hold a sql.js Database in `sqlite`");
  }
  let relations = 0;

  // SQLite's LIKE is case-INSENSITIVE for ASCII by default and HANA's is not
  // ('ABC' LIKE 'abc' matches here and does not there, measured 2026-09-19).
  // The pragma is connection-scoped and survives transactions, so setting it
  // once at the connection is what makes tools/sqlscript-lower.mjs able to
  // pass a LIKE straight through instead of refusing it.
  db.exec("PRAGMA case_sensitive_like = ON");

  Object.defineProperty(client, "supportsNative", {value: true, configurable: true});

  client.native = async function native({sql, params = [], expect = "rows"}) {
    const stmt = db.prepare(sql);
    try {
      const bound = bind(params);
      if (bound.length > 0) {
        stmt.bind(bound);
      }
      if (expect === "none") {
        stmt.step();
        return {rowCount: undefined};
      }
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      // sql.js reports column names and nothing else. SQLite has no declared
      // type for a column of an expression, so the type is left undefined
      // rather than guessed from the JavaScript value -- a caller that needs
      // it takes it from the lowering, which knows.
      const columns = stmt.getColumnNames().map((name) => ({name, type: undefined}));
      if (expect === "scalar") {
        const first = rows[0];
        return {value: first === undefined ? undefined : first[Object.keys(first)[0]], columns};
      }
      return {rows, columns, rowCount: rows.length};
    } finally {
      stmt.free();
    }
  };

  client.defineRelation = async function defineRelation({name = "rel", sql, params = [], materialise}) {
    // A **definition** carrying bind values would have to keep them alive for
    // the life of the relation, which is why this refuses. A **materialised**
    // relation would not: `CREATE TABLE ... AS <select>` consumes the values
    // once, at creation, and the table that remains carries rows and no
    // parameters. The refusal used to cover both, and so was wider than its
    // own reason by exactly the case the divergence instrument needs -- a
    // literal is in almost every real body, so forcing a step that carried one
    // was impossible and "no divergences found" would have been a statement
    // about how little we forced (fable-osd, 2026-09-19).
    if (params.length > 0 && materialise === undefined) {
      throw new Error("defineRelation: params are not supported on a definition; materialise it, or bind at use");
    }
    relations += 1;
    const ident = `OSD_${String(name).replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()}_${relations}`;
    const handle = {ident, ref: `"${ident}"`,
      kind: materialise === undefined ? "definition" : "materialised", reason: materialise};
    // an ordinary table rather than a temporary one, matching the other two
    // clients: the reference has to be spliceable anywhere
    if (materialise === undefined) {
      db.run(`CREATE VIEW ${handle.ref} AS ${sql}`);
    } else {
      // through the bound path, so the values travel as values here too
      await client.native({sql: `CREATE TABLE ${handle.ref} AS ${sql}`, params, expect: "none"});
    }
    return handle;
  };

  client.relationRef = (handle) => handle.ref;
  client.relationKind = (handle) => ({kind: handle.kind, reason: handle.reason});
  client.dropRelation = async function dropRelation(handle) {
    try {
      db.run(`DROP ${handle.kind === "definition" ? "VIEW" : "TABLE"} ${handle.ref}`);
    } catch {
      // already gone
    }
  };

  return client;
}
