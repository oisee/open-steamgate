// Legacy pass/timing oracles explicitly exercise the scheduled job doctor.
// Autonomous healing remains covered by dsl-l3-autodoctor.mjs.
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {compileSet, renderSet} from '../../tools/dsl-l3.mjs';
import {selectionSemanticsSource} from '../../tools/osd-gui-convert.mjs';
import {loadGenerated} from '../../tools/dsl-l3-load.mjs';
export function daemonDependencies() {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, {withFileTypes:true})) {
      const path = join(dir,e.name);
      if (e.isDirectory()) walk(path);
      else if (/\.(clas|intf)\.(abap|xml)$|\.(tabl|ttyp|dtel|doma)\.xml$/.test(e.name)) files.push(path);
    }
  };
  for (const dir of ['src/daemons','.local/lars/open-abap-apc/src']) walk(dir);
  return files;
}
export function jobDoctorModel(set) {
  const model = compileSet(`src/l2demo/${set}.l3.yaml`);
  if (!model.resilience) return model;
  Object.assign(model.resilience.doctor, {mechanisms:['job'], daemon:false, event:false, job:true, autonomous:false, arm_job:false});
  delete model.autodoctor; delete model.daemon; delete model.doctor_event;
  return model;
}
export async function jobDoctor(set, dir) {
  const model = jobDoctorModel(set);
  if (!model.resilience) return {files:{}, restore:() => {}};
  const {files} = await renderSet(model);
  // Convert the report too: the scheduled-job mechanism advances at its tail.
  const {convertProgram} = await import('../../.local/lars/open-abap-gui/converter/src/api.mjs');
  const gui = `zcl_osd_gui_l3_${set}`;
  const converted = await convertProgram({source:files[`${model.report}.prog.abap`],
    filename:`${model.report}.prog.abap`, mode:'strict', className:gui.toUpperCase(), transactionCode:`ZGUI_L3_${set.toUpperCase()}`});
  if (!converted.supported) throw new Error(`job doctor report conversion refused: ${JSON.stringify(converted.diagnostics)}`);
  const elements = (converted.reportIR?.selections ?? []).flatMap((s) => s.elements ?? []);
  files[`${gui}.clas.abap`] = selectionSemanticsSource(converted.classSource,elements);
  const names = [model.class,gui];
  const originals = names.map((name) => globalThis.abap.Classes[name.toUpperCase()]);
  await loadGenerated(files,names,dir,model);
  return {files, restore: () => { names.forEach((name,i) => { globalThis.abap.Classes[name.toUpperCase()] = originals[i]; }); }};
}
