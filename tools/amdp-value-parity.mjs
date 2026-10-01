// Execute corpus bodies already created by the oracle. Object-bearing results
// belong only in its ignored .local report.
import {FileSqliteClient} from "./sqlite-file-client.mjs";
import {DuckDBDatabaseClient} from "./duckdb-client.mjs";
import {compileProcedure} from "./sqlscript-to-procedure-ir.mjs";
import {runProcedure} from "./sqlscript-procedure-ir.mjs";
import {scan, project, filter, union, lit, T} from "./sqlscript-ir.mjs";
import {columnType} from "./ir-host-relation.mjs";
import {call as callHana} from "./amdp-run.mjs";

const upper = (s) => String(s).toUpperCase();
const quote = (s) => `"${String(s).replaceAll('"', '""')}"`;

export function valueFor(type, index, variant) {
  if (type?.abap === "I") return index === 2 ? -2 : index === 1 ? 7 : 0;
  if (type?.abap === "INT8") return index === 2 ? -2 : index === 1 ? 7 : 0;
  if (type?.abap === "P") {
    if (!Number.isInteger(type.len) || !Number.isInteger(type.dec) || type.len <= type.dec || type.dec < 0) {
      throw new Error(`no bounded decimal input for type ${JSON.stringify(type)}`);
    }
    if (index === 1) {
      const whole = "9".repeat(Math.max(1, Math.min(30, type.len - (type.dec ?? 0))));
      return `${whole}${type.dec > 0 ? `.${"9".repeat(type.dec)}` : ""}`;
    }
    const fraction = type.dec > 0 ? `.${(index === 2 ? "25" : index === 1 ? "50" : "00").slice(0, type.dec).padEnd(type.dec, "0")}` : "";
    return `${index === 2 ? "-2" : index === 1 ? "7" : "0"}${fraction}`;
  }
  if (type?.abap === "X") return "AB".repeat(Math.min(type.len, 8)).padEnd(type.len * 2, "0");
  if (type?.abap === "D") return index === 2 ? "99991231" : "20240101";
  if (["C", "STRING"].includes(type?.abap)) {
    const length = type.len ?? 12;
    if (length > 5000) throw new Error(`bounded generator refuses character length ${length}`);
    return index === 2 ? "Z".repeat(length) : index === 1 ? "a" : "";
  }
  throw new Error(`no deterministic input for type ${JSON.stringify(type)} (${variant})`);
}

export function inputCases(program) {
  const cases = [];
  for (const variant of ["empty", "defaults", "edges", "nulls"]) {
    const inputs = Object.fromEntries(program.parameters.map((p) => [p.name,
      variant === "nulls" ? null : valueFor(p.type, variant === "edges" ? 2 : 0, variant)]));
    const tables = Object.fromEntries(program.relationParameters.map((p) => [p.name,
      variant === "empty" ? [] : Array.from({length: variant === "edges" ? 3 : 2}, (_, row) =>
        Object.fromEntries(Object.entries(p.schema).map(([name, type]) =>
          [name, variant === "nulls" && row === 1 ? null : valueFor(type, variant === "edges" ? row : 0, variant)])))]));
    cases.push({variant, inputs, tables});
  }
  return cases;
}

function relation(schema, rows) {
  const one = (row) => project(scan("DUMMY"), Object.entries(schema).map(([name, type]) =>
    ({as: name, expr: lit(row[name], type)})));
  if (rows.length === 0) return filter(one(Object.fromEntries(Object.entries(schema).map(([name, type]) => [name, valueFor(type, 0, "empty")]))), lit(false, T.bool));
  return rows.length === 1 ? one(rows[0]) : union(rows.map(one), true);
}

const hanaExec = (client, sql) => new Promise((resolve, reject) =>
  client.exec(sql, (error, rows) => error ? reject(error) : resolve(rows)));
const sqlValue = (value) => value == null ? "NULL" : typeof value === "number" ? String(value)
  : `'${String(value).replaceAll("'", "''")}'`;

async function callFunction(client, name, signature, sample, program) {
  const temporary = [];
  const args = [];
  try {
    for (const p of signature.parameters.filter((one) => one.direction === "IN")) {
      const key = upper(p.name);
      const definition = /^TABLE\s*\((.*)\)$/is.exec(p.hanaType)?.[1];
      if (definition === undefined) {
        const value = sample.inputs[key];
        args.push(value == null ? "NULL" : typeof value === "number" ? String(value)
          : `'${String(value).replaceAll("'", "''")}'`);
        continue;
      }
      const table = `#PARITY_${key.replace(/[^A-Z0-9_]/g, "_")}`;
      const columns = definition.split(/,\s*(?![^()]*\))/).map((one) => one.trim());
      await hanaExec(client, `CREATE LOCAL TEMPORARY COLUMN TABLE ${table} (${columns.join(", ")})`);
      temporary.push(table);
      for (const row of sample.tables[key] ?? []) {
        const values = Object.values(row).map((value) => value == null ? "NULL" : typeof value === "number" ? String(value)
          : `'${String(value).replaceAll("'", "''")}'`);
        await hanaExec(client, `INSERT INTO ${table} VALUES (${values.join(", ")})`);
      }
      args.push(table);
    }
    if (program.outputSchema !== undefined) {
      return {[program.output.toLowerCase()]: await hanaExec(client, `SELECT * FROM ${name}(${args.join(", ")})`)};
    }
    const rows = await hanaExec(client, `SELECT ${name}(${args.join(", ")}) AS "VALUE" FROM DUMMY`);
    return {[program.output.toLowerCase()]: rows?.[0]?.VALUE};
  } finally {
    for (const table of temporary.reverse()) await hanaExec(client, `DROP TABLE ${table}`).catch(() => undefined);
  }
}

function canonical(value, type) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (type?.abap === "P") {
    const scale = type.dec ?? 0;
    const s = String(value);
    const [whole, frac = ""] = s.split(".");
    return `${whole}.${frac.padEnd(scale, "0")}`.replace(/\.$/, "");
  }
  return String(value);
}

export function compareOutputs(hana, portable, program, ordered = false) {
  const declared = program.outputs ?? [{name: program.output, ...(program.outputType ? {scalar: program.outputType} : {schema: program.outputSchema})}];
  for (const output of declared) {
    const name = output.name;
    const actual = portable.outputs?.[name] ?? portable;
    const expected = hana[name.toLowerCase()];
    if (output.scalar) {
      const a = canonical(expected, output.scalar), b = canonical(actual.value, output.scalar);
      if (a !== b) return {output: name, expected: a, actual: b};
      continue;
    }
    if (!Array.isArray(expected) || !Array.isArray(actual.rows)) return {output: name, expected: "table", actual: "missing table"};
    const fields = Object.entries(output.schema);
    const normalize = (rows) => rows.map((row) => fields.map(([field, type]) => canonical(row[field] ?? row[field.toLowerCase()], type)));
    const a = normalize(expected), b = normalize(actual.rows);
    if (!ordered) { a.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))); b.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))); }
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === undefined || b[i] === undefined) return {output: name, row: i, expected: a[i] ?? null, actual: b[i] ?? null};
      for (let j = 0; j < fields.length; j++) if (a[i][j] !== b[i][j]) return {output: name, row: i, column: fields[j][0], expected: a[i][j], actual: b[i][j]};
    }
  }
  return undefined;
}

export async function parityBody(body, context, hanaClient) {
  let program;
  try {
    program = compileProcedure({...body.signature, body: body.signature.body ?? body.body}, body.types,
      {catalogue: body.catalogue, resolveType: context.dictionary.resolver(), store: context.dictionary,
        tableFunctions: context.tableFunctionRegistry ?? {}});
  } catch (error) { return {status: "skipped", reason: `compiler: ${error.message}`}; }
  const isFunction = body.signature.tableFunction || upper(body.signature.dbKind) === "FUNCTION" ||
    body.signature.parameters.some((p) => p.direction === "RETURNING");
  let cases;
  const physical = Object.entries(program.catalogue ?? {}).filter(([name]) => context.oracleTables?.get(upper(name)) === "created");
  try {
    cases = inputCases(program);
    const physicalCases = inputCases({parameters: [], relationParameters: physical.map(([name, schema]) => ({name, schema}))});
    for (let i = 0; i < cases.length; i++) cases[i].physical = physicalCases[i].tables;
  }
  catch (error) { return {status: "skipped", reason: `input generation: ${error.message}`}; }
  const rows = [];
  const signature = {...body.signature, parameters: body.signature.parameters.map((p) =>
    ({...p, hanaType: context.hanaParameterType(p.abapType, body.types, context.dictionary)}))};
  const nativeName = `${quote(context.schema)}.${quote(body.routine)}`;
  const ordered = /\bORDER\s+BY\b/i.test(body.body);
  for (const sample of cases) {
    let expected;
    try {
      // Earlier samples can write physical dependencies. The oracle created
      // these tables empty; every input case starts from that same state.
      for (const table of Object.keys(program.catalogue ?? {})) {
        if (context.oracleTables?.get(upper(table)) === "created") await new Promise((resolve, reject) =>
          hanaClient.exec(`TRUNCATE TABLE ${quote(table)}`, (error) => error ? reject(error) : resolve()));
      }
      for (const [table, data] of Object.entries(sample.physical)) {
        for (const row of data) await hanaExec(hanaClient,
          `INSERT INTO ${quote(table)} (${Object.keys(row).map(quote).join(", ")}) VALUES (${Object.values(row).map(sqlValue).join(", ")})`);
      }
      expected = isFunction ? await callFunction(hanaClient, nativeName, signature, sample, program)
        : await callHana(hanaClient, nativeName, signature, {...sample.inputs, ...sample.tables}, body.types); }
    catch (error) { rows.push({variant: sample.variant, status: "hana-error", reason: String(error.message).slice(0, 300)}); continue; }
    for (const [dialect, make] of [["sqlite", () => new FileSqliteClient()], ["duckdb", () => new DuckDBDatabaseClient()]]) {
      const client = make();
      try {
        await client.connect();
        // These physical dependencies exist as empty tables on HXE. Make the
        // same typed empty tables locally; table inputs carry generated rows.
        for (const [table, schema] of Object.entries(program.catalogue ?? {})) {
          if (upper(table) === "DUMMY") continue;
          const columns = Object.entries(schema).map(([name, type]) => {
            const sqlType = columnType(type, dialect);
            if (!sqlType) throw new Error(`no ${dialect} column type for ${table}.${name}`);
            return `${quote(name)} ${sqlType}`;
          });
          if (columns.length) await client.native({sql: `CREATE TABLE ${quote(table)} (${columns.join(", ")})`, expect: "none"});
          for (const row of sample.physical[table] ?? []) await client.native({sql:
            `INSERT INTO ${quote(table)} (${Object.keys(row).map(quote).join(", ")}) VALUES (${Object.values(row).map(sqlValue).join(", ")})`, expect: "none"});
        }
        const relationInputs = Object.fromEntries(program.relationParameters.map((p) => [p.name, relation(p.schema, sample.tables[p.name])]));
        const actual = await runProcedure(program, {client, dialect, inputs: sample.inputs, relationInputs,
          inputCatalogue: {...program.catalogue, DUMMY: {}}});
        const first = compareOutputs(expected, actual, program, ordered);
        rows.push({variant: sample.variant, engine: dialect, status: first ? "differs" : "equal", ...(first ? {first} : {})});
      } catch (error) { rows.push({variant: sample.variant, engine: dialect, status: "portable-error", reason: String(error.message).slice(0, 300)}); }
      finally { await client.disconnect().catch(() => undefined); }
    }
  }
  const status = ["differs", "hana-error", "portable-error"].find((kind) => rows.some((r) => r.status === kind)) ?? "equal";
  return {status, samples: cases, cases: rows};
}
