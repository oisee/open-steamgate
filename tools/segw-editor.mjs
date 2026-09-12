// The server side of the SEGW editor app (webapp/segw/): what the local
// runtime can do for a project that lives in the ZSTG_SB* tables and SEGW
// would do itself on a system.
//
//   exportProject(base, project)   -> the IWPR XML of the project's rows
//   generateProject(base, project) -> segw-gen over that IWPR, written to
//                                     gen/segw-editor/<project>/
//
// `base` is the gateway's own URL (the rows are read through ZSTG_SEGW_SRV,
// as `segw-tree pull` does), so the route in test/start.mjs calls back
// into the same process over HTTP. The editor's Export button does not
// come here any more: ExportSet of the service writes the IWPR in ABAP. Function groups for RFC-mapped
// operations come from STG_SEGW_LIBS (folders, ':'-separated).
import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {generate} from "./segw-gen.mjs";
import {loadFunctionGroups} from "./segw-gen-mapping.mjs";
import {readSpec} from "./segw-tables.mjs";
import {exportIwpr, pull} from "./segw-tree.mjs";

export const OUT_DIR = "gen/segw-editor";

export async function exportProject(base, project) {
  const spec = readSpec();
  const tables = await pull(base, project, spec);
  if (tables.size === 0) {
    return "";
  }
  return exportIwpr(tables, project, spec);
}

export async function generateProject(base, project, opts = {}) {
  const iwpr = await exportProject(base, project);
  if (iwpr === "") {
    return {project, folder: "", files: {}, warnings: [`no rows for project ${project}`], skipped: "the project has no rows"};
  }
  const libs = Array.isArray(opts.libs) ? opts.libs : (opts.libs ?? process.env.STG_SEGW_LIBS ?? "").split(":").filter(Boolean);
  const warnings = [];
  const {files, ext, skipped} = generate(iwpr, {functionModules: loadFunctionGroups(libs), warnings});
  const folder = join(opts.out ?? OUT_DIR, project.toLowerCase());
  const written = {...files, ...ext, [`${project.toLowerCase()}.iwpr.xml`]: iwpr};
  if (!skipped) {
    mkdirSync(folder, {recursive: true});
    for (const [name, content] of Object.entries(written)) {
      writeFileSync(join(folder, name), content);
    }
  }
  return {project, folder, files: skipped ? {} : written, warnings, skipped};
}
