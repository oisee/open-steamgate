// SMW0 media for a Go build: every W3MI object of the folders, its data file
// copied into a media directory beside the binary, an index w3mi.json that
// go/abap/w3mi.go reads (object id -> file, size), and the WWWPARAMS rows a
// system has for each object.
//
//   node tools/gogen/media.mjs --out <dir> <folder> ...   copy, index, print a summary
//
// As a library: collectMedia(folders) lists the objects, writeMedia(objects,
// dir) copies them, wwwparamsInserts(objects) is the rows, and
// replaceWwwparams(statements, objects) swaps the transpiler's rows for them.
//
// The object id is the <NAME> of the object's XML, upper case, which is how a
// system addresses it (the transpiler's w3mi_name.js, the same rule): the
// file name is abapGit's escaped spelling of it and not the key. The
// transpiler's DatabaseSetup writes a filesize of 0 for an object whose data
// file it was not given (tools/gogen reads .abap and .xml only), so the rows
// here carry the size of the bytes, which is what a system stores.
import {copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const unescapeXML = (v) => v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** the W3MI objects of the folders, walked in sorted order; a later folder wins an id */
export function collectMedia(folders) {
  const byId = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.w3mi\.xml$/i.test(e.name)) continue;
      const raw = readFileSync(p, "utf8");
      const head = raw.split(/<PARAMS[\s/>]/)[0];
      const name = unescapeXML(/<NAME>([^<]*)<\/NAME>/.exec(head)?.[1] ?? "").trim();
      const base = e.name.replace(/\.xml$/i, "");
      const data = readdirSync(d).filter((f) => f.toLowerCase().startsWith(`${base.toLowerCase()}.data.`)).sort();
      if (data.length !== 1) throw new Error(`${p}: ${data.length} data files`);
      const params = [...raw.matchAll(/<WWWPARAMS>\s*<NAME>([^<]*)<\/NAME>\s*<VALUE>([^<]*)<\/VALUE>\s*<\/WWWPARAMS>/g)].map((m) => [unescapeXML(m[1]), unescapeXML(m[2])]);
      const text = unescapeXML(/<TEXT>([^<]*)<\/TEXT>/.exec(head)?.[1] ?? "");
      const id = (name || base.split(".")[0]).toUpperCase();
      const file = join(d, data[0]);
      byId.set(id, {id, file, name: data[0], size: statSync(file).size, params, text});
    }
  };
  for (const f of folders) walk(f);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** copy the data files into dir and write its index */
export function writeMedia(objects, dir) {
  mkdirSync(dir, {recursive: true});
  const index = {};
  for (const o of objects) {
    copyFileSync(o.file, join(dir, o.name));
    index[o.id] = {file: o.name, size: o.size};
  }
  writeFileSync(join(dir, "w3mi.json"), JSON.stringify(index, null, 1));
  return index;
}

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

/** the WWWPARAMS rows of the objects: their own parameters, filesize in bytes, description */
export function wwwparamsInserts(objects) {
  return objects.flatMap((o) => [...o.params, ["filesize", String(o.size)], ["description", o.text]]
    .map(([k, v]) => `INSERT INTO "wwwparams" ("relid", "objid", "name", "value") VALUES ('MI', ${q(o.id)}, ${q(k)}, ${q(v)});`));
}

/** a statement list with every WWWPARAMS row of these objects replaced by wwwparamsInserts */
export function replaceWwwparams(statements, objects) {
  const ids = new Set(objects.map((o) => o.id));
  const mine = /^INSERT INTO "wwwparams" \("relid", "objid", "name", "value"\) VALUES \('MI', '((?:[^']|'')*)'/;
  const kept = statements.filter((st) => {
    const m = mine.exec(String(st));
    return m === null || !ids.has(m[1].replace(/''/g, "'"));
  });
  return [...kept, ...wwwparamsInserts(objects)];
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const argv = process.argv.slice(2);
  const oi = argv.indexOf("--out");
  if (oi < 0 || argv.length < 3) {
    console.error("usage: node tools/gogen/media.mjs --out <dir> <folder> ...");
    process.exit(2);
  }
  const out = argv.splice(oi, 2)[1];
  const objects = collectMedia(argv);
  writeMedia(objects, out);
  const bytes = objects.reduce((n, o) => n + o.size, 0);
  console.log(`media: ${objects.length} W3MI objects, ${(bytes / 1048576).toFixed(1)} MB in ${out}`);
}

