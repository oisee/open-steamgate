// The AMDP destination: `CALL FUNCTION ... DESTINATION 'AMDP'` reaches HANA.
//
// tools/amdp-gen.mjs rewrites every AMDP body into such a call, and the
// runtime hands a routed call to abap.context.RFCDestinations[name].call(fm,
// signature) -- the same contract tools/rfc-replay.mjs implements for
// captured RFC. So this is a client of a dozen lines around the deploy and
// call that tools/amdp-run.mjs already does, not a new mechanism.
//
// Values come back through fromJson() of rfc-replay, which walks the
// runtime's typed values and ends at target.set(), so the ABAP type does its
// own converting -- CHAR gets its padding back, which matters because HANA's
// NVARCHAR has none.
import {readFileSync, existsSync} from "node:fs";
import {join} from "node:path";
import {fromJson} from "./rfc-replay.mjs";
import {connection} from "./amdp-run.mjs";

const SCHEMA = process.env.HANA_SCHEMA ?? process.env.HXE_SCHEMA ?? "OSD";

/** what amdp-gen wrote: one entry per AMDP method, keyed by module name */
export function loadProcedures(folder = "gen/amdp") {
  const file = join(folder, "procedures.json");
  if (!existsSync(file)) return new Map();
  const {procedures} = JSON.parse(readFileSync(file, "utf8"));
  return new Map(procedures.map((p) => [p.module.toUpperCase(), p]));
}

function statement(p) {
  const name = `"${SCHEMA}"."${p.class}=>${p.method.toUpperCase()}"`;
  if (p.kind === "function") {
    // A table function is a view with arguments: its rows are its return
    // value, not an OUT parameter, so the RETURNING parameter of the ABAP
    // method becomes RETURNS TABLE(...) here.
    const returning = p.parameters.find((x) => x.direction === "RETURNING");
    const args = p.parameters.filter((x) => x.direction === "IN")
      .map((x) => `${x.name} ${x.hanaType}`).join(", ");
    return [`CREATE FUNCTION ${name} (${args})`,
      `  RETURNS ${returning?.hanaType ?? "TABLE()"}`,
      `  LANGUAGE ${p.language}`, `  READS SQL DATA`, "AS BEGIN", p.body, "END;"].join("\n");
  }
  const args = p.parameters.map((x) =>
    `${x.direction === "INOUT" ? "INOUT" : x.direction} ${x.name} ${x.hanaType}`).join(", ");
  return [`CREATE PROCEDURE ${name} (${args})`, `  LANGUAGE ${p.language}`, `  SQL SECURITY INVOKER`,
    p.readOnly ? "  READS SQL DATA" : "", "AS BEGIN", p.body, "END;"]
    .filter((x) => x !== "").join("\n");
}

export class AmdpDestination {
  constructor(options = {}) {
    this.folder = options.folder ?? "gen/amdp";
    this.trace = options.trace === true;
    this.procedures = loadProcedures(this.folder);
    this.client = undefined;
    // the source hash of what is deployed, so a body is created once and a
    // changed body is redeployed without anyone remembering to
    this.deployed = new Map();
  }

  async #connect() {
    if (this.client !== undefined) return this.client;
    const hdb = (await import("hdb")).default;
    this.client = hdb.createClient(connection());
    await new Promise((resolve, reject) => this.client.connect((e) => (e ? reject(e) : resolve())));
    return this.client;
  }

  #exec(sql) {
    return new Promise((resolve, reject) =>
      this.client.exec(sql, (err, ...rest) => (err ? reject(err) : resolve(rest))));
  }

  async #deploy(p) {
    if (this.deployed.get(p.module) === p.hash) return;
    const name = `"${SCHEMA}"."${p.class}=>${p.method.toUpperCase()}"`;
    await this.#exec(`CREATE SCHEMA "${SCHEMA}"`).catch(() => undefined);
    await this.#exec(`DROP ${p.kind === "function" ? "FUNCTION" : "PROCEDURE"} ${name}`).catch(() => undefined);
    await this.#exec(statement(p));
    this.deployed.set(p.module, p.hash);
    if (this.trace) console.log(`AMDP: deployed ${name}`);
  }

  /** the destination contract: (function module name, typed signature) */
  async call(name, signature) {
    const p = this.procedures.get(String(name).trimEnd().toUpperCase());
    if (p === undefined) {
      throw new Error(`AMDP: no procedure known for ${name}. Run 'node tools/amdp-gen.mjs' `
        + `so gen/amdp/procedures.json carries it.`);
    }
    await this.#connect();
    await this.#deploy(p);

    const {call} = await import("./amdp-run.mjs");
    const inputs = {};
    for (const x of p.parameters) {
      if (x.direction === "OUT") continue;
      const given = signature.exporting?.[x.name] ?? signature.changing?.[x.name] ?? signature.tables?.[x.name];
      if (given === undefined) continue;
      // the runtime's typed value -> plain JSON the runner can bind
      inputs[x.name] = typeof given.array === "function" ? given.array().map((row) => plainRow(row)) : given.get();
    }
    let result;
    if (p.kind === "function") {
      // a table function is queried, not called
      const args = p.parameters.filter((x) => x.direction === "IN")
        .map((x) => `${x.name} => ${literal(inputs[x.name])}`).join(", ");
      const rows = await this.#exec(
        `SELECT * FROM "${SCHEMA}"."${p.class}=>${p.method.toUpperCase()}"(${args})`);
      const returning = p.parameters.find((x) => x.direction === "RETURNING");
      result = {[returning?.name ?? "rt"]: (rows.find(Array.isArray) ?? []).map((row) =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), Buffer.isBuffer(v) ? v.toString("utf8") : v])))};
    } else {
      const method = {name: p.method, parameters: p.parameters.map((x) => ({...x, abapType: x.hanaType}))};
      result = await call(this.client, `"${SCHEMA}"."${p.class}=>${p.method.toUpperCase()}"`, method, inputs, undefined);
    }

    for (const x of p.parameters) {
      if (x.direction === "IN") continue;
      const target = signature.importing?.[x.name] ?? signature.changing?.[x.name] ?? signature.tables?.[x.name];
      if (target === undefined) continue;
      fromJson(target, result[x.name] ?? result[x.name.toUpperCase()]);
    }
    if (this.trace) console.log(`AMDP: ${p.class}=>${p.method} returned ${Object.keys(result).join(", ")}`);
  }
}

/** a value as SQL text; only scalars reach here, a table parameter of a table
 *  function is not a thing HANA has */
function literal(v) {
  return typeof v === "number" ? String(v) : `'${String(v ?? "").replace(/'/g, "''")}'`;
}

/** a runtime structure as plain JSON, lower-cased field names */
function plainRow(row) {
  const inner = typeof row.get === "function" ? row.get() : row;
  if (inner === null || typeof inner !== "object") return inner;
  const out = {};
  for (const [k, v] of Object.entries(inner)) out[k.toLowerCase()] = typeof v?.get === "function" ? v.get() : v;
  return out;
}
