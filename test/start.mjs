import express from "express";
import {fileURLToPath} from "node:url";
import {initializeABAP} from "../output/init.mjs";
import {cl_express_icf_shim} from "../output/cl_express_icf_shim.clas.mjs";
import {zcl_stg_segw_registry} from "../output/zcl_stg_segw_registry.clas.mjs";
import {zcl_stg_shlp_registry} from "../output/zcl_stg_shlp_registry.clas.mjs";
import {generateProject} from "../tools/segw-editor.mjs";

await initializeABAP();

// the SEGW registration objects (IWSV/IWMO in src/) say which service is
// served by which MPC/DPC classes; tools/segw-registry.mjs generated this
await zcl_stg_segw_registry.register();
// the search help objects (*.shlp.xml in src/) become value help providers;
// tools/segw-shlp.mjs generated this
await zcl_stg_shlp_registry.register();

export function startServer(quiet) {
  const PORT = Number(process.env.STG_PORT ?? 3030);

  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  // an IWPR of a real SEGW project is a few hundred KB (ImportSet takes it as JSON)
  app.use(express.raw({type: "*/*", limit: "16mb"}));

  app.get("/", function (req, res) {
    res.send('open-steamgate: OData v2 services live under /sap/opu/odata/sap/, the demo Fiori app under <a href="/app/index.html">/app/</a>');
  });

  // the Fiori Elements demo app, same origin as the service: no proxy, no CORS
  app.use("/app", express.static(fileURLToPath(new URL("../webapp", import.meta.url))));

  // the SEGW editor's dev-time seam (webapp/segw/): the files GenerateSet
  // gives, written to gen/segw-editor/<project>/ (Generate, Import and
  // Export are the service's; only the file system is Node's)
  const self = "http://localhost:" + PORT;
  app.post("/segw/generate/:project", async function (req, res) {
    try {
      res.json(await generateProject(self, req.params.project));
    } catch (e) {
      res.status(500).type("text/plain").send(String(e?.message ?? e));
    }
  });

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
