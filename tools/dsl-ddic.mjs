// DDIC provider shared by ABAP L1 and verified lift. A provider answers a
// table's key, declines with undefined, or refuses an ambiguous key.
import {createRequire} from "node:module";
import {readFileSync, readdirSync} from "node:fs";
import {basename, join} from "node:path";

const abaplint = createRequire(import.meta.url)("@abaplint/core");
export const DEFAULT_DDIC = ["src", ".local/lars/open-abap-core/src"];
const DDIC_FILES = /\.(tabl|dtel|doma|view|ttyp)\.xml$/;

export class Refusal extends Error {
  constructor(obligation, detail) {
    super(`${obligation.split("/")[0]}: ${detail}`);
    this.obligation = obligation;
  }
}

export const unresolved = (type) => type instanceof abaplint.BasicTypes.UnknownType
  || type instanceof abaplint.BasicTypes.VoidType;
// Resolved all the way down: a table of an unknown row, or a structure with an
// unknown component, is not a resolved type even though its outer type is
// known. Used where the model states `resolved: true`.
export function unresolvedDeep(type, seen = new Set()) {
  if (!type || unresolved(type)) return true;
  if (seen.has(type)) return false;
  seen.add(type);
  const BT = abaplint.BasicTypes;
  if (type instanceof BT.TableType) return unresolvedDeep(type.getRowType(), seen);
  if (type instanceof BT.StructureType) return type.getComponents().some((c) => unresolvedDeep(c.type, seen));
  if (type instanceof BT.DataReference) return unresolvedDeep(type.getType(), seen);
  return false;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== ".git" && entry.name !== "node_modules") out.push(...walk(path));
    } else if (DDIC_FILES.test(entry.name)) out.push(path);
  }
  return out;
}

export function registryFor(ddicFolders, sources) {
  const defaults = abaplint.Config.getDefault().get();
  const registry = new abaplint.Registry(new abaplint.Config(JSON.stringify({
    ...defaults, syntax: {...defaults.syntax, errorNamespace: "."}})));
  for (const folder of ddicFolders) {
    let files = [];
    try { files = walk(folder); } catch { continue; }
    for (const path of files) registry.addFile(new abaplint.MemoryFile(basename(path), readFileSync(path, "utf8")));
  }
  for (const file of sources) registry.addFile(new abaplint.MemoryFile(file.name, file.source));
  registry.parse();
  return registry;
}


function ddicKey(registry, table) {
  const t = registry.getObject("TABL", table.toUpperCase());
  if (!t) return undefined;
  if (t.getTableCategory() !== "TRANSP") throw new Refusal("full key", `${table} is not a transparent table`);
  const raw = keyFields(registry, table, t);
  const type = t.parseType(registry);
  if (!(type instanceof abaplint.BasicTypes.StructureType)) throw new Refusal("full key", `${table} does not resolve: ${type.getQualifiedName?.() ?? type.constructor.name}`);
  const components = new Map(type.getComponents().map((c) => [c.name.toUpperCase(), c.type]));
  const keys = t.listKeys(registry).map((k) => k.toUpperCase());
  const missing = keys.find((k) => !components.has(k) || unresolved(components.get(k)));
  if (missing) throw new Refusal("full key", `${table}-${missing} does not resolve in the DDIC given`);
  const extra = [...raw.keys()].find((k) => !keys.includes(k));
  if (extra || raw.size !== keys.length) {
    throw new Refusal("full key", `${table}: abaplint lists ${keys.join(", ")}, the key fields are ${[...raw.keys()].join(", ")}`);
  }

  // A client column is CLNT: by its own type, or by its data element's.
  const isClient = (name) => {
    const field = raw.get(name);
    const rollname = field ? field.ROLLNAME : components.get(name).getDDICName?.();
    if (field?.ROLLNAME === "MANDT" && field.DATATYPE && field.DATATYPE !== "CLNT") {
      throw new Refusal("full key", `${table}-${name} has data element MANDT but type ${field.DATATYPE}`);
    }
    if (field?.DATATYPE === "CLNT") return true;
    if (!rollname) return false;
    const dtel = registry.getObject("DTEL", rollname.toUpperCase());
    return dtel ? dtel.getDataType(registry) === "CLNT" : rollname.toUpperCase() === "MANDT";
  };
  // CLIDEP is the one flag abaplint does not expose
  if (/<CLIDEP>X</.test(t.getXML() ?? "")) {
    const first = type.getComponents()[0]?.name.toUpperCase();
    if (first !== keys[0] || !isClient(first)) {
      throw new Refusal("full key", `${table} is client-dependent but its first field is not the client key field`);
    }
    keys.shift();
  }
  const stray = keys.find(isClient);
  if (stray) throw new Refusal("full key", `${table} has a second client-typed key field ${stray.toLowerCase()}`);
  return {keys: keys.map((k) => ({column: k.toLowerCase(), type: components.get(k), ddic: ddicType(registry, raw.get(k))}))};
}

// The key fields of a table as its DD03P rows, key includes expanded by hand.
// abaplint 2.120.55 cannot be trusted with this alone: listKeys drops a key
// .INCLUDE it cannot resolve, and parseType skips a missing CI_/SI_ include
// without a word, so the key it reports can be a prefix of the real one and
// still look complete. Every key include must resolve here, recursively, or
// the key is not known. A suffixed key include (.INCLU-xxx) listKeys keeps as
// a literal name that never resolves; it is refused here by name so the
// refusal says why.
function keyFields(registry, table, t, out = new Map(), seen = new Set()) {
  for (const field of t.getFields() ?? []) {
    if (field.KEYFLAG !== "X") continue;
    const name = field.FIELDNAME.toUpperCase();
    if (name === ".INCLUDE" || name.startsWith(".INCLU-")) {
      if (name !== ".INCLUDE") throw new Refusal("full key", `${table} has a key include with a suffix (${field.FIELDNAME})`);
      const include = field.PRECFIELD && registry.getObject("TABL", field.PRECFIELD.toUpperCase());
      if (!include && field.PRECFIELD && registry.getObject("VIEW", field.PRECFIELD.toUpperCase())) {
        throw new Refusal("full key", `${table} has a key include ${field.PRECFIELD} that is a view; R1 reads table includes only`);
      }
      if (!include) throw new Refusal("full key", `${table} has a key include ${field.PRECFIELD ?? "(no name)"} that is not in the DDIC given`);
      if (seen.has(include.getName())) throw new Refusal("full key", `${table} includes ${include.getName()} in a cycle`);
      // every field of a key include is key, whatever its own flags say
      const all = (include.getFields() ?? []).map((f) => ({...f, KEYFLAG: "X"}));
      keyFields(registry, table, {getFields: () => all}, out, new Set([...seen, include.getName()]));
    } else if (!name.startsWith(".")) {
      out.set(name, field);
    }
  }
  return out;
}

// The DDIC built-in type of a field: its own, or its data element's.
function ddicType(registry, field) {
  if (!field) return undefined;
  if (field.DATATYPE) return field.DATATYPE.toUpperCase();
  return field.ROLLNAME ? registry.getObject("DTEL", field.ROLLNAME.toUpperCase())?.getDataType(registry)?.toUpperCase() : undefined;
}

export const DDIC_PROVIDER = ddicKey;
export const KEY_PROVIDERS = [DDIC_PROVIDER];

const BUILTIN = new Map([
  ["CharacterType", "CHAR"], ["CGenericType", "CHAR"], ["NumericType", "NUMC"],
  ["IntegerType", "INT4"], ["Integer8Type", "INT8"], ["PackedType", "DEC"],
  ["FloatType", "FLTP"], ["HexType", "RAW"], ["DateType", "DATS"],
  ["TimeType", "TIMS"], ["StringType", "STRING"], ["XStringType", "XSTRING"],
  ["DecFloat16Type", "DECFLOAT16"], ["DecFloat34Type", "DECFLOAT34"],
]);

// The same provider object offers declaration types to L1. The abaplint type
// is the authority; the syntax name only survives where that type is unknown.
DDIC_PROVIDER.type = (registry, type, name) => {
  const abapType = type?.getQualifiedName?.() || name;
  if (!type || unresolvedDeep(type)) return {resolved: false, abap_type: name ?? abapType ?? "unknown"};
  const result = {resolved: true};
  const builtIn = BUILTIN.get(type.constructor.name);
  if (builtIn) result.built_in = builtIn;
  if (type.getLength?.() !== undefined) result.length = type.getLength();
  if (type.getDecimals?.() !== undefined) result.decimals = type.getDecimals();
  const ddicName = type.getDDICName?.();
  if (ddicName && registry.getObject("DTEL", ddicName.toUpperCase())) result.data_element = ddicName.toLowerCase();
  if (abapType && (!builtIn || !["C", "N", "I", "P", "F", "X", "D", "T", "STRING", "XSTRING", "INT8", "DECFLOAT16", "DECFLOAT34"].includes(abapType.toUpperCase()))) {
    result.abap_type = abapType.toLowerCase();
  }
  return result;
};

export const TYPE_PROVIDERS = [DDIC_PROVIDER];
