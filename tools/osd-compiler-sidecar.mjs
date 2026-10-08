// Compiler-provider contract v1. Validation only: no publication or execution.
import {createHash} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {isAbsolute, join, relative, resolve} from "node:path";
import {createInterface} from "node:readline";
import {once} from "node:events";
import lock from "../libs.lock.json" with {type: "json"};
import {runsAs} from "./osd-main.mjs";
import {InputAudit, realContainedPath, trackedRead} from "./osd-input-audit.mjs";

const limits = {maxSnapshotBytes: 16 * 1024 * 1024, maxConcurrentRequests: 1};
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const refusal = (code, text) => Object.assign(new Error(text), {protocolCode: code});

function snapshotFiles(snapshot) {
  if (!snapshot || typeof snapshot.root !== "string" || !snapshot.root
      || typeof snapshot.generation !== "string" || !Array.isArray(snapshot.objects) || !snapshot.objects.length) {
    throw refusal("BAD_REQUEST", "snapshot needs root, generation and objects");
  }
  const root = realContainedPath(snapshot.root, ".").realRoot, files = new Map();
  const audit = new InputAudit();
  let size = 0;
  for (const object of snapshot.objects) {
    if (!object || typeof object.type !== "string" || typeof object.name !== "string"
        || !["active", "inactive"].includes(object.version) || !Array.isArray(object.files) || !object.files.length) {
      throw refusal("BAD_REQUEST", "invalid snapshot object");
    }
    for (const file of object.files) {
      if (!file || typeof file.path !== "string" || !file.path || isAbsolute(file.path)
          || typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)) {
        throw refusal("BAD_REQUEST", "invalid snapshot file");
      }
      let bytes;
      try { bytes = trackedRead(audit, root, file.path); }
      catch (error) {
        if (error.protocolCode === "BAD_REQUEST") throw error;
        throw refusal("SNAPSHOT_MISMATCH", `cannot read ${file.path}`);
      }
      const local = relative(root, resolve(root, file.path));
      if (files.has(local)) throw refusal("BAD_REQUEST", `duplicate snapshot file: ${file.path}`);
      if (digest(bytes) !== file.sha256) throw refusal("SNAPSHOT_MISMATCH", `hash differs: ${file.path}`);
      size += bytes.length;
      if (size > limits.maxSnapshotBytes) throw refusal("BAD_REQUEST", "snapshot exceeds maxSnapshotBytes");
      files.set(local, {bytes, sha256: file.sha256});
    }
  }
  return {root, files, audit};
}

function diagnostic(issue) {
  const col = Math.max(0, (issue.column ?? 1) - 1);
  return {
    severity: issue.severity ?? "E", code: "ABAP_SYNTAX", text: issue.message,
    object: {type: issue.type, name: issue.name}, include: (issue.file ?? "").replace(/^\//, ""),
    line: issue.line ?? 1, col, endLine: issue.endLine ?? issue.line ?? 1,
    // abaplint columns are 1-based and its end is exclusive.
    endCol: Math.max(0, (issue.endColumn ?? col + 2) - 2),
  };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== "--stdio") {
    console.error("usage: osd compiler --stdio");
    return 2;
  }
  // Imported tools may log while building their registry. Reserve stdout for
  // responses, including in a compiled host, before importing those tools.
  const saved = Object.fromEntries(["log", "info", "debug", "warn"].map(key => [key, console[key]]));
  for (const key of Object.keys(saved)) console[key] = console.error.bind(console);
  let input;
  try {
    const {ObjectStore} = await import("./osd-store.mjs");
    const {forgetRegistry, updateRegistryFiles} = await import("./osd-store-registry.mjs");
    const {prepareActivation, activationIssues} = await import("./osd-publish-activation.mjs");
    let osd = "source";
    try { osd = JSON.parse(readFileSync(join(process.cwd(), "osd-version.json"), "utf8")).version; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    input = createInterface({input: process.stdin, crlfDelay: Infinity});
    for await (const line of input) {
      let request, response;
      try {
        try { request = JSON.parse(line); }
        catch { throw refusal("BAD_REQUEST", "malformed JSON"); }
        if (!request || Array.isArray(request) || !["string", "number"].includes(typeof request.id) || typeof request.op !== "string") {
          throw refusal("BAD_REQUEST", "request needs id and op");
        }
        if (request.op === "hello") {
          if (request.contract !== 1) throw refusal("CONTRACT_MISMATCH", "expected contract 1");
          response = {contract: 1, osd, transpiler: lock.transpiler.ref, capabilities: ["check"], limits};
        } else if (request.op === "check") {
          const {root, files, audit} = snapshotFiles(request.snapshot);
          if (existsSync(join(root, "abap_transpile.json"))) trackedRead(audit, root, "abap_transpile.json", "utf8");
          const store = new ObjectStore({root, inputAudit: audit, registryIssueOptions: {endCoordinates: true}});
          // External writers are not store mutations. Start from today's
          // dependency tree, then check the exact bytes whose hashes passed.
          forgetRegistry(store);
          updateRegistryFiles(store.registry(), [...files].map(([path, file]) => ["/" + path, file.bytes.toString("utf8")]));
          const checked = prepareActivation(store, request.snapshot.objects, {transpile: false});
          // Refuse a file that moved while the registry read its dependencies.
          const inputs = audit.verified(root);
          const diagnostics = activationIssues(checked).map(diagnostic);
          response = {diagnostics: [...new Map(diagnostics.map(d => [JSON.stringify(d), d])).values()], inputs};
        } else {
          throw refusal("UNSUPPORTED_OP", `unsupported operation: ${request.op}`);
        }
      } catch (error) {
        if (!error.protocolCode) console.error(error);
        response = {error: {code: error.protocolCode ?? "INTERNAL", text: error.message}};
      }
      const id = request && ["string", "number"].includes(typeof request.id) ? {id: request.id} : {};
      if (!process.stdout.write(JSON.stringify({...id, ...response}) + "\n")) await once(process.stdout, "drain");
    }
    return 0;
  } finally {
    input?.close();
    Object.assign(console, saved);
  }
}

if (runsAs("osd-compiler-sidecar.mjs")) process.exitCode = await main();
