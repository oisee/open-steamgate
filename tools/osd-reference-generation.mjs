// Compare one .http GET against two immutable local generations.
import {spawn} from "node:child_process";
import {serveCommand} from "./osd-host.mjs";
import {request as httpRequest} from "node:http";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";
import {parseHttpCases} from "./osd-http-case.mjs";
import {evaluateCase} from "./osd-regression-case.mjs";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const hashPattern = /^[a-f0-9]{16}$/;
const fail = (message) => { throw new Error(message); };
function generationOutput(root, hash) {
  if (!hashPattern.test(hash)) fail("generation must be a 16-digit lowercase input hash");
  const dir = join(root, "build", "by-input", hash);
  if (!existsSync(join(dir, "output", "init.mjs"))) fail("missing generation " + hash);
  return dir;
}
function toCase(request, expected) {
  const path = new URL(request.url).pathname;
  return {
    schemaVersion: 1, id: request.id, version: "http-v1", description: request.id,
    destination: "LOCAL", request: {method: request.method, path, headers: {accept: "application/json"}},
    execution: {mode: "wire", timeoutMs: 10000, session: "isolated"},
    redaction: {body: []},
    expect: {status: expected.status, headers: {"content-type": {mediaType: "application/json"}},
      body: {format: "json", value: expected.body, masks: []}},
  };
}
export async function launchReferenceServer(root, hash, cases, dir) {
  const output = generationOutput(root, hash);
  mkdirSync(dir, {recursive: true});
  // Through the host module, so a compiled binary starts its own serve
  // command rather than an interpreter plus a script path.
  const [command, ...commandArgs] = serveCommand(join(root, "tools/osd-serve.mjs"));
  const child = spawn(command, [...commandArgs, "0"], {
    cwd: root, stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {...process.env, OSD_ROOT: root, OSD_OUTPUT: join(output, "output"),
      OSD_GENERATION: hash, OSD_REFERENCE_CASES: JSON.stringify(cases),
      STG_DB: "file", STG_DB_PATH: join(dir, "business.sqlite"),
      OSD_OPERATIONS_DB: join(dir, "operations.sqlite")},
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += String(chunk); log = log.slice(-12000); });
  child.stderr.on("data", (chunk) => { log += String(chunk); log = log.slice(-12000); });
  const port = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error("server boot timed out: " + log)), 120000);
    const ready = (message) => {
      if (message?.type === "ready") { clearTimeout(timer); child.off("exit", gone); done(message.port); }
    };
    const gone = (code) => { clearTimeout(timer); child.off("message", ready); reject(new Error("server exited " + code + ": " + log)); };
    child.on("message", ready);
    child.once("exit", gone);
  }).catch((error) => { child.kill(); throw error; });
  return {child, port};
}
export async function stopReferenceServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  server.child.kill("SIGTERM");
  for (let n = 0; n < 50 && server.child.exitCode === null && server.child.signalCode === null; n++) await sleep(100);
  if (server.child.exitCode === null && server.child.signalCode === null) server.child.kill("SIGKILL");
}
async function ask(server, hash, request) {
  const url = new URL(request.url);
  url.hostname = "127.0.0.1";
  url.port = String(server.port);
  url.protocol = "http:";
  const response = await new Promise((done, reject) => {
    const outgoing = httpRequest(url, {method: request.method,
      headers: {...request.headers, host: "reference.local", "x-osd-case": request.id}}, (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("end", () => done({status: incoming.statusCode, headers: incoming.headers,
        text: Buffer.concat(chunks).toString("utf8")}));
      incoming.on("error", reject);
    });
    outgoing.setTimeout(15000, () => outgoing.destroy(new Error("request timed out")));
    outgoing.on("error", reject);
    outgoing.end(request.body);
  });
  if (response.headers["x-osd-generation"] !== hash) fail("wrong X-OSD-Generation on " + request.id);
  const used = Number(response.headers["x-osd-uuid-used"]);
  if (used !== request.annotations.uuid.length) fail("UUID sequence has unused values in " + request.id);
  const contentType = response.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) fail("non-JSON response in " + request.id);
  const body = JSON.parse(response.text);
  if (response.status >= 500) fail("server execution failed in " + request.id + ": " + response.text.slice(0, 1000));
  return {status: response.status, headers: {"content-type": contentType}, body: {format: "json", value: body}};
}
function compare(request, expected, actual, label) {
  const result = evaluateCase(toCase(request, expected), actual);
  if (result.outcome === "error") fail(label + ": " + JSON.stringify(result.findings));
  return result.findings.map((finding) => label + " " + finding.path + " " +
    JSON.stringify({expected: finding.expected, actual: finding.actual}));
}
export async function captureReference(file, hash, {root = process.cwd()} = {}) {
  generationOutput(root, hash);
  const [request] = parseHttpCases(readFileSync(file, "utf8"), {baseUrl: "http://reference.local"});
  const temp = mkdtempSync(join(root, ".osd-reference-"));
  let server;
  try {
    server = await launchReferenceServer(root, hash, {[request.id]: request.annotations}, temp);
    const result = await ask(server, hash, request);
    return {status: result.status, body: result.body.value};
  } finally {
    await stopReferenceServer(server);
    rmSync(temp, {recursive: true, force: true});
  }
}
export async function runReference(file, before, after, {root = process.cwd()} = {}) {
  generationOutput(root, before);
  generationOutput(root, after);
  const requests = parseHttpCases(readFileSync(file, "utf8"), {baseUrl: "http://reference.local"});
  for (const request of requests) {
    if (request.method !== "GET" || request.body !== "") fail("reference v1 accepts bodyless GET only");
    if (request.annotations.kind && request.annotations.kind !== "read") fail("reference v1 accepts read cases only");
  }
  const temp = mkdtempSync(join(root, ".osd-reference-"));
  const differences = [];
  try {
    for (const [index, request] of requests.entries()) {
      let left, right;
      try {
        left = await launchReferenceServer(root, before, {[request.id]: request.annotations}, join(temp, String(index), "before"));
        right = await launchReferenceServer(root, after, {[request.id]: request.annotations}, join(temp, String(index), "after"));
        const a = await ask(left, before, request);
        const b = await ask(right, after, request);
        differences.push(...compare(request, {status: a.status, body: a.body.value}, b, "before/after"));
        const goldenName = request.annotations.golden ?? (basename(file, ".http") + ".golden.json");
        if (basename(goldenName) !== goldenName) fail("golden must be a sibling file name");
        const goldenPath = join(dirname(file), goldenName);
        if (existsSync(goldenPath)) {
          const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
          differences.push(...compare(request, golden, a, "before/golden"));
          differences.push(...compare(request, golden, b, "after/golden"));
        }
      } finally {
        await stopReferenceServer(right);
        await stopReferenceServer(left);
      }
    }
  } finally {
    rmSync(temp, {recursive: true, force: true});
  }
  return {code: differences.length ? 1 : 0, differences};
}
if (import.meta.url === new URL("file://" + resolve(process.argv[1] ?? "")).href) {
  const [file, before, after] = process.argv.slice(2);
  try {
    if (!file || !before || !after) fail("usage: node tools/osd-reference-generation.mjs <file.http> <before-hash> <after-hash>");
    const result = await runReference(resolve(file), before, after);
    for (const difference of result.differences) console.log(difference);
    console.log(result.code ? result.differences.length + " difference(s)" : "equal");
    process.exitCode = result.code;
  } catch (error) {
    console.error(String(error?.stack ?? error));
    process.exitCode = 2;
  }
}
