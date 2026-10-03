// Variant C done gate (docs/adt-abap-port/port-plan.md): ask the ABAP
// front's MATCH over ROUTES for every Express registration and method.
// PORT_PENDING is the document-port queue; each slice deletes its block.
// Done means PORT_PENDING is empty and the table has one last HOST catch-all.
// HOST_ALLOWED is the final host-orchestration Map, not a queue. It only
// grows by a decision of Alice recorded in the plan. Every method must
// reach HOST; HOST_BY_DESIGN names the catch-all itself.
import {remoteForTest} from "./helpers/adt-remote.mjs";
import {expect} from "chai";
import {mkdtempSync, rmSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {withSystem} from "../tools/osd-store-destination.mjs";
import express from "express";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";

const CATCH_ALL = "* /sap/bc/adt/*";

// Variant C keeps host orchestration behind the catch-all. HOST_BY_DESIGN
// names the catch-all registration itself, rather than an orchestration route.
function reasonedMap(entries) {
  const keys = entries.map(([key]) => key);
  expect(keys.filter((key, i) => keys.indexOf(key) !== i), "duplicate host entries").to.deep.equal([]);
  return new Map(entries);
}
const HOST_BY_DESIGN = reasonedMap([
  [CATCH_ALL, "the catch-all: a path no row names is the Node façade's 404 (plan section 4)"],
]);

const HOST_ALLOWED = reasonedMap([
  // A4: write path (PUT source, includes)
  ["PUT /sap/bc/adt/oo/classes/:name/source/main", "source writes and includes: host orchestration (variant C)"],
  ["PUT /sap/bc/adt/oo/classes/:name/includes/:include", "source writes and includes: host orchestration (variant C)"],
  ["PUT /sap/bc/adt/oo/classes/:name/includes/:include/source/main", "source writes and includes: host orchestration (variant C)"],
  ["POST /sap/bc/adt/oo/classes/:name/includes", "source writes and includes: host orchestration (variant C)"],
  ["PUT /sap/bc/adt/oo/interfaces/:name/source/main", "source writes and includes: host orchestration (variant C)"],
  ["PUT /sap/bc/adt/programs/programs/:name/source/main", "source writes and includes: host orchestration (variant C)"],
  ["PUT /sap/bc/adt/ddic/ddl/sources/:name/source/main", "source writes and includes: host orchestration (variant C)"],
  ["PUT /sap/bc/adt/ddic/srvd/sources/:name/source/main", "source writes and includes: host orchestration (variant C)"],
  ["PUT /sap/bc/adt/programs/includes/:name/source/main", "source writes and includes: host orchestration (variant C)"],
  // A5: create and delete
  ["POST /sap/bc/adt/oo/classes", "object creation and deletion: host orchestration (variant C)"],
  ["DELETE /sap/bc/adt/oo/classes/:name", "object creation and deletion: host orchestration (variant C)"],
  ["POST /sap/bc/adt/oo/interfaces", "object creation and deletion: host orchestration (variant C)"],
  ["DELETE /sap/bc/adt/oo/interfaces/:name", "object creation and deletion: host orchestration (variant C)"],
  ["POST /sap/bc/adt/programs/programs", "object creation and deletion: host orchestration (variant C)"],
  ["DELETE /sap/bc/adt/programs/programs/:name", "object creation and deletion: host orchestration (variant C)"],
  ["POST /sap/bc/adt/ddic/ddl/sources", "object creation and deletion: host orchestration (variant C)"],
  ["DELETE /sap/bc/adt/ddic/ddl/sources/:name", "object creation and deletion: host orchestration (variant C)"],
  ["POST /sap/bc/adt/ddic/srvd/sources", "object creation and deletion: host orchestration (variant C)"],
  ["DELETE /sap/bc/adt/ddic/srvd/sources/:name", "object creation and deletion: host orchestration (variant C)"],
  ["POST /sap/bc/adt/programs/includes", "object creation and deletion: host orchestration (variant C)"],
  ["DELETE /sap/bc/adt/programs/includes/:name", "object creation and deletion: host orchestration (variant C)"],
  ["POST /sap/bc/adt/packages", "object creation and deletion: host orchestration (variant C)"],
  ["DELETE /sap/bc/adt/packages/:name", "object creation and deletion: host orchestration (variant C)"],
  // A6 / A7: inactive objects and activation
  ["GET /sap/bc/adt/activation/inactiveobjects", "inactive objects and activation: host orchestration (variant C)"],
  ["POST /sap/bc/adt/activation", "inactive objects and activation: host orchestration (variant C)"],
  // A8b: git
  ["GET /sap/bc/adt/core/http/git/object", "git state and revisions: host orchestration (variant C)"],
  ["GET /sap/bc/adt/core/http/git/object/revision", "git state and revisions: host orchestration (variant C)"],
  // C2b: ABAP Unit test runs
  ["POST /sap/bc/adt/abapunit/testruns/evaluation", "ABAP Unit runs: host orchestration (variant C)"],
  ["POST /sap/bc/adt/abapunit/testruns", "ABAP Unit runs: host orchestration (variant C)"],
  // C3: unit/object/run
  ["POST /sap/bc/adt/core/http/unit/object/run", "unit/object/run: host orchestration (variant C)"],
  // C6: notebook
  ["POST /sap/bc/adt/notebook/abap", "notebook execution: host orchestration (variant C)"],
]);

const PORT_PENDING = [
  // A2: feeds, system/users, transport check, occurrence markers
  "GET /sap/bc/adt/feeds",
  "GET /sap/bc/adt/feeds/variants",
  "GET /sap/bc/adt/system/users",
  "GET /sap/bc/adt/runtime/dumps",
  "GET /sap/bc/adt/runtime/systemmessages",
  "GET /sap/bc/adt/gw/errorlog",
  "POST /sap/bc/adt/cts/transportchecks",
  "POST /sap/bc/adt/abapsource/occurencemarkers",
  // A3b: reentrance ticket
  "GET /sap/bc/adt/core/http/reentranceticket",
  // A8a: thin introspection rows
  "GET /sap/bc/adt/core/http/build",
  "GET /sap/bc/adt/core/http/changed",
  "GET /sap/bc/adt/core/http/services",
  "GET /sap/bc/adt/core/http/transactions",
  // A9: xref
  "GET /sap/bc/adt/core/http/xref/readers",
  "GET /sap/bc/adt/core/http/xref/closure",
];

const text = (value) => String(value?.get?.() ?? value ?? "").trimEnd();

// a value per parameter name, so a sample path reads like a request
const SAMPLE = {name: "zosd_coverage", include: "testclasses", stamp: "19700101101123", version: "00000",
  id: "0123456789abcdef01234567", what: "softwarecomponents"};

// The layers of adtRouter that are not routes: middleware every request
// passes through and none answers. adtRouter mounts each through one helper
// and returns them ({id, path, fn}); the walk accepts a layer only when its
// handler IS one of those functions, mounted on that path, so an endpoint
// mounted with use() cannot pass by resembling one. Every id needs a reason.
const MIDDLEWARE = {
  "sessions": "Node Sessions' gate, mounted only without the ABAP front (OSD_ADT=js, child mode)",
  "generation": "stamps X-OSD-Generation on every answer and passes on",
  "dump": "STG_ADT_DUMP: records the exchange and passes on, only when a dump file is named",
  "abap-front": "the ABAP front itself: every request enters ZCL_OSD_ADT_HANDLER, which is what this gate asks",
};

/** the expression express builds for a use() on this path, to compare with */
function useRegexpOf(path) {
  const r = express.Router();
  r.use(path, () => {});
  return String(r.stack[0].regexp);
}

/** the path a router is mounted on, read back from the layer's expression
 *  (express 4 keeps no string). path-to-regexp 0.1 escapes only "/" and "."
 *  in a literal path; any other escape or operator throws */
function mountPathOf(layer) {
  if (layer.keys?.length > 0) throw new Error(`a router mounted on a path with parameters: ${String(layer.regexp)}`);
  if (layer.regexp?.fast_slash) return "";
  const m = /^\^(.*)\\\/\?\(\?=\\\/\|\$\)$/.exec(layer.regexp?.source ?? "");
  if (m === null) throw new Error(`a router mounted on a path this walk cannot read: ${String(layer.regexp)}`);
  let path = "";
  for (let i = 0; i < m[1].length; i++) {
    const c = m[1][i];
    if (c === "\\" && (m[1][i + 1] === "/" || m[1][i + 1] === ".")) path += m[1][++i];
    else if (/[A-Za-z0-9_~%!'&=:,;@-]/.test(c)) path += c;
    else throw new Error(`a router mounted on a path this walk cannot read (${c} at ${i}): ${String(layer.regexp)}`);
  }
  return path;
}

/** method and path of every registration on the router's stack, in order,
 *  mounted routers included; non-route layers are matched by reference
 *  against `known` ({id, path, fn}) or reported */
function walk(router, known = [], prefix = "", out = {registrations: [], middleware: [], unclassified: []}) {
  for (const layer of router.stack) {
    if (layer.route !== undefined) {
      const {path} = layer.route;
      if (typeof path !== "string") throw new Error(`a route path that is not a string: ${String(path)}`);
      for (const method of Object.keys(layer.route.methods)) {
        out.registrations.push({method: method === "_all" ? "*" : method.toUpperCase(), path: prefix + path});
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      walk(layer.handle, known, prefix + mountPathOf(layer), out);
    } else {
      const entry = known.find((k) => k.fn === layer.handle);
      const at = `use ${prefix}${String(layer.regexp)}`;
      if (entry === undefined) {
        out.unclassified.push(`${at}: not a function adtRouter reported as middleware`);
      } else if (prefix !== "" || useRegexpOf(entry.path) !== String(layer.regexp)) {
        out.unclassified.push(`${at}: ${entry.id} mounted off its path ${JSON.stringify(entry.path)}`);
      } else {
        out.middleware.push(entry.id);
      }
    }
  }
  return out;
}

// the methods an all() registration is asked with: the list Express itself
// routes all() over, its "methods" dependency, taken from where express sits
const require = createRequire(import.meta.url);
const ALL_METHODS = createRequire(require.resolve("express"))("methods").map((m) => m.toUpperCase());

/** ask the ABAP router for each method a registration answers */
async function verdictsOf(regs, rows) {
  const a = globalThis.abap;
  const router = a.Classes.ZCL_OSD_ADT_ROUTER;
  const out = [];
  for (const reg of regs) {
    const path = sampleOf(reg.path);
    const probes = [];
    for (const method of reg.method === "*" ? ALL_METHODS : [reg.method]) {
      const found = new a.types.Character(1);
      const route = router.METHODS.MATCH.parameters.ES_ROUTE.type();
      await router.match({it_routes: rows, iv_method: new a.types.String().set(method),
        iv_path: new a.types.String().set(path), ev_found: found, es_route: route});
      const r = route.get();
      probes.push({sample: `${method} ${path}`, found: found.get() === "X",
        row: {method: text(r.method), pattern: text(r.pattern), handler: text(r.handler), servedBy: text(r.served_by)}});
    }
    out.push({key: `${reg.method} ${reg.path}`, path: reg.path, probes});
  }
  return out;
}

// the shape of a pattern: parameter names do not matter, case does not
const shape = (pattern) => pattern.toLowerCase().replace(/\/:[^/]+/g, "/:");
// A HEAD request falls through to a GET row in the ABAP router; an explicit
// Node HEAD registration counts as ported only with a HEAD row of its own.
const probeAbap = (p) => p.found && p.row.servedBy === "ABAP" && (!p.sample.startsWith("HEAD ") || p.row.method === "HEAD");
/** every method of the registration reaches an ABAP row of its own pattern */
const abapServed = (v) => v.probes.every((p) => probeAbap(p) && shape(p.row.pattern) === shape(v.path));
const anyAbap = (v) => v.probes.some(probeAbap);
const where = (p) => (p.found ? `${p.row.servedBy} ${p.row.method} ${p.row.pattern}` : "no row");
const hostServed = (v) => v.probes.every((p) => p.found && p.row.servedBy === "HOST");
const atCatchAll = (p) => p.found && p.row.servedBy === "HOST" && p.row.pattern === "/sap/bc/adt/*";

/** a request path the pattern matches: each :param a sample, a last * a segment */
function sampleOf(pattern) {
  return pattern.split("/").map((part, i, all) => {
    if (part.startsWith(":")) {
      const value = SAMPLE[part.slice(1)];
      if (value === undefined) throw new Error(`no sample for ${part} in ${pattern}`);
      return value;
    }
    if (part === "*" && i === all.length - 1) return "osd-coverage-unrouted";
    return part;
  }).join("/");
}


describe("ADT on ABAP: the variant C done gate", function () {
  this.timeout(60000);
  let root;
  let walks;
  let regs;
  let table;
  let verdicts;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-adt-coverage-"));
    const base = {root, data: {}, logMisses: false, watch: false};
    const abapOption = {abap: abapRunner({handler: globalThis.abap.Classes.ZCL_OSD_ADT_HANDLER, step: dialogStep})};
    const dumpOption = {dump: join(root, "dump.ndjson")};
    // every mount a host can make: Node alone, with a dump, with the ABAP front, both
    walks = {};
    for (const [name, extra] of Object.entries({node: {}, dump: dumpOption, abap: abapOption, "dump+abap": {...dumpOption, ...abapOption}})) {
      const made = adtRouter({...base, ...extra});
      walks[name] = {...walk(made.router, made.middleware), reported: made.middleware.map((m) => m.id)};
    }
    // The Node oracle retains every endpoint. Ported session routes have no
    // Node fallback in an ABAP mount, but must still be checked by this gate.
    regs = walks.node.registrations;
    // The port gate asks the one-runtime table: C5 reads the request's
    // oneRuntime binding, C4 the STORE destination's localSystem. Switch-off
    // HOST is tested separately (C5's inline and reduced kernels, c4-runtime).
    const destination = abap.context.RFCDestinations.STORE;
    const previousLocal = destination.localSystem;
    destination.localSystem = {};
    try {
      ({table, verdicts} = await withSystem(() => undefined, () => dialogStep(async () => {
        const rows = await globalThis.abap.Classes.ZCL_OSD_ADT_ROUTER.routes();
        return {table: rows.array().map((line) => {
          const r = line.get();
          return {method: text(r.method), pattern: text(r.pattern), handler: text(r.handler), servedBy: text(r.served_by)};
        }), verdicts: await verdictsOf(regs, rows)};
      }, "test: the coverage gate's match"), {oneRuntime: true}));
    } finally {
      destination.localSystem = previousLocal;
    }
    if (process.env.OSD_ADT_ONE_RUNTIME === "1") {
      const runtime = await remoteForTest();
      const queries = verdicts.flatMap(v => v.probes.map(p => p.sample));
      runtime.systemAnswers = kind => kind === "BUILD" ? {raw: queries.join("\n")} : undefined;
      try {
        const response = await fetch(runtime.url + "/osd/classrun", {method: "POST",
          headers: {"content-type": "application/json"}, body: JSON.stringify({name: "ZCL_OSD_ADT_COVERAGE_PROBE"})});
        const result = await response.json();
        expect(result.ok, JSON.stringify(result)).to.equal(true);
        const lines = result.text.trimEnd().split("\n").map(line => line.split("|"));
        const row = ([method, pattern, handler, servedBy]) => ({method, pattern, handler, servedBy});
        const childTable = lines.filter(line => line[0] === "TABLE").map(line => row(line.slice(1)));
        expect(childTable, "coverage uses the serving child's route table").to.deep.equal(table);
        const matches = lines.filter(line => line[0] === "PROBE");
        expect(matches).to.have.length(queries.length);
        let i = 0;
        verdicts = verdicts.map(v => ({...v, probes: v.probes.map(p => {
          const match = matches[i++];
          return {...p, found: match[1] === "X", row: row(match.slice(2))};
        })}));
      } finally { await runtime.stop(); }
    }

  });
  after(() => { if (root !== undefined) rmSync(root, {recursive: true, force: true}); });

  it("every middleware layer is known and only ported session fallbacks disappear in ABAP mounts", () => {
    const expected = {node: ["sessions", "generation"], dump: ["sessions", "generation", "dump"],
      abap: ["generation", "abap-front"], "dump+abap": ["generation", "dump", "abap-front"]};
    const retired = new Set([
      "GET /sap/bc/adt/core/http/sessions",
      "DELETE /sap/bc/adt/core/http/sessions/:id",
      "GET /sap/public/bc/icf/logoff",
    ]);
    const keys = (w) => w.registrations.map((r) => `${r.method} ${r.path}`);
    for (const [name, w] of Object.entries(walks)) {
      expect(w.unclassified, `${name}: use layers that are not the middleware adtRouter mounted`).to.deep.equal([]);
      expect(w.reported.filter((id) => MIDDLEWARE[id] === undefined), `${name}: middleware with no reason here`).to.deep.equal([]);
      // each reported layer found on the stack exactly once, and only those
      expect(w.middleware, `${name}: middleware on the stack`).to.deep.equal(w.reported);
      expect(w.middleware, `${name}: middleware for this mount`).to.deep.equal(expected[name]);
      const expectedKeys = keys(walks.node).filter(key => !name.includes("abap") || !retired.has(key));
      expect(keys(w), `${name}: registrations`).to.deep.equal(expectedKeys);
    }
  });

  it("the router table has exactly one HOST row, the catch-all, and it is last", () => {
    const host = table.filter((r) => r.servedBy !== "ABAP");
    expect(host.map((r) => `${r.method} ${r.pattern} ${r.servedBy}`), "HOST rows").to.deep.equal([`${CATCH_ALL} HOST`]);
    expect(table.at(-1).pattern).to.equal("/sap/bc/adt/*");
  });

  it("the lists are well formed: no duplicates, no overlap, every entry names a registration", () => {
    expect(PORT_PENDING.filter((e, i) => PORT_PENDING.indexOf(e) !== i), "duplicates in PORT_PENDING").to.deep.equal([]);
    const lists = [PORT_PENDING, [...HOST_ALLOWED.keys()], [...HOST_BY_DESIGN.keys()]];
    const listed = lists.flat();
    expect(listed.filter((e, i) => listed.indexOf(e) !== i), "overlap among the three lists").to.deep.equal([]);
    const keys = new Set(regs.map((r) => `${r.method} ${r.path}`));
    expect(keys.size, "a registration twice on the stack").to.equal(regs.length);
    expect(table.filter((r, i) => table.findIndex((o) => o.method === r.method && o.pattern === r.pattern) !== i)
      .map((r) => `${r.method} ${r.pattern}`), "a row twice in ROUTES").to.deep.equal([]);
    const stale = listed.filter((e) => !keys.has(e));
    expect(stale, "entries no adtRouter registration has: remove them").to.deep.equal([]);
  });

  it("every registration not listed is served by ABAP, every method of it, by the row of its own pattern", () => {
    const missing = verdicts.filter((v) => !PORT_PENDING.includes(v.key) && !HOST_ALLOWED.has(v.key) && !HOST_BY_DESIGN.has(v.key) && !abapServed(v));
    expect(missing.map((v) => `${v.key} (${v.probes.filter((p) => !probeAbap(p) || shape(p.row.pattern) !== shape(v.path))
      .map((p) => `${p.sample} -> ${where(p)}`).join("; ")})`),
    "not served by ABAP: port them, or list them under the slice that will port them").to.deep.equal([]);
  });

  it("no registration in PORT_PENDING is served by ABAP, not even for one method", () => {
    const ported = verdicts.filter((v) => PORT_PENDING.includes(v.key) && anyAbap(v));
    expect(ported.map((v) => `${v.key} (${v.probes.filter(probeAbap).map((p) => `${p.sample} -> ${where(p)} (${p.row.handler})`).join("; ")})`),
      "served by ABAP now: remove it from PORT_PENDING").to.deep.equal([]);
  });

  it("host orchestration stays on the host (variant C), for every method", () => {
    const wrong = verdicts.filter((v) => HOST_ALLOWED.has(v.key) && !hostServed(v));
    expect(wrong.map((v) => `${v.key}: ${HOST_ALLOWED.get(v.key)} (${v.probes.filter((p) => !p.found || p.row.servedBy !== "HOST")
      .map((p) => `${p.sample} -> ${where(p)}`).join("; ")})`),
    "orchestration stays on the host (variant C)").to.deep.equal([]);
  });

  it("what stays on the host by design reaches the catch-all, for every method", () => {
    for (const key of HOST_BY_DESIGN.keys()) {
      const v = verdicts.find((one) => one.key === key);
      expect(v, key).to.not.equal(undefined);
      expect(v.probes.filter((p) => !atCatchAll(p)).map((p) => `${p.sample} -> ${where(p)}`), `${key}: ${HOST_BY_DESIGN.get(key)}`)
        .to.deep.equal([]);
    }
    const abap = verdicts.filter(abapServed).length;
    console.log(`      ADT on ABAP: ${PORT_PENDING.length} pending, ${abap} ABAP, ` +
      `${HOST_ALLOWED.size} host-orchestration, ${HOST_BY_DESIGN.size} host-by-design` +
      `${PORT_PENDING.length === 0 ? " -- done" : ""}`);
  });

  // the gate's own red proofs: what the walk and the probe must refuse
  describe("the gate guards itself", () => {
    it("an endpoint mounted with use() is reported, also one that looks like known middleware", () => {
      const {middleware} = adtRouter({root, data: {}, logMisses: false, watch: false});
      const generation = middleware.find((m) => m.id === "generation");
      const r = express.Router();
      r.use("/sap/bc/adt", (req, res) => { res.set("X-OSD-Generation", "x"); res.end(); });
      r.use("/sap/bc/adt/core", generation.fn);
      r.use("/sap/bc/adt", generation.fn);
      const w = walk(r, middleware);
      expect(w.unclassified).to.have.lengthOf(2);
      expect(w.unclassified[0]).to.match(/not a function adtRouter reported/);
      expect(w.unclassified[1]).to.match(/generation mounted off its path/);
      expect(w.middleware).to.deep.equal(["generation"]);
    });

    it("a mount path is decoded from literal escapes only; a regex operator throws", () => {
      const inner = express.Router();
      inner.get("/x", (req, res) => res.end());
      const literal = express.Router();
      literal.use("/sap/bc/adt/a.b-c", inner);
      expect(walk(literal).registrations).to.deep.equal([{method: "GET", path: "/sap/bc/adt/a.b-c/x"}]);
      for (const regexp of [/^\/sap\/bc\/adt\S\/?(?=\/|$)/i, /^\/sap\/bc\/ad.\/?(?=\/|$)/i, /^\/sap\/b[c]\/adt\/?(?=\/|$)/i]) {
        const r = express.Router();
        r.use(regexp, inner);
        expect(() => walk(r), String(regexp)).to.throw(/cannot read/);
      }
    });

    it("a mounted router is walked with its mount path, and an array path fails loudly", () => {
      const inner = express.Router();
      inner.get("/one/:name", (req, res) => res.end());
      const r = express.Router();
      r.use("/sap/bc/adt/mounted", inner);
      expect(walk(r).registrations).to.deep.equal([{method: "GET", path: "/sap/bc/adt/mounted/one/:name"}]);
      const arrays = express.Router();
      arrays.get(["/a", "/b"], (req, res) => res.end());
      expect(() => walk(arrays)).to.throw(/not a string/);
    });

    it("an all() route that ABAP serves only for GET is not ABAP-served", async () => {
      const r = express.Router();
      r.all("/sap/bc/adt/core/http/systeminformation", (req, res) => res.end());
      const reg = walk(r).registrations;
      expect(reg).to.deep.equal([{method: "*", path: "/sap/bc/adt/core/http/systeminformation"}]);
      const [v] = await dialogStep(async () => verdictsOf(reg, await globalThis.abap.Classes.ZCL_OSD_ADT_ROUTER.routes()),
        "test: the coverage gate's all() probe");
      expect(v.probes.find((p) => p.sample.startsWith("GET ")).row.servedBy).to.equal("ABAP");
      expect(anyAbap(v)).to.equal(true);
      expect(abapServed(v)).to.equal(false);
    });

    it("a synthetic HOST_ALLOWED entry served by ABAP is refused, even for one method", async () => {
      const reg = [{method: "*", path: "/sap/bc/adt/core/http/systeminformation"}];
      const allowed = new Map([["* /sap/bc/adt/core/http/systeminformation", "synthetic orchestration"]]);
      const [v] = await dialogStep(async () => verdictsOf(reg, await globalThis.abap.Classes.ZCL_OSD_ADT_ROUTER.routes()),
        "test: the coverage gate's host orchestration probe");
      expect(allowed.has(v.key)).to.equal(true);
      expect(anyAbap(v)).to.equal(true);
      expect(hostServed(v), "orchestration stays on the host (variant C)").to.equal(false);
    });

    it("an all() route is asked with every method Express routes, one left out is not ABAP-served", async () => {
      expect(ALL_METHODS).to.include.members(["GET", "POST", "LOCK", "MKCOL", "SEARCH"]);
      const SYSINFO = "/sap/bc/adt/core/http/systeminformation";
      const reg = [{method: "*", path: SYSINFO}];
      const verdict = (except) => dialogStep(async () => {
        const rows = globalThis.abap.Classes.ZCL_OSD_ADT_ROUTER.METHODS.DISPATCH.parameters.IT_ROUTES.type();
        // HEAD first: the ABAP router lets HEAD fall through to an earlier GET row
        const order = [...ALL_METHODS].sort((x, y) => (y === "HEAD") - (x === "HEAD"));
        for (const method of order.filter((m) => m !== except)) {
          const row = rows.appendInitial().get();
          row.method.set(method); row.pattern.set(SYSINFO); row.handler.set("ZCL_OSD_ADT_SYSINFO"); row.served_by.set("ABAP");
        }
        return (await verdictsOf(reg, rows))[0];
      }, "test: the coverage gate's method list");
      expect(abapServed(await verdict(undefined))).to.equal(true);
      const missing = await verdict("LOCK");
      expect(abapServed(missing)).to.equal(false);
      expect(missing.probes.filter((p) => !probeAbap(p)).map((p) => p.sample)).to.deep.equal([`LOCK ${SYSINFO}`]);
    });
  });
});
