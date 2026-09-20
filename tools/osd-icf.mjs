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
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {inputFoldersOf} from "./osd-packs.mjs";
import {basename,join} from "node:path";

// Where a service node can live: the layers, which is what the store reads
// and what the transpiler is handed (tools/osd-packs.mjs, backlog E.1/E.2).
// It used to be a list of its own, ["src", "local", "test", "gen"], and a
// pack that brought a *.sicf.xml was then invisible while its class was not.
function ROOTS(root) {
  const file = join(root, "abap_transpile.json");
  const config = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {input_folder: ["src", "local", "test", "gen"]};
  return [...new Set([...inputFoldersOf(root, config), "gen"])];
}

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
// **The handler rows, each with the type SAP already keeps beside it.**
//
// `ICFHANDLER` is the name of the table row AND of the field inside it, so
// the table cannot be read with one regular expression: a match for the
// field also matches the row, and a reader that takes the first gets
// whitespace, one that takes the last gets the right answer for one row and
// silently drops the others. Both mistakes have been made here. A scan that
// counts the nesting is what tells a row from its own field, and it is ten
// lines.
//
// `ICFTYP` was serialised in every one of our nodes from the day they were
// written and read by nothing. It is the handler's **kind** -- what the name
// in `ICFHANDLER` refers to -- and `A`, the only value this tree has ever
// produced or imported, is an ABAP class. We do not invent values for it:
// a row whose type we do not implement comes back with its letter and is
// not mounted, which is the difference between "we cannot serve this" and
// "we served it as something it is not".
export function handlerRows(xml) {
  const table = /<ICFHANDLER_TABLE>([\s\S]*?)<\/ICFHANDLER_TABLE>/i.exec(xml)?.[1] ?? xml;
  const rows = [];
  const re = /<(\/?)ICFHANDLER>/gi;
  let depth = 0;
  let start = 0;
  let m;
  while ((m = re.exec(table)) !== null) {
    if (m[1] === "") {
      if (depth++ === 0) {
        start = re.lastIndex;
      }
    } else if (--depth === 0) {
      rows.push(table.slice(start, m.index));
    }
  }
  return rows.map((row) => ({
    order: tag(row, "ICFORDER"),
    // absent in a hand-written fixture and in some abapGit versions; the
    // only thing a *.sicf.xml can name is a class, so that is the reading,
    // and `icftyp` stays undefined so nobody can claim it was measured
    icftyp: tag(row, "ICFTYP")?.toUpperCase(),
    handler: /<ICFHANDLER>([A-Za-z0-9_/]+)<\/ICFHANDLER>/i.exec(row)?.[1],
  })).filter((r) => r.handler !== undefined && r.handler !== "");
}

// What an `ICFTYP` letter means here. One entry, because one letter is all
// this tree has seen -- and a map with one entry is honest where a default
// would not be.
const ICFTYP = {A: "ABAP"};

export function serviceOf(xml, source) {
  const url = tag(xml, "URL");
  if (url === undefined || url === "") {
    return undefined;
  }
  const rows = handlerRows(xml);
  // the last handler of the chain is the one that answers; the earlier rows
  // of a real node are the inherited ones
  const row = rows[rows.length - 1];
  const path = url.replace(/\/+$/, "");
  return {
    path,
    name: tag(xml, "ICF_NAME") ?? path.split("/").pop(),
    description: tag(xml, "ICF_DOCU"),
    handler: row?.handler,
    icftyp: row?.icftyp,
    // **A node declared as a SAP object is served by ABAP, and that is not a
    // flag we set: it follows from the file it is declared in.** A path this
    // system answers from JavaScript cannot be a *.sicf.xml, because on a
    // real system that object does not exist and writing one would claim it
    // travels. Those are declared in src/icf/nodes.json instead --
    // tools/osd-nodes.mjs is the reader that sees both.
    type: row === undefined ? undefined : (ICFTYP[row.icftyp ?? "A"] ?? row.icftyp),
    travels: true,
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
  for (const dir of options.roots ?? ROOTS(root)) {
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
    // A handler row whose type we do not implement is not an ABAP class,
    // and running it as one would be a guess with a 500 at the end of it.
    // Nothing in this tree produces such a row today; the check exists so
    // that an imported node carrying one is refused out loud.
    if (service.type !== "ABAP") {
      options.say?.(`ICF ${service.path}: handler type ${service.icftyp} is not one this host serves -- not mounted`);
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
        // the host that mounted us keeps the dumps and knows the ABAP
        // position; without one, the generated stack is what there is
        if (options.onError !== undefined) {
          options.onError(service, e, req);
        } else {
          console.error(`ICF ${service.path} (${service.handler}):`, e);
        }
      }
    };
    app.all(service.path, handler);
    app.all(`${service.path}/*`, handler);
    mounted.push(service);
  }
  return mounted;
}

if (basename(process.argv[1] ?? "") === "osd-icf.mjs") {
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
