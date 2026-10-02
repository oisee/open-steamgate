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

/** the entries of the generated harness's getData(), from its source */
export function harnessEntries(source) {
  const match = /function getData\(\) \{[\s\S]*?\n  return ret;\n\}/.exec(source);
  if (!match) throw new Error("osd-unit-all: no getData() in the generated harness; its shape changed");
  return new Function(`${match[0]}\nreturn getData();`)();
}

function describe(err) {
  if (err === undefined || err === null) return String(err);
  const name = err.constructor?.name ?? typeof err;
  const message = err.message ?? (typeof err === "string" ? err : "");
  return message ? `${name}: ${message}` : name;
}

/**
 * Runs every entry; `load(filename)` returns the imported test module. Never
 * throws for a failing test: returns {ran, failed: [{name, error}]}.
 */
export async function runAll(entries, load, {mode, log = console.log} = {}) {
  const failed = [];
  let ran = 0;
  for (const st of entries) {
    let localClass;
    try {
      localClass = (await load(st.filename))[st.localClass];
      if (localClass.class_setup) await localClass.class_setup();
    } catch (err) {
      for (const m of st.methods) {
        const name = `${st.objectName}: ${st.localClass}->${m.name}`;
        log(`${st.objectName}: running ${st.localClass}->${m.name}`);
        log(`${st.objectName}: FAILED ${st.localClass}->${m.name} in class_setup: ${describe(err)}`);
        failed.push({name, error: err});
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
      ran++;
      try {
        const test = await (new localClass()).constructor_();
        const own = test.FRIENDS_ACCESS_INSTANCE;
        if (test.setup) await test.setup();
        if (own.setup) await own.setup();
        if (own.SUPER && own.SUPER.setup) await own.SUPER.setup();
        log(prefix);
        try {
          await own[m.name]();
        } finally {
          if (test.teardown) await test.teardown();
          if (own.teardown) await own.teardown();
          if (own.SUPER && own.SUPER.teardown) await own.SUPER.teardown();
        }
      } catch (err) {
        log(`${st.objectName}: FAILED ${st.localClass}->${m.name}: ${describe(err)}`);
        failed.push({name: `${st.objectName}: ${st.localClass}->${m.name}`, error: err});
      }
    }
    try {
      if (localClass.class_teardown) await localClass.class_teardown();
    } catch (err) {
      log(`${st.objectName}: FAILED ${st.localClass} class_teardown: ${describe(err)}`);
      failed.push({name: `${st.objectName}: ${st.localClass} class_teardown`, error: err});
    }
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
