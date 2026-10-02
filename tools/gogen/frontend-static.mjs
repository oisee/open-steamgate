// Static attributes share storage in their declaring class, including inherited names.
export function resolveStatic(owner, attr, ctx, deps, write = false) {
  const {CHAR_UTILITIES, C, upper, clasDef, registerConst, localInterfaceConstant, Unsupported, ancestors, goName, typeOf, abaplint, notInProgram} = deps;
  if (!write && owner === "CL_ABAP_CHAR_UTILITIES" && CHAR_UTILITIES[attr] !== undefined) return {e: "chars", value: CHAR_UTILITIES[attr], type: C(1)};
  const intf = ctx.reg.getObject("INTF", owner)?.getDefinition();
  const clas = clasDef(ctx.reg, owner);
  const local = ctx.program.localInterfaces.get(`${ctx.program.currentOwner}|${owner}`);
  const def = intf ?? clas ?? local?.def;
  if (def === undefined) throw new Unsupported(`${owner}=>${attr}: ${owner} is not in the program`);
  const c = def.getAttributes().getConstants().find((x) => upper(x.getName()) === attr);
  if (c !== undefined) {
    if (write) throw new Unsupported(`${owner}=>${attr}: a write to a constant`);
    const go = registerConst(ctx.program, `${ctx.program.currentOwner ?? owner}:${owner}~${attr}`,
      local ? localInterfaceConstant(c, attr, local, ctx.reg) : c, owner);
    if (go === undefined) throw new Unsupported(`constant ${owner}=>${attr} is outside the subset`);
    return {e: "const", go, type: ctx.program.consts.get(go).type};
  }
  // a constant a superclass declares, named through the subclass
  // (/IWBEP/CX_MGW_NOT_IMPL_EXC=>METHOD_NOT_IMPLEMENTED, declared by
  // /IWBEP/CX_MGW_TECH_EXCEPTION): the same constant; a constant is fixed
  // at compile time, so no class constructor runs for it (ultra/zvdb)
  if (clas !== undefined && intf === undefined) {
    for (const anc of ancestors(ctx.reg, owner)) {
      const ac = clasDef(ctx.reg, anc)?.getAttributes().getConstants().find((x) => upper(x.getName()) === attr);
      if (ac === undefined) continue;
      if (write) throw new Unsupported(`${owner}=>${attr}: a write to a constant`);
      const go = registerConst(ctx.program, `${anc}~${attr}`, ac, anc);
      if (go === undefined) throw new Unsupported(`constant ${anc}=>${attr} is outside the subset`);
      return {e: "const", go, type: ctx.program.consts.get(go).type};
    }
  }
  // an alias of an interface for a constant of an interface it includes
  // (IF_APC_WSP_EXTENSION=>CO_CONNECT_MODE_REJECT for
  // IF_APC_WSP_EXTENSION_COMMON~CO_CONNECT_MODE_REJECT)
  const alias = (def.getAliases?.() ?? []).find((x) => upper(x.getName()) === attr);
  const comp = alias === undefined ? [] : upper(alias.getComponent()).split("~");
  if (comp.length === 2 && comp[0] !== owner) return resolveStatic(comp[0], comp[1], ctx, deps, write);
  for (const at of [owner, ...(clas ? ancestors(ctx.reg, owner) : [])]) {
    const a = clasDef(ctx.reg, at)?.getAttributes().getStatic().find((x) => upper(x.getName()) === attr);
    if (!a) continue;
    const inside = ctx.className === at || ancestors(ctx.reg, ctx.className).includes(at);
    if (a.getVisibility() !== abaplint.Visibility.Public && !(inside && (ctx.className === at || a.getVisibility() === abaplint.Visibility.Protected))) break;
    const file = ctx.reg.getObject("CLAS", at.split(":")[0])?.getABAPFiles().find((f) => f.getFilename() === a.getFilename());
    const declaration = file?.getStatements().find((st) => st.getTokens().some((t) => t.getStart().getRow() === a.getToken().getStart().getRow() && t.getStart().getCol() === a.getToken().getStart().getCol()));
    const readOnly = /\bREAD\s*-\s*ONLY\b/i.test(declaration?.concatTokens() ?? "");
    if (write && !inside && readOnly) {
      throw new Unsupported(`${owner}=>${attr}: a write to a READ-ONLY attribute outside ${at}`);
    }
    if (!ctx.program.wanted.has(at)) throw notInProgram(ctx, at, `${owner}=>${attr}: ${at} is not compiled in this program`);
    return {e: "static", go: goName(`${at}=>${attr}`), owner: at,
      type: typeOf(a.getType(), `${at}=>${attr}`, ctx.program)};
  }
  throw new Unsupported(`${owner}=>${attr}`);
}
