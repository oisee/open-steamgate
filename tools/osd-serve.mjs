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
import express from "express";
import {initializeABAP} from "../output/init.mjs";
import {cl_express_icf_shim} from "../output/cl_express_icf_shim.clas.mjs";
import {zcl_stg_segw_registry} from "../output/zcl_stg_segw_registry.clas.mjs";
import {zcl_stg_shlp_registry} from "../output/zcl_stg_shlp_registry.clas.mjs";

const started = Date.now();

await initializeABAP();
await zcl_stg_segw_registry.register();
await zcl_stg_shlp_registry.register();

const app = express();
app.disable("x-powered-by");
app.set("etag", false);
app.use(express.raw({type: "*/*", limit: "16mb"}));

// how a supervisor knows this runtime is alive and which generation of the
// code it carries; not part of any ADT or OData surface
app.get("/osd/serving", function (req, res) {
  res.json({ready: true, pid: process.pid, since: started, generation: process.env.OSD_GENERATION ?? "0"});
});

app.all("/sap/opu/odata/sap/*", async function (req, res) {
  try {
    await cl_express_icf_shim.run({
      req,
      res,
      class: "ZCL_STG_HTTP_HANDLER",
      base: new globalThis.abap.types.String().set("/sap/opu/odata/sap"),
    });
  } catch (e) {
    // a runtime error is not an ABAP exception the dispatcher can catch;
    // answer rather than leave the client hanging
    if (!res.headersSent) {
      res.status(500).type("application/json").send(JSON.stringify({error: {code: "STG/RUNTIME", message: {lang: "en", value: String(e?.message?.get?.() ?? e?.message ?? e)}}}));
    }
    console.error("runtime error:", e);
  }
});

const wanted = Number(process.argv[2] ?? process.env.OSD_SERVE_PORT ?? 0);
const server = app.listen(wanted, "127.0.0.1", () => {
  const port = server.address().port;
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
  server.close(() => process.exit(0));
  // a client holding a connection open must not keep a replaced runtime
  // alive; the supervisor already has a new one answering
  setTimeout(() => process.exit(0), Number(message.grace ?? 2000)).unref();
});
