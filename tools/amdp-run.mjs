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
import {extract, procedure, parameterType} from "./amdp-extract.mjs";

const SCHEMA = process.env.HXE_SCHEMA ?? "OSD";

export function connection() {
  const passwordFile = fileURLToPath(new URL("../.local/hxe-password", import.meta.url));
  return {
    host: process.env.HXE_HOST ?? "localhost",
    port: Number(process.env.HXE_PORT ?? 39017),
    user: process.env.HXE_USER ?? "SYSTEM",
    password: process.env.HXE_PASSWORD
      ?? (existsSync(passwordFile) ? readFileSync(passwordFile, "utf8").trim() : undefined),
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

/** call it, with the IN parameters given as plain values or arrays of rows.
 *
 * node-hdb hands a procedure's results back as (err, scalars, ...tables):
 * the first argument is the object of scalar OUT parameters and each table
 * OUT parameter is a further argument, in the order the signature declares
 * them. Reading only the first is how this returned an empty object at first
 * -- the rows were in the arguments after it. */
export async function call(client, name, method, inputs) {
  const ins = method.parameters.filter((p) => p.direction === "IN");
  const outs = method.parameters.filter((p) => p.direction !== "IN");
  const placeholders = method.parameters.map(() => "?").join(", ");
  const values = ins.map((p) => inputs[p.name.toLowerCase()] ?? inputs[p.name] ?? null);
  const statement = await new Promise((resolve, reject) =>
    client.prepare(`CALL ${name} (${placeholders})`, (err, st) => (err ? reject(err) : resolve(st))));
  const parts = await new Promise((resolve, reject) =>
    statement.exec(values, (err, ...rest) => (err ? reject(err) : resolve(rest))));
  const [scalars, ...tables] = parts;
  const result = {};
  for (const [k, v] of Object.entries(scalars ?? {})) result[k] = readable(v);
  let i = 0;
  for (const p of outs) {
    const table = tables[i];
    if (table === undefined) continue;
    if (Array.isArray(table)) {
      result[p.name.toLowerCase()] = table.map((row) =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k, readable(v)])));
      i += 1;
    }
  }
  return result;
}

if (process.argv[1]?.endsWith("amdp-run.mjs")) {
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
    const result = await call(client, name, method, inputs);
    console.log(JSON.stringify(result, undefined, 2));
  } finally {
    client.end();
  }
}
