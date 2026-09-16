// The way a server is started: the workbench shape by default (test/start.mjs
// explains the two), unless STG_SERVE says otherwise. A suite that wants the
// old inline shape calls startServer() itself and never comes through here.
process.env.STG_SERVE ??= "child";
const {startServer} = await import("./start.mjs");
startServer();
