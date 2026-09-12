// Live RFC through open-rfc (SDK-free TypeScript client, node >= 22.14), the
// counterpart of the replay client in tools/rfc-replay.mjs: the same
// runtime signature in, the same JSON convention on the wire (parameter
// names as in the interface, structures as objects, tables as arrays,
// DATE/TIME as YYYYMMDD/HHMMSS strings), so a live answer can be written
// straight into a capture file and replayed later.
//
// One open-rfc session per destination, logon on the first call, closed
// when the process ends. `record` is live plus a capture file per call,
// <folder>/<FUNCNAME>/<n>.json in the replay format, so captures come out
// of an end-to-end run instead of by hand.
//
// Connection: an object in the node-rfc convention ({ashost, sysnr, client,
// user, passwd, lang}), or a path to an open-rfc-go `.rfc.json` ({systems:
// {NAME: {ashost, sysnr, client, user, password, lang}}, default}) with an
// optional `#NAME` suffix; without a suffix the destination name, then the
// file's default, picks the system. `~/` is the home directory.

import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join, resolve} from "node:path";
import {inputOf, fromJson} from "./rfc-replay.mjs";

const expandHome = (p) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

/** the open-rfc connection parameters a destination's `connection` amounts to */
export function resolveConnection(connection, destination) {
  if (connection === undefined || connection === null) {
    connection = "~/.rfc.json";
  }
  if (typeof connection === "object") {
    return normalizeSystem(connection, destination);
  }
  const [file, system] = String(connection).split("#");
  const path = resolve(expandHome(file));
  if (!existsSync(path)) {
    throw new Error(`RFC destination ${destination}: connection file ${path} not found`);
  }
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (config.systems === undefined) {
    // a bare system object in the file
    return normalizeSystem(config, destination);
  }
  const name = system || (config.systems[destination] ? destination : config.default);
  const entry = config.systems[name];
  if (entry === undefined) {
    throw new Error(`RFC destination ${destination}: system ${name ?? "(none)"} not in ${path} (systems: ${Object.keys(config.systems).join(", ")})`);
  }
  return normalizeSystem(entry, destination);
}

function normalizeSystem(s, destination) {
  const passwd = s.passwd ?? s.password;
  if (s.ticket && !passwd) {
    throw new Error(`RFC destination ${destination}: logon tickets are not supported by the live client, give a password`);
  }
  for (const k of ["ashost", "client", "user"]) {
    if (!s[k]) {
      throw new Error(`RFC destination ${destination}: connection has no ${k}`);
    }
  }
  return {ashost: s.ashost, sysnr: String(s.sysnr ?? "00"), client: String(s.client), user: s.user, passwd: passwd ?? "", lang: s.lang ?? "EN"};
}

/** next free <n>.json in a capture folder */
function nextCaptureFile(folder, fm) {
  const dir = join(folder, fm);
  mkdirSync(dir, {recursive: true});
  const numbers = readdirSync(dir).map((f) => parseInt(f, 10)).filter((n) => !Number.isNaN(n));
  const n = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
  return join(dir, `${n}.json`);
}

export class RfcLiveClient {
  /**
   * @param options.destination the destination name (messages, capture files)
   * @param options.connection see resolveConnection
   * @param options.record capture folder; every call is written there
   * @param options.clientFactory (params) => open-rfc Client, for tests
   * @param options.trace print every call
   */
  constructor(options = {}) {
    this.destination = options.destination ?? "";
    this.connection = options.connection;
    this.record = options.record;
    this.clientFactory = options.clientFactory;
    this.trace = options.trace === true;
    this.client = undefined;
  }

  async open() {
    if (this.client !== undefined) {
      return this.client;
    }
    const params = resolveConnection(this.connection, this.destination);
    let client;
    if (this.clientFactory) {
      client = await this.clientFactory(params);
    } else {
      // open-rfc is a Node module the browser preview never loads: the
      // bundler leaves this import alone (a live destination is Node only)
      const {Client} = await import(/* webpackIgnore: true */ "open-rfc");
      client = new Client(params, {timeout: 30});
    }
    await client.open();
    this.client = client;
    process.once("beforeExit", () => this.close());
    return client;
  }

  async close() {
    const client = this.client;
    this.client = undefined;
    if (client !== undefined) {
      try {
        await client.close();
      } catch {
        // the process is ending anyway
      }
    }
  }

  async call(name, signature) {
    const fm = name.trimEnd().toUpperCase();
    const params = inputOf(signature);
    const client = await this.open();
    if (this.trace) {
      console.log(`RFC live ${this.destination}: ${fm} ${JSON.stringify(params)}`);
    }
    const capture = {name: fm, destination: this.destination, params, result: {}};
    const sy = globalThis.abap.builtin.sy.get();
    try {
      const result = await client.call(fm, params);
      capture.result = plainResult(result);
      for (const direction of ["importing", "tables", "changing"]) {
        for (const [param, value] of Object.entries(signature[direction] ?? {})) {
          const out = capture.result[param.toUpperCase()];
          if (out !== undefined) {
            fromJson(value, out);
          }
        }
      }
      sy.subrc.set(0);
    } catch (error) {
      const key = abapExceptionKey(error);
      if (key === undefined) {
        throw error;
      }
      const exceptions = Object.fromEntries(Object.entries(signature.exceptions ?? {}).map(([k, v]) => [k.toUpperCase(), v]));
      const code = exceptions[key] ?? exceptions["OTHERS"];
      if (code === undefined) {
        throw error;
      }
      capture.exception = key;
      capture.subrc = code;
      sy.subrc.set(code);
    } finally {
      if (this.record) {
        const file = nextCaptureFile(this.record, fm);
        writeFileSync(file, JSON.stringify(capture, null, 2) + "\n");
        if (this.trace) {
          console.log(`RFC record: ${file}`);
        }
      }
    }
  }
}

/** the classic exception an open-rfc error stands for, undefined for anything else */
export function abapExceptionKey(error) {
  if (error === null || typeof error !== "object") {
    return undefined;
  }
  // ABAPError (RAISE in the function module) and RFCError with a key; a
  // system/communication failure has no key the caller could have listed
  if (error.name === "ABAPError" && typeof error.key === "string" && error.key !== "") {
    return error.key.toUpperCase();
  }
  if (typeof error.key === "string" && /^[A-Z_][A-Z0-9_]*$/i.test(error.key) && error.codeString === "RFC_ABAP_EXCEPTION") {
    return error.key.toUpperCase();
  }
  return undefined;
}

/** open-rfc output -> JSON as a capture stores it (keys as returned, values plain) */
function plainResult(result) {
  const out = {};
  for (const [k, v] of Object.entries(result ?? {})) {
    out[k] = plainValue(v);
  }
  return out;
}

function plainValue(v) {
  if (Array.isArray(v)) {
    return v.map(plainValue);
  }
  if (v instanceof Uint8Array) {
    return Buffer.from(v).toString("hex").toUpperCase();
  }
  if (typeof v === "bigint") {
    return Number(v);
  }
  if (v !== null && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      o[k] = plainValue(x);
    }
    return o;
  }
  return v;
}

/** local function module when transpiled, live otherwise */
export class RfcFallbackClient {
  constructor(local, live) {
    this.local = local;
    this.live = live;
  }

  async call(name, signature) {
    if (globalThis.abap.FunctionModules[name.trimEnd().toUpperCase()] !== undefined) {
      return this.local.call(name, signature);
    }
    return this.live.call(name, signature);
  }
}
