// The part of the extension that does not need VS Code: which ABAP object a
// file is, where an include of it lives, how to talk to a running osd, and
// what a unit run's answer means per method. Kept apart so a plain mocha
// test can hold it to the server's real shapes (test/vscode-extension.mjs).
"use strict";

const path = require("node:path");

// abapGit file names: `zcl_x.clas.abap`, `zcl_x.clas.testclasses.abap`,
// `zprog.prog.abap`; a namespace is `#ns#zcl_x`
const FILE = /^(.+?)\.(clas|prog)(?:\.(locals_def|locals_imp|macros|testclasses))?\.abap$/i;
const INCLUDE = {locals_def: "definitions", locals_imp: "implementations", macros: "macros", testclasses: "testclasses"};
const SUFFIX = Object.fromEntries(Object.entries(INCLUDE).map(([suffix, include]) => [include, suffix]));

// Same shape as FILE, plus interfaces: an interface has no ABAP Unit to run,
// so objectOf (above) deliberately does not know it, but Check and Activate
// (ADT's Ctrl+F2 / Ctrl+F3) apply to it too.
const ADT_FILE = /^(.+?)\.(clas|prog|intf)(?:\.(locals_def|locals_imp|macros|testclasses))?\.abap$/i;

// The ADT collection a type is served under (tools/osd-store.mjs TYPES,
// the `adt` column); only the three source types Ctrl+F2/Ctrl+F3 reach.
const ADT_COLLECTION = {CLAS: "oo/classes", INTF: "oo/interfaces", PROG: "programs/programs"};

/** `{type, name, base, include}` for a file that can carry ABAP Unit, else undefined. */
function objectOf(file) {
  const m = FILE.exec(path.basename(file));
  if (m === null) return undefined;
  return {
    type: m[2].toUpperCase(),
    name: m[1].replaceAll("#", "/").toUpperCase(),
    base: m[1].toLowerCase(),
    include: m[3] === undefined ? "main" : INCLUDE[m[3].toLowerCase()],
  };
}

/** `{type, name, base, include}` for a file Check or Activate can reach
 *  (a class, its includes, an interface, a program), else undefined. */
function adtObjectOf(file) {
  const m = ADT_FILE.exec(path.basename(file));
  if (m === null) return undefined;
  return {
    type: m[2].toUpperCase(),
    name: m[1].replaceAll("#", "/").toUpperCase(),
    base: m[1].toLowerCase(),
    include: m[3] === undefined ? "main" : INCLUDE[m[3].toLowerCase()],
  };
}

/** The object's own ADT URI (`/sap/bc/adt/...`), the one a checkObject or an
 *  objectReference names -- never an include's own path, which the façade's
 *  object lookup (adt-documents.mjs objectFromUri) does not parse. */
function uriOf(object) {
  const collection = ADT_COLLECTION[object.type];
  if (collection === undefined) throw new Error(`no ADT collection known for ${object.type}`);
  return `/sap/bc/adt/${collection}/${object.base}`;
}

/** The file of one include of an object, next to a file of the same object. */
function fileOf(dir, object, include) {
  const type = object.type.toLowerCase();
  const suffix = include === undefined || include === "main" ? "" : `.${SUFFIX[include] ?? include}`;
  return path.join(dir, `${object.base}.${type}${suffix}.abap`);
}

/** A client of one osd listener. The ADT façade wants a CSRF token and the
 *  session cookie it came with for anything that is not a read. */
class Osd {
  constructor(url, fetchImpl = globalThis.fetch) {
    this.url = String(url).replace(/\/+$/, "");
    this.fetch = fetchImpl;
    this.token = undefined;
    this.cookie = undefined;
  }

  async #csrf() {
    const res = await this.fetch(`${this.url}/sap/bc/adt/core/discovery`, {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
    if (res.status !== 200) throw new Error(`osd at ${this.url}: CSRF fetch answered ${res.status}`);
    this.token = res.headers.get("x-csrf-token") ?? undefined;
    const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    this.cookie = cookies.map((c) => c.split(";")[0]).join("; ") || undefined;
  }

  async request(route, options = {}) {
    const write = options.method !== undefined && options.method !== "GET" && options.method !== "HEAD";
    for (let attempt = 0; ; attempt++) {
      if (write && this.token === undefined) await this.#csrf();
      const headers = {...(options.headers ?? {})};
      if (write) {
        headers["x-csrf-token"] = this.token;
        if (this.cookie) headers.cookie = this.cookie;
      }
      const res = await this.fetch(this.url + route, {...options, headers});
      // a restarted listener forgets the token: fetch a new one once
      if (write && res.status === 403 && attempt === 0) {
        this.token = undefined;
        continue;
      }
      if (!res.ok) {
        const detail = (await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        throw new Error(`${options.method ?? "GET"} ${route}: HTTP ${res.status}${detail ? ` -- ${detail.slice(0, 300)}` : ""}`);
      }
      return res;
    }
  }

  async json(route, options) {
    return (await this.request(route, options)).json();
  }

  serving() {
    return this.json("/osd/serving");
  }

  dumps() {
    return this.json("/osd/dumps");
  }

  /** Test classes and methods of an object, without running anything. */
  discover(object) {
    return this.json(`/sap/bc/adt/core/http/unit/object?type=${encodeURIComponent(object.type)}&name=${encodeURIComponent(object.name)}`);
  }

  /** Which service and entity sets a SEGW _DPC_EXT class's own
   *  `<set>_get_entityset` / `<set>_get_entity` methods answer for
   *  (tools/adt-facade.mjs `core/http/segw/entitysets`). `undefined` on a
   *  404 (the class is not a registered service's DPC), an error on
   *  anything else -- the same distinction `run()`/`discover()` leave to
   *  their caller, made here because a CodeLensProvider asks this for
   *  every `.abap` file VS Code opens and "not a DPC_EXT" is not a fault. */
  async entitySets(className) {
    try {
      return await this.json(`/sap/bc/adt/core/http/segw/entitysets?class=${encodeURIComponent(className)}`);
    } catch (e) {
      if (/HTTP 404/.test(String(e.message ?? e))) return undefined;
      throw e;
    }
  }

  /** Q3 "Readers" (docs/vscode-extension.md): who references a CLAS or INTF
   *  (tools/adt-facade.mjs `core/http/xref/readers`): `{name, readers:
   *  [{type, name, include, isTest, services}], counts: {readers, tests,
   *  services}}`. `undefined` on a 404 (not a CLAS/INTF this store knows),
   *  an error on anything else -- the same shape `entitySets` above answers,
   *  for the same reason: a CodeLensProvider asks this for every
   *  class/interface file VS Code opens. */
  async readers(type, name) {
    try {
      return await this.json(`/sap/bc/adt/core/http/xref/readers?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`);
    } catch (e) {
      if (/HTTP 404/.test(String(e.message ?? e))) return undefined;
      throw e;
    }
  }

  /** Q2b "Runner": GET an OData v2 resource of a service this osd serves --
   *  `service` and `resource` joined as `/sap/opu/odata/sap/<service>/
   *  <resource>` -- timed and never throwing on a non-2xx answer, so a
   *  webview can show the status and the body's own error message instead
   *  of an exception: `{status, ms, url, body}`, `body` parsed from JSON
   *  when the answer is JSON, else `undefined` (the raw text stays in
   *  `text`). */
  async odata(service, resource) {
    const url = `/sap/opu/odata/sap/${service}/${resource}`;
    const startedAt = Date.now();
    const res = await this.fetch(this.url + url, {headers: {accept: "application/json"}});
    const ms = Date.now() - startedAt;
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return {status: res.status, ms, url, text, body};
  }

  /** Q6a "Notebook SQL" (docs/vscode-extension.md): run one SQL statement
   *  through the ADT façade's data preview (tools/adt-facade.mjs
   *  `datapreview/freestyle`, ~2358-2392): POST the statement as the
   *  body, `rowNumber` the row limit. The answer is XML, column-oriented
   *  (`tableDataDocument`, ~257-303) -- `freestyleRows` below turns it into
   *  `{columns, rows}`. Timed like `odata()` above; the generation the
   *  answer carries (`X-OSD-Generation`, set on every façade answer, see
   *  `router.use` near the top of `adtRouter`) rides along for the cell's
   *  own status line. Goes through `request()`, so a refused statement (not
   *  a SELECT, or a database never built) throws with the server's own
   *  `exceptionDocument` message, the same as `check()` / `activate()`
   *  above -- a notebook cell's error output is that message, unwrapped. */
  async freestyle(statement, rowLimit) {
    const startedAt = Date.now();
    const res = await this.request(`/sap/bc/adt/datapreview/freestyle?rowNumber=${encodeURIComponent(rowLimit)}`, {
      method: "POST",
      headers: {"content-type": "text/plain; charset=utf-8"},
      body: statement,
    });
    const ms = Date.now() - startedAt;
    const xml = await res.text();
    const generation = res.headers.get("x-osd-generation") ?? undefined;
    return {...freestyleRows(xml), ms, generation};
  }

  /** Run an object's tests, or one class, or one method of it. */
  run(object, testClass, method) {
    let route = `/sap/bc/adt/core/http/unit/object/run?type=${encodeURIComponent(object.type)}&name=${encodeURIComponent(object.name)}`;
    if (testClass) route += `&testClass=${encodeURIComponent(testClass)}`;
    if (method) route += `&method=${encodeURIComponent(method)}`;
    return this.json(route, {method: "POST"});
  }

  /** Ctrl+F2: check `source` (an editor's own buffer, not necessarily saved)
   *  as the given include of `object`, against the checkruns route
   *  (tools/adt-facade.mjs, `router.post(BASE/checkruns, ...)`). Sends the
   *  content inline, the way ADT checks what a person has typed rather than
   *  what is on disk. */
  async check(object, include, source) {
    const objectUri = uriOf(object);
    const artifactUri = include === undefined || include === "main"
      ? `${objectUri}/source/main`
      : `${objectUri}/includes/${include}/source/main`;
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core">
  <chkrun:checkObject adtcore:uri="${xmlEscape(objectUri)}" chkrun:version="active">
    <chkrun:artifacts>
      <chkrun:artifact chkrun:contentType="text/plain; charset=utf-8" chkrun:uri="${xmlEscape(artifactUri)}">
        <chkrun:content>${xmlEscape(source)}</chkrun:content>
      </chkrun:artifact>
    </chkrun:artifacts>
  </chkrun:checkObject>
</chkrun:checkObjectList>`;
    const res = await this.request("/sap/bc/adt/checkruns", {method: "POST", headers: {"content-type": "application/vnd.sap.adt.checkobjects+xml"}, body});
    return parseCheckReport(await res.text());
  }

  /** Ctrl+F3: activate `object` (tools/adt-facade.mjs, `router.post(BASE/activation,
   *  ...)`). Awaits the object's own build, so the generation on the answer
   *  is the one that already serves it -- `X-OSD-Generation` on every osd
   *  answer (docs/generations.md). */
  async activate(object) {
    const uri = uriOf(object);
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="${xmlEscape(uri)}" adtcore:name="${xmlEscape(object.name)}"/></adtcore:objectReferences>`;
    const res = await this.request("/sap/bc/adt/activation", {method: "POST", headers: {"content-type": "application/xml"}, body});
    const generation = res.headers.get("x-osd-generation") ?? undefined;
    return {...parseActivationResult(await res.text()), generation};
  }
}

// ---- the two documents above are XML, without a parser this project does
// not otherwise need; escape/unescape the five entities checkReportDocument
// and activationFailureDocument use (tools/adt-documents.mjs) and read the
// two shapes back with the same kind of pattern that wrote them.

function xmlEscape(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function xmlUnescape(text) {
  return String(text ?? "")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}

/** A checkRunReports document (tools/adt-documents.mjs checkReportDocument)
 *  into `[{uri, status, statusText, issues: [{line, column, severity, message}]}]`.
 *  A4H puts the position only in the message's own `chkrun:uri` fragment
 *  (`#start=line,column`), and this façade follows that shape. */
function parseCheckReport(xml) {
  const reports = [];
  const reportRe = /<chkrun:checkReport\b([^>]*?)(?:\/>|>([\s\S]*?)<\/chkrun:checkReport>)/g;
  for (const r of String(xml ?? "").matchAll(reportRe)) {
    const attrs = r[1];
    const uri = attrs.match(/chkrun:triggeringUri="([^"]*)"/)?.[1] ?? "";
    const status = attrs.match(/chkrun:status="([^"]*)"/)?.[1] ?? "processed";
    const statusText = xmlUnescape(attrs.match(/chkrun:statusText="([^"]*)"/)?.[1] ?? "");
    const issues = [];
    for (const m of String(r[2] ?? "").matchAll(/<chkrun:checkMessage\b([^>]*)\/>/g)) {
      const a = m[1];
      const messageUri = a.match(/chkrun:uri="([^"]*)"/)?.[1] ?? "";
      const [, line, column] = messageUri.match(/#start=(\d+),(\d+)/) ?? [, "1", "1"];
      issues.push({
        line: Number(line),
        column: Number(column),
        severity: a.match(/chkrun:type="([^"]*)"/)?.[1] ?? "E",
        message: xmlUnescape(a.match(/chkrun:shortText="([^"]*)"/)?.[1] ?? ""),
      });
    }
    reports.push({uri, status, statusText, issues});
  }
  return reports;
}

/** The activation route's answer (tools/adt-documents.mjs, activationSuccessDocument
 *  / activationFailureDocument) into `{ok, issues: [{line, column, message, objDescr}]}`.
 *  Both shapes are `chkl:messages`; only a clean activation carries
 *  `chkl:properties`, so its presence is the whole test. */
function parseActivationResult(xml) {
  const text = String(xml ?? "").trim();
  if (text === "" || text.includes("<chkl:properties")) {
    return {ok: true, issues: []};
  }
  const issues = [];
  for (const m of text.matchAll(/<msg:msg\b([^>]*)>([\s\S]*?)<\/msg:msg>/g)) {
    const attrs = m[1];
    const href = attrs.match(/href="([^"]*)"/)?.[1] ?? "";
    issues.push({
      line: Number(attrs.match(/line="([^"]*)"/)?.[1] ?? "1"),
      column: Number(href.match(/,(\d+)$/)?.[1] ?? "1"),
      objDescr: xmlUnescape(attrs.match(/objDescr="([^"]*)"/)?.[1] ?? ""),
      message: xmlUnescape(m[2].match(/<txt>([\s\S]*?)<\/txt>/)?.[1] ?? ""),
    });
  }
  return {ok: false, issues};
}

// ---- Q2b "Runner" (docs/vscode-extension.md, "Next"): call the entity set
// of a SEGW _DPC_EXT class's own `<set>_get_entityset` / `<set>_get_entity`
// method, from a CodeLens above it or from F8 inside it. The server names
// the class's service and its sets (tools/adt-facade.mjs `core/http/segw/
// entitysets`, tools/segw-entityset-map.mjs); everything here is the pure
// half -- where a lens goes over a source string, and which method (if any)
// a cursor line sits inside -- so a test holds it without VS Code or a
// server.

const ENTITYSET_METHOD_LINE = /^[ \t]*METHOD\s+(\w+)_get_entityset\s*\.[ \t]*$/i;
const ENTITY_METHOD_LINE = /^[ \t]*METHOD\s+(\w+)_get_entity\s*\.[ \t]*$/i;
const METHOD_LINE = /^[ \t]*METHOD\s+(\S+?)\s*\.[ \t]*$/i;
const ENDMETHOD_LINE = /^[ \t]*ENDMETHOD\s*\.[ \t]*$/i;

/** `[{line, method, kind}]`, one per `METHOD <set>_get_entityset.` /
 *  `METHOD <set>_get_entity.` line of `source` (1-based line numbers, the
 *  shape a `vscode.CodeLens`'s `Range` wants minus one) -- a plain text
 *  scan of the editor's own buffer, so a lens follows an unsaved edit the
 *  way the server's answer (by method name) cannot. */
function entitySetMethodLines(source) {
  const out = [];
  const lines = String(source ?? "").split(/\r\n|\r|\n/);
  lines.forEach((text, i) => {
    const entityset = ENTITYSET_METHOD_LINE.exec(text);
    if (entityset !== null) {
      out.push({line: i + 1, method: `${entityset[1]}_get_entityset`.toUpperCase(), kind: "get_entityset"});
      return;
    }
    const entity = ENTITY_METHOD_LINE.exec(text);
    if (entity !== null) {
      out.push({line: i + 1, method: `${entity[1]}_get_entity`.toUpperCase(), kind: "get_entity"});
    }
  });
  return out;
}

/** `entitySetMethodLines(source)` joined with the server's own map for the
 *  class (`{service, sets: [{method, kind, set}]}`, `core/http/segw/
 *  entitysets`) into what a CodeLens shows: `{line, kind, set, service,
 *  title}`. A method the server's map does not carry -- an override the
 *  MPC's own constants do not name -- gets no lens rather than a guessed
 *  one; `map` itself missing (the class is not a registered service's DPC)
 *  answers no lenses at all. */
function entitySetLenses(source, map) {
  if (map === undefined || !Array.isArray(map.sets)) return [];
  const bySets = new Map(map.sets.map((s) => [`${s.kind} ${s.method}`, s]));
  const out = [];
  for (const found of entitySetMethodLines(source)) {
    const known = bySets.get(`${found.kind} ${found.method}`);
    if (known === undefined) continue;
    out.push({line: found.line, kind: found.kind, set: known.set, service: map.service, title: `▶ Call ${known.set}`});
  }
  return out;
}

/** The method active at 0-based `line` of `source`: the name of the last
 *  `METHOD x.` seen up to and including that line, cleared by the
 *  `ENDMETHOD.` that closes it -- so F8 pressed on the `METHOD` line itself
 *  or anywhere in its body dispatches the same as a lens above it, and F8
 *  pressed between methods (or on a declaration, not an implementation)
 *  finds none. `undefined` outside any method. */
function methodAtLine(source, line) {
  const lines = String(source ?? "").split(/\r\n|\r|\n/);
  let current;
  for (let i = 0; i <= line && i < lines.length; i++) {
    const m = METHOD_LINE.exec(lines[i]);
    if (m !== null) {
      current = m[1].toUpperCase();
      continue;
    }
    if (ENDMETHOD_LINE.test(lines[i])) {
      current = undefined;
    }
  }
  return current;
}

/** OData v2 JSON's own rows: an entity set's `d.results`, a single entity's
 *  `d` itself, or `[]` when the body wears neither shape -- each row as the
 *  server sent it, `__metadata` and all (`stripMetadata` below strips it
 *  for display; `keyOf` below reads the key predicate out of it first). */
function resultRows(body) {
  const d = body?.d;
  if (Array.isArray(d?.results)) return d.results;
  if (d !== undefined) return [d];
  return [];
}

/** A row without `__metadata`: the columns a table shows. */
function stripMetadata(row) {
  const {__metadata, ...rest} = row ?? {};
  return rest;
}

/** The key predicate out of a row's own `__metadata.uri`
 *  (`.../TravelSet('T0001')` -> `'T0001'`, a composite key's
 *  `(TravelID='T0001',BookingID='0001')` unchanged) -- what the `_get_entity`
 *  lens's key prompt defaults to, read off the server's own answer rather
 *  than reconstructed from the entity type's key properties, which this
 *  client does not otherwise know. `undefined` when the row carries no
 *  `__metadata` (a service not built with `set_is_media` or a plain object). */
function keyOf(row) {
  const uri = row?.__metadata?.uri;
  if (typeof uri !== "string") return undefined;
  const m = /\(([^)]*)\)\s*$/.exec(uri);
  return m === null ? undefined : m[1];
}

// ---- F8, "Run", by object type (SE80's own dispatch). What this build
// already reaches stays concrete; every other type answers a `text`
// describing the server work its turn would add, so the table gets one
// entry filled in at a time rather than the same guess made twice. Kept as
// data (not a switch inside extension.js) so a test can hold every row to
// its planned action without VS Code.
const RUN_TABLE = {
  // a service's _DPC_EXT / _MPC_EXT: SE80's F8 there opens a client of the
  // service, not a debugger. Q2b (docs/vscode-extension.md) narrowed the
  // gap: the cursor inside a `<set>_get_entityset` / `<set>_get_entity`
  // method now does the same as that method's CodeLens -- extension.js
  // finds the method the cursor sits in (lib.js methodAtLine) and looks it
  // up in the server's own map (Osd#entitySets) before calling here, and
  // hands the answer in `ctx.entitySet`; everything else on such a class
  // still has no Gateway client to open.
  CLAS: (ctx) => {
    if (/_DPC_EXT$|_MPC_EXT$/i.test(ctx.name ?? "")) {
      if (ctx.entitySet !== undefined) {
        return {kind: "call-entityset", ...ctx.entitySet};
      }
      return {kind: "not-yet", text: "not yet: put the cursor inside a <set>_get_entityset or <set>_get_entity method (or click its CodeLens) -- the rest of a service's DPC_EXT / MPC_EXT still has no Gateway client"};
    }
    if (ctx.hasUnitTests) {
      return {kind: "unit"};
    }
    return {kind: "not-yet", text: "not yet: run as ABAP Application (Console) -- IF_OO_ADT_CLASSRUN has no server route yet (docs/adt-facade-shift-left.md: oo/classrun, not served today)"};
  },
  INTF: () => ({kind: "not-yet", text: "not yet: an interface has nothing of its own to run"}),
  PROG: () => ({kind: "not-yet", text: "not yet: run a report -- no server route to run one headlessly yet"}),
  FUGR: () => ({kind: "not-yet", text: "not yet: a test form from GET /sap/bc/osd/rfc/functions/<NAME>, then POST /call"}),
  TABL: () => ({kind: "not-yet", text: "not yet: data preview"}),
  DDLS: () => ({kind: "not-yet", text: "not yet: data preview"}),
  IWSV: () => ({kind: "not-yet", text: "not yet: the Gateway client on the service document"}),
  SICF: () => ({kind: "not-yet", text: "not yet: open the node's URL"}),
};

/** SE80's F8 for `object` (`{type, name}`), `ctx.hasUnitTests` told by the
 *  caller (it needs the file system osd/lib.js does not touch): `{kind:
 *  "unit"}` when this build can already run it, else `{kind: "not-yet",
 *  text}` naming the server work that would make it real. */
function runActionFor(object, ctx = {}) {
  const entry = RUN_TABLE[object?.type];
  if (entry === undefined) {
    return {kind: "not-yet", text: `not yet: ${object?.type ?? "this object"} has no F8 action`};
  }
  return entry({name: object?.name, ...ctx});
}

/** The first frame of an alert that points into an ABAP file: `{file, line, column}`. */
function abapFrame(alert) {
  for (const frame of alert.stack ?? []) {
    const file = String(frame.uri ?? frame.file ?? "");
    if (/\.abap$/i.test(file) && Number(frame.line) > 0) {
      return {file: path.basename(file), line: Number(frame.line), column: Number(frame.column ?? 1)};
    }
  }
  return undefined;
}

/** One entry per method a run answered for: `{testClass, method, passed, ms,
 *  alerts: [{title, details, frame}]}`. An alert on the class with no methods
 *  (a failing class_setup) marks every method it was asked to run. */
function outcomes(run, asked = []) {
  const out = [];
  const shape = (alert) => ({title: alert.title ?? alert.kind ?? "failed", details: alert.details ?? [], frame: abapFrame(alert)});
  for (const testClass of run.testClasses ?? []) {
    const classAlerts = (testClass.alerts ?? []).map(shape);
    const methods = testClass.testMethods ?? [];
    if (methods.length === 0 && classAlerts.length > 0) {
      for (const a of asked.filter((x) => x.testClass === testClass.name)) {
        out.push({testClass: testClass.name, method: a.method, passed: false, ms: 0, alerts: classAlerts});
      }
    }
    for (const m of methods) {
      const alerts = [...classAlerts, ...(m.alerts ?? []).map(shape)];
      out.push({testClass: testClass.name, method: m.name, passed: alerts.length === 0, ms: Number(m.ms ?? 0), alerts});
    }
  }
  return out;
}

// ---- Q3 "Readers" (docs/vscode-extension.md, "Next"): a CodeLens "read by N
// · tests M · services K" over a class's own `CLASS <name> DEFINITION` line
// or an interface's own `INTERFACE <name>` line, off the server's own
// where-used answer (tools/adt-facade.mjs `core/http/xref/readers`). As with
// Q2b, the placement is a plain text scan of the editor's own buffer (so an
// unsaved rename of the class does not still show the old line) and the
// server is asked by the object's name, not guessed from the file.

/** The 1-based line of `object`'s own `CLASS <name> DEFINITION` /
 *  `INTERFACE <name>` statement in `source`, or undefined when `object` is
 *  not a CLAS/INTF or that line is not in `source` (an include other than
 *  the main one, or a name the file does not actually declare). */
function readersLensLine(source, object) {
  if (object === undefined || (object.type !== "CLAS" && object.type !== "INTF")) return undefined;
  const escaped = String(object.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = object.type === "CLAS"
    ? new RegExp(`^[ \\t]*CLASS\\s+${escaped}\\s+DEFINITION\\b`, "i")
    : new RegExp(`^[ \\t]*INTERFACE\\s+${escaped}\\b`, "i");
  const lines = String(source ?? "").split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i + 1;
  }
  return undefined;
}

/** "read by N · tests M · services K" -- the lens title, off the server's
 *  own `counts` (`core/http/xref/readers`'s `counts.readers/tests/services`). */
function readersLensTitle(counts) {
  return `read by ${counts?.readers ?? 0} · tests ${counts?.tests ?? 0} · services ${counts?.services ?? 0}`;
}

/** The quick pick a click on the lens shows: one item per reader
 *  (`core/http/xref/readers`'s own `readers`), sorted the way the server
 *  already sorted them, Test / Service named in the description so a person
 *  can tell the two counts in the lens apart from the list rather than only
 *  from the number. Each item carries its own `reader` back, for opening. */
function readersQuickPickItems(readers) {
  return (readers ?? []).map((reader) => {
    const tags = [];
    if (reader.isTest) tags.push("Test");
    if ((reader.services ?? []).length > 0) tags.push(`Service (${reader.services.join(", ")})`);
    return {
      label: reader.name,
      description: [reader.type, ...tags].join(" · "),
      reader,
    };
  });
}

// ---- Q6a "Notebook SQL" (docs/vscode-extension.md): a *.osdnb notebook of
// SQL cells, run against `Osd#freestyle` above. The pure half: the
// column-oriented XML that route answers turned into rows, the rows turned
// into the HTML a cell's output shows (escaped, so a cell value carrying
// `<` or `&` -- an XML fragment sitting in a CHAR column, say -- renders as
// text and not markup), and the notebook file's own JSON turned into cells
// and back. None of this touches `vscode`, so a plain mocha test holds it
// without a notebook editor open (test/vscode-extension.mjs); extension.js's
// NotebookSerializer and NotebookController are the thin wrapping.

/** Escape for HTML text content (not an attribute): the notebook output's
 *  own `<td>`/`<th>` cells go through this, the same three entities
 *  `entitySetHtml`'s `xmlEscapeHtml` (extension.js, Q2b) escapes -- kept
 *  here rather than there because a mocha test needs it without `vscode`. */
function htmlEscape(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** freestyle SQL's own answer (tools/adt-facade.mjs `tableDataDocument`,
 *  ~257-303: one `<dataPreview:columns>` per selected column, each with its
 *  own `dataPreview:metadata dataPreview:name="..."` and a `dataPreview:
 *  dataSet` of one `<dataPreview:data>` per row, in row order) into
 *  `{columns, rows}` -- `columns` the names in the server's own order,
 *  `rows` one plain object per row keyed by column name, so a JSON output
 *  and an HTML table can both be built off the same shape `resultRows` /
 *  `stripMetadata` above give the OData side. A column with fewer
 *  `<dataPreview:data>` than the widest one (should not happen -- every
 *  column carries exactly one value per row) pads the short rows with "".*/
function freestyleRows(xml) {
  const columns = [];
  const values = [];
  const colRe = /<dataPreview:columns>([\s\S]*?)<\/dataPreview:columns>/g;
  for (const m of String(xml ?? "").matchAll(colRe)) {
    const block = m[1];
    columns.push(xmlUnescape(block.match(/dataPreview:name="([^"]*)"/)?.[1] ?? ""));
    const cells = [];
    for (const d of block.matchAll(/<dataPreview:data>([\s\S]*?)<\/dataPreview:data>/g)) {
      cells.push(xmlUnescape(d[1]));
    }
    values.push(cells);
  }
  const rowCount = values.reduce((max, v) => Math.max(max, v.length), 0);
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    const row = {};
    columns.forEach((name, ci) => { row[name] = values[ci][i] ?? ""; });
    rows.push(row);
  }
  return {columns, rows};
}

/** The HTML a run cell's output shows: `columns`/`rows` (`freestyleRows`
 *  above) as a table, and the status line Q6a asks for -- "N rows · M ms ·
 *  <generation>", the generation truncated the same way the status bar and
 *  Ctrl+F3 truncate it (`serving.generation.slice(0, 8)` / `result.
 *  generation.slice(0, 8)`, extension.js). `meta.generation` missing (an
 *  answer with no `X-OSD-Generation`, which should not happen against a
 *  real façade but is not this function's business to assume) leaves that
 *  segment off rather than showing "undefined". */
function freestyleTableHtml(columns, rows, meta = {}) {
  const thead = columns.map((c) => `<th>${htmlEscape(c)}</th>`).join("");
  const tbody = rows.map((row) => `<tr>${columns.map((c) => `<td>${htmlEscape(row[c])}</td>`).join("")}</tr>`).join("");
  const generation = meta.generation === undefined ? undefined : String(meta.generation).slice(0, 8);
  const status = `${rows.length} row${rows.length === 1 ? "" : "s"} · ${meta.ms ?? 0} ms${generation === undefined ? "" : ` · ${generation}`}`;
  return `<div class="osd-sql-result">
<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
<div class="osd-sql-status">${htmlEscape(status)}</div>
</div>`;
}

/** A *.osdnb file's own JSON (`{cells: [{kind: "code"|"markdown", value,
 *  language?}]}`) into `[{kind, language, value}]` -- close to `vscode.
 *  NotebookData`'s own cells but without the `vscode` module, so
 *  `NotebookSerializer#deserializeNotebook` and a mocha test both go
 *  through this. A `kind: "code"` cell with no `language` defaults to
 *  "sql" (the only kernel this extension registers); a bad or missing
 *  `cells` array reads as no cells rather than throwing, the way an empty
 *  notebook opens instead of refusing to. */
function notebookFromJson(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    doc = undefined;
  }
  const cells = Array.isArray(doc?.cells) ? doc.cells : [];
  return cells.map((c) => (c?.kind === "markdown"
    ? {kind: "markdown", language: "markdown", value: String(c.value ?? "")}
    : {kind: "code", language: String(c?.language ?? "sql"), value: String(c?.value ?? "")}));
}

/** The reverse of `notebookFromJson`: `[{kind, language, value}]` (what
 *  `NotebookSerializer#serializeNotebook` reads off `vscode.NotebookData`'s
 *  own cells) into the file's own JSON text, newline-terminated so a saved
 *  `*.osdnb` diffs cleanly. A markdown cell carries no `language` back out
 *  (its kind already says what it is); a code cell's language is written
 *  even when it is "sql", so a notebook this wrote round-trips byte for
 *  byte through `notebookFromJson`. */
function notebookToJson(cells) {
  const doc = {
    cells: (cells ?? []).map((c) => (c.kind === "markdown"
      ? {kind: "markdown", value: c.value}
      : {kind: "code", language: c.language ?? "sql", value: c.value})),
  };
  return `${JSON.stringify(doc, undefined, 2)}\n`;
}

// abapGit's own extension per object type, so a reader's file can be found
// without guessing at what generated it; a type this extension has no file
// shape for (FUGR, TABL, DDLS, ...) opens nothing rather than a wrong guess
const READER_EXTENSION = {CLAS: "clas", INTF: "intf", PROG: "prog"};

/** The glob `vscode.workspace.findFiles` matches for `reader`'s own file
 *  (`**\/<base>.<ext>.abap`, the namespace-to-`#` mapping `objectOf` above
 *  reads back), or undefined for a type with no such file. */
function readerFilePattern(reader) {
  const ext = READER_EXTENSION[reader?.type];
  if (ext === undefined) return undefined;
  const base = String(reader.name).replaceAll("/", "#").toLowerCase();
  return `**/${base}.${ext}.abap`;
}

module.exports = {objectOf, adtObjectOf, uriOf, fileOf, Osd, abapFrame, outcomes, parseCheckReport, parseActivationResult, runActionFor,
  entitySetMethodLines, entitySetLenses, methodAtLine, resultRows, stripMetadata, keyOf,
  readersLensLine, readersLensTitle, readersQuickPickItems, readerFilePattern,
  htmlEscape, freestyleRows, freestyleTableHtml, notebookFromJson, notebookToJson};
