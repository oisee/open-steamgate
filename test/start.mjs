import {databasePath} from "../tools/osd-persist.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import express from "express";
import {existsSync} from "node:fs";
import {tilesOf, webappsOf} from "../tools/osd-packs.mjs";
import {mountRemoteServices} from "../tools/osd-remote-service.mjs";
import {segwRegistrations} from "../tools/segw-registry.mjs";
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
import {snapshot as statusSnapshot} from "../tools/osd-status.mjs";
import {request as httpRequest} from "node:http";
import {serveSandboxConfig} from "../tools/osd-sandbox-config.mjs";

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
  // the system-status writer; inline there is no child to post a snapshot to,
  // so the facade writes the tables itself (src/status/)
  const {zcl_osd_status} = await from("zcl_osd_status.clas.mjs");
  await initializeABAP();
  // the SEGW registration objects (IWSV/IWMO in src/) say which service is
  // served by which MPC/DPC classes; tools/segw-registry.mjs generated this
  await zcl_stg_segw_registry.register();
  // the search help objects (*.shlp.xml in src/) become value help providers;
  // tools/segw-shlp.mjs generated this
  await zcl_stg_shlp_registry.register();
  return {cl_express_icf_shim, zcl_apc_host, zcl_osd_status};
}
const inline = MODE === "inline" ? await loadInline() : undefined;


export function startServer(quiet) {
  const PORT = Number(process.env.STG_PORT ?? 3030);

  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  // an IWPR of a real SEGW project is a few hundred KB (ImportSet takes it as JSON)
  app.use(express.raw({type: "*/*", limit: "16mb"}));

  // The port's front door is the launchpad when there is one: every app and
  // every demo this system serves is a tile on it, which is what a person
  // opening a system expects to find rather than a paragraph of paths.
  app.get("/", function (req, res) {
    if (existsSync(join(process.cwd(), "webapp", "flp.html"))) {
      res.redirect(302, "/app/flp.html");
      return;
    }
    res.send('open-steamgate: OData v2 services live under /sap/opu/odata/sap/, the demo Fiori app under <a href="/app/index.html">/app/</a>');
  });

  // the Fiori Elements demo app, same origin as the service: no proxy, no CORS
  // the tree's webapp, not the module's: in a binary the module has no folder
  app.use("/app", express.static(join(process.cwd(), "webapp")));
  serveSandboxConfig(app);
  // what the launchpad asks for at start: the tiles the packs declare, so a
  // pack appears on it without anybody editing webapp/flp.html (backlog E.2)
  app.get("/app/packs.json", function (req, res) {
    res.json({tiles: tilesOf(process.cwd())});
  });
  // a pack brings its own static files, served under its name (backlog E.2)
  for (const pack of webappsOf(process.cwd())) {
    app.use(`/app/${pack.name}`, express.static(pack.dir));
  }

  // a service on another system, answered on this origin. A page this system
  // serves may then read it the way it reads ours, which a proxy on another
  // port cannot demonstrate -- see tools/osd-remote-service.mjs. Local
  // services always win: this is mounted before them and refuses any name the
  // registry has.
  // "local wins" asks the same registry the dispatcher asks, so a
  // destination can never shadow a service this system actually has
  const ours = new Set(segwRegistrations(["src", "gen"]).map((r) => r.external || r.service));
  const remote = mountRemoteServices(app, (name) => ours.has(name));
  if (remote.length > 0) {
    console.log(`remote services (a destination answers these): ${remote.join(", ")}`);
  }

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
  // asked, not decided: tools/osd-persist.mjs holds the one answer to "does
  // this backend keep its rows in a file, and which one". This line used to
  // decide for itself, read STG_DB_PATH and never ask STG_DB, and in the
  // container -- which sets STG_DB_PATH for the volume -- that meant
  // STG_DB=hana seeded HANA and served an empty SQLite file.
  const database = databasePath(DEFAULT_DATABASE);
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
  // SAP Easy Access reads the same five tables ZOSD_STATUS_SRV reads
  // (src/webgui/, docs/webgui.md), so it pays for the same refresh. It is
  // registered here, before the SICF mount below, because that mount answers
  // the request instead of passing it on: a middleware added after it would
  // never run.
  app.all("/sap/bc/gui/sap/its/webgui*", withFreshStatus);
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

  // The system status, refreshed by the read that asks for it.
  //
  // ZOSD_STATUS_SRV is five tables, and ABAP cannot fill them: the pool's
  // children, the listeners this process opened and the generation it built
  // are facts of the facade. So a request for that service — and only that
  // service, because nothing else should pay for it — computes the snapshot
  // (tools/osd-status.mjs) and posts it to the work process the proxy is
  // about to forward to, which is the one whose connection will answer.
  //
  // A refresh that fails never fails the read. The rows are still there from
  // the last one, and a status page a few seconds stale is worth more than a
  // 500 that says nothing about the system it was asked about.
  const listeners = [];

  function postSnapshot(url, body) {
    return new Promise((resolve, reject) => {
      const asked = httpRequest({
        hostname: "127.0.0.1",
        port: Number(new URL(url).port),
        path: "/sap/bc/osd/status/",
        method: "POST",
        headers: {"content-type": "application/json", "content-length": Buffer.byteLength(body)},
      }, (answer) => {
        let text = "";
        answer.on("data", (d) => {
          text = text + d.toString();
        });
        answer.on("end", () => (answer.statusCode === 200 ? resolve(text) : reject(new Error(`/sap/bc/osd/status/ answered ${answer.statusCode}: ${text.slice(0, 200)}`))));
      });
      asked.on("error", reject);
      asked.end(body);
    });
  }

  async function refreshStatus() {
    const body = JSON.stringify(await statusSnapshot(process.cwd(), {runtime, listeners}));
    if (runtime === undefined) {
      // inline: this process holds the tables
      await inline.zcl_osd_status.refresh({iv_json: body});
      return;
    }
    await runtime.ensure();
    // the address odataProxy forwards to: a pool answers for its primary,
    // so the snapshot lands in the process that is about to be asked
    const url = runtime.url;
    if (url === undefined) {
      throw new Error("no serving runtime to refresh the status in");
    }
    await postSnapshot(url, body);
  }

  // A refresh that fails never fails the read: see above.
  async function withFreshStatus(req, res, next) {
    try {
      await refreshStatus();
    } catch (e) {
      console.error(`status refresh: ${e?.message ?? e}`);
    }
    next();
  }

  app.all("/sap/opu/odata/sap/ZOSD_STATUS_SRV*", withFreshStatus);

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
      (r) => {
        // a pool answers with one entry per work process; one runtime with
        // an answer of its own, as before (tools/osd-pool.mjs)
        const started = Array.isArray(r) ? r : [r];
        if (quiet === true) {
          return;
        }
        for (const one of started) {
          console.log(`serving generation ${one.generation} on ${one.url} (${one.pid}), rows in ${database ?? "memory"}`);
        }
        if (started.length > 1) {
          console.log(`${started.length} work processes; a push channel is pinned to one for the life of its socket`);
        }
        // the status tables have something in them before anybody asks
        refreshStatus().catch((error) => console.error(`status refresh: ${error?.message ?? error}`));
      },
      (e) => console.error(`runtime: ${e.message}`),
    );
  } else {
    app.all("/sap/opu/odata/sap/*", async function (req, res) {
      try {
        // the kernel's end of a dialog step: commit when the work is done,
        // roll back when it ends in an exception nobody declared. Without it
        // a request that dumps leaves its rows pending on the connection and
        // the next modifying request's fencing COMMIT WORK adopts them
        // (tools/osd-dialog-step.mjs)
        await dialogStep(() => inline.cl_express_icf_shim.run({
          req,
          res,
          class: "ZCL_STG_HTTP_HANDLER",
          base: new abap.types.String().set("/sap/opu/odata/sap"),
        }));
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

  // what the snapshot reports as this instance's ports: what was opened here
  listeners.push({port: PORT, protocol: "HTTP", purpose: "OData, apps, ADT"});
  if (secure !== undefined) {
    listeners.push({port: TLS_PORT, protocol: "HTTPS", purpose: "the same, for a client that refuses plain HTTP"});
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
  // **Returns a promise when called without a callback**, and that is what
  // makes the suites wait. Every one of them writes `after(() =>
  // server?.close())`, and a mocha hook waits for what its function returns;
  // this returned the server object, so the hook finished while the listener
  // was still closing and the next file's `before` met the port still bound.
  //
  // Measured on HANA, where closing takes longer because the connections do:
  // 28 of 26 failures in a full run were `EADDRINUSE`, on this port and on
  // the supervised runtime's. Not on SQLite, where the race is simply won --
  // which is why this sat unnoticed while one backend was fast enough.
  //
  // `runtime.stop()` is awaited for the same reason it exists: the child
  // holds the port and the database the next listener needs, and `void` on
  // it meant "start stopping and carry on".
  server.close = (cb) => {
    if (typeof cb === "function") {
      secure?.close();
      void runtime?.stop();
      return close(cb);
    }
    return (async () => {
      await new Promise((resolve) => (secure === undefined ? resolve() : secure.close(resolve)));
      await runtime?.stop();
      await new Promise((resolve) => close(resolve));
    })();
  };
  return server;
}
