// RFC capture/replay: `CALL FUNCTION ... DESTINATION x` served from captured
// calls of a real system, so a service with RFC-mapped or BAPI-calling code
// runs here without the system.
//
// The runtime hands every remote call to abap.context.RFCDestinations[dest]
// .call(name, {exporting, importing, tables, changing, exceptions}) with the
// runtime's typed values (packages/runtime/src/rfc.ts). Two clients live here:
//
//   localClient()        runs abap.FunctionModules[name] in this process,
//                        what 'NONE' and '' mean on a Gateway
//   RfcReplayClient      picks a capture by function name and input, fills
//                        the outputs, sets sy-subrc
//
// Capture format, one file per call, <folder>/<FUNCNAME>/<n>.json, what
// `rfc call <FM> <json>` of open-rfc-go takes and prints:
//
//   {
//     "name": "BAPI_FLIGHT_GETLIST",
//     "destination": "A4H",                        // informational
//     "params": {"AIRLINE": "LH"},                 // the call's input by name,
//                                                  //   scalars, structures as
//                                                  //   objects, tables as arrays
//     "result": {"FLIGHT_LIST": [{...}, {...}],    // the exports by name, as
//                "RETURN": []},                    //   open-rfc-go prints them
//     "exception": "NOT_FOUND",                    // optional: the raised
//     "subrc": 1                                   //   classic exception
//   }
//
// Which name is EXPORTING, TABLES or CHANGING comes from the caller's
// signature at replay time, so the file needs no direction markers. The
// split form {exporting, changing, tables, importing_out, tables_out,
// changing_out} is accepted too and merged into params/result. Values are
// what the transpiler produces: CHAR with its padding, NUMC as text, numbers
// as numbers; matching ignores trailing blanks and letter case of names.
//
// Real captures live under .local/ (never committed); STG_RFC_CAPTURE points
// at the folder, default .local/capture/a4h/rfc.
//
// A capture's result may carry placeholders, filled at replay time, so a
// read after a create finds what was created:
//   {{param:IV_X}}        the call's input by name (dotted path into a structure)
//   {{now:YYYYMMDD}}      today; also HHMMSS and YYYYMMDDHHMMSS
//   {{seq:NAME}}          a counter per name, {{seq:NAME:8}} zero-padded to 8
//   {{sql:SELECT ...}}    a row of our database (the transpiler's client):
//                         one column -> the value, several -> an object; when
//                         the placeholder is the whole value, all rows -> array
//
// Which destination does what comes from .local/rfc-destinations.json (or
// STG_RFC_DESTINATIONS), kinds local | replay | live | record | fallback,
// see installRfcDestinations; without the file: 'NONE' and '' local, every
// other name replays.

import {existsSync, readdirSync, readFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";

export const DEFAULT_CAPTURE_FOLDER = ".local/capture/a4h/rfc";
export const DEFAULT_DESTINATIONS_FILE = ".local/rfc-destinations.json";

// ---------------------------------------------------------------- values

/** runtime value -> plain JSON (structures as objects, tables as arrays) */
export function toJson(value) {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value.getPointer === "function") {
    return toJson(value.getPointer());
  }
  if (typeof value.array === "function" && typeof value.getRowType === "function") {
    return value.array().map(toJson);
  }
  const inner = value.get();
  if (inner !== null && typeof inner === "object" && typeof value.getRowType !== "function"
      && !(inner instanceof Uint8Array)) {
    const out = {};
    for (const [field, fieldValue] of Object.entries(inner)) {
      out[field.toUpperCase()] = toJson(fieldValue);
    }
    return out;
  }
  return inner;
}

/** plain JSON -> into an existing runtime value (typed by the caller) */
export function fromJson(target, json) {
  if (target === undefined || json === undefined || json === null) {
    return;
  }
  if (typeof target.getPointer === "function") {
    fromJson(target.getPointer(), json);
    return;
  }
  if (typeof target.array === "function" && typeof target.getRowType === "function") {
    target.clear();
    for (const rowJson of Array.isArray(json) ? json : []) {
      const row = target.getRowType().clone();
      fromJson(row, rowJson);
      target.append(row);
    }
    return;
  }
  const inner = target.get();
  if (inner !== null && typeof inner === "object" && !(inner instanceof Uint8Array)) {
    if (typeof json !== "object") {
      return;
    }
    const byLower = new Map(Object.keys(json).map((k) => [k.toLowerCase(), json[k]]));
    for (const [field, fieldValue] of Object.entries(inner)) {
      if (byLower.has(field.toLowerCase())) {
        fromJson(fieldValue, byLower.get(field.toLowerCase()));
      }
    }
    return;
  }
  target.set(json);
}

// what two inputs must agree on: trailing blanks and name case do not count
function normalize(json) {
  if (Array.isArray(json)) {
    return json.map(normalize);
  }
  if (json !== null && typeof json === "object") {
    const out = {};
    for (const k of Object.keys(json).sort()) {
      out[k.toUpperCase()] = normalize(json[k]);
    }
    return out;
  }
  if (typeof json === "string") {
    return json.replace(/ +$/, "");
  }
  return json;
}

const same = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

// ---------------------------------------------------------------- captures

function upperKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    out[k.toUpperCase()] = v;
  }
  return out;
}

/** one capture file in canonical form: {name, params, result, exception, subrc} */
export function canonicalCapture(raw) {
  const params = {...upperKeys(raw.exporting), ...upperKeys(raw.changing), ...upperKeys(raw.tables), ...upperKeys(raw.params)};
  const result = {...upperKeys(raw.importing_out), ...upperKeys(raw.changing_out), ...upperKeys(raw.tables_out), ...upperKeys(raw.result)};
  return {
    name: (raw.name ?? "").toUpperCase(),
    destination: raw.destination,
    params,
    result,
    exception: raw.exception ? String(raw.exception).toUpperCase() : undefined,
    subrc: raw.subrc,
    file: raw.file,
  };
}

/** the captures of one function module, in file order (1.json, 2.json, ...) */
export function loadCaptures(folder, name) {
  const dir = join(folder, name.toUpperCase());
  if (!existsSync(dir)) {
    return [];
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
  return files.map((f) => canonicalCapture({...JSON.parse(readFileSync(join(dir, f), "utf8")), file: join(dir, f)}));
}

/** the call's input as JSON by name, in the shape a capture's params has */
export function inputOf(signature) {
  const input = {};
  for (const direction of ["exporting", "changing", "tables"]) {
    for (const [param, value] of Object.entries(signature[direction] ?? {})) {
      input[param.toUpperCase()] = toJson(value);
    }
  }
  return input;
}

/** exact input match, then the scalar (key-like) parameters only, then the first */
export function pickCapture(captures, input) {
  if (captures.length === 0) {
    return undefined;
  }
  const exact = captures.find((c) => same(c.params, input));
  if (exact) {
    return exact;
  }
  const scalars = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v === null || typeof v !== "object"));
  const inputScalars = scalars(input);
  if (Object.keys(inputScalars).length > 0) {
    const byKeys = captures.find((c) => same(scalars(c.params), inputScalars));
    if (byKeys) {
      return byKeys;
    }
  }
  return captures[0];
}

// ---------------------------------------------------------------- placeholders

const sequences = new Map();

function pad2(n) {
  return String(n).padStart(2, "0");
}

function nowText(format) {
  const d = new Date();
  const date = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  switch (format.toUpperCase()) {
    case "YYYYMMDD": return date;
    case "HHMMSS": return time;
    case "YYYYMMDDHHMMSS": return date + time;
    default: throw new Error(`RFC replay: unknown now format ${format}`);
  }
}

function paramText(input, path) {
  let value = input;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object") {
      return undefined;
    }
    const key = Object.keys(value).find((k) => k.toUpperCase() === part.toUpperCase());
    value = key === undefined ? undefined : value[key];
  }
  return value;
}

async function sqlRows(select) {
  const db = globalThis.abap?.context?.databaseConnections?.["DEFAULT"];
  if (db === undefined) {
    throw new Error("RFC replay: {{sql:}} needs the runtime's database connection");
  }
  const result = await db.select({select});
  return result.rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[k.toUpperCase()] = v;
    }
    return out;
  });
}

const PLACEHOLDER = /\{\{(param|now|seq|sql):(.*?)\}\}/gs;

/** one placeholder's value, as JSON (string, object or array) */
async function placeholderValue(kind, arg, input) {
  switch (kind) {
    case "param": return paramText(input, arg.trim()) ?? "";
    case "now": return nowText(arg.trim());
    case "seq": {
      const [name, width] = arg.split(":").map((x) => x.trim());
      const n = (sequences.get(name) ?? 0) + 1;
      sequences.set(name, n);
      return width ? String(n).padStart(parseInt(width, 10), "0") : String(n);
    }
    case "sql": {
      const rows = await sqlRows(arg.trim());
      return rows;
    }
    default: return "";
  }
}

const scalarOf = (value) => {
  if (Array.isArray(value)) {
    return value.length === 0 ? "" : scalarOf(value[0]);
  }
  if (value !== null && typeof value === "object") {
    const values = Object.values(value);
    return values.length === 1 ? scalarOf(values[0]) : value;
  }
  return value;
};

/** the capture's result with every placeholder filled */
export async function substitute(json, input) {
  if (Array.isArray(json)) {
    const out = [];
    for (const item of json) {
      out.push(await substitute(item, input));
    }
    return out;
  }
  if (json !== null && typeof json === "object") {
    const out = {};
    for (const [k, v] of Object.entries(json)) {
      out[k] = await substitute(v, input);
    }
    return out;
  }
  if (typeof json !== "string" || !json.includes("{{")) {
    return json;
  }
  const matches = [...json.matchAll(PLACEHOLDER)];
  const whole = matches.length === 1 && matches[0][0] === json ? matches[0] : undefined;
  if (whole) {
    const value = await placeholderValue(whole[1], whole[2], input);
    if (whole[1] === "sql") {
      // the whole value: all rows as an array, or one row's value / object
      return value.length === 1 ? scalarOf(value) : value;
    }
    return value;
  }
  let text = json;
  for (const m of matches) {
    const value = await placeholderValue(m[1], m[2], input);
    text = text.replace(m[0], String(scalarOf(value) ?? ""));
  }
  return text;
}

/** counters of {{seq:}} start again (tests) */
export function resetSequences() {
  sequences.clear();
}

// ---------------------------------------------------------------- clients

/** the function modules of this process, what DESTINATION 'NONE' means */
export function localClient() {
  return {
    call: async (name, signature) => {
      const fm = globalThis.abap.FunctionModules[name.trimEnd().toUpperCase()];
      if (fm === undefined) {
        throw await new globalThis.abap.Classes["CX_SY_DYN_CALL_ILLEGAL_FUNC"]().constructor_();
      }
      await fm(signature);
    },
  };
}

export class RfcReplayClient {
  /**
   * @param options.folder capture folder, <folder>/<FUNCNAME>/<n>.json
   * @param options.destination the destination name, for messages only
   */
  constructor(options = {}) {
    this.folder = options.folder ?? DEFAULT_CAPTURE_FOLDER;
    this.destination = options.destination ?? "";
    this.trace = options.trace === true;
  }

  async call(name, signature) {
    const fm = name.trimEnd().toUpperCase();
    const captures = loadCaptures(this.folder, fm);
    if (captures.length === 0) {
      throw new Error(`RFC replay: no capture of ${fm} for destination '${this.destination}' under ${join(this.folder, fm)}/; `
        + `record one with: rfc call ${fm} '<params json>' (open-rfc-go) and save it as ${join(this.folder, fm, "1.json")}`);
    }
    const input = inputOf(signature);
    const capture = pickCapture(captures, input);
    if (this.trace) {
      console.log(`RFC replay: ${fm} <- ${capture.file}`);
    }
    const result = await substitute(capture.result, input);
    for (const direction of ["importing", "tables", "changing"]) {
      for (const [param, value] of Object.entries(signature[direction] ?? {})) {
        const out = result[param.toUpperCase()];
        if (out !== undefined) {
          fromJson(value, out);
        }
      }
    }
    const sy = globalThis.abap.builtin.sy.get();
    if (capture.exception !== undefined) {
      const exceptions = upperKeys(signature.exceptions);
      const code = exceptions[capture.exception] ?? exceptions["OTHERS"];
      if (code === undefined) {
        throw new Error(`RFC replay: ${fm} raised ${capture.exception} (${capture.file}), not handled by the caller`);
      }
      sy.subrc.set(capture.subrc ?? code);
    } else {
      sy.subrc.set(capture.subrc ?? 0);
    }
  }
}

/** the destinations file, {} when there is none */
export function loadDestinations(file) {
  const path = file ?? process.env.STG_RFC_DESTINATIONS ?? DEFAULT_DESTINATIONS_FILE;
  const expanded = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  if (!existsSync(expanded)) {
    return {};
  }
  const config = JSON.parse(readFileSync(expanded, "utf8"));
  for (const [name, entry] of Object.entries(config)) {
    if (!["local", "replay", "live", "record", "fallback"].includes(entry.kind)) {
      throw new Error(`RFC destinations: ${name} has kind '${entry.kind}', expected local, replay, live, record or fallback`);
    }
  }
  return config;
}

/** the client a destinations entry describes */
export async function clientFor(name, entry, options = {}) {
  const local = options.local ?? localClient();
  const folder = options.folder ?? DEFAULT_CAPTURE_FOLDER;
  const trace = options.trace;
  switch (entry.kind) {
    case "local":
      return local;
    case "replay":
      return new RfcReplayClient({folder: entry.capture ?? folder, destination: name, trace});
    case "live":
    case "record":
    case "fallback": {
      if (options.noLive) {
        console.warn(`RFC destinations: ${name} is ${entry.kind}, not available here, replaying from ${entry.capture ?? folder}`);
        return new RfcReplayClient({folder: entry.capture ?? folder, destination: name, trace});
      }
      const {RfcLiveClient, RfcFallbackClient} = await import("./rfc-live.mjs");
      const live = new RfcLiveClient({
        destination: name, connection: entry.connection, trace,
        record: entry.kind === "record" ? (entry.capture ?? folder) : undefined,
        clientFactory: options.clientFactory,
      });
      return entry.kind === "fallback" ? new RfcFallbackClient(local, live) : live;
    }
    default:
      throw new Error(`RFC destinations: ${name}: unknown kind ${entry.kind}`);
  }
}

/**
 * Installs the destinations on abap.context.RFCDestinations: the entries of
 * the destinations file (see loadDestinations), plus 'NONE' and '' as local
 * unless the file says otherwise; every name nobody configured replays from
 * the capture folder. The runtime looks destinations up by name, so a Proxy
 * answers for names nobody registered.
 */
export async function installRfcDestinations(abap, options = {}) {
  const folder = options.folder ?? process.env.STG_RFC_CAPTURE ?? DEFAULT_CAPTURE_FOLDER;
  const local = localClient();
  const config = options.destinations ?? loadDestinations(options.config);
  const known = {...abap.context.RFCDestinations, "NONE": local, "": local};
  for (const [name, entry] of Object.entries(config)) {
    known[name.toUpperCase()] = await clientFor(name.toUpperCase(), entry, {...options, folder, local});
  }
  const replays = new Map();
  abap.context.RFCDestinations = new Proxy(known, {
    get: (target, key) => {
      if (typeof key !== "string") {
        return target[key];
      }
      const name = key.toUpperCase();
      if (target[name] !== undefined) {
        return target[name];
      }
      if (!replays.has(name)) {
        replays.set(name, new RfcReplayClient({folder, destination: name, trace: options.trace}));
      }
      return replays.get(name);
    },
    has: () => true,
  });
  return abap.context.RFCDestinations;
}
