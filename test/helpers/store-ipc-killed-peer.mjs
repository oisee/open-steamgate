import {fork} from "node:child_process";
import {once} from "node:events";
import {fileURLToPath} from "node:url";
import {attachStoreIPC, StoreIPCClient} from "../../tools/osd-store-ipc.mjs";
import {StoreDestination} from "../../tools/osd-store-destination.mjs";
import {ActivationJournal} from "../../tools/osd-activation-journal.mjs";

const [role, root] = process.argv.slice(2);
if (role === "peer") {
  const client = new StoreIPCClient();
  if (process.env.IPC_SURVIVOR === "1") {
    const values = await client.request({IV_COMMAND: "ACTIVATION_STATUS", IV_JSON: JSON.stringify({op_id: process.env.IPC_OPERATION})});
    process.send({type: "checked", values});
    client.close();
    process.disconnect();
  } else {
    process.send({type: "store-request", id: 1, step: 1,
      parameters: {IV_COMMAND: "ACTIVATE", IV_TYPE: "CLAS", IV_NAME: "ZKILLED"}});
    setInterval(() => {}, 1000);
  }
} else {
  const journal = new ActivationJournal(root);
  const store = {root, activationJournal: journal, activate: () => ({active: true, issues: []})};
  const destination = new StoreDestination({store});
  const script = fileURLToPath(import.meta.url);
  const child = fork(script, ["peer", root], {stdio: ["ignore", "ignore", "inherit", "ipc"]});
  let sendError, operation;
  const nativeSend = child.send.bind(child);
  // Observe callbacks without installing an error listener: without the fix,
  // the parent's unhandled ChildProcess error must still terminate it.
  child.send = (message, callback) => nativeSend(message, callback && (error => {
    if (error) sendError = error.code;
    callback(error);
  }));
  attachStoreIPC(child, {storeDestination: {execute: async parameters => {
    const values = await destination.execute(parameters);
    operation = JSON.parse(values.EV_JSON).op_id;
    child.kill("SIGKILL");
    // A slow synchronous destination keeps disconnect/exit from being
    // delivered while the OS closes the pipe. connected is still true.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    if (!child.connected) throw new Error("test did not reach the connected race");
    return values;
  }}});
  await once(child, "exit");
  await new Promise(resolve => setImmediate(resolve));
  const survivor = fork(script, ["peer", root], {stdio: ["ignore", "ignore", "inherit", "ipc"],
    env: {...process.env, IPC_SURVIVOR: "1", IPC_OPERATION: operation}});
  attachStoreIPC(survivor, {storeDestination: destination});
  const checked = new Promise(resolve => survivor.on("message", message => {
    if (message.type === "checked") resolve(JSON.parse(message.values.EV_JSON));
  }));
  const exited = once(survivor, "exit");
  const status = await checked;
  await exited;
  console.log(JSON.stringify({sendError, status, survived: true}));
}
