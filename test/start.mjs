import express from "express";
import {initializeABAP} from "../output/init.mjs";
import {cl_express_icf_shim} from "../output/cl_express_icf_shim.clas.mjs";
import {zcl_oao_registry} from "../output/zcl_oao_registry.clas.mjs";

await initializeABAP();

// service name -> MPC/DPC classes; the SEGW registration of a real system
await zcl_oao_registry.register({
  iv_service: new abap.types.String().set("ZSTG_DEMO_SRV"),
  iv_mpc: new abap.types.String().set("ZCL_ZSTG_DEMO_MPC_EXT"),
  iv_dpc: new abap.types.String().set("ZCL_ZSTG_DEMO_DPC_EXT"),
});

export function startServer(quiet) {
  const PORT = Number(process.env.STG_PORT ?? 3030);

  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.use(express.raw({type: "*/*"}));

  app.get("/", function (req, res) {
    res.send("open-steamgate: OData v2 services live under /sap/opu/odata/sap/");
  });

  app.all("/sap/opu/odata/sap/*", async function (req, res) {
    await cl_express_icf_shim.run({
      req,
      res,
      class: "ZCL_STG_HTTP_HANDLER",
      base: new abap.types.String().set("/sap/opu/odata/sap"),
    });
  });

  const server = app.listen(PORT);
  if (quiet !== true) {
    console.log("Listening on http://localhost:" + PORT + "/sap/opu/odata/sap/");
  }
  return server;
}
