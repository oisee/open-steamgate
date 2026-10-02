// Migration gate 1 for the ADT façade in ABAP (ADR 0007, slice 1): every
// route ZCL_OSD_ADT_ROUTER serves answers what the Node façade answers --
// status, content type, length, entity tag and body, byte for byte -- and
// every route it does not serve still reaches the Node façade unchanged,
// without ABAP being asked and whatever state the ABAP side is in.
//
// Two adtRouters over one store: one plain, one with the ABAP front
// (tools/adt-abap-front.mjs) running the transpiled handler under
// dialogStep, the way test/start.mjs mounts it inline. The front reports
// who served each request, so a route that silently fell through to Node
// cannot pass as ported.
import {expect} from "chai";
import express from "express";
import {request as httpRequest} from "node:http";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {adtRouter, answered} from "../tools/adt-facade.mjs";
import {abapRunner, matchRoute, routeRows} from "../tools/adt-abap-front.mjs";
import {exceptionDocument} from "../tools/adt-documents.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

const output = (file) => import(new URL(`../output/${file}`, import.meta.url).href);

const SYSINFO = "/sap/bc/adt/core/http/systeminformation";

// what the ABAP serves today; the gate grows with every route that moves
const PORTED = [
  ["GET", SYSINFO],
  ["HEAD", SYSINFO],
  ["GET", "/sap/bc/adt/compatibility/graph"],
  ["HEAD", "/sap/bc/adt/compatibility/graph"],
  // Express routing is case-insensitive and non-strict, and so is the table
  ["GET", `${SYSINFO}/`],
  ["GET", "/SAP/BC/ADT/Compatibility/Graph"],
];

// still the Node façade's: the front must hand them over untouched
const DELEGATED = [
  ["GET", "/sap/bc/adt/discovery"],
  ["HEAD", "/sap/bc/adt/core/discovery"],
  // refused by the CSRF gate, which is still the Node session middleware's
  // and runs before the front: the front is not reached at all (slice 2)
  ["POST", SYSINFO, "nobody"],
  ["GET", "/sap/bc/adt/debugger/listeners"],
  ["GET", "/sap/bc/adt/packages/settings"],
  ["GET", "/sap/bc/adt/no/such/resource"],
  ["GET", `${SYSINFO}/extra`],
];

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function call(server, method, path) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {method});
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    length: response.headers.get("content-length"),
    etag: response.headers.get("etag"),
    body: Buffer.from(await response.arrayBuffer()).toString("utf8"),
  };
}

// a GET with a body, which fetch will not send
function withBody(server, path, body, type) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({host: "127.0.0.1", port: server.address().port, path, method: "GET",
      headers: {"content-type": type, "content-length": Buffer.byteLength(body)}}, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({status: res.statusCode, type: res.headers["content-type"],
        body: Buffer.concat(chunks).toString("utf8")}));
    });
    req.on("error", reject);
    req.end(body);
  });
}

describe("ADT façade in ABAP: gate 1 against the Node façade", function () {
  this.timeout(60000);
  let root;
  let abapSide;
  let router;
  const servers = [];
  const served = [];
  const steps = [];

  const mount = async (options, before = []) => {
    const app = express();
    for (const middleware of before) app.use(middleware);
    app.use(adtRouter({data: {}, logMisses: false, watch: false, ...options}).router);
    const server = await listen(app);
    servers.push(server);
    return server;
  };
  // every entry into the ABAP is counted, so "ABAP was not asked" is a fact
  const counted = (runner) => ({...runner, run: (args) => {
    steps.push(`${args.req.method} ${args.req.path}`);
    return runner.run(args);
  }});
  const withAbap = (options, runner = abapSide) => ({...options, abap: counted(runner),
    abapServed: (by, req) => served.push(`${by} ${req.method} ${req.originalUrl}`)});
  const store = () => new ObjectStore({root, libs: []});

  before(async () => {
    const {cl_express_icf_shim: shim} = await output("cl_express_icf_shim.clas.mjs");
    ({zcl_osd_adt_router: router} = await output("zcl_osd_adt_router.clas.mjs"));
    abapSide = abapRunner({shim, router, step: dialogStep});
    root = mkdtempSync(join(tmpdir(), "osd-adt-abap-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"]}));
  });

  beforeEach(() => {
    served.length = 0;
    steps.length = 0;
  });

  after(async () => {
    for (const server of servers) await new Promise((resolve) => server.close(resolve));
    rmSync(root, {recursive: true, force: true});
  });

  it("a ported route answers byte-equal, and ABAP is what answered it", async () => {
    const shared = store();
    const node = await mount({store: shared});
    const ported = await mount(withAbap({store: shared}));
    for (const [method, path] of PORTED) {
      served.length = 0;
      const expected = await call(node, method, path);
      const actual = await call(ported, method, path);
      expect(actual, `${method} ${path}`).to.deep.equal(expected);
      expect(served, `${method} ${path}`).to.deep.equal([`ABAP ${method} ${path}`]);
    }
  });

  it("a route ABAP does not serve reaches the Node façade unchanged, and no ABAP runs for it", async () => {
    const shared = store();
    const node = await mount({store: shared});
    const ported = await mount(withAbap({store: shared}));
    await call(ported, "GET", "/sap/bc/adt/discovery"); // the route table is read once, in a step of its own
    steps.length = 0;
    for (const [method, path, who = "HOST"] of DELEGATED) {
      served.length = 0;
      const expected = await call(node, method, path);
      const actual = await call(ported, method, path);
      // none of these carries a time or a session value, so the body compares
      // whole (a feed carries its time, which is why none is listed); the
      // catch-all's 404 names the path, and so do both
      expect(actual, `${method} ${path}`).to.deep.equal(expected);
      expect(served, `${method} ${path}`).to.deep.equal(who === "nobody" ? [] : [`${who} ${method} ${path}`]);
    }
    expect(steps, "no step for a HOST row").to.deep.equal([]);
  });

  it("a broken ABAP side answers the ADT exception document, and the Node routes keep answering", async () => {
    const shared = store();
    const node = await mount({store: shared});
    const broken = await mount(withAbap({store: shared}, {...abapSide, run: async () => {
      throw new Error("the shim fell over");
    }}));
    // the ABAP row: the Node façade's own refusal for the same failure
    const reference = express();
    reference.get(SYSINFO, (req, res) => answered(res, () => {
      throw new Error("ZCL_OSD_ADT_HANDLER: the shim fell over");
    }));
    const expected = await call(await listen(reference).then((s) => (servers.push(s), s)), "GET", SYSINFO);
    const actual = await call(broken, "GET", SYSINFO);
    expect(actual).to.deep.equal(expected);
    expect(actual.status).to.equal(500);
    expect(actual.type).to.equal("application/xml; charset=utf-8");
    expect(actual.body).to.contain("<type id=\"ExceptionInternalError\"/>");
    // and every HOST row is untouched by it
    for (const [method, path] of DELEGATED.filter(([, , who]) => who === undefined)) {
      expect(await call(broken, method, path), `${method} ${path}`).to.deep.equal(await call(node, method, path));
    }
  });

  it("a route table that fails to read once is asked again, not cached as 'Node serves everything'", async () => {
    const shared = store();
    let reads = 0;
    const flaky = {...abapSide, retryMs: 0, routes: async () => {
      reads += 1;
      if (reads === 1) throw new Error("the generation is not loaded yet");
      return abapSide.routes();
    }};
    const ported = await mount(withAbap({store: shared}, flaky));
    const [, path] = PORTED[0];
    served.length = 0;
    await call(ported, "GET", path); // the first read fails: Node answers it
    expect(served).to.deep.equal([`HOST GET ${path}`]);
    served.length = 0;
    await call(ported, "GET", path); // asked again: ABAP answers now
    expect(served).to.deep.equal([`ABAP GET ${path}`]);
    expect(reads).to.equal(2);
  });

  it("a ported row that raises answers on the wire what the Node façade answers for it", async () => {
    // SYSTEM IDENTITY refused by the host: ZCL_OSD_ADT_HOST raises
    // ZCX_OSD_ADT=>INTERNAL with the host's reason, the handler answers it
    // (a value the host cannot serialise is how a host refuses here)
    const ported = await mount(withAbap({store: store(), identity: {
      refused: {toJSON() { throw new Error("no identity on this host"); }},
    }}));
    const reference = express();
    reference.get(SYSINFO, (req, res) => answered(res, () => {
      throw new Error("SYSTEM IDENTITY: no identity on this host");
    }));
    const referenceServer = await listen(reference);
    servers.push(referenceServer);
    for (const method of ["GET", "HEAD"]) {
      const expected = await call(referenceServer, method, SYSINFO);
      const actual = await call(ported, method, SYSINFO);
      expect(actual, method).to.deep.equal(expected);
    }
    expect((await call(ported, "GET", SYSINFO)).status).to.equal(500);
    expect(steps, "the ABAP answered it").to.have.length(3);
  });

  it("each façade instance answers its own identity, also when requests interleave", async () => {
    const shared = store();
    const identities = [
      {systemID: "OSX", userFullName: "Ann \"Q\" \\ Lee"},
      {systemID: "OSY", userName: "TESTER", client: "002", language: "DE"},
    ];
    const pairs = [];
    for (const identity of identities) {
      pairs.push([await mount({store: shared, ...identity}), await mount(withAbap({store: shared, ...identity}))]);
    }
    const answers = await Promise.all([...Array(4)].flatMap(() =>
      pairs.map(([node, ported]) => Promise.all([call(node, "GET", SYSINFO), call(ported, "GET", SYSINFO)]))));
    for (const [expected, actual] of answers) {
      expect(actual).to.deep.equal(expected);
    }
    expect(JSON.parse(answers[0][1].body).userFullName).to.equal("Ann \"Q\" \\ Lee");
    expect(JSON.parse(answers[1][1].body).systemID).to.equal("OSY");
  });

  it("SYSTEM that no façade instance bound is refused, not answered from the environment", async () => {
    const box = () => new abap.types.String();
    const signature = {
      exporting: {IV_COMMAND: new abap.types.String().set("SYSTEM"), IV_TYPE: new abap.types.String().set("IDENTITY")},
      importing: {EV_JSON: box(), EV_ERROR: box()},
    };
    await new StoreDestination({store: undefined}).call("ZOSD_STORE", signature);
    expect(signature.importing.EV_JSON.get()).to.equal("");
    expect(signature.importing.EV_ERROR.get()).to.match(/^nothing answers SYSTEM IDENTITY/);
  });

  it("the front's matcher and ZCL_OSD_ADT_ROUTER=>MATCH pick the same row", async () => {
    const abapMatch = async (table, method, path) => {
      const route = new abap.types.Structure({method: new abap.types.String(), pattern: new abap.types.String(),
        handler: new abap.types.String(), served_by: new abap.types.String()});
      const found = new abap.types.Character(1);
      await router.match({it_routes: table, iv_method: method, iv_path: path, ev_found: found, es_route: route});
      return found.get() === "X" ? `${route.get().method.get()} ${route.get().pattern.get()}` : "none";
    };
    const real = await router.routes();
    const synthetic = real.clone();
    synthetic.clear();
    for (const [method, pattern, servedBy] of [
      ["GET", "/sap/bc/adt/packages/valuehelps/:what", "ABAP"],
      ["GET", "/sap/bc/adt/packages/:name", "ABAP"],
      ["HEAD", "/sap/bc/adt/discovery", "ABAP"],
      ["GET", "/sap/bc/adt/discovery", "HOST"],
      ["POST", "/sap/bc/adt/oo/classes/:name/includes", "ABAP"],
      ["*", "/sap/bc/adt/*", "HOST"],
    ]) {
      const row = synthetic.appendInitial().get();
      row.method.set(method);
      row.pattern.set(pattern);
      row.served_by.set(servedBy);
    }
    const paths = ["/sap/bc/adt/packages/zpkg", "/sap/bc/adt/packages/valuehelps/x", "/sap/bc/adt/packages/",
      "/sap/bc/adt/packages//x", "/SAP/bc/ADT/Discovery/", "/sap/bc/adt/discovery", "/sap/bc/adt/oo/classes/zcl_x/includes",
      "/sap/bc/adt/oo/classes//includes", "/sap/bc/adt", "/sap/bc/adt/", "/sap/bc/other", SYSINFO, `${SYSINFO}/`,
      `${SYSINFO}/x`, "/sap/bc/adt/compatibility/graph", "/sap/bc/adt/packages/%zz", "/sap/bc/adt//packages/zpkg"];
    for (const table of [real, synthetic]) {
      const rows = routeRows(table);
      for (const method of ["GET", "HEAD", "POST", "DELETE"]) {
        for (const path of paths) {
          const js = matchRoute(rows, method, path);
          expect(js === undefined ? "none" : `${js.method} ${js.pattern}`, `${method} ${path}`)
            .to.equal(await abapMatch(table, method, path));
        }
      }
    }
  });

  it("the body reaches ABAP as bytes, however the host buffered it, and a parsed one is refused", async () => {
    const bodies = [];
    const echo = {
      routes: async () => [{method: "GET", pattern: SYSINFO, handler: "X", served_by: "ABAP"},
        {method: "*", pattern: "/sap/bc/adt/*", handler: "", served_by: "HOST"}],
      run: async ({req, res}) => {
        bodies.push(req.body.toString("utf8"));
        res.append("content-type", "text/plain");
        res.status(200).send(Buffer.from("ok"));
      },
    };
    const streamed = await mount(withAbap({store: store()}, echo));
    const raw = await mount(withAbap({store: store()}, echo), [express.raw({type: "*/*"})]);
    const text = await mount(withAbap({store: store()}, echo), [express.text({type: "*/*"})]);
    const json = await mount(withAbap({store: store()}, echo), [express.json()]);
    for (const server of [streamed, raw, text]) {
      expect((await withBody(server, SYSINFO, "{\"a\":1}", "application/json")).status).to.equal(200);
    }
    expect(bodies).to.deep.equal(["{\"a\":1}", "{\"a\":1}", "{\"a\":1}"]);
    // a parser that skipped a request without a body leaves {}: nothing lost
    expect((await call(json, "GET", SYSINFO)).status).to.equal(200);
    const refused = await withBody(json, SYSINFO, "{\"a\":1}", "application/json");
    expect(refused.status).to.equal(500);
    expect(refused.type).to.equal("application/xml; charset=utf-8");
    expect(refused.body).to.contain("mount it behind express.raw");
    expect(bodies).to.have.length(4);
  });

  it("the exception document is byte-equal to the Node façade's", async () => {
    const {zcx_osd_adt: zcx} = await output("zcx_osd_adt.clas.mjs");
    const text = (value) => new abap.types.String().set(value);
    const documentOf = async (status, type, message, namespace, properties = []) => {
      const table = (await new zcx().constructor_({})).properties.clone();
      for (const [key, value] of properties) {
        const row = table.appendInitial();
        row.get().name.set(key);
        row.get().value.set(value);
      }
      const error = await new zcx().constructor_({
        iv_status: new abap.types.Integer().set(status), iv_type: text(type), iv_message: text(message),
        ...(namespace === undefined ? {} : {iv_namespace: text(namespace)}),
        it_properties: table,
      });
      return (await error.document()).get();
    };
    const cases = [
      [404, "ExceptionResourceNotFound", "CLAS ZCL_NONE does not exist"],
      [500, "ExceptionInternalError", "boom <&> \"quoted\"", "org.open-steamgate.osd"],
      [403, "ExceptionResourceNoAccess", "User DEVELOPER is currently editing ZCL_X", undefined, [
        ["LONGTEXT", "ZCL_X is locked by another editing session of user DEVELOPER."],
        ["T100KEY-ID", "EU"], ["T100KEY-NO", "510"], ["T100KEY-V1", "DEVELOPER"], ["T100KEY-V2", "<ZCL_X & co>"],
      ]],
      [409, "ExceptionResourceIsModified", "änderung – geändert"],
    ];
    for (const [status, type, message, namespace, properties] of cases) {
      const expected = exceptionDocument(type, message, {
        ...(namespace === undefined ? {} : {namespace}),
        ...(properties === undefined ? {} : {properties}),
      });
      expect(await documentOf(status, type, message, namespace, properties), type).to.equal(expected);
    }
  });
});
