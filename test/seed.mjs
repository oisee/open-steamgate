// Turns abapGit TABU captures (data/<table>.tabu.json, the format
// `abapGit serialize` writes for table contents) into INSERT statements for
// the transpiler's SQLite schema. CHAR/NUMC values are right-padded to their
// DDIC length because the runtime stores them padded (Character.set pads).
// No abapGit dependency: the JSON is a plain array of row objects.
import {readdirSync, readFileSync} from "node:fs";
import {dataDirsOf, ddicDirsOf} from "../tools/osd-packs.mjs";
import {join} from "node:path";

function fieldLengths(tablXml) {
  const lengths = new Map();
  const re = /<DD03P>([\s\S]*?)<\/DD03P>/g;
  let m;
  while ((m = re.exec(tablXml)) !== null) {
    const block = m[1];
    const name = /<FIELDNAME>([^<]+)</.exec(block)?.[1]?.toLowerCase();
    const datatype = /<DATATYPE>([^<]+)</.exec(block)?.[1];
    const leng = /<LENG>0*(\d+)</.exec(block)?.[1];
    const rollname = /<ROLLNAME>([^<]+)</.exec(block)?.[1];
    if (name === undefined) {
      continue;
    }
    if (rollname === "MANDT") {
      lengths.set(name, {pad: 3});
    } else if ((datatype === "CHAR" || datatype === "NUMC") && leng !== undefined) {
      lengths.set(name, {pad: Number(leng)});
    } else {
      lengths.set(name, {pad: 0});
    }
  }
  return lengths;
}

function quote(value, pad) {
  if (typeof value === "number") {
    return String(value);
  }
  let s = String(value ?? "");
  if (pad > 0) {
    s = s.padEnd(pad, " ");
  }
  return "'" + s.replaceAll("'", "''") + "'";
}

// Every folder of seed rows, the tree's own and each pack's, in layer order
// so a pack's rows for a table it shares are inserted after (backlog E.2).
// Called with a folder it seeds only that one, which is what the tools do.
export function seedStatements(dataDir, ddicDir) {
  if (dataDir !== undefined) {
    return seedFrom(dataDir, [ddicDir ?? "src/ddic", "src/segw/ddic", "src/zosd_test/ddic"]);
  }
  const root = process.env.OSD_ROOT ?? process.cwd();
  const ddic = ddicDirsOf(root);
  return dataDirsOf(root).flatMap((dir) => seedFrom(dir, ddic));
}

function seedFrom(dataDir, ddicDirs) {
  const statements = [];
  for (const file of readdirSync(dataDir).sort()) {
    if (!file.endsWith(".tabu.json")) {
      continue;
    }
    const table = file.slice(0, -".tabu.json".length).toLowerCase();
    const rows = JSON.parse(readFileSync(join(dataDir, file), "utf8"));
    let lengths = new Map();
    for (const dir of ddicDirs) {
      try {
        lengths = fieldLengths(readFileSync(join(dir, table + ".tabl.xml"), "utf8"));
        break;
      } catch {
        // table defined elsewhere or in a lib: insert unpadded, the runtime pads on read
      }
    }
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map((c) => quote(row[c], lengths.get(c)?.pad ?? 0));
      statements.push(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${vals.join(", ")});`);
    }
  }
  return statements;
}
