// Ask two systems the same journal and diff what they answer.
//
//   node tools/osd-compare.mjs .local/journal/demo.ndjson --a http://localhost:3030 --b http://localhost:3040
//   node tools/osd-compare.mjs journal.ndjson --a … --b … --rule volatile-dates --approved .local/approved.json
//
// The point of the instrument is the first sieve of three (backlog W.1):
// responses now, the SQL each system ran second, the steps it took third.
// This file is the first one.
//
// Two things decide whether a tool like this is used after its first week,
// and both are about silence rather than about diffing:
//
//   1. It must be silent where there can be no difference. The calibration
//      target is one system compared with itself: if that is not empty, the
//      normalisation is wrong and nothing further can be believed. There is
//      a test that does exactly this and it is the important one.
//
//   2. Every masking rule is named, carries a reason, and is reported when
//      it fires. "Identical" and "identical after masking four timestamps"
//      are different claims, and a tool that cannot tell them apart will
//      eventually hide the difference somebody needed.
//
// So normalisation is not a pile of regular expressions applied quietly. It
// is a list of named rules; only the ones that MUST differ for structural
// reasons are on by default, and every other one is asked for by name.
import fs from "node:fs";
import {readJournal, bodyBuffer} from "./osd-journal.mjs";

// A rule masks a class of difference that is not a difference in behaviour.
// `why` is not documentation - it is the justification that has to survive
// somebody asking "why is this allowed to differ?", and a rule that cannot
// answer that should not exist.
export const RULES = {
  "host-port": {
    always: true,
    why: "two systems answer on two ports by construction; an absolute URI in a payload carries that port",
    apply: (text) => text.replace(/https?:\/\/[^\s"'<>\\)]+?(?=[/"'<>\s\\)]|$)/g, "{origin}"),
  },
  "http-date": {
    always: true,
    why: "the Date header is the clock, not the answer",
    apply: (text) => text.replace(/^date:.*$/gim, "date: {when}"),
  },
  "session-cookie": {
    always: true,
    why: "a session id is minted per connection and differs between two runs of the same system",
    apply: (text) => text.replace(/(sap-sessionid[^=]*=)[^;,\s]+/gi, "$1{session}"),
  },
  "guid": {
    always: false,
    why: "server-minted keys - draft ids, session rows - differ per run; turning this on also masks GUIDs that are real data, so ask for it per journal",
    apply: (text) => text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "{guid}"),
  },
  "volatile-dates": {
    always: false,
    why: "OData epoch dates written by the run itself; off by default because most dates in a payload are data and masking them hides real differences",
    apply: (text) => text.replace(/\/Date\((\d{13})[^)]*\)\//g, "/Date({epoch})/"),
  },
  "generation": {
    always: false,
    why: "the build stamp a page prints in its footer; two branches differ there legitimately, and sometimes that is exactly what you want to see",
    apply: (text) => text.replace(/\b[0-9a-f]{16}\b/g, "{generation}"),
  },
};

export function normalise(text, wanted = []) {
  const applied = [];
  let out = text;
  for (const [name, rule] of Object.entries(RULES)) {
    if (!rule.always && !wanted.includes(name)) continue;
    const before = out;
    out = rule.apply(out);
    if (out !== before) applied.push(name);
  }
  return {text: out, applied};
}

// What is compared, and deliberately not everything. Content-Length follows
// the body, Connection and Keep-Alive describe the socket, and Date is the
// clock; comparing them adds noise that says nothing about behaviour.
const HEADERS_COMPARED = ["content-type", "location", "dataserviceversion", "sap-message"];

async function ask(base, entry) {
  const started = Date.now();
  let answer;
  try {
    answer = await fetch(new URL(entry.path, base), {
      method: entry.method,
      headers: entry.headers ?? {},
      body: bodyBuffer(entry.body),
      redirect: "manual",
    });
  } catch (error) {
    return {failed: String(error && error.message ? error.message : error)};
  }
  const body = Buffer.from(await answer.arrayBuffer());
  const headers = {};
  for (const name of HEADERS_COMPARED) {
    const value = answer.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return {status: answer.status, headers, body, ms: Date.now() - started};
}

function render(side) {
  if (side.failed !== undefined) return `<<the system did not answer: ${side.failed}>>`;
  const headers = Object.entries(side.headers).map(([name, value]) => `${name}: ${value}`).sort().join("\n");
  return `status: ${side.status}\n${headers}\n\n${side.body.toString("utf8")}`;
}

// The first differing line with a little context on each side. A full diff of
// a 400 KB payload is not read by anybody; the line where two systems part
// company is.
export function firstDifference(a, b) {
  const left = a.split("\n");
  const right = b.split("\n");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) {
      return {
        line: i + 1,
        a: (left[i] ?? "<<shorter>>").slice(0, 300),
        b: (right[i] ?? "<<shorter>>").slice(0, 300),
        context: left.slice(Math.max(0, i - 2), i).map((l) => l.slice(0, 120)),
      };
    }
  }
  return undefined;
}

export async function compare({journal, a, b, rules = [], approved = new Set()}) {
  const entries = Array.isArray(journal) ? journal : readJournal(journal);
  const differences = [];
  const masked = new Set();
  for (const entry of entries) {
    const [answerA, answerB] = await Promise.all([ask(a, entry), ask(b, entry)]);
    const left = normalise(render(answerA), rules);
    const right = normalise(render(answerB), rules);
    for (const name of [...left.applied, ...right.applied]) masked.add(name);
    if (left.text === right.text) continue;
    const key = `${entry.method} ${entry.path}`;
    if (approved.has(key)) continue;
    differences.push({entry: key, n: entry.n, ...firstDifference(left.text, right.text)});
  }
  return {compared: entries.length, differences, masked: [...masked]};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rest = process.argv.slice(2);
  const flag = (name, fallback) => {
    const at = rest.indexOf(`--${name}`);
    return at === -1 ? fallback : rest[at + 1];
  };
  const file = rest.find((argument) => !argument.startsWith("--"));
  if (file === undefined) {
    console.error("osd-compare: needs a journal file, --a and --b");
    process.exit(2);
  }
  const approvedFile = flag("approved");
  const approved = new Set(approvedFile !== undefined ? JSON.parse(fs.readFileSync(approvedFile, "utf8")).approved ?? [] : []);
  const rules = rest.filter((argument, i) => rest[i - 1] === "--rule");
  const result = await compare({
    journal: file,
    a: flag("a", "http://localhost:3030"),
    b: flag("b", "http://localhost:3040"),
    rules,
    approved,
  });

  console.log(`osd-compare: ${result.compared} requests`);
  if (result.masked.length > 0) {
    // Named, every time. "No differences" and "no differences after masking
    // three classes of them" must not read the same.
    console.log(`masked: ${result.masked.join(", ")}`);
    for (const name of result.masked) console.log(`  ${name} — ${RULES[name].why}`);
  }
  if (approved.size > 0) console.log(`approved and skipped: ${approved.size}`);
  if (result.differences.length === 0) {
    console.log("no differences");
    process.exit(0);
  }
  console.log(`\n${result.differences.length} differ:\n`);
  for (const difference of result.differences.slice(0, 20)) {
    console.log(`  #${difference.n} ${difference.entry}  (line ${difference.line})`);
    for (const line of difference.context ?? []) console.log(`      | ${line}`);
    console.log(`    a | ${difference.a}`);
    console.log(`    b | ${difference.b}\n`);
  }
  if (result.differences.length > 20) console.log(`  … and ${result.differences.length - 20} more`);
  process.exit(1);
}
