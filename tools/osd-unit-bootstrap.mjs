// Unit runs need the same kernel hooks as a serving process. Node runs this
// preload before the transpiler's generated index.mjs test harness.
const {initializeABAP} = await import("../output/init.mjs");
await initializeABAP();
