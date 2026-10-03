// Compatibility for Node routes that still use sessions during the ABAP port.
// All authoritative reads and changes run in the primary's dialog FIFO.
import {remoteStep, stepJSON} from "./adt-remote-step.mjs";
import {AbapSessions} from "./adt-abap-sessions.mjs";

// Parent callbacks hold the child's FIFO. RESUME must refuse re-entry before
// sending another child step. Keep Node's async context out of the preview.
let heldWork;
if (typeof process !== "undefined" && process.versions?.node !== undefined) {
  const {AsyncLocalStorage} = await import(/* webpackIgnore: true */ "node:async_hooks");
  heldWork = new AsyncLocalStorage();
}
export const inRemoteWhileHeld = () => heldWork?.getStore() === true;

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
        {method, args: sessionJSON(args), identity: this.identity, context}, "/osd/adt-sessions");
      const result = await stepJSON(response);
      if (!response.ok) throw new Error(result.error?.message ?? "ADT session call failed");
      return result.value === null ? undefined : sessionValue(result.value);
    } finally { this.runtime.adtContexts.delete(context); }
  }
  get(id) { return this.call("get", [id]); }
  // Compatibility callers still terminate sessions. A3a owns the grammar;
  // send logoff to its ABAP owner in the serving child, never parent END.
  end(id) { return this.call("logoff", [id]); }
  holderOf(type, name) { return this.call("holderOf", [type, name]); }
  holds(session, handle, type, name) { return this.call("holds", [session, handle, type, name]); }
  lock(session, type, name) { return this.call("lock", [session, type, name]); }
  unlock(session, handle) { return this.call("unlock", [session, handle]); }
  whileHeld(session, handle, type, name, work) {
    return this.call("whileHeld", [session, handle, type, name], async () => {
      await heldWork.run(true, work);
      return {};
    });
  }
  async deleteObject(session, type, name, store) {
    let deleted = false;
    try {
      return await this.call("deleteObject", [session, type, name], async ({action, type, name}) => {
        if (action === "find") return store.find(type, name) ?? null;
        const gone = await store.delete(type, name);
        deleted = true;
        return gone;
      });
    } catch (error) {
      // The filesystem delete survives a child-step rollback. Release in
      // a fresh step, after call() has removed the failed callback context.
      if (deleted) await this.release(type, name).catch(() => undefined);
      throw error;
    }
  }
  release(type, name) { return this.call("release", [type, name]); }
}
