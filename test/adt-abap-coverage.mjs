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
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";

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
  // B1: information system statics
  "GET /sap/bc/adt/repository/informationsystem/virtualfolders/facets",
  "GET /sap/bc/adt/repository/informationsystem/objecttypes",
  "GET /sap/bc/adt/repository/informationsystem/releasestates",
  "GET /sap/bc/adt/repository/informationsystem/objectproperties/values",
  "GET /sap/bc/adt/packages/settings",
  "GET /sap/bc/adt/packages/valuehelps/:what",
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

// a value per parameter name, so a sample path reads like a request
const SAMPLE = {name: "zosd_coverage", include: "testclasses", stamp: "19700101101123", version: "00000",
  id: "0123456789abcdef01234567", what: "softwarecomponents"};

/** method and path of every registration on the router's stack, in order */
function registrations(router) {
  const out = [];
  for (const layer of router.stack) {
    if (layer.route === undefined) continue;
    const {path} = layer.route;
    if (typeof path !== "string") throw new Error(`a route path that is not a string: ${String(path)}`);
    for (const method of Object.keys(layer.route.methods)) {
      out.push({method: method === "_all" ? "*" : method.toUpperCase(), path});
    }
  }
  return out;
}

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

// the shape of a pattern: parameter names do not matter, case does not
const shape = (pattern) => pattern.toLowerCase().replace(/\/:[^/]+/g, "/:");

const text = (value) => String(value?.get?.() ?? value ?? "").trimEnd();

describe("ADT on ABAP: the done gate (every adtRouter registration has an ABAP row)", function () {
  this.timeout(60000);
  let root;
  let regs;
  let table;
  let verdicts;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-adt-coverage-"));
    regs = registrations(adtRouter({root, data: {}, logMisses: false, watch: false}).router);
    ({table, verdicts} = await dialogStep(async () => {
      const a = globalThis.abap;
      const router = a.Classes.ZCL_OSD_ADT_ROUTER;
      const rows = await router.routes();
      const out = [];
      for (const reg of regs) {
        const method = reg.method === "*" ? "GET" : reg.method;
        const path = sampleOf(reg.path);
        const found = new a.types.Character(1);
        const route = router.METHODS.MATCH.parameters.ES_ROUTE.type();
        await router.match({it_routes: rows, iv_method: new a.types.String().set(method),
          iv_path: new a.types.String().set(path), ev_found: found, es_route: route});
        const r = route.get();
        out.push({key: `${reg.method} ${reg.path}`, sample: `${method} ${path}`, found: found.get() === "X",
          row: {method: text(r.method), pattern: text(r.pattern), handler: text(r.handler), servedBy: text(r.served_by)}});
      }
      return {table: rows.array().map((line) => {
        const r = line.get();
        return {method: text(r.method), pattern: text(r.pattern), handler: text(r.handler), servedBy: text(r.served_by)};
      }), verdicts: out};
    }, "test: the coverage gate's match"));
  });
  after(() => { if (root !== undefined) rmSync(root, {recursive: true, force: true}); });

  const abapServed = (v) => v.found && v.row.servedBy === "ABAP";

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
    const stale = [...HOST_ALLOWED, ...HOST_BY_DESIGN.keys()].filter((e) => !keys.has(e));
    expect(stale, "entries no adtRouter registration has: remove them").to.deep.equal([]);
  });

  it("every registration not listed is served by ABAP, by the row of its own pattern", () => {
    const missing = verdicts.filter((v) => !HOST_ALLOWED.includes(v.key) && !HOST_BY_DESIGN.has(v.key) && !abapServed(v));
    expect(missing.map((v) => `${v.key} (${v.sample} -> ${v.found ? `${v.row.servedBy} ${v.row.pattern}` : "no row"})`),
      "served by the host: port them or add them to HOST_ALLOWED").to.deep.equal([]);
    // a sample that lands on an ABAP row of another shape is a shadow, not coverage
    const shadowed = verdicts.filter((v) => abapServed(v) && shape(v.row.pattern) !== shape(v.key.slice(v.key.indexOf(" ") + 1)));
    expect(shadowed.map((v) => `${v.key} matched ${v.row.method} ${v.row.pattern}`), "matched by a row of another pattern")
      .to.deep.equal([]);
  });

  it("no registration in HOST_ALLOWED is served by ABAP", () => {
    const ported = verdicts.filter((v) => HOST_ALLOWED.includes(v.key) && abapServed(v));
    expect(ported.map((v) => `${v.key} (${v.row.handler})`), "served by ABAP now: remove it from HOST_ALLOWED")
      .to.deep.equal([]);
  });

  it("what stays on the host by design reaches the catch-all", () => {
    for (const key of HOST_BY_DESIGN.keys()) {
      const v = verdicts.find((one) => one.key === key);
      expect(v, key).to.not.equal(undefined);
      expect(v.found && v.row.servedBy === "HOST" && v.row.pattern === "/sap/bc/adt/*", `${key}: ${HOST_BY_DESIGN.get(key)}`).to.equal(true);
    }
    const abap = verdicts.filter(abapServed).length;
    console.log(`      ADT on ABAP: ${HOST_ALLOWED.length} of ${regs.length} registrations still on the host ` +
      `(${abap} ABAP, ${HOST_BY_DESIGN.size} host by design)${HOST_ALLOWED.length === 0 ? " -- done" : ""}`);
  });
});
