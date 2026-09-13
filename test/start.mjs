import express from "express";
import {createServer as createHttpsServer} from "node:https";
import {fileURLToPath} from "node:url";
import {initializeABAP} from "../output/init.mjs";
import {cl_express_icf_shim} from "../output/cl_express_icf_shim.clas.mjs";
import {zcl_stg_segw_registry} from "../output/zcl_stg_segw_registry.clas.mjs";
import {zcl_stg_shlp_registry} from "../output/zcl_stg_shlp_registry.clas.mjs";
import {generateProject} from "../tools/segw-editor.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {Data} from "../tools/osd-data.mjs";
import {credentials as tlsCredentials, fingerprint as tlsFingerprint, TLS_DIR} from "../tools/osd-tls.mjs";
import {odataProxy} from "../tools/osd-proxy.mjs";
import {mountServices} from "../tools/osd-icf.mjs";

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

  // the ADT façade: /sap/bc/adt/** answered by OSD, the off-stack
  // doppelgänger. Node rather than ABAP, because it reads the file system
  // and spawns abaplint and the transpiler, which transpiled ABAP cannot do;
  // the OData path below stays ABAP behind the ICF shim as it always was.
  // Both fronts share this listener, which is why a client points at one
  // address for both. docs/adt-facade.md is the contract.
  // the data layer of OSD boots its own runtime when it is used from a
  // command line; here one is already up, so it is handed the connection
  // rather than starting a second and re-running the seed under a live server
  const facade = adtRouter({data: new Data({client: abap.context.databaseConnections["DEFAULT"]})});
  app.use(facade.router);
  // what a client asked the façade for and did not get, on demand: point a
  // strange client at OSD, then read this to learn what it wanted
  app.get("/osd/not-served", function (req, res) {
    res.json([...facade.missed.values()].sort((a, b) => b.count - a.count));
  });
  // parsing the system is the expensive part of a syntax check or an object
  // structure, and it is shared once paid. A served instance pays it at
  // startup so the first client does not buy it for the second; it is
  // seconds of a blocked loop over a big system, which is why a test
  // harness, where nothing waits on it, does not.
  if (quiet !== true) {
    setImmediate(() => {
      const started = Date.now();
      const objects = facade.store.list().length;
      facade.store.registry();
      console.log(`parsed ${objects} objects in ${Date.now() - started} ms`);
    });
  }

  // SICF: every other ICF service this tree carries.
  //
  // The OData front is one if_http_extension on one path; a system has many,
  // and which class answers which URL is what SICF holds. A repository that
  // brings a *.sicf.xml brings its own route with it, so an application can
  // be imported and served without this file learning its name. Mounted
  // before the OData front only so the reserved prefix below is meaningful.
  const icf = mountServices(app, (args) => cl_express_icf_shim.run({
    ...args,
    base: new abap.types.String().set(args.base),
  }), {root: process.cwd(), reserved: ["/sap/opu/odata", "/sap/bc/adt"]});
  if (quiet !== true && icf.length > 0) {
    for (const service of icf) {
      console.log(`ICF service  on http://localhost:${PORT}${service.path}  (${service.handler})`);
    }
  }

  // The OData front, in one of two places.
  //
  // Inline is this process: the modules imported at the top of this file
  // answer the request. It is what a test wants, because it costs no child
  // and no second database, and it is what the browser preview is built
  // from. Its limit is the reason the other mode exists: Node pins a module
  // graph for the life of a process, so code activated through the façade is
  // never live here until somebody restarts the whole listener, and that
  // restart takes the developer's ADT session with it.
  //
  // Child is a process the façade supervises and replaces after a successful
  // transpile (tools/osd-runtime.mjs), which is the only way an activation
  // can honestly report that the code is live. STG_SERVE=child asks for it;
  // npm run osd:serve sets it, and nothing else does, so a suite that never
  // activates anything pays nothing for the ability.
  const runtime = process.env.STG_SERVE === "child"
    ? facade.store.serving({root: process.cwd(), database: process.env.STG_DB_PATH})
    : undefined;

  if (runtime !== undefined) {
    app.all("/sap/opu/odata/sap/*", odataProxy(runtime));
  } else {
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
  }

  const server = app.listen(PORT);

  // HTTPS beside it, on the SAP-shaped port for this instance. Eclipse
  // refuses a plain-HTTP project outright, so without TLS that client cannot
  // reach OSD at all; other clients keep the plain port and lose nothing.
  // The certificate is self-signed and lives outside this repository.
  const TLS_PORT = Number(process.env.STG_TLS_PORT ?? 44300 + (PORT % 100));
  const tls = process.env.STG_TLS === "0" ? undefined : tlsCredentials();
  let secure;
  if (tls !== undefined) {
    secure = createHttpsServer(tls, app).listen(TLS_PORT);
  }

  if (quiet !== true) {
    console.log("Listening on http://localhost:" + PORT + "/sap/opu/odata/sap/");
    console.log("ADT façade   on http://localhost:" + PORT + "/sap/bc/adt/core/discovery");
    if (secure === undefined) {
      console.log("No TLS: run `npm run osd:tls` to make a certificate, for a client that refuses plain HTTP");
    } else {
      console.log("HTTPS        on https://localhost:" + TLS_PORT + "  (self-signed, sha256 " + tlsFingerprint() + ")");
      console.log("             the certificate is " + TLS_DIR + "/osd.crt; a client will ask once whether to trust it");
    }
  }

  const close = server.close.bind(server);
  server.close = (cb) => {
    secure?.close();
    // the supervised runtime is this listener's child; leaving it behind
    // would hold the port and the database the next one needs
    void runtime?.stop();
    return close(cb);
  };
  return server;
}
