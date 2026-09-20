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
import {dirname, join, relative, resolve} from "node:path";
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

// **What a rival needs decides how it can move, and they are not one group.**
// fable-osd's split, which is sharper than "needs the host":
//
//   fs     needs the FILE SYSTEM -- static content, a directory listing.
//          Moves as a node plus content in the object store; that is the
//          WAPA work, and it can travel to a system.
//   state  needs PROCESS STATE -- what the facade could not answer, the
//          dumps, the SQL log. It lives in memory and dies with the host, so
//          it moves as a node plus a LIVE host, and in the browser preview
//          it does not work **ever**, not "yet". A different promise.
//   pure   neither. Moves today.
//
// Counting them together would make "the host stops routing" look like one
// move. It is three, and one of them is a refusal.
// **What a rival needs is declared, not guessed.**
//
// The first two versions of this matched regexes against a window of source
// lines, and were wrong in both directions: `status\b` caught
// `res.status(500)` in an error branch, so three routes were filed as
// "needs process state" because of how they report a failure; and a
// twelve-line window picked up `express.static` from the *next* route. One
// of the mistakes made a published headline -- "0 of the 10 move today" --
// false, and the route it hid, POST /osd/status, is a thin wrapper over
// `zcl_osd_status.refresh( iv_json )` that is **already ABAP**.
//
// A measurement that decides what work exists should not be a guess about
// source text. So the verdict is written down with its reason, the way
// `.leak-allow.json` makes an exception cost a sentence, and the tool's job
// is to notice **drift**: a route nobody has judged is an error, not a
// default. Being wrong is then a thing somebody wrote and can be argued
// with, rather than an artefact of a regular expression.
//
//   fs     needs the file system. Moves as a node plus content in the
//          object store -- the WAPA work -- and can travel to a system.
//   state  needs process state. Moves as a node plus a LIVE host, and in
//          the browser preview does not work ever, not "yet".
//   pure   moves today.
export const VERDICTS = {
  "test/start.mjs /": {needs: "fs", why: "probes the tree for webapp/flp.html before redirecting"},
  "test/start.mjs /app": {needs: "fs", why: "express.static over webapp/"},
  "test/start.mjs /app/packs.json": {needs: "fs", why: "tilesOf() reads every pack's manifest from disk"},
  "test/start.mjs /app/${pack.name}": {needs: "fs", why: "express.static over each pack's folder"},
  "test/start.mjs /segw/generate/:project": {needs: "fs", why: "writes gen/segw-editor; dev-only, and belongs in a local package"},
  "test/start.mjs (no path: middleware)": {needs: "state", why: "app.use(facade.router): the ADT facade, 59 registrations of its own"},
  "test/start.mjs /osd/not-served": {needs: "state", why: "what the facade could not answer, held in memory"},
  "tools/osd-serve.mjs (no path: middleware)": {needs: "state", why: "the serving runtime's own middleware"},
  "tools/osd-serve.mjs /osd/serving": {needs: "state", why: "which generation this process is serving"},
  "tools/osd-serve.mjs /osd/dumps": {needs: "state", why: "the runtime errors this process has collected"},
  "tools/osd-serve.mjs /osd/sql": {needs: "state", why: "the statement log this process holds"},
  "tools/osd-serve.mjs /osd/status": {needs: "pure", why: "a wrapper over zcl_osd_status.refresh( iv_json ), which is already ABAP; only the error-path dump() is the host's, and a node loses nothing a 500 does not already give"},
};

export function needs(host, path) {
  return VERDICTS[`${host} ${path}`];
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
      const verdict = kind === "rival" ? needs(host, path) : undefined;
      out.push({host, line: i + 1, method: m[1], path, kind,
        needs: verdict?.needs, because: verdict?.why, judged: kind !== "rival" || verdict !== undefined});
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

/** Which rows of the scoreboard count against the proposal, and the total.
 *  Exported because the CLI and the test both need the answer and a copy in
 *  each is how they came to print 12 and 18 of the same tree -- the rule a
 *  module's callers must share lives in the module. */
export const isRival = (row) => row.name !== "ICF nodes" && row.name.includes("mount/wrapper") === false;
export const rivalCount = (board) => board.filter(isRival).reduce((n, r) => n + r.count, 0);

export async function scoreboard(options = {}) {
  const registries = [
    ["ICF nodes", icfNodes(options.root ?? "src"), "the one this tree is keeping"],
    ["host routes (rival)", hostRoutes(options.hosts).filter((r) => r.kind === "rival"), "a path answered outside the tree"],
    ["host routes (mount/wrapper)", hostRoutes(options.hosts).filter((r) => r.kind === "mount" || r.kind === "wrapper"), "the tree's own wiring and decoration -- NOT a rival"],
    ["pack mounts", packMounts(options.at ?? "."), "a pack's page under its name"],
    ["destination bindings", await destinationBindings(options), "a path another system answers"],
  ];
  return registries.map(([name, entries, why]) => ({name, count: entries.length, why, entries}));
}

if (runsAs("osd-routes.mjs")) {
  const list = process.argv.includes("--list");
  const board = await scoreboard();
  const others = rivalCount(board);
  for (const r of board) {
    console.log(`${String(r.count).padStart(4)}  ${r.name.padEnd(22)} ${r.why}`);
    if (list) {
      for (const e of r.entries) {
        const travel = e.travels === false ? "  [local package: does not travel]" : "";
        const need = e.needs ? `  [${e.needs}: ${e.because}]` : (e.judged === false ? "  [UNJUDGED -- add it to VERDICTS with a reason]" : "");
        console.log(`      ${e.url ?? e.path ?? ""}${e.host ? `  (${e.host}:${e.line})` : ""}${e.handlers?.length ? `  -> ${e.handlers.join(", ")}` : ""}${travel}${need}`);
      }
    }
  }
  const rivals = board.filter(isRival);
  console.log(`\n${rivals.length} registries rival the tree; ${others} paths live in them.`);
  const rivalRoutes = board.find((r) => r.name === "host routes (rival)")?.entries ?? [];
  const by = {pure: 0, fs: 0, state: 0};
  const unjudged = rivalRoutes.filter((r) => r.judged === false);
  for (const r of rivalRoutes.filter((r) => r.judged !== false)) by[r.needs] += 1;
  const plumbing = hostRoutes().filter((r) => r.kind === "plumbing").length;
  console.log(`Of the ${rivalRoutes.length} host rivals: ${by.pure} move today, ${by.fs} need content in the store (the WAPA work), ${by.state} need a live host and never work in the preview.`);
  console.log(`${plumbing} registrations are body parsing and answer no path.`);
  if (unjudged.length > 0) {
    console.log(`\n${unjudged.length} route(s) nobody has judged. A route with no verdict is not "pure":`);
    for (const r of unjudged) console.log(`  ${r.path}  (${r.host}:${r.line})`);
    console.log("Add each to VERDICTS in tools/osd-routes.mjs with a reason.");
  }
  console.log(`The mount/wrapper row is not one of them -- deleting it would unplug the tree, not move a path into it.`);
  console.log("A registry is not migrated until its code is deleted -- see docs/icf-as-the-registry.md.");
}
