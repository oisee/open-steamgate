// Demo data at start, for every host that runs the ABAP.
//
// The rows are made by ZCL_OSD_DEMO_DATA (src/demo_data/), in ABAP, so the
// same class makes the same rows transpiled on Node, in the browser preview,
// compiled to Go in OSGo and on a system. This module decides nothing about
// them: it hands the class the host's knob, runs the call as one dialog step
// (committed when it returns, rolled back if it dumps) and reports what the
// class answered. Written once for test/start.mjs, tools/osd-serve.mjs (and
// so the binary's `osd serve` / `osd up`) and web/preview-backend.mjs; OSGo
// passes the same variable to the same method in go/cmd/osgo (tools/gogen).
//
//   OSD_DEMO_ROWS unset   the class's default size (C_DEFAULT_ROWS, 20000)
//   OSD_DEMO_ROWS=0       no synthetic rows (and any present are removed)
//   OSD_DEMO_ROWS=n       n synthetic rows, at most C_MAX_ROWS
//
// Synthetic rows are FACT_ID 9000000001 and up; real and sample rows are
// never touched. A second start with the same size writes nothing.
import {dialogStep} from "./osd-dialog-step.mjs";

export const KNOB = "OSD_DEMO_ROWS";

/** runs ZCL_OSD_DEMO_DATA=>BOOT; `klass` is the transpiled class as the
 *  host imported it (each host loads its modules from its own place).
 *  Never throws: demo data that could not be made is reported, and the
 *  host serves without it. */
export async function ensureDemoData(klass, {env = globalThis.process?.env ?? {}, say = console.log} = {}) {
  const config = String(env?.[KNOB] ?? "").trim();
  const started = performance.now();
  try {
    const report = await dialogStep(() => klass.boot({iv_config: config}));
    const ms = Math.round(performance.now() - started);
    const text = typeof report?.get === "function" ? report.get() : String(report);
    say?.(`demo data: ${text} (${ms} ms)`);
    return {report: text, ms};
  } catch (e) {
    say?.(`demo data: ZCL_OSD_DEMO_DATA=>BOOT failed, serving without it: ${e?.message ?? e}`);
    return undefined;
  }
}
