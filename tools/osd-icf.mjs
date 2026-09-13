// SICF: the table that says which class answers which URL.
//
// OSD already runs one `if_http_extension` — the OData front — and the shim
// that runs it takes the class by name, so serving a second one was never a
// question of machinery. What was missing is the part a real system keeps in
// SICF: the mapping from a path to a handler.
//
// abapGit already serialises that mapping, so we do not invent a format.
// A `*.sicf.xml` carries the URL and the handler class, which is exactly the
// two things a mount needs:
//
//     <URL>/sap/bc/zo4d_demo/</URL>
//     <ICFHANDLER>ZCL_O4D_HTTP_HANDLER</ICFHANDLER>
//
// So a repository that brings its own service node brings its own route, and
// nothing here has to know the application exists. That is the same trick the
// SEGW registry plays with `*.iwsv.xml`, for the same reason: the object in
// the tree is the source of truth, and the registry is derived.
import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";

// where a service node can live: the same roots the store reads objects from
const ROOTS = ["src", "local", "test", "gen"];

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") {
      continue;
    }
    const path = join(dir, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(path, out);
    } else if (entry.endsWith(".sicf.xml") || entry.endsWith(".sapc.xml")) {
      out.push(path);
    }
  }
  return out;
}

const tag = (xml, name) => new RegExp(`<${name}>([^<]*)</${name}>`, "i").exec(xml)?.[1]?.trim();

// One service node, as the two things a route needs. A node with no handler
// is a real thing on a real system — an alias, or a node that only carries
// authentication for its children — and it is not something we can serve, so
// it comes back without one and the caller skips it rather than mounting a
// path that would answer with an error.
export function serviceOf(xml, source) {
  const url = tag(xml, "URL");
  if (url === undefined || url === "") {
    return undefined;
  }
  // ICFHANDLER is both the table row and the field inside it; the field is
  // the one that names a class, and it is the last of the two
  const handlers = [...xml.matchAll(/<ICFHANDLER>([A-Za-z0-9_\/]+)<\/ICFHANDLER>/gi)].map((m) => m[1]);
  const path = url.replace(/\/+$/, "");
  return {
    path,
    name: tag(xml, "ICF_NAME") ?? path.split("/").pop(),
    description: tag(xml, "ICF_DOCU"),
    handler: handlers[handlers.length - 1],
    source,
  };
}

// An APC application: the websocket half of the same idea.
//
// A push channel's path and class do not live in SICF — the SICF node beside
// it carries no handler at all, which is why reading only SICF finds the
// route and not the thing that answers on it. The APC application object is
// where the pair lives, and abapGit serialises it as `*.sapc.xml`:
//
//     <PATH>/sap/bc/apc/sap/zo4d_demo</PATH>
//     <CLASS_NAME>ZCL_O4D_APC_HANDLER</CLASS_NAME>
//     <STATEFUL>X</STATEFUL>
export function channelOf(xml, source) {
  const path = tag(xml, "PATH");
  const handler = tag(xml, "CLASS_NAME");
  if (path === undefined || path === "" || handler === undefined) {
    return undefined;
  }
  return {
    path: path.replace(/\/+$/, ""),
    name: tag(xml, "APPLICATION_ID") ?? path.split("/").pop(),
    description: tag(xml, "DESCRIPTION"),
    handler,
    stateful: tag(xml, "STATEFUL") === "X",
    websocket: true,
    source,
  };
}

function scan(root, options, suffix, parse) {
  const found = [];
  for (const dir of options.roots ?? ROOTS) {
    for (const file of walk(join(root, dir), [])) {
      if (file.endsWith(suffix) === false) {
        continue;
      }
      const one = parse(readFileSync(file, "utf8"), file);
      if (one !== undefined) {
        found.push(one);
      }
    }
  }
  return found;
}

// One route per path, longest first.
//
// Two nodes can name one path — the same repository imported twice, or a
// narrowed copy of it beside the whole thing, which is how this turned up:
// the same service mounted twice and which of the two answered was down to
// the order express happened to match in. A system has one node per path, so
// the first one found wins and the rest are dropped.
function routes(found) {
  const byPath = new Map();
  for (const one of found.sort((a, b) => b.path.length - a.path.length)) {
    if (byPath.has(one.path) === false) {
      byPath.set(one.path, one);
    }
  }
  return [...byPath.values()];
}

// the websocket applications a repository brought with it
export function channels(root = process.cwd(), options = {}) {
  return routes(scan(root, options, ".sapc.xml", channelOf));
}

export function services(root = process.cwd(), options = {}) {
  // a longer path first, so /sap/bc/a/b is not swallowed by /sap/bc/a
  return routes(scan(root, options, ".sicf.xml", serviceOf));
}

// Mount them on an express app. `run` is cl_express_icf_shim.run, passed in
// rather than imported, because this file is loaded by the façade process and
// the transpiled runtime belongs to whoever is serving.
export function mountServices(app, run, options = {}) {
  const mounted = [];
  for (const service of services(options.root ?? process.cwd(), options)) {
    if (service.handler === undefined) {
      continue;
    }
    // the OData front owns its own prefix and mounts itself; a service node
    // that claimed it would shadow the dispatcher
    if (options.reserved?.some((prefix) => service.path.startsWith(prefix)) === true) {
      continue;
    }
    const handler = async (req, res) => {
      try {
        await run({req, res, class: service.handler, base: service.path});
      } catch (e) {
        if (res.headersSent === false) {
          res.status(500).type("text/plain").send(`${service.handler}: ${String(e?.message?.get?.() ?? e?.message ?? e)}`);
        }
        console.error(`ICF ${service.path} (${service.handler}):`, e);
      }
    };
    app.all(service.path, handler);
    app.all(`${service.path}/*`, handler);
    mounted.push(service);
  }
  return mounted;
}

if (process.argv[1]?.endsWith("osd-icf.mjs")) {
  const root = process.argv[2] ?? process.cwd();
  const roots = process.argv[3] === undefined ? undefined : [process.argv[3]];
  const found = services(root, {roots});
  const pushed = channels(root, {roots});
  if (found.length + pushed.length === 0) {
    console.log("no *.sicf.xml or *.sapc.xml found");
  }
  for (const service of found) {
    console.log(`HTTP\t${service.path}\t${service.handler ?? "(no handler: not servable)"}\t${service.description ?? ""}`);
  }
  for (const channel of pushed) {
    console.log(`WS\t${channel.path}\t${channel.handler}\t${channel.description ?? ""}`);
  }
}
