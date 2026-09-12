// open-steamgate running in the browser.
//
// test/start.mjs wires the transpiled runtime into express: initializeABAP()
// opens the database (test/setup.mjs), registers the demo services and every
// request under /sap/opu/odata/sap/ goes through CL_EXPRESS_ICF_SHIM into
// ZCL_STG_HTTP_HANDLER. This module does the same with the service worker in
// the role of express and sql.js compiled to JavaScript in the role of the
// database file. The pattern is larshp/hithub's web/preview-backend.mjs (MIT).
import "./preview-runtime.mjs";
import {Buffer} from "buffer";
import {seed, buildId} from "./generated/seed.mjs";

// test/setup.mjs looks for this before it touches the file system: the seed
// rows come from the bundle, the database from cache storage (or fresh).
const preview = {seed, buildId, stored: undefined, db: undefined};
globalThis.__stgPreview = preview;

const {initializeABAP} = await import("../output/init.mjs");
const {cl_express_icf_shim} = await import("../output/cl_express_icf_shim.clas.mjs");
const {zcl_oao_registry} = await import("../output/zcl_oao_registry.clas.mjs");

// CL_EXPRESS_ICF_SHIM keeps request and response on one static server object;
// overlapping fetch events would answer each other's requests. Serialize.
let queue = Promise.resolve();

function serialized(work) {
  const result = queue.then(work, work);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

function toBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new TextEncoder().encode(String(value ?? ""));
}

async function registerServices() {
  const S = (v) => new abap.types.String().set(v);
  await zcl_oao_registry.register({iv_service: S("ZSTG_DEMO_SRV"), iv_mpc: S("ZCL_ZSTG_DEMO_MPC_EXT"), iv_dpc: S("ZCL_ZSTG_DEMO_DPC_EXT")});
  await zcl_oao_registry.register({iv_service: S("ZSTG_SADL_SRV"), iv_mpc: S("ZCL_ZSTG_SADL_MPC_EXT"), iv_dpc: S("ZCL_ZSTG_SADL_DPC_EXT")});
}

async function invoke({method, path, search = "", headers = {}, body}) {
  const responseHeaders = new Headers();
  let status = 200;
  let data = new Uint8Array(0);
  const res = {
    append(name, value) {
      responseHeaders.append(name, value);
    },
    status(code) {
      status = Number(code);
      return res;
    },
    send(payload) {
      data = toBytes(payload);
    },
  };
  await cl_express_icf_shim.run({
    req: {
      body: Buffer.from(body ?? new Uint8Array(0)),
      headers,
      method: String(method || "GET").toUpperCase(),
      path,
      url: `${path}${search}`,
    },
    res,
    class: "ZCL_STG_HTTP_HANDLER",
    base: new abap.types.String().set("/sap/opu/odata/sap"),
  });
  return {status, headers: responseHeaders, body: data};
}

export async function startBackend(stored) {
  preview.stored = stored;
  await initializeABAP();
  await registerServices();
}

export function handleRequest(request) {
  return serialized(() => invoke(request));
}

// Back to the seeded state: the transpiled runtime is kept, only the database
// is rebuilt through the same setup that opened it.
export function resetBackend() {
  return serialized(async () => {
    preview.stored = undefined;
    const setup = await import("../test/setup.mjs");
    await setup.setup(globalThis.abap, preview.schemas, preview.insert);
  });
}

export function exportDatabase() {
  return serialized(() => preview.db.export());
}

export {buildId};
