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
// push / pull do the same through a running gateway (npm start) and
// ZSTG_SEGW_SRV: push POSTs the file to ImportSet as Content, one call,
// (the *.fugr.xml next to the file go to FunctionGroupSet first: the module
// signatures for operations mapped to a function module)
// and zcl_stg_segw_import replaces the project's rows in the database
// (--rows instead: DELETE the project's rows in every table and POST the
// file's rows one by one, the generic CRUD only); pull GETs
// ExportSet('P'), the file written by zcl_stg_segw_export in ABAP
// (--rows instead: GET every set ordered by StgSeq and write it here).
// repo writes the whole abapGit repository of a project (RepoFileSet, and
// RepoSet for the same as one zip), what a system pulls to have it -- and
// only when a unit of deploy/manifest.json lists every object in it
// (--unit, or the unit that lists IWPR <PROJECT>), never an SAP-owned name.
//
// Usage: node tools/segw-tree.mjs import <file.iwpr.xml> [--data data]
//        node tools/segw-tree.mjs export <PROJECT> [--data data] [--out <file>]
//        node tools/segw-tree.mjs check <file.iwpr.xml>... (exit 1 on a difference)
//        node tools/segw-tree.mjs push <file.iwpr.xml> [--rows] [--url http://localhost:3030]
//        node tools/segw-tree.mjs pull <PROJECT> [--rows] [--url http://localhost:3030] [--out <file>]
//        node tools/segw-tree.mjs generate <PROJECT> [--url http://localhost:3030] [--out <dir>]
//        node tools/segw-tree.mjs repo <PROJECT> --out <dir> [--zip <file>] [--unit u] [--url ...]
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {CLIENT, SEQ_FIELD, escape, iwprTables, propertyName, readSpec, tableName} from "./segw-tables.mjs";
import {runsAs} from "./osd-main.mjs";
import {admit, loadManifest, refusalMessage, unitForProject} from "./osd-deploy-manifest.mjs";
import {zip as zipFolder} from "./osd-abapgit-zip.mjs";

export const DATA_DIR = "data";
export const SERVICE = "/sap/opu/odata/sap/ZSTG_SEGW_SRV";
export const DEFAULT_URL = `http://localhost:${process.env.STG_PORT ?? 3030}`;

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
  // A BOM: every real IWPR has one (EF BB BF on all 44 corpus files and on
  // everything abapGit wrote for S_APS_ODATA_GBT_NTE). Without it the round
  // trip here loses a byte it was given, which is how the defect showed:
  // import kept the BOM and export dropped it.
  return `\ufeff<?xml version="1.0" encoding="utf-8"?>
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

// ------------------------------------------------------ through the service

async function odata(base, method, path, body) {
  const res = await fetch(base + SERVICE + path, {
    method,
    headers: body === undefined ? {} : {"content-type": "application/json"},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status >= 300) {
    throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  }
  return text === "" ? undefined : JSON.parse(text);
}

// the rows of one table and project, as the service returns them
async function fetchRows(base, tag, project, spec) {
  const set = `${spec[tag].entity}Set`;
  const query = `?$filter=${encodeURIComponent(`Project eq '${project}'`)}&$orderby=StgSeq&$format=json`;
  const json = await odata(base, "GET", `/${set}${query}`);
  return json.d.results;
}

// a result of the service -> a row with lower-case field names, as data/ has them
function rowOf(result, tag, spec) {
  const row = {mandt: CLIENT};
  for (const f of Object.keys(spec[tag].fields)) {
    const v = result[propertyName(f)];
    if (v !== undefined && v !== null && v !== "") {
      row[f.toLowerCase()] = String(v);
    }
  }
  row[SEQ_FIELD.toLowerCase()] = Number(result[propertyName(SEQ_FIELD)]);
  return row;
}

function keyOf(result, tag, spec) {
  return spec[tag].keys.map((k) => `${propertyName(k)}='${encodeURIComponent(String(result[propertyName(k)] ?? "")).replaceAll("'", "''")}'`).join(",");
}

// every abapGit function group in a folder to FunctionGroupSet: the module
// signatures the generator needs for operations mapped to a function module
export async function pushFunctionGroups(base, folder) {
  const out = [];
  for (const name of existsSync(folder) ? readdirSync(folder) : []) {
    if (!name.endsWith(".fugr.xml")) {
      continue;
    }
    const json = await odata(base, "POST", "/FunctionGroupSet", {Name: name.slice(0, -".fugr.xml".length).toUpperCase(), Content: readFileSync(join(folder, name), "utf8").replace(/^\uFEFF/, "")});
    out.push({file: name, modules: json.d.Modules, rows: json.d.Rows});
  }
  return out;
}

// the file to ImportSet: the service parses it and replaces the project
export async function pushFile(base, xml) {
  const json = await odata(base, "POST", "/ImportSet", {Content: xml});
  return {project: json.d.Project, posted: json.d.Rows, tables: json.d.Tables};
}

// replace the project's rows in every table with the file's, row by row
export async function push(base, tables, project, spec) {
  let deleted = 0;
  let posted = 0;
  for (const tag of Object.keys(spec)) {
    const set = `${spec[tag].entity}Set`;
    for (const result of await fetchRows(base, tag, project, spec)) {
      await odata(base, "DELETE", `/${set}(${keyOf(result, tag, spec)})`);
      deleted++;
    }
    for (const row of tables.get(tag) ?? []) {
      const body = {};
      for (const f of Object.keys(spec[tag].fields)) {
        if (row[f.toLowerCase()] !== undefined) {
          body[propertyName(f)] = row[f.toLowerCase()];
        }
      }
      body[propertyName(SEQ_FIELD)] = Number(row[SEQ_FIELD.toLowerCase()]);
      await odata(base, "POST", `/${set}`, body);
      posted++;
    }
  }
  return {deleted, posted};
}

// the project as a file, written by the service
export async function pullFile(base, project) {
  const json = await odata(base, "GET", `/ExportSet('${encodeURIComponent(project).replaceAll("'", "''")}')?$format=json`);
  return json.d.Content;
}

// the abapGit repository of a project: the files the service writes
export async function repoFiles(base, project) {
  const query = `?$filter=${encodeURIComponent(`Project eq '${project}'`)}&$format=json`;
  const json = await odata(base, "GET", `/RepoFileSet${query}`);
  return Object.fromEntries(json.d.results.map((r) => [r.Name, r.Content]));
}

/** The repository's objects against deploy/manifest.json: the same check
 *  osd-abapgit-zip makes, because this is the other writer of a repository
 *  a system can pull. Throws with every refusal named. Only `.abapgit.xml`
 *  and flat `src/` objects may be in it; the zip is then made here out of
 *  the admitted files, never fetched from RepoSet, so the bytes that leave
 *  are the bytes that were checked. */
export function admitRepo(files, project, {manifest = loadManifest(), unit} = {}) {
  const chosen = unitForProject(manifest, project, unit);
  const src = Object.fromEntries(Object.entries(files)
    .filter(([name]) => name.startsWith("src/")).map(([name, content]) => [name.slice(4), content]));
  const nested = Object.keys(src).filter((n) => n.includes("/"));
  const refusals = admit({files: Object.keys(src).filter((n) => !n.includes("/")), read: (f) => src[f], unit: chosen});
  for (const n of nested) refusals.push({file: n, key: "?", rule: "not-an-object", why: "a sub-folder is a sub-package"});
  for (const n of Object.keys(files).filter((p) => !p.startsWith("src/") && p !== ".abapgit.xml")) {
    refusals.push({file: n, key: "?", rule: "not-an-object", why: "outside src/, and not .abapgit.xml"});
  }
  if (refusals.length > 0) throw new Error(refusalMessage(`RepoFileSet ${project}`, refusals));
  return chosen;
}

// the same as one zip (base64 from the service)
export async function repoZip(base, project) {
  const json = await odata(base, "GET", `/RepoSet('${encodeURIComponent(project).replaceAll("'", "''")}')?$format=json`);
  return {zip: Buffer.from(json.d.Content, "base64"), files: Number(json.d.Files)};
}

// the generated classes of a project, made in ABAP (zcl_stg_segw_gen)
export async function generateFiles(base, project) {
  const query = `?$filter=${encodeURIComponent(`Project eq '${project}'`)}&$format=json`;
  const json = await odata(base, "GET", `/GenerateSet${query}`);
  return Object.fromEntries(json.d.results.map((r) => [r.Name, r.Content]));
}

// the project's rows, set by set
export async function pull(base, project, spec) {
  const tables = new Map();
  for (const tag of Object.keys(spec)) {
    const rows = (await fetchRows(base, tag, project, spec)).map((r) => rowOf(r, tag, spec));
    if (rows.length > 0) {
      tables.set(tag, rows);
    }
  }
  return tables;
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

export async function main(args) {
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
  const url = opt("--url", DEFAULT_URL);
  if (cmd === "push") {
    const xml = readFileSync(rest[0], "utf8").replace(/^\uFEFF/, "");
    if (args.includes("--rows")) {
      const tables = importIwpr(xml, spec);
      const project = projectOf(tables);
      const {deleted, posted} = await push(url, tables, project, spec);
      console.log(`${project}: ${posted} rows posted to ${url}${SERVICE}, ${deleted} old rows deleted`);
    } else {
      for (const g of await pushFunctionGroups(url, dirname(rest[0]))) {
        console.log(`${g.file}: ${g.modules} modules, ${g.rows} parameters through ${url}${SERVICE}/FunctionGroupSet`);
      }
      const {project, posted, tables} = await pushFile(url, xml);
      console.log(`${project}: ${posted} rows into ${tables} tables through ${url}${SERVICE}/ImportSet`);
    }
    return 0;
  }
  if (cmd === "pull") {
    const xml = args.includes("--rows") ? exportIwpr(await pull(url, rest[0], spec), rest[0], spec) : await pullFile(url, rest[0]);
    const out = opt("--out");
    if (out) {
      writeFileSync(out, xml);
    } else {
      process.stdout.write(xml);
    }
    return 0;
  }
  if (cmd === "generate") {
    const files = await generateFiles(url, rest[0]);
    const out = opt("--out");
    for (const [name, content] of Object.entries(files)) {
      if (out) {
        writeFileSync(join(out, name), content);
      } else {
        process.stdout.write(content);
      }
    }
    console.error(`${rest[0]}: ${Object.keys(files).join(", ")}${out ? ` written to ${out}` : ""}`);
    return 0;
  }
  if (cmd === "repo") {
    const out = opt("--out");
    const files = await repoFiles(url, rest[0]);
    // fail closed before anything is written: this is a route to a system
    try {
      admitRepo(files, rest[0], {unit: opt("--unit")});
    } catch (e) {
      console.error(e.message);
      return 1;
    }
    const zipFile = opt("--zip");
    // the zip is made from exactly the admitted files, not fetched again
    const into = out ?? (zipFile ? mkdtempSync(join(tmpdir(), "segw-repo-")) : undefined);
    if (into) {
      for (const [name, content] of Object.entries(files)) {
        const target = join(into, name);
        mkdirSync(dirname(target), {recursive: true});
        writeFileSync(target, content);
      }
    }
    if (zipFile) {
      zipFolder(into, zipFile);
      if (!out) rmSync(into, {recursive: true, force: true});
    }
    console.log(`${rest[0]}: ${Object.keys(files).length} files${out ? ` written to ${out}/` : ""}${zipFile ? `, zip ${zipFile}` : ""}`);
    return 0;
  }
  console.log("usage: segw-tree.mjs import <file> | export <PROJECT> [--out f] | check <file>... [--data dir] | push <file> | pull <PROJECT> [--out f] | generate <PROJECT> [--out dir] | repo <PROJECT> --out <dir> [--zip f] [--unit u] [--url u]");
  return 2;
}

if (runsAs("segw-tree.mjs")) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(e.message);
    process.exit(1);
  });
}
