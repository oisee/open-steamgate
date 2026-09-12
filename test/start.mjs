import express from "express";
import {fileURLToPath} from "node:url";
import {initializeABAP} from "../output/init.mjs";
import {cl_express_icf_shim} from "../output/cl_express_icf_shim.clas.mjs";
import {zcl_stg_segw_registry} from "../output/zcl_stg_segw_registry.clas.mjs";

await initializeABAP();

// the SEGW registration objects (IWSV/IWMO in src/) say which service is
// served by which MPC/DPC classes; tools/segw-registry.mjs generated this
await zcl_stg_segw_registry.register();

export function startServer(quiet) {
  const PORT = Number(process.env.STG_PORT ?? 3030);

  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.use(express.raw({type: "*/*"}));

  app.get("/", function (req, res) {
    res.send('open-steamgate: OData v2 services live under /sap/opu/odata/sap/, the demo Fiori app under <a href="/app/index.html">/app/</a>');
  });

  // the Fiori Elements demo app, same origin as the service: no proxy, no CORS
  app.use("/app", express.static(fileURLToPath(new URL("../webapp", import.meta.url))));

  app.all("/sap/opu/odata/sap/*", async function (req, res) {
    try {
      await cl_express_icf_shim.run({
        req,
        res,
        class: "ZCL_STG_HTTP_HANDLER",
        base: new abap.types.String().set("/sap/opu/odata/sap"),
      });
    } catch (e) {
      // a runtime (kernel) error is not an ABAP exception the dispatcher can
      // catch; answer instead of leaving the client hanging
      if (!res.headersSent) {
        res.status(500).type("application/json").send(JSON.stringify({error: {code: "STG/RUNTIME", message: {lang: "en", value: String(e?.message?.get?.() ?? e?.message ?? e)}}}));
      }
      console.error("runtime error:", e);
    }
  });

  const server = app.listen(PORT);
  if (quiet !== true) {
    console.log("Listening on http://localhost:" + PORT + "/sap/opu/odata/sap/");
  }
  return server;
}
