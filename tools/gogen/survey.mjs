// Which scenes of the demo compile, and what stops the rest: the refusals
// counted over every recorded scene, so the next feature is the one that
// unlocks the most.
//
//   node tools/gogen/survey.mjs
import {readFileSync, readdirSync} from "node:fs";
import {compileProgram} from "./frontend.mjs";

const pack = "/home/alice/dev/open-steamgate/packs/o4d/upstream";
const recordings = "/home/alice/dev/open-steamgate/.local";
const byName = new Map();
for (const f of readdirSync(pack).filter((x) => x.endsWith(".clas.abap")).sort()) {
  const src = readFileSync(`${pack}/${f}`, "utf8");
  if (!/INTERFACES zif_o4d_effect/i.test(src)) continue;
  const m = /rv_name = '([a-z0-9_]+)'/i.exec(src);
  if (m) byName.set(m[1], f.split(".")[0]);
}
const scenes = readdirSync(recordings).filter((f) => /^o4d-a4h-[a-z0-9_]+\.jsonl$/.test(f) && f !== "o4d-a4h.jsonl")
  .map((f) => f.replace(/^o4d-a4h-|\.jsonl$/g, "")).sort();
const reasons = new Map();
const rows = [];
for (const scene of scenes) {
  const cls = byName.get(scene);
  let status;
  try {
    const p = compileProgram({folders: [pack], objects: ["zif_o4d_effect", cls]});
    const c = p.classes.find((x) => x.name === cls.toUpperCase());
    const ok = c.methods.some((m) => m.name === "ZIF_O4D_EFFECT~RENDER_FRAME");
    const why = p.skipped.filter((x) => !/calls .* which was skipped/.test(x)).map((x) => x.replace(/^[^:]+: /, ""));
    status = ok ? "compiles" : `refused: ${why[0] ?? "?"}`;
    if (!ok) for (const w of why) {
      const key = w.replace(/^[A-Z0-9_~]+: /, "").replace(/\b(lv|ls|lt|mv|ms|mt|iv|is|rv|rs|ev)_\w+/gi, "<v>").slice(0, 90);
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
  } catch (e) {
    status = `error: ${String(e.message).split("\n")[0].slice(0, 110)}`;
    reasons.set(`error: ${String(e.message).split("\n")[0].replace(/^.*?: /, "").slice(0, 80)}`, 1 + (reasons.get(`error: ${String(e.message).split("\n")[0].replace(/^.*?: /, "").slice(0, 80)}`) ?? 0));
  }
  rows.push(`${scene.padEnd(18)} ${status}`);
}
console.log(rows.join("\n"));
console.log(`\ncompiles: ${rows.filter((r) => r.includes("compiles")).length} of ${rows.length}\nrefusals, most scenes first:`);
for (const [k, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${String(n).padStart(3)}  ${k}`);
