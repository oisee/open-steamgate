#!/usr/bin/env node
// The Open SQL corpus of the native build (apps/sql-corpus): each form,
// compiled as a report of its own the way osabap.mjs compiles one (the
// converter, then the frontend, then emit-go), and what the Go generator says
// about it: compiled, or the NOT_COMPILED reason. Compile only -- running a
// form is the job of the report tests (osabap.test.mjs).
//
//   node tools/gogen/osabap-sql-corpus.mjs [--json]
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";
import {home} from "./home.mjs";

const here = import.meta.dirname;

/** the cases: the header of the corpus plus one "* NN title" block each */
export function corpusCases(source = readFileSync(join(here, "apps", "sql-corpus", "zsqlcorpus.abap"), "utf8")) {
  const [head, body] = source.split("START-OF-SELECTION.\n");
  const parts = body.split(/^\* (\d\d) /m);
  const cases = [];
  for (let i = 1; i < parts.length; i += 2) {
    const [title, ...code] = parts[i + 1].split("\n");
    const statements = code.filter((line) => !/^\s*WRITE:/.test(line)).join("\n");
    cases.push({id: parts[i], title: title.trim(),
      source: head.replace(/REPORT zsqlcorpus\./, `REPORT zc${parts[i]}.`) + "START-OF-SELECTION.\n" + statements + "  WRITE / gv_count.\n"});
  }
  return cases;
}

const refusalsIn = (go) => [...go.matchAll(/NotCompiled\(("[^"]*"), ("(?:[^"\\]|\\.)*")\)/g)]
  .map((m) => JSON.parse(m[2]).replace(/ZCL_OSABAP_C\d\d/g, "ZCL_OSABAP_C").replace(/ZC\d\d\b/g, "ZC"));

// what the framework around any report refuses anyway: an empty report's
// refusals, which a case's own are told apart from
let baseline;
async function baselineRefusals() {
  baseline ??= new Set((await compileCase({id: "00", title: "empty", source: corpusCases()[0].source
    .replace(/START-OF-SELECTION\.\n[\s\S]*$/, "START-OF-SELECTION.\n  WRITE / gv_count.\n")}, true)).refusals);
  return baseline;
}

export async function compileCase(entry, raw = false) {
  const gui = join(home, ".local", "lars", "open-abap-gui");
  const name = `ZC${entry.id}`;
  const className = `ZCL_OSABAP_C${entry.id}`;
  const dir = mkdtempSync(join(tmpdir(), "osabap-sql-"));
  try {
    const {convertProgram} = await import(join(gui, "converter", "src", "api.mjs"));
    const converted = await convertProgram({source: entry.source, filename: `${name.toLowerCase()}.prog.abap`,
      mode: "strict", nativePassthrough: true, className, transactionCode: name});
    if (converted.supported !== true) return {...entry, compiled: false, reason: `converter: ${JSON.stringify(converted.diagnostics)}`};
    writeFileSync(join(dir, `${className.toLowerCase()}.clas.abap`), converted.classSource);
    for (const helper of converted.helperSources ?? []) {
      writeFileSync(join(dir, `${helper.className.toLowerCase()}.clas.abap`), helper.source);
    }
    copyFileSync(join(here, "apps", "notes", "znotes.tabl.xml"), join(dir, "znotes.tabl.xml"));
    const program = compileProgram({
      folders: [dir, join(here, "apps", "runtime"), join(gui, "framework"), join(gui, "src"), join(home, ".local", "lars", "open-abap-core", "src")],
      objects: [className.toLowerCase(), "zcl_osabap_runtime"], tolerant: true, skip: (path) => /\.testclasses\.abap$/i.test(path),
    });
    const refusals = refusalsIn(emitGo(program));
    if (raw) return {refusals};
    const known = await baselineRefusals();
    const refused = refusals.find((why) => !known.has(why));
    return refused === undefined ? {...entry, compiled: true}
      : {...entry, compiled: false, reason: refused.replace(/^.*?\): /, "").replace(/^ZCL_OSABAP_C=>\S+ /, "")};
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

if (process.argv[1] === import.meta.filename) {
  const results = [];
  for (const entry of corpusCases()) results.push(await compileCase(entry));
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(results.map(({id, title, compiled, reason}) => ({id, title, compiled, reason})), null, 2));
  } else {
    for (const r of results) console.log(`${r.id} ${r.compiled ? "compiled " : "REFUSED  "} ${r.title}${r.reason ? ` -- ${r.reason.slice(0, 140)}` : ""}`);
    console.log(`${results.filter((r) => r.compiled).length}/${results.length} forms compile`);
  }
}
