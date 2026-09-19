// Where the demo's time goes, scene by scene (backlog E.7).
//
// The recorder (tools/o4d-record.mjs) asks for every tick at once and cares
// only about what came back; this asks for one tick, waits for the frame,
// and asks for the next, so the wall clock between the two is one frame's
// work and nothing else queued behind it. That number is the whole point:
// the demo runs at a fixed frame rate and a scene that cannot answer inside
// a tick is a scene the page waits for.
//
// A frame says how much it drew — `rc` rectangles, `lc` lines, `tric`
// triangles, `cc` circles, `ic` images, `tc` texts — so the table carries
// both the raw milliseconds and the milliseconds per thousand primitives.
// The two separate "slow because it draws six hundred rectangles" from
// "slow because its arithmetic is heavy", which are different repairs: the
// first is the channel and the JSON, the second is the runtime.
//
//   node tools/o4d-profile.mjs http://127.0.0.1:3090 --ticks 60
//   node tools/o4d-profile.mjs --scene plasma --ticks 200
//   node tools/o4d-profile.mjs --scene sdf_blobs --ticks 200 --same
//   node tools/o4d-profile.mjs --ticks 60 --json .local/try/profile.json
//
// Nothing here is committed: a run's JSON belongs under .local/ like any
// other capture (CLAUDE.md).
import {writeFileSync} from "node:fs";
import {sceneStart} from "./o4d-record.mjs";
import {runsAs} from "./osd-main.mjs";

const CHANNEL = "/sap/bc/apc/sap/zo4d_demo";
const COUNTS = {rect: "rc", line: "lc", tri: "tric", circle: "cc", image: "ic", text: "tc"};

/** the channel, opened and told which demo to draw; the scenario comes back */
async function connect(base, demo) {
  const socket = new WebSocket(base.replace(/^http/, "ws").replace(/\/$/, "") + CHANNEL);
  let scenarioKnown;
  const scenario = new Promise((r) => { scenarioKnown = r; });
  // one frame at a time: whoever asked last is waiting, so a frame is the
  // answer to the outstanding question and there is never more than one
  let waiting;
  socket.addEventListener("message", (e) => {
    // the clock is read before the frame is parsed, because parsing ten
    // thousand rectangles is this tool's work and not the server's: a
    // measurement that charges the client's JSON.parse to the scene makes
    // the scenes that draw most look slower than they are
    const arrived = performance.now();
    let message;
    try {
      message = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (message.type === "scenario") {
      scenarioKnown(message);
      return;
    }
    if (message.type !== undefined) {
      return;
    }
    if (message.t !== undefined && waiting !== undefined) {
      const answer = waiting;
      waiting = undefined;
      answer({message, arrived, bytes: String(e.data).length, parsed: performance.now()});
    }
  });
  await new Promise((ok, no) => {
    socket.addEventListener("open", ok);
    socket.addEventListener("error", () => no(new Error(`the demo channel did not open: ${base}${CHANNEL}`)));
    setTimeout(() => no(new Error("the demo channel did not open within 20 s")), 20000);
  });
  socket.send(JSON.stringify({cmd: "get_scenario"}));
  socket.send(JSON.stringify({cmd: "load_demo", demo}));
  socket.send("start");
  const announced = await Promise.race([scenario,
    new Promise((_, no) => setTimeout(() => no(new Error("no scenario announced within 20 s")), 20000))]);
  /** one tick asked for, one frame waited for, the wall clock between them */
  const frame = (tick, timeout = 60000) => new Promise((ok, no) => {
    const began = performance.now();
    const timer = setTimeout(() => no(new Error(`no frame for tick ${tick} within ${timeout} ms`)), timeout);
    waiting = ({message, arrived, bytes, parsed}) => {
      clearTimeout(timer);
      ok({ms: arrived - began, parseMs: parsed - arrived, bytes, frame: message});
    };
    socket.send(JSON.stringify({cmd: "frame", tick, sub: 0}));
  });
  return {socket, scenario: announced, frame};
}

const median = (sorted) => sorted.length === 0 ? 0
  : sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
const quantile = (sorted, q) => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const mean = (xs) => xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/** the scenes of a scenario, each once, in the order they are first played */
export function scenesOf(scenario) {
  const seen = new Map();
  for (const scene of scenario.scenes ?? []) {
    if (seen.has(scene.id) === false) {
      seen.set(scene.id, {id: scene.id, name: scene.name, start: sceneStart(scenario, scene.id)});
    }
  }
  return [...seen.values()];
}

/** one scene: N ticks from its first, one at a time.
 *
 * `same` asks for the same tick every time instead of walking forward. A
 * scene is not one workload — four bars of sdf_blobs draw a different
 * number of blobs at the end than at the start — so a warm-up question,
 * which asks whether the hundredth answer to a question is faster than the
 * first, can only be asked of one question.
 *
 * Which scene a tick belongs to is the demo's answer, not this tool's: the
 * scenario gives a scene's first bar and a bar is fps * bar_sec ticks, and
 * the first tick of that product is sometimes still the scene before (tick
 * 6144 is quat_julia although sdf_blobs starts at bar 96). So every frame
 * says which scene drew it (`e`) and a frame from another scene is asked
 * again one tick later rather than counted here. */
export async function timeScene(channel, scene, ticks, same = false) {
  const samples = [];
  const drew = {};
  for (const key of Object.values(COUNTS)) {
    drew[key] = [];
  }
  const mine = (e) => String(e).toLowerCase() === scene.id.toLowerCase() || String(e).toLowerCase() === scene.name.toLowerCase();
  const parses = [];
  const sizes = [];
  let skipped = 0;
  let tick = scene.start;
  let answeredAs;
  while (samples.length < ticks && skipped < 8) {
    const {ms, parseMs, bytes, frame} = await channel.frame(tick);
    if (same === false) {
      tick = tick + 1;
    }
    if (mine(frame.e) === false) {
      skipped = skipped + 1;
      answeredAs ??= frame.e;
      if (same === true) {
        tick = tick + 1;
        scene = {...scene, start: tick};
      }
      continue;
    }
    answeredAs = frame.e;
    samples.push(ms);
    parses.push(parseMs);
    sizes.push(bytes);
    for (const key of Object.values(COUNTS)) {
      drew[key].push(Number(frame[key] ?? 0));
    }
  }
  const sorted = samples.slice().sort((a, b) => a - b);
  const counts = Object.fromEntries(Object.entries(COUNTS).map(([name, key]) => [name, Math.round(mean(drew[key]))]));
  const primitives = Object.values(counts).reduce((a, b) => a + b, 0);
  const med = median(sorted);
  return {
    id: scene.id,
    name: scene.name,
    start: scene.start,
    answeredAs,
    skipped,
    frames: samples.length,
    min: sorted[0] ?? 0,
    median: med,
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
    fps: med === 0 ? 0 : 1000 / med,
    counts,
    primitives,
    // what the frame weighs on the wire, and what parsing it costs the page
    bytes: Math.round(mean(sizes)),
    parseMs: median(parses.slice().sort((a, b) => a - b)),
    msPerKilo: primitives === 0 ? null : med / primitives * 1000,
    // the warm-up question: is the first frame of a scene paid for once?
    samples,
  };
}

/** the first frames against the later ones, on one process (backlog E.7) */
export function warmup(samples, head = 20, from = 100) {
  const first = samples.slice(0, head).slice().sort((a, b) => a - b);
  const later = samples.slice(from).slice().sort((a, b) => a - b);
  if (later.length === 0) {
    return undefined;
  }
  return {
    head, from,
    first: median(first),
    later: median(later),
    firstFrame: samples[0],
    ratio: median(later) === 0 ? 0 : median(first) / median(later),
  };
}

const ms = (x) => x.toFixed(1).padStart(7);

export function table(rows) {
  const width = Math.max(14, ...rows.map((r) => r.name.length));
  const head = ["scene".padEnd(width), "frames", "    min", " median", "    p95", "    max", "   fps",
    "  rect", " line", "  tri", " circ", "  img", " text", "   prim", " ms/kprim", "   bytes", " parse"].join(" ");
  const lines = [head, "-".repeat(head.length)];
  for (const r of rows) {
    lines.push([
      r.name.padEnd(width),
      String(r.frames).padStart(6),
      ms(r.min), ms(r.median), ms(r.p95), ms(r.max),
      r.fps.toFixed(1).padStart(6),
      String(r.counts.rect).padStart(6),
      String(r.counts.line).padStart(5),
      String(r.counts.tri).padStart(5),
      String(r.counts.circle).padStart(5),
      String(r.counts.image).padStart(5),
      String(r.counts.text).padStart(5),
      String(r.primitives).padStart(7),
      (r.msPerKilo === null ? "-" : r.msPerKilo.toFixed(2)).padStart(9),
      String(r.bytes).padStart(8),
      r.parseMs.toFixed(2).padStart(6),
    ].join(" "));
  }
  return lines.join("\n");
}

if (runsAs("o4d-profile.mjs")) {
  const args = process.argv.slice(2);
  const at = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i === -1 ? fallback : args[i + 1];
  };
  const base = args[0]?.startsWith("http") ? args[0] : "http://127.0.0.1:3090";
  const ticks = Number(at("--ticks", 60));
  const only = at("--scene");
  const channel = await connect(base, at("--demo", "main"));
  let scenes = scenesOf(channel.scenario);
  if (only !== undefined) {
    const wanted = String(only).toLowerCase();
    scenes = scenes.filter((s) => s.id.toLowerCase() === wanted || s.name.toLowerCase() === wanted);
    if (scenes.length === 0) {
      throw new Error(`no scene "${only}"; there are: ${scenesOf(channel.scenario).map((s) => s.id).join(", ")}`);
    }
  }
  console.log(`${scenes.length} scene${scenes.length === 1 ? "" : "s"} of "${channel.scenario.name}" at ${base}, ${ticks} frames each, one at a time`);
  const rows = [];
  for (const scene of scenes) {
    const row = await timeScene(channel, scene, ticks, args.includes("--same"));
    rows.push(row);
    console.log(`  ${row.name.padEnd(16)} median ${row.median.toFixed(1)} ms, ${row.primitives} primitives`);
  }
  channel.socket.close();
  const sorted = rows.slice().sort((a, b) => b.median - a.median);
  console.log("");
  console.log(table(sorted));
  for (const row of sorted) {
    const w = warmup(row.samples);
    if (w !== undefined) {
      console.log(`warm-up ${row.name}: frames 1-${w.head} median ${w.first.toFixed(1)} ms, frames ${w.from}+ median ${w.later.toFixed(1)} ms (${w.ratio.toFixed(2)}x), first frame ${w.firstFrame.toFixed(1)} ms`);
    }
  }
  const out = at("--json");
  if (out !== undefined) {
    writeFileSync(out, JSON.stringify({base, ticks, scenario: channel.scenario.id, when: new Date().toISOString(), scenes: sorted}, null, 1));
    console.log(`-> ${out}`);
  }
  process.exit(0);
}
