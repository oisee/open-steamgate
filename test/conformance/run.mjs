#!/usr/bin/env node
// The referee: it takes a base URL and nothing else.
//
//   node test/conformance/run.mjs --base http://localhost:3030
//                                [--tags read,adt] [--include-mutating]
//                                [--json out.json] [--logon env] [--list]
//
// Every case of test/conformance/suite.mjs is performed over plain HTTP and
// compared with what it says the answer must look like. Exit 0 only if every
// selected case passed. Nothing here imports the application; node builtins
// only, so the same file can be pointed at any host that speaks the protocol.
//
// --logon env takes OSD_SAP_USER / OSD_SAP_PASSWORD / OSD_SAP_CLIENT out of
// the environment and sends them as basic auth (and sap-client). Credentials
// never travel on the command line and are never written to a file: the JSON
// report carries the request, not the headers.

import {writeFileSync} from "node:fs";

export const DEFAULT_BASE = `http://localhost:${process.env.STG_PORT ?? 3030}`;

// ------------------------------------------------------------------ selection

export function select(cases, {tags, includeMutating} = {}) {
  const wanted = tags && tags.length ? new Set(tags) : undefined;
  return cases.filter((c) => {
    const mutating = c.tags.includes("mutating");
    if (mutating && !includeMutating) return false;
    if (!wanted) return true;
    return c.tags.some((t) => wanted.has(t));
  });
}

// ------------------------------------------------------------- the comparisons

const fill = (value, base) =>
  typeof value === "string" ? value.split("{base}").join(base) : value;

// d.results[0].to_Bookings.results[*].BOOKINGID — [*] maps over the array
function at(value, path) {
  let current = [value];
  let spread = false;
  for (const token of path.split(/\.|(?=\[)/).filter(Boolean)) {
    const index = /^\[(\d+|\*)\]$/.exec(token);
    const step = (v) => {
      if (v === undefined || v === null) return undefined;
      if (!index) return v[token];
      if (!Array.isArray(v)) return undefined;
      return index[1] === "*" ? v : v[Number(index[1])];
    };
    if (index && index[1] === "*") {
      const arrays = current.map(step);
      current = spread ? arrays.flat() : (arrays[0] ?? []);
      spread = true;
    } else {
      current = spread ? current.map(step) : [step(current[0])];
      if (!spread) current = [current[0]];
    }
  }
  return spread ? current : current[0];
}

const show = (v) => {
  const text = typeof v === "string" ? v : JSON.stringify(v);
  if (text === undefined) return "undefined";
  return text.length > 90 ? text.slice(0, 87) + "..." : text;
};

function checkJsonPath(body, rule, base) {
  const value = at(body, rule.path);
  const where = rule.path;
  if ("equals" in rule) {
    const want = fill(rule.equals, base);
    if (value !== want) return `${where}: ${show(value)} != ${show(want)}`;
  }
  if ("deepEquals" in rule) {
    const want = rule.deepEquals.map((v) => fill(v, base));
    if (JSON.stringify(value) !== JSON.stringify(want)) return `${where}: ${show(value)} != ${show(want)}`;
  }
  if ("number" in rule && Number(value) !== rule.number) return `${where}: ${show(value)} is not the number ${rule.number}`;
  if ("matches" in rule && !new RegExp(rule.matches).test(String(value ?? ""))) {
    return `${where}: ${show(value)} does not match /${rule.matches}/`;
  }
  if ("type" in rule) {
    const kind = Array.isArray(value) ? "array" : typeof value;
    if (kind !== rule.type) return `${where}: ${kind}, not ${rule.type}`;
  }
  if ("length" in rule && (value?.length ?? -1) !== rule.length) return `${where}: length ${value?.length}, not ${rule.length}`;
  if ("minLength" in rule && !(value?.length >= rule.minLength)) return `${where}: length ${value?.length} < ${rule.minLength}`;
  if ("contains" in rule) {
    for (const want of rule.contains) {
      const has = Array.isArray(value) ? value.includes(want) : String(value ?? "").includes(want);
      if (!has) return `${where}: ${show(value)} does not contain ${show(want)}`;
    }
  }
  return undefined;
}

// An element with these attributes exists, whatever order they are written in
// — enough of XPath to say what a $metadata test wants to say, without a
// parser and without depending on how the XML is laid out.
function checkXpathish(xml, rule) {
  const open = new RegExp(`<${rule.element}(\\s[^>]*)?/?>`, "g");
  for (const [, attributes = ""] of xml.matchAll(open)) {
    const ok = Object.entries(rule.attrs ?? {}).every(([name, want]) =>
      new RegExp(`(^|\\s)${name.replace(/[:.]/g, "\\$&")}="${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(attributes));
    if (ok) return undefined;
  }
  const attrs = Object.entries(rule.attrs ?? {}).map(([k, v]) => `${k}="${v}"`).join(" ");
  return `no <${rule.element} ${attrs}> in the document`;
}

export function compare(expected, actual, base) {
  const bad = [];
  const wantStatus = Array.isArray(expected.status) ? expected.status : [expected.status];
  if (!wantStatus.includes(actual.status)) bad.push(`status ${actual.status}, not ${wantStatus.join("/")}`);
  if (expected.contentType && !(actual.headers["content-type"] ?? "").includes(expected.contentType)) {
    bad.push(`content-type ${show(actual.headers["content-type"])} is not ${expected.contentType}`);
  }
  for (const [name, rule] of Object.entries(expected.headers ?? {})) {
    const got = actual.headers[name.toLowerCase()];
    if (typeof rule === "string") {
      const want = fill(rule, base);
      if (got !== want) bad.push(`header ${name}: ${show(got)} != ${show(want)}`);
    } else if (rule.matches && !new RegExp(rule.matches).test(String(got ?? ""))) {
      bad.push(`header ${name}: ${show(got)} does not match /${rule.matches}/`);
    }
  }
  if (expected.jsonPath) {
    let body;
    try {
      body = JSON.parse(actual.text);
    } catch {
      bad.push(`body is not JSON: ${show(actual.text)}`);
    }
    if (body !== undefined) {
      for (const rule of expected.jsonPath) {
        const problem = checkJsonPath(body, rule, base);
        if (problem) bad.push(problem);
      }
    }
  }
  for (const want of expected.contains ?? []) {
    if (!actual.text.includes(fill(want, base))) bad.push(`body does not contain ${show(want)}`);
  }
  for (const rule of expected.xpathish ?? []) {
    const problem = checkXpathish(actual.text, rule);
    if (problem) bad.push(problem);
  }
  if (expected.bytes) {
    if ("length" in expected.bytes && actual.bytes.length !== expected.bytes.length) {
      bad.push(`body is ${actual.bytes.length} bytes, not ${expected.bytes.length}`);
    }
    if (expected.bytes.prefixHex) {
      const want = expected.bytes.prefixHex.toLowerCase();
      const got = Buffer.from(actual.bytes.slice(0, want.length / 2)).toString("hex");
      if (got !== want) bad.push(`body starts ${got}, not ${want}`);
    }
  }
  return bad;
}

// ------------------------------------------------------------------- the calls

// A session: the cookies the host sets, and one CSRF token per service, asked
// for the way a client asks rather than assumed.
export class Session {
  constructor(base, {logon} = {}) {
    this.base = base.replace(/\/$/, "");
    this.logon = logon;
    this.cookies = new Map();
    this.tokens = new Map();
  }

  headers(extra = {}) {
    const headers = {...extra};
    if (this.cookies.size) {
      headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    if (this.logon?.user) {
      headers.authorization = "Basic " + Buffer.from(`${this.logon.user}:${this.logon.password ?? ""}`).toString("base64");
    }
    return headers;
  }

  remember(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  url(path) {
    const full = this.base + path;
    if (!this.logon?.client) return full;
    return full + (full.includes("?") ? "&" : "?") + "sap-client=" + encodeURIComponent(this.logon.client);
  }

  // the service root of a path under /sap/opu/odata/sap/<service>/...
  async token(path) {
    const root = /^(\/sap\/opu\/odata\/[^/]+\/[^/]+)\//.exec(path)?.[1] ?? "/sap/opu/odata/sap";
    if (this.tokens.has(root)) return this.tokens.get(root);
    const res = await fetch(this.url(root + "/"), {headers: this.headers({"x-csrf-token": "Fetch"})});
    this.remember(res);
    await res.arrayBuffer();
    const token = res.headers.get("x-csrf-token") ?? "";
    this.tokens.set(root, token);
    return token;
  }

  async perform(testCase) {
    const {method, path, headers = {}, body, redirect} = testCase.request;
    const sent = this.headers(headers);
    if (testCase.request.csrf) sent["x-csrf-token"] = await this.token(path);
    const res = await fetch(this.url(path), {
      method,
      headers: sent,
      body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
      redirect: redirect ?? "manual",
    });
    this.remember(res);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      status: res.status,
      headers: Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v])),
      text: Buffer.from(bytes).toString("utf8"),
      bytes,
    };
  }
}

export async function run(cases, {base = DEFAULT_BASE, logon} = {}) {
  const session = new Session(base, {logon});
  const results = [];
  for (const testCase of cases) {
    const started = Date.now();
    let actual;
    let bad;
    try {
      actual = await session.perform(testCase);
      bad = compare(testCase.expect, actual, session.base);
    } catch (e) {
      bad = [`request failed: ${e?.message ?? e}`];
    }
    results.push({
      id: testCase.id,
      name: testCase.name,
      tags: testCase.tags,
      request: {method: testCase.request.method, path: testCase.request.path},
      status: actual?.status,
      ms: Date.now() - started,
      ok: bad.length === 0,
      problems: bad,
    });
  }
  return results;
}

// -------------------------------------------------------------- the front door

function parse(argv) {
  const options = {base: DEFAULT_BASE, tags: [], includeMutating: false};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") options.base = argv[++i];
    else if (arg === "--tags") options.tags = argv[++i].split(",").map((t) => t.trim()).filter(Boolean);
    else if (arg === "--include-mutating") options.includeMutating = true;
    else if (arg === "--json") options.json = argv[++i];
    else if (arg === "--logon") options.logon = argv[++i];
    else if (arg === "--list") options.list = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown option ${arg}`);
  }
  return options;
}

const USAGE = `open-steamgate conformance suite — the questions, over HTTP, against a base URL

  node test/conformance/run.mjs --base http://localhost:3030 [options]

  --base <url>          the host under test (default ${DEFAULT_BASE})
  --tags a,b            only cases carrying one of these tags
  --include-mutating    also run the cases that create, change and delete
  --json <file>         write the results as JSON
  --logon env           basic auth from OSD_SAP_USER / OSD_SAP_PASSWORD,
                        sap-client from OSD_SAP_CLIENT
  --list                print the cases and their tags, ask nothing

Tags: read mutating odata metadata query nav media valuehelp function sadl
      cds analytics status app icf adt error batch.
mutating is off unless asked for, and is never aimed at a system that is not ours.`;

export function table(results) {
  const width = Math.max(...results.map((r) => r.id.length), 2);
  const lines = results.map((r) =>
    `${r.ok ? "ok  " : "FAIL"} ${r.id.padEnd(width)}  ${r.name}` +
    (r.ok ? "" : "\n     " + " ".repeat(width) + "  -> " + r.problems.join("; ")));
  const failed = results.filter((r) => !r.ok).length;
  lines.push("", `${results.length - failed}/${results.length} passed` + (failed ? `, ${failed} failed` : ""));
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parse(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const {cases} = await import("./suite.mjs");
  const selected = select(cases, options);
  if (options.list) {
    for (const c of selected) console.log(`${c.id}\t[${c.tags.join(" ")}]\t${c.request.method} ${c.request.path}`);
    process.exit(0);
  }
  let logon;
  if (options.logon === "env") {
    logon = {user: process.env.OSD_SAP_USER, password: process.env.OSD_SAP_PASSWORD, client: process.env.OSD_SAP_CLIENT};
    if (!logon.user) {
      console.error("--logon env: OSD_SAP_USER is not set (credentials come from the environment, never from a file or the command line)");
      process.exit(2);
    }
  } else if (options.logon) {
    console.error(`--logon ${options.logon}: only "env" is supported`);
    process.exit(2);
  }
  console.log(`${selected.length} cases against ${options.base}` + (options.includeMutating ? " (including writes)" : ""));
  const results = await run(selected, {base: options.base, logon});
  console.log(table(results));
  if (options.json) {
    writeFileSync(options.json, JSON.stringify({base: options.base, at: new Date().toISOString(), results}, undefined, 2));
    console.log(`written to ${options.json}`);
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
