// One owner for Node sessions and the ABAP kernel in this host instance.
const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
const prefix = `adt:${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}:`;
export const adtEnqOwner = Object.freeze({
  prefix,
  key(id) { return `${prefix}${this.idOf(id)}`; },
  idOf(key) { return this.owns(key) ? key.slice(prefix.length) : key; },
  owns(key) { return typeof key === "string" && key.startsWith(prefix); },
});
