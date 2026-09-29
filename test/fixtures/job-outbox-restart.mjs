// First process exits after operations import; the second retries from disk.
import {BatchRuns} from "../../tools/osd-batch-runs.mjs";
import {drainJobOutbox} from "../../tools/osd-job-outbox.mjs";
await import("../../output/init.mjs");
const store = new BatchRuns(process.cwd(), process.env);
if (process.argv[2] === "crash") {
  await drainJobOutbox(store, {afterImport: () => process.exit(73)});
  throw new Error("expected to exit after import");
}
if (process.argv[2] !== "retry") throw new Error("unknown fixture mode");
console.log(JSON.stringify(await drainJobOutbox(store)));
store.close();
