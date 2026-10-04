// Opt-in progress goes to stderr, leaving the folder runner's JSON intact.
const started = performance.now();
export const timingMs = {};
export function trace(phase, event = "start", ms) {
  if (globalThis.process?.env?.OSGJS_TRACE !== "1") return;
  const {rss, heapUsed} = process.memoryUsage();
  console.error(JSON.stringify({phase, event, elapsedMs: Math.round(performance.now() - started),
    ...(ms === undefined ? {} : {ms: Math.round(ms)}), rssMiB: Math.round(rss / 1048576), heapMiB: Math.round(heapUsed / 1048576)}));
}
export async function phase(name, action) {
  const start = performance.now();
  trace(name);
  try { return await action(); }
  finally {
    const ms = Math.round(performance.now() - start);
    timingMs[name] = (timingMs[name] ?? 0) + ms;
    trace(name, "end", ms);
  }
}
