// Every node this system answers on, from whichever registry declares it.
//
//   node tools/osd-nodes.mjs            the inventory
//   node tools/osd-nodes.mjs --json     the same, for a caller
//
// **The type of a node is where it is declared, not a field somebody set.**
// That is the conclusion of the whole ICF track and it took three of Alice's
// corrections to reach (`docs/icf-registry-plan.md`):
//
//   1. ICF is the only *registry*, not the only *router*.
//   2. Imitate the interface, not the storage.
//   3. What the host serves can stay served by the host -- it only has to be
//      *declared*.
//
// A `*.sicf.xml` is a SAP object: it exists on a system, it transports, and
// the class it names runs anywhere the ABAP runs. A path answered by a
// JavaScript function is none of those, and writing a SICF object for it
// would be a lie in somebody else's format -- an object claiming to travel
// to a system where it does not exist. So those are declared in
// `<layer>/icf/nodes.json` instead, and "does it travel" follows from the
// file rather than from a flag that has to be kept true.
//
// The types, each saying **where the node works** rather than whether it is
// allowed:
//
//   ABAP     a class implementing if_http_extension. Server, binary, preview.
//   HOST     a function of the JavaScript host. Server and binary; not the
//            preview.
//   PROXY    a destination: another system answers. Server and binary only.
//   CONTENT  bytes out of the object store. Everywhere. (Not yet used: the
//            BSP pages are ABAP today and become CONTENT in step A.)
import {existsSync, readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {channels, services} from "./osd-icf.mjs";
import {inputFoldersOf} from "./osd-packs.mjs";
import {runsAs} from "./osd-main.mjs";

// Where a node works. A promise, so that "not yet" and "never" stay
// different words -- the browser preview has no file system, no process to
// hold state and no second system to ask.
export const WORKS_IN = {
  ABAP: ["server", "binary", "preview"],
  // A node with no handler at all is a real object on a real system -- an
  // alias, or a node that only carries authentication for its children, and
  // a UI5 application's node inherits its handler from the branch above it
  // (measured on A4H, 2026-09-19). It belongs in the inventory because it
  // EXISTS; nothing answers on it here, and an empty list says that without
  // a second word for it.
  NODE: [],
  CONTENT: ["server", "binary", "preview"],
  HOST: ["server", "binary"],
  PROXY: ["server", "binary"],
};

const DECLARED = join("icf", "nodes.json");

function layers(root) {
  const file = join(root, "abap_transpile.json");
  const config = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {input_folder: ["src", "local", "test", "gen"]};
  return [...new Set([...inputFoldersOf(root, config), "gen"])];
}

/** The nodes a layer declares for itself: the ones that are not SAP objects.
 *
 *  Keys beginning with `_` are the file's own prose. A format that cannot
 *  carry a comment gets one anyway, and a reader that chokes on it would
 *  make the explanation cost a second file. */
export function declaredNodes(root = ".") {
  const found = [];
  for (const dir of layers(root)) {
    const file = join(root, dir, DECLARED);
    if (existsSync(file) === false) continue;
    const decl = JSON.parse(readFileSync(file, "utf8"));
    for (const [path, d] of Object.entries(decl)) {
      if (path.startsWith("_")) continue;
      found.push({
        path: path.replace(/\/+$/, "") || "/",
        type: d.type ?? "HOST",
        handler: d.handler,
        implementedIn: d.host,
        needs: d.needs,
        text: d.text,
        travels: false,
        source: file,
      });
    }
  }
  return found;
}

/** A pack's page under its own name: a HOST node nobody wrote down.
 *
 *  Derived rather than declared for the reason `packApps` in
 *  osd-bsp-registry.mjs is: a pack already says its name and already carries
 *  a webapp/, and asking it to repeat that in a second file is the extra
 *  registry this whole track is removing. */
export function packNodes(root = ".") {
  const found = [];
  for (const dir of ["packs", ...(process.env.OSD_PACKS ?? "").split(":").filter(Boolean)]) {
    const at = join(root, dir);
    if (existsSync(at) === false) continue;
    for (const name of readdirSync(at)) {
      if (existsSync(join(at, name, "osd-pack.json")) && existsSync(join(at, name, "webapp"))) {
        found.push({
          path: `/app/${name}`,
          type: "HOST",
          handler: "pack-static",
          implementedIn: "test/start.mjs",
          needs: "fs",
          text: `express.static over the pack ${name}'s webapp/`,
          travels: false,
          source: join(at, name, "osd-pack.json"),
        });
      }
    }
  }
  return found;
}

/** A binding: a service this registry lacks, answered by another system.
 *
 *  Never written in nodes.json -- it is derived from
 *  `.local/destinations.json`, which is gitignored, because a list of the
 *  systems we can reach is not something a public repository carries. */
export async function proxyNodes(options = {}) {
  let remoteServices;
  try {
    ({remoteServices} = await import("./osd-destinations.mjs"));
  } catch {
    return [];
  }
  return remoteServices({say: () => {}, ...options}).map((r) => ({
    path: `/sap/opu/odata/sap/${r.service}`,
    type: "PROXY",
    handler: r.name,
    implementedIn: "tools/osd-remote-service.mjs",
    needs: "state",
    text: `answered by the destination ${r.name}`,
    travels: false,
    source: ".local/destinations.json",
  }));
}

/** Everything, from every registry that declares a node. */
export async function nodes(root = ".", options = {}) {
  const sap = [
    ...services(root, options).map((s) => ({...s, implementedIn: s.source, text: s.description})),
    ...channels(root, options).map((c) => ({...c, type: "ABAP", travels: true, implementedIn: c.source, text: c.description})),
  ];
  const all = [...sap, ...declaredNodes(root), ...packNodes(root), ...(options.proxies === false ? [] : await proxyNodes(options))];
  return all.map((n) => ({...n, type: n.type ?? "NODE", worksIn: WORKS_IN[n.type ?? "NODE"] ?? []}))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

if (runsAs("osd-nodes.mjs")) {
  const all = await nodes(process.argv[2] ?? ".");
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(all, undefined, 2));
  } else {
    const by = {};
    for (const n of all) {
      by[n.type] = (by[n.type] ?? 0) + 1;
      const where = n.worksIn.length === 3 ? ""
        : n.worksIn.length === 0 ? "  [no handler: nothing answers here]"
        : `  [not in the ${["server", "binary", "preview"].filter((w) => n.worksIn.includes(w) === false).join("/")}]`;
      console.log(`${(n.type ?? "NODE").padEnd(8)} ${n.path.padEnd(42)} ${(n.handler ?? "-").padEnd(24)}${where}`);
      if (n.text) console.log(`         ${n.text}`);
    }
    console.log(`\n${all.length} nodes: ${Object.entries(by).map(([t, n]) => `${n} ${t}`).join(", ")}.`);
    console.log(`${all.filter((n) => n.travels).length} travel to a system; the rest are this host's own and say so by where they are declared.`);
  }
}
