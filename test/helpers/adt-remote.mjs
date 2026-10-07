import {copyRuntimeRoot} from "./runtime-root.mjs";
import {rmSync} from "node:fs";
import {ServingRuntime} from "../../tools/osd-runtime.mjs";
import {StoreDestination} from "../../tools/osd-store-destination.mjs";
export async function remoteForTest() {
  const root = copyRuntimeRoot();
  const runtime = new ServingRuntime({root,
    env: {OSD_ADT_ONE_RUNTIME: "1", STG_DB: "sqlite", STG_DB_PATH: "", STG_TLS: "0"}});
  runtime.storeDestination = new StoreDestination();
  const stop = runtime.stop.bind(runtime);
  runtime.stop = async (...args) => { try { return await stop(...args); } finally { rmSync(root, {recursive: true, force: true}); } };
  try { await runtime.start(); } catch (error) { await runtime.stop(); throw error; }
  return runtime;
}
