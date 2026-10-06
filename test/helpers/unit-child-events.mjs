// Real IPC and close events, with no ABAP boot needed to force their ordering.
import {fileURLToPath} from "node:url";
import {UnitRun} from "../../tools/osd-unit.mjs";

const mode = process.env.UNIT_EVENT_CASE;
if (process.argv[2] === "unit") {
  process.stdin.resume();
  process.on("disconnect", () => process.exit(0));
  if (mode === "message") {
    process.send(null);
  } else {
    process.send({kind: "unit-method-start", testClass: "LTCL_EVENTS", method: "RUN"}, () => {
      if (mode === "reconstruct") {
        for (;;) {} // parent watchdog must kill a synchronous loop
      } else {
        console.log(JSON.stringify({ok: true, marker: "child-result"}));
      }
    });
  }
  setInterval(() => {}, 1000);
} else {
  process.env.OSD_SELF = JSON.stringify([process.execPath, fileURLToPath(import.meta.url)]);
  const plan = {object: {name: "ZCL_EVENTS", type: "CLAS"}, classes: [{name: "LTCL_EVENTS", testMethods: null}]};
  const controller = new AbortController();
  const timer = mode === "cancel" ? setTimeout(() => controller.abort(), 500) : undefined;
  try {
    const result = await new UnitRun({root: process.cwd()}).runDetached("CLAS", "ZCL_EVENTS",
      {plan, timeout: mode === "cancel" ? 0 : 30, signal: controller.signal});
    console.log(JSON.stringify({result}));
  } catch (error) {
    console.log(JSON.stringify({error: error.message}));
  } finally { clearTimeout(timer); }
}
