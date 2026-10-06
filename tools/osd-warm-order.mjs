// Match cold registry insertion order while retaining parsed objects and caches.
const key = o => `${o.getType()} ${o.getName()}`;
export function orderRegistry(c, files) {
  // A previous ordering override cannot supply native membership after updates.
  delete c.reg.getObjects;
  // Script order must match a cold registry even for a new object's tests
  // and class constructor. Reorder iteration, retaining every object/cache.
  const rank = new Map(), names = new Map();
  for (const f of [...files.values(), ...c.libs]) {
    const memory = new c.core.MemoryFile(f.filename, f.contents);
    const id = `${memory.getObjectType()} ${memory.getObjectName().toUpperCase()}`;
    const name = memory.getObjectName().toUpperCase();
    if (!names.has(name)) names.set(name, names.size);
    if (!rank.has(id)) rank.set(id, rank.size);
  }
  // Registry groups all types of a name at its first occurrence, including
  // library objects that share a name with an earlier source object.
  const ordered = [...c.reg.getObjects()].sort((a, b) =>
    (names.get(a.getName()) ?? Infinity) - (names.get(b.getName()) ?? Infinity) ||
    (rank.get(key(a)) ?? Infinity) - (rank.get(key(b)) ?? Infinity));
  c.reg.getObjects = function* () { yield* ordered; };
}
