// Q2b "Runner" (docs/vscode-extension.md, "Next"): which service and entity
// set a `<set>_get_entityset` / `<set>_get_entity` method of a SEGW
// `_DPC_EXT` class answers for. Read off the same two sources SEGW itself
// derives it from, never guessed from a file name: the service registry
// (segw-registry.mjs, the project's own IWSV/IWMO) for the service name, and
// the MPC class's own entity-name constants for the set's real name and
// case -- SEGW generates every one of them (an entity type and its set
// alike) with the type `ty_e_med_entity_name`, so that type is the anchor
// rather than the constant's own name (`gc_travel_set`, `gc_status_vh_set`,
// whatever a project happened to call it).
//
// Pure text over pure text: no file system here, so a test holds it to a
// source string. tools/adt-facade.mjs supplies the registry and the two
// class sources its own store already reads.

const ENTITY_NAME_CONSTANT = /CONSTANTS\s+(\S+)\s+TYPE\s+\S*ty_e_med_entity_name\S*\s+VALUE\s+'([^']*)'/gi;
const ENTITYSET_METHOD = /^[ \t]*METHOD\s+(\w+)_get_entityset\s*\.[ \t]*$/gim;
const ENTITY_METHOD = /^[ \t]*METHOD\s+(\w+)_get_entity\s*\.[ \t]*$/gim;

/** Every entity-name constant an MPC class declares, keyed by the
 *  constant's own name: `{GC_TRAVEL_SET: "TravelSet", ...}` -- read off the
 *  type SEGW gives every one of them (`ty_e_med_entity_name`), not off the
 *  constant's own name, which a project is free to spell differently. */
export function entityNameConstantsOf(mpcSource) {
  const map = new Map();
  for (const m of String(mpcSource ?? "").matchAll(ENTITY_NAME_CONSTANT)) {
    map.set(m[1].toUpperCase(), m[2]);
  }
  return map;
}

/** `[{method, prefix, kind}]` for every `METHOD <set>_get_entityset.` /
 *  `METHOD <set>_get_entity.` implementation a DPC(_EXT) class's source
 *  carries -- SEGW's own naming, read off the lines rather than assumed.
 *  `kind` is "get_entityset" or "get_entity"; a `_get_entity` match never
 *  fires on a `_get_entityset` line, because ENTITY_METHOD requires the
 *  line to end (the period) right after `_get_entity`. */
export function entitySetMethodsOf(dpcSource) {
  const out = [];
  const source = String(dpcSource ?? "");
  for (const m of source.matchAll(ENTITYSET_METHOD)) {
    out.push({method: `${m[1]}_get_entityset`.toUpperCase(), prefix: m[1].toUpperCase(), kind: "get_entityset"});
  }
  for (const m of source.matchAll(ENTITY_METHOD)) {
    out.push({method: `${m[1]}_get_entity`.toUpperCase(), prefix: m[1].toUpperCase(), kind: "get_entity"});
  }
  return out;
}

/** Each entity-set method of a DPC(_EXT) source, with the set's real name
 *  and case from the MPC's own constants: `[{method, kind, set}]`. SEGW
 *  lower-cases the set name into the method's prefix, so the match is
 *  case-insensitive against every constant's value -- `travelset_get_entityset`
 *  finds `TravelSet` however the constant naming it is spelled. A method
 *  whose set the MPC does not name (an override of something the model
 *  does not have) is left out rather than guessed. One entry per
 *  `{kind, method}`: a base class and its `_EXT` both carry a `METHOD
 *  <set>_get_entityset.` (the generated body, the hand-written override),
 *  and `dpcSource` may be both concatenated (`entitySetMapFor`'s
 *  `sourceWithBase`) -- the pair says the same thing twice, not two
 *  different methods. */
export function entitySetsOf(dpcSource, mpcSource) {
  const constants = entityNameConstantsOf(mpcSource);
  const byLower = new Map();
  for (const value of constants.values()) byLower.set(value.toLowerCase(), value);
  const seen = new Set();
  const out = [];
  for (const {method, prefix, kind} of entitySetMethodsOf(dpcSource)) {
    const set = byLower.get(prefix.toLowerCase());
    if (set === undefined) continue;
    const key = `${kind} ${method}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({method, kind, set});
  }
  return out;
}

// SEGW's generated half of an _EXT class carries the constants and the
// method bodies a project has not overridden; the hand-written _EXT itself
// often has neither (the demo's MPC_EXT redefines only `define()`, and every
// entity-set method the demo overrides is redefined *and* implemented in the
// DPC_EXT, but a project need not redefine all of them). So both sources are
// read together: the _EXT class's own text, and -- when its name ends
// `_EXT` -- its base class's, concatenated. A constant or a method either
// carries is found the same as if it were declared directly on the _EXT
// class, the way inheritance actually resolves it.
function sourceWithBase(className, readSource) {
  const own = readSource(className);
  const parts = own === undefined ? [] : [own];
  if (/_EXT$/i.test(className)) {
    const base = readSource(className.replace(/_EXT$/i, ""));
    if (base !== undefined) parts.push(base);
  }
  return parts.length === 0 ? undefined : parts.join("\n");
}

/** The full answer for one DPC(_EXT) class name: `{class, service, mpc,
 *  sets}`, or `undefined` when the registry does not know it as a
 *  service's DPC or the model behind it has no MPC (segw-registry.mjs
 *  `segwRegistrations`, whose shape this reads: `dpc`, `mpc`, `external`/
 *  `service`). `readSource(className)` returns a class's own source text,
 *  or `undefined` when it has none -- the object store's `read("CLAS",
 *  name).source` in tools/adt-facade.mjs, a plain lookup in a test. */
export function entitySetMapFor(className, registrations, readSource) {
  const name = String(className ?? "").toUpperCase();
  const entry = (registrations ?? []).find((r) => String(r.dpc ?? "").toUpperCase() === name);
  if (entry === undefined || !entry.dpc || !entry.mpc) return undefined;
  const dpcSource = sourceWithBase(entry.dpc, readSource);
  const mpcSource = sourceWithBase(entry.mpc, readSource);
  if (dpcSource === undefined || mpcSource === undefined) return undefined;
  return {class: entry.dpc, service: entry.external || entry.service, mpc: entry.mpc, sets: entitySetsOf(dpcSource, mpcSource)};
}
