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

  /** Q7 "F8 on a table or a CDS view" (docs/vscode-extension.md): the
   *  façade's own datapreview/ddic (kind "TABL") or datapreview/cds (kind
   *  "DDLS") route -- the same door ADT's own Data Preview uses, and the
   *  one that already carries a DDIC field's label (tableDataDocument's
   *  own dataPreview:description) and resolves a DDLS's own name the way
   *  tools/adt-cds.mjs cdsEntityOf does, so this client hands it the CDS
   *  entity's own name and never has to know its @AbapCatalog.sqlViewName.
   *  `statement` is the SQL to run (lib.js dataPreviewQuery below); the
   *  façade runs it as written, the same as freestyle() above. Timed and
   *  carries the generation the same way; goes through request(), so a
   *  name the store does not have throws with the façade's own message (a
   *  404 naming the object, not swallowed into a client-side guess) and a
   *  name it has but the database does not (an unsupported CDS join,
   *  tools/cds2ddic.mjs's own skip) throws with the SQL engine's own
   *  refusal -- neither reads as silently empty rows. */
  async dataPreview(kind, name, statement, rowLimit) {
    const route = kind === "DDLS" ? "cds" : "ddic";
    const param = kind === "DDLS" ? "ddlSourceName" : "ddicEntityName";
    const startedAt = Date.now();
    const res = await this.request(
      `/sap/bc/adt/datapreview/${route}?${param}=${encodeURIComponent(name)}&rowNumber=${encodeURIComponent(rowLimit)}`,
      {method: "POST", headers: {"content-type": "text/plain; charset=utf-8"}, body: statement},
    );
    const ms = Date.now() - startedAt;
    const xml = await res.text();
    const generation = res.headers.get("x-osd-generation") ?? undefined;
    return {...dataPreviewRows(xml), ms, generation};
  }

  /** Q6b "Classrun" (docs/vscode-extension.md): F9, "Run as ABAP Application
   *  (Console)" -- POST tools/adt-facade.mjs `oo/classrun/<name>` with no
   *  body, text/plain back: everything the class wrote through
   *  `out->write( )`, or a trace after it if it dumped (still a 200, the
   *  way ADT's own console shows a partial run). `request()` still throws
   *  on an actual HTTP error -- not found, or a class that does not
   *  implement IF_OO_ADT_CLASSRUN -- which is the caller's to catch, the
   *  same distinction `entitySets()` / `readers()` above draw. Timed and
   *  carries the generation like `freestyle()` above. */
  async classrun(className) {
    const startedAt = Date.now();
    const res = await this.request(`/sap/bc/adt/oo/classrun/${encodeURIComponent(className)}`, {
      method: "POST",
      headers: {accept: "text/plain"},
    });
    const ms = Date.now() - startedAt;
    const text = await res.text();
    const generation = res.headers.get("x-osd-generation") ?? undefined;
    return {text, ms, generation};
  }

  /** Q4 "Hotspots" (docs/vscode-extension.md): counts per (object, line)
   *  and per object off ZOSD_DUMP -- the table tools/osd-dumps.mjs writes
   *  after a request's own rollback (tools/osd-serve.mjs `dump()`). No new
   *  route: this is `freestyle()` above with HOTSPOTS_SQL, the same door
   *  Q6a's notebook runs a cell through. `hotspotsFromRows` (below) does the
   *  rows-to-maps half, so a test can hold it to a canned answer without a
   *  server. A table the SQL door refuses (not built yet) reads as no
   *  hotspots rather than an error a status-bar timer would have to filter. */
  async hotspots(rowLimit = 1000) {
    try {
      const result = await this.freestyle(HOTSPOTS_SQL, rowLimit);
      return hotspotsFromRows(result.rows);
    } catch (e) {
      if (/no such table/i.test(String(e.message ?? e))) return {byLine: [], byFile: {}};
      throw e;
    }
  }

  /** Services tree (docs/vscode-extension.md, "Services tree"): every row
   *  this osd serves, normalized (lib.js `normalizeServiceRow` /
   *  `normalizeServiceSetRow` above) whichever of the two sources
   *  answered. Tries the composing route first (docs/ideas.md T8, `GET
   *  core/http/services`) and falls back to ZOSD_STATUS_SRV's own
   *  ServiceSet on a 404 -- the route did not exist on `main` when this
   *  was written (open PR, feat/services-tree), so this client works
   *  against both a system that already carries it and one that does
   *  not, with no flag to set either way. Any other error (osd down, a
   *  malformed answer) is the caller's to catch, the same as every other
   *  method here. */
  async services() {
    try {
      const body = await this.json("/sap/bc/adt/core/http/services");
      return (body?.services ?? []).map(normalizeServiceRow);
    } catch (e) {
      if (!/HTTP 404/.test(String(e.message ?? e))) throw e;
    }
    const res = await this.fetch(`${this.url}/sap/opu/odata/sap/ZOSD_STATUS_SRV/ServiceSet?$format=json`);
    if (!res.ok) throw new Error(`GET ZOSD_STATUS_SRV/ServiceSet: HTTP ${res.status}`);
    const body = await res.json();
    return (body?.d?.results ?? []).map(normalizeServiceSetRow);
  }

  /** Run an object's tests, or one class, or one method of it.
   *
   *  `dbEnv` (docs/vscode-extension.md, "Databases"; the shape
   *  editors/vscode/launcher.js's `databaseEnv` builds) runs THIS request's
   *  tests on a different database than the server's own -- `undefined`
   *  (the default) sends no body at all, and the façade route runs the
   *  test in its usual throwaway SQLite file, unchanged. Sent in the body,
   *  never the query string: it may carry a password, and a query string
   *  ends up in server logs where a body does not. */
  run(object, testClass, method, dbEnv) {
    let route = `/sap/bc/adt/core/http/unit/object/run?type=${encodeURIComponent(object.type)}&name=${encodeURIComponent(object.name)}`;
    if (testClass) route += `&testClass=${encodeURIComponent(testClass)}`;
    if (method) route += `&method=${encodeURIComponent(method)}`;
    const options = {method: "POST"};
    if (dbEnv !== undefined) {
      options.headers = {"content-type": "application/json"};
      options.body = JSON.stringify({dbEnv});
    }
    return this.json(route, options);
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

/** Q6b "Classrun": does this class's own source declare `INTERFACES
 *  if_oo_adt_classrun`? The same test tools/osd-classrun.mjs runs against
 *  the tracked file server-side; here it decides F8's dispatch (RUN_TABLE.CLAS)
 *  off the buffer VS Code already has open, not necessarily saved -- the
 *  same "the editor's own text, not the file" Ctrl+F2's check() already
 *  works this way. */
function implementsClassrun(source) {
  return /^\s*INTERFACES\s+if_oo_adt_classrun\b/im.test(String(source ?? ""));
}

/** the transaction code tools/osd-gui-convert.mjs wires a converted report
 *  under: `ZGUI_<base>`, base being the program name with a leading Z
 *  stripped -- namesOf() there, kept in step by test/vscode-extension.mjs
 *  rather than by a shared module (see the RUN_TABLE.PROG comment below). */
function progTcodeOf(programName) {
  const base = String(programName ?? "").replace(/^Z/i, "").toUpperCase();
  return base === "" ? undefined : `ZGUI_${base}`;
}

/** `{line, tcode, title}` for the CodeLens above a *.prog.abap's own
 *  `REPORT` statement (1-based line, VS Code's own convention for a
 *  Range), or `undefined` for a program with no `REPORT` line at all (an
 *  include) -- the "Open in VS Code" symmetric to F8 (RUN_TABLE.PROG),
 *  placed once at parse time rather than asked for on every keypress. */
function progRunLens(source, programName) {
  const tcode = progTcodeOf(programName);
  if (tcode === undefined) return undefined;
  const lines = String(source ?? "").split(/\r\n|\r|\n/);
  const at = lines.findIndex((line) => /^\s*REPORT\b/i.test(line));
  if (at < 0) return undefined;
  return {line: at + 1, tcode, title: `▶ Run in Easy Access (${tcode})`};
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
    // Q6b (docs/vscode-extension.md): a class with no tests that declares
    // IF_OO_ADT_CLASSRUN runs as a console (oo/classrun, tools/adt-facade.mjs)
    // -- ADT's own F9. `ctx.hasClassrun` is `implementsClassrun` below, run
    // by the caller against the editor's buffer, the same way `ctx.hasUnitTests`
    // is a file-system fact the caller supplies because lib.js touches
    // neither.
    if (ctx.hasClassrun) {
      return {kind: "classrun"};
    }
    return {kind: "not-yet", text: "not yet: run as ABAP Application (Console) -- put IF_OO_ADT_CLASSRUN on this class (or give it ABAP Unit tests) for F8/F9 to do something"};
  },
  INTF: () => ({kind: "not-yet", text: "not yet: an interface has nothing of its own to run"}),
  // gui-reports spike (docs/gui-reports.md): a report converted by
  // tools/osd-gui-convert.mjs is wired as a transaction named ZGUI_<base>,
  // the same naming the generator uses (namesOf there, progTcodeOf here --
  // duplicated on purpose rather than shared, since one is a build tool and
  // the other ships inside the extension; test/vscode-extension.mjs holds
  // them to the same answer for the three examples). F8 does not ask the
  // server whether that transaction exists: it opens webgui at the code
  // either way, and an unconverted report gets the same "Transaction ...
  // does not exist" the real Easy Access screen would show, in the webview
  // rather than in a dialog -- one fact, wherever it is read.
  PROG: (ctx) => {
    const tcode = progTcodeOf(ctx.name);
    if (tcode === undefined) {
      return {kind: "not-yet", text: "not yet: run a report -- no server route to run one headlessly yet"};
    }
    return {kind: "webgui", tcode};
  },
  FUGR: () => ({kind: "not-yet", text: "not yet: a test form from GET /sap/bc/osd/rfc/functions/<NAME>, then POST /call"}),
  // Q7 (docs/vscode-extension.md): F8's data preview -- the façade's own
  // datapreview/ddic (TABL) or datapreview/cds (DDLS) route, the same one
  // ADT's own Data Preview uses. It resolves the name, and for a DDLS the
  // twin view a CDS entity's own name reaches (tools/adt-cds.mjs
  // cdsEntityOf) -- nothing here guesses a @AbapCatalog.sqlViewName.
  // extension.js's openDataPreview does the rest; `ctx.name` is the file's
  // own name (dataPreviewObjectOf below), not read off adtObjectOf, which
  // knows neither type.
  TABL: (ctx) => ({kind: "data-preview", objectType: "TABL", name: ctx.name}),
  DDLS: (ctx) => ({kind: "data-preview", objectType: "DDLS", name: ctx.name}),
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

// ---- Q7 "F8 on a table or a CDS view" (docs/vscode-extension.md): the
// rows the façade's own datapreview/ddic (a TABL) or datapreview/cds (a
// DDLS) route answers, filtered to the runtime's own client the way a
// real system's SADL would for a CDS view and Open SQL would not for a
// plain SELECT (CLAUDE.md "Known traps": no implicit MANDT). Every
// function here is pure -- extension.js's openDataPreview is the thin
// wrapping, the same split Q2b/Q3/Q6a already use.

const DATAPREVIEW_TABL_FILE = /^(.+?)\.tabl\.xml$/i;
const DATAPREVIEW_DDLS_FILE = /^(.+?)\.ddls\.(?:asddls|xml)$/i;

/** `{type, name}` for a file F8's data preview reaches: a TABL's own
 *  `<table>.tabl.xml`, or a DDLS's `<view>.ddls.asddls` / its `.ddls.xml`
 *  twin -- else undefined. adtObjectOf (above) does not know either type
 *  (Check/Activate do not reach them), so `run()` asks this instead. The
 *  name is the file's own base, upper-cased and namespace-mapped the same
 *  way objectOf's is: for a TABL, the table the database has; for a DDLS,
 *  the CDS entity's own name -- what tools/adt-cds.mjs cdsEntityOf and the
 *  façade's datapreview/cds route resolve by, not the view's own
 *  @AbapCatalog.sqlViewName, which this file never has to know. */
function dataPreviewObjectOf(file) {
  const base = path.basename(String(file ?? ""));
  const tabl = DATAPREVIEW_TABL_FILE.exec(base);
  if (tabl !== null) return {type: "TABL", name: tabl[1].replaceAll("#", "/").toUpperCase()};
  const ddls = DATAPREVIEW_DDLS_FILE.exec(base);
  if (ddls !== null) return {type: "DDLS", name: ddls[1].replaceAll("#", "/").toUpperCase()};
  return undefined;
}

/** Whether a TABL's own abapGit XML (the file F8's data preview reads,
 *  not necessarily saved -- the same "the buffer, not the file" rule
 *  Ctrl+F2's check and Q6b's implementsClassrun already follow) carries a
 *  MANDT field: a plain scan of its DD03P rows. A DDLS never reaches
 *  this -- the CDS-name view tools/cds2ddic.mjs writes for one has no
 *  MANDT column at all ("the CDS entity itself has no client... as on a
 *  system", that file's own viewFieldsOf), so there is no column there to
 *  filter by or to show. */
function tablHasMandt(xmlSource) {
  return /<FIELDNAME>MANDT<\/FIELDNAME>/i.test(String(xmlSource ?? ""));
}

// The runtime's own sy-mandt is fixed at 123 (tools/osd-identity.mjs
// DEFAULT_CLIENT) -- and deliberately not the client the ADT façade itself
// presents (identity().adt.client, "001", backlog G.1b: the façade's own
// pretend system is allowed to differ from the data's own). Reading the
// façade's client here would filter for the wrong one, so this is the
// fixed constant CLAUDE.md's "Known traps" already names, with the reason
// it is not read off the server instead.
const MANDT_CLIENT = "123";

/** The SQL a data-preview cell runs for `name` (dataPreviewObjectOf's own
 *  shape): the whole object, filtered to MANDT_CLIENT when `hasMandt` and
 *  not `allClients`. A DDLS caller always passes `hasMandt: false`
 *  (tablHasMandt above never applies to one), so this never files a WHERE
 *  MANDT a CDS-name view has no column to satisfy. */
function dataPreviewQuery(name, {hasMandt = false, allClients = false} = {}) {
  return hasMandt && !allClients ? `SELECT * FROM ${name} WHERE MANDT = '${MANDT_CLIENT}'` : `SELECT * FROM ${name}`;
}

/** The same query, as a row count -- run separately and only when the main
 *  fetch came back exactly at the row cap (dataPreviewStatusText below),
 *  because a COUNT(*) is the one query this feature asks the door for
 *  twice rather than once. */
function dataPreviewCountQuery(name, options) {
  return dataPreviewQuery(name, options).replace(/^SELECT \*/, "SELECT COUNT(*) AS N");
}

/** "N rows" when the cap was not reached; "first N of M" once it was and a
 *  cheap COUNT (dataPreviewCountQuery above) answered `total`; "first N
 *  rows" when it was reached and no count was asked for (or it failed) --
 *  a guessed total is worse than none. */
function dataPreviewStatusText(shown, rowLimit, total) {
  if (shown < rowLimit) return `${shown} row${shown === 1 ? "" : "s"}`;
  if (total === undefined) return `first ${shown} rows`;
  return `first ${shown} of ${total}`;
}

/** F8's data preview XML (tools/adt-facade.mjs tableDataDocument -- the
 *  same document shape freestyleRows above reads) into `{columns: [{name,
 *  label, key}], rows}`, `rows` shaped like freestyleRows' own. Unlike
 *  plain freestyle, datapreview/ddic and datapreview/cds carry each
 *  column's own DDIC label in dataPreview:description and whether it is a
 *  key in dataPreview:keyAttribute -- read here rather than duplicating
 *  freestyleRows' own row extraction. A column the façade did not
 *  recognise (its own fallback metadata, name.toUpperCase() again) keeps
 *  its bare name as the label rather than showing blank. */
function dataPreviewRows(xml) {
  const {columns: names, rows} = freestyleRows(xml);
  const meta = new Map();
  const metaRe = /<dataPreview:metadata\s+dataPreview:name="([^"]*)"([^>]*)\/>/g;
  for (const m of String(xml ?? "").matchAll(metaRe)) {
    const name = xmlUnescape(m[1]);
    const label = xmlUnescape(m[2].match(/dataPreview:description="([^"]*)"/)?.[1] ?? "");
    const key = m[2].match(/dataPreview:keyAttribute="([^"]*)"/)?.[1] === "true";
    meta.set(name, {label: label || name, key});
  }
  const columns = names.map((name) => ({name, label: meta.get(name)?.label ?? name, key: meta.get(name)?.key === true}));
  return {columns, rows};
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

// ---- Q4 "Hotspots": ZOSD_DUMP as line and file heat (docs/vscode-extension.md).
// The SQL is the whole server side of this -- no new route, the freestyle
// door above runs it -- so it lives here where a test can hold it and the
// rows-to-maps reduction to the server's real column names.

/** One dump count per (object, line), the last time and message with it
 *  (a correlated subquery rather than a second round trip): the line's own
 *  hover text is built off the same row the count came from. GROUP BY
 *  "include" too -- a class carries more than one file (main, locals,
 *  testclasses), and two of them can share a line number.
 *
 *  The subquery's own `LIMIT 1` makes `Data#query` (tools/osd-data.mjs)
 *  see this statement as already carrying a LIMIT and leave the outer one
 *  off -- so `hotspots()`'s own `rowLimit` does not bound this query. Left
 *  as is: the result is one row per distinct (object, include, line), which
 *  ZOSD_DUMP's own cap (tools/osd-dumps.mjs, 1000 rows) already bounds. */
const HOTSPOTS_SQL = `SELECT objname, "include", line, COUNT(*) AS n, MAX(created_at) AS last_at,
  (SELECT message FROM zosd_dump z2 WHERE z2.objname = z.objname AND z2."include" = z."include"
    AND z2.line = z.line ORDER BY z2.dump_id DESC LIMIT 1) AS last_message
FROM zosd_dump z
WHERE objname <> ''
GROUP BY objname, "include", line
ORDER BY n DESC`;

/** HOTSPOTS_SQL's own rows (freestyleRows' shape: every value a string,
 *  every key upper-case -- `tableDataDocument`, tools/adt-facade.mjs,
 *  writes `dataPreview:name` as `name.toUpperCase()` regardless of how the
 *  SQL cased it, so a lower-case column read here would silently see
 *  `undefined` against the real door and only against it, never against a
 *  hand-built fixture that happened to keep the SQL's own case) into
 *  `{byLine: [{objname, include, line, count, lastAt, lastMessage}],
 *  byFile: {OBJNAME: count}}`. A row with no object name or no usable line
 *  number is dropped rather than guessed at -- ZOSD_DUMP.LINE is INT4, so
 *  that only happens against a table this SQL was not written for. */
function hotspotsFromRows(rows) {
  const byLine = [];
  const byFile = {};
  for (const raw of rows ?? []) {
    const row = Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const objname = String(row.objname ?? "").trim();
    const line = Number(row.line);
    const count = Number(row.n ?? 0);
    if (objname === "" || !Number.isFinite(line) || line <= 0 || count <= 0) continue;
    byLine.push({
      objname, include: String(row.include ?? "main").trim() || "main", line, count,
      lastAt: Number(row.last_at ?? 0), lastMessage: String(row.last_message ?? ""),
    });
    byFile[objname] = (byFile[objname] ?? 0) + count;
  }
  return {byLine, byFile};
}

/** count -> intensity bucket, 1 (one dump) to 4 (heaviest): a fixed few
 *  steps rather than a scale fitted to whatever counts happen to be open,
 *  so a file with one hotspot and a file with a thousand read the same way
 *  from one editor to the next. */
function hotspotBucket(count) {
  if (count >= 10) return 4;
  if (count >= 5) return 3;
  if (count >= 2) return 2;
  return 1;
}

// translucent red over whatever the editor's own background is, rather
// than a fixed hex: a colour the theme already chose stays the theme's, in
// light mode and in dark, and the tint is what carries the heat
const HOTSPOT_ALPHA = {1: 0.12, 2: 0.22, 3: 0.35, 4: 0.5};

/** The decoration background for a bucket (1-4, hotspotBucket's own range):
 *  an rgba string, translucent over either theme rather than a colour of
 *  its own. */
function hotspotColor(bucket) {
  return `rgba(255, 0, 0, ${HOTSPOT_ALPHA[bucket] ?? HOTSPOT_ALPHA[1]})`;
}

/** A FileDecoration badge for `count`: VS Code keeps at most two characters
 *  of it, so ten or more reads as "9+" rather than being cut to "1" of "10". */
function hotspotBadge(count) {
  return count > 9 ? "9+" : String(count);
}

/** The hover text for one line's entry (a `byLine` row, above): "N dumps,
 *  last <ISO time>: <message>". `lastAt` of 0 (should not happen once a
 *  dump has been written; a defensive read of a row this function did not
 *  itself produce) reads as "an unknown time" rather than the 1970 epoch. */
function hotspotHoverText(entry) {
  const when = entry.lastAt > 0 ? new Date(entry.lastAt).toISOString() : "an unknown time";
  return `${entry.count} dump${entry.count === 1 ? "" : "s"}, last ${when}: ${entry.lastMessage || "(no message)"}`;
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

// ---- Test Explorer grouping (docs/vscode-extension.md, "Test Explorer
// groups"): today every `*.clas.testclasses.abap` this extension finds
// becomes one flat sibling, project classes next to CL_ABAP_* and
// /UI2/CL_JSON from open-abap-core under .local/lars/. This section is the
// pure half of splitting that into Project / Packs / Workspace layers /
// System: which of the four a file's own path falls under, and -- once a
// group holds more than a handful of classes -- which package inside it.
// extension.js's testExplorer() is the thin wrapping: it walks
// abap_transpile.json into transpileLayers() once, calls classifyTestPath()
// per file findFiles() turns up, and builds the group/subgroup TestItems
// around the object items this file already knew how to build (unchanged,
// same ids, so a run's history still matches them).

/** `abap_transpile.json`'s own `input_folder` and `libs` turned into what
 *  classifyTestPath() below reads: the folders that are the Project (every
 *  `input_folder` entry that is not also a lib's own folder -- none are,
 *  today, but a future lib pointed at `src` should still not double as
 *  Project) and, per lib, its `name` (the folder's own last path segment --
 *  "open-abap-core", not the folder or the `url`) and its `folder`
 *  (leading/trailing slashes trimmed, so it compares one way against a
 *  relative path built by relOf() below). `config` is the parsed JSON
 *  itself, not a path -- a test holds this to the real file's own content,
 *  and extension.js reads it off disk.
 *
 *  `excludeFilter` (top-level) and each lib's own `excludeFilter` are the
 *  build's own `exclude_filter` lists (tools/osd-inputs.mjs / osd-build.mjs,
 *  tools/osd-transpile.mjs `regexps()`), read the same way -- case-
 *  insensitively, unanchored -- so a file the build itself would never read
 *  or serve (`test/fixtures/`, a lib's own `/src/tcp/`) is not listed in the
 *  Test Explorer either (classifyTestPath() below applies them). A pack has
 *  no `exclude_filter` of its own: it is layered into `input_folder` at
 *  build time and the top-level list already covers it. */
function transpileLayers(config) {
  const libs = (config?.libs ?? []).map((lib) => {
    const folder = String(lib.folder ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
    const name = folder.split("/").filter(Boolean).pop() ?? folder;
    const excludeFilter = (lib.exclude_filter ?? []).map((p) => new RegExp(p, "i"));
    return {name, folder, excludeFilter};
  });
  const libFolders = new Set(libs.map((l) => l.folder));
  const inputFolders = (config?.input_folder ?? [])
    .map((f) => String(f).replace(/^\/+/, "").replace(/\/+$/, ""))
    .filter((f) => !libFolders.has(f));
  const excludeFilter = (config?.exclude_filter ?? []).map((p) => new RegExp(p, "i"));
  return {inputFolders, libs, excludeFilter};
}

/** Whether `absPath`, already routed to `classification` by
 *  classifyTestPath() below, is hidden by the build's own exclude filters:
 *  the top-level list for a Project or a Packs file (both are plain
 *  `input_folder` entries by the time the transpiler sees them), the
 *  matching lib's own list for a System file. A Workspace-layer file is
 *  never excluded here -- another layer's own config is not this tree's to
 *  read, and `classifyTestPath` never reads it for one either. */
function isExcludedByConfig(absPath, classification, layers) {
  const patterns = classification.group === "system"
    ? (layers?.libs ?? []).find((l) => l.name === classification.subgroup)?.excludeFilter ?? []
    : classification.group === "project" || classification.group === "packs"
      ? layers?.excludeFilter ?? []
      : [];
  return patterns.some((re) => re.test(absPath));
}

/** `absPath` relative to `root`, forward slashes always -- what every
 *  comparison in classifyTestPath() below is done against, on Windows too. */
function relOf(root, absPath) {
  return path.relative(root, absPath).split(path.sep).join("/");
}

function startsWithSegment(rel, prefix) {
  if (prefix === "") return false;
  return rel === prefix || rel.startsWith(`${prefix}/`);
}

const PACKS_FOLDER = "packs";

/** A short, stable label for a workspace layer (launcher.js's own `{folder,
 *  srcDir}`): the folder's own last path segment, the way the System group
 *  below names a lib by its folder's, so "workspace layer" and "library"
 *  read the same way once either has more than one. */
function workspaceLayerName(layer) {
  return path.basename(String(layer?.folder ?? "")) || "layer";
}

/** Which Test Explorer group (and, inside it, which sub-node) a
 *  `*.clas.testclasses.abap` (or, since PROG keeps its own local test
 *  classes inline, a `*.prog.abap`) file at `absPath` belongs under, given
 *  `layers` (transpileLayers()'s own answer, read off `root`'s own
 *  `abap_transpile.json` -- the file's own workspace folder, never a
 *  different tree's) and `workspaceLayers` (the running launcher's own
 *  `layers`, `[]` when none is running or known -- extension.js reads
 *  `activeController?.launcher?.layers`). Checked in this order because a
 *  workspace layer can sit anywhere on disk, even somewhere that would
 *  otherwise read as a lib's own folder or as `packs/`:
 *
 *  1. `workspace` -- under a running B0 workspace layer's own folder.
 *  2. `system` -- under one of abap_transpile.json's `libs` (`.local/lars/*`
 *     today, but read off the config rather than hardcoded).
 *  3. `packs` -- under `packs/<name>/`.
 *  4. `project` -- under `src/`, `test/`, `gen/`, or whatever else
 *     `input_folder` lists that is not a lib's own folder.
 *
 *  `undefined` both for a path outside every one of the four (a staging
 *  folder such as `deploy/`, never a layer of the build) and for a path a
 *  matching root's own `exclude_filter` hides from the build itself
 *  (`test/fixtures/`, a lib's own excluded corner -- isExcludedByConfig()
 *  above): a file that is not an object of this system is not listed,
 *  rather than dropped into Project as though it were one. `root` and
 *  `absPath` sharing no common tree (the packaged extension's osdHome, a
 *  materialized copy in globalStorage, handed the workspace folder's own
 *  file) reads the same way, for the same reason: `rel` starts with `..`
 *  all the way up, matches none of the four, and is correctly refused --
 *  the fix for that case is the caller passing the file's OWN workspace
 *  folder as `root`, never falling back to it here.
 *
 *  `relInGroup` is the path below whatever root matched, for packageOf()
 *  below to sub-group further; `subgroup` is `undefined` for `project`,
 *  which has no sub-node of its own (Project lists straight from
 *  packageOf(), when it needs to at all). */
function classifyTestPath(root, absPath, layers, workspaceLayers = []) {
  const rel = relOf(root, absPath);
  let result;
  for (const wl of workspaceLayers ?? []) {
    const wlRel = relOf(root, wl.folder ?? wl.srcDir);
    if (startsWithSegment(rel, wlRel)) {
      result = {group: "workspace", subgroup: workspaceLayerName(wl), relInGroup: rel.slice(wlRel.length).replace(/^\//, "")};
      break;
    }
  }
  if (result === undefined) {
    for (const lib of layers?.libs ?? []) {
      if (startsWithSegment(rel, lib.folder)) {
        result = {group: "system", subgroup: lib.name, relInGroup: rel.slice(lib.folder.length).replace(/^\//, "")};
        break;
      }
    }
  }
  if (result === undefined && startsWithSegment(rel, PACKS_FOLDER)) {
    const rest = rel.slice(PACKS_FOLDER.length + 1);
    const slash = rest.indexOf("/");
    result = {
      group: "packs",
      subgroup: slash === -1 ? rest : rest.slice(0, slash),
      relInGroup: slash === -1 ? "" : rest.slice(slash + 1),
    };
  }
  if (result === undefined) {
    for (const folder of layers?.inputFolders ?? []) {
      if (startsWithSegment(rel, folder)) {
        result = {group: "project", subgroup: undefined, relInGroup: rel};
        break;
      }
    }
  }
  if (result === undefined) return undefined;
  if (isExcludedByConfig(absPath, result, layers)) return undefined;
  return result;
}

/** How many test-carrying classes a group (or a group's own sub-node -- one
 *  pack, one lib, one workspace layer) may hold before it is worth
 *  splitting further by package rather than listed flat -- the "~15" the
 *  task named, kept in one place so extension.js and a test read the same
 *  number. */
const PACKAGE_SPLIT_THRESHOLD = 15;

function needsPackageSplit(count) {
  return count > PACKAGE_SPLIT_THRESHOLD;
}

/** `package.xml` files' own paths (each relative to the same root
 *  `classifyTestPath()` above measured `relInGroup` against) turned into
 *  the directories that carry one -- what packageOf() below prefers over
 *  guessing from `src/`. */
function packageDirsFrom(packageXmlPaths) {
  return (packageXmlPaths ?? []).map((p) => {
    const parts = String(p).replace(/\\/g, "/").split("/");
    parts.pop();
    return parts.join("/");
  });
}

/** The sub-group `relInGroup` (classifyTestPath()'s own field) falls into
 *  once its group is too big to list flat: the nearest ancestor directory
 *  in `packageDirs` (abapGit's own `package.xml`, ~one per ABAP package)
 *  when any is known, else the first real directory once any leading
 *  `src`/`test`/`gen` content root is stripped -- so
 *  "src/rtti/cl_abap_typedescr...abap" reads as "rtti" and
 *  "test/adbc/zcl_adbc_test...abap" as "adbc", the subject rather than
 *  which content root happened to carry it. `undefined` for a file with no
 *  directory of its own once that stripping is done (kept in the group's
 *  own flat overflow rather than given a made-up name). */
function packageOf(relInGroup, packageDirs = []) {
  const parts = String(relInGroup).replace(/\\/g, "/").split("/").filter(Boolean);
  parts.pop();
  if (packageDirs.length > 0) {
    let dir = "";
    let best = packageDirs.includes("") ? "" : undefined;
    for (const part of parts) {
      dir = dir === "" ? part : `${dir}/${part}`;
      if (packageDirs.includes(dir)) best = dir;
    }
    if (best !== undefined) return best === "" ? undefined : best;
  }
  let i = 0;
  while (i < parts.length && (parts[i] === "src" || parts[i] === "test" || parts[i] === "gen")) i++;
  return parts[i];
}

/** Whether `source` (a `*.clas.testclasses.abap` include's own text) is
 *  worth turning into a Test Explorer item at all: does it mark at least
 *  one method `FOR TESTING` anywhere? Run up front, against the file
 *  system, before any object item is created -- the cheap half of the
 *  filter `discover()`'s own server round trip already does per test class
 *  and method (extension.js, `(c.methods ?? []).length > 0`), so a
 *  testclasses include with no test method at all (a global class's own
 *  empty include, or one that declares a test class with none) never
 *  becomes an item only to be found empty once expanded. */
function hasTestMethods(source) {
  return /\bFOR\s+TESTING\b/i.test(String(source ?? ""));
}

/** The object names `abap_transpile.json`'s own `options.skip` already
 *  marks as deliberately failing (`{object, class, method}`, read by
 *  tools/osd-transpile.mjs into the transpiler's own `settings.skip` --
 *  what keeps `npm test`'s build-time ABAP Unit run green over a method
 *  that fails on purpose, ZOSD_TEST's `deliberate_failure`
 *  (`docs/vscode-extension.md`, "Test Explorer groups"): the demo's own
 *  point is that the failure DOES reach a live client, so "Run" on Project
 *  in the Test Explorer must still run it and still see it fail; only the
 *  build-time run, which cannot tell "meant to fail" from "broken", skips
 *  it. Reused here rather than a new marker (a source comment, a second
 *  config list) because it is already the single, explicit, machine-read
 *  statement of exactly this fact, per object -- adding a second one risks
 *  the two drifting the way `exclude_filter`/`not_in_system` do not, only
 *  because a test holds those two together and nothing would hold these. */
function demoFailureObjects(config) {
  return new Set((config?.options?.skip ?? []).map((s) => String(s.object ?? "").toUpperCase()).filter((s) => s !== ""));
}

// ---- Services tree (docs/vscode-extension.md, "Services tree"): the
// panel's "OSD: System" view used to show one flat list of every APP/APC/
// ICF/ODATA row ZOSD_STATUS_SRV's own ServiceSet answers, with nothing
// wired to a click. This section is the pure half of grouping it by kind,
// with a count per group, and of the URL a click or a context-menu action
// on one row opens -- extension.js's OsdTreeProvider is the thin wrapping
// (which group and row are expanded, the webview for "open inside
// VS Code", vscode.env.clipboard for the "Copy ... URL" actions).
//
// Two sources answer the same rows, normalized to one shape here so the
// rest of the provider reads either without knowing which one answered:
// ZOSD_STATUS_SRV's own ServiceSet (today, PascalCase OData columns,
// osd-status.mjs's own servicesOf/appsOf) and the composing route
// docs/ideas.md T8 names (`GET core/http/services`, lowercase, already
// kind-typed: `handler` is a class name for every kind but APP, whose own
// class-shaped field is `app` -- an app has a manifest id, not an ADT
// class). `Osd#services()` below tries the route first and falls back to
// ServiceSet on a 404, so this client works whether or not that route
// exists on the server it happens to be talking to (docs/vscode-extension.md,
// "forward-compatible expansion").

const SERVICE_GROUP_LABEL = {ODATA: "OData", APP: "Apps", ICF: "ICF", APC: "APC"};
const SERVICE_GROUP_ORDER = ["ODATA", "APP", "ICF", "APC"];

/** The group label for a service kind: the four named ones read as this
 *  tree's own words for them; any other kind the server starts returning
 *  (DAEMON, JOB, TRAN, ... -- docs/osd-status.mjs `servicesOf`'s own
 *  comment names them as coming) still gets a readable label instead of
 *  needing a code change first -- title case of the raw kind, the only
 *  guess this client can make about a word it has never seen. */
function serviceGroupLabel(kind) {
  if (SERVICE_GROUP_LABEL[kind] !== undefined) return SERVICE_GROUP_LABEL[kind];
  const word = String(kind ?? "");
  return word.length === 0 ? "Other" : word[0].toUpperCase() + word.slice(1).toLowerCase();
}

/** ZOSD_STATUS_SRV's own ServiceSet row (PascalCase, one of `d.results`)
 *  into the one shape every row below reads: `{kind, name, path, text,
 *  pack, handler, handlerUri, app, mpc, mpcUri, source}`. `HandlerName` is
 *  the manifest app id for an APP row (osd-status.mjs `appsOf`) and a
 *  class name for every other kind -- the same split the composing route
 *  makes explicit with its own `app` field, so an APP row here answers
 *  `app` and every other kind answers `handler`, never both. ServiceSet
 *  carries no ADT uri, no MPC and no source file, so those three stay
 *  undefined -- serviceClassNodes() below still finds a handler to show
 *  for every kind but APP, just with nowhere to click through to its
 *  source (extension.js falls back to a workspace glob by name). */
function normalizeServiceSetRow(row) {
  const kind = String(row?.Kind ?? "");
  const handlerName = row?.HandlerName === undefined || row.HandlerName === "" ? undefined : String(row.HandlerName);
  const pack = row?.Pack === undefined || row.Pack === "" ? undefined : String(row.Pack);
  return {
    kind, name: undefined, path: String(row?.Path ?? ""), text: String(row?.Text ?? ""), pack,
    handler: kind === "APP" ? undefined : handlerName,
    handlerUri: undefined,
    app: kind === "APP" ? handlerName : undefined,
    mpc: undefined, mpcUri: undefined, source: undefined,
  };
}

/** The composing route's own row (docs/ideas.md T8, `GET core/http/
 *  services`: `{kind, name, path, text, pack, handler, handlerUri, app,
 *  mpc, mpcUri, source}`) into the same shape -- already this shape, field
 *  for field, so this is only the defensive normalisation of an absent
 *  optional key into `undefined` rather than `null` or a missing property,
 *  the one thing a fixture and the real route are not promised to agree on
 *  byte for byte. */
function normalizeServiceRow(row) {
  const str = (v) => (v === undefined || v === null || v === "" ? undefined : String(v));
  return {
    kind: String(row?.kind ?? ""), name: str(row?.name),
    path: String(row?.path ?? ""), text: String(row?.text ?? ""), pack: str(row?.pack),
    handler: str(row?.handler), handlerUri: str(row?.handlerUri),
    app: str(row?.app), mpc: str(row?.mpc), mpcUri: str(row?.mpcUri), source: str(row?.source),
  };
}

/** Every normalized row grouped by kind: `SERVICE_GROUP_ORDER` first (so
 *  "OData (n)", "Apps (n)", "ICF (n)", "APC (n)" read in that order, the
 *  task's own words), then any kind the server returns that this client
 *  has never named, alphabetically -- "a generic group, so new kinds
 *  appear without code changes". Each group's own rows sorted by path,
 *  the way the flat list this replaces already read top to bottom. */
function groupServices(rows) {
  const byKind = new Map();
  for (const row of rows ?? []) {
    const list = byKind.get(row.kind) ?? [];
    list.push(row);
    byKind.set(row.kind, list);
  }
  const known = SERVICE_GROUP_ORDER.filter((k) => byKind.has(k));
  const rest = [...byKind.keys()].filter((k) => !SERVICE_GROUP_ORDER.includes(k)).sort();
  return [...known, ...rest].map((kind) => ({
    kind,
    label: serviceGroupLabel(kind),
    rows: [...byKind.get(kind)].sort((a, b) => a.path.localeCompare(b.path)),
  }));
}

/** The label and the (dimmed, `TreeItem.description`) text a service row's
 *  own tree item shows: the server's own text first, falling back to the
 *  row's name or its path when a row carries no text at all -- the path
 *  always goes in `description`, never folded into the label itself. */
function serviceLabel(row) {
  const label = row.text !== undefined && row.text !== "" ? row.text : (row.name ?? row.path);
  return {label, description: row.path};
}

/** `osd-service-<kind>`, lower-cased -- one contextValue per kind so
 *  package.json's `view/item/context` menus can offer exactly the actions
 *  that kind supports (Copy URL everywhere, "Open $metadata" for OData
 *  only, "Copy ws:// URL" for APC only) without an enum this file and
 *  package.json would otherwise have to keep in lockstep by hand: a kind
 *  neither knows about gets a contextValue and simply matches no menu
 *  entry, rather than the provider needing to special-case it. */
function serviceContextValue(kind) {
  return `osd-service-${String(kind ?? "").toLowerCase()}`;
}

/** `baseUrl` (osd().url, no trailing slash) plus the row's own path --
 *  what an APP, an ICF node or an OData service document opens, in a
 *  browser or in the "open inside VS Code" webview alike. */
function serviceHttpUrl(row, baseUrl) {
  return `${baseUrl}${row.path}`;
}

/** The OData `$metadata` document beside the service document above --
 *  its own context-menu action rather than the click, because the service
 *  document is the more useful default and a person who wants the EDMX
 *  asks for it by name. */
function serviceMetadataUrl(row, baseUrl) {
  return `${serviceHttpUrl(row, baseUrl)}/$metadata`;
}

/** The push channel's own `ws://` (or `wss://` over `https://`) URL --
 *  never opened by a click, since a WebSocket URL does nothing in a
 *  browser tab or a webview iframe (docs/vscode-extension.md, "Services
 *  tree"): only ever copied to the clipboard. */
function serviceWsUrl(row, baseUrl) {
  return serviceHttpUrl(row, baseUrl).replace(/^http/i, "ws");
}

/** The class nodes a service row expands to (docs/vscode-extension.md,
 *  "forward-compatible expansion"): the DPC then the MPC for an OData
 *  service (in that order, the way SEGW itself always names the pair),
 *  the one handler class for everything else that carries one (ICF, APC,
 *  and any future kind this client has never seen), and none for APP --
 *  an app has no ADT class of its own, only a manifest, which is why the
 *  normalisers above route its id to `row.app` rather than `row.handler`.
 *  `{role, name, uri}`: `uri` is the ADT class uri when the composing
 *  route answered one, `undefined` over ServiceSet (extension.js opens by
 *  a workspace glob on the name instead, the same way Q3's readers does). */
function serviceClassNodes(row) {
  if (row.kind === "APP") return [];
  if (row.kind === "ODATA") {
    const out = [];
    if (row.handler) out.push({role: "dpc", name: row.handler, uri: row.handlerUri});
    if (row.mpc) out.push({role: "mpc", name: row.mpc, uri: row.mpcUri});
    return out;
  }
  return row.handler ? [{role: "handler", name: row.handler, uri: row.handlerUri}] : [];
}

module.exports = {objectOf, adtObjectOf, uriOf, fileOf, Osd, abapFrame, outcomes, parseCheckReport, parseActivationResult, runActionFor,
  entitySetMethodLines, entitySetLenses, methodAtLine, resultRows, stripMetadata, keyOf,
  readersLensLine, readersLensTitle, readersQuickPickItems, readerFilePattern,
  htmlEscape, freestyleRows, freestyleTableHtml, notebookFromJson, notebookToJson,
  HOTSPOTS_SQL, hotspotsFromRows, hotspotBucket, hotspotColor, hotspotBadge, hotspotHoverText,
  implementsClassrun,
  dataPreviewObjectOf, tablHasMandt, MANDT_CLIENT, dataPreviewQuery, dataPreviewCountQuery, dataPreviewStatusText, dataPreviewRows,
  transpileLayers, classifyTestPath, PACKAGE_SPLIT_THRESHOLD, needsPackageSplit, packageDirsFrom, packageOf, hasTestMethods,
  demoFailureObjects,
  progTcodeOf, progRunLens,
  SERVICE_GROUP_ORDER, serviceGroupLabel, normalizeServiceSetRow, normalizeServiceRow, groupServices, serviceLabel,
  serviceContextValue, serviceHttpUrl, serviceMetadataUrl, serviceWsUrl, serviceClassNodes};
