import {l3TableDependencies} from "./dsl-l3-tables.mjs";
import {readFileSync, readdirSync, mkdirSync, writeFileSync} from "node:fs";
import {join, basename} from "node:path";
import {pathToFileURL} from "node:url";
import {modulesOf} from "../../tools/osd-transpile.mjs";
export async function loadCockpitMutant(name, source, out) {
  const {Transpiler, core} = modulesOf(process.cwd()), reg = new core.Registry();
  reg.addFile(new core.MemoryFile(`${name}.clas.abap`, source));
  reg.addFile(new core.MemoryFile(`${name}.clas.xml`, readFileSync("src/l2demo/zcl_zl3c_fleet2_dpc_ext.clas.xml", "utf8").replaceAll("ZCL_ZL3C_FLEET2_DPC_EXT", name.toUpperCase())));
  const seen = new Set();
  for (const path of l3TableDependencies()) {
    seen.add(basename(path));
    reg.addDependency(new core.MemoryFile(basename(path), readFileSync(path, "utf8")));
  }
  function deps(dir) {
    for (const e of readdirSync(dir, {withFileTypes: true})) {
      const path = join(dir, e.name);
      if (e.isDirectory()) deps(path);
      else if (/\.(abap|xml)$/.test(e.name) && !/testclasses|trace/.test(e.name)) {
        if (/\.(clas|intf|tabl|ttyp|dtel|doma)\.(abap|xml)$/.test(e.name)) if (!seen.has(basename(path))) {seen.add(basename(path)); reg.addDependency(new core.MemoryFile(basename(path), readFileSync(path, "utf8")));}
      }
    }
  }
  for (const dir of ["src/l2demo", "src/dsl", "src/jobs", "src/sadl", "src/gateway", "gen/stg/zl3c_fleet2",
    ".local/lars/open-abap-core/src", ".local/lars/open-abap-odata/src"]) deps(dir);
  const config = JSON.parse(readFileSync("abap_transpile.json", "utf8"));
  const result = await new Transpiler({...config.options, unknownTypes: "runtimeError", ignoreSourceMap: true, skip: [], only: (object) => object.getName().toUpperCase() === name.toUpperCase()}).run(reg);
  mkdirSync(out, {recursive: true});
  for (const obj of result.objects) {
    const code = obj.chunk.getCode().replace(/import\("\.\/([^"]+)"\)/g, (_, file) => `import("${pathToFileURL(join(process.cwd(), "output", file)).href}")`);
    writeFileSync(join(out, obj.filename), code);
  }
  await import(pathToFileURL(join(out, `${name}.clas.mjs`)).href);
  return globalThis.abap.Classes[name.toUpperCase()];
}
