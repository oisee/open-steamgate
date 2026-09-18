// A journal of requests, so that two systems can be asked the same thing.
//
//   node tools/osd-journal.mjs record --target http://localhost:3030 --port 3041 --out .local/journal/demo.ndjson
//   node tools/osd-journal.mjs show .local/journal/demo.ndjson
//
// The recorder is a forwarding proxy and nothing else: point a browser, a
// test run or curl at its port, and every request that passes through is
// written down. It is a proxy rather than a hook inside the server on
// purpose - a journal taken from outside records what a client actually
// sent, including the requests we would never have thought to write by
// hand, and it costs the server no code at all.
//
// The file is `.ndjson`, never `.jsonl`: `.gitignore` swallows `*.jsonl`,
// and a recording that is green here and absent on the runner is a lesson
// this tree has already paid for once (backlog E.8).
//
// One line is one request:
//
//   {"n":1,"method":"GET","path":"/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$top=2",
//    "headers":{"accept":"application/json"},"body":null,
//    "recorded":{"status":200,"bytes":1873}}
//
// `recorded` is what the server answered while the journal was being taken.
// It is not the expectation - the expectation is the other system's answer
// in a comparison - but it is what lets `show` say whether a journal is
// worth replaying at all, and it catches a journal recorded against a
// broken system before anybody draws conclusions from it.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

// Headers that belong to one hop and must not be forwarded or recorded:
// passing `host` on breaks name-based routing, and the rest describe the
// connection rather than the request.
const HOP = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "content-length",
]);

function forwardable(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return null;
  const buffer = Buffer.concat(chunks);
  // Text where it is text, so a journal stays readable and a diff of two
  // journals is a diff of requests rather than of base64. A body that does
  // not survive the round trip is binary, and binary goes as base64.
  const text = buffer.toString("utf8");
  if (Buffer.compare(Buffer.from(text, "utf8"), buffer) === 0) return {text};
  return {base64: buffer.toString("base64")};
}

export function bodyBuffer(body) {
  if (body === null || body === undefined) return undefined;
  if (body.text !== undefined) return Buffer.from(body.text, "utf8");
  return Buffer.from(body.base64, "base64");
}

export function readJournal(file) {
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

async function record({target, port, out}) {
  fs.mkdirSync(path.dirname(out), {recursive: true});
  const sink = fs.createWriteStream(out, {flags: "a"});
  let n = 0;

  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const entry = {
      n: ++n,
      method: req.method,
      path: req.url,
      headers: forwardable(req.headers),
      body,
    };
    let answer;
    try {
      answer = await fetch(new URL(req.url, target), {
        method: req.method,
        headers: entry.headers,
        body: bodyBuffer(body),
        redirect: "manual",
      });
    } catch (error) {
      // The target is down or refused. Write the line anyway: a journal with
      // a hole in it is a fact about the recording, and a silently shorter
      // journal is the kind of thing that later reads as "no difference".
      entry.recorded = {error: String(error && error.message ? error.message : error)};
      sink.write(JSON.stringify(entry) + "\n");
      res.writeHead(502, {"content-type": "text/plain"});
      res.end("osd-journal: the target did not answer\n");
      return;
    }
    const buffer = Buffer.from(await answer.arrayBuffer());
    entry.recorded = {status: answer.status, bytes: buffer.length};
    sink.write(JSON.stringify(entry) + "\n");

    const headers = {};
    answer.headers.forEach((value, name) => {
      if (!HOP.has(name.toLowerCase())) headers[name] = value;
    });
    res.writeHead(answer.status, headers);
    res.end(buffer);
  });

  await new Promise((resolve) => server.listen(port, resolve));
  console.log(`osd-journal: recording ${target} through http://localhost:${port} into ${out}`);
  console.log("point a client at the proxy port; Ctrl-C ends the recording");
  return server;
}

function show(file) {
  const entries = readJournal(file);
  const byStatus = new Map();
  let failed = 0;
  for (const entry of entries) {
    const key = entry.recorded?.error !== undefined ? "error" : String(entry.recorded?.status ?? "-");
    byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
    if (entry.recorded?.error !== undefined || (entry.recorded?.status ?? 0) >= 500) failed++;
  }
  console.log(`${entries.length} requests in ${file}`);
  for (const [status, count] of [...byStatus].sort()) console.log(`  ${status.padStart(5)}  ${count}`);
  const methods = new Set(entries.map((e) => e.method));
  console.log(`  methods: ${[...methods].sort().join(", ")}`);
  if (failed > 0) {
    // Said loudly, because a journal recorded against a system that was
    // already broken will compare equal to another broken system and the
    // comparison will look like agreement.
    console.log(`\n${failed} of them failed while recording. A journal taken from a broken`);
    console.log("system compares clean against another broken one - check before replaying.");
  }
  return entries.length;
}

// Only when this file IS the program. It is also imported - by the comparer,
// and through it by the tests - and a command line read at import time made
// the whole suite exit 2 with "unknown command test/journal.mjs" before a
// single test ran.
const [command, ...rest] = import.meta.url === `file://${process.argv[1]}` ? process.argv.slice(2) : [undefined];

function flag(name, fallback) {
  const at = rest.indexOf(`--${name}`);
  return at === -1 ? fallback : rest[at + 1];
}

if (command === "record") {
  await record({
    target: flag("target", "http://localhost:3030"),
    port: Number(flag("port", "3041")),
    out: flag("out", ".local/journal/journal.ndjson"),
  });
} else if (command === "show") {
  const file = rest.find((argument) => !argument.startsWith("--"));
  if (file === undefined) {
    console.error("osd-journal: show needs a file");
    process.exit(2);
  }
  show(file);
} else if (command !== undefined) {
  console.error(`osd-journal: unknown command ${command}`);
  process.exit(2);
} else if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("osd-journal: record | show  (see the comment at the top of this file)");
}
