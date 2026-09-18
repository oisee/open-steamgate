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
import {dialogStep} from "./osd-dialog-step.mjs";
import express from "express";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {mountServices, channels} from "./osd-icf.mjs";
import {mountChannels} from "./osd-apc.mjs";
import {Data} from "./osd-data.mjs";
import {dumpOf} from "./osd-where.mjs";

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
await zcl_stg_segw_registry.register();
await zcl_stg_shlp_registry.register();

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

// how a supervisor knows this runtime is alive and which generation of the
// code it carries; not part of any ADT or OData surface
app.get("/osd/serving", function (req, res) {
  res.json({
    ready: true,
    pid: process.pid,
    since: started,
    generation: process.env.OSD_GENERATION ?? "0",
    root,
    // the connection's own path, not the environment's guess about it
    database: globalThis.abap?.context?.databaseConnections?.DEFAULT?.path ?? process.env.STG_DB_PATH ?? ":memory:",
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
  console.error(`runtime error: ${d.where}${request ? `  (${request})` : ""}`);
  for (const f of d.frames.slice(1, 6)) {
    console.error(`    at ${f.file}:${f.line}${f.text ? "  " + f.text : ""}`);
  }
  return d;
}
app.get("/osd/dumps", function (req, res) {
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
app.post("/osd/sql", async function (req, res) {
  let asked;
  try {
    asked = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "{}");
  } catch {
    res.status(400).json({error: {code: "BAD_REQUEST", message: "a JSON body with sql and max"}});
    return;
  }
  try {
    res.json(await data.query(String(asked.sql ?? ""), {max: Number(asked.max ?? 100)}));
  } catch (e) {
    res.status(e?.code === "NOT_BUILT" ? 503 : 400).json({error: {code: e?.code ?? "FAILED", message: String(e?.message ?? e)}});
  }
});

// SICF: every other ICF service the tree carries, answered here by the
// same shim the OData front uses. The parent lists the same paths and
// proxies them, so an activated handler goes live with the recycle.
const icf = mountServices(app, (args) => dialogStep(() => cl_express_icf_shim.run({
  ...args,
  base: new globalThis.abap.types.String().set(args.base),
})), {root, reserved: ["/sap/opu/odata", "/sap/bc/adt"]});

// The system status, written from outside.
//
// ZOSD_STATUS_SRV reads five tables; the facade computes what goes in them
// (tools/osd-status.mjs) and posts it here just before it proxies a read of
// that service. Not an OData surface and not an ADT one: a door of this
// process, like /osd/sql beside it.
app.post("/osd/status", async function (req, res) {
  const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
  try {
    const rows = await dialogStep(() => zcl_osd_status.refresh({iv_json: body}));
    res.json({rows: rows.get()});
  } catch (e) {
    dump(e, "POST /osd/status");
    res.status(500).json({error: {code: "STATUS_REFRESH", message: String(e?.message?.get?.() ?? e?.message ?? e)}});
  }
});

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
  const leave = async () => {
    const db = connection();
    try {
      await db.commit?.();
      if (typeof db.export !== "function") {
        await db.disconnect?.();
      }
    } catch {
      // leaving anyway; the supervisor has a new runtime answering
    }
    process.exit(0);
  };
  server.close(leave);
  // a client holding a connection open must not keep a replaced runtime
  // alive; the supervisor already has a new one answering
  setTimeout(leave, Number(message.grace ?? 2000)).unref();
});
