// STORE's JSON projection over the existing ADT Unit runner. No HTTP or
// test execution in the caller's runtime/LUW, including inside a dialog step.
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {basename, join, resolve} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import * as abaplint from "@abaplint/core";
import {liveHash, linkRoots, loadConfig} from "./osd-build.mjs";
import {activationJournal} from "./osd-activation-journal.mjs";
import {withSourceLock} from "./osd-store-source-lock.mjs";
import {nameProblem} from "./osd-object-name.mjs";
import {objectOf} from "./osd-inputs.mjs";
import {UnitRun, unitClasses} from "./osd-unit.mjs";
import {unitValueText} from "./osd-unit-value.mjs";
import {withoutHostPaths} from "./osd-build-issues.mjs";

const refusal = (code, text) => Object.assign(new Error(text), {code});
const MAX_TARGETS = 50;
const countsOf = classes => {
  const methods = classes.flatMap(c => c.methods);
  return {classes: classes.length, methods: methods.length,
    ...Object.fromEntries(["pass", "fail", "error", "skipped"].map(v => [v, methods.filter(m => m.verdict === v).length]))};
};

// Snapshot sources are only used for discovery. The runner still executes
// the published modules. Read only retained bytes with their recorded digest;
// never backfill discovery from today's (possibly inactive) working source.
function plansOf(root, generation, targets) {
  const inputs = JSON.parse(readFileSync(join(generation, "source-inputs.json"), "utf8"));
  const wanted = new Set(targets.map(t => `${t.type} ${t.name}`));
  const sources = new Map(targets.map(t => [`${t.type} ${t.name}`, []]));
  for (const [file, digest] of Object.entries(inputs)) {
    if (!wanted.has(objectOf(basename(file)))) continue;
    const source = join(generation, "source", file);
    const bytes = readFileSync(existsSync(source) ? source : join(root, "build/source-by-digest", digest));
    if (createHash("sha256").update(bytes).digest("hex") !== digest) {
      throw refusal("GENERATION_UNAVAILABLE", "published source snapshot does not match its recorded digest");
    }
    sources.get(objectOf(basename(file))).push([file, bytes.toString("utf8")]);
  }
  return targets.map(target => {
    try {
      const registry = new abaplint.Registry();
      for (const [file, source] of sources.get(`${target.type} ${target.name}`)) {
        registry.addFile(new abaplint.MemoryFile("/" + file, source));
      }
      registry.parse();
      const object = registry.getObject(target.type, target.name);
      if (object?.getABAPFiles().some(f => f.getRaw().trim() && !f.getStructure())) {
        throw new Error(`cannot parse published source for ${target.type} ${target.name}`);
      }
      const view = {registry: () => registry,
        find: (type, name) => registry.getObject(type, name) ? {type, name} : undefined};
      return {target, plan: unitClasses(view, target.type, target.name)};
    }
    catch (error) {
      return {target, error: {stage: error.code === "NOT_FOUND" ? "not_found" : "discovery",
        text: error.code === "NOT_FOUND" ? `${target.type} ${target.name} is not in the published generation`
          : withoutHostPaths(String(error.message ?? error), root)}};
    }
  });
}

function stackOf(entry) {
  const key = objectOf(basename(entry.uri ?? ""));
  if (!key) return undefined;
  const [type, name] = key.split(" ");
  const include = /\.clas\.(testclasses|locals_def|locals_imp|macros)\.abap$/.exec(entry.uri ?? "")?.[1];
  return {type, name, include: {locals_def: "definitions", locals_imp: "implementations"}[include] ?? include ?? "main",
    line: Number(entry.line ?? 0)};
}
function projectClass(target, result) {
  const methods = result.testMethods.map(method => {
    const alerts = method.alerts.map(alert => {
      const value = (text, kind) => alert.kind === "failedAssertion"
        ? unitValueText(text, alert.assertion?.[kind]) : text;
      return {kind: alert.kind, title: alert.title,
        details: (alert.details ?? []).map(d => d.replace(/^(Expected|Actual) \[([\s\S]*)\]$/,
          (_, kind, text) => `${kind} [${value(text, kind.toLowerCase())}]`)),
        ...(alert.expected !== undefined ? {expected: value(alert.expected, "expected")} : {}),
        ...(alert.actual !== undefined ? {actual: value(alert.actual, "actual")} : {}),
        stack: (alert.stack ?? []).map(stackOf).filter(Boolean)};
    });
    const verdict = method.skipped ? "skipped" : !alerts.length ? "pass"
      : method.alerts.some(a => a.kind !== "failedAssertion") ? "error" : "fail";
    return {name: method.name, verdict, ms: method.ms ?? 0, alerts};
  });
  const error = result.alerts[0] ?? result.testMethods.flatMap(m => m.alerts)
    .find(a => a.kind !== "failedAssertion" || ["setup", "teardown"].includes(a.stage));
  return {target, name: result.name, state: error ? "error" : "ok",
    ...(error ? {error: {stage: ["class_setup", "class_teardown", "setup", "teardown", "not_found"].includes(error.stage)
      ? error.stage : "execution", text: error.title}} : {}), methods};
}

export async function runStoreTests(store, json, options = {}) {
  const started = Date.now();
  let expected = null, generation = "", pinned, timer, signal;
  const classes = [];
  const answer = (state, extra = {}) => ({state, generation_id: generation, expected_generation: expected,
    ms: Date.now() - started, ...extra, counts: countsOf(classes), classes});
  try {
    // Every refusal reports the current selection when known. This read is
    // diagnostic only; selection for execution is repeated under the lock.
    generation = store.served?.generation ?? "";
    if (store.root) {
      generation = store.served?.running === true ? generation : liveHash(store.root) ?? generation;
      try { generation = activationJournal(store).currentGeneration(generation) || generation; }
      catch { /* Validation still has its precise refusal if tracking is unavailable. */ }
    }
    let input;
    try { input = JSON.parse(json); }
    catch { throw refusal("INVALID_NAME", "RUN_TESTS needs IV_JSON {targets, expected_generation?}"); }
    if (input && Object.hasOwn(input, "expected_generation")) {
      if (typeof input.expected_generation !== "string" || !input.expected_generation) {
        throw refusal("INVALID_NAME", "expected_generation must be a nonempty string when supplied");
      }
      expected = input.expected_generation;
    }
    if (!input || Array.isArray(input) || !Array.isArray(input.targets) || !input.targets.length) {
      throw refusal("INVALID_NAME", "RUN_TESTS targets must be a nonempty list of objects");
    }
    if (input.targets.length > MAX_TARGETS) throw refusal("INVALID_INPUT", `RUN_TESTS supports at most ${MAX_TARGETS} targets`);
    const targets = [...new Map(input.targets.map(t => {
      if (!t || typeof t.type !== "string" || typeof t.name !== "string") {
        throw refusal("INVALID_NAME", "each target needs string type and name");
      }
      const target = {type: t.type.toUpperCase(), name: t.name.toUpperCase()};
      if (target.type !== "CLAS") throw refusal("NOT_SUPPORTED", `RUN_TESTS supports CLAS with local tests; ${target.type} is not supported`);
      const problem = nameProblem(target.type, target.name);
      if (problem) throw refusal("INVALID_NAME", problem);
      return [`${target.type} ${target.name}`, target];
    })).values()];
    if (!store.root) throw refusal("NOT_SUPPORTED", "RUN_TESTS needs a source-owning host with published generations");
    const runTimeout = options.runTimeout ?? Number(process.env.OSD_STORE_TEST_RUN_MS ?? 300000);
    const testTimeout = options.testTimeout ?? Number(process.env.OSD_STORE_TEST_METHOD_MS ?? 60000);
    if (!(runTimeout > 0) || !(testTimeout > 0) || !Number.isFinite(runTimeout) || !Number.isFinite(testTimeout)) {
      throw refusal("INVALID_INPUT", "STORE test timeout limits must be positive finite milliseconds");
    }
    signal = new AbortController();
    timer = setTimeout(() => signal.abort(), Math.max(1, runTimeout - (Date.now() - started)));
    const deadline = new Promise((_, reject) => signal.signal.addEventListener("abort", () => {
      reject(refusal("RUN_TIMEOUT", "ABAP Unit whole-run deadline exceeded"));
    }, {once: true}));
    const selected = await Promise.race([deadline, withSourceLock(store, () => {
      if (signal.signal.aborted) throw refusal("RUN_TIMEOUT", "ABAP Unit whole-run deadline exceeded");
      const live = liveHash(store.root);
      const journal = activationJournal(store);
      const checkpoint = journal.currentGeneration();
      generation = checkpoint || (store.served?.running === true ? store.served.generation : live) || "";
      if (expected !== null && expected !== generation) {
        return answer("not_run", {error: {code: "GENERATION_MISMATCH", text: "expected generation is not the current published generation",
          expected_generation: expected, current_generation: generation}});
      }
      if (Object.values(journal.entries).some(e => ["checked", "pending"].includes(e.state))
        || store.served?.starting || store.served?.recycling) {
        throw refusal("PUBLICATION_PENDING", "leave the activation step and wait for published before running tests");
      }
      if (store.generationRecordingFailed || journal.generationRecordingFailed
        || checkpoint === "" || checkpoint === undefined && store.inactive?.size
        || !generation || generation !== live || store.served?.running === true && store.served.generation !== generation) {
        throw refusal("GENERATION_UNAVAILABLE", "no complete published generation is available for a new test context");
      }
      const directory = resolve(store.root, "build/by-input", generation);
      if (basename(directory) !== generation || !existsSync(join(directory, "output/init.mjs"))) {
        throw refusal("GENERATION_UNAVAILABLE", "published generation modules are unavailable");
      }
      const plans = plansOf(store.root, directory, targets);
      // Own the modules for the lifetime of the run, even if publication or
      // generation GC happens next. The source lock covers selection + copy,
      // never the tests. Relative host setup imports retain the usual links.
      pinned = mkdtempSync(join(tmpdir(), "osd-store-tests-"));
      cpSync(join(directory, "output"), join(pinned, "output"), {recursive: true});
      linkRoots(store.root, pinned, loadConfig(store.root));
      symlinkSync(resolve(store.root, "node_modules"), join(pinned, "node_modules"), "junction");
      writeFileSync(join(pinned, "abap_transpile.json"), JSON.stringify({input_folder: [], output_folder: "output", libs: []}));
      return {plans};
    })]);
    if (selected.state) return selected;
    const runner = new UnitRun({root: pinned});
    try {
      if (Date.now() - started >= runTimeout) signal.abort();
      for (const {target, plan, error} of selected.plans) {
        if (signal.signal.aborted) throw refusal("RUN_TIMEOUT", "ABAP Unit whole-run deadline exceeded");
        if (error) {
          classes.push({target, name: target.name, state: "error", error, methods: []});
          continue;
        }
        // A separate child per class also contains broken class static state.
        for (const declared of plan.classes) {
          const result = await runner.runDetached(target.type, target.name, {
            plan: {...plan, classes: [declared]}, timeout: testTimeout, signal: signal.signal});
          classes.push(...result.testClasses.map(c => projectClass(target, c)));
          if (Date.now() - started >= runTimeout) {
            signal.abort();
            throw refusal("RUN_TIMEOUT", "ABAP Unit whole-run deadline exceeded");
          }
        }
      }
      return answer("ran");
    } catch (error) {
      return answer("failed", {failure_stage: signal.signal.aborted ? "timeout" : "runner",
        error: {code: signal.signal.aborted ? "RUN_TIMEOUT" : error.code ?? "RUN_FAILED",
          text: withoutHostPaths(String(error.message ?? error), store.root)}});
    }
  } catch (error) {
    if (signal?.signal.aborted) return answer("failed", {failure_stage: "timeout",
      error: {code: "RUN_TIMEOUT", text: "ABAP Unit whole-run deadline exceeded"}});
    return answer("not_run", {error: {code: ["ENOENT", "ENOTDIR"].includes(error.code) ? "GENERATION_UNAVAILABLE" : error.code ?? "GENERATION_UNAVAILABLE",
      text: withoutHostPaths(String(error.message ?? error), store.root)}});
  } finally {
    clearTimeout(timer);
    if (pinned) rmSync(pinned, {recursive: true, force: true});
  }
}
