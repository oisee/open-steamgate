// Will this system accept these files?
//
// Named by the question rather than by the mechanism: today it asks about
// syntax, tomorrow about activation and the dictionary, and a tool called
// `syntax-check` would grow a sibling the first time somebody says "but that
// is not syntax".
//
// **Why it is worth a tool at all.** The loop for a week was: build a zip,
// a human imports it, the system's complaint arrives in a chat message, fix,
// repeat. Six rounds in one evening. ADT will answer the same complaint
// about source that is not on the system yet, before the import and without
// the human.
//
// **Why it is not a flag on a generator.** Four things generate objects here
// and eighteen more are hand-written in `src/`, so a flag on one generator
// checks one generator and cannot reach a hand-written file at all. And the
// failures are a different axis: a generator fails deterministically and
// offline, this fails when a network or a logon fails, and folding the two
// into one exit code makes "did not compile" and "could not connect" the
// same answer.
//
// **The third value is the point.** A check that cannot reach a system says
// **not checked** and exits non-zero. It does not pass. Every instrument in
// this tree that quietly returned "clean" for "nothing was looked at" has
// cost a day, and this one is written after those days rather than before.
//
//   node tools/osd-preflight.mjs <file>... --to <system>
//
// Exit 0 accepted, 1 refused with messages, 2 not checked.
import {readFileSync, existsSync} from "node:fs";
import {basename} from "node:path";

/** systems, **not** services
 *
 *  `osd-remote-service.mjs` has a destinations file too, and it is keyed by
 *  *service name*, because that is what a remote OData service needs. A
 *  preflight is keyed by *system*. Bending one file into both shapes is how
 *  a reader ends up asking the wrong question of the right data, so this has
 *  its own, in the same gitignored place and the same format. */
export const SYSTEMS = ".local/systems.json";

export function systemsOf(file = SYSTEMS) {
  if (existsSync(file) === false) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`${file}: ${error?.message ?? error}`);
    return {};
  }
}

/** the ABAP object a file is, by its abapGit name */
export function objectOf(path) {
  const name = basename(path);
  const m = /^([^.]+)\.(clas|intf|prog|fugr|tabl|dtel|doma|ddls)\.abap$/i.exec(name);
  if (m === null) return undefined;
  const [, object, kind] = m;
  const uri = {
    clas: `/sap/bc/adt/oo/classes/${object}`,
    intf: `/sap/bc/adt/oo/interfaces/${object}`,
    prog: `/sap/bc/adt/programs/programs/${object}`,
    fugr: `/sap/bc/adt/functions/groups/${object}`,
    tabl: `/sap/bc/adt/ddic/tables/${object}`,
    dtel: `/sap/bc/adt/ddic/dataelements/${object}`,
    ddls: `/sap/bc/adt/ddic/ddl/sources/${object}`,
  }[kind.toLowerCase()];
  return uri === undefined ? undefined : {object: object.toUpperCase(), kind: kind.toLowerCase(), uri};
}

// ---------------------------------------------------------------------------
// The one part of this file that is a claim about somebody else's protocol.
//
// **Constructed, not observed.** The session that measured `checkruns` did it
// through an MCP call and never saw the wire: it sent
// `{type: "syntax_check", object_url, content}` and read a summary the tool
// had already shaped. So the URL, the body, the content type and whether a
// CSRF token is needed are **not** known here, and this is ADT's documented
// shape rather than a recording of what the system accepted.
//
// It is isolated for that reason, and it stays isolated after the wire form
// is measured: everything else in this tool is ours and testable without a
// system, and this is the part where being wrong is being wrong about SAP.
//
// To replace a guess with a measurement: point the vsp entry of `.mcp.json`
// at `tools/osd-tls-proxy.mjs --dump`, make one call, read the dump. The dump
// carries a logon and never leaves `.local/`.
// ---------------------------------------------------------------------------
export const BODY_IS_OBSERVED = false;

export function checkRequest(objects) {
  const list = objects.map((o) =>
    `  <chkrun:checkObject adtcore:uri="${o.uri}" chkrun:version="inactive"/>`).join("\n");
  return {
    path: "/sap/bc/adt/checkruns?reporters=abapCheckRun",
    contentType: "application/vnd.sap.adt.checkobjects+xml",
    body: `<?xml version="1.0" encoding="UTF-8"?>
<chkrun:checkObjectList xmlns:adtcore="http://www.sap.com/adt/core" xmlns:chkrun="http://www.sap.com/adt/checkrun">
${list}
</chkrun:checkObjectList>
`,
  };
}

/** the findings in a checkruns answer
 *
 *  Three answers have to stay distinct and one of them is the trap: a run
 *  that found nothing, a run whose answer had no message element at all, and
 *  a run that never happened. The first two are both "accepted"; the third
 *  is "not checked" and is handled by the caller, never here, because a
 *  parser that returns `[]` for "no answer" is how an absent value takes the
 *  place of a real one. */
export function findingsIn(xml) {
  if (typeof xml !== "string") return undefined;
  const out = [];
  for (const m of xml.matchAll(/<chkrun:checkMessage\b([^>]*)\/?>/g)) {
    const at = (k) => (new RegExp(`${k}="([^"]*)"`).exec(m[1]) ?? [])[1];
    out.push({
      uri: at("chkrun:uri"),
      type: at("chkrun:type") ?? "E",
      text: (at("chkrun:shortText") ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
    });
  }
  return out;
}

async function ask(target, objects) {
  const {path, contentType, body} = checkRequest(objects);
  const auth = "Basic " + Buffer.from(`${target.user}:${target.password}`).toString("base64");
  const res = await fetch(target.url + path, {
    method: "POST",
    headers: {"Authorization": auth, "Content-Type": contentType, "Accept": "application/*"},
    body,
  });
  if (res.ok === false) {
    const e = new Error(`${res.status} ${res.statusText}`);
    e.status = res.status;
    throw e;
  }
  return findingsIn(await res.text());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--to");
  const system = at === -1 ? undefined : argv[at + 1];
  const files = argv.filter((a, i) => a.startsWith("--") === false && i !== at + 1);

  const objects = [];
  for (const f of files) {
    const o = objectOf(f);
    if (o === undefined) console.error(`preflight: ${f} is not an object this can ask about, skipped`);
    else objects.push({...o, file: f});
  }
  if (objects.length === 0) {
    console.error("preflight: nothing to ask about - that is not 'accepted', it is 'not checked'");
    process.exit(2);
  }

  // The system is an argument and never a default. A preflight that picks a
  // system on its own is a tool that talks to a system nobody named.
  if (system === undefined) {
    console.error(`preflight: --to <system> is required; ${objects.length} object(s) NOT CHECKED`);
    process.exit(2);
  }
  const target = systemsOf()[system];
  if (target?.url === undefined || target?.user === undefined) {
    console.error(`preflight: no system '${system}' in ${SYSTEMS}; ${objects.length} object(s) NOT CHECKED`);
    process.exit(2);
  }

  let findings;
  try {
    findings = await ask(target, objects);
  } catch (error) {
    console.error(`preflight: ${system} did not answer (${error?.message ?? error}) - NOT CHECKED`);
    process.exit(2);
  }
  if (findings === undefined) {
    console.error(`preflight: ${system} answered something this cannot read - NOT CHECKED`);
    process.exit(2);
  }
  const bad = findings.filter((f) => f.type !== "I" && f.type !== "W");
  for (const f of findings) console.log(`${f.type} ${f.uri ?? ""} ${f.text}`);
  console.error(`preflight: ${objects.length} object(s) asked of ${system}, ${findings.length} message(s)` +
    (BODY_IS_OBSERVED ? "" : " [request constructed from documentation, not observed on the wire]"));
  process.exit(bad.length > 0 ? 1 : 0);
}
