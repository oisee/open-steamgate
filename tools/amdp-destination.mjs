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

/** lines the sandbox wrapper puts in front of a typed body (see #sandbox) */
const SANDBOX_OFFSET = 1;

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
    // A host that was built without a HANA driver -- the browser preview,
    // where the bundle leaves hdb and tools/amdp-run.mjs out -- still has this
    // destination, because a developer needs "there is no HANA here" rather
    // than "unknown destination AMDP". Say that, rather than fail on an
    // undefined import.
    if (typeof connection !== "function") {
      throw new Error("AMDP: this build has no HANA driver (the browser preview); an AMDP method needs a database that speaks SQLScript");
    }
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

  /** Let go of the connection. An open socket keeps Node's event loop alive,
   *  so a suite that touched HANA passes and then does not exit. */
  async close() {
    if (this.client === undefined) return;
    try { this.client.end(); } catch { /* already gone */ }
    this.client = undefined;
  }

  /** The sandbox (backlog G.8): a body typed on a screen, run now.
   *
   *  Everything else here routes a *generated* module whose signature the
   *  transpiler resolved at transpile time. The sandbox has no signature to
   *  resolve: it takes text and gives back text, which is what lets one
   *  function module stand for any body a person types.
   *
   *  The body is deployed under a throwaway name and dropped again, so
   *  nothing a visitor types survives the call. The name carries the process
   *  and a counter rather than a random word, so two sandboxes open at once
   *  cannot collide and a leftover object says who left it.
   *
   *  The interesting half is the failure: HANA answers a bad body with a
   *  message that names the line and the column. That is the oracle we have
   *  and no parser of ours would be, so it is passed through **verbatim** --
   *  a sandbox that paraphrases the engine is worth nothing.
   */
  async #sandbox(signature) {
    // The transpiler writes the parameter names of a CALL FUNCTION in the
    // case they were typed in, which for ABAP source is lower; the function
    // group declares them upper. Look either up without caring, or the call
    // arrives, runs and answers into nothing -- which on the screen is a page
    // with no result and no error, the least informative outcome possible.
    const pick = (bag, name) => {
      if (bag === undefined) return undefined;
      const key = Object.keys(bag).find((k) => k.toUpperCase() === name);
      return key === undefined ? undefined : bag[key];
    };
    const given = pick(signature.exporting, "IV_BODY");
    const body = String(given?.get?.() ?? given ?? "");
    const say = (field, text) => {
      const target = pick(signature.importing, field);
      if (target?.set !== undefined) target.set(String(text));
    };
    if (body.trim() === "") {
      say("EV_ERROR", "nothing to run");
      return;
    }
    await this.#connect();
    this.sandboxCount = (this.sandboxCount ?? 0) + 1;
    const name = `"${SCHEMA}"."OSD_SANDBOX_${process.pid}_${this.sandboxCount}"`;
    const started = Date.now();
    await this.#exec(`CREATE SCHEMA "${SCHEMA}"`).catch(() => undefined);
    await this.#exec(`DROP PROCEDURE ${name}`).catch(() => undefined);
    // The wrapper is **one fixed line**, and that is not a matter of taste:
    // the engine reports "line N col M" against the statement it was given,
    // so every line the wrapper adds is a line the person's own numbering is
    // wrong by. One line in front, one behind, and the correction is a
    // subtraction that cannot drift (SANDBOX_OFFSET). A second CREATE shape
    // tried on failure would make the offset depend on which attempt spoke.
    const preamble = `CREATE PROCEDURE ${name} () LANGUAGE SQLSCRIPT SQL SECURITY INVOKER AS BEGIN`;
    try {
      await this.#exec(`${preamble}\n${body}\nEND`);
      const out = await this.#exec(`CALL ${name}`);
      const rows = out.find(Array.isArray) ?? [];
      const plain = rows.slice(0, 200).map((row) => Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k, Buffer.isBuffer(v) ? v.toString("utf8") : v])));
      say("EV_RESULT", JSON.stringify(plain));
      say("EV_ROWS", String(rows.length));
      say("EV_MS", String(Date.now() - started));
    } catch (e) {
      // The engine's own words, twice. EV_ERROR carries the position moved
      // back into the person's own line numbering, because a sandbox that
      // points at line 2 of something the person cannot see is worse than
      // one that says nothing. EV_RAW carries the message untouched, because
      // the moment we start paraphrasing the oracle we stop having one.
      const raw = String(e?.message ?? e);
      say("EV_RAW", raw);
      say("EV_ERROR", raw.replace(/line (\d+)/g, (m, n) => `line ${Number(n) - SANDBOX_OFFSET}`));
    } finally {
      await this.#exec(`DROP PROCEDURE ${name}`).catch(() => undefined);
    }
  }

  /** the destination contract: (function module name, typed signature) */
  async call(name, signature) {
    if (String(name).trimEnd().toUpperCase() === "ZOSD_AMDP_SANDBOX") {
      return this.#sandbox(signature);
    }
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
        Object.fromEntries(Object.entries(row).map(([k, v]) =>
          [k.toLowerCase(), abapDateTime(Buffer.isBuffer(v) ? v.toString("utf8") : v)])))};
    } else {
      const method = {name: p.method, parameters: p.parameters.map((x) => ({...x, abapType: x.hanaType}))};
      result = await call(this.client, `"${SCHEMA}"."${p.class}=>${p.method.toUpperCase()}"`, method, inputs, undefined);
    }

    for (const x of p.parameters) {
      if (x.direction === "IN") continue;
      const target = signature.importing?.[x.name] ?? signature.changing?.[x.name] ?? signature.tables?.[x.name];
      if (target === undefined) continue;
      fromJson(target, withAbapDates(result[x.name] ?? result[x.name.toUpperCase()]));
    }
    if (this.trace) console.log(`AMDP: ${p.class}=>${p.method} returned ${Object.keys(result).join(", ")}`);
  }
}

/** HANA's own date and time types, in ABAP's spelling.
 *
 *  Measured 2026-09-18 rather than assumed: node-hdb hands DATE, TIME,
 *  TIMESTAMP and SECONDDATE back as **strings**, not Date objects --
 *  "2026-09-18", "14:30:05", "2026-09-18T14:30:05.123". ABAP holds a date as
 *  CHAR(8) "20260918" and a time as CHAR(6) "143005", so the separators come
 *  out. Without this `set()` would store "2026-09-" into a CHAR(8) date and
 *  be quietly wrong, which is the failure mode this whole file keeps meeting.
 *
 *  Our own tables never hit this path: the transpiler writes ABAP D and T as
 *  NCHAR(8) and NCHAR(6), so they come back as "20260918" already. It matters
 *  when an AMDP body returns a real HANA date, `SELECT CURRENT_DATE` being
 *  the obvious one. */
export function abapDateTime(value) {
  if (typeof value !== "string") return value;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return m[1] + m[2] + m[3];
  m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (m) return m[1] + m[2] + m[3];
  m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (m) return m.slice(1).join("");            // ABAP timestamp: YYYYMMDDHHMMSS
  return value;
}

/** a value as SQL text; only scalars reach here, a table parameter of a table
 *  function is not a thing HANA has */
function literal(v) {
  return typeof v === "number" ? String(v) : `'${String(v ?? "").replace(/'/g, "''")}'`;
}

/** the same, through a table of rows or a single value */
function withAbapDates(value) {
  if (Array.isArray(value)) return value.map(withAbapDates);
  if (value !== null && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withAbapDates(v)]));
  }
  return abapDateTime(value);
}

/** a runtime structure as plain JSON, lower-cased field names */
function plainRow(row) {
  const inner = typeof row.get === "function" ? row.get() : row;
  if (inner === null || typeof inner !== "object") return inner;
  const out = {};
  for (const [k, v] of Object.entries(inner)) out[k.toLowerCase()] = typeof v?.get === "function" ? v.get() : v;
  return out;
}
