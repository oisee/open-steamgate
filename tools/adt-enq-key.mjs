// One ENQ key format for Node owners and the ABAP session kernel.
// Web Crypto is available in both Node and the preview service worker.
export function adtEnqPrefix() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return `adt:${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}:`;
}
export const adtEnqKey = (prefix, id) => `${prefix}${id}`;
