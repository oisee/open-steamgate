// The done gate of the ADT-on-ABAP port (docs/adt-abap-port/port-plan.md,
// section 2 "Done gate" and section 4 "What 100% means"): every Express
// registration of the façade's adtRouter is asked of the ABAP front's own
// matcher, ZCL_OSD_ADT_ROUTER=>MATCH over =>ROUTES, with a sample instance
// of its pattern, and must land on an ABAP row -- unless it is listed below.
//
// HOST_ALLOWED is every registration not yet ported, as of origin/main when
// this test was written, grouped by the slice that ports it. Each slice
// deletes its own block. The check runs both ways: a listed registration
// that ABAP serves fails ("remove it"), and an unlisted one that ABAP does
// not serve fails ("port it or list it"). Done is HOST_ALLOWED empty and
// exactly one HOST row in the table, the catch-all.
import {expect} from "chai";
import {mkdtempSync, rmSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import express from "express";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";

const CATCH_ALL = "* /sap/bc/adt/*";

// Section 4 of the plan: no route family keeps a HOST row; continuations
// (activation, ABAP Unit, notebook) and host work (parse, SQL, git) sit
// behind ABAP rows. What stays on the host by design is the catch-all alone.
const HOST_BY_DESIGN = new Map([
  [CATCH_ALL, "the catch-all: a path no row names is the Node façade's 404 (plan section 4)"],
]);

const HOST_ALLOWED = [
  // A1: discovery and debugger/listeners
  "HEAD /sap/bc/adt/core/discovery",
  "GET /sap/bc/adt/core/discovery",
  "HEAD /sap/bc/adt/discovery",
  "GET /sap/bc/adt/discovery",
  "GET /sap/bc/adt/debugger/listeners",
  "POST /sap/bc/adt/debugger/listeners",
  "DELETE /sap/bc/adt/debugger/listeners",
  // A2: feeds, system/users, transport check, occurrence markers
  "GET /sap/bc/adt/feeds",
  "GET /sap/bc/adt/feeds/variants",
  "GET /sap/bc/adt/system/users",
  "GET /sap/bc/adt/runtime/dumps",
  "GET /sap/bc/adt/runtime/systemmessages",
  "GET /sap/bc/adt/gw/errorlog",
  "POST /sap/bc/adt/cts/transportchecks",
  "POST /sap/bc/adt/abapsource/occurencemarkers",
  // A3a: sessions and logoff
  "GET /sap/bc/adt/core/http/sessions",
  "DELETE /sap/bc/adt/core/http/sessions/:id",
  "GET /sap/public/bc/icf/logoff",
  // A3b: reentrance ticket
  "GET /sap/bc/adt/core/http/reentranceticket",
  // A4: write path (PUT source, includes)
  "PUT /sap/bc/adt/oo/classes/:name/source/main",
  "PUT /sap/bc/adt/oo/classes/:name/includes/:include",
  "PUT /sap/bc/adt/oo/classes/:name/includes/:include/source/main",
  "POST /sap/bc/adt/oo/classes/:name/includes",
  "PUT /sap/bc/adt/oo/interfaces/:name/source/main",
  "PUT /sap/bc/adt/programs/programs/:name/source/main",
  "PUT /sap/bc/adt/ddic/ddl/sources/:name/source/main",
  "PUT /sap/bc/adt/ddic/srvd/sources/:name/source/main",
  "PUT /sap/bc/adt/programs/includes/:name/source/main",
  // A5: create and delete
  "POST /sap/bc/adt/oo/classes",
  "DELETE /sap/bc/adt/oo/classes/:name",
  "POST /sap/bc/adt/oo/interfaces",
  "DELETE /sap/bc/adt/oo/interfaces/:name",
  "POST /sap/bc/adt/programs/programs",
  "DELETE /sap/bc/adt/programs/programs/:name",
  "POST /sap/bc/adt/ddic/ddl/sources",
  "DELETE /sap/bc/adt/ddic/ddl/sources/:name",
  "POST /sap/bc/adt/ddic/srvd/sources",
  "DELETE /sap/bc/adt/ddic/srvd/sources/:name",
  "POST /sap/bc/adt/programs/includes",
  "DELETE /sap/bc/adt/programs/includes/:name",
  "POST /sap/bc/adt/packages",
  "DELETE /sap/bc/adt/packages/:name",
  // A6 / A7: inactive objects and activation (continuation behind an ABAP row)
  "GET /sap/bc/adt/activation/inactiveobjects",
  "POST /sap/bc/adt/activation",
  // A8a: thin introspection rows
  "GET /sap/bc/adt/core/http/build",
  "GET /sap/bc/adt/core/http/changed",
  "GET /sap/bc/adt/core/http/services",
  "GET /sap/bc/adt/core/http/transactions",
  // A8b: git
  "GET /sap/bc/adt/core/http/git/object",
  "GET /sap/bc/adt/core/http/git/object/revision",
  // A9: xref
  "GET /sap/bc/adt/core/http/xref/readers",
  "GET /sap/bc/adt/core/http/xref/closure",
  // A10: segw entity sets
  "GET /sap/bc/adt/core/http/segw/entitysets",
  // B2a: source read and bare object documents
  "GET /sap/bc/adt/oo/classes/:name/source/main",
  "GET /sap/bc/adt/oo/classes/:name/includes/:include",
  "GET /sap/bc/adt/oo/classes/:name/includes/:include/source/main",
  "GET /sap/bc/adt/oo/classes/:name",
  "GET /sap/bc/adt/oo/interfaces/:name/source/main",
  "GET /sap/bc/adt/oo/interfaces/:name/includes/:include",
  "GET /sap/bc/adt/oo/interfaces/:name/includes/:include/source/main",
  "GET /sap/bc/adt/oo/interfaces/:name",
  "GET /sap/bc/adt/programs/programs/:name/source/main",
  "GET /sap/bc/adt/programs/programs/:name/includes/:include",
  "GET /sap/bc/adt/programs/programs/:name/includes/:include/source/main",
  "GET /sap/bc/adt/programs/programs/:name",
  "GET /sap/bc/adt/ddic/ddl/sources/:name/source/main",
  "GET /sap/bc/adt/ddic/ddl/sources/:name/includes/:include",
  "GET /sap/bc/adt/ddic/ddl/sources/:name/includes/:include/source/main",
  "GET /sap/bc/adt/ddic/ddl/sources/:name",
  "GET /sap/bc/adt/ddic/srvd/sources/:name/source/main",
  "GET /sap/bc/adt/ddic/srvd/sources/:name/includes/:include",
  "GET /sap/bc/adt/ddic/srvd/sources/:name/includes/:include/source/main",
  "GET /sap/bc/adt/programs/includes/:name/source/main",
  "GET /sap/bc/adt/programs/includes/:name/includes/:include",
  "GET /sap/bc/adt/programs/includes/:name/includes/:include/source/main",
  // B2b: object structure and the INCL/SRVD bare alias
  "GET /sap/bc/adt/oo/classes/:name/objectstructure",
  "GET /sap/bc/adt/oo/interfaces/:name/objectstructure",
  "GET /sap/bc/adt/programs/programs/:name/objectstructure",
  "GET /sap/bc/adt/ddic/ddl/sources/:name/objectstructure",
  "GET /sap/bc/adt/ddic/srvd/sources/:name/objectstructure",
  "GET /sap/bc/adt/programs/includes/:name/objectstructure",
  "GET /sap/bc/adt/ddic/srvd/sources/:name",
  "GET /sap/bc/adt/programs/includes/:name",
  // B5: package read, node path, node structure
  "GET /sap/bc/adt/packages/:name",
  "POST /sap/bc/adt/repository/nodepath",
  "POST /sap/bc/adt/repository/nodestructure",
  // B6: search and virtual folders
  "POST /sap/bc/adt/repository/informationsystem/virtualfolders/contents",
  "GET /sap/bc/adt/repository/informationsystem/search",
  // B8a: type structure and the table parser info
  "POST /sap/bc/adt/repository/typestructure",
  "GET /sap/bc/adt/ddic/tables/parser/info",
  // B8b: DDIC documents
  "GET /sap/bc/adt/ddic/dataelements/:name",
  "GET /sap/bc/adt/ddic/tables/:name",
  "GET /sap/bc/adt/ddic/tables/:name/source/main",
  // C1: check runs
  "GET /sap/bc/adt/checkruns/reporters",
  "POST /sap/bc/adt/checkruns",
  // C2a: ABAP Unit metadata and plan
  "GET /sap/bc/adt/abapunit/metadata",
  "GET /sap/bc/adt/core/http/unit/object",
  // C2b: ABAP Unit test runs (continuation behind an ABAP row)
  "POST /sap/bc/adt/abapunit/testruns/evaluation",
  "POST /sap/bc/adt/abapunit/testruns",
  // C3: unit/object/run (continuation behind an ABAP row)
  "POST /sap/bc/adt/core/http/unit/object/run",
  // C4a: freestyle data preview
  "POST /sap/bc/adt/datapreview/freestyle",
  // C4b: ddic and cds data preview
  "GET /sap/bc/adt/datapreview/ddic/:name/metadata",
  "POST /sap/bc/adt/datapreview/ddic",
  "GET /sap/bc/adt/datapreview/cds/:name/metadata",
  "POST /sap/bc/adt/datapreview/cds",
  // C5: classrun
  "POST /sap/bc/adt/oo/classrun/:name",
  // C6: notebook (continuation behind an ABAP row)
  "POST /sap/bc/adt/notebook/abap",
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


describe("ADT on ABAP: the done gate (every adtRouter registration has an ABAP row)", function () {
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
    regs = walks.abap.registrations;
    ({table, verdicts} = await dialogStep(async () => {
      const rows = await globalThis.abap.Classes.ZCL_OSD_ADT_ROUTER.routes();
      return {table: rows.array().map((line) => {
        const r = line.get();
        return {method: text(r.method), pattern: text(r.pattern), handler: text(r.handler), servedBy: text(r.served_by)};
      }), verdicts: await verdictsOf(regs, rows)};
    }, "test: the coverage gate's match"));
  });
  after(() => { if (root !== undefined) rmSync(root, {recursive: true, force: true}); });

  it("every layer that is not a route is known middleware, and the registrations do not depend on the mount", () => {
    const expected = {node: ["sessions", "generation"], dump: ["sessions", "generation", "dump"],
      abap: ["generation", "abap-front"], "dump+abap": ["generation", "dump", "abap-front"]};
    const keys = (w) => w.registrations.map((r) => `${r.method} ${r.path}`);
    for (const [name, w] of Object.entries(walks)) {
      expect(w.unclassified, `${name}: use layers that are not the middleware adtRouter mounted`).to.deep.equal([]);
      expect(w.reported.filter((id) => MIDDLEWARE[id] === undefined), `${name}: middleware with no reason here`).to.deep.equal([]);
      // each reported layer found on the stack exactly once, and only those
      expect(w.middleware, `${name}: middleware on the stack`).to.deep.equal(w.reported);
      expect(w.middleware, `${name}: middleware for this mount`).to.deep.equal(expected[name]);
      expect(keys(w), `${name}: registrations`).to.deep.equal(keys(walks.abap));
    }
  });

  it("the router table has exactly one HOST row, the catch-all, and it is last", () => {
    const host = table.filter((r) => r.servedBy !== "ABAP");
    expect(host.map((r) => `${r.method} ${r.pattern} ${r.servedBy}`), "HOST rows").to.deep.equal([`${CATCH_ALL} HOST`]);
    expect(table.at(-1).pattern).to.equal("/sap/bc/adt/*");
  });

  it("the lists are well formed: no duplicates, no overlap, every entry names a registration", () => {
    expect(HOST_ALLOWED.filter((e, i) => HOST_ALLOWED.indexOf(e) !== i), "duplicates in HOST_ALLOWED").to.deep.equal([]);
    expect(HOST_ALLOWED.filter((e) => HOST_BY_DESIGN.has(e)), "in both lists").to.deep.equal([]);
    const keys = new Set(regs.map((r) => `${r.method} ${r.path}`));
    expect(keys.size, "a registration twice on the stack").to.equal(regs.length);
    expect(table.filter((r, i) => table.findIndex((o) => o.method === r.method && o.pattern === r.pattern) !== i)
      .map((r) => `${r.method} ${r.pattern}`), "a row twice in ROUTES").to.deep.equal([]);
    const stale = [...HOST_ALLOWED, ...HOST_BY_DESIGN.keys()].filter((e) => !keys.has(e));
    expect(stale, "entries no adtRouter registration has: remove them").to.deep.equal([]);
  });

  it("every registration not listed is served by ABAP, every method of it, by the row of its own pattern", () => {
    const missing = verdicts.filter((v) => !HOST_ALLOWED.includes(v.key) && !HOST_BY_DESIGN.has(v.key) && !abapServed(v));
    expect(missing.map((v) => `${v.key} (${v.probes.filter((p) => !probeAbap(p) || shape(p.row.pattern) !== shape(v.path))
      .map((p) => `${p.sample} -> ${where(p)}`).join("; ")})`),
    "not served by ABAP: port them, or list them under the slice that will port them").to.deep.equal([]);
  });

  it("no registration in HOST_ALLOWED is served by ABAP, not even for one method", () => {
    const ported = verdicts.filter((v) => HOST_ALLOWED.includes(v.key) && anyAbap(v));
    expect(ported.map((v) => `${v.key} (${v.probes.filter(probeAbap).map((p) => `${p.sample} -> ${where(p)} (${p.row.handler})`).join("; ")})`),
      "served by ABAP now: remove it from HOST_ALLOWED").to.deep.equal([]);
  });

  it("what stays on the host by design reaches the catch-all, for every method", () => {
    for (const key of HOST_BY_DESIGN.keys()) {
      const v = verdicts.find((one) => one.key === key);
      expect(v, key).to.not.equal(undefined);
      expect(v.probes.filter((p) => !atCatchAll(p)).map((p) => `${p.sample} -> ${where(p)}`), `${key}: ${HOST_BY_DESIGN.get(key)}`)
        .to.deep.equal([]);
    }
    const abap = verdicts.filter(abapServed).length;
    console.log(`      ADT on ABAP: ${HOST_ALLOWED.length} of ${regs.length} registrations still on the host ` +
      `(${abap} ABAP, ${HOST_BY_DESIGN.size} host by design)${HOST_ALLOWED.length === 0 ? " -- done" : ""}`);
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
