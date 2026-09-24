// Run an AMDP body in a real HANA (backlog B.19).
//
// The design in one line: an AMDP body is already valid SQLScript, so instead
// of interpreting it we hand it to HANA Express and let HANA run it. This
// tool is the other half of tools/amdp-extract.mjs -- the scissors cut, this
// one creates the procedure and calls it.
//
//   node tools/amdp-run.mjs <class.clas.abap> <method> [--types <f>]... [--in name=json]...
//
// Connection comes from HXE_HOST / HXE_PORT / HXE_USER / HXE_PASSWORD, or
// from .local/hxe-password, which is where the password of the local
// laboratory is kept and which is not tracked.
import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {basename,join} from "node:path";
import {extract, procedure, parameterType} from "./amdp-extract.mjs";

const SCHEMA = process.env.HXE_SCHEMA ?? "OSD";

/** Where the password may be, in order, and why there is more than one place.
 *
 *  A checkout finds it beside the tree, under `.local/`. A **deployment** does
 *  not: the release directory is rebuilt by `rsync --delete` on every deploy,
 *  so anything put there by hand is gone at the next one, and inside a
 *  compiled binary every module shares one `import.meta.url`, so the path
 *  relative to this file is not a path to anything. `~/.osd/hxe-password` is
 *  the one that survives both -- it is outside the deployment and it does not
 *  depend on where the code thinks it lives. */
export function passwordFiles() {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const files = [];
  if (process.env.OSD_HANA_PASSWORD_FILE) files.push(process.env.OSD_HANA_PASSWORD_FILE);
  if (home !== "") files.push(join(home, ".osd", "hxe-password"));
  try {
    files.push(fileURLToPath(new URL("../.local/hxe-password", import.meta.url)));
  } catch {
    // a bundled module has no useful url of its own; the two above are the answer
  }
  return files;
}

export function connection() {
  const found = passwordFiles().find((f) => existsSync(f));
  return {
    host: process.env.HXE_HOST ?? process.env.HANA_HOST ?? "localhost",
    port: Number(process.env.HXE_PORT ?? process.env.HANA_PORT ?? 39017),
    user: process.env.HXE_USER ?? process.env.HANA_USER ?? "SYSTEM",
    password: process.env.HXE_PASSWORD ?? process.env.HANA_PASSWORD
      ?? (found === undefined ? undefined : readFileSync(found, "utf8").trim()),
  };
}

/** one statement, promised */
const exec = (client, sql) => new Promise((resolve, reject) =>
  client.exec(sql, (err, rows) => (err ? reject(err) : resolve(rows))));

/** create the procedure for one AMDP method, replacing whatever was there */
export async function deploy(client, cls, method, types) {
  const name = `"${SCHEMA}"."${cls}=>${method.name.toUpperCase()}"`;
  await exec(client, `CREATE SCHEMA "${SCHEMA}"`).catch((e) => {
    // 386 is "cannot use duplicate schema name", which is the normal case
    if (!/386|already exists|duplicate/i.test(String(e))) throw e;
  });
  await exec(client, `DROP PROCEDURE ${name}`).catch(() => undefined);
  await exec(client, procedure(cls, method, SCHEMA, types));
  return name;
}

/** NCLOB and friends arrive as Buffers; a row is nicer read as text */
function readable(value) {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value !== null && typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data).toString("utf8");
  }
  return value;
}

/** A table IN parameter cannot be handed over as an array: the driver answers
 *  `invalid argument: input parameter must be a table`. HANA takes a **table**
 *  there, named in the CALL -- measured:
 *
 *    CALL "OSD"."P"("OSD"."ROWS", ?)   ->  works
 *    CALL "OSD"."P"(SELECT ..., ?)     ->  syntax error
 *
 *  which is the shape an AMDP call has on a system anyway, where the rows are
 *  already in tables. So rows given as an array are materialised into a
 *  throw-away table first and that table is named; a string is taken to be a
 *  table name already and passed straight through, which is the cheap path
 *  once the data layer is HANA and nothing has to be copied at all. */
async function materialise(client, exec, name, columns, rows) {
  await exec(`DROP TABLE ${name}`).catch(() => undefined);
  await exec(`CREATE LOCAL TEMPORARY COLUMN TABLE ${name} (${columns.join(", ")})`);
  if (rows.length === 0) return name;
  // One small prepared INSERT, the rows bound as parameters and sent as one
  // batch. Measured against writing the values into the statement text:
  //
  //     rows     literals            bound batch
  //      100     52 ms  0.52 ms/row  18 ms  0.181 ms/row
  //     1000    465 ms  0.465        26 ms  0.026
  //    10000  21745 ms  2.175        59 ms  0.006
  //
  // The literal form gets *worse* per row as it grows and the bound one gets
  // better, and the reason is not the round trips -- it is parsing. The same
  // 2000-branch statement run twice in a row costs 2478 ms and then 4 ms, so
  // 99.8 % of it is parse, and a statement whose text carries the values is
  // new text every time and can never hit the plan cache. A bound statement
  // is parsed once and reused for the life of the connection.
  //
  // It also removes a whole class of defect rather than a case of it: values
  // travel as parameters instead of being escaped into SQL text, so nothing
  // can mangle a value that happens to contain a quote, a JSON document or
  // the word `true`.
  const statement = await new Promise((resolve, reject) =>
    client.prepare(`INSERT INTO ${name} VALUES (${columns.map(() => "?").join(", ")})`,
      (err, st) => (err ? reject(err) : resolve(st))));
  const batch = rows.map((row) => Object.values(row));
  await new Promise((resolve, reject) => statement.exec(batch, (err) => (err ? reject(err) : resolve())));
  return name;
}

/** the columns of a TABLE(...) type, as CREATE TABLE wants them */
function columnsOf(hanaTableType) {
  const inner = /^TABLE\s*\((.*)\)$/is.exec(String(hanaTableType).trim())?.[1];
  return inner === undefined ? undefined : inner.split(/,\s*(?![^(]*\))/).map((c) => c.trim());
}

/** call it. An IN table parameter takes a table name or an array of rows; a
 *  scalar takes a value. node-hdb hands the results back as
 *  (err, scalars, ...tables), one argument per table OUT parameter in
 *  signature order -- reading only the first is how this returned an empty
 *  object at first, with the rows sitting in the arguments after it. */
export async function call(client, name, method, inputs, types) {
  const exec = (sql) => new Promise((resolve, reject) =>
    client.exec(sql, (err, ...rest) => (err ? reject(err) : resolve(rest))));
  if (method.parameters.some((p) => p.direction === "INOUT")) {
    throw new Error("AMDP oracle call does not support INOUT parameters");
  }
  const outs = method.parameters.filter((p) => p.direction !== "IN");
  // A generated runtime manifest has already resolved class-local ABAP types
  // and carries their exact HANA spelling. The source-level CLI instead has
  // the extractor's type map. Prefer the resolved fact when it exists; trying
  // to resolve `TABLE(...)` as though it were an ABAP type produced
  // `schema.UNDEFINED` on the first table-input call through the real ABAP
  // destination.
  const databaseType = (p) => p.hanaType ?? parameterType(p.abapType, types);
  const scalarOuts = outs.filter((p) => columnsOf(databaseType(p)) === undefined);
  const scalarOnly = outs.length > 0 && scalarOuts.length === outs.length;
  const temporary = [];

  const args = [];
  for (const p of method.parameters) {
    if (p.direction !== "IN") {
      args.push(scalarOnly ? `V_${p.name.toUpperCase()}` : "?");
      continue;
    }
    const given = inputs[p.name.toLowerCase()] ?? inputs[p.name];
    const columns = columnsOf(databaseType(p));
    if (columns === undefined) {                       // a scalar
      args.push(given == null ? "NULL" : typeof given === "number" ? String(given)
        : `'${String(given).replace(/'/g, "''")}'`);
    } else if (typeof given === "string") {            // a table, named
      args.push(given);
    } else {                                           // rows, materialised
      const table = `#AMDP_IN_${p.name.toUpperCase()}`;
      temporary.push(table);
      args.push(await materialise(client, exec, table, columns, given ?? []));
    }
  }

  try {
    const sql = scalarOnly
      ? `DO BEGIN ${scalarOuts.map((p) => `DECLARE V_${p.name.toUpperCase()} ${databaseType(p)};`).join(" ")} ` +
        `CALL ${name} (${args.join(", ")}); SELECT ${scalarOuts.map((p) =>
          `:V_${p.name.toUpperCase()} AS "${p.name.toLowerCase()}"`).join(", ")} FROM DUMMY; END;`
      : `CALL ${name} (${args.join(", ")})`;
    // Scalar OUTs beside table OUTs come back only from a prepared statement:
    // node-hdb's exec answers them as an empty object (measured on HANA
    // Express 2026-09-24: exec gave [{}, rows], prepare + exec gave
    // [{EV_FOUND: "X", EV_LABEL: "ab  "}, rows]), so the scalar was lost.
    const prepared = (text) => new Promise((resolve, reject) => client.prepare(text, (err, statement) => {
      if (err) { reject(err); return; }
      statement.exec([], (error, ...rest) => {
        statement.drop(() => undefined);
        if (error) reject(error); else resolve(rest);
      });
    }));
    const parts = !scalarOnly && scalarOuts.length > 0 ? await prepared(sql) : await exec(sql);
    if (scalarOnly) {
      const row = parts.find(Array.isArray)?.[0] ?? {};
      return Object.fromEntries(scalarOuts.map((p) => [p.name.toLowerCase(), readable(row[p.name.toLowerCase()])]));
    }
    const [scalars, ...tables] = parts;
    const result = {};
    for (const [k, v] of Object.entries(scalars ?? {})) result[k.toLowerCase()] = readable(v);
    let i = 0;
    for (const p of outs) {
      const table = tables[i];
      if (Array.isArray(table)) {
        result[p.name.toLowerCase()] = table.map((row) =>
          Object.fromEntries(Object.entries(row).map(([k, v]) => [k, readable(v)])));
        i += 1;
      }
    }
    return result;
  } finally {
    for (const t of temporary) await exec(`DROP TABLE ${t}`).catch(() => undefined);
  }
}

if (basename(process.argv[1] ?? "") === "amdp-run.mjs") {
  const args = process.argv.slice(2);
  const [path, wanted] = args.filter((a) => !a.startsWith("--") &&
    args[args.indexOf(a) - 1] !== "--types" && args[args.indexOf(a) - 1] !== "--in");
  if (path === undefined || wanted === undefined) {
    console.error("usage: node tools/amdp-run.mjs <class.clas.abap> <method> [--types <f>]... [--in name=json]...");
    process.exit(2);
  }
  const extras = args.map((a, i) => (a === "--types" ? args[i + 1] : undefined)).filter(Boolean).map((f) => readFileSync(f, "utf8"));
  const inputs = {};
  for (const [i, a] of args.entries()) {
    if (a !== "--in") continue;
    const [k, ...rest] = String(args[i + 1]).split("=");
    inputs[k.toLowerCase()] = JSON.parse(rest.join("="));
  }

  const parsed = extract(readFileSync(path, "utf8"), path.split("/").pop(), extras);
  const method = parsed.methods.find((m) => m.name.toUpperCase() === wanted.toUpperCase());
  if (method === undefined) {
    console.error(`${parsed.className} has no AMDP method ${wanted}; it has: ${parsed.methods.map((m) => m.name).join(", ") || "none"}`);
    process.exit(2);
  }
  const unmapped = method.parameters.filter((p) => parameterType(p.abapType, parsed.types) === undefined);
  if (unmapped.length > 0) {
    console.error(`cannot build a procedure: ${unmapped.map((p) => `${p.name} (${p.abapType})`).join(", ")} has no HANA type`);
    process.exit(2);
  }

  const hdb = (await import("hdb")).default;
  const client = hdb.createClient(connection());
  await new Promise((resolve, reject) => client.connect((err) => (err ? reject(err) : resolve())));
  try {
    const name = await deploy(client, parsed.className, method, parsed.types);
    console.log(`deployed ${name}`);
    const result = await call(client, name, method, inputs, parsed.types);
    console.log(JSON.stringify(result, undefined, 2));
  } finally {
    client.end();
  }
}
