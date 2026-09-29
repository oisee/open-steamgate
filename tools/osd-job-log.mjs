// Private technical history, verified with the run and its import digest in
// one read-only operations snapshot. Neither report list output nor BAL.
import {readJobSnapshot} from "./osd-job-snapshot.mjs";

export function readJobLog(request = {}) {
  const snapshot = readJobSnapshot({...request, includeTechnicalLog: true});
  if (!snapshot) return undefined;
  if (snapshot.phase !== "OPERATIONS") return {phase: snapshot.phase, entries: [], historicalGap: false};
  return {phase: snapshot.phase, ...snapshot.technicalLog};
}
