// One recording through the JS emitted from the IR, in its own process so a
// loop that does not end fails its own scene only (demo.mjs starts it).
//
//   node demo-js.mjs <out dir> <run file>   -> {scene, frames, ns} or {scene, error}
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

const [dir, file] = process.argv.slice(2);
const [r] = JSON.parse(readFileSync(file, "utf8"));
const m = await import(pathToFileURL(join(dir, "demo.mjs")).href);
let res;
try {
  const s = {sy: {index: 0, tabix: 0, subrc: 0}};
  const h = m.ZCL_O4D_APC_HANDLER.$new(s);
  h.INIT_ALL_DEMOS(s);
  h.LOAD_DEMO(s, "main");
  const spt = h.mo_demo.GET_SEC_PER_TICK(s);
  const first = Math.round(r.gt[0] / spt);
  const frames = [];
  const t = process.hrtime.bigint();
  const each = [];
  for (let k = 0; k < r.gt.length; k++) {
    const t0 = process.hrtime.bigint();
    frames.push(frame(h, s, first + k));
    each.push(Number(process.hrtime.bigint() - t0));
  }
  res = {scene: r.scene, frames, each, ns: Number(process.hrtime.bigint() - t) / r.gt.length};
} catch (e) {
  res = {scene: r.scene, error: String(e.message ?? e).slice(0, 160)};
}
process.stdout.write(JSON.stringify(res));

// the handler's 'frame' command, sub = 0, after it parsed the tick
function frame(h, s, tick) {
  const fpt = h.mo_demo.GET_FPT(s);
  const gt = tick * h.mo_demo.GET_SEC_PER_TICK(s);
  h.mv_frame_num = tick * fpt;
  const ctx = h.BUILD_RENDER_CTX(s, gt);
  const eff = h.mo_demo.GET_EFFECT_AT_BAR(s, ctx.gbi.bar);
  const f = eff ? eff.ZIF_O4D_EFFECT__RENDER_FRAME(s, ctx) : m.new_ZIF_O4D_EFFECT__TY_FRAME();
  return h.FRAME_TO_JSON(s, f, ctx, "");
}
