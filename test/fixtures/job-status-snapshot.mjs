import {readJobSnapshot} from "../../tools/osd-job-snapshot.mjs";

const [sourceDb, operationsDb, jobName, jobCount] = process.argv.slice(2);
const snapshot = readJobSnapshot({sourceDb, jobName, jobCount,
  caller: {client: "123", user: "DEVELOPER", sid: "OSG"},
  env: {OSD_OPERATIONS_DB: operationsDb}});
console.log(JSON.stringify(snapshot));
