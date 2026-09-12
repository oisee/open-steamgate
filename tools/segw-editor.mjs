// The one thing the SEGW editor (webapp/segw/) still needs the local runtime
// for: landing the files GenerateSet gives on disk. Generate itself is the
// service's (zcl_stg_segw_gen, segw-gen in ABAP); this reads its rows
// through the gateway's own URL and writes gen/segw-editor/<project>/.
import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";

export const OUT_DIR = "gen/segw-editor";
const SERVICE = "/sap/opu/odata/sap/ZSTG_SEGW_SRV";

export async function generatedFiles(base, project) {
  const url = `${base}${SERVICE}/GenerateSet?$filter=${encodeURIComponent(`Project eq '${project}'`)}&$format=json`;
  const res = await fetch(url, {headers: {accept: "application/json"}});
  if (!res.ok) {
    throw new Error(`GET GenerateSet for ${project}: ${res.status} ${await res.text()}`);
  }
  const files = {};
  for (const row of (await res.json()).d.results) {
    files[row.Name] = row.Content;
  }
  return files;
}

export async function generateProject(base, project, opts = {}) {
  const files = await generatedFiles(base, project);
  const folder = join(opts.out ?? OUT_DIR, project.toLowerCase());
  mkdirSync(folder, {recursive: true});
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(folder, name), content);
  }
  return {project, folder, files, warnings: []};
}
