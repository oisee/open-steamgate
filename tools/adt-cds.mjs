// A CDS entity, described the way the data preview needs it.
//
// F8 on a CDS view is not F8 on a table, and the difference is not the rows
// — it is the names. A CDS element has a name of its own, written in the
// source in mixed case (TravelId), and the client shows that alongside the
// upper-case column the database actually has (TRAVELID). The type, the
// length and the description behind it belong to the base table's field,
// because a projection does not restate them.
//
// So this joins two things that already exist: abaplint's parse of the DDLS,
// which gives the element names and which are keys, and tableFieldsOf, which
// reads the base table's DDIC metadata out of the abapGit XML. Nothing here
// re-derives a type.
//
// The scope is deliberately the same as tools/cds2ddic.mjs: a projection of
// one table or view. A join has no single base table to ask, and this says
// so rather than guessing.
import {tableFieldsOf} from "./adt-documents.mjs";

// the element's database column. A CDS projection of one table writes
// `travel_id as TravelId`, so the column is the prefixed name before the
// alias; with no alias the element IS the column.
function columnOf(element) {
  const base = element.base ?? element.name;
  return String(base).split(".").pop().toUpperCase();
}

// Walk the parse for `<column> as <Alias>` pairs. abaplint's parsed data
// gives the element names and keys but not the column behind each one, so
// the tree supplies that half.
function elementsOf(tree, parsed) {
  const nodeName = (n) => n.get?.().constructor?.name ?? "";
  const kids = (n) => n.getChildren?.() ?? [];
  const find = (n, name) => {
    const out = [];
    const rec = (x) => {
      if (nodeName(x) === name) out.push(x);
      for (const c of kids(x)) rec(c);
    };
    rec(n);
    return out;
  };
  const byName = new Map((parsed.fields ?? []).map((f) => [f.name.toUpperCase(), f]));
  const out = [];
  for (const el of find(tree, "CDSElement")) {
    const as = kids(el).find((c) => nodeName(c) === "CDSAs");
    const alias = as ? kids(as).find((c) => nodeName(c) === "CDSName")?.concatTokens?.() : undefined;
    const src = kids(el).find((c) => nodeName(c) === "CDSName" || nodeName(c) === "CDSPrefixedName");
    const srcName = src ? src.concatTokens().replace(/\s+/g, "") : undefined;
    if (srcName === undefined || srcName.startsWith("_")) {
      continue; // an exposed association is not a column
    }
    if (/[()+\-*/]/.test(srcName) || srcName.startsWith("'")) {
      continue; // an expression has no base field to describe
    }
    const name = (alias ?? srcName.split(".").pop());
    const parsedField = byName.get(name.toUpperCase());
    out.push({name: name.toUpperCase(), camelCaseName: name, base: columnOf({base: srcName}), key: parsedField?.key === true});
  }
  return out;
}

// The entity: its names, and a field list shaped like tableFieldsOf's, so
// the same document generator can render either.
export function cdsEntityOf(store, name) {
  const registry = store.registry();
  const object = registry.getObject("DDLS", String(name).toUpperCase());
  if (object === undefined) {
    return undefined;
  }
  const parsed = object.getParsedData?.();
  if (parsed?.tree === undefined) {
    return undefined;
  }
  const sources = (parsed.sources ?? []).map((s) => String(s.name ?? s).toUpperCase());
  const elements = elementsOf(parsed.tree, parsed);

  // the base table's DDIC metadata, when there is exactly one base. With a
  // join there is no single table to ask, so the columns keep their names
  // and lose their types rather than being given invented ones.
  let base = new Map();
  if (sources.length === 1) {
    for (const source of [["TABL", sources[0]], ["VIEW", sources[0]]]) {
      try {
        const entry = store.read(source[0], source[1]);
        base = new Map(tableFieldsOf(store, entry).fields.map((f) => [f.name.toUpperCase(), f]));
        break;
      } catch {
        // the next kind, or none: handled by the empty map
      }
    }
  }

  const fields = elements.map((e) => {
    const from = base.get(e.base) ?? {};
    return {
      name: e.name,
      camelCaseName: e.camelCaseName,
      key: e.key,
      dataType: from.dataType ?? "",
      length: from.length ?? 0,
      decimals: from.decimals ?? 0,
      description: from.description || e.camelCaseName,
      letter: from.letter ?? "C",
    };
  });

  return {
    name: object.getName().toUpperCase(),
    sqlView: (parsed.sqlViewName ?? object.getName()).toUpperCase(),
    description: parsed.description ?? "",
    source: sources[0],
    fields,
  };
}
