import express from "express";
import {createServer as createHttpsServer} from "node:https";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {generateProject} from "../tools/segw-editor.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {Data} from "../tools/osd-data.mjs";
import {DEFAULT_DATABASE} from "../tools/sqlite-file-client.mjs";
import {credentials as tlsCredentials, fingerprint as tlsFingerprint, TLS_DIR} from "../tools/osd-tls.mjs";
import {odataProxy, upgradeProxy} from "../tools/osd-proxy.mjs";
import {devLoop} from "../tools/osd-dev.mjs";
import {mountServices, services as icfServices, channels as pushChannels} from "../tools/osd-icf.mjs";
import {mountChannels} from "../tools/osd-apc.mjs";

// Two shapes of one listener, and the difference is whether this process
// contains an ABAP system.
//
// Inline is the old shape: the transpiled modules are imported here and
// answer here. It is what a test wants — no child, no second database —
// and what the browser preview is built from. Its limit is why the other
// shape exists: Node pins a module graph for the life of a process, so code
// activated through the façade, or saved on disk, is never live here.
//
// Child is the workbench: this process is the façade, the static files and
// a proxy, and loads no ABAP at all. The system runs in tools/osd-serve.mjs,
// a process the supervisor replaces after a successful build — OData, every
// ICF service, the push channels, and the door the data preview reads
// through. One generation, one database, and every consumer on them.
// STG_SERVE=child asks for it; test/run.mjs, the way a server is started,
// defaults to it; a suite that calls startServer() itself stays inline.
const MODE = process.env.STG_SERVE === "child" ? "child" : "inline";

async function loadInline() {
  const from = (file) => import(new URL(`../output/${file}`, import.meta.url).href);
  const {initializeABAP} = await from("init.mjs");
  const {cl_express_icf_shim} = await from("cl_express_icf_shim.clas.mjs");
  const {zcl_stg_segw_registry} = await from("zcl_stg_segw_registry.clas.mjs");
  const {zcl_stg_shlp_registry} = await from("zcl_stg_shlp_registry.clas.mjs");
  const {zcl_apc_host} = await from("zcl_apc_host.clas.mjs");
  await initializeABAP();
  // the SEGW registration objects (IWSV/IWMO in src/) say which service is
  // served by which MPC/DPC classes; tools/segw-registry.mjs generated this
  await zcl_stg_segw_registry.register();
  // the search help objects (*.shlp.xml in src/) become value help providers;
  // tools/segw-shlp.mjs generated this
  await zcl_stg_shlp_registry.register();
  return {cl_express_icf_shim, zcl_apc_host};
}
const inline = MODE === "inline" ? await loadInline() : undefined;


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
  // the tree's webapp, not the module's: in a binary the module has no folder
  app.use("/app", express.static(join(process.cwd(), "webapp")));

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
  // STG_ADT_SID renames the system this façade says it is.
  //
  // A client keys its cached compatibility metadata by system id, not by
  // project — which is why creating project after project against a system
  // whose graph had changed kept reading the graph from the first time it
  // asked, and why "make a new project" never helped. A different id is a
  // different cache entry, and the cheapest way to tell a stale cache from a
  // wrong answer.
  const store = new ObjectStore({root: process.cwd()});
  // the database is named here and handed to the child, so the registry and
  // the build endpoint say the same file the child opens — including the
  // default one, which used to be chosen inside the child and reported as
  // "memory" outside it
  const database = process.env.STG_DB_PATH ?? (process.env.STG_DB === "file" ? DEFAULT_DATABASE : undefined);
  const runtime = MODE === "child"
    ? store.serving({root: process.cwd(), database})
    : undefined;
  const data = MODE === "child"
    ? new Data({root: process.cwd(), runtime})
    : new Data({client: abap.context.databaseConnections["DEFAULT"]});
  const facade = adtRouter({
    store,
    data,
    systemID: process.env.STG_ADT_SID,
  });
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
  const reserved = ["/sap/opu/odata", "/sap/bc/adt"];
  let icf;
  if (MODE === "inline") {
    icf = mountServices(app, (args) => inline.cl_express_icf_shim.run({
      ...args,
      base: new abap.types.String().set(args.base),
    }), {root: process.cwd(), reserved});
  } else {
    // the same paths, proxied to the child that answers them
    // the same filter mountServices applies: a reserved prefix, or a node
    // without a handler (an APC path's SICF entry), is not a service
    icf = icfServices(process.cwd()).filter((s) => s.handler !== undefined && !reserved.some((prefix) => s.path.startsWith(prefix)));
    for (const service of icf) {
      app.all(service.path, odataProxy(runtime));
      app.all(`${service.path}/*`, odataProxy(runtime));
    }
  }
  if (quiet !== true && icf.length > 0) {
    for (const service of icf) {
      console.log(`ICF service  on http://localhost:${PORT}${service.path}  (${service.handler})${MODE === "child" ? "  [proxied]" : ""}`);
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

  if (runtime !== undefined) {
    app.all("/sap/opu/odata/sap/*", odataProxy(runtime));
    // STG_DEV=1: the disk is the other editor. A save becomes a check, a
    // build and a recycle of this runtime (tools/osd-dev.mjs), and the
    // runtime is started now rather than at the first request, so the first
    // save has something to recycle and the app is up when you look.
    if (process.env.STG_DEV === "1") {
      devLoop({store: facade.store});
    }
    // the system comes up with the listener, not at the first request: the
    // app is there when you look, the registry names it, and the build
    // endpoint has a serving generation to compare with from the start
    runtime.start().then(
      (r) => quiet === true || console.log(`serving generation ${r.generation} on ${r.url} (${r.pid}), rows in ${database ?? "memory"}`),
      (e) => console.error(`runtime: ${e.message}`),
    );
  } else {
    app.all("/sap/opu/odata/sap/*", async function (req, res) {
      try {
        await inline.cl_express_icf_shim.run({
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

  // Push channels: the websocket half of what a repository declares.
  //
  // A *.sapc.xml names a path, a handler class and whether it is stateful,
  // and tools/osd-apc.mjs drives that handler through zcl_apc_host, so a
  // class written for cl_apc_wsp_ext_stateful_base runs here unchanged. The
  // upgrade is answered on this listener rather than proxied to the serving
  // child, which is a limit worth knowing: an activated push channel does
  // not go live until this process restarts, the way the OData path did
  // before it was proxied. Written down in docs/adt-facade.md.
  const declared = pushChannels(process.cwd());
  let channels;
  if (MODE === "inline") {
    channels = mountChannels(server, declared, {
      host: inline.zcl_apc_host,
      log: (line) => console.error(line),
    });
  } else {
    // the upgrade is proxied to the child, which answers it with the
    // handler of the generation it runs; an activated channel goes live
    // with the recycle, which the inline shape could never do
    channels = declared;
    if (declared.length > 0) {
      server.on("upgrade", upgradeProxy(runtime, declared.map((c) => c.path), (line) => console.error(line)));
    }
  }
  if (quiet !== true) {
    for (const channel of channels) {
      console.log(`Push channel on ws://localhost:${PORT}${channel.path}  (${channel.handler})${MODE === "child" ? "  [proxied]" : ""}`);
    }
  }

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
