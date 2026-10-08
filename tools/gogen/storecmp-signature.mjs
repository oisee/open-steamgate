// Read the STORE caller's contract, including fields it declares but may not
// inspect. Unknown declaration shapes fail closed rather than shrink parity.
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

export const ADT_SCALARS = ["EV_SOURCE", "EV_FILE", "EV_STATE", "EV_CHANGED", "EV_PACKAGE", "EV_VERSION", "EV_NOTE", "EV_JSON", "EV_ERROR"];

export function adtStoreSignature(root, scalars = ADT_SCALARS) {
  const files = (dir) => readdirSync(dir, {withFileTypes: true}).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
  const ddic = new Map(files(join(root, "src")).filter((f) => f.endsWith(".tabl.xml"))
    .map((f) => [f.split("/").at(-1).split(".")[0].toUpperCase(), f]));
  const tables = {};
  for (const file of files(join(root, "src", "adt")).filter((f) => f.endsWith(".abap"))) {
    const source = readFileSync(file, "utf8").replace(/^\s*\*.*$/gm, "").toUpperCase();
    const declarations = new Map([...source.matchAll(/\b(?:DATA|TYPES)\s+(\w+)\s+TYPE\s+([^.,]+)[.,]/g)]
      .map((m) => [m[1], m[2].trim()]));
    for (const call of source.matchAll(/CALL\s+FUNCTION\s+'ZOSD_STORE'\s+DESTINATION\s+'STORE'([\s\S]*?)\./g)) {
      for (const section of call[1].matchAll(/\b(IMPORTING|TABLES)\s+([\s\S]*?)(?=\b(?:EXPORTING|IMPORTING|TABLES|EXCEPTIONS)\b|$)/g)) {
        for (const param of section[2].matchAll(/\b(\w+)\s*=\s*(\w+)/g)) {
          const [, name, variable] = param;
          if (section[1] === "IMPORTING") {
            if (!scalars.includes(name)) throw new Error(`${file}: harness missing scalar ${name}`);
            continue;
          }
          if (!["ET_OBJECT", "ET_REVISION"].includes(name)) throw new Error(`${file}: harness missing table comparison ${name}`);
          let type = declarations.get(variable);
          const seen = new Set();
          while (type && declarations.has(type) && !seen.has(type)) {
            seen.add(type);
            type = declarations.get(type);
          }
          const row = type?.match(/^(?:STANDARD|SORTED|HASHED)?\s*TABLE\s+OF\s+(\w+)\b/)?.[1];
          if (!row || !ddic.has(row)) throw new Error(`${file}: cannot resolve ${name} row declaration ${variable}: ${type}`);
          const xml = readFileSync(ddic.get(row), "utf8");
          const fields = [...xml.matchAll(/<FIELDNAME>([^<]+)<\/FIELDNAME>/g)].map((m) => m[1].trim().toLowerCase());
          if (!fields.length || fields.some((f) => !/^\w+$/.test(f))) throw new Error(`${file}: unsupported row ${row}`);
          if (tables[name] && JSON.stringify(tables[name]) !== JSON.stringify(fields)) throw new Error(`${file}: inconsistent ${name} declarations`);
          tables[name] = fields;
        }
      }
    }
  }
  if (!Object.keys(tables).length) throw new Error("No ADT STORE table declarations found");
  return tables;
}
