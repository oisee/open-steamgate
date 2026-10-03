// Migration gate 1 for the ADT façade in ABAP (ADR 0007, slices 1 to 3): every
// route ZCL_OSD_ADT_ROUTER serves answers what the Node façade answers --
// status, content type, length, entity tag and body, byte for byte -- and
// every route it does not serve still reaches the Node façade unchanged,
// after the handler's step has resolved its session and gated it (slice 3,
// option B: every request enters ZCL_OSD_ADT_HANDLER first).
//
// Two adtRouters over one store: one plain (Node's Sessions and its
// middleware), one with the ABAP front (tools/adt-abap-front.mjs) running the
// transpiled handler under dialogStep with ABAP sessions, the way
// test/start.mjs mounts it inline. The front reports who served each
// request, so a route that silently fell through to Node cannot pass as
// ported, and every entry into the handler is counted.
import {remoteForTest} from "./helpers/adt-remote.mjs";
import {expect} from "chai";
import express from "express";
import {request as httpRequest} from "node:http";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {adtRouter, answered} from "../tools/adt-facade.mjs";
import {abapRunner, abapFront} from "../tools/adt-abap-front.mjs";
import {abapSession} from "../tools/adt-enq.mjs";
import {AbapSessions} from "../tools/adt-abap-sessions.mjs";
import {exceptionDocument} from "../tools/adt-documents.mjs";
import {StoreDestination, withSystem} from "../tools/osd-store-destination.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {SESSION_COOKIE} from "../tools/adt-session.mjs";

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
  // refused by the CSRF gate, which is the handler's now (slice 3): ABAP
  // answers it, with the bytes of the Node middleware's refusal
  ["POST", SYSINFO, "ABAP"],
  ["GET", "/sap/bc/adt/debugger/listeners"],
  ["GET", "/sap/bc/adt/no/such/resource"],
  ["GET", `${SYSINFO}/extra`],
];

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function call(server, method, path, headers, complete = false) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {method, headers});
  let sessionHeaders = {};
  if (complete) {
    const cookies = response.headers.getSetCookie();
    expect(cookies).to.have.length(2);
    const ids = cookies.map((line) => {
      const id = /^[^=]+=([0-9a-f]{24});/.exec(line)?.[1];
      expect(id, line).to.match(/^[0-9a-f]{24}$/);
      return id;
    });
    expect(ids[0]).to.equal(ids[1]);
    sessionHeaders = {location: response.headers.get("location")?.replace(/\?$/, ""),
      cookies: cookies.map((line) => line.replace(/=([0-9a-f]{24});/, "=<session>;"))};
  }
  return {
    ...sessionHeaders,
    status: response.status,
    type: response.headers.get("content-type"),
    length: response.headers.get("content-length"),
    etag: response.headers.get("etag"),
    history: response.headers.get("x-osd-history"),
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
  let wireSide;
  let remoteRuntime;
  const servers = [];
  const served = [];
  const steps = [];

  const mount = async (options, before = []) => {
    const app = express();
    app.set("etag", false);
    for (const middleware of before) app.use(middleware);
    app.use(adtRouter({data: {}, logMisses: false, watch: false, ...options}).router);
    const server = await listen(app);
    servers.push(server);
    return server;
  };
  // every entry into the handler is counted, so "ABAP was asked" is a fact
  const counted = (runner) => ({...runner,
    ...(runner.execute === undefined ? {} : {execute: (view, req, options) => {
      steps.push(`${view.method} ${view.path}`);
      return runner.execute(view, req, options);
    }}), answer: (view, session) => {
    steps.push(`${view.method} ${view.path}`);
    return runner.answer(view, session);
  }});
  const withAbap = (options, runner = options.sessions === undefined ? wireSide : abapSide) => ({...options, abap: counted(runner),
    abapServed: (by, req) => served.push(`${by} ${req.method} ${req.originalUrl.replace(/\?$/, "")}`)});
  const store = () => new ObjectStore({root, libs: []});

  it("versions slice: every feed, source and refusal is served by ABAP and byte-equal", async () => {
    const versionRoot = mkdtempSync(join(tmpdir(), "osd-adt-ver-gate-"));
    const file = (name, value) => writeFileSync(join(versionRoot, "src", name), value);
    const git = (...args) => execFileSync("git", args, {cwd: versionRoot, stdio: ["ignore", "pipe", "pipe"]});
    try {
      mkdirSync(join(versionRoot, "src"));
      file("zcl_osd_ver.clas.abap", "CLASS zcl_osd_ver DEFINITION. ENDCLASS.\nCLASS zcl_osd_ver IMPLEMENTATION. ENDCLASS.\n");
      file("zcl_osd_ver.clas.locals_imp.abap", "* first include\n");
      file("zif_osd_ver.intf.abap", "INTERFACE zif_osd_ver. ENDINTERFACE.\n");
      file("zosd_ver.prog.abap", "REPORT zosd_ver.\n");
      file("zosd_ver.ddls.asddls", "define view entity ZOSD_VER_ENTITY as select from zosd_stub { mandt }\n");
      git("init", "-q");
      git("config", "user.name", "Test Author");
      git("config", "user.email", "test@example.invalid");
      git("add", ".");
      git("commit", "-q", "-m", "first & <one> "+ "x".repeat(90));
      file("zcl_osd_ver.clas.abap", "CLASS zcl_osd_ver DEFINITION. ENDCLASS.\nCLASS zcl_osd_ver IMPLEMENTATION. * second\nENDCLASS.\n");
      file("zcl_osd_ver.clas.locals_imp.abap", "* second include\n");
      git("commit", "-q", "-am", "second class revision");
      file("zcl_osd_ver.clas.abap", "CLASS zcl_osd_ver DEFINITION. ENDCLASS.\nCLASS zcl_osd_ver IMPLEMENTATION. * active\nENDCLASS.\n");
      const shared = new ObjectStore({root: versionRoot, libs: []});
      const node = await mount({store: shared});
      const ported = await mount(withAbap({store: shared}));
      const bases = [
        "/sap/bc/adt/oo/classes/zcl_osd_ver/source/main/versions",
        "/sap/bc/adt/oo/classes/zcl_osd_ver/includes/implementations/versions",
        "/sap/bc/adt/oo/classes/zcl_osd_ver/includes/testclasses/versions",
        "/sap/bc/adt/oo/interfaces/zif_osd_ver/includes/main/versions",
        "/sap/bc/adt/programs/programs/zosd_ver/source/main/versions",
        "/sap/bc/adt/ddic/ddl/sources/zosd_ver/versions",
        "/sap/bc/adt/ddic/ddl/sources/zosd_ver_entity/versions",
      ];
      const cases = bases.map((path) => ["GET", path]);
      for (const base of bases) {
        for (const version of ["00000", "00001", "00002", "99999", "bad"]) {
          cases.push(["GET", `${base}/19700101101123/${version}/content`]);
        }
      }
      cases.push(["GET", "/sap/bc/adt/oo/interfaces/zif_osd_ver/includes/definitions/versions"]);
      cases.push(["GET", "/sap/bc/adt/oo/classes/zcl_osd_ver/includes/unknown/versions"]);
      cases.push(["GET", "/sap/bc/adt/oo/classes/zcl_osd_ver_none/source/main/versions"]);
      cases.push(["HEAD", bases[0]]);
      for (const [method, path] of cases) {
        const expected = await call(node, method, path);
        served.length = 0;
        const actual = await call(ported, method, path);
        expect(actual, `${method} ${path}`).to.deep.equal(expected);
        expect(served, `${method} ${path}`).to.deep.equal([`ABAP ${method} ${path}`]);
      }
      const feed = await call(node, "GET", bases[0]);
      expect(feed.body).to.contain("first &amp; &lt;one&gt; " + "x".repeat(90));
      served.length = 0;
      const tag = await call(ported, "GET", bases[0], {"If-None-Match": `W/\"${feed.etag}\"`});
      expect(tag).to.deep.equal(await call(node, "GET", bases[0], {"If-None-Match": `W/\"${feed.etag}\"`}));
      expect(tag.status).to.equal(304);
      expect(served).to.deep.equal([`ABAP GET ${bases[0]}`]);
      // If-None-Match that is no tag of this body: shorter than the W/ prefix,
      // a wildcard, a list; and a matching one on a content route
      const content = `${bases[0]}/19700101101123/00000/content`;
      const source = await call(node, "GET", content);
      for (const [path, header] of [[bases[0], "*"], [bases[0], "a"], [bases[0], `"x", W/"${feed.etag}"`],
        [content, `"${source.etag}"`], [content, "*"]]) {
        served.length = 0;
        const actual = await call(ported, "GET", path, {"If-None-Match": header});
        expect(actual, `${path} If-None-Match: ${header}`).to.deep.equal(await call(node, "GET", path, {"If-None-Match": header}));
        expect(served, `${path} If-None-Match: ${header}`).to.deep.equal([`ABAP GET ${path}`]);
      }
    } finally {
      rmSync(versionRoot, {recursive: true, force: true});
    }
  });

  it("versions slice: a tree without git has one active version and the same history note", async () => {
    const versionRoot = mkdtempSync(join(tmpdir(), "osd-adt-ver-nogit-"));
    try {
      mkdirSync(join(versionRoot, "src"));
      writeFileSync(join(versionRoot, "src", "zosd_ver.prog.abap"), "REPORT zosd_ver.\n");
      const shared = new ObjectStore({root: versionRoot, libs: []});
      const node = await mount({store: shared});
      const ported = await mount(withAbap({store: shared}));
      const path = "/sap/bc/adt/programs/programs/zosd_ver/source/main/versions";
      const expected = await call(node, "GET", path);
      served.length = 0;
      const actual = await call(ported, "GET", path);
      expect(actual).to.deep.equal(expected);
      expect(actual.history).to.match(/^none: /);
      expect(actual.body.match(/<atom:entry>/g)).to.have.length(1);
      expect(served).to.deep.equal([`ABAP GET ${path}`]);
    } finally {
      rmSync(versionRoot, {recursive: true, force: true});
    }
  });

  before(async () => {
    const {zcl_osd_adt_handler: handler} = await output("zcl_osd_adt_handler.clas.mjs");
    abapSide = abapRunner({handler, step: dialogStep});
    if (process.env.OSD_ADT_ONE_RUNTIME === "1") remoteRuntime = await remoteForTest();
    wireSide = remoteRuntime === undefined ? abapSide : abapRunner({remote: remoteRuntime});
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
    await remoteRuntime?.stop();
    rmSync(root, {recursive: true, force: true});
  });

  for (const resource of [
    "repository/informationsystem/virtualfolders/facets",
    "repository/informationsystem/objecttypes",
    "repository/informationsystem/releasestates",
    "repository/informationsystem/objectproperties/values",
    "packages/settings",
    "packages/valuehelps/abaplanguageversions",
  ]) {
    const base = `/sap/bc/adt/${resource}`;
    for (const method of ["GET", "HEAD"]) {
      for (const path of [base, `${base}/`, base.toUpperCase(), `${base.toUpperCase()}/`]) {
        it(`B1 static: ${method} ${path} is ABAP and byte-equal`, async () => {
          const shared = store();
          const node = await mount({store: shared});
          const ported = await mount(withAbap({store: shared}));
          const expected = await call(node, method, path, undefined, true);
          const actual = await call(ported, method, path, undefined, true);
          expect(actual).to.deep.equal(expected);
          expect(actual.status).to.equal(200);
          expect(actual.etag).to.equal(null);
          expect(served).to.deep.equal([`ABAP ${method} ${path}`]);
        });
      }
    }
  }

  for (const method of ["GET", "HEAD"]) {
    for (const what of ["%zz", "%FF"]) {
      it(`B1 valuehelp: ${method} ${what} decode failure agrees by status only`, async () => {
        const shared = store();
        const node = await mount({store: shared});
        const ported = await mount(withAbap({store: shared}));
        const path = `/sap/bc/adt/packages/valuehelps/${what}`;
        const expected = await call(node, method, path);
        const actual = await call(ported, method, path);
        expect(expected.status).to.equal(400);
        expect(actual.status).to.equal(400);
        expect(actual.type).to.equal("application/xml; charset=utf-8");
        expect(served).to.deep.equal([`ABAP ${method} ${path}`]);
      });
    }
  }

  for (const what of ["abaplanguageversions", "ABAPLANGUAGEVERSIONS", "%61baplanguageversions",
    "applicationcomponents", "softwarecomponents", "transportlayers", "unknown", "Abaplanguageversions"]) {
    it(`B1 valuehelp: decoded parameter ${what} keeps Node case sensitivity`, async () => {
      const shared = store();
      const node = await mount({store: shared});
      const ported = await mount(withAbap({store: shared}));
      const path = `/sap/bc/adt/packages/valuehelps/${what}?name=ignored&name=again`;
      const expected = await call(node, "GET", path, undefined, true);
      expect(await call(ported, "GET", path, undefined, true)).to.deep.equal(expected);
      expect(served).to.deep.equal([`ABAP GET ${path}`]);
      expect(expected.body.includes("Standard ABAP"))
        .to.equal(["abaplanguageversions", "%61baplanguageversions"].includes(what));
    });
  }

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

  it("a route ABAP does not serve reaches the Node façade unchanged, after the handler's step", async () => {
    const shared = store();
    const node = await mount({store: shared});
    const ported = await mount(withAbap({store: shared}));
    for (const [method, path, who = "HOST"] of DELEGATED) {
      served.length = 0;
      steps.length = 0;
      const expected = await call(node, method, path);
      const actual = await call(ported, method, path);
      // none of these carries a time or a session value, so the body compares
      // whole (a feed carries its time, which is why none is listed); the
      // catch-all's 404 names the path, and so do both
      expect(actual, `${method} ${path}`).to.deep.equal(expected);
      expect(served, `${method} ${path}`).to.deep.equal([`${who} ${method} ${path}`]);
      // every ADT request enters the handler, exactly once
      expect(steps, `${method} ${path}`).to.deep.equal([`${method} ${path}`]);
    }
  });

  it("a broken ABAP side answers the ADT exception document for every request, a HOST row included", async () => {
    const shared = store();
    const broken = await mount(withAbap({store: shared}, {...abapSide, answer: async () => {
      throw new Error("the shim fell over");
    }}));
    // the ABAP row: the Node façade's own refusal for the same failure
    const reference = express();
    reference.set("etag", false);
    reference.get(SYSINFO, (req, res) => answered(res, () => {
      throw new Error("ZCL_OSD_ADT_HANDLER: the shim fell over");
    }));
    const expected = await call(await listen(reference).then((s) => (servers.push(s), s)), "GET", SYSINFO);
    const actual = await call(broken, "GET", SYSINFO);
    expect(actual).to.deep.equal(expected);
    expect(actual.status).to.equal(500);
    expect(actual.type).to.equal("application/xml; charset=utf-8");
    expect(actual.body).to.contain("<type id=\"ExceptionInternalError\"/>");
    // no session was resolved, so nothing goes past the gate to Node: a
    // HOST row gets the same refusal (fail closed)
    for (const [method, path] of DELEGATED.filter(([verb, , who]) => who === undefined && verb === "GET")) {
      const answer = await call(broken, method, path);
      expect([answer.status, answer.type], `${method} ${path}`).to.deep.equal([500, "application/xml; charset=utf-8"]);
      expect(answer.body, `${method} ${path}`).to.contain("the shim fell over");
    }
  });

  it("a ported row that raises answers on the wire what the Node façade answers for it", async () => {
    // SYSTEM IDENTITY refused by the host: ZCL_OSD_ADT_HOST raises
    // ZCX_OSD_ADT=>INTERNAL with the host's reason, the handler answers it
    // (a value the host cannot serialise is how a host refuses here)
    const ported = await mount(withAbap({store: store(), identity: {
      refused: {toJSON() { throw new Error("no identity on this host"); }},
    }}));
    const reference = express();
    reference.set("etag", false);
    reference.get(SYSINFO, (req, res) => answered(res, () => {
      throw new Error("no identity on this host");
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

  it("the ABAP host receives SYSTEM raw bytes and OBJECT's extended metadata", async () => {
    await output("zcl_osd_adt_host.clas.mjs");
    const host = abap.Classes.ZCL_OSD_ADT_HOST;
    const string = (v) => new abap.types.String().set(v);
    const raw = ' {"z":1,"a":"\\u0061"} \r\n';
    const actual = await dialogStep(() => withSystem(() => ({raw}),
      () => host.system({iv_kind: string("IDENTITY")})));
    expect(actual.get()).to.equal(raw);
    const shared = new ObjectStore({root: process.cwd(), libs: []});
    const expected = shared.find("CLAS", "ZCL_ZSTG_DEMO_MPC");
    const object = await dialogStep(() => withSystem(() => ({}),
      () => host.object({iv_type: string("CLAS"), iv_name: string(expected.name)}), {store: shared}));
    expect(object.get().found.get()).to.equal("X");
    expect(object.get().package.get()).to.equal(expected.package ?? "");
    expect(object.get().packages.array().map((v) => v.get())).to.deep.equal(expected.packages);
    expect(object.get().includes.array().map((v) => v.get())).to.deep.equal(shared.classIncludes(expected.name));
    expect(object.get().version.get()).to.equal(shared.stateOf(expected).version);
    expect(object.get().changed_at.get()).to.equal(shared.stateOf(expected).changedAt ?? "");
    try {
      await dialogStep(() => host.store({iv_command: string("UNIMPLEMENTED")}));
      throw new Error("expected missing command to raise");
    } catch (error) {
      expect(error.status.get()).to.equal(501);
      expect(error.message_text.get()).to.equal("unknown store command UNIMPLEMENTED");
    }
  });

  it("SYSTEM IV_JSON sent from ABAP through the front reaches the host byte-equal to Node", async () => {
    await output("zcl_osd_adt_host.clas.mjs");
    const payload = '{"kind":"probe","text":"a < b"}';
    const path = "/sap/bc/adt/system-payload-probe";
    const answer = (kind, name, req, json) => ({raw: JSON.stringify({kind, name, path: req.originalUrl, json})});
    const nodeApp = express();
    nodeApp.get(path, (req, res) => res.type("application/json").send(answer("IDENTITY", "probe", req, payload).raw));
    const portedApp = express();
    portedApp.use(abapFront({step: dialogStep, ...abapSession({}, answer),
      refuse: (res, status, type, message) => res.status(status).send(message),
      answer: async () => {
        const string = (v) => new abap.types.String().set(v);
        const body = await abap.Classes.ZCL_OSD_ADT_HOST.system({iv_kind: string("IDENTITY"), iv_name: string("probe"), iv_json: string(payload)});
        return {status: 200, contentType: "application/json; charset=utf-8", headers: [], body: Buffer.from(body.get()), servedBy: "ABAP"};
      }}));
    const node = await listen(nodeApp);
    const ported = await listen(portedApp);
    servers.push(node, ported);
    const expected = await call(node, "GET", path);
    expect(JSON.parse(expected.body).json).to.equal(payload);
    expect(await call(ported, "GET", path)).to.deep.equal(expected);
  });

  it("OBJECT treats absent metadata arrays as empty", async () => {
    await output("zcl_osd_adt_host.clas.mjs");
    // The destination is the seam; emulate an older host's slim OBJECT answer.
    const destination = abap.context.RFCDestinations.STORE;
    const call = destination.call;
    try {
      destination.call = async (name, signature) => {
        signature.importing.ev_json.set('{"found":true,"type":"CLAS","name":"ZCL_SLIM","writable":true}');
        signature.importing.ev_error.set("");
      };
      const string = (v) => new abap.types.String().set(v);
      const object = await dialogStep(() => abap.Classes.ZCL_OSD_ADT_HOST.object({iv_type: string("CLAS"), iv_name: string("ZCL_SLIM")}));
      expect(object.get().found.get()).to.equal("X");
      expect(object.get().packages.array()).to.deep.equal([]);
      expect(object.get().includes.array()).to.deep.equal([]);
    } finally {
      destination.call = call;
    }
  });

  it("SYSTEM that no façade instance bound is refused, not answered from the environment", async () => {
    const box = () => new abap.types.String();
    const signature = {
      exporting: {IV_COMMAND: new abap.types.String().set("SYSTEM"), IV_TYPE: new abap.types.String().set("IDENTITY")},
      importing: {EV_JSON: box(), EV_ERROR: box()},
    };
    await new StoreDestination({store: undefined}).call("ZOSD_STORE", signature);
    expect(JSON.parse(signature.importing.EV_JSON.get()).error.code).to.equal("INTERNAL");
    expect(signature.importing.EV_ERROR.get()).to.match(/^nothing answers SYSTEM IDENTITY/);
  });

  it("the body reaches ABAP as bytes, however the host buffered it, and a parsed one is refused", async () => {
    const bodies = [];
    const echo = {
      step: dialogStep,
      answer: async (view) => {
        bodies.push(view.body.toString("utf8"));
        return {status: 200, contentType: "text/plain", headers: [], body: Buffer.from("ok"), servedBy: "ABAP"};
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

  // Slice 2: LOCK and UNLOCK in ABAP over the lock server, the ADT session
  // bound to its ENQ session, the Node write routes asking the same table.
  // The sequences are test/adt-devloop.mjs's "locks across requests and
  // sessions", run once against the Node façade and once against the ABAP
  // front, each over its own copy of the same tree, and every answer of the
  // one compared with the other's (a handle is random on both sides, so it
  // is compared by shape and replaced before the bodies are).
  describe("slice 2: the session and its locks, against the Node façade", () => {
    const LOCKED = "ZCL_OSD_LK";
    const DOOMED = "ZCL_OSD_LK_DOOMED";
    const PACKAGE = "$STG_DEMO";
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
    const roots = [];

    const tree = () => {
      const at = mkdtempSync(join(tmpdir(), "osd-adt-lock-"));
      roots.push(at);
      mkdirSync(join(at, "src", "demo"), {recursive: true});
      writeFileSync(join(at, "abap_transpile.json"), JSON.stringify({input_folder: ["src"]}));
      writeFileSync(join(at, "src", "demo", "package.devc.xml"), `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DEVC" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DEVC><CTEXT>demo</CTEXT></DEVC></asx:values></asx:abap>
</abapGit>
`);
      const made = new ObjectStore({root: at, libs: []});
      for (const name of [LOCKED, DOOMED]) made.create("CLAS", name, {description: "locked", package: PACKAGE});
      return made;
    };

    after(() => {
      for (const at of roots) rmSync(at, {recursive: true, force: true});
    });

    // one client of one server: its own logon, cookie and token
    const logon = async (server, user) => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/sap/bc/adt/core/discovery`, {method: "HEAD",
        headers: {"x-csrf-token": "fetch", ...(user === undefined ? {} : {authorization: "Basic " + Buffer.from(`${user}:x`).toString("base64")})}});
      const id = (res.headers.getSetCookie?.() ?? []).join("; ").match(/sap-contextid=([^;]+)/)?.[1];
      return {server, id, token: res.headers.get("x-csrf-token")};
    };
    const send = async (client, method, path, {headers = {}, body} = {}) => {
      const response = await fetch(`http://127.0.0.1:${client.server.address().port}${path}`, {method, body,
        headers: {cookie: `sap-contextid=${client.id}`, "x-csrf-token": client.token, "x-sap-adt-sessiontype": "stateful", ...headers}});
      const text = Buffer.from(await response.arrayBuffer()).toString("utf8");
      return {status: response.status, type: response.headers.get("content-type"), length: response.headers.get("content-length"),
        etag: response.headers.get("etag"), body: text, handle: /<LOCK_HANDLE>([^<]*)<\/LOCK_HANDLE>/.exec(text)?.[1]};
    };
    const at = (name) => `/sap/bc/adt/oo/classes/${name}`;
    const lock = (client, name = LOCKED, headers = {}) => send(client, "POST", `${at(name)}?_action=LOCK&accessMode=MODIFY`, {headers});
    const unlock = (client, handle, name = LOCKED) => send(client, "POST", `${at(name)}?_action=UNLOCK&lockHandle=${handle}`);
    const logoff = (client) => fetch(`http://127.0.0.1:${client.server.address().port}/sap/public/bc/icf/logoff`,
      {headers: {cookie: `${SESSION_COOKIE}=${client.id}`}}).then((r) => r.status);

    // the sequences: each takes a server and answers what it saw, in order
    const SEQUENCES = {
      "lock, a stateless read, the PUT, UNLOCK, and a PUT after it": async (server) => {
        const one = await logon(server);
        const locked = await lock(one);
        const read = await send(one, "GET", `${at(LOCKED)}/source/main`, {headers: {"x-sap-adt-sessiontype": "stateless"}});
        const written = await send(one, "PUT", `${at(LOCKED)}/source/main?lockHandle=${locked.handle}`,
          {headers: {"content-type": "text/plain"}, body: read.body + "* saved under the lock\n"});
        const unlocked = await unlock(one, locked.handle);
        const late = await send(one, "PUT", `${at(LOCKED)}/source/main?lockHandle=${locked.handle}`,
          {headers: {"content-type": "text/plain"}, body: "* too late\n"});
        await logoff(one);
        return [locked, read, written, unlocked, late];
      },
      "a second session is refused with EU 510, the holder relocks, UNLOCK hands it over": async (server) => {
        const one = await logon(server, "DEVONE");
        const two = await logon(server, "DEVTWO");
        const first = await lock(one);
        const refused = await lock(two);
        const again = await lock(one);
        expect(again.handle, "the holder locking again gets its handle").to.equal(first.handle);
        const unlocked = await unlock(one, first.handle);
        const taken = await lock(two);
        const back = await lock(one);
        await unlock(two, taken.handle);
        await logoff(one);
        await logoff(two);
        return [first, refused, again, unlocked, taken, back];
      },
      "a logoff releases the session's locks": async (server) => {
        const one = await logon(server);
        const two = await logon(server, "DEVTWO");
        const held = await lock(two);
        const refused = await lock(one);
        const off = await logoff(two);
        const after = await lock(one);
        await logoff(one);
        return [held, refused, {off}, after];
      },
      "the session DELETE releases them too, a stateless request does not": async (server) => {
        const one = await logon(server);
        const two = await logon(server, "DEVTWO");
        const held = await lock(two);
        const poll = await send(two, "GET", "/sap/bc/adt/core/http/sessions", {headers: {"x-sap-adt-sessiontype": "stateless"}});
        const refused = await lock(one);
        const url = /href="([^"]*\/core\/http\/sessions\/[0-9A-F]+)"/.exec(poll.body)?.[1];
        const ended = await send(two, "DELETE", url);
        const after = await lock(one);
        await logoff(one);
        return [held, refused, {ended: ended.status}, after];
      },
      "DELETE respects the holder, and the holder's DELETE takes the lock with it": async (server) => {
        const one = await logon(server);
        const two = await logon(server, "DEVTWO");
        const held = await lock(two, DOOMED);
        const refused = await send(one, "DELETE", at(DOOMED.toLowerCase()));
        const gone = await send(two, "DELETE", at(DOOMED.toLowerCase()));
        const missing = await lock(two, DOOMED);
        await logoff(one);
        await logoff(two);
        return [held, refused, gone, missing];
      },
      "the same user in another session is refused, because the lock is the session's": async (server) => {
        const one = await logon(server);
        const three = await logon(server);
        const held = await lock(one);
        const refused = await lock(three);
        await logoff(one);
        const after = await lock(three);
        await logoff(three);
        return [held, refused, after];
      },
      "a package locks like a source object": async (server) => {
        const one = await logon(server);
        const two = await logon(server, "DEVTWO");
        const path = `/sap/bc/adt/packages/${encodeURIComponent(PACKAGE.toLowerCase())}`;
        const held = await send(one, "POST", `${path}?_action=LOCK&accessMode=MODIFY`);
        const refused = await send(two, "POST", `${path}?_action=LOCK&accessMode=MODIFY`);
        const unlocked = await send(one, "POST", `${path}?_action=UNLOCK&lockHandle=${held.handle}`);
        await logoff(one);
        await logoff(two);
        return [held, refused, unlocked];
      },
      "the refusals: no object, no action, another action; the dataname a client asks for": async (server) => {
        const one = await logon(server);
        const answers = [
          await lock(one, "ZCL_OSD_LK_NONE"),
          await send(one, "POST", at(LOCKED)),
          await send(one, "POST", `${at(LOCKED)}?_action=stamp`),
          await lock(one, LOCKED, {accept: "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result"}),
          await unlock(one, "not-a-handle"),
        ];
        await logoff(one);
        return answers;
      },
      // A4H unmeasured: without state the ENQ session is the request's, so a
      // lock would be gone before its handle was used; both refuse it
      "a LOCK outside a stateful session is refused, and one inside is not": async (server) => {
        const one = await logon(server);
        const refused = await lock(one, LOCKED, {"x-sap-adt-sessiontype": "stateless"});
        const locked = await lock(one);
        const unlocked = await unlock(one, locked.handle);
        await logoff(one);
        return [refused, locked, unlocked];
      },
    };

    const STATUSES = {
      "lock, a stateless read, the PUT, UNLOCK, and a PUT after it": [200, 200, 200, 200, 409],
      "a second session is refused with EU 510, the holder relocks, UNLOCK hands it over": [200, 403, 200, 200, 200, 403],
      "a logoff releases the session's locks": [200, 403, 200, 200],
      "the session DELETE releases them too, a stateless request does not": [200, 403, 200, 200],
      "DELETE respects the holder, and the holder's DELETE takes the lock with it": [200, 403, 200, 404],
      "the same user in another session is refused, because the lock is the session's": [200, 403, 200],
      "a package locks like a source object": [200, 403, 200],
      "the refusals: no object, no action, another action; the dataname a client asks for": [404, 400, 400, 200, 200],
      "a LOCK outside a stateful session is refused, and one inside is not": [400, 200, 200],
    };

    const answered = (answers) => answers.map(({handle, ...rest}) => {
      if (rest.body !== undefined && new RegExp(UUID.source).test(rest.body)) {
        expect(rest.etag).to.equal(null);
      }
      if (rest.body !== undefined) rest.body = rest.body.replace(UUID, "<handle>");
      return {...rest, handle: handle === undefined ? undefined : handle.replace(UUID, "<handle>")};
    });

    for (const [title, sequence] of Object.entries(SEQUENCES)) {
      it(`byte-equal to the Node façade: ${title}`, async () => {
        const node = await mount({store: tree()});
        const ported = await mount(withAbap({store: tree()}));
        const expected = answered(await sequence(node));
        // the reference says what the sequence is about, so two sides failing
        // alike cannot pass as equal
        expect(expected.map((a) => a.status ?? a.off ?? a.ended)).to.deep.equal(STATUSES[title]);
        served.length = 0;
        const actual = answered(await sequence(ported));
        expect(actual).to.deep.equal(expected);
        // ABAP answered every LOCK and UNLOCK, and nothing the Node façade serves
        const posts = served.filter((s) => s.includes("_action="));
        expect(posts.length, "LOCK and UNLOCK reached the front").to.be.greaterThan(0);
        expect(posts.every((s) => s.startsWith("ABAP ")), posts.join("\n")).to.equal(true);
        const byAbap = served.filter((s) => s.startsWith("ABAP "));
        expect(byAbap.every((s) => s.startsWith("ABAP POST ") && s.includes("/source/") === false), byAbap.join("\n")).to.equal(true);
        // a handle is a UUID on both sides
        for (const answer of [...expected, ...actual]) {
          if (answer.handle !== undefined && answer.handle !== "") expect(answer.handle).to.equal("<handle>");
        }
        // and every sequence ends its sessions, so it leaves no lock behind
        const {locks} = await import("../tools/osd-enq.mjs");
        expect(locks().read({table: "ZOSD_ADT_LOCK"}).map((r) => `${r.user} ${r.arg}`), "rows left in the lock table").to.deep.equal([]);
      });
    }

    it("LOCK carries a failing OBJECT's raw refusal without a command prefix", async () => {
      const failingTree = () => {
        const shared = tree();
        shared.find = () => { throw new Error("object lookup refused <raw>"); };
        return shared;
      };
      const node = await mount({store: failingTree()});
      const ported = await mount(withAbap({store: failingTree()}));
      const answers = [];
      for (const server of [node, ported]) {
        const one = await logon(server);
        answers.push(await lock(one));
        await logoff(one);
      }
      expect(answers[0].status).to.equal(500);
      expect(answers[1]).to.deep.equal(answers[0]);
      expect(answers[1].body).to.contain("object lookup refused &lt;raw&gt;");
    });

    it("a write without the token is refused by the handler, with the Node middleware's bytes", async () => {
      const node = await mount({store: tree()});
      const ported = await mount(withAbap({store: tree()}));
      const answers = [];
      for (const server of [node, ported]) {
        const one = await logon(server);
        answers.push(await send({...one, token: "not-the-token"}, "POST", `${at(LOCKED)}?_action=LOCK&accessMode=MODIFY`));
        const none = await fetch(`http://127.0.0.1:${server.address().port}${at(LOCKED)}?_action=LOCK`, {method: "POST",
          headers: {cookie: `sap-contextid=${one.id}`}});
        answers.push({status: none.status, token: none.headers.get("x-csrf-token"), body: await none.text()});
        await logoff(one);
      }
      expect(answers[2]).to.deep.equal(answers[0]);
      expect(answers[3]).to.deep.equal(answers[1]);
      expect(answers[2].status).to.equal(403);
      expect(answers[2].type).to.equal("text/plain; charset=utf-8");
      expect(answers[2].body).to.equal("CSRF token validation failed");
      expect(answers[3].token).to.equal("Required");
      // the refusal is the handler's: both writes of the ported side entered it
      expect(steps.filter((s) => s.startsWith("POST")), "the refused writes entered the handler").to.have.length(2);
    });

    it("the ENQ row names the ADT session's user, and goes with the session", async () => {
      const {locks} = await import("../tools/osd-enq.mjs");
      const ported = await mount(withAbap({store: tree()}, abapSide));
      const one = await logon(ported, "DEVONE");
      const rows = () => locks().read({table: "ZOSD_ADT_LOCK"});
      expect((await lock(one)).status).to.equal(200);
      const held = rows().filter((r) => r.arg.includes(LOCKED));
      expect(held).to.have.length(1);
      expect(held[0].user).to.equal("DEVONE");
      expect(held[0].mode).to.equal("X");
      expect(held[0].dialogs).to.equal(1);
      expect((await lock(one)).status, "locked again: still one count, so one UNLOCK releases it").to.equal(200);
      expect(rows().filter((r) => r.arg.includes(LOCKED))[0].dialogs).to.equal(1);
      await logoff(one);
      expect(rows().filter((r) => r.arg.includes(LOCKED))).to.deep.equal([]);
    });

    // a façade with its sessions in hand, so a test can reach behind the wire
    const withSessions = async (adopt) => {
      const sessions = new AbapSessions();
      if (adopt !== undefined) {
        const own = sessions.adopt.bind(sessions);
        sessions.adopt = (...args) => adopt(own, ...args);
      }
      return {sessions, server: await mount(withAbap({store: tree(), sessions}))};
    };
    const rows = async () => {
      const {locks} = await import("../tools/osd-enq.mjs");
      return locks().read({table: "ZOSD_ADT_LOCK"});
    };

    it("a handle whose ENQ session the lock server ended writes nothing, and the session stays", async function () {
      // The lock can go behind the session's back (the lock server ending
      // the ENQ session). That is an ENQ context that ended, not a session
      // that ended: the next RESOLVE drops the handles, revives the key
      // and keeps the session and its token (#471), so the write with the
      // old handle is the 409 it is on main. Pending until #471
      // (ZCL_OSD_ENQ_KERNEL=>REVIVE) is in the tree.
      if (readFileSync(new URL("../output/zcl_osd_enq_kernel.clas.mjs", import.meta.url), "utf8").includes("async revive(") === false) {
        this.skip();
      }
      const {sessions, server} = await withSessions();
      const one = await logon(server);
      const {handle} = await lock(one);
      sessions.owners.end(one.id);
      expect((await sessions.get(one.id)).locks.has(handle), "the handle is still in the table").to.equal(true);
      const put = await send(one, "PUT", `${at(LOCKED)}/source/main?lockHandle=${handle}`, {headers: {"content-type": "text/plain"}, body: "* no\n"});
      expect(put.status).to.equal(409);
      const include = await send(one, "POST", `${at(LOCKED)}/includes?lockHandle=${handle}`,
        {body: `<class:abapClassInclude adtcore:name="${LOCKED}" class:includeType="testclasses"/>`});
      expect(include.status).to.equal(409);
      expect((await sessions.get(one.id))?.token, "the session and its token stay").to.equal(one.token);
      await logoff(one);
    });

    it("a step that dumps in a stateful session leaves no handle, and the object goes free", async () => {
      // #433: a dump ends the bound ENQ context and tells the host
      // (onEnqContextEnded); the façade drops the handles that context gave
      // out, so the old one is a 409 and not a write
      const {sessions, server} = await withSessions();
      const {bindEnqSession} = await import("../tools/osd-enq-host.mjs");
      const one = await logon(server);
      const {handle} = await lock(one);
      expect((await sessions.get(one.id)).locks.has(handle)).to.equal(true);
      // the step the front would run for this session, dumping
      await dialogStep(async () => {
        bindEnqSession(sessions.owners.key(one.id), {user: "OSD"});
        throw new Error("a dump in the session's step");
      }, "test: a dump").catch(() => {});
      expect(await rows(), "no lock left").to.deep.equal([]);
      // the next RESOLVE sees the ended context and clears the handles first
      const put = await send(one, "PUT", `${at(LOCKED)}/source/main?lockHandle=${handle}`, {headers: {"content-type": "text/plain"}, body: "* no\n"});
      expect(put.status).to.equal(409);
      expect((await sessions.get(one.id)).locks.size, "no handle left").to.equal(0);
      const two = await logon(server, "DEVTWO");
      expect((await lock(two)).status).to.equal(200);
      await logoff(two);
      // and the dumped session goes on: its next LOCK is a new context
      expect((await lock(one)).status).to.equal(200);
      await logoff(one);
    });

    it("a LOCK and its session's logoff both wait for the work process, in order, and leave no lock", async () => {
      // Slice 3: the logoff ends the session through AbapSessions, in a step
      // of its own, so it queues behind the LOCK's step instead of passing
      // it (under Node sessions it did, and the LOCK found its session gone).
      // The LOCK is granted, the logoff then takes it away, and the old
      // cookie and token are a session that is gone.
      const {server} = await withSessions();
      const one = await logon(server);
      const two = await logon(server, "DEVTWO");
      let free;
      let started;
      const running = new Promise((resolve) => { started = resolve; });
      const held = dialogStep(() => new Promise((resolve) => { free = resolve; started(); }), "test: the work process is busy");
      await running;
      steps.length = 0;
      const queued = fetch(`http://127.0.0.1:${server.address().port}${at(LOCKED)}?_action=LOCK&accessMode=MODIFY`, {method: "POST",
        headers: {cookie: `sap-contextid=${one.id}`, "x-csrf-token": one.token, "x-sap-adt-sessiontype": "stateful"}});
      await new Promise((resolve) => setTimeout(resolve, 50));
      // counted inside the step: the LOCK has not entered the handler yet
      expect(steps, "the LOCK waits for the work process").to.have.length(0);
      const off = logoff(one);
      await new Promise((resolve) => setTimeout(resolve, 50));
      free();
      await held;
      const answer = await queued;
      expect(answer.status, "the LOCK ran first").to.equal(200);
      await off;
      expect(steps, "LOCK and logoff each entered the handler once").to.have.length(2);
      expect(await off).to.equal(200);
      // the same session once it is gone: the cookie names nothing, so a new
      // session opens, and the old token is not its token
      const late = await fetch(`http://127.0.0.1:${server.address().port}${at(LOCKED)}?_action=LOCK&accessMode=MODIFY`, {method: "POST",
        headers: {cookie: `sap-contextid=${one.id}`, "x-csrf-token": one.token, "x-sap-adt-sessiontype": "stateful"}});
      expect({status: late.status, type: late.headers.get("content-type"), token: late.headers.get("x-csrf-token"), body: await late.text()})
        .to.deep.equal({status: 403, type: "text/plain; charset=utf-8", token: "Required", body: "CSRF token validation failed"});
      const fresh = /sap-contextid=([^;]+)/.exec(late.headers.getSetCookie().join("; "))?.[1];
      expect(fresh, "a fresh session").to.match(/^[0-9a-f]{24}$/);
      expect(fresh).to.not.equal(one.id);
      expect((await rows()).map((r) => `${r.user} ${r.arg}`), "no lock left").to.deep.equal([]);
      const after = await lock(two);
      expect(after.status, after.body).to.equal(200);
      await logoff(two);
    });

    it("a live session whose ENQ context the lock server ended: GET 200, a PUT with the old handle 409, and it locks again", async () => {
      const {server, sessions} = await withSessions();
      const one = await logon(server);
      const locked = await lock(one);
      expect(locked.status).to.equal(200);
      const {endEnqSession} = await import("../tools/osd-enq-host.mjs");
      endEnqSession(sessions.owners.key(one.id));
      expect((await rows()).map((r) => r.arg), "the lock went with the context").to.deep.equal([]);
      const read = await send(one, "GET", `${at(LOCKED)}/source/main`);
      expect(read.status, read.body).to.equal(200);
      const put = await send(one, "PUT", `${at(LOCKED)}/source/main?lockHandle=${locked.handle}`,
        {headers: {"content-type": "text/plain"}, body: "* no\n"});
      expect(put.status, put.body).to.equal(409);
      const again = await lock(one);
      expect(again.status, again.body).to.equal(200);
      expect(again.handle, "a relock gives a new handle").to.not.equal(locked.handle);
      const stale = await send(one, "PUT", `${at(LOCKED)}/source/main?lockHandle=${locked.handle}`,
        {headers: {"content-type": "text/plain"}, body: "* no\n"});
      expect(stale.status, "the old handle stays dead after the relock").to.equal(409);
      await logoff(one);
      expect((await rows()).map((r) => r.arg), "logoff released the new context").to.deep.equal([]);
    });

    it("a holder this owner table issued and no longer knows is dead, and gives way", async () => {
      // holderOf: an id under this table's own prefix that no session carries
      // is a session that ended without its lock going (nothing makes one now
      // that an ended key stays ended, so it is made here by hand); asked by
      // the ABAP LOCK (LOCK_HOLDER) or a Node route, it is ended and the
      // caller proceeds. Another façade's holder is not this table's to end.
      const {sessions, server} = await withSessions();
      const {enqTake, endEnqSession} = await import("../tools/osd-enq-host.mjs");
      const input = {mode_zosd_adt_lock: "X", objtype: "CLAS", objname: LOCKED, x_objtype: "X", x_objname: "X", _scope: "1"};
      expect(enqTake(sessions.owners.key("ghost"), "GHOST", "ZOSD_ADT_LOCK", "EZOSD_ADT_OBJ", input).subrc).to.equal(0);
      const two = await logon(server, "DEVTWO");
      const after = await lock(two);
      expect(after.status, after.body).to.equal(200);
      await logoff(two);
      // All owners in this host share a prefix; a different host stays live.
      const foreignKey = "adt:foreign:elsewhere";
      expect(enqTake(foreignKey, "ELSEWHERE", "ZOSD_ADT_LOCK", "EZOSD_ADT_OBJ", input).subrc).to.equal(0);
      const three = await logon(server, "DEVTHREE");
      const refused = await lock(three);
      expect(refused.status).to.equal(403);
      expect(refused.body).to.contain("<entry key=\"T100KEY-V1\">ELSEWHERE</entry>");
      endEnqSession(foreignKey);
      // an ended key takes and drops nothing from the host either (#433)
      const {enqDrop} = await import("../tools/osd-enq-host.mjs");
      expect(() => enqTake(foreignKey, "ELSEWHERE", "ZOSD_ADT_LOCK", "EZOSD_ADT_OBJ", input)).to.throw().with.property("code", "ENQ_SESSION_ENDED");
      expect(() => enqDrop(foreignKey, "ZOSD_ADT_LOCK", "EZOSD_ADT_OBJ", input)).to.throw().with.property("code", "ENQ_SESSION_ENDED");
      await logoff(three);
      expect(await rows()).to.deep.equal([]);
    });

    it("a relock whose handle the host cannot give keeps the lock the session had", async () => {
      // zcl_osd_adt_lock: only a lock this LOCK granted goes again when
      // LOCK_HANDLE fails; a relock (MC 602, the session's own) is not this
      // call's to give back
      let failing = false;
      const {server} = await withSessions((own, ...args) => {
        if (failing) throw new Error("the host has no handle for you");
        return own(...args);
      });
      const one = await logon(server);
      const first = await lock(one);
      expect(first.status).to.equal(200);
      failing = true;
      const again = await lock(one);
      expect(again.status).to.equal(500);
      expect(again.body).to.contain("the host has no handle for you");
      failing = false;
      expect((await rows()).filter((r) => r.arg.includes(LOCKED)), "still held").to.have.length(1);
      const put = await send(one, "PUT", `${at(LOCKED)}/source/main?lockHandle=${first.handle}`,
        {headers: {"content-type": "text/plain"}, body: "* still mine\n"});
      expect(put.status).to.equal(200);
      // and a first LOCK whose handle fails leaves nothing behind
      const two = await logon(server, "DEVTWO");
      failing = true;
      expect((await lock(two, DOOMED)).status).to.equal(500);
      failing = false;
      expect((await rows()).filter((r) => r.arg.includes(DOOMED)), "a granted lock goes again").to.deep.equal([]);
      await logoff(one);
      await logoff(two);
    });
  });
});
