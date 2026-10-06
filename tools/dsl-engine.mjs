// Render tools consume a built generation. They do not start a source host:
// its cold build could replace the generation of an already serving system
// when this command does not inherit that system's pack selection.
let boot;
export async function builtEngine() {
  if (boot) return boot;
  if (globalThis.abap?.context?.databaseConnections?.DEFAULT) return globalThis.abap;
  boot ??= (async () => {
    const {initializeABAP} = await import("../output/init.mjs");
    await initializeABAP();
    return globalThis.abap;
  })();
  return boot;
}
