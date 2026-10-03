// The serving half of OSD, on its own, in a process that can be replaced.
//
// This is the OData front and nothing else: the transpiled runtime, the
// service registrations, and the ICF shim that hands a request to
// ZCL_STG_HTTP_HANDLER. No ADT façade, no store, no parse. That is the
// whole point of the split. Node pins a module graph for the life of a
// process, so the only way activated code becomes live is a new process,
// and the only process worth restarting is the cheap one: this boots in
// under a second, while the façade's parse of the system costs four.
//
// It is started by tools/osd-runtime.mjs, which talks to it over the
// process channel: it says "ready" with the port it got, and it exits when
// it is asked to. Started by hand it works too, which is how it is
// debugged: `node tools/osd-serve.mjs 3099`.
import {timingSafeEqual} from "node:crypto";
import {dialogStep, exclusive, outsideStepContext} from "./osd-dialog-step.mjs";
import {bootGuard} from "./osd-boot-guard.mjs";
import {HotLoader, applyRuntimeHotSwap, warmVerdict} from "./osd-hot.mjs";
import {ensureDemoData} from "./osd-demo-data.mjs";
import {inspectorRequest} from "./osd-inspector.mjs";
import {databaseDescriptor} from "./osd-database-identity.mjs";
import express from "express";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {mountServices, servicesFromRows, channels} from "./osd-icf.mjs";
import {mountHost, nodes} from "./osd-nodes.mjs";
import {applyAtStartup, currentRows} from "./osd-icf-apply.mjs";
import {seedAtStartup} from "./osd-xref-seed.mjs";
import {mountChannels} from "./osd-apc.mjs";
import {Data} from "./osd-data.mjs";
import {dumpOf} from "./osd-where.mjs";
import {persistDump} from "./osd-dumps.mjs";
import {serveSandboxConfig} from "./osd-sandbox-config.mjs";
import {mountPortableCells} from "./sqlscript-to-procedure-ir.mjs";
import {batchMonitorHandler} from "./osd-batch-monitor.mjs";
import {identity} from "./osd-identity.mjs";
import {parseCookies, sessionIdOf} from "./adt-session.mjs";
import {abapSession} from "./adt-enq.mjs";
import {answerOf, abapServes} from "./adt-abap-front.mjs";
import {sessionJSON, sessionValue} from "./adt-remote-sessions.mjs";
import {AbapSessions} from "./adt-abap-sessions.mjs";
import {StoreIPCClient, withStoreIPC} from "./osd-store-ipc.mjs";
import {StoreDestination, withSystem, currentSystemAnswers} from "./osd-store-destination.mjs";
import {withAbapCase} from "./osd-case-determinism.mjs";

const started = Date.now();
// setup.mjs installs this exact client while the generation boots. Its
// database-aware SYSTEM answers attach once the database is available.
const childStoreIPC = process.env.OSD_ADT_ONE_RUNTIME === "1" && process.send !== undefined
  ? new StoreIPCClient(process, {localSystem: {call: (name, signature) =>
    withSystem(kind => kind === "IDENTITY" ? identity().adt : undefined,
      () => new StoreDestination().call(name, signature))}}) : undefined;
if (childStoreIPC !== undefined) globalThis.__osdStoreDestination = childStoreIPC;
// Install the receive side before boot: IPC can arrive during module load.
const initialAdtState = process.send === undefined || process.env.OSD_ADT_CARRY !== "1" ? Promise.resolve({}) : new Promise((resolve) => {
  const receive = (message) => {
    if (message?.type !== "adt-state") return;
    clearTimeout(timer);
    process.off("message", receive);
    resolve(message);
  };
  const timer = setTimeout(() => {
    process.off("message", receive);
    const line = "ADT carry: no adt-state after 5 s; continuing with database rows";
    console.log(line);
    if (process.connected) process.send({type: "say", line});
    resolve({});
  }, 5000);
  process.on("message", receive);
  process.send({type: "adt-state-request"});
});

// **Alive, and doing what.** A boot on a remote HANA can take minutes (the
// seed inserts go over the network), and the supervisor used to give a
// child 60 s from spawn to "ready" and then SIGKILL it -- and the next
// request started it again from the top, forever (dell, 2026-09-27, 14
// restarts in 900 s). So until "ready" the child says every few seconds
// that it is still booting and which step it is in; the supervisor's limit
// is on silence, not on the length of the boot (tools/osd-runtime.mjs).
// The timer does not hold the process open.
let bootPhase = "loading the generation";
let bootPhaseSince = started;
let bootLast = "";
// only while the channel is open: after the supervisor is gone, send() emits
// ERR_IPC_CHANNEL_CLOSED on `process`, which ends a child mid-seed
const tell = (message) => {
  if (process.connected) process.send(message);
};
// a stop during the boot goes at once, but waits out the database step
// (tools/osd-boot-guard.mjs); the supervisor is told which, so it does not
// SIGKILL a seed it has been asked to let finish
const guard = bootGuard();
const bootingMessage = () => ({type: "booting", phase: bootPhase, last: bootLast, database: guard.inDatabaseStep, ms: Date.now() - started});
const booting = process.send === undefined ? undefined : setInterval(() => {
  tell(bootingMessage());
}, 5000);
booting?.unref();
process.once("disconnect", () => clearInterval(booting));
// each step of the boot with how long the previous one took, said over the
// channel so the supervisor prints it: per-step times on any host, the HANA
// one included, without a profiler
const bootStep = (name) => {
  tell({type: "say", line: `boot: ${bootPhase} ${Date.now() - bootPhaseSince} ms`});
  bootPhase = name;
  bootPhaseSince = Date.now();
  // the step at once, not at the next heartbeat
  tell(bootingMessage());
};

// which tree this runtime serves, so one copy of this script can serve any
// of them: a second worktree, a branch under test, an experiment on its own
// port and its own database. The modules are loaded from there rather than
// from next to this file, which is what would otherwise pin an instance to
// the checkout the script happens to live in.
const root = process.env.OSD_ROOT ?? process.cwd();
// A reference run pins the module tree explicitly. It never changes build/live.
const output = process.env.OSD_OUTPUT ?? join(root, "output");
const from = (file) => import(pathToFileURL(join(output, file)).href);
const referenceCases = process.env.OSD_REFERENCE_CASES ? JSON.parse(process.env.OSD_REFERENCE_CASES) : null;

const {initializeABAP} = await from("init.mjs");
const {cl_express_icf_shim} = await from("cl_express_icf_shim.clas.mjs");
const {zcl_stg_segw_registry} = await from("zcl_stg_segw_registry.clas.mjs");
const {zcl_stg_shlp_registry} = await from("zcl_stg_shlp_registry.clas.mjs");
const {zcl_apc_host} = await from("zcl_apc_host.clas.mjs");
// the system-status writer (src/status/): the facade posts a snapshot here
// because only it can see the pool, the listeners and the generation, and
// only this process can write the tables the service reads
const {zcl_osd_status} = await from("zcl_osd_status.clas.mjs");

bootStep("opening the database: DDL and seed rows (test/setup.mjs)");
await guard.databaseStep(async () => {
  tell(bootingMessage());
  await initializeABAP();
});
const uuidClass = referenceCases ? (await from("cl_system_uuid.clas.mjs")).cl_system_uuid : undefined;
// the ICF nodes into the tables a system keeps them in, by the rule in
// docs/registry-drift.md: applied when an object arrives, never re-applied
// over an edit. One module for all three hosts, because that is what the
// end-of-dialog-step rule cost when it was written once in one of them.
// **This is the process that holds the system, so it routes from the
// system.** Fatal, and it was written as "loud and not fatal, and that is a
// statement with a shelf life" one commit ago: the ICF paths below are
// mounted from these rows now, so a registry that could not be applied is a
// runtime that would answer nothing on them and say it was fine.
// A line this process says must be seen: `console.log` here reaches the
// parent's rolling tail and no further (tools/osd-runtime.mjs), so anything
// that must not be silent goes over the IPC channel as well. Standing on
// its own rather than inlined, because the next thing that must be seen
// will be written by somebody who did not read this comment.
const announce = (line) => {
  console.log(line);
  tell({type: "say", line});
  bootLast = line;
};

bootStep("applying the ICF registry");
const registry = await applyAtStartup(globalThis.abap.context.databaseConnections.DEFAULT, {root, say: announce});
if (registry === undefined) {
  throw new Error("the ICF registry could not be applied, and the routes below come from it");
}
const icfRowsNow = await currentRows(globalThis.abap.context.databaseConnections.DEFAULT);
// the cross-reference, derived from the files and cached per generation
// (tools/osd-xref-seed.mjs): the same call every host makes
bootStep("seeding the cross-reference");
await seedAtStartup(globalThis.abap.context.databaseConnections.DEFAULT, {root, say: announce});
bootStep("registering services and search helps");
await zcl_stg_segw_registry.register();
await zcl_stg_shlp_registry.register();
// the synthetic taxi facts, made by ZCL_OSD_DEMO_DATA (tools/osd-demo-data.mjs)
bootStep("demo data");
await ensureDemoData((await from("zcl_osd_demo_data.clas.mjs")).zcl_osd_demo_data, {say: announce});

const {snapshotAdtRows, restoreAdtRows, rebuildAdtLocks} = await import("./adt-runtime-state.mjs");
// B0 is off unless the supervisor opted in (OSD_ADT_ONE_RUNTIME=1 sets
// OSD_ADT_CARRY=1): with it off, ADT rows already in this database (an inline
// run on the same file) must not turn into mirror locks or lose handles
if (process.env.OSD_ADT_CARRY === "1") {
  bootStep("restoring ADT state and rebuilding locks");
  const initial = await initialAdtState;
  await dialogStep(() => restoreAdtRows(globalThis.abap.context.databaseConnections.DEFAULT, initial.state,
    {replace: initial.replace === true, say: announce}), "restoring ADT carry");
  try {
    const rebuilt = await rebuildAdtLocks(globalThis.abap.context.databaseConnections.DEFAULT);
    announce(`ADT rehydrate: ${rebuilt.sessions} sessions, ${rebuilt.handles} handles, ${rebuilt.skipped} skipped, ${rebuilt.ms.toFixed(2)} ms`);
  } catch (error) {
    announce(`ADT rehydrate failed: ${error.message}; continuing boot`);
  }
}

const app = express();
app.disable("x-powered-by");
app.set("etag", false);
// The door key is read once and removed from the environment, so processes
// this child spawns (warm verify, batch workers) do not inherit it.
const adtStepKey = Buffer.from(process.env.OSD_ADT_STEP_KEY ?? "");
delete process.env.OSD_ADT_STEP_KEY;
// Hex plus metadata must fit every body accepted by the public 16 MB parser.
app.use("/osd/adt-step", (req, res, next) => {
  if (process.env.OSD_ADT_ONE_RUNTIME !== "1") return res.status(404).end();
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")) return res.status(415).json({error: {message: "JSON required"}});
  const expected = adtStepKey;
  const supplied = Buffer.from(req.headers["x-osd-adt-step-key"] ?? "");
  if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return res.status(403).json({error: {message: "invalid step key"}});
  next();
}, express.raw({type: "application/json", limit: "34mb"}));
app.use(express.raw({type: "*/*", limit: "16mb"}));
mountPortableCells(app, () => globalThis.abap.context.databaseConnections.DEFAULT,
  (work) => exclusive(work, "SQLScript notebook cell"));
// every answer says which code produced it: the generation the supervisor
// named when it started this process (the live build's hash)
// -- or, after a warm swap (tools/osd-hot.mjs), the generation the swap
// brought in, marked while nobody has compared it with a cold build
const hot = new HotLoader(root);
let generation = process.env.OSD_GENERATION ?? "0";
// a process recycled onto a warm generation nobody has compared yet says so
// as well (tools/osd-warm.mjs, the note beside the generation)
let unverified = warmVerdict(join(root, "build", "by-input", generation)) === false;
const generationLabel = () => (unverified ? `${generation} warm-unverified` : generation);
app.use((req, res, next) => {
  res.set("X-OSD-Generation", generationLabel());
  next();
});
serveSandboxConfig(app);

// **What this host answers is declared in src/icf/nodes.json, and what
// follows registers it.** A host used to carry its own list of paths, which
// is how three hosts came to disagree by construction; now the registry has
// the list and each entry here only says how it attaches. mountHost() below
// refuses a handler no node declares and a node this file is declared to
// serve and does not.
const hostNodes = {};

// how a supervisor knows this runtime is alive and which generation of the
// code it carries; not part of any ADT or OData surface
hostNodes.serving = (a, node) => a.get(node.path, function (req, res) {
  res.json({
    ready: true,
    pid: process.pid,
    since: started,
    generation: generationLabel(),
    // the swaps this process took instead of being replaced
    hot: {swaps: hot.swaps, since: hot.since, unverified},
    root,
    // the connection's own path, not the environment's guess about it
    database: globalThis.abap?.context?.databaseConnections?.DEFAULT?.path ?? process.env.STG_DB_PATH ?? ":memory:",
    databaseIdentity: databaseDescriptor(globalThis.abap?.context?.databaseConnections?.DEFAULT),
  });
});

// Short dumps: a runtime error is kept, with its ABAP position and frames,
// the way ST22 keeps one — the last hundred, in memory, readable at
// /osd/dumps — and said in the log as the ABAP statement it happened on,
// not as a line of generated JavaScript. tools/osd-where.mjs resolves the
// generated position through the source map beside each module; the maps
// are written by the transpiler (write_source_map) and point back into the
// tree from wherever the generation lives.
const dumps = [];
function dump(error, request) {
  const d = dumpOf(error, {request});
  dumps.push(d);
  if (dumps.length > 100) {
    dumps.shift();
  }
  // a dump is the thing a person is most likely to be waiting to see, and
  // it was going into the tail with everything else
  announce(`runtime error: ${d.where}${request ? `  (${request})` : ""}`);
  for (const f of d.frames.slice(1, 6)) {
    console.error(`    at ${f.file}:${f.line}${f.text ? "  " + f.text : ""}`);
  }
  // ZOSD_DUMP, the table (tools/osd-dumps.mjs): a kernel job, so it happens
  // here and not in the ABAP. SYSTEM DUMP can arrive inside the failed
  // step, so detach its context and queue persistence behind that step.
  // persistDump() commits through a fresh step of its own. Not awaited:
  // the response above does not wait on the table, and a table write that
  // fails is still a dump the ring and the log already have.
  outsideStepContext(() => persistDump(globalThis.abap.context.databaseConnections.DEFAULT, d, {request, generation: generationLabel()}))
    .catch((e) => console.error(`ZOSD_DUMP: ${e?.message ?? e}`));
  return d;
}
hostNodes.dumps = (a, node) => a.get(node.path, function (req, res) {
  res.json(dumps.slice().reverse());
});
hostNodes["adt-step"] = (a, node) => a.post(node.path, async (req, res) => {
  const address = req.socket.remoteAddress ?? "";
  if (address !== "::1" && !/^127\./.test(address) && !/^::ffff:127\./.test(address)) {
    res.status(403).json({error: {code: "LOCAL_ONLY"}});
    return;
  }
  if (process.env.OSD_ADT_ONE_RUNTIME !== "1") return res.status(404).end();
  let input;
  try {
    input = JSON.parse(req.body.toString("utf8"));
    if (input.view?.sessionCall === undefined && (!input.view || typeof input.view.method !== "string" || typeof input.view.path !== "string"
      || typeof input.view.url !== "string" || input.view.headers === null || typeof input.view.headers !== "object" || Array.isArray(input.view.headers)
      || (input.bodyHex !== undefined && (typeof input.bodyHex !== "string" || !/^(?:[0-9a-f]{2})*$/i.test(input.bodyHex))))) throw new Error("invalid view or bodyHex");
  } catch (error) {
    return res.status(400).json({error: {code: "BAD_REQUEST", message: error.message}});
  }
  if (input.bodyRequired === true) {
    const bodyRequired = await dialogStep(() => abapServes(input.view.method, input.view.path), "ADT body routing");
    return res.json({bodyRequired});
  }
  const sessions = new AbapSessions({identity: {systemID: identity().adt.systemID, client: identity().adt.client, ...input.identity}});
  if (input.view.sessionCall !== undefined) {
    const method = input.view.sessionCall;
    if (!["get", "end", "holderOf", "holds", "lock", "unlock", "release", "whileHeld", "deleteObject"].includes(method)) return res.status(400).json({error: {message: "unknown session operation"}});
    try {
      const value = await withStoreIPC(input.context, () => dialogStep(async () => {
        const args = sessionValue(input.view.args);
        const callback = (parameters) => globalThis.abap.context.RFCDestinations.STORE.request(parameters, "OSD_SESSION_CALLBACK");
        if (method === "whileHeld") return sessions.whileHeld(...args, () => callback({action: "work"}));
        if (method === "deleteObject") {
          return sessions.deleteObject(...args, {
            find: (type, name) => callback({action: "find", type, name}),
            delete: (type, name) => callback({action: "delete", type, name}),
          });
        }
        return sessions[method](...args);
      }, "ADT session compatibility"));
      return res.json({value: sessionJSON(value ?? null)});
    } catch (error) {
      return res.status(500).json({error: {message: String(error.message ?? error)}});
    }
  }
  const request = {headers: input.view.headers};
  try {
    const {system} = abapSession(sessions, async (kind, name, _req, json) => {
      if (kind !== "IDENTITY") return undefined;
      if (input.context === undefined) return {...identity().adt, ...input.identity};
      if (input.identityError !== undefined) throw new Error(input.identityError);
      return input.systemIdentity;
    });
    const record = await withStoreIPC(input.context, () => withSystem((kind, name, json) => system(kind, name, request, json),
      () => dialogStep(async () => {
        const session = await sessions.sessionFor(request);
        const answer = await answerOf(globalThis.abap.Classes.ZCL_OSD_ADT_HANDLER,
          {...input.view, body: Buffer.from(input.bodyHex ?? "", "hex")}, session);
        // Until A3a, delegated logoff still ends its session in this same
        // FIFO turn, before a queued LOCK can resolve the old token.
        if (input.view.path === "/sap/public/bc/icf/logoff" && ["GET", "HEAD"].includes(input.view.method)
          && answer.servedBy === "HOST" && answer.continuation === undefined) {
          const id = sessionIdOf(parseCookies(request.headers.cookie));
          if (id) await sessions.end(id);
        }
        return answer;
      }, `ADT ${input.view.method} ${input.view.path}`)));
    const adt = request.adt === undefined ? undefined : {...request.adt, sessions: undefined,
      session: request.adt.session === undefined ? undefined : {...request.adt.session, locks: [...request.adt.session.locks]}};
    res.json({record: {...record, body: record.body.toString("utf8")}, adt});
  } catch (error) {
    res.status(500).json({error: {code: error.code ?? "FAILED", message: String(error.message?.get?.() ?? error.message ?? error)}});
  }
});
hostNodes["batch-runs"] = (a, node) => a.get(node.path, batchMonitorHandler(root));

// The end of a dialog step lives in tools/osd-dialog-step.mjs, because it is
// the kernel's rule and every host that runs the ABAP needs it -- this one,
// test/start.mjs's inline front and the browser preview alike.
const connection = () => globalThis.abap.context.databaseConnections.DEFAULT;

// The door for the rows: the façade's data preview asks here instead of
// booting a second runtime of its own, so what a client sees in a preview
// is what the application serves, from the same connection. SELECT only,
// bounded, the same Data the command line uses (tools/osd-data.mjs).
const data = new Data({root, client: globalThis.abap.context.databaseConnections.DEFAULT});
if (childStoreIPC !== undefined) {
  const local = new StoreDestination();
  const localDestination = {call: (name, signature) => {
    const previous = currentSystemAnswers();
    return withSystem(async (kind, name, json) => {
      const input = JSON.parse(json || "{}");
      if (kind === "SQL" || kind === "XREF") return data.query(input.sql ?? name, {max: input.max ?? 100});
      if (kind === "SQLCHECK") { await data.check(input.sql ?? name); return {ok: true}; }
      if (kind === "DUMP") {
        if (input.operation !== "record") return dumps.slice().reverse();
        const error = {constructor: {name: input.name || ""}, message: input.message, stack: input.stack};
        const recorded = dump(error, input.request);
        return {where: recorded.where, frames: recorded.frames};
      }
      if (kind === "SERVICES") return servicesFromRows(await currentRows(connection()));
      if (kind === "TRANSACTIONS") return data.query("SELECT * FROM tstc", {max: 1000});
      if (kind === "CLASSRUN") {
        const a = globalThis.abap;
        const Class = a.Classes[String(name).toUpperCase()];
        if (!Class || !(Class.IMPLEMENTED_INTERFACES ?? []).includes("IF_OO_ADT_CLASSRUN")) throw new Error("class is not a compiled classrun");
        const out = await new a.Classes.ZCL_OSD_CLASSRUN_OUT().constructor_();
        const object = await new Class().constructor_();
        await object.if_oo_adt_classrun$main({out});
        return {name, ok: true, text: (await out.text({rv_text: 1})).get()};
      }
      return previous?.(kind, name, json);
    }, () => local.call(name, signature));
  }};
  childStoreIPC.localSystem = localDestination;
}
hostNodes.sql = (a, node) => a.post(node.path, async function (req, res) {
  let asked;
  try {
    asked = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "{}");
  } catch {
    res.status(400).json({error: {code: "BAD_REQUEST", message: "a JSON body with sql and max"}});
    return;
  }
  try {
    // the shared connection, read between steps rather than inside one
    if (asked.check === true) {
      await exclusive(() => data.check(String(asked.sql ?? "")));
      res.json({ok: true});
    } else {
      res.json(await exclusive(() => data.query(String(asked.sql ?? ""), {max: Number(asked.max ?? 100)})));
    }
  } catch (e) {
    res.status(e?.code === "NOT_BUILT" ? 503 : 400).json({error: {code: e?.code ?? "FAILED", message: String(e?.message ?? e)}});
  }
});

// Q6b's own door: F9 over a served (child) runtime. This process holds the
// live connection, so a classrun answers here rather than through the
// façade's own (empty, in child mode) globalThis.abap -- tools/osd-data.mjs
// Data#classrun is the other end. The façade already checked the class
// implements IF_OO_ADT_CLASSRUN before it ever asked; runClassrun repeats
// the check off the compiled class itself, because this door has no store.
hostNodes.classrun = (a, node) => a.post(node.path, async function (req, res) {
  let asked;
  try {
    asked = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "{}");
  } catch {
    res.status(400).json({error: {code: "BAD_REQUEST", message: "a JSON body with name"}});
    return;
  }
  try {
    const {runClassrun} = await import("./osd-classrun.mjs");
    res.json(await runClassrun(root, String(asked.name ?? ""), {generation: generationLabel()}));
  } catch (e) {
    res.status(["NOT_TRANSPILED", "NOT_BUILT"].includes(e?.code) ? 503 : e?.code === "NOT_CLASSRUN" ? 400 : 500)
      .json({error: {code: e?.code ?? "FAILED", message: String(e?.message ?? e)}});
  }
});

// and the declared ones attach, in the registry's order rather than in the
// order the lines above happen to sit in
const declared = nodes(root, {proxies: false});
mountHost(app, declared, hostNodes, {host: "tools/osd-serve.mjs"});
// the paths another registry owns, from that registry: see mountServices
const claimed = declared.filter((n) => n.source.endsWith("nodes.json")).map((n) => n.path);

// SICF: every other ICF service the tree carries, answered here by the
// same shim the OData front uses. The parent lists the same paths and
// proxies them, so an activated handler goes live with the recycle.
const icf = mountServices(app, (args) => dialogStep(() => cl_express_icf_shim.run({
  ...args,
  base: new globalThis.abap.types.String().set(args.base),
})), {root, claimed, from: servicesFromRows(icfRowsNow),
  // a node's error belongs in the dumps like any other, and used to reach
  // only console.error -- which is why the one route that moved into a node
  // would have lost its dump() on the way. Given back to every node at once.
  onError: (service, e, req) => dump(e, `${req?.method ?? ""} ${service.path}`)});

// The system status, written from outside.
//
// ZOSD_STATUS_SRV reads five tables; the facade computes what goes in them
// (tools/osd-status.mjs) and posts it here just before it proxies a read of
// that service. Not an OData surface and not an ADT one: a door of this
// process, like /osd/sql beside it.
// POST /osd/status was here. It is an ICF node now --
// src/status/zosd_status.sicf.xml at /sap/bc/osd/status/, handled by
// ZCL_OSD_STATUS_HTTP -- because nothing in it needed the host: the work
// was already zcl_osd_status=>refresh, and the body read, the JSON answer
// and the error log all come from the shim. First of the rivals in
// tools/osd-routes.mjs to become a node.


app.all("/sap/opu/odata/sap/*", async function (req, res) {
  try {
    const caseId = req.get("X-OSD-Case");
    const reference = referenceCases?.[caseId];
    if (referenceCases && caseId && !reference) {
      res.status(400).json({error: "unknown X-OSD-Case"});
      return;
    }
    let uuidUsed = 0;
    if (reference) {
      const writeHead = res.writeHead;
      res.writeHead = function (...args) {
        res.setHeader("X-OSD-UUID-Used", String(uuidUsed));
        return writeHead.apply(this, args);
      };
    }
    await dialogStep(() => {
      const serve = () => cl_express_icf_shim.run({
        req,
        res,
        class: "ZCL_STG_HTTP_HANDLER",
        base: new globalThis.abap.types.String().set("/sap/opu/odata/sap"),
      });
      return reference
        ? withAbapCase(globalThis.abap, uuidClass, {...reference, onUuidUsed: (n) => { uuidUsed = n; }}, async () => {
          if (reference.probeDelayMs) await new Promise((done) => setTimeout(done, reference.probeDelayMs));
          return serve();
        })
        : serve();
    });
  } catch (e) {
    // a runtime error is not an ABAP exception the dispatcher can catch;
    // answer rather than leave the client hanging
    const d = dump(e, `${req.method} ${req.originalUrl}`);
    if (!res.headersSent) {
      // the OData error, with the ABAP position where a client can read it
      res.status(500).type("application/json").send(JSON.stringify({error: {
        code: "STG/RUNTIME",
        message: {lang: "en", value: d.message},
        innererror: {where: d.where, frames: d.frames.map((f) => `${f.file}:${f.line}${f.text ? "  " + f.text : ""}`)},
      }}));
    }
  }
});

const wanted = Number(process.argv[2] ?? process.env.OSD_SERVE_PORT ?? 0);
const server = app.listen(wanted, "127.0.0.1", () => {
  const port = server.address().port;
  // push channels answer their upgrade on this listener; the parent proxies
  // the upgrade here, so a recycled channel handler is the one that answers
  const apc = mountChannels(server, channels(root), {host: zcl_apc_host, log: (line) => console.error(line)});
  if (process.send === undefined) {
    for (const s of icf) console.log(`ICF service  on http://127.0.0.1:${port}${s.path}  (${s.handler})`);
    for (const c of apc) console.log(`Push channel on ws://127.0.0.1:${port}${c.path}  (${c.handler})`);
  }
  clearInterval(booting);
  bootStep("serving");
  // serving: the signals' defaults (or the file save's own handler) again
  guard.serving();
  if (process.send !== undefined) {
    process.send({type: "ready", port, pid: process.pid, ms: Date.now() - started});
  } else {
    console.log(`serving on http://127.0.0.1:${port}/sap/opu/odata/sap/ after ${Date.now() - started} ms`);
  }
});

// asked to go away: stop taking requests, let the ones in flight finish,
// and exit. The database writes itself on the way out (tools/osd-persist.mjs
// registered that when the runtime booted), which is why an exit is allowed
// to be the thing that saves.
// a warm build's modules, loaded between two dialog steps: under the work
// process, so no step sees half a swap
process.on("message", (message) => {
  if (message?.type === "verified" && message.generation === generation) {
    unverified = false;
    return;
  }
  if (message?.type !== "hot") {
    return;
  }
  exclusive(async () => {
    const done = await applyRuntimeHotSwap(hot, message);
    // Every consumer of this process's loaded code changes generation under
    // the same work-process lock, before the next ABAP step can start.
    generation = message.generation;
    unverified = message.verified !== true;
    return done;
  }, "a warm swap").then((done) => {
    process.send?.({type: "hot-done", id: message.id, ok: true, ...done, heap: process.memoryUsage().heapUsed});
  }, (error) => {
    process.send?.({type: "hot-done", id: message.id, ok: false, error: String(error?.stack ?? error)});
  });
});

// the debugger on demand (tools/osd-inspector.mjs): the inspector opened or
// closed while this process serves, so a breakpoint needs no restart.
// node:inspector is imported when asked, not at the top: a host without it
// (a compiled binary) must still boot, and answers the request with why not
process.on("message", (message) => {
  if (message?.type !== "inspector") {
    return;
  }
  import("node:inspector").then((inspector) => inspector, () => undefined).then((inspector) => {
    process.send?.(inspectorRequest(message, inspector));
  });
});

process.on("message", (message) => {
  if (message?.type !== "quiesce") {
    return;
  }
  // The open LUW is committed before the process goes, whichever client
  // holds it. Then the two kinds part ways: a client that persists by
  // exporting at exit (sql.js, tools/osd-persist.mjs) must stay open for
  // the exit hook that exports it — closing it first is how a recycle once
  // lost every row — while the file client is closed here so it commits
  // and checkpoints, which process.exit alone would not do.
  //
  // The commit waits for the work process: committing while a step is
  // half-way would make its half permanent. If no step lets go within the
  // grace, the process leaves without committing, and the step that did not
  // finish is rolled back rather than half-written.
  const grace = Number(message.grace ?? 2000);
  let leaving;
  const leave = () => (leaving ??= (async () => {
    const db = connection();
    let committed = false;
    try {
      await Promise.race([
        exclusive(async () => {
          await db.commit?.();
          // Send while the connection is open, after the last step commits.
          committed = true;
          try {
            if (process.env.OSD_ADT_CARRY === "1") {
              const state = await snapshotAdtRows(db);
              if (process.connected) await new Promise((resolve, reject) => {
                process.send({type: "adt-carry", state}, (error) => error ? reject(error) : resolve());
              });
            }
          } catch (error) {
            announce(`ADT carry failed: ${error.message}; disconnecting after commit`);
          } finally {
            if (typeof db.export !== "function") {
              await db.disconnect?.();
            }
          }
        }, "leaving for a recycle"),
        new Promise((resolve) => setTimeout(resolve, grace).unref()),
      ]);
      // the grace won: the step still holding the work process is rolled
      // back here, because the exit hook of a client that persists by
      // exporting (sql.js, tools/osd-persist.mjs) commits what is open
      // before it exports -- "leaving without committing" would otherwise
      // hold only for DuckDB and the file clients
      if (committed === false) await db.rollback?.();
    } catch {
      // leaving anyway; the supervisor has a new runtime answering
    }
    process.exit(0);
  })());
  server.close(leave);
  // a client holding a connection open must not keep a replaced runtime
  // alive; the supervisor already has a new one answering
  setTimeout(leave, grace).unref();
});
