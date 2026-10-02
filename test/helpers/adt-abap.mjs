// The ABAP front for a test's own adtRouter, the way test/start.mjs mounts
// it inline (tools/adt-abap-front.mjs): on, unless OSD_ADT=js. A suite that
// passes this as `abap` runs its route-level cases against the routes ABAP
// serves (ADR 0007), with the rest still answered by the Node façade.
import {dialogStep} from "../../tools/osd-dialog-step.mjs";
import {abapRunner} from "../../tools/adt-abap-front.mjs";

const output = (file) => import(new URL(`../../output/${file}`, import.meta.url).href);

export async function adtAbap() {
  if (process.env.OSD_ADT === "js") {
    return undefined;
  }
  // the canonical inline boot, once per process: the ABAP runtime, the
  // database and the destinations the routes call
  await import("../start.mjs");
  const {cl_express_icf_shim: shim} = await output("cl_express_icf_shim.clas.mjs");
  const {zcl_osd_adt_router: router} = await output("zcl_osd_adt_router.clas.mjs");
  return abapRunner({shim, router, step: dialogStep});
}
