// Native cold insertion order, without reparsing the kept objects.
const key = o => `${o.getType()} ${o.getName()}`;
export function orderRegistry(reg, core, files, libs = []) {
  // Let the same Registry used by the cold transpiler admit and group files.
  // In particular, tadir.json creates no object and must not move the library's
  // TADIR table ahead of T000/T100. Filename-derived ranks missed that rule.
  const cold = new core.Registry();
  for (const f of files) cold.addFile(new core.MemoryFile(f.filename, f.contents));
  for (const f of libs) cold.addDependency(new core.MemoryFile(f.filename, f.contents));
  const rank = new Map([...cold.getObjects()].map((o, i) => [key(o), i]));
  // Discard an earlier iterator's snapshot after membership has changed.
  delete reg.getObjects;
  const ordered = [...reg.getObjects()].sort((a, b) =>
    (rank.get(key(a)) ?? Infinity) - (rank.get(key(b)) ?? Infinity));
  reg.getObjects = function* () { yield* ordered; };
}
