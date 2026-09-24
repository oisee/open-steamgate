// The scenes of ZO4D that tools/gogen compiles, and the context each one's
// render_frame reads (scenes.mjs checks them against A4H, wasm.mjs runs them
// in a browser). ctx is the Go literal, jsCtx builds it for the JS emitted
// from the IR, trCtx fills the transpiler's structure (trInit is the
// transpiler's constructor INPUT), goCtx is the same literal over the
// variables t, gt and pos16 of the wasm entry (wasm.mjs), which gets all
// three from the page so that no side computes pos16 on its own.
//
// What each scene reads from its context, beyond t
// The beat position is computed the way ZCL_O4D_APC_HANDLER=>CALC_BEAT_INFO
// does, in the same double arithmetic: 152 bpm, a 16th is beat_sec / 4.
export const BEAT_SEC = 60 / 152;
export const pos16 = (gt) => Math.floor(gt / (BEAT_SEC / 4));
export const SCENES = {
  glitch: {cls: "ZCL_O4D_GLITCH", ctx: (r) => `ZIF_O4D_EFFECT__TY_RENDER_CTX{t: ${r.t}}`,
    goCtx: "ZIF_O4D_EFFECT__TY_RENDER_CTX{t: t}",
    jsCtx: (m, r) => Object.assign(m.new_ZIF_O4D_EFFECT__TY_RENDER_CTX(), {t: r.t}),
    trCtx: (c, r) => { c.get().t.set(r.t); }},
  // NEW #( ) in the handler: the constructor's defaults 640 x 400, scale 20
  plasma: {cls: "ZCL_O4D_PLASMA", init: "obj.CONSTRUCTOR(s, 640, 400, 20)",
    ctx: (r) => `ZIF_O4D_EFFECT__TY_RENDER_CTX{t: ${r.t}, gt: ${r.gt}, gbi: ZIF_O4D_EFFECT__TY_BEAT_INFO{pos_16: ${pos16(r.gt)}}}`,
    goCtx: "ZIF_O4D_EFFECT__TY_RENDER_CTX{t: t, gt: gt, gbi: ZIF_O4D_EFFECT__TY_BEAT_INFO{pos_16: int32(pos16)}}",
    jsInit: (obj, s) => obj.CONSTRUCTOR(s, 640, 400, 20),
    jsCtx: (m, r) => Object.assign(m.new_ZIF_O4D_EFFECT__TY_RENDER_CTX(), {t: r.t, gt: r.gt,
      gbi: Object.assign(m.new_ZIF_O4D_EFFECT__TY_BEAT_INFO(), {pos_16: pos16(r.gt)})}),
    trInit: {iv_width: 640, iv_height: 400, iv_scale: 20},
    trCtx: (c, r) => { c.get().t.set(r.t); c.get().gt.set(r.gt); c.get().gbi.get().pos_16.set(pos16(r.gt)); }},
};
