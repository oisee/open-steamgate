// Transpile generated replay variants against the current set's dependencies.
// No tracked generated source is edited, and the live module cache is untouched.
import {readFileSync, readdirSync, mkdirSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {modulesOf} from './osd-transpile.mjs';
import {lowerNarrowSubmit} from './osd-narrow-submit.mjs';
export async function loadGenerated(files, names, dir, model) {
  mkdirSync(dir,{recursive:true});
  const {Transpiler,core} = modulesOf(process.cwd());
  const reg = new core.Registry();
  const selected = new Set(names.flatMap((n) => [`${n}.clas.abap`,`${n}.clas.xml`]));
  for (const f of selected) if (files[f] !== undefined) reg.addFile(new core.MemoryFile(f,lowerNarrowSubmit(files[f],f,core)));
  const deps = new Map();
  const addFolder = (folder) => {
    for (const f of readdirSync(folder).sort()) if (/\.(clas|intf)\.(abap|xml)$|\.(tabl|ttyp|dtel|doma)\.xml$/.test(f)) deps.set(f,readFileSync(join(folder,f),'utf8'));
  };
  const addDdic = (folder) => {
    for (const entry of readdirSync(folder,{withFileTypes:true})) {
      const file = join(folder,entry.name);
      if (entry.isDirectory()) addDdic(file);
      else if (/\.(tabl|ttyp|dtel|doma)\.xml$/.test(entry.name)) deps.set(entry.name,readFileSync(file,'utf8'));
    }
  };
  addDdic('src');
  const addTree = (dir) => {
    addFolder(dir);
    for (const e of readdirSync(dir,{withFileTypes:true})) if (e.isDirectory()) addTree(join(dir,e.name));
  };
  addTree('src/daemons');
  addTree('.local/lars/open-abap-gui/framework');
  addTree('.local/lars/open-abap-apc/src');
  const coreDir = '.local/lars/open-abap-core/src';
  for (const folder of ['src/dsl','src/jobs',...new Set(model.rules.map((r) => dirname(resolve(r.file)))),
    ...['.','abap/hash','uuid','exceptions','ddic/dtel','ddic/doma','ddic/ttyp','ddic/structures','date_time'].map((d) => join(coreDir,d))]) addFolder(folder);
  for (const file of ['gen/gui/zcl_osd_batch_report.clas.abap','.local/lars/open-abap-gui/framework/zif_gg_selection_screen_types.intf.abap']) deps.set(basename(file),readFileSync(file,'utf8'));
  for (const [f,t] of Object.entries(files)) if (/\.(clas|intf)\.(abap|xml)$/.test(f)) deps.set(f,t);
  for (const [f,t] of deps) if (!selected.has(f)) reg.addDependency(new core.MemoryFile(f,t));
  const config = JSON.parse(readFileSync('abap_transpile.json','utf8'));
  const output = await new Transpiler({...config.options,unknownTypes:'runtimeError',ignoreSourceMap:true,skip:[],only:(o) => names.includes(o.getName().toLowerCase()) && o.getType() === "CLAS"}).run(reg);
  const mine = new Set(output.objects.map((o) => o.filename));
  const live = pathToFileURL(join(process.cwd(),'output')+sep).href;
  for (const o of output.objects.filter((o) => o.object.type === 'CLAS')) writeFileSync(join(dir,o.filename),o.chunk.getCode().replace(/import\("\.\/([^"]+)"\)/g,(m,f) => mine.has(f) ? m : `import("${live}${f}")`));
  const cxRoot = globalThis.abap.Classes.CX_ROOT;
  for (const name of names) await import(pathToFileURL(join(dir,`${name}.clas.mjs`)).href);
  if (cxRoot) globalThis.abap.Classes.CX_ROOT = cxRoot;
  if (!globalThis.abap.Classes[model.class.toUpperCase()]) throw new Error('replay runner was not loaded');
}
