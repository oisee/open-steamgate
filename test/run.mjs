// The way a server is started: the workbench shape by default (test/start.mjs
// explains the two), unless STG_SERVE says otherwise. A suite that wants the
// old inline shape calls startServer() itself and never comes through here.
process.env.STG_SERVE ??= "child";
// and the rows in a real file, so they survive a recycle and a crash: the
// file client of tools/sqlite-file-client.mjs, at .local/db/osd.sqlite
// unless STG_DB_PATH says where. STG_DB=sqlite asks for the in-memory one.
process.env.STG_DB ??= "file";
const {startServer} = await import("./start.mjs");
startServer();
