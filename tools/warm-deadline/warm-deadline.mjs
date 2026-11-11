// How long the front lets the warm compiler work before it calls it silent,
// kills it and builds cold. See README.md beside this file.
import {createHash} from "node:crypto";

// A save, a check, an update: one object and its readers. Measured at
// ~0.5 s on a workstation; 30 s has been the bound since warm compile began.
export const OPERATION_MS = 30000;
// The full prime is a whole-tree transpile, and it costs per input file:
// 37.8 s for 6924 input files (5.5 ms each) on the reference machine
// (README.md). Three times that, so a hung compiler is still caught.
export const PRIME_MS_PER_FILE = 16;
// Never below the bound every host had before the prime was sized, never
// above what a person would still wait for before a save goes cold.
export const PRIME_FLOOR_MS = 30000;
export const CEILING_MS = 15 * 60000;
// The calibration below takes this long, as the best of three rounds, on the
// machine PRIME_MS_PER_FILE was measured on. A runner that needs longer for
// the same work is that much slower, and so is its prime.
export const REFERENCE_CALIBRATION_MS = 60;
export const FACTOR_FLOOR = 1;
export const FACTOR_CEILING = 8;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const positive = value => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

// A fixed single-threaded workload of the kind a prime is made of: strings
// built and split, small objects allocated, JSON and a hash. It reads the
// speed the host gives this process now, contention included, which is what
// the prime will get. Best of three rounds, so a GC pause or the JIT warming
// up does not count as a slow machine.
export function calibrate(rounds = 3) {
  let best = Infinity;
  let sink = 0;
  for (let r = 0; r < rounds; r++) {
    const started = performance.now();
    for (let k = 0; k < 10; k++) {
      const parts = [];
      for (let i = 0; i < 2000; i++) parts.push(`DATA lv_${i} TYPE i VALUE ${i * 7 + k}.`);
      const text = parts.join("\n");
      const tokens = text.split(/\s+/).map((s, i) => ({s, i, u: s.toUpperCase()}));
      sink += JSON.parse(JSON.stringify(tokens)).length + createHash("sha1").update(text).digest()[0];
    }
    best = Math.min(best, performance.now() - started);
  }
  if (sink < 0) throw new Error("unreachable");
  return best;
}

let measured;
// The runner-speed factor: 1 on a machine like the reference or faster,
// above 1 on a slower one, clamped to [FACTOR_FLOOR, FACTOR_CEILING].
// OSD_WARM_SPEED_FACTOR sets it outright (a CI job that knows its runner).
export function speed(env = process.env, measure = calibrate) {
  const forced = positive(env.OSD_WARM_SPEED_FACTOR);
  if (forced !== undefined) return {factor: clamp(forced, FACTOR_FLOOR, FACTOR_CEILING), source: "OSD_WARM_SPEED_FACTOR"};
  if (measure === calibrate && measured !== undefined) return measured;
  const ms = measure();
  const result = {factor: clamp(ms / REFERENCE_CALIBRATION_MS, FACTOR_FLOOR, FACTOR_CEILING), source: "calibration", calibrationMs: ms};
  if (measure === calibrate) measured = result;
  return result;
}

// A test harness that waits for a host to start and prime scales its own
// timeouts by the same factor, so the warm deadline is never the longer wait.
export function scaled(ms, env = process.env) {
  return Math.round(ms * speed(env).factor);
}

// The deadline for one warm operation. `kind` is "prime" (sized by `files`)
// or anything else (one save). An explicit store.warmDeadlineMs wins for
// every kind (tests that want a hang caught fast), then the environment:
// OSD_WARM_PRIME_DEADLINE_MS for the prime, OSD_WARM_DEADLINE_MS for the
// rest. Otherwise the default times the speed factor, within the bounds.
export function warmDeadline({kind, files = 0, store = {}, env = process.env, measure = calibrate} = {}) {
  const explicit = positive(store.warmDeadlineMs);
  if (explicit !== undefined) return {ms: explicit, source: "store.warmDeadlineMs"};
  const fixed = positive(kind === "prime" ? env.OSD_WARM_PRIME_DEADLINE_MS : env.OSD_WARM_DEADLINE_MS);
  if (fixed !== undefined) return {ms: fixed, source: kind === "prime" ? "OSD_WARM_PRIME_DEADLINE_MS" : "OSD_WARM_DEADLINE_MS"};
  const s = speed(env, measure);
  const base = kind === "prime" ? Math.max(PRIME_FLOOR_MS, files * PRIME_MS_PER_FILE) : OPERATION_MS;
  return {ms: Math.round(clamp(base * s.factor, kind === "prime" ? PRIME_FLOOR_MS : OPERATION_MS, CEILING_MS)),
    source: s.source, factor: s.factor, calibrationMs: s.calibrationMs, base};
}

export function describe(d) {
  if (d.factor === undefined) return `${d.ms} ms (${d.source})`;
  const cal = d.calibrationMs === undefined ? "" : `, calibration ${d.calibrationMs.toFixed(1)} ms against ${REFERENCE_CALIBRATION_MS}`;
  return `${d.ms} ms (base ${d.base} ms x speed factor ${d.factor.toFixed(2)} from ${d.source}${cal})`;
}
