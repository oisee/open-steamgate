// Compatibility for Node routes that still use sessions during the ABAP port.
// All authoritative reads and changes run in the primary's dialog FIFO.
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
  async call(method, args) {
    await this.runtime.ensure();
    const response = await fetch(`${this.runtime.url}/osd/adt-step`, {
      method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({view: {sessionCall: method, args: sessionJSON(args)}, identity: this.identity}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "ADT session call failed");
    return sessionValue(result.value ?? null);
  }
  get(id) { return this.call("get", [id]); }
  end(id) { return this.call("end", [id]); }
  holderOf(type, name) { return this.call("holderOf", [type, name]); }
  holds(session, handle, type, name) { return this.call("holds", [session, handle, type, name]); }
  lock(session, type, name) { return this.call("lock", [session, type, name]); }
  unlock(session, handle) { return this.call("unlock", [session, handle]); }
  release(type, name) { return this.call("release", [type, name]); }
}
