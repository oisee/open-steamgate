// Informational: what abaplint says about src/segw (the SEGW-as-application
// code) and the SADL runtime it stands on when the language version is
// ABAP for Cloud Development instead of open-abap. Nothing here gates a
// build; the point is to know how far the code is from Steampunk before
// anyone tries it there. Uses the repository's abaplint.jsonc with the
// syntax version swapped and the file list narrowed; prints issues per
// rule and per file and always exits 0.
//
// Usage: node tools/segw-cloud.mjs [--json] [--files <glob>]
import {execFileSync} from "node:child_process";
import {readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {runsAs} from "./osd-main.mjs";

// everything under src/ (the gateway and the DDIC the SEGW code stands on),
// the generated table sources and the generated ZSTG_SEGW classes
const FILES = "/{src,gen/cds,gen/stg/zstg_segw}/**/*.*";
// the language version is the question, not the style of SEGW's output
// (lower case, tabs) or open-abap's downport
const STYLE = ["contains_tab", "line_only_punc", "keyword_case", "indentation", "space_before_dot", "whitespace_end", "downport"];

// comment lines only: the globs in the file ("/src/**/*.*") look like comments
function readJsonc(file) {
  const text = readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  return JSON.parse(text);
}

export function cloudConfig(base, files = FILES) {
  const config = structuredClone(base);
  config.global.files = files;
  config.global.exclude = [...(config.global.exclude ?? []).filter((e) => e !== "/gen/stg/"), "/test/"];
  for (const rule of STYLE) {
    config.rules[rule] = false;
  }
  config.dependencies = (config.dependencies ?? []).filter((d) => !String(d.folder).includes("gen/stg"));
  config.syntax = {...config.syntax, version: "Cloud"};
  return config;
}

export function run(cwd = process.cwd(), files = FILES) {
  // abaplint resolves the file globs against the folder of its config
  const file = join(cwd, ".segw-cloud.abaplint.json");
  try {
    writeFileSync(file, JSON.stringify(cloudConfig(readJsonc(join(cwd, "abaplint.jsonc")), files)));
    let out;
    try {
      out = execFileSync("npx", ["abaplint", file, "-f", "json"], {cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
    } catch (e) {
      out = e.stdout;
    }
    // a banner precedes the JSON
    const at = out.indexOf("[");
    return at < 0 ? [] : JSON.parse(out.slice(at));
  } finally {
    rmSync(file, {force: true});
  }
}

function main(args) {
  const at = args.indexOf("--files");
  const issues = run(process.cwd(), at >= 0 ? args[at + 1] : FILES);
  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify(issues, null, 1) + "\n");
    return 0;
  }
  const count = (key) => {
    const m = new Map();
    for (const i of issues) {
      m.set(key(i), (m.get(key(i)) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  console.log(`abaplint with syntax.version Cloud over ${FILES}: ${issues.length} issue(s)\n`);
  console.log("by rule:");
  for (const [k, n] of count((i) => i.key)) {
    console.log(`  ${String(n).padStart(5)}  ${k}`);
  }
  console.log("\nby file:");
  for (const [k, n] of count((i) => i.file).slice(0, 25)) {
    console.log(`  ${String(n).padStart(5)}  ${k}`);
  }
  console.log("\nfirst message per rule:");
  const seen = new Set();
  for (const i of issues) {
    if (!seen.has(i.key)) {
      seen.add(i.key);
      console.log(`  ${i.key}: ${i.description} (${i.file}:${i.start?.row})`);
    }
  }
  return 0;
}

if (runsAs("segw-cloud.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
