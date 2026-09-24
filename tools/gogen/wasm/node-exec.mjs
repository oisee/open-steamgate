// Runs a GOOS=js GOARCH=wasm binary under Node with sql.js loaded first, so
// the sqljs driver of go/abap (db_wasm.go) has its database: Go's own
// wasm_exec_node.js, plus globalThis.SQL = await initSqlJs(). sql.js loads
// asynchronously; once it is there every call Go makes into it is synchronous.
//
//   GOOS=js GOARCH=wasm go test -exec "$PWD/tools/gogen/wasm/go_js_wasm_exec" ./abap/
//   node tools/gogen/wasm/node-exec.mjs prog.wasm [args]
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import * as fs from "node:fs";
import {join} from "node:path";

const require = createRequire(import.meta.url);
const goroot = process.env.GOROOT || execFileSync("go", ["env", "GOROOT"]).toString().trim();
if (process.argv.length < 3) {
  console.error("usage: node-exec.mjs <wasm binary> [arguments]");
  process.exit(1);
}
const initSqlJs = require("sql.js");
globalThis.SQL = await initSqlJs();
// a file DSN (OpenDBFile: "file:<path>?<pragmas>") is the file read into
// memory, and written back whenever the driver says it was saved
const fileOf = (dsn) => dsn.startsWith("file:") ? dsn.slice(5).split("?")[0] : undefined;
globalThis.osgoOpenDatabase = (dsn) => {
  const file = fileOf(dsn);
  if (file === undefined) return null;
  return new SQL.Database(fs.existsSync(file) ? fs.readFileSync(file) : undefined);
};
globalThis.osgoSaveDatabase = (dsn, bytes) => {
  const file = fileOf(dsn);
  if (file !== undefined) fs.writeFileSync(file, bytes);
};
globalThis.require = require;
globalThis.fs = require("node:fs");
globalThis.path = require("node:path");
require(join(goroot, "lib", "wasm", "wasm_exec.js"));
const go = new Go();
go.argv = process.argv.slice(2);
go.env = Object.assign({TMPDIR: require("node:os").tmpdir()}, process.env);
go.exit = process.exit;
const {instance} = await WebAssembly.instantiate(fs.readFileSync(process.argv[2]), go.importObject);
process.on("exit", (code) => {
  if (code === 0 && !go.exited) {
    go._pendingEvent = {id: 0};
    go._resume();
  }
});
await go.run(instance);
