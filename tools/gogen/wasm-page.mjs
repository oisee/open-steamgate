// The page side of wasm.mjs: one runtime, one scene, one frame loop, in a
// browser. The page is loaded once per runtime, so every runtime starts cold
// in a fresh context, and the driver runs them one after the other.
//
//   ?rt=go|ir|tr&scene=plasma&warmup=256&frames=1024
//
// go  the scene compiled by gogen to Go, GOOS=js GOARCH=wasm (<scene>.wasm)
// ir  the same IR emitted as JS (emit-js + js/abap.mjs, bundled)
// tr  the scene through @abaplint/transpiler + @abaplint/runtime, bundled
//
// Every runtime gets the same contexts (t, gt and pos16 of the A4H
// recording, pos16 computed once, here) in the same order, and each frame is
// reduced to the same checksum: FNV-1a 32 over lines, rects and texts (the
// fields scenes.mjs compares with A4H), a count per list, a number as its
// float64 bytes little-endian, a string as its UTF-8 bytes and 0xFF. Go
// computes it in Go (zz_main.go of cmd/scenewasm); the JS runtimes here.
import {SCENES, pos16} from "./scene-defs.mjs";

const q = new URLSearchParams(location.search);
const rt = q.get("rt");
const scene = q.get("scene");
const warmup = Number(q.get("warmup"));
const frames = Number(q.get("frames"));
const sc = SCENES[scene];

const enc = new TextEncoder();
const f64 = new DataView(new ArrayBuffer(8));
const fnv = (h, bytes) => { for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0; return h; };
const num = (h, x) => { f64.setFloat64(0, x, true); return fnv(h, new Uint8Array(f64.buffer)); };
const str = (h, s) => fnv(fnv(h, enc.encode(s)), [0xff]);
const cnt = (h, n) => fnv(h, [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
// rows as plain objects: [[x1, y1, x2, y2, color]], [[x, y, w, h, fill]], [[x, y, text, color, size]]
function checksum(lists) {
  let h = 2166136261;
  for (const rows of lists) {
    h = cnt(h, rows.length);
    for (const row of rows) for (const v of row) h = typeof v === "number" ? num(h, v) : str(h, v);
  }
  return h >>> 0;
}

async function load() {
  if (rt === "go") {
    await new Promise((ok, bad) => {
      const el = document.createElement("script");
      el.src = "wasm_exec.js"; el.onload = ok; el.onerror = bad;
      document.head.append(el);
    });
    const go = new globalThis.Go();
    const {instance} = await WebAssembly.instantiateStreaming(fetch(`${scene}.wasm`), go.importObject);
    go.run(instance); // main registers goScene, then blocks in select {}
    const g = globalThis.goScene;
    return {render: (r) => g.renderFrame(r.t, r.gt, r.pos16), sum: () => g.checksum()};
  }
  if (rt === "ir") {
    const m = await import(`./${scene}-ir.js`);
    const obj = new m[sc.cls]();
    const s = {sy: {index: 0, tabix: 0, subrc: 0}};
    sc.jsInit?.(obj, s);
    let last;
    return {
      render: (r) => { last = obj.ZIF_O4D_EFFECT__RENDER_FRAME(s, r.ir); },
      sum: () => checksum([
        last.lines.map((l) => [l.x1, l.y1, l.x2, l.y2, l.color]),
        last.rects.map((x) => [x.x, x.y, x.w, x.h, x.fill]),
        last.texts.map((t) => [t.x, t.y, t.text, t.color, t.size])]),
      ctx: (r) => { r.ir = sc.jsCtx(m, r); },
    };
  }
  if (rt === "tr") {
    await import(`./${scene}-tr.js`);
    const abap = globalThis.abap;
    const obj = new abap.Classes[sc.cls]();
    if (obj.constructor_) await obj.constructor_(sc.trInit);
    const ctxType = abap.Classes.ZIF_O4D_EFFECT.METHODS.RENDER_FRAME.parameters.IS_CTX.type;
    const v = (x) => (x.getRaw ? x.getRaw() : x.get());
    let last;
    return {
      async: true,
      render: async (r) => { last = await obj.zif_o4d_effect$render_frame({is_ctx: r.tr}); },
      sum: () => {
        const f = last.get();
        const rows = (t, keys) => t.array().map((row) => keys.map((k) => v(row.get()[k])));
        return checksum([rows(f.lines, ["x1", "y1", "x2", "y2", "color"]),
          rows(f.rects, ["x", "y", "w", "h", "fill"]), rows(f.texts, ["x", "y", "text", "color", "size"])]);
      },
      ctx: (r) => { r.tr = ctxType(); sc.trCtx(r.tr, r); },
    };
  }
  throw new Error(`no runtime ${rt}`);
}

async function main() {
  const recs = await (await fetch(`${scene}-ctx.json`)).json();
  recs.forEach((r) => { r.pos16 = pos16(r.gt); });
  const t0 = performance.now();
  const R = await load();
  R.ctx?.(recs[0]);
  const tLoaded = performance.now();
  await R.render(recs[0]);
  const tFirst = performance.now();
  for (const r of recs) R.ctx?.(r);
  const n = recs.length;
  const ms = new Float64Array(frames);
  if (R.async) {
    for (let i = 0; i < warmup; i++) await R.render(recs[i % n]);
    for (let i = 0; i < frames; i++) {
      const a = performance.now(); await R.render(recs[i % n]); ms[i] = performance.now() - a;
    }
  } else {
    for (let i = 0; i < warmup; i++) R.render(recs[i % n]);
    for (let i = 0; i < frames; i++) {
      const a = performance.now(); R.render(recs[i % n]); ms[i] = performance.now() - a;
    }
  }
  // one sweep over the recording, a checksum per frame, folded into one
  const sums = [];
  for (const r of recs) { await R.render(r); sums.push(R.sum()); }
  const sweep = sums.reduce((h, s) => cnt(h, s), 2166136261) >>> 0;
  const sorted = [...ms].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {rt, scene, frames, warmup, isolated: globalThis.crossOriginIsolated,
    loadMs: tLoaded - t0, firstFrameMs: tFirst - tLoaded, startupMs: tFirst - t0,
    medianMs: at(0.5), p90Ms: at(0.9), meanMs: ms.reduce((a, b) => a + b, 0) / frames,
    frame0: sums[0].toString(16).padStart(8, "0"), sums, sweep: sweep.toString(16).padStart(8, "0"), n};
}

main().then((r) => { globalThis.__result = r; }, (e) => { globalThis.__result = {error: String(e?.stack ?? e)}; });
