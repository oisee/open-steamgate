// Temporary B3 bridge: remove operations as A3a/A4/A5 remove Node callers.
// The serving child's FIFO owns the check AND the parent callback. Parent
// callback failures reject the step; IPC disconnect rejects pending work.
import {AbapSessions} from "./adt-abap-sessions.mjs";
import {sessionJSON, sessionValue} from "./adt-remote-sessions.mjs";
import {dialogStep} from "./osd-dialog-step.mjs";
import {withStoreIPC} from "./osd-store-ipc.mjs";

const ARITY = {get: 1, logoff: 1, holderOf: 2, holds: 4, lock: 3,
  unlock: 2, release: 2, whileHeld: 4, deleteObject: 3};
export function sessionsDoor(identity) {
  return async (req, res) => {
    const address = req.socket.remoteAddress ?? "";
    if (address !== "::1" && !/^127\./.test(address) && !/^::ffff:127\./.test(address)) {
      return res.status(403).json({error: {code: "LOCAL_ONLY"}});
    }
    let input;
    try {
      input = JSON.parse(req.body.toString("utf8"));
      if (!Object.hasOwn(ARITY, input.method) || !Array.isArray(input.args)
        || input.args.length !== ARITY[input.method]) throw new Error("invalid session operation or args");
    } catch (error) {
      return res.status(400).json({error: {message: error.message}});
    }
    try {
      const adt = identity().adt;
      const sessions = new AbapSessions({identity: {systemID: adt.systemID,
        client: adt.client, ...input.identity}});
      const value = await withStoreIPC(input.context, () => dialogStep(async () => {
        const args = sessionValue(input.args);
        if (input.method === "logoff") {
          const a = globalThis.abap;
          return a.Classes.ZCL_OSD_ADT_LOGOFF.end_session({
            iv_id: new a.types.String().set(args[0]),
            io_session: await sessions.sessionFor({headers: {}}),
          });
        }
        const callback = parameters => globalThis.abap.context.RFCDestinations.STORE
          .request(parameters, "OSD_SESSION_CALLBACK");
        if (input.method === "whileHeld") return sessions.whileHeld(...args, () => callback({action: "work"}));
        if (input.method === "deleteObject") return sessions.deleteObject(...args, {
          find: (type, name) => callback({action: "find", type, name}),
          delete: (type, name) => callback({action: "delete", type, name}),
        });
        return sessions[input.method](...args);
      }, "ADT session compatibility"));
      return res.json({value: sessionJSON(value ?? null)});
    } catch (error) {
      if (process.connected) process.send({type: "store-context-ended", context: input.context});
      return res.status(500).json({error: {message: String(error.message ?? error)}});
    }
  };
}
