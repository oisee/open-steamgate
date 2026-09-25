// Q4: short dumps, kept in a table the way a system keeps them for ST22.
//
// Writing a dump is the kernel's job, not the application's -- an AS ABAP
// writes the dump *after* the LUW has been rolled back, in its own
// statement and its own commit, never inside the failed one. This is the
// one place that happens: `persistDump` is called from tools/osd-serve.mjs's
// dump() only after the request's own dialogStep() has already rolled back
// (its catch runs on a rejected `await`, and `exclusive()`'s `finally`
// has released the work process by then), and it runs its insert through a
// fresh `dialogStep()` of its own -- a new step, a new commit.
//
// "A rule for what every host must do lives in a module they all import"
// (CLAUDE.md): this module is that import for the dump table. Only
// tools/osd-serve.mjs calls it today, because it is the only host with a
// dump() at all -- test/start.mjs's inline front catches a runtime error
// and logs it, with no ring and no /osd/dumps, so there is nothing there to
// wire this into (left alone, on purpose; see docs/vscode-extension.md).
import {basename} from "node:path";
import {dialogStep} from "./osd-dialog-step.mjs";

// the last N kept, the same shape ST22's ring has: capped so the table
// cannot grow without bound in a process left running
const CAP = Number(process.env.OSD_DUMP_CAP ?? 1000);

function quote(value, pad = 0) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  let s = String(value);
  if (pad > 0) s = s.slice(0, pad).padEnd(pad, " ");
  return "'" + s.replaceAll("'", "''") + "'";
}

// abapGit's own naming says what a generated position is: <name>.clas.abap
// is a class's main include, <name>.clas.testclasses.abap its test include,
// <name>.fugr.<incl>.abap a function group's, and so on. tools/osd-store.mjs
// carries the full table (TYPES/INCLUDES) for the façade's own use; this is
// the small slice a dump needs, kept local so a dump never pays for pulling
// in the store (abaplint, the runtime pool) just to name a file.
const CLAS_INCLUDES = [
  [".clas.testclasses.abap", "testclasses"],
  [".clas.locals_def.abap", "locals_def"],
  [".clas.locals_imp.abap", "locals_imp"],
  [".clas.macros.abap", "macros"],
  [".clas.abap", "main"],
];

/** {type, name, include} off a source file name, the way ST22 names the
 *  object and the include a dump happened in. `type` is "" for a file whose
 *  shape this table does not know, and `name`/`include` are still given, so
 *  a position is never dropped for want of a category. */
export function objectOf(file) {
  const base = basename(String(file ?? ""));
  for (const [ext, include] of CLAS_INCLUDES) {
    if (base.endsWith(ext)) {
      return {type: "CLAS", name: base.slice(0, -ext.length).toUpperCase(), include};
    }
  }
  if (base.endsWith(".intf.abap")) {
    return {type: "INTF", name: base.slice(0, -".intf.abap".length).toUpperCase(), include: "main"};
  }
  const fugr = /^(.+)\.fugr\.(.+)\.abap$/.exec(base);
  if (fugr !== null) {
    return {type: "FUGR", name: fugr[1].toUpperCase(), include: fugr[2]};
  }
  if (base.endsWith(".prog.abap")) {
    return {type: "PROG", name: base.slice(0, -".prog.abap".length).toUpperCase(), include: "main"};
  }
  if (base === "") {
    return {type: "", name: "", include: ""};
  }
  return {type: "", name: base.toUpperCase(), include: base};
}

let seq = 0;
/** timestamp + sequence, fixed width, sortable as a string -- so DUMP_ID
 *  alone orders the ring without a second column to sort on */
export function dumpId(at = new Date()) {
  const ts = at.toISOString().replace(/[-:.TZ]/g, "");
  seq = (seq + 1) % 10000;
  return `${ts}${String(seq).padStart(4, "0")}`;
}

/** dumpOf()'s shape (tools/osd-where.mjs) as one ZOSD_DUMP row -- exported
 *  so a test can check the mapping without a database. */
export function rowOf(d, options = {}) {
  const frame = d.frames?.[0];
  const obj = objectOf(frame?.file);
  const request = String(options.request ?? d.request ?? "");
  const sp = request.indexOf(" ");
  const method = sp === -1 ? request : request.slice(0, sp);
  const path = (sp === -1 ? "" : request.slice(sp + 1)).slice(0, 120);
  return {
    dump_id: options.id ?? dumpId(),
    created_at: options.now ?? Date.now(),
    runtime_error: String(d.name ?? "").slice(0, 60),
    message: String(d.message ?? ""),
    objtype: obj.type,
    objname: obj.name.slice(0, 30),
    include: String(obj.include ?? "").slice(0, 40),
    line: Number(frame?.line ?? 0),
    req_method: method.slice(0, 10),
    req_path: path,
    generation: String(options.generation ?? "").slice(0, 80),
    stack: JSON.stringify((d.frames ?? []).map((f) => `${f.file}:${f.line}${f.text ? "  " + f.text : ""}`)),
  };
}

const PAD = {
  mandt: 3, dump_id: 32, runtime_error: 60, objtype: 4, objname: 30,
  include: 40, req_method: 10, req_path: 120, generation: 80,
};

/** Writes one dump row -- its own statement, its own commit, through a
 *  fresh dialogStep() rather than the one that just rolled back. Never
 *  awaited by the request that dumped: a dump the table failed to keep is
 *  still a dump the ring and the log already have, so a failure here is
 *  logged and swallowed by the caller, not allowed to turn a 500 into a
 *  hung request. Returns the row written, for a caller (a test) that wants
 *  to check it without a second query. */
export async function persistDump(connection, d, options = {}) {
  const row = {mandt: "123", ...rowOf(d, options)};
  await dialogStep(async () => {
    const columns = Object.keys(row);
    await connection.insert({
      table: "zosd_dump",
      columns,
      values: columns.map((c) => quote(row[c], PAD[c] ?? 0)),
    });
    // the cap: oldest rows beyond CAP go, by the same key a ring would use
    await connection.execute(
      `DELETE FROM "zosd_dump" WHERE "dump_id" NOT IN ` +
      `(SELECT "dump_id" FROM "zosd_dump" ORDER BY "dump_id" DESC LIMIT ${CAP})`,
    );
  }, "write a dump");
  return row;
}
