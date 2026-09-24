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
    } else if (datatype === "RAW" && leng !== undefined) {
      // a RAW(n) is its 2n hex digits in upper case, 00-padded, as a system
      // holds n bytes (ANOMALY-2026-09-24-raw-columns): abapGit's file may
      // carry fewer, and an equal comparison with a full value would miss
      lengths.set(name, {pad: 0, hex: 2 * Number(leng)});
    } else if (datatype === "DATS") {
      // **The file holds an ISO date and the runtime holds the internal one.**
      // These seed files are abapGit's own TABU JSON -- its data serialiser
      // names the folder, the file and the format -- and abapGit's ajson
      // insists on YYYY-MM-DD for a DATS field: `to_date` matches
      // `^(\d{4})-(\d{2})-(\d{2})(T|$)` and raises "Unexpected date format"
      // otherwise. We used to write 20260915, which is the internal form, so
      // the file looked like abapGit's and was not (A4H refused the import,
      // 2026-09-19). The conversion belongs on this side, in the reader.
      lengths.set(name, {pad: 0, date: true});
    } else {
      lengths.set(name, {pad: 0});
    }
  }
  return lengths;
}

function quote(value, pad, isDate = false, hex = 0) {
  if (typeof value === "number") {
    return String(value);
  }
  let s = String(value ?? "");
  if (hex > 0) s = s.toUpperCase().slice(0, hex).padEnd(hex, "0");
  if (isDate) {
    // ISO in the file, internal in the database; anything else is left as it
    // is, so a value that is already internal still works
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso !== null) s = iso[1] + iso[2] + iso[3];
  }
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
    // **One statement per batch of rows, not per row.**
    //
    // Measured by fable-osd's SQL trace over `npm run unit`: 4706 of 6793
    // statements and 553 ms of 1563 went into three tables seeded a row at a
    // time, and 2263 of the seeder's own 2521 statements were one table.
    // A multi-row `VALUES` is the same insert on all three engines, and the
    // cost of a statement here is its parse, not its rows.
    //
    // Batched by **the column list**, not by the table: two rows of one table
    // can carry different columns (a TABU JSON row omits what it has no value
    // for), and merging those would put a value under the wrong name. So a
    // batch ends when the shape changes, which also keeps the order the file
    // had -- rows of one table are inserted in the order they are written,
    // and a pack's rows still land after the ones they layer over.
    let batch = [];
    let shape;
    const flush = () => {
      if (batch.length === 0) return;
      statements.push(`INSERT INTO "${table}" (${shape.map((c) => `"${c}"`).join(", ")}) VALUES ` +
        `${batch.map((v) => `(${v.join(", ")})`).join(", ")};`);
      batch = [];
    };
    for (const row of rows) {
      const cols = Object.keys(row);
      if (shape === undefined || cols.length !== shape.length || cols.some((c, i) => c !== shape[i])) {
        flush();
        shape = cols;
      }
      batch.push(cols.map((c) => quote(row[c], lengths.get(c)?.pad ?? 0, lengths.get(c)?.date === true, lengths.get(c)?.hex ?? 0)));
      // a bound on the statement rather than on the row count: engines differ
      // on how long a statement may be, and none of them differ on this being
      // far inside it
      if (batch.length >= 500) flush();
    }
    flush();
  }
  return statements;
}
