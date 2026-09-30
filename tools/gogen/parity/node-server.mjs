// The reference: OSG on Node, the inline shape a suite gets when it calls
// startServer() itself, but in a process of its own on STG_PORT. Run with the
// checkout as cwd.
import {pathToFileURL} from "node:url";
import {join} from "node:path";
const {startServer} = await import(pathToFileURL(join(process.cwd(), "test", "start.mjs")).href);
startServer(true);
