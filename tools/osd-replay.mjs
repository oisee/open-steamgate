#!/usr/bin/env node
// A request log, its replay, and the first of the three sieves (backlog W.1).
//
// The bet W.1 makes is a git branch of a whole system, data and all, and the
// minimum for it is nearly assembled already: a ref unfolds into a worktree,
// the build is cached by input hash, and a branch serves on its own port with
// its own database file. **Exactly one artefact was missing** -- a list of
// HTTP calls that can be run against both, and something that can say whether
// the two answered the same.
//
// The plumbing is an hour. **The normaliser is the work**, and it is the work
// for a reason that is easy to talk past: two runs of *one* system do not
// answer identically. They differ in times, in session identifiers, in build
// stamps, in anything derived from a clock or a counter. A comparison that
// reports those is a comparison nobody reads after a week -- and where tools
// like this die is noise, not blindness.
//
// So the discipline is the opposite of the intuition: **begin where there
// must be no difference.** One system, replayed twice. Get the instrument
// silent there, and only then point it at a real change. Every rule in
// `normalise` below was put there by running that and reading what came out,
// which is why each one names what it saw.
//
//   node tools/osd-replay.mjs record  <base> [--log f]   run the log, save the answers
//   node tools/osd-replay.mjs compare <baseA> <baseB> [--log f]
//
// Exit 0 when the two agree, 1 when they differ, 2 when it could not ask.
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {basename} from "node:path";

export const DEFAULT_LOG = new URL("../test/request-log.json", import.meta.url).pathname;

/** The calls, as a file rather than a capture.
 *
 *  A capture would be richer and is what a real trace gives; a tracked list
 *  is what makes the comparison **reproducible by somebody else**, which is
 *  the property this instrument needs first. `record` can append to it from a
 *  live server later; nothing here depends on that having happened. */
export function readLog(file = DEFAULT_LOG) {
  if (!existsSync(file)) throw new Error(`no request log at ${file}`);
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return parsed.calls ?? parsed;
}

async function ask(base, call) {
  const url = `${base.replace(/\/$/, "")}${call.path}`;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: call.method ?? "GET",
      headers: call.headers ?? {},
      body: call.body,
      redirect: "manual",
    });
    const text = await response.text();
    return {
      call,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: text,
      ms: Date.now() - started,
    };
  } catch (error) {
    return {call, failed: String(error.message ?? error)};
  }
}

export async function replay(base, calls = readLog()) {
  const out = [];
  for (const call of calls) out.push(await ask(base, call));
  return out;
}

/** Everything that differs between two runs of ONE system, and nothing else.
 *
 *  Each rule is here because a calibration run printed it. Taking one out is
 *  cheap to try: run `compare` against one base twice and see what comes
 *  back. Adding one that was never seen is how a normaliser starts hiding
 *  real differences, so none of these are speculative. */
export function normalise(text, contentType = "") {
  let out = String(text ?? "");
  // an ISO timestamp anywhere: `started`, `builtAt`, `last-modified` in a body
  out = out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<when>");
  // OData V2 writes its dates as /Date(1758…)/
  out = out.replace(/\/Date\((-?\d+)\)\//g, "/Date(<when>)/");
  // uuids: session ids, correlation ids, ADT handles
  out = out.replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, "<uuid>");
  // a $batch boundary is random by definition, and it appears both in the
  // header and several times in the body
  out = out.replace(/(?:--)?batch(?:response)?[_-][0-9a-fA-F-]{6,}/gi, "<boundary>");
  // the port the system happens to be on: two branches are two ports, and a
  // URL that names one is not a difference in behaviour
  out = out.replace(/localhost:\d+/g, "localhost:<port>");
  out = out.replace(/127\.0\.0\.1:\d+/g, "localhost:<port>");
  // elapsed milliseconds a page prints about itself
  out = out.replace(/\b\d+(?:\.\d+)? ?ms\b/g, "<ms>");
  // The **process id** in the identity line, `SID (pid) client user`, which
  // `zcl_osd_webgui` prints on Easy Success and on System: Status. This is
  // the one the calibration run actually found, and it is worth saying what
  // it is rather than matching any parenthesised number: two branches are
  // two processes by definition, so a pid is the purest case of a
  // difference that is not a difference in behaviour. Narrow on purpose --
  // a rule that swallowed every number in brackets would hide a row count.
  out = out.replace(/\b([A-Z0-9]{3}) \(\d+\)/g, "$1 (<pid>)");
  return out;
}

/** What the two runs disagreed about, one entry per call.
 *
 *  `approved` is not a convenience, it is a precondition: the moment this is
 *  pointed at a **deliberate** change, every call touched by that change goes
 *  red, and an instrument that is red on purpose is an instrument nobody
 *  reads. So a difference can be approved by path, with a reason, exactly
 *  like `.leak-allow.json` and `.naming-allow.json` -- the reason is what
 *  tells an approval from a way of making the comparison green, and it is
 *  needed from the start rather than after the first real use. */
export function diff(left, right, approved = []) {
  const excused = (path) => approved.some((a) => a.path === path && a.reason);
  const out = [];
  const count = Math.max(left.length, right.length);
  for (let i = 0; i < count; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a === undefined || b === undefined) {
      out.push({path: (a ?? b).call.path, why: "one side has no answer at all"});
      continue;
    }
    if (excused(a.call.path)) continue;
    if (a.failed !== undefined || b.failed !== undefined) {
      if (a.failed !== b.failed) out.push({path: a.call.path, why: `asked and failed: ${a.failed ?? b.failed}`});
      continue;
    }
    if (a.status !== b.status) {
      out.push({path: a.call.path, why: `status ${a.status} against ${b.status}`});
      continue;
    }
    const na = normalise(a.body, a.contentType);
    const nb = normalise(b.body, b.contentType);
    if (na !== nb) {
      out.push({path: a.call.path, why: "the answers differ", first: firstDifference(na, nb)});
    }
  }
  return out;
}

/** where they part, with enough either side to see it -- a diff that says
 *  only "they differ" makes a person re-run it by hand, which is the same as
 *  not having run it */
function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const from = Math.max(0, i - 60);
  return {at: i, left: a.slice(from, i + 60), right: b.slice(from, i + 60)};
}

if (basename(process.argv[1] ?? "") === "osd-replay.mjs") {
  const [mode, ...rest] = process.argv.slice(2);
  const at = rest.indexOf("--log");
  const log = at === -1 ? DEFAULT_LOG : rest[at + 1];
  const bases = rest.filter((a) => !a.startsWith("--") && rest[rest.indexOf(a) - 1] !== "--log");
  let calls;
  try {
    calls = readLog(log);
  } catch (error) {
    console.error(String(error.message));
    process.exit(2);
  }
  if (mode === "record") {
    if (bases[0] === undefined) {
      console.error("usage: osd-replay.mjs record <base> [--log f]");
      process.exit(2);
    }
    const answers = await replay(bases[0], calls);
    const unasked = answers.filter((a) => a.failed).length;
    writeFileSync("replay.json", `${JSON.stringify(answers, undefined, 1)}\n`);
    console.log(`${answers.length} calls, ${unasked} could not be asked -> replay.json`);
    // **"Asked nothing" is not "recorded a run".** This printed the line
    // above and exited 0 against a port with no server on it, minutes after
    // the module was written to stop exactly that -- the third value of a
    // verdict is always cheaper to fake than to have, and this one faked
    // success. `compare` already refused it; `record` did not.
    if (unasked === answers.length) {
      console.error(`nothing answered at ${bases[0]}: this is not a recording`);
      process.exit(2);
    }
    process.exit(0);
  }
  if (mode === "compare") {
    if (bases[1] === undefined) {
      console.error("usage: osd-replay.mjs compare <baseA> <baseB> [--log f]");
      process.exit(2);
    }
    const [left, right] = [await replay(bases[0], calls), await replay(bases[1], calls)];
    const unasked = left.filter((a) => a.failed).length + right.filter((a) => a.failed).length;
    if (unasked === left.length + right.length) {
      console.error("neither side answered anything: this is not agreement");
      process.exit(2);
    }
    const differences = diff(left, right);
    for (const d of differences) {
      console.log(`${d.path}\n  ${d.why}`);
      if (d.first) {
        console.log(`  left  …${d.first.left}…`);
        console.log(`  right …${d.first.right}…`);
      }
    }
    console.log(`\n${calls.length} calls, ${differences.length} difference(s)`);
    process.exit(differences.length === 0 ? 0 : 1);
  }
  console.error("usage: osd-replay.mjs record <base> | compare <baseA> <baseB>");
  process.exit(2);
}
