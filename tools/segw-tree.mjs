// SEGW project tree: <project>.iwpr.xml <-> our tables (data/zstg_sb*.tabu.json).
//
// import: every table block of the IWPR file becomes rows of ZSTG_<table>
// (client 123, STG_SEQ = position in the file); rows the data folder
// already holds for that project are replaced, other projects stay.
// export: the rows of a project back into abapGit's IWPR form: tables in
// alphabetical order (the order abapGit writes them), rows by STG_SEQ,
// fields in the order of the spec (SEGW's DDIC order), initial fields left
// out, XML-escaped as abapGit does. check: import into memory, export,
// compare with the file byte for byte.
//
// Usage: node tools/segw-tree.mjs import <file.iwpr.xml> [--data data]
//        node tools/segw-tree.mjs export <PROJECT> [--data data] [--out <file>]
//        node tools/segw-tree.mjs check <file.iwpr.xml>... (exit 1 on a difference)
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {CLIENT, SEQ_FIELD, escape, iwprTables, readSpec, tableName} from "./segw-tables.mjs";

export const DATA_DIR = "data";

const dataFile = (dir, tag) => join(dir, `${tableName(tag).toLowerCase()}.tabu.json`);

// IWPR text -> {tag: rows} with lower-case column names, as the seed wants
export function importIwpr(xml, spec) {
  const out = new Map();
  for (const [tag, rows] of iwprTables(xml)) {
    if (!spec[tag]) {
      throw new Error(`${tag}: not in ${Object.keys(spec).length} tables of the spec, run segw-tables --derive`);
    }
    const project = rows[0]?.PROJECT;
    out.set(tag, rows.map((row, i) => {
      const r = {mandt: CLIENT};
      for (const f of Object.keys(spec[tag].fields)) {
        if (row[f] !== undefined) {
          r[f.toLowerCase()] = row[f];
        }
      }
      for (const f of Object.keys(row)) {
        if (!(f in spec[tag].fields)) {
          throw new Error(`${tag}.${f}: not in the spec`);
        }
      }
      if (r.project !== project) {
        throw new Error(`${tag}: rows of more than one project (${project}, ${r.project})`);
      }
      r[SEQ_FIELD.toLowerCase()] = i + 1;
      return r;
    }));
  }
  return out;
}

export function projectOf(tables) {
  for (const rows of tables.values()) {
    if (rows.length > 0) {
      return rows[0].project;
    }
  }
  return undefined;
}

// {tag: rows} of one project -> IWPR text
export function exportIwpr(tables, project, spec) {
  let body = "";
  for (const tag of Object.keys(spec)) {
    const rows = (tables.get(tag) ?? []).filter((r) => r.project === project).sort((a, b) => Number(a.stg_seq) - Number(b.stg_seq));
    if (rows.length === 0) {
      continue;
    }
    body += `   <_-IWBEP_-I_${tag}>\n`;
    for (const row of rows) {
      body += `    <_-IWBEP_-I_${tag}>\n`;
      for (const f of Object.keys(spec[tag].fields)) {
        const v = row[f.toLowerCase()];
        if (v !== undefined && v !== "") {
          body += `     <${f}>${escape(v)}</${f}>\n`;
        }
      }
      body += `    </_-IWBEP_-I_${tag}>\n`;
    }
    body += `   </_-IWBEP_-I_${tag}>\n`;
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_IWPR" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
${body}  </asx:values>
 </asx:abap>
</abapGit>
`;
}

export function readData(dir, spec) {
  const out = new Map();
  for (const tag of Object.keys(spec)) {
    const f = dataFile(dir, tag);
    if (existsSync(f)) {
      out.set(tag, JSON.parse(readFileSync(f, "utf8")));
    }
  }
  return out;
}

// merge one project's rows into the data folder
export function writeData(dir, tables, project, spec) {
  const existing = readData(dir, spec);
  const written = [];
  for (const tag of Object.keys(spec)) {
    const kept = (existing.get(tag) ?? []).filter((r) => r.project !== project);
    const rows = [...kept, ...(tables.get(tag) ?? [])];
    if (rows.length === 0 && !existing.has(tag)) {
      continue;
    }
    writeFileSync(dataFile(dir, tag), JSON.stringify(rows, null, 1) + "\n");
    written.push(tag);
  }
  return written;
}

// first differing line, for the report
export function firstDifference(a, b) {
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      return {line: i + 1, file: la[i], exported: lb[i]};
    }
  }
  return undefined;
}

function main(args) {
  const spec = readSpec();
  const opt = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : fallback;
  };
  const dir = opt("--data", DATA_DIR);
  const [cmd, ...rest] = args;
  if (cmd === "import") {
    const xml = readFileSync(rest[0], "utf8");
    const tables = importIwpr(xml, spec);
    const project = projectOf(tables);
    const written = writeData(dir, tables, project, spec);
    console.log(`${project}: ${[...tables.values()].reduce((n, r) => n + r.length, 0)} rows into ${written.length} tables under ${dir}/`);
    return 0;
  }
  if (cmd === "export") {
    const xml = exportIwpr(readData(dir, spec), rest[0], spec);
    const out = opt("--out");
    if (out) {
      writeFileSync(out, xml);
    } else {
      process.stdout.write(xml);
    }
    return 0;
  }
  if (cmd === "check") {
    let bad = 0;
    for (const file of rest.filter((a) => !a.startsWith("--"))) {
      // abapGit writes a byte order mark, stg-compile does not; neither is data
      const xml = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
      const tables = importIwpr(xml, spec);
      const back = exportIwpr(tables, projectOf(tables), spec);
      const diff = firstDifference(xml, back);
      if (diff) {
        bad++;
        console.log(`${file}: differs at line ${diff.line}\n  file:     ${diff.file}\n  exported: ${diff.exported}`);
      } else {
        console.log(`${file}: identical`);
      }
    }
    return bad === 0 ? 0 : 1;
  }
  console.log("usage: segw-tree.mjs import <file> | export <PROJECT> [--out f] | check <file>...  [--data dir]");
  return 2;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  process.exit(main(process.argv.slice(2)));
}
