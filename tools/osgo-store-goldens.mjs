#!/usr/bin/env node
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {StoreDestination} from "./osd-store-destination.mjs";
import {ObjectStore} from "./osd-store.mjs";

const here = resolve(dirname(new URL(import.meta.url).pathname));
export const fixtureRoot = resolve(here, "../test/fixtures/osgo-store");
export const goldenPath = resolve(fixtureRoot, "destination-golden.json");

export const cases = [
  ["object-class", {IV_COMMAND: "OBJECT", IV_TYPE: "CLAS", IV_NAME: "ZCLASS"}],
  ["object-tmp", {IV_COMMAND: "OBJECT", IV_TYPE: "PROG", IV_NAME: "ZTMP_PROG"}],
  ["object-library", {IV_COMMAND: "OBJECT", IV_TYPE: "PROG", IV_NAME: "ZLIBRARY"}],
  ["object-missing", {IV_COMMAND: "OBJECT", IV_TYPE: "PROG", IV_NAME: "ZMISSING"}],
  ["package-raw", {IV_COMMAND: "PACKAGE", IV_JSON: JSON.stringify({mode: "raw", name: "$STG"})}],
  ["package-local", {IV_COMMAND: "PACKAGE", IV_JSON: JSON.stringify({mode: "local", name: "$TMP", user: "ALICE"})}],
  ["packages-json", {IV_COMMAND: "PACKAGES", IV_JSON: "{}"}],
  ["packages-lines", {IV_COMMAND: "PACKAGES", IV_JSON: JSON.stringify({format: "lines"})}],
  ["packages-vfs-lines", {IV_COMMAND: "PACKAGES", IV_JSON: JSON.stringify({format: "vfs-lines"})}],
  ["search-json", {IV_COMMAND: "SEARCH", IV_JSON: JSON.stringify({seed: "Z", limit: 100})}],
  ["search-zero", {IV_COMMAND: "SEARCH", IV_JSON: JSON.stringify({seed: "Z", limit: 0})}],
  ["search-lines", {IV_COMMAND: "SEARCH", IV_JSON: JSON.stringify({seed: "Z", type: "PROG", format: "lines"})}],
  ["read-main", {IV_COMMAND: "READ", IV_TYPE: "CLAS", IV_NAME: "ZCLASS"}],
  ["read-include", {IV_COMMAND: "READ", IV_TYPE: "CLAS", IV_NAME: "ZCLASS", IV_INCLUDE: "definitions"}],
  ["read-missing-include", {IV_COMMAND: "READ", IV_TYPE: "CLAS", IV_NAME: "ZCLASS", IV_INCLUDE: "macros"}],
  ["read-library", {IV_COMMAND: "READ", IV_TYPE: "PROG", IV_NAME: "ZLIBRARY"}],
  ["history-main", {IV_COMMAND: "HISTORY", IV_TYPE: "PROG", IV_NAME: "ZPROGRAM"}],
  ["history-include", {IV_COMMAND: "HISTORY", IV_TYPE: "CLAS", IV_NAME: "ZCLASS", IV_INCLUDE: "macros"}],
];

const timeLike = /"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)"/g;

function normalize(value) {
  const visit = (node) => Array.isArray(node)
    ? node.map(visit)
    : node && typeof node === "object"
      ? Object.fromEntries(Object.entries(node).map(([key, item]) => [key, key === "EV_MS" ? "0" : visit(item)]))
      : node;
  value = visit(value);
  const text = JSON.stringify(value, null, 2);
  return text.replaceAll(timeLike, '"<time>"') + "\n";
}

export async function destinationAnswers() {
  const store = new ObjectStore({root: fixtureRoot, libs: ["lib/src"], roots: [
    {path: "src", writable: true, library: false},
    {path: "local/tmp", writable: true, library: false, package: "$TMP", tmp: true},
  ]});
  const destination = new StoreDestination({store});
  const answers = {};
  for (const [name, parameters] of cases) answers[name] = await destination.execute(parameters);
  return normalize(answers);
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
