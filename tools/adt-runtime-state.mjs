// B0: backend-independent ADT rows, carried only at a clean quiesce.
// The parent kernel can also supply a snapshot until B1 moves the step.
import {dialogStep} from "./osd-dialog-step.mjs";

const columns = {
  zosd_adt_sess: ["mandt", "id", "username", "token", "stateful", "created", "touched"],
  zosd_adt_shdl: ["mandt", "id", "handle", "objtype", "objname"],
};
const literal = (v) => `'${String(v ?? "").replaceAll("'", "''")}'`;
const normalize = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));

export async function snapshotAdtRows(db) {
  const state = {version: 1};
  for (const table of Object.keys(columns)) {
    state[table] = ((await db.select({select: `SELECT * FROM ${table}`})).rows ?? []).map(normalize);
  }
  return state;
}

export async function restoreAdtRows(db, state, {replace = false} = {}) {
  if (state === undefined) return;
  if (state.version !== 1) throw new Error("unsupported ADT carry version");
  // The current parent kernel is authoritative, including deletions. A
  // child-owned carry uses upserts so committed database rows also remain.
  if (replace) {
    await db.execute(["DELETE FROM zosd_adt_shdl", "DELETE FROM zosd_adt_sess"]);
  }
  for (const [table, fields] of Object.entries(columns)) {
    for (const row of state[table]) {
      const keys = table === "zosd_adt_sess" ? ["mandt", "id"] : ["mandt", "id", "handle"];
      await db.execute([
        `DELETE FROM ${table} WHERE ${keys.map((k) => `${k} = ${literal(row[k])}`).join(" AND ")}`,
        `INSERT INTO ${table} (${fields.join(", ")}) VALUES (${fields.map((k) => literal(row[k])).join(", ")})`,
      ]);
    }
  }
}

export async function rebuildAdtLocks(db) {
  const a = globalThis.abap;
  const client = String(a.builtin.sy.get().mandt.get());
  const rows = (await db.select({select: `SELECT DISTINCT s.id FROM zosd_adt_sess s INNER JOIN zosd_adt_shdl h ON s.mandt = h.mandt AND s.id = h.id WHERE s.mandt = ${literal(client)} AND s.stateful = 'X'`})).rows ?? [];
  const began = performance.now();
  for (const row of rows) {
    const id = normalize(row).id;
    await dialogStep(() => a.Classes.ZCL_OSD_ADT_SESSION.rehydrate({iv_id: new a.types.String().set(id)}), "rehydrating ADT locks");
  }
  return {sessions: rows.length, ms: performance.now() - began};
}

export function parentAdtSnapshot() {
  // This temporary provider is only for the parent's in-memory SQLite
  // kernel. One statement captures both tables coherently without queuing
  // behind a publication step that can itself be waiting for this boot.
  // It sees that connection's in-flight view, as in-step publication does.
  return (async () => {
    const db = globalThis.abap.context.databaseConnections.DEFAULT;
    const {rows} = await db.select({select: `SELECT 'sess' AS kind, mandt, id, username, token, stateful, created, touched,
      NULL AS handle, NULL AS objtype, NULL AS objname FROM zosd_adt_sess
      UNION ALL SELECT 'shdl', mandt, id, NULL, NULL, NULL, NULL, NULL, handle, objtype, objname FROM zosd_adt_shdl`});
    const state = {version: 1, zosd_adt_sess: [], zosd_adt_shdl: []};
    for (const raw of rows ?? []) {
      const row = normalize(raw);
      const table = row.kind === "sess" ? "zosd_adt_sess" : "zosd_adt_shdl";
      state[table].push(Object.fromEntries(columns[table].map((key) => [key, row[key]])));
    }
    return state;
  })();
}
