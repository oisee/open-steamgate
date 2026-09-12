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

import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

export const DEFAULT_CAPTURE_FOLDER = ".local/capture/a4h/rfc";

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
    for (const direction of ["importing", "tables", "changing"]) {
      for (const [param, value] of Object.entries(signature[direction] ?? {})) {
        const out = capture.result[param.toUpperCase()];
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

/**
 * 'NONE' and '' run locally, every other destination replays from the capture
 * folder; the runtime looks destinations up by name, so a Proxy answers for
 * names nobody registered.
 */
export function installRfcDestinations(abap, options = {}) {
  const folder = options.folder ?? process.env.STG_RFC_CAPTURE ?? DEFAULT_CAPTURE_FOLDER;
  const local = localClient();
  const known = {...abap.context.RFCDestinations, "NONE": local, "": local};
  const replays = new Map();
  abap.context.RFCDestinations = new Proxy(known, {
    get: (target, key) => {
      if (typeof key !== "string") {
        return target[key];
      }
      if (target[key] !== undefined) {
        return target[key];
      }
      if (!replays.has(key)) {
        replays.set(key, new RfcReplayClient({folder, destination: key, trace: options.trace}));
      }
      return replays.get(key);
    },
    has: () => true,
  });
  return abap.context.RFCDestinations;
}
