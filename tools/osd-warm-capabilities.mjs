// Behavioral equivalents of CI's only-option and registry/config checks.
export const WARM_PIN_WARNING = "warm off: the transpiler is not the pinned build (run: npm run transpiler:pin)";

export function warnWarmPin(reason, log = console.log, env = process.env) {
  if (env.OSD_WARM === "1" && reason !== undefined) log(WARM_PIN_WARNING);
}

export async function doctorWarmPin(Transpiler, core, log = console.log, env = process.env) {
  if (env.OSD_WARM !== "1") return;
  const reason = await probe(Transpiler, core);
  warnWarmPin(reason, log, env);
  if (reason !== undefined) log(`warm: builds stay cold: ${reason}`);
}

/** whether this transpiler can build some objects of a registry kept across runs */
export async function probe(Transpiler, core) {
  const clas = (name, body) => new core.MemoryFile(`${name}.clas.abap`, `CLASS ${name} DEFINITION PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS m.
ENDCLASS.
CLASS ${name} IMPLEMENTATION.
  METHOD m.
    ${body}
  ENDMETHOD.
ENDCLASS.`);
  const reg = new core.Registry();
  reg.addFile(clas("zcl_warm_a", "DATA x TYPE i."));
  reg.addFile(clas("zcl_warm_b", "DATA y TYPE i."));
  await new Transpiler({ignoreSyntaxCheck: false}).run(reg);
  const kept = reg.getObject("CLAS", "ZCL_WARM_A").syntaxResult;
  const only = await new Transpiler({ignoreSyntaxCheck: false, only: (o) => o.getName() === "ZCL_WARM_B"}).run(reg);
  if (only.objects.length !== 1) return "the transpiler has no `only` option (abaplint/transpiler#1900)";
  if (kept === undefined || reg.getObject("CLAS", "ZCL_WARM_A").syntaxResult !== kept) {
    return "a second run checks the whole registry again (abaplint/transpiler#1921)";
  }
  // A different config must invalidate even objects outside `only`.
  await new Transpiler({ignoreSyntaxCheck: true, only: (o) => o.getName() === "ZCL_WARM_B"}).run(reg);
  if (reg.getObject("CLAS", "ZCL_WARM_A").syntaxResult === kept) {
    return "a changed configuration reuses stale syntax (abaplint/transpiler#1921)";
  }
  return undefined;
}
