// Compatibility for Node routes that still use sessions during the ABAP port.
// All authoritative reads and changes run in the primary's dialog FIFO.
import {remoteStep, stepJSON} from "./adt-remote-step.mjs";
import {AbapSessions} from "./adt-abap-sessions.mjs";

export const sessionJSON = (value) => JSON.parse(JSON.stringify(value, (_key, item) =>
  item instanceof Map ? {adtLocks: [...item]} : item));
export const sessionValue = (value) => JSON.parse(JSON.stringify(value), (_key, item) =>
  item?.adtLocks !== undefined ? new Map(item.adtLocks) : item);

export class RemoteSessions extends AbapSessions {
  constructor(runtime, options) {
    super(options);
    this.runtime = runtime.primary ?? runtime;
  }
  async call(method, args, callback) {
    const context = (this.runtime.adtContextSeq = (this.runtime.adtContextSeq ?? 0) + 1);
    this.runtime.adtContexts ??= new Map();
    this.runtime.adtContexts.set(context, {callback});
    try {
      const response = await remoteStep(this.runtime,
        {view: {sessionCall: method, args: sessionJSON(args)}, identity: this.identity, context});
      const result = await stepJSON(response);
      if (!response.ok) throw new Error(result.error?.message ?? "ADT session call failed");
      return result.value === null ? undefined : sessionValue(result.value);
    } finally { this.runtime.adtContexts.delete(context); }
  }
  get(id) { return this.call("get", [id]); }
  end(id) { return this.call("end", [id]); }
  holderOf(type, name) { return this.call("holderOf", [type, name]); }
  holds(session, handle, type, name) { return this.call("holds", [session, handle, type, name]); }
  lock(session, type, name) { return this.call("lock", [session, type, name]); }
  unlock(session, handle) { return this.call("unlock", [session, handle]); }
  whileHeld(session, handle, type, name, work) {
    return this.call("whileHeld", [session, handle, type, name], async () => { await work(); return {}; });
  }
  deleteObject(session, type, name, store) {
    return this.call("deleteObject", [session, type, name], ({action, type, name}) =>
      action === "find" ? store.find(type, name) ?? null : store.delete(type, name));
  }
  release(type, name) { return this.call("release", [type, name]); }
}
