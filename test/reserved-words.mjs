import {expect} from "chai";
import {readFileSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";

// A system refuses a transparent-table field and a CDS element named like a
// word of the dictionary table TRESE, and nothing here says so: abaplint and
// the transpiler create the column (ANORMALIES zone-reserved-word). TRESE has
// 453 names on A4H and many of them are accepted (TEXT, LENGTH), so the list
// below is only the names A4H was seen refusing, each measured there
// (2026-09-24). A name found refused later belongs in it.
const REFUSED = new Set(["ZONE", "HANDLER", "SECTION", "PARAMETER"]);

function files(dir, suffix, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, suffix, out);
    else if (name.endsWith(suffix)) out.push(path);
  }
  return out;
}

const roots = ["src", ...readdirSync("packs").sort().map((pack) => join("packs", pack, "src"))]
  .filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });

/** The fields of our own (Z/Y) transparent tables. Structures are left out:
 *  they have no database table, and on A4H these names occur in structures
 *  and never in a transparent table activated since 2024 (DD03L, read
 *  2026-09-24). SAP-named tables under
 *  src/ stand in for tables a system already has and are never deployed. */
function tableFields() {
  const found = [];
  for (const file of roots.flatMap((dir) => files(dir, ".tabl.xml"))) {
    const xml = readFileSync(file, "utf8");
    const table = /<TABNAME>([^<]+)</.exec(xml)?.[1] ?? "";
    if (!/^[ZY]/.test(table) || !/<TABCLASS>TRANSP</.test(xml)) continue;
    for (const [, field] of xml.matchAll(/<FIELDNAME>([^<]+)<\/FIELDNAME>/g)) found.push({file, table, field});
  }
  return found;
}

/** The element names of the CDS views: an alias after `as`, or the bare
 *  field name of an element without one. */
function cdsElements() {
  const found = [];
  for (const file of roots.flatMap((dir) => files(dir, ".ddls.asddls"))) {
    const source = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const body = /\{([\s\S]*)\}/.exec(source)?.[1] ?? "";
    for (const line of body.split(/,\s*\n|\n/)) {
      const text = line.replace(/@[\w.]+\s*:\s*('[^']*'|[#\w.]+|\[[^\]]*\]|\{[^}]*\})/g, "").trim();
      if (text === "") continue;
      const alias = /\bas\s+([A-Za-z_]\w*)\s*,?$/i.exec(text)?.[1]
        ?? /^(?:key\s+)?(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)\s*,?$/i.exec(text)?.[1];
      if (alias !== undefined) found.push({file, element: alias});
    }
  }
  return found;
}

describe("names a system reserves (TRESE, measured on A4H)", () => {
  it("no field of an own transparent table is one", () => {
    const fields = tableFields();
    expect(fields.length, "the scan found tables").to.be.greaterThan(20);
    const hits = fields.filter(({field}) => REFUSED.has(field.toUpperCase()))
      .map(({file, table, field}) => `${table}-${field} (${file})`);
    expect(hits).to.deep.equal([]);
  });

  it("no CDS element is one", () => {
    const elements = cdsElements();
    expect(elements.length, "the scan found elements").to.be.greaterThan(20);
    const hits = elements.filter(({element}) => REFUSED.has(element.toUpperCase()))
      .map(({file, element}) => `${element} (${file})`);
    expect(hits).to.deep.equal([]);
  });

  it("the scan sees the names it is meant to catch", () => {
    // without this, a parser that finds nothing passes the two above
    const elements = cdsElements().map(({element}) => element);
    expect(elements).to.include("PickupZone").and.include("HandlerName").and.include("Category");
    const fields = tableFields().map(({table, field}) => `${table}-${field}`);
    expect(fields).to.include("ZOSD_TAXIFACT-PICKUP_ZONE").and.include("ZOSD_DB-CATEGORY");
  });
});
