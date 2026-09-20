// Pure registry routing shared by Node and the browser preview.
export const matchesPath = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

export function servicesFromRows(rows) {
  const nodes = (rows.ICFSERVICE ?? []).filter((s) => String(s.URL ?? "").trim() !== "");
  const pathOf = (s) => String(s.URL).trim().replace(/\/+$/, "");
  const inactive = nodes.filter((s) => String(s.ICFACTIVE ?? "").trim() !== "X");
  return nodes.map((s) => {
    const chain = (rows.ICFHANDLER ?? [])
      .filter((h) => h.ICF_NAME === s.ICF_NAME && h.ICFPARGUID === s.ICFPARGUID)
      .sort((a, b) => String(a.ICFORDER).localeCompare(String(b.ICFORDER))
        || String(a.ICFTYP).localeCompare(String(b.ICFTYP)));
    const last = chain.at(-1);
    const path = pathOf(s);
    return {
      path, name: s.ICF_NAME,
      description: (rows.ICFDOCU ?? []).find((d) => d.ICF_NAME === s.ICF_NAME && d.ICFPARGUID === s.ICFPARGUID)?.ICF_DOCU,
      active: !inactive.some((parent) => matchesPath(path, pathOf(parent))),
      handler: last?.ICFHANDLER, icftyp: last?.ICFTYP,
      type: last === undefined ? undefined : (last.ICFTYP === "A" ? "ABAP" : last.ICFTYP),
      travels: true, source: "ICFSERVICE",
    };
  }).sort((a, b) => b.path.length - a.path.length);
}

export function serviceForPath(services, path) {
  const matching = services.filter((s) => matchesPath(path, s.path));
  if (matching.some((s) => s.active === false)) return undefined;
  return matching.filter((s) => s.handler !== undefined && s.type === "ABAP")
    .sort((a, b) => b.path.length - a.path.length)[0];
}
