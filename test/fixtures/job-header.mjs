// The local TBTCJOB shape BP_JOB_READ and BP_JOB_SELECT fill: the job key,
// status and user, then the start-time and period fields (2026-10-01).
export function jobHeaderType(abap) {
  const t = abap.types;
  return new t.Structure({
    jobname: new t.Character(32), jobcount: new t.Character(8),
    status: new t.Character(1), sdluname: new t.Character(12),
    sdlstrtdt: new t.Date(), sdlstrttm: new t.Time(),
    prdmins: new t.Numc({length: 2}), prdhours: new t.Numc({length: 2}),
    prddays: new t.Numc({length: 3}), prdweeks: new t.Numc({length: 2}),
    prdmonths: new t.Numc({length: 2}), periodic: new t.Character(1),
    laststrtdt: new t.Date(), laststrttm: new t.Time(),
  });
}
