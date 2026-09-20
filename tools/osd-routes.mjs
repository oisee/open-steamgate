// Who answers a path in this system, counted across every registry that
// currently claims to know.
//
//   node tools/osd-routes.mjs            the inventory and the drift
//   node tools/osd-routes.mjs --list     every node, with its type
//
// **This is a scoreboard for a migration, and it exists because a registry
// cannot be deleted until it can be enumerated.** Two sessions independently
// counted the registries on 2026-09-19 and both got four where there should
// be one (`docs/icf-as-the-registry.md`, and the note under it). The
// proposal is that ICF is the only router; the falsification is not "can one
// path move" -- a registry with one entry migrated still exists and still has
// code -- it is **can the registry's code be deleted**. So the number this
// prints has to go down, and when a registry reaches zero its mounting code
// is removed in the same commit. A count that stays at four while paths move
// means the note was wrong in the way that matters.
//
// It reads sources rather than a running system on purpose: the point is to
// see the registries a reader of this repository would have to know about,
// and a running host has already collapsed them into one table.
import {existsSync, readFileSync, readdirSync, statSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";
import {nodes} from "./osd-nodes.mjs";
import {runsAs} from "./osd-main.mjs";

const HOSTS = ["test/start.mjs", "tools/osd-serve.mjs", "web/preview-backend.mjs"];

function walk(dir, hit = []) {
  if (existsSync(dir) === false) return hit;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, hit);
    else hit.push(full);
  }
  return hit;
}

/** The package an object belongs to: the nearest `package.devc.xml` above
 *  it, which is how abapGit decides it too.
 *
 *  **And with it, whether the object can travel -- using the system's own
 *  rule rather than a flag of ours.** A package whose name begins with `$`
 *  is local and does not transport; everything else does. fable-osd's
 *  requirement was that a node must carry whether it can leave, "in the
 *  object rather than in somebody's memory" -- and it already does, as soon
 *  as we stop inventing a field and use the thing SAP has had all along.
 *
 *  That matters for the two host routes nobody should ever deploy:
 *  `POST /segw/generate/:project` writes to a developer's file system and
 *  `GET /osd/not-served` reports what the facade could not answer. When they
 *  become nodes they go in a local package, and then "does not travel" is a
 *  property a system would agree with rather than a convention of ours. */
export function packageOf(file, root = ".") {
  let at = resolve(dirname(file));
  const stop = resolve(root);
  while (at.startsWith(stop)) {
    const devc = join(at, "package.devc.xml");
    if (existsSync(devc)) {
      const xml = readFileSync(devc, "utf8");
      const name = /<DEVCLASS>([^<]*)/.exec(xml)?.[1] ?? relative(stop, at).replaceAll("/", "_").toUpperCase();
      return {name, file: devc, travels: name.startsWith("$") === false};
    }
    const up = dirname(at);
    if (up === at) break;
    at = up;
  }
  // no package above it: it belongs to whatever the import names, so it
  // travels -- and saying "unknown" would be a third value nobody asked for
  return {name: "", file: "", travels: true};
}

/** An ICF node: the one registry this tree is trying to keep. */
export function icfNodes(root = "src") {
  return walk(root).filter((f) => f.endsWith(".sicf.xml")).map((file) => {
    const xml = readFileSync(file, "utf8");
    const pkg = packageOf(file, root);
    return {
      file,
      url: /<URL>([^<]*)/.exec(xml)?.[1] ?? "",
      // `<ICFHANDLER>` is the name of the row wrapper AND of the field
      // inside it, so a naive match returns the wrapper's whitespace beside
      // the class name -- a true value answering a question nobody asked.
      // Take the ones that look like a class.
      handlers: [...xml.matchAll(/<ICFHANDLER>([^<\s][^<]*)</g)].map((m) => m[1].trim()).filter(Boolean),
      package: pkg.name,
      travels: pkg.travels,
    };
  }).sort((a, b) => (a.url < b.url ? -1 : 1));
}

// **Not every express registration is a rival registry, and counting them
// as one overstates the case.** Looking at the twenty-one, three kinds:
//
//   mount    it IS the ICF wiring -- `app.all("/sap/opu/odata/sap/*", ...)`
//            hands the path to the dispatcher. Deleting it would not move a
//            path into the tree, it would unplug the tree.
//   wrapper  middleware on a path that is ALREADY a node -- `withFreshStatus`
//            in front of the webgui. It decorates; it does not decide.
//   rival    a path answered outside the tree entirely: static content, the
//            dev-only writes, the facade's own router.
//
// Only the last kind is the thing the proposal is about. The first version of
// this tool counted all three and printed 21, which is a true number
// answering a question nobody asked -- the same shape we have caught four
// times today, and this time in my own instrument.
const ICF_PATHS = [/^\/sap\/opu\/odata/, /^\/sap\/bc\/gui/, /^\/sap\/bc\/adt/, /^\/sap\/bc\/osd/];
const MOUNTS = [/odataProxy|mountServices|inline\.cl_express_icf_shim|icf\b/];

// **Every registration must be explained by a declared node, and that is the
// only number left that can go red.**
//
// This table used to be VERDICTS: a judgement per express route about how
// hard it would be to migrate. Alice's third correction retired the
// question. What the host serves can stay served by the host -- it only has
// to be *declared* -- so the interesting fact about `/osd/dumps` is not
// "state, therefore hard", it is that `src/icf/nodes.json` says it exists,
// who implements it and where it works. `tools/osd-nodes.mjs` is that
// inventory.
//
// What remains for this file is **drift**, in both directions, the way
// `npm run parked` complains about a branch nothing explains and an entry
// naming a branch that is gone:
//
//   - an express registration that maps to no declared node -- something
//     answers a path and the inventory does not know;
//   - a declared node that no registration claims -- the inventory names
//     something nothing serves.
//
// The mapping is written rather than guessed, because two of these routes
// have no literal path at all (`app.use(facade.router)` is 59 registrations
// of the ADT facade) and a regex over source text got this wrong in both
// directions twice in one night.
export const SERVED_BY = {
  "test/start.mjs /": {node: "/"},
  "test/start.mjs /app": {node: "/app"},
  "test/start.mjs /app/packs.json": {node: "/app/packs.json"},
  "test/start.mjs /app/${pack.name}": {node: "/app/*", why: "one registration per pack; the nodes are derived from the packs"},
  "test/start.mjs /segw/generate/:project": {node: "/segw/generate"},
  "test/start.mjs (no path: middleware)": {node: "/sap/bc/adt"},
  "test/start.mjs /osd/not-served": {node: "/osd/not-served"},
  "tools/osd-serve.mjs (no path: middleware)": {wrapper: "sets X-OSD-Generation on every answer: it decorates, it does not decide"},
  "tools/osd-serve.mjs /osd/serving": {node: "/osd/serving"},
  "tools/osd-serve.mjs /osd/dumps": {node: "/osd/dumps"},
  "tools/osd-serve.mjs /osd/sql": {node: "/osd/sql"},
};

export function servedBy(host, path) {
  return SERVED_BY[`${host} ${path}`];
}

export function classify(line, path) {
  // **A registration with no literal path is not nothing.** This used to
  // return "plumbing" and no row counted it, so `app.use(facade.router)` --
  // the ADT facade, 59 router registrations of its own -- vanished from a
  // scoreboard whose whole purpose is that nothing answers a path
  // unaccounted for. It is a rival, and the biggest one.
  if (path === "(no path: middleware)") {
    return /express\.(raw|json|urlencoded|text)\s*\(/.test(line) ? "plumbing" : "rival";
  }
  if (MOUNTS.some((r) => r.test(line))) {
    return "mount";
  }
  if (ICF_PATHS.some((r) => r.test(path))) {
    return "wrapper";
  }
  return "rival";
}

/** Every express registration in every host. The same path registered in two
 *  hosts counts twice on purpose: that IS the defect -- three hosts cannot
 *  agree by construction, and we have paid for it. */
export function hostRoutes(hosts = HOSTS) {
  const out = [];
  for (const host of hosts) {
    if (existsSync(host) === false) continue;
    const text = readFileSync(host, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      const m = /app\.(all|use|get|post|put|delete)\(\s*(`[^`]*`|"[^"]*"|'[^']*')?/.exec(line);
      if (m === null) continue;
      const path = m[2] ? m[2].slice(1, -1) : "(no path: middleware)";
      // the handler body is the next few lines: what a route touches is not
      // on the line that registers it
      const body = text.split("\n").slice(i, i + 12).join("\n");
      const kind = classify(line, path);
      void body;
      // A registration is explained by the node it serves, by being the
      // tree's own wiring, or by nothing -- and the last is the defect.
      const said = kind === "rival" ? servedBy(host, path) : undefined;
      out.push({host, line: i + 1, method: m[1], path, kind,
        node: said?.node, wrapper: said?.wrapper, why: said?.why,
        declared: kind !== "rival" || said !== undefined});
    }
  }
  return out;
}

// **`packMounts` and `destinationBindings` used to live here and are gone.**
// They read a pack's folder and a destination file to derive a path, which
// is exactly what `packNodes` and `proxyNodes` in tools/osd-nodes.mjs do --
// two copies of one derivation, in the file whose whole subject is that
// there should be one. The scoreboard asks the inventory now.

/** The nodes an express registration may legitimately claim.
 *
 *  `/app/*` is a shape rather than a path: one `app.get` inside a loop
 *  registers one route per pack, and the nodes for those are derived from
 *  the packs themselves (`packNodes`). Writing the shape down is how a
 *  registration that claims a pack node it does not serve still counts as
 *  explained, without the table having to list every pack twice. */
const claims = (node, paths) => node === "/app/*"
  ? paths.some((p) => p.startsWith("/app/"))
  : paths.includes(node);

/** Drift, in both directions.
 *
 *  `unexplained`  an express registration mapped to no node: something
 *                 answers a path and the inventory does not know. This is
 *                 the number that must be zero, and the one a new express
 *                 route makes go red.
 *  `unclaimed`    a HOST or PROXY node no registration serves: the inventory
 *                 names something nothing answers. An ABAP node is not in
 *                 this list -- it is served by the shim from the object
 *                 itself and has no express line to find.
 */
export async function drift(options = {}) {
  const all = await nodes(options.at ?? ".", options);
  const paths = all.map((n) => n.path);
  const routes = hostRoutes(options.hosts).filter((r) => r.kind === "rival");
  const unexplained = routes.filter((r) => r.declared === false
    || (r.node !== undefined && claims(r.node, paths) === false));
  const served = new Set(routes.map((r) => r.node).filter(Boolean));
  const unclaimed = all.filter((n) => (n.type === "HOST" || n.type === "PROXY")
    && served.has(n.path) === false
    && (n.path.startsWith("/app/") === false || served.has("/app/*") === false)
    && n.type !== "PROXY");
  return {nodes: all, routes, unexplained, unclaimed};
}

export async function scoreboard(options = {}) {
  const {nodes: all, unexplained, unclaimed} = await drift(options);
  const wiring = hostRoutes(options.hosts).filter((r) => r.kind === "mount" || r.kind === "wrapper");
  const by = {};
  for (const n of all) by[n.type] = (by[n.type] ?? 0) + 1;
  return {nodes: all, byType: by, wiring, unexplained, unclaimed};
}

if (runsAs("osd-routes.mjs")) {
  const list = process.argv.includes("--list");
  const board = await scoreboard();
  if (list) {
    for (const n of board.nodes) {
      const where = n.worksIn.length === 0 ? "  [no handler: nothing answers here]"
        : n.worksIn.length === 3 ? ""
        : `  [not in the ${["server", "binary", "preview"].filter((w) => n.worksIn.includes(w) === false).join("/")}]`;
      console.log(`  ${n.type.padEnd(8)} ${n.path.padEnd(42)} ${(n.handler ?? "-").padEnd(24)}${where}`);
    }
    console.log("");
  }
  console.log(`${String(board.nodes.length).padStart(4)}  nodes, from every registry that declares one:`);
  for (const [type, n] of Object.entries(board.byType).sort()) {
    console.log(`      ${String(n).padStart(3)} ${type}`);
  }
  console.log(`${String(board.wiring.length).padStart(4)}  express registrations are the tree's own wiring and decoration -- not routes of their own`);

  // **The thing that can go red.** The old ratchet counted rivals and went
  // down by migrating; this one counts what nothing explains and goes up the
  // moment somebody adds an express route without declaring it.
  console.log(`${String(board.unexplained.length).padStart(4)}  express registrations nobody declared`);
  for (const r of board.unexplained) {
    console.log(`      ${r.path}  (${r.host}:${r.line})  -- add it to src/icf/nodes.json and to SERVED_BY`);
  }
  console.log(`${String(board.unclaimed.length).padStart(4)}  declared HOST nodes no registration serves`);
  for (const n of board.unclaimed) {
    console.log(`      ${n.path}  (${n.source})  -- the inventory names it and nothing answers on it`);
  }

  const movable = board.nodes.filter((n) => n.type === "HOST" && n.needs === "fs");
  const staying = board.nodes.filter((n) => n.type === "HOST" && n.needs === "state");
  console.log(`
Of the HOST nodes: ${movable.length} need only the file system and can become CONTENT in the store (the WAPA work); ${staying.length} need process state and stay HOST by design.`);
  console.log("A node's type is where it is declared -- src/icf/nodes.json, not a field inside somebody else's format.");
  console.log("See docs/icf-registry-plan.md; the inventory itself is `node tools/osd-nodes.mjs`.");
}
