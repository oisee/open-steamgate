// Module hook: test/start.mjs becomes start-stub.mjs, so a suite that calls
// startServer() talks to the server the parity harness started instead of
// loading the transpiled ABAP into its own process.
const stub = new URL("./start-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url.endsWith("/test/start.mjs")) return {url: stub, shortCircuit: true};
  return r;
}
