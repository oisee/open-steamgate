// Serve this tree's Fiori app against **another** Gateway.
//
//   node tools/osd-gateway-proxy.mjs --service ZOSD_006_DEMO_SRV [--port 3912]
//                                    [--app webapp] [--target .local/gateway-target.json]
//
// Why. The apps in `webapp/` have only ever talked to our own runtime, so
// "Fiori Elements works" has only ever been measured against the thing that
// was built to make it work. Pointing the same app, unchanged, at a real
// /IWFND on a real system is a different measurement, and it is the one that
// can fail.
//
// Two jobs and nothing else. The OData path is proxied to the target with
// basic auth (a browser cannot reach it directly: another origin, and a
// logon popup for every request). Everything else is served from the app
// folder, except `manifest.json`, whose `dataSources` uri is rewritten to
// this proxy's path -- so the app is served **as it is on disk** and the one
// line that names the service is the one line that changes.
//
// The target is never in this file: `.local/gateway-target.json`
// ({url, user, password, client}) or OSD_GW_URL / OSD_GW_USER /
// OSD_GW_PASSWORD / OSD_GW_CLIENT. `.local/` is gitignored, which is where a
// host name and a logon belong.
import {createServer} from "node:http";
import {existsSync, readFileSync} from "node:fs";
import {extname, join, normalize} from "node:path";
import {runsAs} from "./osd-main.mjs";

const TYPES = {
  ".html": "text/html", ".js": "application/javascript", ".json": "application/json",
  ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".properties": "text/plain",
  ".xml": "application/xml", ".ico": "image/x-icon",
};

export function targetOf(file = ".local/gateway-target.json") {
  const fromFile = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const t = {
    url: process.env.OSD_GW_URL ?? fromFile.url,
    user: process.env.OSD_GW_USER ?? fromFile.user,
    password: process.env.OSD_GW_PASSWORD ?? fromFile.password,
    client: process.env.OSD_GW_CLIENT ?? fromFile.client ?? "001",
  };
  for (const k of ["url", "user", "password"]) {
    if (t[k] === undefined || t[k] === "") {
      throw new Error(`no ${k} for the target gateway: put {url, user, password, client} in ${file} or set OSD_GW_${k.toUpperCase()}`);
    }
  }
  return t;
}

/** The app as it is on disk, with the one line that names the service
 *  changed. Rewriting the file rather than editing it keeps the tree honest:
 *  nothing here is committed pointing at somebody's system. */
export function manifestFor(text, service) {
  const m = JSON.parse(text);
  for (const ds of Object.values(m["sap.app"]?.dataSources ?? {})) {
    if (ds.type === "OData") {
      ds.uri = `/sap/opu/odata/sap/${service}/`;
    }
  }
  return JSON.stringify(m, undefined, 2);
}

export function serve({service, app = "webapp", port = 3912, target = targetOf()}) {
  const prefix = `/sap/opu/odata/sap/${service}`;
  const auth = "Basic " + Buffer.from(`${target.user}:${target.password}`).toString("base64");
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith(prefix)) {
        url.searchParams.set("sap-client", target.client);
        const to = new URL(target.url + url.pathname + (url.search || "?" + url.searchParams));
        const body = req.method === "GET" || req.method === "HEAD" ? undefined
          : await new Promise((ok) => { const c = []; req.on("data", (b) => c.push(b)); req.on("end", () => ok(Buffer.concat(c))); });
        const answer = await fetch(to, {
          method: req.method,
          headers: {authorization: auth, accept: req.headers.accept ?? "*/*", "content-type": req.headers["content-type"] ?? "application/json"},
          body,
        });
        const bytes = Buffer.from(await answer.arrayBuffer());
        res.writeHead(answer.status, {
          "content-type": answer.headers.get("content-type") ?? "application/xml",
          "access-control-allow-origin": "*",
        });
        res.end(bytes);
        console.log(`${answer.status} ${req.method} ${url.pathname}${url.search}`);
        return;
      }
      const name = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = join(app, normalize(name).replace(/^(\.\.[/\\])+/, ""));
      if (existsSync(file) === false) {
        res.writeHead(404).end("not here");
        return;
      }
      if (name.endsWith("/manifest.json")) {
        res.writeHead(200, {"content-type": "application/json"}).end(manifestFor(readFileSync(file, "utf8"), service));
        return;
      }
      res.writeHead(200, {"content-type": TYPES[extname(file)] ?? "application/octet-stream"}).end(readFileSync(file));
    } catch (error) {
      console.error(error?.message ?? error);
      res.writeHead(502).end(String(error?.message ?? error));
    }
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

if (runsAs("osd-gateway-proxy.mjs")) {
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
  const service = flag("service");
  if (service === undefined) {
    console.error("usage: osd-gateway-proxy.mjs --service ZOSD_006_DEMO_SRV [--port 3912] [--app webapp]");
    process.exit(2);
  }
  const port = Number(flag("port", 3912));
  const app = flag("app", "webapp");
  await serve({service, app, port, target: targetOf(flag("target", ".local/gateway-target.json"))});
  console.log(`${app} on http://0.0.0.0:${port}/  ->  ${service} on the target gateway`);
}
