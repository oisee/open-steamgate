// A folder of abapGit-named objects, as a zip abapGit will import.
//
//   node tools/osd-abapgit-zip.mjs <src/…/x.stg.yaml | folder> --out <file.zip>
//                                  [--description "…"]
//
// Why this exists (Alice, 2026-09-19). The last mile of this project is
// "SEGW project offline -> abapGit -> a system", and it is the one arc of the
// README's loop that had never been walked. It stopped on a system with no
// abapGit installed: the three SEGW objects -- IWPR, IWSV, IWMO -- are not
// ADT object types, so nothing else can put them there, and abapGit's own
// standalone report would not activate on that release. So the machine route
// is blocked and the human one is not: a zip, imported by hand.
//
// The shape is the one `zcl_stg_segw_repo` writes, and deliberately so: the
// same repository whether it is built here in JavaScript or there in ABAP.
// `.abapgit.xml` with STARTING_FOLDER /src/ and FOLDER_LOGIC PREFIX, a
// `src/package.devc.xml`, and every object beside it.
import {cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, statSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {basename, join, resolve} from "node:path";
import {runsAs} from "./osd-main.mjs";

const BOM = "﻿";

export const abapgitXml = () => BOM +
  `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
 <asx:values>
  <DATA>
   <MASTER_LANGUAGE>E</MASTER_LANGUAGE>
   <STARTING_FOLDER>/src/</STARTING_FOLDER>
   <FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>
  </DATA>
 </asx:values>
</asx:abap>
`;

/** The package description. abapGit asks for the package at import time, so
 *  the name is NOT written here -- putting one in would be a claim about
 *  where it lands that the importer overrides anyway. */
export const devcXml = (description) => BOM +
  `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DEVC" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DEVC>
    <CTEXT>${String(description).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</CTEXT>
   </DEVC>
  </asx:values>
 </asx:abap>
</abapGit>
`;

/** Lay the repository out under `into`, and say what went in.
 *
 *  Reports the objects by name rather than counting files, because one object
 *  is two files (source and XML) and "13 files" tells a reader nothing about
 *  whether the thing they wanted is there. */
export function layout(from, into, description) {
  rmSync(into, {recursive: true, force: true});
  mkdirSync(join(into, "src"), {recursive: true});
  writeFileSync(join(into, ".abapgit.xml"), abapgitXml());
  writeFileSync(join(into, "src", "package.devc.xml"), devcXml(description));

  const files = readdirSync(from).filter((f) => statSync(join(from, f)).isFile());
  for (const f of files) cpSync(join(from, f), join(into, "src", f));

  // an object is its name up to the first dot; `zstg_demo_srv    0001.iwsv.xml`
  // keeps its spaces, which is how abapGit names an IWSV and is not a mistake
  const objects = new Map();
  for (const f of files) {
    const m = /^(.+?)\.([a-z0-9]+)\./i.exec(f);
    if (m === null) continue;
    const type = m[2].toUpperCase();
    if (!objects.has(type)) objects.set(type, new Set());
    objects.get(type).add(m[1].trim());
  }
  return {files: files.length + 2, objects};
}

export function zip(dir, out) {
  rmSync(out, {force: true});
  // -X drops the extra file attributes: the zip is then the same bytes for
  // the same content, which is what makes "did anything change" answerable
  execFileSync("zip", ["-r", "-X", "-q", resolve(out), ".abapgit.xml", "src"], {cwd: dir});
  return statSync(out).size;
}

if (runsAs("osd-abapgit-zip.mjs")) {
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
  const input = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1]?.startsWith("--") !== true);
  if (input === undefined) {
    console.error("usage: osd-abapgit-zip.mjs <x.stg.yaml | folder> --out <file.zip> [--description …]");
    process.exit(2);
  }
  const out = flag("out", "repo.zip");
  const staging = `${out}.dir`;

  let objects = input;
  if (input.endsWith(".stg.yaml")) {
    objects = `${out}.objects`;
    const code = execFileSync(process.execPath,
      ["tools/stg-compile.mjs", input, "--out", objects], {stdio: "inherit"});
    void code;
  } else if (!existsSync(input)) {
    console.error(`no such folder: ${input}`);
    process.exit(2);
  }

  const description = flag("description", `open-steamgate: ${basename(input).replace(/\..*$/, "")}`);
  const {files, objects: found} = layout(objects, staging, description);
  const size = zip(staging, out);
  rmSync(staging, {recursive: true, force: true});
  if (objects !== input) rmSync(objects, {recursive: true, force: true});

  console.log(`${out}: ${files} files, ${(size / 1024).toFixed(1)} KB`);
  for (const [type, names] of [...found].sort()) {
    console.log(`  ${type.padEnd(5)} ${[...names].sort().join(", ")}`);
  }
  console.log(`\nImport it in abapGit: "New Online/Offline" -> Offline -> pick the zip,`);
  console.log(`then give it the package. The zip does not name one, so nothing here`);
  console.log(`decides where it lands.`);
}
