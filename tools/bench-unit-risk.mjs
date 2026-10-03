// Sparse executable chain: each class constructs and calls the next class.
// Parse outside the timer; measure a fresh graph + closure, median of five.
// Optional argv[2] selects an older UnitRisk module for an identical workload.
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {Registry, MemoryFile} from "@abaplint/core";
const {UnitRisk} = await import(process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : "./osd-unit-risk.mjs");

for (const count of (process.env.OSD_RISK_BENCH_SIZES ?? "100,200,400,1000").split(",").map(Number)) {
  const registry = new Registry();
  registry.addFile(new MemoryFile("zcl_test.clas.abap", "CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS."));
  registry.addFile(new MemoryFile("zcl_test.clas.testclasses.abap", `CLASS ltcl_test DEFINITION FOR TESTING RISK LEVEL HARMLESS.
    PRIVATE SECTION. METHODS run FOR TESTING. ENDCLASS. CLASS ltcl_test IMPLEMENTATION.
    METHOD run. DATA(lo) = NEW zcl_step_0( ). lo->run( ). ENDMETHOD. ENDCLASS.`));
  for (let i = 0; i < count; i++) registry.addFile(new MemoryFile(`zcl_step_${i}.clas.abap`, `CLASS zcl_step_${i} DEFINITION PUBLIC.
    PUBLIC SECTION. METHODS run. ENDCLASS. CLASS zcl_step_${i} IMPLEMENTATION. METHOD run.
    ${i === count - 1 ? "COMMIT WORK." : `DATA lo TYPE REF TO zcl_step_${i + 1}. CREATE OBJECT lo. lo->run( ).`}
    ENDMETHOD. ENDCLASS.`));
  registry.parse();
  const samples = [];
  let result;
  for (let repeat = 0; repeat < 5; repeat++) {
    const risk = new UnitRisk({registry: () => registry});
    const begin = performance.now();
    result = await risk.writesReached("ZCL_TEST");
    samples.push(performance.now() - begin);
    assert.equal(result.total, 1);
    assert.equal(result.dynamicCallsTotal, 0);
    assert.equal(result.reached, count + 1);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({classes: count, reached: result.reached, writes: result.total,
    medianSeconds: +(samples[2] / 1000).toFixed(4), samplesMs: samples.map((n) => +n.toFixed(2))}));
}
