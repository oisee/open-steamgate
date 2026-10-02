#!/usr/bin/env node
// ABAP-FS conformance, protocol layer: drive the ADT façade with the client
// library ABAP-FS itself ships (abap-adt-api, MIT, Marcello Urbani), call by
// call the way the extension does, and report a feature matrix of what works,
// what fails and what is missing. On demand, not part of `npm test`; the UI
// layer (real VS Code under Xvfb) is planned in docs/abapfs-conformance.md.
//
//   npm run conformance:abapfs -- [--url http://localhost:3030]
//   npm run conformance:abapfs -- --start [--port 3393]
//
// The dependency is never in the root package.json. tools/abapfs-conformance/
// holds a package.json + package-lock.json pinned to the closure of ABAP-FS
// 2.10.3's pnpm-lock.yaml (42 packages, every integrity equal); `npm ci` puts
// it into .local/conformance/abapfs/deps on first use.
import {spawn, spawnSync} from "node:child_process";
import {closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readlinkSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PIN = {
  name: "abap-adt-api",
  version: "8.4.3",
  // ABAP-FS 2.10.3 pnpm-lock.yaml, `abap-adt-api@8.4.3: resolution`
  integrity: "sha512-/DXovX+xjqycHyrcSEQnbuDQqlmegdIDfJpfL38i5vYRfjiBoEHzxfKOzB3/gvYxbuAfxKzytwLdSQG2leh8sA==",
  license: "MIT",
  client: "murbani.vscode-abap-remote-fs 2.10.3"
};
export const STATUSES = ["PASS", "FAIL", "MISSING"];
const DEPS_SPEC = join(ROOT, "tools", "abapfs-conformance");
const OUT_DEFAULT = join(ROOT, ".local", "conformance", "abapfs");
const EXPECTED_DEFAULT = join(ROOT, "test", "fixtures", "abapfs-conformance", "expected.json");

// The fixture package $ZOSD_TEST exists for exactly this: one object of each
// kind, a test class with one pass and one deliberate failure.
const PKG = "$ZOSD_TEST";
const OBJ = {
  CLAS: "/sap/bc/adt/oo/classes/zcl_zosd_test_demo",
  INTF: "/sap/bc/adt/oo/interfaces/zif_zosd_test_greeter",
  PROG: "/sap/bc/adt/programs/programs/zosd_test_demo_prog",
  INCL: "/sap/bc/adt/programs/includes/zosd_test_demo_inc",
  FUGR: "/sap/bc/adt/functions/groups/zosd_test_fg",
  FM: "/sap/bc/adt/functions/groups/zosd_test_fg/fmodules/z_osd_test_status_text",
  DDLS: "/sap/bc/adt/ddic/ddl/sources/zosd_test_i_item",
  MSAG: "/sap/bc/adt/messageclass/zosd_test_msg",
  TABL: "/sap/bc/adt/ddic/tables/zosd_test_item"
};
const USER = "DEVELOPER";

export function parseArgs(argv) {
  const opts = {url: undefined, start: false, port: 3393, only: [], out: OUT_DEFAULT,
    expected: EXPECTED_DEFAULT, updateExpected: false, help: false};
  const value = (i, flag) => {
    if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") opts.url = value(i++, a);
    else if (a === "--start") opts.start = true;
    else if (a === "--port") {
      opts.port = Number(value(i++, a));
      if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) throw new Error(`--port: not a port: ${argv[i]}`);
    } else if (a === "--only") opts.only = value(i++, a).split(",").map(s => s.trim()).filter(Boolean);
    else if (a === "--out") opts.out = resolve(value(i++, a));
    else if (a === "--expected") opts.expected = resolve(value(i++, a));
    else if (a === "--update-expected") opts.updateExpected = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (opts.start && opts.url) throw new Error("--start and --url exclude each other");
  if (!opts.start) opts.url ??= "http://localhost:3030";
  else opts.url = `http://localhost:${opts.port}`;
  opts.url = opts.url.replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+$/.test(opts.url)) throw new Error(`--url: want scheme://host[:port], got ${opts.url}`);
  const groups = new Set(SCENARIOS.map(s => s.group));
  for (const g of opts.only) if (!groups.has(g)) throw new Error(`--only: unknown group ${g} (have ${[...groups].join(", ")})`);
  return opts;
}

const HELP = `usage: npm run conformance:abapfs -- [--url URL | --start [--port N]]
       [--only group,group] [--out DIR] [--expected FILE] [--update-expected]

Runs ABAP-FS's own ADT client (${PIN.name} ${PIN.version}) against an OSG ADT façade.
  --url URL           a running OSG (default http://localhost:3030)
  --start             start one from this checkout (test/run.mjs, STG_PORT) and stop it after
  --port N            port for --start (default 3393)
  --only g1,g2        run only these groups
  --out DIR           report folder (default .local/conformance/abapfs)
  --expected FILE     expectations to compare against (default test/fixtures/abapfs-conformance/expected.json)
  --update-expected   write this run's statuses into the expectations file
Exit 1 on a regression (a PASS lost, or a MISSING now FAIL), 2 if a restore failed or anything was left behind.`;

class Check extends Error {}
const check = (cond, message) => { if (!cond) throw new Check(message); };

function readSource(ADTClient, c, struct) {
  return c.getObjectSource(ADTClient.mainInclude(struct));
}

/** Scenario table. impact: how much an ABAP-FS user loses when it is not
 *  PASS (5 = cannot work, 1 = cosmetic). `feature` is the user's word. */
export const SCENARIOS = [
  // connect
  {id: "connect.login", group: "connect", impact: 5, feature: "Connect (login, CSRF token)",
    run: async ({c}) => { await c.login(); check(c.csrfToken && c.csrfToken !== "fetch", "no CSRF token"); return `token ${c.csrfToken.length} chars`; }},
  {id: "connect.statelessClone", group: "connect", impact: 5, feature: "Second (stateless) session for reads",
    run: async ({c}) => { await c.statelessClone.login(); check(c.statelessClone.loggedin, "clone not logged in"); }},
  {id: "connect.discovery", group: "connect", impact: 4, feature: "Discovery (feature gates)",
    run: async ({c}) => {
      const ws = await c.adtDiscovery(); check(ws.length > 0, "no workspaces");
      const cts = await c.featureDetails("Change and Transport System");
      const git = await c.featureDetails("abapGit Repositories");
      return `${ws.length} workspaces; CTS gate ${cts ? "on" : "off"}, abapGit gate ${git ? "on" : "off"}`;
    }},
  // tree
  {id: "tree.tmp", group: "tree", impact: 5, feature: "Browse $TMP",
    run: async ({r}) => { const n = await r.nodeContents("DEVC/K", "$TMP"); check(n.nodes.length > 0, "$TMP empty"); return `${n.nodes.length} nodes`; }},
  {id: "tree.package", group: "tree", impact: 5, feature: `Browse a package (${PKG})`,
    run: async ({r}) => {
      const n = await r.nodeContents("DEVC/K", PKG); check(n.nodes.length > 0, `${PKG} empty`);
      return `${n.nodes.length} nodes, ${n.objectTypes.length} types`;
    }},
  {id: "tree.systemLibrary", group: "tree", impact: 3, feature: "Browse System Library (root)",
    run: async ({r}) => { const n = await r.nodeContents("DEVC/K", ""); check(n.nodes.length > 0, "root empty"); return `${n.nodes.length} nodes`; }},
  {id: "tree.nodepath", group: "tree", impact: 3, feature: "Reveal object in tree (nodepath)",
    run: async ({r}) => { const p = await r.findObjectPath(OBJ.CLAS); check(p.length > 0, "empty path"); return p.map(s => s["adtcore:name"]).join(" > "); }},
  {id: "tree.objecttypes", group: "tree", impact: 2, feature: "Object type registry",
    run: async ({r}) => { const t = await r.loadTypes(); check(t.length > 0, "no types"); return `${t.length} types`; }},
  // objects
  ...Object.entries(OBJ).map(([type, url]) => ({
    id: `object.${type}`, group: "objects", impact: ["CLAS", "INTF", "PROG"].includes(type) ? 5 : 4,
    feature: `Open ${type} (structure + source)`,
    run: async ({r, ADTClient}) => {
      const s = await r.objectStructure(url);
      check(s.metaData["adtcore:name"], "structure without adtcore:name");
      const src = await readSource(ADTClient, r, s);
      check(typeof src === "string" && src.length > 0, "empty source");
      return `${s.metaData["adtcore:type"]}, ${src.length} chars`;
    }
  })),
  {id: "object.CLAS.includes", group: "objects", impact: 4, feature: "Class includes (locals, test classes)",
    run: async ({r, ADTClient}) => {
      const s = await r.objectStructure(OBJ.CLAS);
      const inc = ADTClient.classIncludes(s);
      check(inc.has("testclasses"), `no testclasses include (have ${[...inc.keys()].join(",")})`);
      const t = await r.getObjectSource(inc.get("testclasses")); check(t.includes("FOR TESTING"), "testclasses without FOR TESTING");
      return [...inc.keys()].join(", ");
    }},
  {id: "object.CLAS.outline", group: "objects", impact: 3, feature: "Outline (objectstructure)",
    run: async ({r}) => { const e = await r.objectStructureElements(OBJ.CLAS); check(e.length > 0, "empty outline"); return `${e.length} elements`; }},
  {id: "object.INCL.mainprograms", group: "objects", impact: 3, feature: "Include main program",
    run: async ({r}) => { const m = await r.mainPrograms(OBJ.INCL); check(m.length > 0, "no main program"); return m.map(x => x["adtcore:name"]).join(","); }},
  // write
  {id: "write.lockWriteUnlock", group: "write", impact: 5, feature: "Edit + save (lock, PUT source, unlock)",
    run: ({c, ADTClient}) => writeRoundTrip(c, ADTClient, OBJ.CLAS)},
  // checks
  {id: "check.syntax", group: "check", impact: 4, feature: "Syntax check (checkruns)",
    run: async ({r, ADTClient}) => {
      const s = await r.objectStructure(OBJ.CLAS);
      const main = ADTClient.mainInclude(s);
      const src = await r.getObjectSource(main);
      const clean = (await r.syntaxCheck(main, OBJ.CLAS, src)).filter(m => /^[EAX]/.test(m.severity));
      const broken = await r.syntaxCheck(main, OBJ.CLAS, src.replace("ENDCLASS.", "ENDCLAS."));
      check(clean.length === 0, `clean source has ${clean.length} errors: ${clean[0]?.text}`);
      check(broken.length > 0, "broken source has no findings");
      return `clean 0 errors, broken ${broken.length} findings (line ${broken[0].line})`;
    }},
  {id: "activate.object", group: "activate", impact: 5, feature: "Activate",
    run: async ({c}) => {
      const res = await c.activate("ZCL_ZOSD_TEST_DEMO", OBJ.CLAS);
      check(res.success, `not activated: ${res.messages.map(m => m.shortText).join("; ") || "no messages"}`);
      return `${res.messages.length} messages`;
    }},
  {id: "activate.inactiveObjects", group: "activate", impact: 2, feature: "Inactive objects list",
    run: async ({r}) => { const l = await r.inactiveObjects(); return `${l.length} inactive`; }},
  {id: "unit.run", group: "unit", impact: 4, feature: "ABAP Unit (Test Explorer)",
    run: async ({r}) => {
      const classes = await r.unitTestRun(OBJ.CLAS);
      const methods = classes.flatMap(k => k.testmethods);
      check(methods.length >= 2, `want 2 test methods, got ${methods.length}`);
      const failed = methods.filter(m => m.alerts.length > 0);
      check(failed.length === 1, `want exactly the deliberate failure, got ${failed.length} failing`);
      return `${methods.length} methods, ${failed.length} failing (deliberate)`;
    }},
  // navigation
  {id: "search.quick", group: "search", impact: 5, feature: "Object search (quickSearch)",
    run: async ({r}) => {
      const hits = await r.searchObject("ZCL_ZOSD_TEST*", "CLAS/OC", 10);
      check(hits.some(h => h["adtcore:name"] === "ZCL_ZOSD_TEST_DEMO"), "fixture class not found");
      return `${hits.length} hits`;
    }},
  {id: "whereused.references", group: "whereused", impact: 4, feature: "Where-used / find references",
    run: async ({r}) => { const refs = await r.usageReferences(OBJ.INTF); check(refs.length > 0, "no references"); return `${refs.length} references`; }},
  {id: "editor.completion", group: "editor", impact: 4, feature: "Code completion",
    run: async ({r, ADTClient}) => {
      const s = await r.objectStructure(OBJ.CLAS); const main = ADTClient.mainInclude(s);
      const src = await r.getObjectSource(main);
      const lines = src.split("\n"); const line = lines.findIndex(l => l.includes("mv_prefix = iv_prefix")) + 1;
      const props = await r.codeCompletion(main, src, line, lines[line - 1].indexOf("iv_prefix") + 2);
      check(props.length > 0, "no proposals"); return `${props.length} proposals`;
    }},
  {id: "editor.definition", group: "editor", impact: 4, feature: "Go to definition (navigation/target)",
    run: async ({r, ADTClient}) => {
      const s = await r.objectStructure(OBJ.CLAS); const main = ADTClient.mainInclude(s);
      const src = await r.getObjectSource(main);
      const lines = src.split("\n"); const line = lines.findIndex(l => /INTERFACES zif_zosd_test_greeter/i.test(l)) + 1;
      const col = lines[line - 1].toLowerCase().indexOf("zif_zosd_test_greeter");
      const loc = await r.findDefinition(main, src, line, col, col + "zif_zosd_test_greeter".length);
      check(loc.url, "no target url"); return loc.url;
    }},
  {id: "editor.elementinfo", group: "editor", impact: 2, feature: "Hover (completion elementinfo)",
    run: async ({r, ADTClient}) => {
      const s = await r.objectStructure(OBJ.CLAS); const main = ADTClient.mainInclude(s);
      const src = await r.getObjectSource(main);
      const lines = src.split("\n"); const line = lines.findIndex(l => l.includes("mv_prefix = iv_prefix")) + 1;
      const info = await r.codeCompletionElement(main, src, line, lines[line - 1].indexOf("iv_prefix") + 2);
      check(info, "no element info"); return typeof info === "string" ? "text" : info.name;
    }},
  {id: "editor.prettyprinter", group: "editor", impact: 2, feature: "Format (pretty printer)",
    run: async ({r}) => { const out = await r.prettyPrinter("report z.\nwrite 'x'."); check(out.length > 0, "empty"); }},
  {id: "editor.typehierarchy", group: "editor", impact: 1, feature: "Type hierarchy",
    run: async ({r, ADTClient}) => {
      const s = await r.objectStructure(OBJ.CLAS); const main = ADTClient.mainInclude(s);
      const src = await r.getObjectSource(main);
      const h = await r.typeHierarchy(main, src, 1, 7, true); return `${h.length} nodes`;
    }},
  {id: "versions.list", group: "versions", impact: 3, feature: "Versions / revisions",
    run: async ({r}) => {
      const s = await r.objectStructure(OBJ.CLAS);
      const v = await r.revisions(s, "main"); check(v.length > 0, "no revisions");
      const first = await r.getObjectSource(v[0].uri); check(first.length > 0, "empty revision");
      return `${v.length} revisions`;
    }},
  // data
  {id: "data.freestyle", group: "data", impact: 4, feature: "SQL query (datapreview freestyle)",
    run: async ({r}) => {
      const q = await r.runQuery("SELECT * FROM zosd_test_item", 10, true);
      check(q.columns.length > 0, "no columns"); return `${q.columns.length} columns, ${q.values.length} rows`;
    }},
  {id: "data.table", group: "data", impact: 3, feature: "Table contents (datapreview ddic)",
    run: async ({r}) => {
      const q = await r.tableContents("ZOSD_TEST_ITEM", 10, true);
      check(q.columns.length > 0, "no columns"); return `${q.columns.length} columns, ${q.values.length} rows`;
    }},
  // transports
  {id: "transport.check", group: "transports", impact: 3, feature: "Transport check on save/create",
    run: async ({r}) => { const t = await r.transportInfo(`${OBJ.CLAS}/source/main`, PKG); return `${t.TRANSPORTS.length} requests, local=${t.DLVUNIT || "-"}`; }},
  {id: "transport.userTransports", group: "transports", impact: 2, feature: "Transport organizer view",
    run: async ({r}) => { const t = await r.userTransports(USER); return `${t.workbench.length} workbench targets`; }},
  {id: "transport.configurations", group: "transports", impact: 1, feature: "Transport search configuration",
    run: async ({r}) => { const t = await r.transportConfigurations(); return `${t.length} configurations`; }},
  // atc
  {id: "atc.customizing", group: "atc", impact: 2, feature: "ATC customizing",
    run: async ({r}) => { const a = await r.atcCustomizing(); return `${a.properties.length} properties`; }},
  {id: "atc.run", group: "atc", impact: 3, feature: "ATC run on an object",
    run: async ({r}) => { const run = await r.createAtcRun("DEFAULT", OBJ.CLAS, 100); return `run ${run.id}`; }},
  // debugger
  {id: "debugger.coreDiscovery", group: "debugger", impact: 3, feature: "Debug session start (core discovery)",
    // DebugService.create reads core discovery first; the client expects
    // one app:collection per workspace there
    run: async ({r}) => { const core = await r.adtCoreDiscovery(); check(core.length > 0, "empty core discovery"); return `${core.length} workspaces`; }},
  {id: "debugger.listeners", group: "debugger", impact: 2, feature: "Debugger listener probe",
    run: async ({r}) => { const e = await r.debuggerListeners("user", "osd-conformance-terminal", "osd-conformance-ide", USER); return e ? `conflict: ${e.message?.text ?? "?"}` : "no conflict"; }},
  {id: "debugger.breakpoints", group: "debugger", impact: 3, feature: "Set breakpoints",
    run: async ({c}) => {
      const bps = await c.debuggerSetBreakpoints("user", "osd-conformance-terminal", "osd-conformance-ide", "osd-conformance",
        [`${OBJ.CLAS}/source/main#start=24`], USER);
      check(bps.length > 0, "no breakpoint answer"); return `${bps.length} answered`;
    }},
  // misc that ABAP-FS calls on its own
  {id: "misc.feeds", group: "misc", impact: 1, feature: "Feeds / dumps / users",
    run: async ({r}) => { const f = await r.feeds(); const d = await r.dumps(); const u = await r.systemUsers(); return `${f.length} feeds, ${d.dumps.length} dumps, ${u.length} users`; }},
  // create / delete
  {id: "create.validate", group: "create", impact: 4, feature: "New object wizard: name validation",
    run: async ({r, scratch}) => {
      const v = await r.validateNewObject({objtype: "PROG/P", objname: scratch, packagename: "$TMP", description: "abapfs conformance"});
      check(v.success, `validation refused: ${v.SHORT_TEXT}`); return "accepted";
    }},
  // ABAP-FS: validate, transport check, create. Validation is measured on
  // its own above; here the flow goes on without it to see the rest.
  {id: "create.createDelete", group: "create", impact: 4, feature: "Create + delete in $TMP",
    run: ({c, r, scratch}) => createAndDelete(c, r, scratch, "$TMP")},
  {id: "create.createDeleteInPackage", group: "create", impact: 3, feature: `Create + delete in a package (${PKG})`,
    run: ({c, r, scratch}) => createAndDelete(c, r, `${scratch}P`, PKG)}
];

export const scratchUrl = (name) => `/sap/bc/adt/programs/programs/${name.toLowerCase()}`;

async function createAndDelete(c, r, name, pkg) {
  const url = scratchUrl(name);
  await r.transportInfo(`${url}/source/main`, pkg, "I");
  await c.createObject({objtype: "PROG/P", name, parentName: pkg, description: "abapfs conformance",
    parentPath: `/sap/bc/adt/packages/${encodeURIComponent(pkg.toLowerCase())}`, responsible: USER});
  const s = await r.objectStructure(url); check(s.metaData["adtcore:name"] === name, "created object not readable");
  await deleteObject(c, url);
  const gone = await r.objectStructure(url).then(() => false, isNotFound);
  check(gone, "object still answers after delete");
  return "created, read, deleted, gone";
}

/** A failure that makes every later scenario unsafe: the run stops. */
export class Fatal extends Error {}

export function requireHandle(lock, url) {
  const h = lock?.LOCK_HANDLE;
  if (typeof h !== "string" || !h.trim()) throw new Check(`no lock handle for ${url}`);
  return h;
}

const sameSource = (a, b) => String(a).replace(/\r\n/g, "\n") === String(b).replace(/\r\n/g, "\n");

/** lock, write a marker, read it back, write the original back, unlock.
 *  The restore runs on every path and is verified on every path; a restore
 *  that fails or does not round-trip is Fatal, so nothing activates after it. */
export async function writeRoundTrip(c, ADTClient, url) {
  const s = await c.objectStructure(url);
  const main = ADTClient.mainInclude(s);
  const original = await c.getObjectSource(main);
  const marker = `* abapfs-conformance ${Date.now()}`;
  const lock = await c.lock(url);
  const handle = requireHandle(lock, url);
  let failure, written = false;
  try {
    written = true;
    await c.setObjectSource(main, `${original.replace(/\n?$/, "\n")}${marker}\n`, handle);
    const back = await c.getObjectSource(main, {version: "inactive"});
    check(back.includes(marker), "written source not read back");
  } catch (e) {
    failure = e;
  }
  try {
    if (written) {
      try { await c.setObjectSource(main, original, handle); } catch (e) {
        throw new Fatal(`restore of ${main} failed: ${e.message}`);
      }
      let after;
      try { after = await c.getObjectSource(main, {version: "inactive"}); } catch (e) {
        throw new Fatal(`restore of ${main} could not be verified: ${e.message}`);
      }
      if (!sameSource(after, original)) throw new Fatal(`restore of ${main} did not round-trip`);
    }
  } finally {
    await c.unLock(url, handle).catch(e => { failure ??= e; });
  }
  if (failure) throw failure;
  return `lock IS_LOCAL=${lock.IS_LOCAL || "-"}, restored`;
}

async function deleteObject(c, url) {
  const lock = await c.lock(url);
  const handle = requireHandle(lock, url);
  try { await c.deleteObject(url, handle); } catch (e) { await c.unLock(url, handle).catch(() => {}); throw e; }
}

const isNotFound = (e) => e?.err === 404 || e?.status === 404 || e?.response?.status === 404;

/** Make sure a scratch object does not exist. Only a confirmed 404 counts
 *  as absent; anything else (timeout, auth, 500) is reported, never assumed.
 *  Returns undefined when gone, else a message saying what may be left. */
export async function ensureGone(c, r, url) {
  try {
    await r.objectStructure(url);
  } catch (e) {
    return isNotFound(e) ? undefined : `${url}: existence unknown (${e.message})`;
  }
  try { await deleteObject(c, url); } catch (e) { return `${url}: delete failed (${e.message})`; }
  try {
    await r.objectStructure(url);
    return `${url}: still answers after delete`;
  } catch (e) {
    return isNotFound(e) ? undefined : `${url}: deletion not verified (${e.message})`;
  }
}
function classify(error, calls) {
  if (error instanceof Fatal) return {status: "FAIL", http: calls.at(-1)?.status, error: `FATAL: ${error.message}`};
  if (error instanceof Check) {
    const last = calls.at(-1);
    return {status: "FAIL", http: last?.status, error: `check: ${error.message}`};
  }
  if (error instanceof TypeError) {
    // the HTTP call answered, the client could not read the document
    return {status: "FAIL", http: calls.at(-1)?.status, error: `client could not parse the answer: ${error.message}`};
  }
  const http = error?.err ?? error?.status ?? error?.response?.status ?? calls.filter(x => x.status >= 400).at(-1)?.status;
  const message = String(error?.message ?? error).split("\n")[0].slice(0, 200);
  // MISSING is "the façade does not serve this": its catch-all 404 says
  // "is not served", or a 501. Any other 404 is a served route refusing.
  if (http === 501 || (http === 404 && /not served/i.test(message))) return {status: "MISSING", http, error: message};
  return {status: "FAIL", http, error: message};
}

const shortPath = (uri) => uri.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/^\/sap\/bc\/adt/, "");

function ensureClient() {
  const deps = join(ROOT, ".local", "conformance", "abapfs", "deps");
  const lockSrc = join(DEPS_SPEC, "package-lock.json");
  const installed = join(deps, "node_modules", PIN.name, "package.json");
  const want = readFileSync(lockSrc, "utf8");
  const lockEntry = JSON.parse(want).packages[`node_modules/${PIN.name}`];
  if (lockEntry?.version !== PIN.version || lockEntry?.integrity !== PIN.integrity)
    throw new Error(`tools/abapfs-conformance/package-lock.json does not pin ${PIN.name}@${PIN.version} with the ABAP-FS integrity`);
  const current = existsSync(join(deps, "package-lock.json")) ? readFileSync(join(deps, "package-lock.json"), "utf8") : "";
  if (!existsSync(installed) || current !== want) {
    mkdirSync(deps, {recursive: true});
    copyFileSync(join(DEPS_SPEC, "package.json"), join(deps, "package.json"));
    copyFileSync(lockSrc, join(deps, "package-lock.json"));
    process.stderr.write(`abapfs-conformance: installing ${PIN.name}@${PIN.version} into ${deps} (npm ci, integrity-checked)\n`);
    const r = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {cwd: deps, stdio: ["ignore", "ignore", "inherit"]});
    if (r.status !== 0) throw new Error("npm ci failed for the pinned client");
  }
  return createRequire(join(deps, "package.json"))(PIN.name);
}

async function waitServing(url, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const s = await fetch(`${url}/osd/serving`).then(r => r.json()).catch(() => undefined);
    if (s?.ready) return s;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`${url} did not become ready in ${ms / 1000}s`);
}

function startOsg(opts) {
  const dbDir = join(opts.out, "db");
  mkdirSync(dbDir, {recursive: true});
  const log = join(opts.out, "osg.log");
  const child = spawn(process.execPath, [join(ROOT, "test", "run.mjs")], {
    cwd: ROOT, detached: true,
    env: {...process.env, STG_PORT: String(opts.port), STG_DB_PATH: join(dbDir, "osd.sqlite")},
    stdio: ["ignore", "pipe", "pipe"]
  });
  const chunks = [];
  child.stdout.on("data", d => chunks.push(d)); child.stderr.on("data", d => chunks.push(d));
  const exited = new Promise(res => child.once("exit", res));
  return {child, stop: async () => {
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
      const t = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } }, 15_000);
      await exited;
      clearTimeout(t);
    }
    writeFileSync(log, Buffer.concat(chunks));
  }};
}

/** A content hash of every tracked and every untracked, not ignored file
 *  (.local/ excluded: the report and the database live there). Comparing
 *  hashes, not porcelain lines, sees a second change to an already dirty file. */
export function treeSnapshot(root = ROOT) {
  const out = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {cwd: root, encoding: "utf8", maxBuffer: 1 << 28});
  if (out.status !== 0) throw new Error(`git ls-files failed in ${root}`);
  const map = new Map();
  for (const f of [...new Set(out.stdout.split("\0"))].filter(f => f && !f.startsWith(".local/")).sort()) {
    map.set(f, fileSignature(join(root, f)));
  }
  return map;
}

/** git's view of one file: its mode (symlink, executable or plain) and a
 *  hash of its content, read in bounded chunks rather than whole. */
export function fileSignature(p) {
  let st;
  try { st = lstatSync(p); } catch { return "(deleted)"; }
  if (st.isSymbolicLink()) return `120000 ${readlinkSync(p)}`;
  const mode = st.mode & 0o111 ? "100755" : "100644";
  const hash = createHash("sha1");
  const buf = Buffer.allocUnsafe(1 << 16);
  const fd = openSync(p, "r");
  try {
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0;) hash.update(buf.subarray(0, n));
  } finally { closeSync(fd); }
  return `${mode} ${hash.digest("hex")}`;
}

export function snapshotDiff(before, after) {
  const lines = [];
  for (const [f, h] of after) if (!before.has(f)) lines.push(`added ${f}`); else if (before.get(f) !== h) lines.push(`changed ${f}`);
  for (const f of before.keys()) if (!after.has(f)) lines.push(`removed ${f}`);
  return lines;
}

/** The expectations a run would write. Refused after an abort or a cleanup
 *  problem; a scenario that did not run keeps its previous expectation. */
export function nextExpectations(results, expected, leftBehind = []) {
  if (leftBehind.length) throw new Error(`the run was not clean (${leftBehind[0]})`);
  return {client: {name: PIN.name, version: PIN.version, integrity: PIN.integrity},
    scenarios: Object.fromEntries(SCENARIOS.map(s => {
      const r = results.find(x => x.id === s.id);
      const ran = r && !String(r.error ?? "").startsWith("not run");
      const status = ran ? r.status : expected?.scenarios?.[s.id]?.status;
      if (!status) throw new Error(`${s.id} did not run and has no previous expectation`);
      return [s.id, {status, feature: s.feature}];
    }))};
}

export function compare(results, expected) {
  const regressions = [], improvements = [], changed = [], unknown = [];
  for (const r of results) {
    const e = expected?.scenarios?.[r.id]?.status;
    if (!e) unknown.push(r.id);
    else if (e === r.status) continue;
    // a served feature lost, or a missing one now broken (it answers, wrongly)
    else if (e === "PASS" || (e === "MISSING" && r.status === "FAIL")) regressions.push(`${r.id}: ${e} -> ${r.status}`);
    else if (r.status === "PASS") improvements.push(`${r.id}: ${e} -> PASS`);
    else changed.push(`${r.id}: ${e} -> ${r.status}`);
  }
  return {regressions, improvements, changed, unknown};
}

function markdown(report) {
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const rows = report.results.map(r =>
    `| ${esc(r.feature)} | ${r.endpoints.map(e => `\`${esc(e)}\``).join("<br>") || "-"} | ${r.status}${r.http ? ` (${r.http})` : ""} | ${r.ms} | ${esc(r.status === "PASS" ? r.note : r.error)} |`);
  const gaps = report.results.filter(r => r.status !== "PASS").sort((a, b) => b.impact - a.impact || a.id.localeCompare(b.id));
  const d = report.diff;
  return [
    "# ABAP-FS conformance (protocol layer)", "",
    `Client: ${PIN.name} ${PIN.version} (${PIN.license}), as shipped in ${PIN.client}. Server: ${report.url}. ` +
    `Run ${report.startedAt}, ${(report.ms / 1000).toFixed(1)} s.`, "",
    `**${report.counts.PASS} PASS, ${report.counts.FAIL} FAIL, ${report.counts.MISSING} MISSING** of ${report.results.length}.` +
    (report.leftBehind.length ? `\n\n**Left behind:**\n\n\`\`\`\n${report.leftBehind.join("\n")}\n\`\`\`` : " Nothing left behind.") +
    ` Repo check: ${report.repoCheck}.`, "",
    "| Feature | Endpoint(s) | Result | ms | Note |", "|---|---|---|---:|---|", ...rows, "",
    "## Gaps by ABAP-FS user impact", "",
    ...gaps.map((g, i) => `${i + 1}. **${g.feature}** (${g.status}, impact ${g.impact}): ${esc(g.error)}`), "",
    "## Against the expectations", "",
    `Regressions: ${d.regressions.join("; ") || "none"}. Improvements: ${d.improvements.join("; ") || "none"}. ` +
    `Other changes: ${d.changed.join("; ") || "none"}. Not in the file: ${d.unknown.join(", ") || "none"}.`, ""
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) { console.log(HELP); return 0; }
  const {ADTClient, session_types} = ensureClient();
  mkdirSync(opts.out, {recursive: true});
  const t0 = Date.now();
  let server;
  const before = opts.start ? treeSnapshot() : undefined;
  if (opts.start) {
    server = startOsg(opts);
    process.stderr.write(`abapfs-conformance: starting OSG on ${opts.url} ...\n`);
  }
  const results = [];
  const leftBehind = [];
  try {
    await waitServing(opts.url, opts.start ? 300_000 : 10_000);
    let calls = [];
    const debugCallback = (d) => calls.push({method: d.request.method, uri: d.request.uri, status: d.response?.statusCode ?? d.error?.status, ms: d.duration});
    // what ABAP-FS does: any non-empty user/password, a client, a stateful
    // session for locks and writes, its stateless clone for reads
    const c = new ADTClient(opts.url, USER.toLowerCase(), "any", "001", "EN", {debugCallback});
    c.stateful = session_types.stateful;
    const r = c.statelessClone;
    const scratch = `ZOSD_AFS_${Date.now().toString(36).toUpperCase()}`;
    const ctx = {c, r, ADTClient, scratch};
    const selected = SCENARIOS.filter(s => !opts.only.length || opts.only.includes(s.group) || s.group === "connect");
    let aborted;
    try {
      for (const s of selected) {
        calls = [];
        if (aborted) {
          results.push({id: s.id, group: s.group, feature: s.feature, impact: s.impact, status: "FAIL",
            error: `not run: ${aborted}`, ms: 0, endpoints: [], calls: []});
          continue;
        }
        const start = Date.now();
        let out;
        try {
          const note = await s.run(ctx);
          out = {status: "PASS", note: note ?? ""};
        } catch (e) {
          out = classify(e, calls);
        }
        results.push({id: s.id, group: s.group, feature: s.feature, impact: s.impact, ...out, ms: Date.now() - start,
          endpoints: [...new Set(calls.map(x => `${x.method} ${shortPath(x.uri)}`))],
          calls: calls.map(x => ({method: x.method, path: shortPath(x.uri), status: x.status}))});
        process.stderr.write(`  ${out.status.padEnd(7)} ${s.id}${out.status === "PASS" ? "" : `  ${out.http ?? ""} ${out.error}`}\n`);
        if (out.error?.startsWith("FATAL")) aborted = `${s.id} failed fatally, later scenarios are unsafe`;
      }
      if (aborted) leftBehind.push(`run aborted: ${aborted}`);
    } finally {
      // never leave a scratch object behind, whatever a scenario did; each
      // one on its own, and only a confirmed 404 counts as gone
      for (const name of [scratch, `${scratch}P`]) {
        const problem = await ensureGone(c, r, scratchUrl(name)).catch(e => `${scratchUrl(name)}: ${e.message}`);
        if (problem) leftBehind.push(`system: ${problem}`);
      }
      await c.logout().catch(() => {});
    }
  } finally {
    await server?.stop();
  }
  // after shutdown, so nothing the system writes on its way out escapes
  if (opts.start) leftBehind.push(...snapshotDiff(before, treeSnapshot()).map(l => `repo: ${l}`));
  const repoCheck = opts.start ? "compared file hashes before and after" : "skipped (--url: the system's files are not this checkout's to judge)";
  const counts = Object.fromEntries(STATUSES.map(k => [k, results.filter(r => r.status === k).length]));
  const expected = existsSync(opts.expected) ? JSON.parse(readFileSync(opts.expected, "utf8")) : undefined;
  const report = {client: PIN, url: opts.url, startedAt: new Date(t0).toISOString(), ms: Date.now() - t0,
    counts, leftBehind, repoCheck, diff: compare(results, expected), results};
  writeFileSync(join(opts.out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(opts.out, "report.md"), markdown(report));
  if (opts.updateExpected) {
    try {
      const next = nextExpectations(results, expected, leftBehind);
      mkdirSync(dirname(opts.expected), {recursive: true});
      writeFileSync(opts.expected, JSON.stringify(next, null, 2) + "\n");
    } catch (e) {
      console.log(`  expectations NOT updated: ${e.message}`);
    }
  }
  const d = report.diff;
  console.log(`abapfs-conformance: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.MISSING} MISSING of ${results.length} in ${(report.ms / 1000).toFixed(1)} s against ${opts.url}`);
  console.log(`  regressions: ${d.regressions.length ? d.regressions.join("; ") : "none"}; improvements: ${d.improvements.length ? d.improvements.join("; ") : "none"}`);
  console.log(`  report: ${join(opts.out, "report.md")}`);
  console.log(`  repo check: ${repoCheck}; system-side cleanup verified${leftBehind.length ? " WITH PROBLEMS" : ""}`);
  if (leftBehind.length) { console.log(`  LEFT BEHIND:\n    ${leftBehind.join("\n    ")}`); return 2; }
  return d.regressions.length ? 1 : 0;
}


if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => process.exit(code), e => { console.error(`abapfs-conformance: ${e.message}`); process.exit(2); });
}
