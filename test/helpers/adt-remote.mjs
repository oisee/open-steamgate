import {ServingRuntime} from "../../tools/osd-runtime.mjs";
import {StoreDestination} from "../../tools/osd-store-destination.mjs";
export async function remoteForTest() {
  const runtime = new ServingRuntime({root: process.cwd(),
    env: {OSD_ADT_ONE_RUNTIME: "1", STG_DB: "sqlite", STG_DB_PATH: "", STG_TLS: "0"}});
  runtime.storeDestination = new StoreDestination();
  await runtime.start();
  return runtime;
}
