// ABAP Unit over every class, failures collected rather than fatal.
//
// The transpiler's generated harness (`output/index.mjs`, written by
// @abaplint/transpiler's unit_test.js) runs the classes in order and lets the
// first failing assertion end the process. Every class after it then does not
// run, and the log says so only by being short: on 2026-10-02 one duplicate
// grain in ZCL_OSD_DEMO_TAXI hid every class after it. This driver runs the
// same list the same way -- class_setup, then per method setup, the method,
// teardown, then class_teardown -- but catches per method, prints one
// `FAILED` line for each, and exits 1 at the end with a summary.
//
// The list comes from the harness itself: its `getData()` is the inventory
// the transpiler computed (classes, local test classes, methods, skips, risk
// levels). It is read out of the file, not re-derived, so the two cannot
// disagree about what there is to run. If the harness ever changes shape,
// `harnessEntries` throws and says so rather than running nothing.
//
// Usage: node --import ./tools/osd-unit-bootstrap.mjs tools/osd-unit-all.mjs
//        [--skip-critical | --only-critical]
import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {inspect} from "node:util";

const RISK_LEVELS = new Set(["HARMLESS", "DANGEROUS", "CRITICAL",
  // a test class without a RISK LEVEL clause: the transpiler writes
  // "${def.riskLevel}" into the harness, which is the string "undefined"
  "undefined"]);

/** what is wrong with a getData() result, as a list of messages */
export function invalidEntries(entries) {
  if (!Array.isArray(entries)) return ["getData() did not return an array"];
  const problems = [];
  const text = (v) => typeof v === "string" && v.length > 0;
  entries.forEach((st, i) => {
    const at = `entry ${i}${st && text(st.objectName) ? ` (${st.objectName})` : ""}`;
    if (st === null || typeof st !== "object") {
      problems.push(`${at}: not an object`);
      return;
    }
    for (const key of ["objectName", "localClass", "filename"]) {
      if (!text(st[key])) problems.push(`${at}: ${key} is not a non-empty string`);
    }
    if (!RISK_LEVELS.has(st.riskLevel)) problems.push(`${at}: riskLevel ${JSON.stringify(st.riskLevel)} is not one of ${[...RISK_LEVELS].join(", ")}`);
    if (!Array.isArray(st.methods)) {
      problems.push(`${at}: methods is not an array`);
      return;
    }
    st.methods.forEach((m, j) => {
      if (m === null || typeof m !== "object") problems.push(`${at}: method ${j} is not an object`);
      else {
        if (!text(m.name)) problems.push(`${at}: method ${j} has no name`);
        if (typeof m.skip !== "boolean") problems.push(`${at}: method ${j} skip ${JSON.stringify(m.skip)} is not a boolean`);
      }
    });
  });
  return problems;
}

/** the entries of the generated harness's getData(), from its source, checked */
export function harnessEntries(source) {
  const match = /function getData\(\) \{[\s\S]*?\n  return ret;\n\}/.exec(source);
  if (!match) throw new Error("osd-unit-all: no getData() in the generated harness; its shape changed");
  const entries = new Function(`${match[0]}\nreturn getData();`)();
  const problems = invalidEntries(entries);
  if (problems.length > 0) {
    throw new Error("osd-unit-all: the generated harness's list is malformed; its shape changed:\n  " + problems.join("\n  "));
  }
  return entries;
}

function describe(err) {
  if (err === undefined || err === null) return String(err);
  const name = err.constructor?.name ?? typeof err;
  const message = err.message ?? (typeof err === "string" ? err : "");
  return message ? `${name}: ${message}` : name;
}

/**
 * What a failure says beyond its class name, as lines. An ABAP assertion is
 * a kernel_cx_assert with an empty .message: its text is in msg, actual and
 * expected (ABAP strings, read with get() or .value) and where it was raised
 * in EXTRA_CX. The old harness printed all of it with console.log(err);
 * the one-line FAILED summary alone would lose it.
 */
export function detail(err) {
  if (err === null || typeof err !== "object") return [];
  const text = (v) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v.get === "function") return v.get();
    if (typeof v === "object" && "value" in v) return v.value;
    return v;
  };
  const lines = [];
  for (const key of ["msg", "actual", "expected"]) {
    const value = text(err[key]);
    if (value !== undefined && value !== "") lines.push(`${key}: ${typeof value === "string" ? value : inspect(value, {depth: 2})}`);
  }
  const at = err.EXTRA_CX;
  if (at && typeof at === "object") {
    lines.push(at.INTERNAL_FILENAME !== undefined
      ? `at: ${at.INTERNAL_FILENAME}:${at.INTERNAL_LINE}`
      : `at: ${inspect(at, {depth: 2})}`);
  }
  if (typeof err.stack === "string" && err.stack.length > 0) lines.push(...err.stack.split("\n"));
  if (lines.length === 0 && !err.message) lines.push(...inspect(err, {depth: 2}).split("\n"));
  return lines;
}

/** calls each hook that exists, every one of them even if an earlier throws */
async function each(hooks, phase, errors) {
  for (const hook of hooks) {
    if (typeof hook !== "function") continue;
    try {
      await hook();
    } catch (error) {
      errors.push({phase, error});
    }
  }
}

/**
 * Runs every entry; `load(filename)` returns the imported test module. Never
 * throws for a failing test: returns {ran, failed: [{name, errors, error}]}
 * (ran: the methods whose own phase was reached),
 * where `errors` are phase-labelled (import, class_setup, setup, method, teardown,
 * class_teardown) and `error` is the first of them, the original failure.
 *
 * Phases are kept apart: a setup failure skips the method but not the
 * teardown, a teardown failure does not stop the next teardown hook, and a
 * teardown failure never replaces the method's own.
 */
export async function runAll(entries, load, {mode, log = console.log} = {}) {
  const failed = [];
  let ran = 0;
  const fail = (name, errors, where) => {
    for (const {phase, error} of errors) {
      log(`${where} [${phase}]: ${describe(error)}`);
      for (const line of detail(error)) log(`    ${line}`);
    }
    failed.push({name, errors, error: errors[0].error});
  };
  for (const st of entries) {
    let localClass;
    const classErrors = [];
    try {
      localClass = (await load(st.filename))[st.localClass];
      if (typeof localClass !== "function") throw new Error(`no local class ${st.localClass} in ${st.filename}`);
    } catch (error) {
      classErrors.push({phase: "import", error});
    }
    if (classErrors.length === 0) await each([localClass.class_setup && (() => localClass.class_setup())], "class_setup", classErrors);
    if (classErrors.length > 0) {
      // one failure for the class, whatever its methods: a class of hooks
      // only has methods: [], and a loop over them would record nothing
      fail(`${st.objectName}: ${st.localClass}`, classErrors, `${st.objectName}: FAILED ${st.localClass}`);
      for (const m of st.methods) {
        log(`${st.objectName}: running ${st.localClass}->${m.name}, not run: the class failed`);
      }
      // what class_setup did before it failed is still cleaned up
      if (localClass) {
        const down = [];
        await each([localClass.class_teardown && (() => localClass.class_teardown())], "class_teardown", down);
        if (down.length > 0) fail(`${st.objectName}: ${st.localClass} class_teardown`, down, `${st.objectName}: FAILED ${st.localClass}`);
      }
      continue;
    }
    for (const m of st.methods) {
      const prefix = `${st.objectName}: running ${st.localClass}->${m.name}`;
      if (m.skip) {
        log(prefix + ", skipped due to configuration");
        continue;
      }
      if ((mode === "skip-critical" && st.riskLevel === "CRITICAL")
        || (mode === "only-critical" && st.riskLevel !== "CRITICAL")) {
        log(prefix + ", skipped due to risk level " + st.riskLevel);
        continue;
      }
      log(prefix);
      const errors = [];
      let test;
      try {
        test = await (new localClass()).constructor_();
      } catch (error) {
        errors.push({phase: "setup", error});
      }
      const own = test?.FRIENDS_ACCESS_INSTANCE;
      if (test) {
        // the setups in order, stopping at the first that fails: a later
        // setup may rely on an earlier one
        for (const hook of [test.setup && (() => test.setup()), own?.setup && (() => own.setup()),
          own?.SUPER?.setup && (() => own.SUPER.setup())]) {
          if (!hook) continue;
          try {
            await hook();
          } catch (error) {
            errors.push({phase: "setup", error});
            break;
          }
        }
        if (errors.length === 0) {
          // counted only when the method itself is reached
          ran++;
          try {
            await own[m.name]();
          } catch (error) {
            errors.push({phase: "method", error});
          }
        }
        await each([test.teardown && (() => test.teardown()), own?.teardown && (() => own.teardown()),
          own?.SUPER?.teardown && (() => own.SUPER.teardown())], "teardown", errors);
      }
      if (errors.length > 0) fail(`${st.objectName}: ${st.localClass}->${m.name}`, errors, `${st.objectName}: FAILED ${st.localClass}->${m.name}`);
    }
    const down = [];
    await each([localClass.class_teardown && (() => localClass.class_teardown())], "class_teardown", down);
    if (down.length > 0) fail(`${st.objectName}: ${st.localClass} class_teardown`, down, `${st.objectName}: FAILED ${st.localClass}`);
  }
  return {ran, failed};
}

if (process.argv[1] && resolve(process.argv[1]).endsWith(join("tools", "osd-unit-all.mjs"))) {
  const output = resolve("output");
  const entries = harnessEntries(readFileSync(join(output, "index.mjs"), "utf8"));
  const arg = process.argv[2];
  const mode = arg === "--skip-critical" ? "skip-critical" : arg === "--only-critical" ? "only-critical" : undefined;
  const {ran, failed} = await runAll(entries, (filename) => import(pathToFileURL(join(output, filename)).href), {mode});
  console.log(`\nunit: ${ran} test methods executed, ${failed.length} failed`);
  if (failed.length > 0) {
    console.log("unit: FAILED --");
    for (const f of failed) console.log(`  ${f.name}`);
    process.exit(1);
  }
  process.exit(0);
}
