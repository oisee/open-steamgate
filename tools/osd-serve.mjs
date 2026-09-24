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
import {dialogStep, exclusive} from "./osd-dialog-step.mjs";
import {ensureDemoData} from "./osd-demo-data.mjs";
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
import {serveSandboxConfig} from "./osd-sandbox-config.mjs";

const started = Date.now();

// which tree this runtime serves, so one copy of this script can serve any
// of them: a second worktree, a branch under test, an experiment on its own
// port and its own database. The modules are loaded from there rather than
// from next to this file, which is what would otherwise pin an instance to
// the checkout the script happens to live in.
const root = process.env.OSD_ROOT ?? process.cwd();
const from = (file) => import(pathToFileURL(join(root, "output", file)).href);

const {initializeABAP} = await from("init.mjs");
const {cl_express_icf_shim} = await from("cl_express_icf_shim.clas.mjs");
const {zcl_stg_segw_registry} = await from("zcl_stg_segw_registry.clas.mjs");
const {zcl_stg_shlp_registry} = await from("zcl_stg_shlp_registry.clas.mjs");
const {zcl_apc_host} = await from("zcl_apc_host.clas.mjs");
// the system-status writer (src/status/): the facade posts a snapshot here
// because only it can see the pool, the listeners and the generation, and
// only this process can write the tables the service reads
const {zcl_osd_status} = await from("zcl_osd_status.clas.mjs");

await initializeABAP();
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
  process.send?.({type: "say", line});
};

const registry = await applyAtStartup(globalThis.abap.context.databaseConnections.DEFAULT, {root, say: announce});
if (registry === undefined) {
  throw new Error("the ICF registry could not be applied, and the routes below come from it");
}
const icfRowsNow = await currentRows(globalThis.abap.context.databaseConnections.DEFAULT);
// the cross-reference, derived from the files and cached per generation
// (tools/osd-xref-seed.mjs): the same call every host makes
await seedAtStartup(globalThis.abap.context.databaseConnections.DEFAULT, {root, say: announce});
await zcl_stg_segw_registry.register();
await zcl_stg_shlp_registry.register();
// the synthetic taxi facts, made by ZCL_OSD_DEMO_DATA (tools/osd-demo-data.mjs)
await ensureDemoData((await from("zcl_osd_demo_data.clas.mjs")).zcl_osd_demo_data, {say: announce});

const app = express();
app.disable("x-powered-by");
app.set("etag", false);
app.use(express.raw({type: "*/*", limit: "16mb"}));
// every answer says which code produced it: the generation the supervisor
// named when it started this process (the live build's hash)
app.use((req, res, next) => {
  res.set("X-OSD-Generation", process.env.OSD_GENERATION ?? "0");
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
    generation: process.env.OSD_GENERATION ?? "0",
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
  return d;
}
hostNodes.dumps = (a, node) => a.get(node.path, function (req, res) {
  res.json(dumps.slice().reverse());
});

// The end of a dialog step lives in tools/osd-dialog-step.mjs, because it is
// the kernel's rule and every host that runs the ABAP needs it -- this one,
// test/start.mjs's inline front and the browser preview alike.
const connection = () => globalThis.abap.context.databaseConnections.DEFAULT;

// The door for the rows: the façade's data preview asks here instead of
// booting a second runtime of its own, so what a client sees in a preview
// is what the application serves, from the same connection. SELECT only,
// bounded, the same Data the command line uses (tools/osd-data.mjs).
const data = new Data({root, client: globalThis.abap.context.databaseConnections.DEFAULT});
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
    await dialogStep(() => cl_express_icf_shim.run({
      req,
      res,
      class: "ZCL_STG_HTTP_HANDLER",
      base: new globalThis.abap.types.String().set("/sap/opu/odata/sap"),
    }));
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
    try {
      await Promise.race([
        exclusive(async () => {
          await db.commit?.();
          if (typeof db.export !== "function") {
            await db.disconnect?.();
          }
        }, "leaving for a recycle"),
        new Promise((resolve) => setTimeout(resolve, grace).unref()),
      ]);
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
