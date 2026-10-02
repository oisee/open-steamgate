// An independent worker process for test/job-delete.mjs: drains the job
// outbox of STG_DB_PATH into OSD_OPERATIONS_DB, as `node
// tools/osd-batch-runs.mjs drain` does. It says READY once initialised and
// drains at the first line on stdin; with the argument "pause" it says READ
// once it has read the outbox and waits for another line before it claims
// and imports. It ends with RESULT and the drain's answer.
import {createInterface} from "node:readline";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {BatchRuns} from "../../../tools/osd-batch-runs.mjs";
import {drainJobOutbox} from "../../../tools/osd-job-outbox.mjs";

const lines = createInterface({input: process.stdin})[Symbol.asyncIterator]();
const root = process.cwd();
const {initializeABAP} = await import(pathToFileURL(join(root, "output", "init.mjs")).href);
await initializeABAP();
const store = new BatchRuns(root, process.env);
process.stdout.write("READY\n");
await lines.next();
const afterRead = process.argv[2] === "pause" ? async (rows) => {
  process.stdout.write(`READ ${rows.length}\n`);
  await lines.next();
} : undefined;
let result;
try { result = await drainJobOutbox(store, {env: process.env, afterRead}); }
catch (error) { result = {error: String(error?.message ?? error)}; }
process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
store.close();
await globalThis.abap.context.databaseConnections.DEFAULT.disconnect();
process.exit(0);
