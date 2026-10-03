// Local TH_WPINFO subset: configurable background capacity, idle minus active jobs.
// The system's kernel provides the complete WPLIST instead.
import {BatchRuns} from './osd-batch-runs.mjs';
export function installCapacity(abap, jobs) {
  // a runtime set up without function modules (some suites' minimal setups) has nothing to answer
  if (!abap?.FunctionModules) return;
  abap.FunctionModules.TH_WPINFO = async (input) => {
    const table = input.tables?.wplist;
    if (!table) throw new Error('TH_WPINFO requires WPLIST');
    const capacity = Number(jobs.env.OSD_BG_WORKERS ?? 4);
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('OSD_BG_WORKERS must be a positive integer');
    const store = new BatchRuns(jobs.root, jobs.env);
    let busy;
    try { busy = store.db.prepare("SELECT COUNT(*) AS n FROM batch_runs WHERE state='RUNNING'").get().n; }
    finally {store.close();}
    table.clear();
    // the shape a system answers (measured 2026-10-03): a background process is BGD, an idle one
    // Waiting, a busy one Running; one dialog process stands for the rest, so a filter that counts
    // every idle process instead of the idle background ones counts one too many
    const add = (type, status) => {
      const row = table.getRowType().clone();
      row.get().wp_typ.set(type);row.get().wp_status.set(status);table.append(row);
    };
    add('DIA', 'Waiting');
    for (let i=0; i<capacity; i++) add('BGD', i < Math.max(0, capacity-busy) ? 'Waiting' : 'Running');
  };
}
