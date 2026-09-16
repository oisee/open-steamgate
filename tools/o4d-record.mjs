// The demo's frame stream, recorded so two machines can be compared.
//
// ZO4D draws itself in ABAP and pushes a frame per tick over its APC
// channel: a small JSON object of time, beat and the coordinates the page
// paints. The stream is a function of the tick, not of the wall clock, so
// the same demo on two machines must produce the same frames — which makes
// a recording an oracle, and a diff the whole test.
//
//   node tools/o4d-record.mjs http://127.0.0.1:3030 --demo main --ticks 120
//   node tools/o4d-record.mjs http://i7:3030 --out .local/o4d-i7.jsonl
//   diff .local/o4d-3030.jsonl .local/o4d-i7.jsonl
//
// Never commit a recording: captures stay under .local/ (CLAUDE.md).
import {writeFileSync} from "node:fs";

const CHANNEL = "/sap/bc/apc/sap/zo4d_demo";

export async function record(base, options = {}) {
  const ticks = options.ticks ?? 120;
  const demo = options.demo ?? "main";
  const socket = new WebSocket(base.replace(/^http/, "ws") + CHANNEL);
  const frames = [];
  const meta = {};
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  socket.addEventListener("message", (e) => {
    const text = String(e.data);
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.type === "config" || message.type === "megademo" || message.type === "scenario") {
      meta[message.type] = message;
      return;
    }
    // anything else with a tick in it is a frame
    if (message.t !== undefined) {
      frames.push(message);
      if (frames.length >= ticks) {
        resolve();
      }
    }
  });
  await new Promise((ok, no) => {
    socket.addEventListener("open", ok);
    socket.addEventListener("error", () => no(new Error(`the demo channel did not open: ${base}${CHANNEL}`)));
    setTimeout(() => no(new Error("the demo channel did not open within 20 s")), 20000);
  });
  socket.send(JSON.stringify({cmd: "get_megademo"}));
  socket.send(JSON.stringify({cmd: "get_scenario"}));
  socket.send(JSON.stringify({cmd: "load_demo", demo}));
  socket.send("start");
  // every tick asked for by number: the stream is the demo's function of the
  // tick, so nothing here depends on how fast either machine answers
  for (let t = 0; t < ticks; t++) {
    socket.send(JSON.stringify({cmd: "frame", tick: t, sub: 0}));
  }
  await Promise.race([done, new Promise((r) => setTimeout(r, options.timeout ?? 60000))]);
  socket.close();
  return {base, demo, ticks, frames, meta};
}

/** the two streams, and the first tick at which they part */
export function compare(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const left = JSON.stringify(a[i]);
    const right = JSON.stringify(b[i]);
    if (left !== right) {
      return {same: false, at: i, left, right};
    }
  }
  return a.length === b.length ? {same: true, frames: n} : {same: false, at: n, left: a[n] ?? "(end)", right: b[n] ?? "(end)"};
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const args = process.argv.slice(2);
  const at = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i === -1 ? fallback : args[i + 1];
  };
  const base = args[0]?.startsWith("http") ? args[0] : "http://127.0.0.1:3030";
  const result = await record(base, {demo: at("--demo", "main"), ticks: Number(at("--ticks", 120))});
  const out = at("--out", `.local/o4d-${new URL(base).port || "80"}.jsonl`);
  writeFileSync(out, result.frames.map((f) => JSON.stringify(f)).join("\n") + "\n");
  console.log(`${result.frames.length} frames of "${result.meta.scenario?.name ?? result.demo}" from ${base} -> ${out}`);
  const against = at("--against");
  if (against !== undefined) {
    const {readFileSync} = await import("node:fs");
    const theirs = readFileSync(against, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const verdict = compare(result.frames, theirs);
    console.log(verdict.same ? `identical to ${against}, ${verdict.frames} frames` : `differs from ${against} at frame ${verdict.at}\n  here:  ${verdict.left}\n  there: ${verdict.right}`);
    process.exit(verdict.same ? 0 : 1);
  }
}
