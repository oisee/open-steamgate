// Narrow runner for the same generated ABAP Unit class npm unit runs.
// Its identity fixture is local to setup/teardown; parity uses the real seam.
import {fileURLToPath} from "node:url";
export const identity = {systemID: "OSD", client: "001", userName: "OSD", userFullName: "Session test", language: "EN"};
export async function runSessionUnit(only) {
  const {initializeABAP} = await import("../../output/init.mjs");
  await initializeABAP();
  const {ltcl_session: Class} = await import("../../output/zcl_osd_adt_session.clas.testclasses.mjs");
  const methods = Object.keys(Class.METHODS).map((n) => n.toLowerCase()).filter((n) => !["setup", "teardown", "by_cookie"].includes(n));
  let ran = 0;
  for (const method of methods.filter((n) => only === undefined || n === only)) {
    const test = await new Class().constructor_();
    const access = test.FRIENDS_ACCESS_INSTANCE;
    try {
      await access.setup();
      await access[method]();
      console.log(`ZCL_OSD_ADT_SESSION: running ltcl_session->${method}: passed`);
      ran++;
    } finally {
      await access.teardown();
    }
  }
  if (ran === 0) throw new Error("no session ABAP Unit method ran");
  console.log(`ABAP Unit: ${ran} passed`);
  return ran;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await runSessionUnit(process.argv[2]);
