// The data of OSD: what a client reads when it asks for table contents.
//
// vsp does not ask for a table, it asks for SQL, through
// /sap/bc/adt/datapreview/freestyle. So this is one method, query, and the
// rows come from the same database the ABAP runtime uses: the schema the
// transpiler generated from the DDIC in src/ and the libraries, the rows
// the seed put there, the dialect the database client knows. One place
// knows about all three, and it is this one, not the façade.
//
// Booting the transpiled runtime is how we get that database rather than a
// second one beside it: OSD has exactly one system, and a read through the
// façade sees what a program running inside sees.
import {existsSync} from "node:fs";
import {join} from "node:path";

export class Data {
  constructor(options = {}) {
    this.root = options.root ?? process.cwd();
    this.booted = undefined;
  }

  // the runtime, once; every later call reuses it
  boot() {
    if (this.booted !== undefined) {
      return this.booted;
    }
    this.booted = (async () => {
      const init = join(this.root, "output", "init.mjs");
      if (existsSync(init) === false) {
        throw new NotBuilt();
      }
      const {initializeABAP} = await import(init);
      await initializeABAP();
      const client = globalThis.abap?.context?.databaseConnections?.DEFAULT;
      if (client === undefined) {
        throw new NotBuilt("the runtime came up without a database connection");
      }
      return client;
    })();
    return this.booted;
  }

  // SQL in, rows out. The row limit is the one the client asked for, and it
  // is applied here rather than trusted to the statement, because a client
  // that forgets it should not be able to read a million rows.
  async query(sql, options = {}) {
    const max = options.max ?? 100;
    const client = await this.boot();
    const text = String(sql).trim().replace(/;$/, "");
    if (/^select\b/i.test(text) === false) {
      throw new NotAllowed(text.split(/\s+/)[0] ?? "");
    }
    const limited = / LIMIT \d+/i.test(text) ? text : `${text} LIMIT ${max}`;
    const answer = await client.select({select: limited});
    const rows = (answer.rows ?? []).slice(0, max);
    return {
      sql: limited,
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      rows: rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" ? v.trimEnd() : v]))),
      count: rows.length,
      truncated: rows.length === max,
    };
  }

  // what a table read is when the client names a table instead of writing SQL
  async table(name, options = {}) {
    const where = options.where === undefined || options.where === "" ? "" : ` WHERE ${options.where}`;
    return this.query(`SELECT * FROM ${String(name).toLowerCase()}${where}`, options);
  }

  // the tables the system has, so a client can be told what it may read
  async tables() {
    const answer = await this.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name", {max: 1000});
    return answer.rows.map((r) => String(r.name).toUpperCase());
  }
}

export class NotBuilt extends Error {
  constructor(message = "there is no output/ yet: run the transpile first") {
    super(message);
    this.code = "NOT_BUILT";
  }
}

export class NotAllowed extends Error {
  constructor(word) {
    super(`only SELECT is allowed here, not ${word.toUpperCase()}`);
    this.code = "NOT_ALLOWED";
  }
}

async function main(args) {
  const data = new Data();
  if (args[0] === "--tables") {
    const tables = await data.tables();
    console.log(`${tables.length} tables: ${tables.join(", ")}`);
    return 0;
  }
  if (args.length === 0) {
    console.log("usage: osd-data.mjs --tables | \"SELECT ...\" [max]");
    return 2;
  }
  const answer = await data.query(args[0], {max: Number(args[1] ?? 20)});
  console.log(answer.columns.join(" | "));
  for (const row of answer.rows) {
    console.log(Object.values(row).join(" | "));
  }
  console.log(`${answer.count} rows${answer.truncated ? ", truncated" : ""}`);
  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(`${error.code ?? "ERROR"}: ${error.message}`);
    process.exit(1);
  });
}
