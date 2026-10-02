// Two independent ABAP sessions share one file DB; the parent releases both
// before either enters its pile LUW.
import "../../output/init.mjs";
import {dialogStep} from "../../tools/osd-dialog-step.mjs";
const abap = globalThis.abap;
process.send({ready: true});
await new Promise((resolve) => process.once("message", resolve));
try {
  const result = await dialogStep(() => abap.Classes.ZCL_L3_FLEET2.run_rule({
    iv_run: new abap.types.String().set(process.env.GOVERNOR_RUN),
    iv_rule: new abap.types.String().set("ship-min-crew"),
    iv_date: new abap.types.Date().set("20261001"),
    iv_pile: new abap.types.Integer().set(Number(process.env.GOVERNOR_PILE)),
  }));
  process.send({status: result.get().status.get().trim()});
} catch (e) { process.send({error: String(e?.message ?? e)}); process.exitCode = 1; }
await abap.context.databaseConnections.DEFAULT.disconnect();
process.disconnect();
