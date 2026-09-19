// The signature -> metadata graph (backlog D.3).
//
// `/sap/bc/osd/rfc/functions/<NAME>` answers a module's parameters with the
// **names** of their DDIC types -- `IV_STATUS TYPE ZOSD_TEST_STATUS` -- and a
// caller that has to encode a value needs to know what that name *is*. The
// bridge builds such a graph by hand today, for one function; this builds it
// from the tree, for any of them.
//
// What it resolves, and the chain is the dictionary's own:
//
//   DTEL -> DOMA          a data element names a domain, and the domain
//                         carries DATATYPE / LENG / DECIMALS. The element
//                         itself usually carries none: `ZOSD_TEST_STATUS`
//                         has `<DOMNAME>` and no `<DATATYPE>`, which is why
//                         reading the element alone yields nothing
//   TABL / TTYP -> fields  a structure is its components, each of which is a
//                         type again, so the closure is walked rather than
//                         one level taken
//
// **A type this tree does not hold is reported as unresolved, by name.** The
// alternative -- defaulting to CHAR -- is what a caller would encode with,
// and encoding a packed number as characters is the silent kind of wrong.
// The ABAP type letter of a dictionary type. It lives here because it is
// decided together with the type, and a second copy of it somewhere else
// would be a pair obliged to agree -- `tools/adt-documents.mjs` imports it
// from here for the data preview, so the letter a codec encodes with is the
// letter the preview shows.
export const ABAP_TYPE_LETTER = {
  CHAR: "C", CLNT: "C", CUKY: "C", LANG: "C", UNIT: "C", ACCP: "C", NUMC: "N", DATS: "D", TIMS: "T",
  INT1: "b", INT2: "s", INT4: "X", INT8: "8", DEC: "P", CURR: "P", QUAN: "P", FLTP: "F",
  RAW: "X", RSTR: "y", STRG: "g", SSTR: "g", LRAW: "X", LCHR: "C", DF16_DEC: "a", DF34_DEC: "e",
};

const tag = (xml, name) => {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(String(xml));
  return m === null ? "" : m[1].replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"').replaceAll("&amp;", "&");
};
const int = (xml, name) => Number.parseInt(tag(xml, name) || "0", 10);

const read = (store, type, name) => {
  try {
    return String(store.read(type, name)?.source ?? "");
  } catch {
    return undefined;
  }
};

/** One type, resolved as far as this tree can. Recurses through the
 *  components of a structure; `seen` stops a type that contains itself. */
export function resolveType(store, name, seen = new Set()) {
  const key = String(name ?? "").toUpperCase();
  if (key === "") return {NAME: "", KIND: "UNKNOWN", REASON: "no type named"};
  if (seen.has(key)) return {NAME: key, KIND: "CYCLE"};
  seen.add(key);

  // a built-in ABAP type is not in the dictionary and needs no lookup
  const BUILTIN = {STRING: "g", XSTRING: "y", I: "I", F: "F", D: "D", T: "T", C: "C", N: "N", P: "P", X: "X"};
  if (BUILTIN[key] !== undefined) {
    return {NAME: key, KIND: "BUILTIN", DATATYPE: key, LETTER: BUILTIN[key]};
  }

  const dtel = read(store, "DTEL", key);
  if (dtel !== undefined) {
    const domain = tag(dtel, "DOMNAME");
    const out = {
      NAME: key, KIND: "DTEL", DOMAIN: domain,
      DATATYPE: tag(dtel, "DATATYPE"),
      LENG: int(dtel, "LENG"),
      DECIMALS: int(dtel, "DECIMALS"),
      TEXT: tag(dtel, "DDTEXT") || tag(dtel, "SCRTEXT_M"),
    };
    // **the element usually carries none of it.** `REFKIND: D` means the type
    // is the domain's, and reading the element alone answers "" -- which is
    // how a CHAR(1) reads as an empty type
    if (out.DATATYPE === "" && domain !== "") {
      const doma = read(store, "DOMA", domain);
      if (doma === undefined) {
        return {...out, KIND: "UNRESOLVED", REASON: `domain ${domain} is not in this tree`};
      }
      out.DATATYPE = tag(doma, "DATATYPE");
      out.LENG = int(doma, "LENG");
      out.DECIMALS = int(doma, "DECIMALS");
    }
    out.LETTER = ABAP_TYPE_LETTER[out.DATATYPE] ?? "C";
    return out;
  }

  for (const [type, kind] of [["TABL", "STRUCTURE"], ["TTYP", "TABLE"]]) {
    const xml = read(store, type, key);
    if (xml === undefined) continue;
    if (kind === "TABLE") {
      const row = tag(xml, "ROWTYPE");
      return {NAME: key, KIND: "TABLE", ROWTYPE: row,
        ROW: row === "" ? undefined : resolveType(store, row, seen)};
    }
    const fields = [];
    for (const block of xml.matchAll(/<DD03P>([\s\S]*?)<\/DD03P>/g)) {
      const f = block[1];
      const fieldName = tag(f, "FIELDNAME");
      if (fieldName === "" || fieldName.startsWith(".")) continue;
      const element = tag(f, "ROLLNAME");
      const inline = tag(f, "DATATYPE");
      fields.push({
        NAME: fieldName,
        KEY: tag(f, "KEYFLAG") === "X",
        // a field types itself either by a data element or inline; the first
        // is a type of its own and is resolved as one
        ...(element !== "" && inline === ""
          ? {ELEMENT: element, TYPE: resolveType(store, element, seen)}
          : {DATATYPE: inline, LENG: int(f, "LENG"), DECIMALS: int(f, "DECIMALS"),
             LETTER: ABAP_TYPE_LETTER[inline] ?? "C"}),
      });
    }
    return {NAME: key, KIND: "STRUCTURE", TEXT: tag(xml.split("<DD03P_TABLE>")[0], "DDTEXT"), FIELDS: fields};
  }

  return {NAME: key, KIND: "UNRESOLVED", REASON: "no DTEL, TABL or TTYP of that name in this tree"};
}

/** The closure of types a signature mentions, keyed by name.
 *
 *  Flat rather than nested at the top level, because a graph is what the
 *  caller wants: two parameters of one type are one entry, and a structure's
 *  components point at entries rather than repeating them. */
export function typeGraph(store, parameters = []) {
  const types = {};
  for (const p of parameters) {
    const name = String(p.TYPE ?? p.type ?? "").toUpperCase();
    if (name === "" || types[name] !== undefined) continue;
    types[name] = resolveType(store, name);
  }
  return types;
}
