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

module.exports = {objectOf, fileOf, Osd, abapFrame, outcomes};
