// Build an isolated abapGit source tree for a parallel A4H LSD installation.
// The existing packs/lsd source and the installed $ZOSD_010 objects stay intact.
import {createHash} from "node:crypto";
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {basename, join, resolve} from "node:path";

const source = resolve("packs/lsd/src");
const target = resolve("deploy/lsd-a4h-011/src");
if (existsSync(target)) throw new Error(`${target} already exists; refusing to overwrite it`);
mkdirSync(target, {recursive: true});

const names = [
  ["ZCL_LSD_HTTP_HANDLER", "ZCL_ZOSD_011_LSD_HTTP"],
  ["ZCL_LSD_APC_HANDLER", "ZCL_ZOSD_011_LSD_APC"],
  ["ZCL_LSD_MEDIA", "ZCL_ZOSD_011_LSD_MEDIA"],
  ["ZLSD-MUSIC", "ZOSD_011_MUSIC"],
  ["ZLSD-SHOW", "ZOSD_011_SHOW"],
  ["ZLSD-NOTHING", "ZOSD_011_NOTHING"],
  ["ZAPC_LSD", "ZOSD_011_LSD"],
  ["<ICF_NAME>LSD</ICF_NAME>", "<ICF_NAME>ZOSD_011_LSD</ICF_NAME>"],
  ["<ORIG_NAME>lsd</ORIG_NAME>", "<ORIG_NAME>zosd_011_lsd</ORIG_NAME>"],
  ["/sap/bc/apc/sap/zapc_lsd", "/sap/bc/apc/sap/zosd_011_lsd"],
  ["/sap/bc/lsd/", "/sap/bc/zosd_011_lsd/"],
  ["ZLSD", "ZOSD_011_LSD"],
];

function renameText(text) {
  let result = text;
  for (const [from, to] of names) {
    result = result.replaceAll(from, to).replaceAll(from.toLowerCase(), to.toLowerCase());
  }
  return result;
}

function sicfFilename(url, name) {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 25);
  return `${name.toLowerCase().padEnd(15, " ")}${hash}.sicf.xml`;
}

for (const entry of readdirSync(source)) {
  const from = join(source, entry);
  let to = renameText(entry);
  if (entry.endsWith(".sicf.xml")) {
    const text = renameText(readFileSync(from, "utf8"));
    const url = /<URL>([^<]+)<\/URL>/.exec(text)?.[1];
    const name = /<ICF_NAME>([^<]+)<\/ICF_NAME>/.exec(text)?.[1];
    if (!url || !name) throw new Error(`Invalid SICF metadata in ${entry}`);
    to = sicfFilename(url, name);
    writeFileSync(join(target, to), text);
  } else if (/\.data\.(?:gz|m4a)$/.test(entry)) {
    cpSync(from, join(target, to));
  } else {
    writeFileSync(join(target, to), renameText(readFileSync(from, "utf8")));
  }
}
console.log(`${basename(target)}: ${readdirSync(target).length} source files, isolated namespace ZOSD_011`);
