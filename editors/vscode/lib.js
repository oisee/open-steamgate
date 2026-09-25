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

// ---- F8, "Run", by object type (SE80's own dispatch). What this build
// already reaches stays concrete; every other type answers a `text`
// describing the server work its turn would add, so the table gets one
// entry filled in at a time rather than the same guess made twice. Kept as
// data (not a switch inside extension.js) so a test can hold every row to
// its planned action without VS Code.
const RUN_TABLE = {
  // a service's _DPC_EXT / _MPC_EXT: SE80's F8 there opens a client of the
  // service, not a debugger -- so this waits on a Gateway client, not on
  // ABAP Unit, even though the class itself could carry tests too.
  CLAS: (ctx) => {
    if (/_DPC_EXT$|_MPC_EXT$/i.test(ctx.name ?? "")) {
      return {kind: "not-yet", text: "not yet: a Gateway client prefilled with the service and the entity set of the method under the cursor"};
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

module.exports = {objectOf, adtObjectOf, uriOf, fileOf, Osd, abapFrame, outcomes, parseCheckReport, parseActivationResult, runActionFor};
