// Slice 3 parity through the real generated ABAP in dialog steps. Sessions
// remains the reference; this test does not wire the production front.
import {expect} from "chai";
import {randomUUID} from "node:crypto";
import {Sessions, SESSION_COOKIE, CONTEXT_COOKIE} from "../tools/adt-session.mjs";
import {dialogStep, currentStepToken} from "../tools/osd-dialog-step.mjs";
import {adtEnqOwner} from "../tools/adt-enq-key.mjs";
import {EnqOwners} from "../tools/adt-enq.mjs";
import {enqHolder} from "../tools/osd-enq-host.mjs";
import {withSystem} from "../tools/osd-store-destination.mjs";
import {identity} from "./helpers/adt-session-unit.mjs";

const API = "zif_osd_adt_session$";
const stamp = (ms) => Number(new Date(ms).toISOString().slice(0, 19).replace(/\D/g, ""));
const plain = (structure) => Object.fromEntries(Object.entries(structure.get()).map(([k, v]) =>
  [k, ["stateful", "fresh"].includes(k) ? v.get() === "X" : String(v.get()).trimEnd()]));
const argsOf = (input) => Object.fromEntries(Object.entries(input).map(([k, v]) => [k, new globalThis.abap.types.String().set(v)]));
let abap;
function fields(object) {
  const row = new abap.types.Structure({name: new abap.types.String(), value: new abap.types.String()});
  const table = abap.types.TableFactory.construct(row);
  for (const [name, value] of Object.entries(object)) {
    const line = row.clone();
    line.get().name.set(name);
    line.get().value.set(value);
    table.append(line);
  }
  return table;
}
async function create(ttl = 1800, ms = Date.now()) {
  const obj = await new abap.Classes.ZCL_OSD_ADT_SESSION().constructor_({
    iv_ttl_seconds: new abap.types.Integer().set(ttl), iv_now: new abap.types.Packed({length: 8, decimals: 0}).set(stamp(ms)),
  });
  const call = (name, args = {}) => obj[API + name](argsOf(args));
  const resolve = async (cookies = {}, headers = {}, system = identity) => {
    const session = await withSystem((kind) => kind === "IDENTITY" ? system : undefined, () =>
      obj[API + "resolve"]({it_cookies: fields(cookies), it_headers: fields(headers)}));
    const setCookies = await withSystem(() => system, () => obj[API + "cookies"]({is_session: session}));
    return {...plain(session), cookies: setCookies.array().map((v) => v.get())};
  };
  return {obj, call, resolve, clock: (ms) => obj.set_clock({iv_now: new abap.types.Packed({length: 8, decimals: 0}).set(stamp(ms))})};
}
function nodeResolve(sessions, cookies = {}, headers = {}, method = "GET") {
  const known = new Set(sessions.byId.keys());
  const normalized = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = {method, headers: {...normalized, cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")}};
  const setCookies = [];
  const res = {append: (k, v) => setCookies.push(v), setHeader() {}, status() {return this;}, type() {return this;}, send() {}};
  let passed = false;
  sessions.middleware()(req, res, () => { passed = true; });
  expect(passed, "the reference request reached its route").to.equal(true);
  return {...req.adt.session, session: req.adt.session, fresh: !known.has(req.adt.session.id), cookies: setCookies};
}
const lockArgs = (name) => ({mode_zosd_adt_lock: "X", objtype: "CLAS", objname: name,
  x_objtype: "X", x_objname: "X", _scope: "1"});
async function enqueue(name) {
  await abap.FunctionModules.ENQUEUE_EZOSD_ADT_OBJ({exporting: argsOf(lockArgs(name))});
}

// Each pair owns both stores, and replaces random ids only for comparison.
async function pair(ttl = 1800) {
  const clock = Date.now;
  let time = Date.UTC(2026, 9, 2);
  const node = new Sessions({ttlMs: ttl * 1000});
  const sap = await create(ttl, time);
  const nodeIds = new Map(), sapIds = new Map();
  let nodeSession, sapSession;
  const nameOf = (ids, id) => {
    if (!ids.has(id)) ids.set(id, `session-${ids.size + 1}`);
    return ids.get(id);
  };
  const clean = (session, ids) => ({id: nameOf(ids, session.id), user: session.user,
    stateful: session.stateful, fresh: session.fresh,
    cookies: session.cookies.map((v) => v.replaceAll(session.id, "<id>"))});
  return {node, sap,
    atTime(work) {
      Date.now = () => time;
      try { return work(); } finally { Date.now = clock; }
    },
    async request(select = {}, headers = {}, method = "GET") {
      const cookiesOf = (ids, latest) => Object.fromEntries(Object.entries(select).map(([k, v]) =>
        [k, v === "latest" ? latest?.id ?? "" : typeof v === "number" ? [...ids.keys()][v - 1] : v]));
      Date.now = () => time;
      try {
        const reqHeaders = {...headers};
        if (method === "PUT") reqHeaders["x-csrf-token"] = nodeSession.token;
        nodeSession = nodeResolve(node, cookiesOf(nodeIds, nodeSession), reqHeaders, method);
        sapSession = await dialogStep(() => sap.resolve(cookiesOf(sapIds, sapSession), headers), "ABAP session request");
        expect(clean(sapSession, sapIds)).to.deep.equal(clean(nodeSession, nodeIds));
        expect(sapSession.id).to.match(/^[a-f0-9]{24}$/);
        expect(sapSession.token).to.match(/^[A-Za-z0-9_-]{24}$/);
        expect(sapSession.token).to.not.equal("fetch");
        for (const [wanted, value] of [["valid", true], ["wrong", false], ["fetch", false]]) {
          const actual = await dialogStep(() => sap.call("token_valid", {iv_id: sapSession.id,
            iv_token: wanted === "valid" ? sapSession.token : wanted}), "ABAP token check");
          expect(actual.get() === "X").to.equal(value);
        }
        return {node: nodeSession, sap: sapSession};
      } finally { Date.now = clock; }
    },
    async advance(seconds) { time += seconds * 1000; await sap.clock(time); },
    async end() {
      for (const id of sapIds.keys()) await dialogStep(() => sap.call("end", {iv_id: id}), "ABAP session logoff");
      for (const id of nodeIds.keys()) node.end(id);
    },
  };
}

describe("ADT session slice 3: ABAP / Node parity and ENQ", function () {
  this.timeout(60000);
  before(async function () {
    const {initializeABAP} = await import("../output/init.mjs");
    await initializeABAP();
    abap = globalThis.abap;
  });

  it("resolves fresh sessions, each cookie, conflicting cookies and an empty context", async () => {
    const p = await pair();
    try {
      await p.request({}, {Authorization: `bAsIc ${Buffer.from("devone:secret").toString("base64")}`});
      await p.request({[SESSION_COOKIE]: "latest"}, {authorization: `Basic ${Buffer.from("devtwo:secret").toString("base64")}`});
      await p.request({[CONTEXT_COOKIE]: "latest"});
      await p.request({}); // a second session
      await p.request({[CONTEXT_COOKIE]: 1, [SESSION_COOKIE]: 2});
      await p.request({[CONTEXT_COOKIE]: "", [SESSION_COOKIE]: 2});
      await p.request({[CONTEXT_COOKIE]: "unknown", [SESSION_COOKIE]: 1});
      await p.request({[SESSION_COOKIE]: "unknown"});
    } finally { await p.end(); }
  });

  it("LOCK, stateless read, PUT and logoff retain state and the same handle", async () => {
    const p = await pair();
    try {
      let both = await p.request({}, {"x-sap-adt-sessiontype": "stateful"});
      const nodeHandle = p.atTime(() => p.node.lock(both.node.session, "clas", "zsession", randomUUID)).handle;
      const sapHandle = (await dialogStep(() => p.sap.call("adopt_handle", {
        iv_id: both.sap.id, iv_type: "clas", iv_name: "zsession"}), "ABAP adopt")).get();
      expect(sapHandle).to.match(/^[a-f0-9-]{36}$/);
      for (const method of ["GET", "PUT"]) {
        both = await p.request({[SESSION_COOKIE]: "latest"}, {"x-sap-adt-sessiontype": "stateless"}, method);
        const holds = await dialogStep(() => p.sap.call("holds", {iv_id: both.sap.id, iv_handle: sapHandle,
          iv_type: "ClAs", iv_name: "Zsession"}), "ABAP PUT handle check");
        expect(holds.get() === "X").to.equal(p.atTime(() => p.node.holds(both.node.session, nodeHandle, "clas", "zsession")));
        const again = await dialogStep(() => p.sap.call("adopt_handle", {
          iv_id: both.sap.id, iv_type: "CLAS", iv_name: "ZSESSION"}), "ABAP relock");
        expect(again.get()).to.equal(sapHandle);
      }
      const type = new abap.types.String(), name = new abap.types.String();
      await dialogStep(() => p.sap.obj[API + "release_handle"]({...argsOf({iv_id: both.sap.id, iv_handle: sapHandle}), ev_type: type, ev_name: name}), "ABAP forget");
      const forgotten = p.node.forget(both.node.session, nodeHandle);
      expect([type.get(), name.get()]).to.deep.equal([forgotten.type, forgotten.name]);
      expect((await p.sap.call("holds", {iv_id: both.sap.id, iv_handle: sapHandle, iv_type: "CLAS", iv_name: "ZSESSION"})).get()).to.equal(" ");
      p.node.end(both.node.id);
      await dialogStep(() => p.sap.call("end", {iv_id: both.sap.id}), "ABAP logoff");
      await p.request({[CONTEXT_COOKIE]: "latest"});
    } finally { await p.end(); }
  });

  it("expiry sweeps abandoned sessions, while token checks do not touch or revive them", async () => {
    const p = await pair(10);
    try {
      const first = await p.request();
      await p.request();
      await p.advance(9);
      expect((await p.sap.call("token_valid", {iv_id: first.sap.id, iv_token: first.sap.token})).get()).to.equal("X");
      await p.advance(2);
      expect((await p.sap.call("token_valid", {iv_id: first.sap.id, iv_token: first.sap.token})).get()).to.equal(" ");
      await p.request({[CONTEXT_COOKIE]: 2});
      expect((await dialogStep(() => p.sap.call("alive", {iv_id: first.sap.id}), "holder check")).get()).to.equal(" ");
      expect(p.node.byId.has(first.node.id)).to.equal(false);
    } finally { await p.end(); }
  });

  it("shares persisted sessions and handles with a new implementation instance", async () => {
    const one = await create(), two = await create();
    let session;
    try {
      let handle;
      await dialogStep(async () => {
        session = await one.resolve({}, {"x-sap-adt-sessiontype": "stateful"});
        handle = (await one.call("adopt_handle", {iv_id: session.id, iv_type: "clas", iv_name: "zshared"})).get();
      }, "first implementation instance");
      const again = await dialogStep(() => two.resolve({[SESSION_COOKIE]: session.id}), "new implementation instance");
      expect([again.id, again.token, again.user, again.stateful, again.fresh])
        .to.deep.equal([session.id, session.token, session.user, true, false]);
      expect((await two.call("holds", {iv_id: session.id, iv_handle: handle, iv_type: "CLAS", iv_name: "ZSHARED"})).get()).to.equal("X");
      const kernel = abap.Classes.ZCL_OSD_ENQ_KERNEL;
      abap.Classes.ZCL_OSD_ENQ_KERNEL = {}; // the assignment a warm class load makes
      expect(abap.Classes.ZCL_OSD_ENQ_KERNEL).to.equal(kernel);
      expect((await dialogStep(() => two.call("alive", {iv_id: session.id}), "holder check")).get()).to.equal("X");
    } finally { if (session) await dialogStep(() => two.call("end", {iv_id: session.id}), "cleanup"); }
  });

  it("peek reads expired rows without sweeping or touching and returns initial for missing ids", async () => {
    const sap = await create(10, Date.UTC(2026, 9, 2));
    let session;
    try {
      session = await dialogStep(() => sap.resolve(), "open for peek");
      await sap.clock(Date.UTC(2026, 9, 2, 0, 0, 11));
      const read = () => sap.obj.peek(argsOf({iv_id: session.id}));
      const row = plain(await dialogStep(read, "expired peek"));
      expect([row.id, row.token, row.touched]).to.deep.equal([session.id, session.token, "20261002000000"]);
      expect(plain(await dialogStep(() => sap.obj.peek(argsOf({iv_id: "missing"})), "missing peek")).id).to.equal("");
      expect(plain(await dialogStep(read, "peek again"))).to.deep.equal(row);
    } finally { if (session) await dialogStep(() => sap.call("end", {iv_id: session.id}), "cleanup"); }
  });

  it("stateless resolve uses UUIDs without the host kernel and ENQ stubs refuse by name", async () => {
    const sap = await create(1800, Date.UTC(2099, 0, 1));
    // Sweep first using the host, then exercise the actual generated stubs.
    const first = await dialogStep(() => sap.resolve(), "sweep before stub test");
    await dialogStep(() => sap.call("end", {iv_id: first.id}), "initial cleanup");
    const descriptor = Object.getOwnPropertyDescriptor(abap.Classes, "ZCL_OSD_ENQ_KERNEL");
    const {zcl_osd_enq_kernel: stub} = await import("../output/zcl_osd_enq_kernel.clas.mjs");
    let session;
    try {
      Object.defineProperty(abap.Classes, "ZCL_OSD_ENQ_KERNEL", {value: stub, configurable: true});
      session = await dialogStep(() => sap.resolve(), "stateless without host kernel");
      expect(session.id).to.match(/^[a-f0-9]{24}$/);
      expect(session.token).to.match(/^[A-Za-z0-9_-]{24}$/);
      for (const method of ["bind", "end", "context_alive"]) {
        let error;
        await dialogStep(async () => {
          try { await stub[method](argsOf({iv_id: session.id, iv_user: session.user})); } catch (e) { error = e; }
        }, "unhosted kernel refusal");
        expect(error).to.be.instanceOf(abap.Classes.ZCX_OSD_ADT);
        expect(error.type_id.get()).to.equal(abap.Classes.ZCX_OSD_ADT.c_system_not_supported.get());
        expect(error.namespace.get()).to.equal(abap.Classes.ZCX_OSD_ADT.c_namespace_osd.get());
        expect(error.message_text.get()).to.equal("not supported on this system");
      }
    } finally {
      Object.defineProperty(abap.Classes, "ZCL_OSD_ENQ_KERNEL", descriptor);
      if (session) await dialogStep(() => sap.call("end", {iv_id: session.id}), "cleanup");
    }
  });

  it("takes cookie names and the default user from the host identity", async () => {
    const sap = await create();
    const system = {...identity, systemID: "TST", client: "007", userName: "TESTUSER"};
    let session;
    try {
      session = await dialogStep(() => sap.resolve({}, {}, system), "custom identity");
      expect(session.user).to.equal("TESTUSER");
      expect(session.cookies[1]).to.equal(`SAP_SESSIONID_TST_007=${session.id}; Path=/; HttpOnly; SameSite=Strict`);
      const again = await dialogStep(() => sap.resolve({SAP_SESSIONID_TST_007: session.id}, {}, system), "custom cookie");
      expect(again.id).to.equal(session.id);
      expect(again.fresh).to.equal(false);
    } finally { if (session) await dialogStep(() => sap.call("end", {iv_id: session.id}), "cleanup"); }
  });

  it("binds stateful resolve: a lock survives the step and logoff releases it", async () => {
    const sap = await create();
    let session, key;
    try {
      await dialogStep(async () => {
        session = await sap.resolve({}, {"X-SAP-ADT-SessionType": "StAtEfUl"});
        key = currentStepToken().enqSession;
        expect(key).to.match(/^adt:[a-f0-9]{12}:/);
        await enqueue("ZSESSION_ENQ");
      }, "stateful LOCK");
      expect(enqHolder("ZOSD_ADT_LOCK", lockArgs("ZSESSION_ENQ"))).to.deep.equal({key, user: "OSD"});
      const owners = new EnqOwners();
      expect(owners.key(session.id)).to.equal(key);
      expect(adtEnqOwner.idOf(key)).to.equal(session.id);
      expect(owners.holder("CLAS", "ZSESSION_ENQ")).to.deep.equal({id: session.id, user: "OSD", mine: true});
      expect((await dialogStep(() => sap.call("alive", {iv_id: key}), "holder check")).get()).to.equal("X");
      await dialogStep(() => sap.resolve({[SESSION_COOKIE]: session.id}), "stateless read of stateful context");
      expect(enqHolder("ZOSD_ADT_LOCK", lockArgs("ZSESSION_ENQ"))).to.not.equal(undefined);
      await dialogStep(() => sap.call("end", {iv_id: session.id}), "logoff");
      expect(enqHolder("ZOSD_ADT_LOCK", lockArgs("ZSESSION_ENQ"))).to.equal(undefined);
      expect((await dialogStep(() => sap.call("alive", {iv_id: key}), "holder check")).get()).to.equal(" ");
      expect((await dialogStep(() => sap.call("alive", {iv_id: "adt:another:gone"}), "holder check")).get()).to.equal("X");
    } finally { if (session) await dialogStep(() => sap.call("end", {iv_id: session.id}), "cleanup"); }
  });

  it("pulls dumped-context cleanup on resolve, retaining the session and token", async () => {
    const sap = await create();
    let session, handle;
    try {
      await dialogStep(async () => {
        session = await sap.resolve({}, {"x-sap-adt-sessiontype": "stateful"});
        await enqueue("ZSESSION_DUMP");
        handle = (await sap.call("adopt_handle", {iv_id: session.id, iv_type: "CLAS", iv_name: "ZSESSION_DUMP"})).get();
      }, "LOCK before dump");
      await dialogStep(async () => {
        await sap.resolve({[CONTEXT_COOKIE]: session.id});
        throw new Error("session test dump");
      }, "dump").then(() => { throw new Error("no dump"); }, (e) => expect(e.message).to.equal("session test dump"));
      expect(enqHolder("ZOSD_ADT_LOCK", lockArgs("ZSESSION_DUMP"))).to.equal(undefined);
      const again = await dialogStep(() => sap.resolve({[CONTEXT_COOKIE]: session.id}), "resolve after dump");
      expect([again.id, again.token, again.fresh]).to.deep.equal([session.id, session.token, false]);
      expect((await sap.call("holds", {iv_id: session.id, iv_handle: handle, iv_type: "CLAS", iv_name: "ZSESSION_DUMP"})).get()).to.equal(" ");
      await dialogStep(async () => {
        await sap.resolve({[CONTEXT_COOKIE]: session.id});
        await enqueue("ZSESSION_DUMP");
      }, "LOCK in next context");
      expect(enqHolder("ZOSD_ADT_LOCK", lockArgs("ZSESSION_DUMP"))).to.not.equal(undefined);
    } finally { if (session) await dialogStep(() => sap.call("end", {iv_id: session.id}), "cleanup"); }
  });

  it("refuses an ended bind by name and recovers with a fresh session after rolled-back logoff", async () => {
    const sap = await create();
    let session, handle;
    try {
      await dialogStep(async () => {
        session = await sap.resolve({}, {"x-sap-adt-sessiontype": "stateful"});
        handle = (await sap.call("adopt_handle", {iv_id: session.id, iv_type: "CLAS", iv_name: "ZENDED"})).get();
      }, "stateful open");
      await dialogStep(async () => {
        await sap.call("end", {iv_id: session.id});
        throw new Error("logoff dump");
      }, "rolled back logoff").catch((e) => expect(e.message).to.equal("logoff dump"));
      expect(plain(await dialogStep(() => sap.obj.peek(argsOf({iv_id: session.id})), "peek before refusal")).id).to.equal(session.id);
      let error;
      // A handler catches the protocol refusal inside its step; cleanup commits.
      await dialogStep(async () => {
        try { await sap.resolve({[CONTEXT_COOKIE]: session.id}); } catch (e) { error = e; }
      }, "ended bind");
      expect(error).to.be.instanceOf(abap.Classes.ZCX_OSD_ADT);
      expect(error.status.get()).to.equal(403);
      expect(error.type_id.get()).to.equal(abap.Classes.ZCX_OSD_ADT.c_session_ended.get());
      expect(error.namespace.get()).to.equal(abap.Classes.ZCX_OSD_ADT.c_namespace_osd.get());
      expect((await dialogStep(() => sap.call("holds", {iv_id: session.id, iv_handle: handle,
        iv_type: "CLAS", iv_name: "ZENDED"}), "ended handles cleared")).get()).to.equal(" ");
      const fresh = await dialogStep(() => sap.resolve({[CONTEXT_COOKIE]: session.id}), "recovery after refusal");
      expect(fresh.fresh).to.equal(true);
      expect(fresh.id).to.not.equal(session.id);
      expect(fresh.token).to.not.equal(session.token);
      await dialogStep(() => sap.call("end", {iv_id: fresh.id}), "fresh cleanup");
    } finally { if (session) await dialogStep(() => sap.call("end", {iv_id: session.id}), "cleanup"); }
  });

  it("sweeps an expired stateful session's ENQ locks even when another session resolves", async () => {
    const sap = await create(10, Date.UTC(2026, 9, 2));
    let first, second;
    try {
      await dialogStep(async () => {
        first = await sap.resolve({}, {"x-sap-adt-sessiontype": "stateful"});
        await enqueue("ZSESSION_EXPIRE");
      }, "abandoned LOCK");
      await sap.clock(Date.UTC(2026, 9, 2, 0, 0, 11));
      second = await dialogStep(() => sap.resolve(), "unrelated request sweeps");
      expect(enqHolder("ZOSD_ADT_LOCK", lockArgs("ZSESSION_EXPIRE"))).to.equal(undefined);
      expect((await sap.call("token_valid", {iv_id: first.id, iv_token: first.token})).get()).to.equal(" ");
    } finally {
      for (const session of [first, second]) if (session) await dialogStep(() => sap.call("end", {iv_id: session.id}), "cleanup");
    }
  });
});
