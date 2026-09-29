// Pending definitions for the narrow JOB_* ABAP facade. The private RFC
// destination uses the current dialog-step token; no definition is process
// global or allowed to survive COMMIT, ROLLBACK, WAIT, dump, or step exit.
import {randomUUID, randomInt} from "node:crypto";
import {resolve} from "node:path";
import {currentStepToken, onStepLuwEnd} from "./osd-dialog-step.mjs";
import {givenText, fill} from "./osd-destination.mjs";
import {liveGeneration} from "./osd-batch-runs.mjs";

const pending = new WeakMap();
const keyOf = (name, count) => `${name}\0${count}`;

export class JobDestination {
  constructor(root = process.cwd(), env = process.env) {
    this.root = root;
    this.env = env;
    this.generation = liveGeneration(root);
  }

  async call(_name, signature) {
    const token = currentStepToken();
    if (token === undefined) throw new Error("JOB_* requires a dialog step");
    const command = givenText(signature, "IV_COMMAND").toUpperCase();
    const jobname = givenText(signature, "IV_JOBNAME").toUpperCase();
    const count = givenText(signature, "IV_JOBCOUNT");
    const program = givenText(signature, "IV_PROGRAM").toUpperCase();
    const owner = givenText(signature, "IV_OWNER").toUpperCase();
    const client = givenText(signature, "IV_CLIENT");
    const db = globalThis.abap?.context?.databaseConnections?.DEFAULT;
    if (this.env.STG_DB !== "file" || !db?.path || db.path === ":memory:") {
      fill(signature, {EV_ERROR: "JOB_* requires a durable STG_DB=file business database"});
      return;
    }
    let jobs = pending.get(token);
    if (jobs === undefined) {
      jobs = new Map();
      pending.set(token, jobs);
      onStepLuwEnd(() => pending.delete(token));
    }
    let answer;
    switch (command) {
      case "OPEN": {
        if (!jobname || jobname.length > 32) { answer = {EV_ERROR: "Invalid job name"}; break; }
        let number;
        do { number = String(randomInt(100000000)).padStart(8, "0"); }
        while (jobs.has(keyOf(jobname, number)));
        jobs.set(keyOf(jobname, number), {jobname, count: number, owner, client});
        answer = {EV_JOBCOUNT: number};
        break;
      }
      case "SUBMIT": {
        const job = jobs.get(keyOf(jobname, count));
        if (!job || job.owner !== owner || job.client !== client) { answer = {EV_ERROR: "Job definition not found in this LUW"}; break; }
        if (job.program) { answer = {EV_ERROR: "Only one report step is supported"}; break; }
        job.program = program;
        answer = {};
        break;
      }
      case "CLOSE": {
        const key = keyOf(jobname, count);
        const job = jobs.get(key);
        if (!job || job.owner !== owner || job.client !== client) { answer = {EV_ERROR: "Job definition not found in this LUW"}; break; }
        if (!job.program) { answer = {EV_ERROR: "Job has no report step"}; break; }
        if (resolve(db.path).length > 255) { answer = {EV_ERROR: "Business database path exceeds outbox field length"}; break; }
        jobs.delete(key);
        answer = {
          EV_INTENT_ID: randomUUID().replaceAll("-", ""),
          EV_PROGRAM: job.program,
          EV_GENERATION: this.generation,
          EV_SOURCE_DB: resolve(db.path),
        };
        break;
      }
      default: answer = {EV_ERROR: `Unknown job command ${command}`};
    }
    fill(signature, answer);
  }
}
