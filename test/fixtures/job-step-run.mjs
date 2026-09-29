import {resolve} from "node:path";
import {initializeABAP} from "../../output/init.mjs";
import {BatchRuns, workQueuedBatch} from "../../tools/osd-batch-runs.mjs";

await initializeABAP();
const root = resolve(".");
const store = new BatchRuns(root, process.env);
try {
  const result = await workQueuedBatch(root, store);
  if (result.kind !== "completed") throw new Error(`Expected completed step, got ${result.kind}`);
} finally { store.close(); }
