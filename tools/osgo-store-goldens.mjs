#!/usr/bin/env node
import {mkdir, readFile, rm, writeFile, symlink} from "node:fs/promises";
import {readdirSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {dirname, resolve} from "node:path";
import {StoreDestination} from "./osd-store-destination.mjs";
import {ObjectStore} from "./osd-store.mjs";
import {buildFixture} from "./osgo-store-fixture.mjs";

const here = resolve(dirname(new URL(import.meta.url).pathname));
export const fixtureRoot = resolve(here, "../test/fixtures/osgo-store");
export const goldenPath = resolve(fixtureRoot, "destination-golden.json");

export const cases = [
  ["object-class", {IV_COMMAND: "OBJECT", IV_TYPE: "CLAS", IV_NAME: "ZCLASS"}, "EV_JSON"],
  ["object-tmp", {IV_COMMAND: "OBJECT", IV_TYPE: "PROG", IV_NAME: "ZTMP_PROG"}, "EV_JSON"],
  ["object-overlay", {IV_COMMAND: "OBJECT", IV_TYPE: "PROG", IV_NAME: "ZARCHIVE"}, "EV_JSON"],
  ["object-overlay-write", {IV_COMMAND: "OBJECT", IV_TYPE: "PROG", IV_NAME: "ZOVERLAY"}, "EV_JSON"],
  ["object-full", {IV_COMMAND: "OBJECT", IV_TYPE: "PROG", IV_NAME: "ZFULLSUB"}, "EV_JSON"],
  ["object-library", {IV_COMMAND: "OBJECT", IV_TYPE: "PROG", IV_NAME: "ZLIBRARY"}, "EV_JSON"],
  ["object-missing", {IV_COMMAND: "OBJECT", IV_TYPE: "PROG", IV_NAME: "ZMISSING"}, "EV_JSON"],
  ["package-raw", {IV_COMMAND: "PACKAGE", IV_JSON: JSON.stringify({mode: "raw", name: "$STG"})}, "EV_JSON"],
  ["package-local", {IV_COMMAND: "PACKAGE", IV_JSON: JSON.stringify({mode: "local", name: "$TMP", user: "ALICE"})}, "EV_JSON"],
  ["packages-json", {IV_COMMAND: "PACKAGES", IV_JSON: "{}"}, "EV_JSON"],
  ["packages-lines", {IV_COMMAND: "PACKAGES", IV_JSON: JSON.stringify({format: "lines"})}, "EV_SOURCE"],
  ["packages-vfs-lines", {IV_COMMAND: "PACKAGES", IV_JSON: JSON.stringify({format: "vfs-lines"})}, "EV_SOURCE"],
  ["search-json", {IV_COMMAND: "SEARCH", IV_JSON: JSON.stringify({seed: "Z", limit: 100})}, "EV_JSON"],
  ["search-zero", {IV_COMMAND: "SEARCH", IV_JSON: JSON.stringify({seed: "Z", limit: 0})}, "EV_JSON"],
  ["search-lines", {IV_COMMAND: "SEARCH", IV_JSON: JSON.stringify({seed: "Z", type: "PROG", format: "lines"})}, "EV_SOURCE"],
  ["read-main", {IV_COMMAND: "READ", IV_TYPE: "CLAS", IV_NAME: "ZCLASS"}, "EV_SOURCE"],
  ["read-include", {IV_COMMAND: "READ", IV_TYPE: "CLAS", IV_NAME: "ZCLASS", IV_INCLUDE: "definitions"}, "EV_JSON"],
  ["read-zero-include", {IV_COMMAND: "READ", IV_TYPE: "CLAS", IV_NAME: "ZEMPTY", IV_INCLUDE: "definitions"}, "EV_JSON"],
  ["read-active-main", {IV_COMMAND: "READ", IV_TYPE: "PROG", IV_NAME: "ZPROGRAM", IV_REVISION: "active"}, "EV_SOURCE"],
  ["read-active-include", {IV_COMMAND: "READ", IV_TYPE: "CLAS", IV_NAME: "ZCLASS", IV_INCLUDE: "definitions", IV_REVISION: "active"}, "EV_SOURCE"],
  ["read-missing-include", {IV_COMMAND: "READ", IV_TYPE: "CLAS", IV_NAME: "ZCLASS", IV_INCLUDE: "macros"}, "EV_JSON"],
  ["read-library", {IV_COMMAND: "READ", IV_TYPE: "PROG", IV_NAME: "ZLIBRARY"}, "EV_SOURCE"],
  ["history-main", {IV_COMMAND: "HISTORY", IV_TYPE: "PROG", IV_NAME: "ZPROGRAM"}, "EV_COUNT"],
  ["history-rename", {IV_COMMAND: "HISTORY", IV_TYPE: "PROG", IV_NAME: "Z_NEW"}, "EV_COUNT"],
  ["history-ignored", {IV_COMMAND: "HISTORY", IV_TYPE: "PROG", IV_NAME: "ZIGNORED"}, "EV_NOTE"],
  ["history-include", {IV_COMMAND: "HISTORY", IV_TYPE: "CLAS", IV_NAME: "ZCLASS", IV_INCLUDE: "macros"}, "EV_COUNT"],
];

// Shared by frozen goldens and storecmp's real-sidecar proof. Compiler inputs
// live in the same fixture repository, with a real active generation.
export const compilerCases = [
  ["check-clean", {IV_COMMAND:"CHECK", IV_TYPE:"CLAS", IV_NAME:"ZCL_VALID"}, "EV_JSON"],
  ["check-syntax", {IV_COMMAND:"CHECK", IV_TYPE:"CLAS", IV_NAME:"ZCL_BAD"}, "EV_JSON"],
  ["check-include", {IV_COMMAND:"CHECK", IV_TYPE:"CLAS", IV_NAME:"ZCLASS"}, "EV_JSON"],
  ...["active", "inactive"].flatMap(version => [
    [`outline-class-${version}`, {IV_COMMAND:"PARSE", IV_JSON:JSON.stringify({kind:"OUTLINE",type:"CLAS",name:"ZCLASS",version})}, "EV_JSON"],
    [`outline-program-${version}`, {IV_COMMAND:"PARSE", IV_JSON:JSON.stringify({kind:"OUTLINE",type:"PROG",name:"ZPROGRAM",version})}, "EV_JSON"],
  ]),
  ["outline-missing", {IV_COMMAND:"PARSE", IV_JSON:JSON.stringify({kind:"OUTLINE",type:"CLAS",name:"ZMISSING"})}, "EV_JSON"],
];

// Node checks these directly through its in-memory unsaved buffer. Contract
// v1 snapshots contain only named files and hashes, so the Go side refuses.
export const compilerGapCases = [
  ["check-unsaved-source", {IV_COMMAND:"CHECK", IV_TYPE:"CLAS", IV_NAME:"ZCL_VALID", IV_SOURCE:"CLASS zcl_valid DEFINITION PUBLIC.\nENDCLASS."}],
];

export async function prepareCompilerFixture(root) {
  await writeFile(resolve(root,"abap_transpile.json"), JSON.stringify({input_folder:["src"],libs:[]}));
  await writeFile(resolve(root,"abaplint.jsonc"), JSON.stringify({syntax:{version:"v702"}}));
  await symlink("by-input/test",resolve(root,"build/live"));
  const source = method => `CLASS zcl_valid DEFINITION PUBLIC.\n PUBLIC SECTION.\n METHODS ${method}.\nENDCLASS.\nCLASS zcl_valid IMPLEMENTATION.\n METHOD ${method}.\n ENDMETHOD.\nENDCLASS.\n`;
  await writeFile(resolve(root,"src/zcl_valid.clas.abap"),source("run"));
  await writeFile(resolve(root,"src/zcl_bad.clas.abap"),source("a".repeat(31)).replaceAll("zcl_valid","zcl_bad"));
  await writeFile(resolve(root,"src/osd/zclass.clas.abap"), source("edited").replaceAll("zcl_valid","zclass"));
}

export async function compilerAnswers(root) {
  const destination = new StoreDestination({store:new ObjectStore({root})});
  const answers={};
  for (const [name,parameters] of compilerCases) answers[name]=await destination.execute(parameters);
  return answers;
}

function normalize(value) {
  const visit = (node) => Array.isArray(node)
    ? node.map(visit)
    : node && typeof node === "object"
      ? Object.fromEntries(Object.entries(node).map(([key, item]) => [key, key === "EV_MS" ? "0" : visit(item)]))
      : node;
  value = visit(value);
  return JSON.stringify(value, null, 2) + "\n";
}

export async function destinationAnswers() {
  assertFixtureTracked();
  const root = await buildFixture();
  const packages = process.env.OSD_LOCAL_PACKAGES;
  try {
    const ordinary = JSON.parse(await answersIn(root));
    await prepareCompilerFixture(root);
    return normalize({...ordinary,...await compilerAnswers(root)});
  } finally {
    if (packages === undefined) delete process.env.OSD_LOCAL_PACKAGES;
    else process.env.OSD_LOCAL_PACKAGES = packages;
    await rm(root, {recursive: true, force: true});
  }
}

async function answersIn(root) {
  const facts = JSON.parse(await readFile(resolve(root, "store.json"), "utf8"));
  process.env.OSD_LOCAL_PACKAGES = "$STG_A,$STG__,$STG";
  const store = new ObjectStore({root, libs: facts.libs.map(({path}) => path), roots: facts.roots.map(({files, ...root}) => root)});
  store.served = {running: true, generation: "test"};
  const destination = new StoreDestination({store});
  const answers = {};
  for (const [name, parameters, proof] of cases) {
    const answer = await destination.execute(parameters);
    if (Object.keys(answer).length !== 19) throw new Error(`${name} answered ${Object.keys(answer).length} fields, expected 19`);
    if (proof === "EV_ERROR") {
      if (answer.EV_ERROR === "") throw new Error(`${name} was expected to refuse`);
    } else if (answer.EV_ERROR !== "" || answer[proof] === undefined || answer[proof] === "") {
      throw new Error(`${name} did not answer: ${answer.EV_ERROR}`);
    }
    answers[name] = answer;
  }
  return normalize(answers);
}

function assertFixtureTracked() {
  const repo = resolve(fixtureRoot, "../../..");
  const list = args => new Set(spawnSync("git", args, {cwd: repo, encoding: "utf8"}).stdout.split("\0").filter(Boolean));
  const known = new Set([...list(["ls-files", "-z", "--", "test/fixtures/osgo-store"]), ...list(["ls-files", "--others", "--exclude-standard", "-z", "--", "test/fixtures/osgo-store"])]);
  const files = [];
  const visit = dir => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      if (entry.name === ".git") continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else files.push(path);
    }
  };
  visit("test/fixtures/osgo-store");
  const missing = files.filter(path => !known.has(path));
  if (missing.length > 0) throw new Error(`fixture files are not tracked: ${missing.join(", ")}`);
}

export async function regenerate() {
  await mkdir(dirname(goldenPath), {recursive: true});
  await writeFile(goldenPath, await destinationAnswers());
}

export async function check() {
  const [wanted, current] = await Promise.all([readFile(goldenPath, "utf8"), destinationAnswers()]);
  if (wanted !== current) return {ok: false, wanted, current};
  return {ok: true};
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv[2] === "--regenerate") await regenerate();
  else if (process.argv[2] === "--check") {
    const result = await check();
    if (!result.ok) {
      console.error("destination goldens differ; run tools/osgo-store-goldens.mjs --regenerate");
      process.exitCode = 1;
    }
  } else await regenerate();
}
