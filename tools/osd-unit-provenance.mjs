// Snapshot the installed tools when a run is made; rendering uses this JSON.
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";

const require = createRequire(import.meta.url);
const version = (name) => {
  // Some packages (sql.js) export their entry point but hide package.json.
  let directory = dirname(require.resolve(name));
  while (true) {
    const file = join(directory, "package.json");
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, "utf8"));
      if (pkg.name === name) return pkg.version;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`installed package metadata missing: ${name}`);
    directory = parent;
  }
};
export function unitProvenance(runtime, {database = "sqlite", heap} = {}) {
  const versions = {
    "@abaplint/runtime": version("@abaplint/runtime"),
    "@abaplint/transpiler": version("@abaplint/transpiler"),
    Node: process.version,
  };
  if (runtime === "osgo") {
    versions.Go = execFileSync("go", ["version"], {cwd: resolve(import.meta.dirname, "gogen/go"), encoding: "utf8"}).trim().split(" ")[2];
  } else if (database === "file") versions["node:sqlite (SQLite)"] = process.versions.sqlite;
  else versions["sql.js"] = version("sql.js");
  const heapArg = [...process.execArgv, process.env.NODE_OPTIONS ?? ""].join(" ").match(/--max[-_]old[-_]space[-_]size(?:=|\s+)(\d+)/);
  return {database: runtime === "osgo" ? "modernc.org/sqlite" : database === "file" ? "--db file (node:sqlite)" : "sql.js (default)",
    heap: heap ?? (heapArg ? `--max-old-space-size=${heapArg[1]} MiB` : "Node default (no --max-old-space-size override)"), versions};
}
