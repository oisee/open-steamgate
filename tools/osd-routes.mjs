// Who answers a path in this system, counted across every registry that
// currently claims to know.
//
//   node tools/osd-routes.mjs            the scoreboard
//   node tools/osd-routes.mjs --list     every entry, by registry
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
import {join} from "node:path";
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

/** An ICF node: the one registry this tree is trying to keep. */
export function icfNodes(root = "src") {
  return walk(root).filter((f) => f.endsWith(".sicf.xml")).map((file) => {
    const xml = readFileSync(file, "utf8");
    return {
      file,
      url: /<URL>([^<]*)/.exec(xml)?.[1] ?? "",
      handlers: [...xml.matchAll(/<ICFHANDLER>([^<]*)/g)].map((m) => m[1]).filter(Boolean),
    };
  }).sort((a, b) => (a.url < b.url ? -1 : 1));
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
      out.push({host, line: i + 1, method: m[1], path: m[2] ? m[2].slice(1, -1) : "(no path: middleware)"});
    }
  }
  return out;
}

/** The pack mounting: a pack's page served under its name. */
export function packMounts(root = ".") {
  const packs = [];
  for (const dir of ["packs", ...(process.env.OSD_PACKS ?? "").split(":").filter(Boolean)]) {
    const at = join(root, dir);
    if (existsSync(at) === false) continue;
    for (const name of readdirSync(at)) {
      if (existsSync(join(at, name, "osd-pack.json")) && existsSync(join(at, name, "webapp"))) {
        packs.push({pack: name, path: `/app/${name}`});
      }
    }
  }
  return packs;
}

/** A binding: a path another system answers. */
export async function destinationBindings(options = {}) {
  const {remoteServices} = await import("./osd-destinations.mjs");
  return remoteServices({say: () => {}, ...options}).map((r) => ({path: `/sap/opu/odata/sap/${r.service}`, destination: r.name}));
}

export async function scoreboard(options = {}) {
  const registries = [
    ["ICF nodes", icfNodes(options.root ?? "src"), "the one this tree is keeping"],
    ["host routes", hostRoutes(options.hosts), "express registrations, across every host"],
    ["pack mounts", packMounts(options.at ?? "."), "a pack's page under its name"],
    ["destination bindings", await destinationBindings(options), "a path another system answers"],
  ];
  return registries.map(([name, entries, why]) => ({name, count: entries.length, why, entries}));
}

if (runsAs("osd-routes.mjs")) {
  const list = process.argv.includes("--list");
  const board = await scoreboard();
  const others = board.filter((r) => r.name !== "ICF nodes").reduce((n, r) => n + r.count, 0);
  for (const r of board) {
    console.log(`${String(r.count).padStart(4)}  ${r.name.padEnd(22)} ${r.why}`);
    if (list) {
      for (const e of r.entries) {
        console.log(`      ${e.url ?? e.path ?? ""}${e.host ? `  (${e.host}:${e.line})` : ""}${e.handlers?.length ? `  -> ${e.handlers.join(", ")}` : ""}`);
      }
    }
  }
  console.log(`\n${board.length} registries answer "who serves this path". One is the target;`);
  console.log(`${others} entries live in the other ${board.length - 1}.`);
  console.log("A registry is not migrated until its code is deleted -- see docs/icf-as-the-registry.md.");
}
