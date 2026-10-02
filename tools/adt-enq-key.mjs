// One owner for Node sessions and the ABAP kernel in this host instance.
// One prefix per host, so every ADT session in this host is "ours": Node's
// Sessions and ZCL_OSD_ADT_SESSION must never own sessions side by side in
// one host, or each ends the other's live holders as dead. The Node adapter
// over ZCL_OSD_ADT_SESSION replaces Node's sessions; it never runs beside them.
const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
const prefix = `adt:${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}:`;
export const adtEnqOwner = Object.freeze({
  prefix,
  key(id) { return `${prefix}${this.idOf(id)}`; },
  idOf(key) { return this.owns(key) ? key.slice(prefix.length) : key; },
  owns(key) { return typeof key === "string" && key.startsWith(prefix); },
});
