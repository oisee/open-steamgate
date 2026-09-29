import {BatchRuns} from "../../tools/osd-batch-runs.mjs";

const store = new BatchRuns(process.cwd(), {...process.env, OSD_OPERATIONS_DB: process.argv[2]});
try {
  const claim = store.claimNext();
  console.log(JSON.stringify({kind: claim.kind, step: claim.step}));
} finally { store.close(); }
