// OSG's own gateway through the Go backend: every ABAP object of src/, gen/
// and the libraries of abap_transpile.json compiled (a statement outside the
// subset raises NOT_COMPILED at its ABAP line when it runs), then the start
// of OSG (the SEGW registry) and one request through ZCL_STG_DISPATCHER.
//
//   node tools/gogen/gateway.mjs [path]      default: the demo service document
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";
import {home} from "./home.mjs";

const path = process.argv[2] ?? "/sap/opu/odata/sap/ZSTG_DEMO_SRV/";
const here = import.meta.dirname;
const walk = (d) => readdirSync(d, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const layers = [`${home}/src`, `${home}/gen`];
const libs = ["open-abap-core/src", "express-icf-shim/src", "open-abap-apc/src", "open-abap-gui/src", "open-abap-gui/scaffold", "open-abap-odata/src", "ajson/src/core"]
  .map((d) => `${home}/.local/lars/${d}`).filter(existsSync);
const objects = [...new Set([...layers, ...libs].flatMap(walk).filter((f) => /\.(clas|intf)\.abap$/.test(f) && !f.includes("testclasses")).map((f) => f.split("/").pop().split(".")[0]))];
const t0 = performance.now();
const program = compileProgram({folders: [...layers, ...libs], objects, tolerant: true});
console.log(`front end: ${program.classes.length} classes, ${program.partial.length} statement stubs, ${program.broken.length} objects with syntax errors (${Math.round(performance.now() - t0)} ms)`);
const dir = join(here, "go", "cmd", "gateway");
mkdirSync(dir, {recursive: true});
writeFileSync(join(dir, "zz_generated.go"), emitGo(program));
writeFileSync(join(dir, "main.go"), `package main

import (
	"fmt"
	"os"

	"osg/gogen/abap"
)

func main() {
	s := &abap.Session{}
	defer func() {
		if r := recover(); r != nil {
			fmt.Println("DUMP", r)
			os.Exit(1)
		}
	}()
	ZCL_STG_SEGW_REGISTRY_REGISTER(s)
	res := ZCL_STG_DISPATCHER_DISPATCH(s, "GET", ${JSON.stringify(path)}, nil, "localhost", "", "", "")
	fmt.Printf("%d %s\\n%s\\n%s\\n", res.status, res.reason, res.content_type, res.body)
}
`);
try { execFileSync("gofmt", ["-w", dir], {stdio: ["ignore", "pipe", "pipe"]}); } catch (e) { console.log(`gofmt: ${String(e.stderr).split("\n").slice(0, 10).join("\n")}`); process.exit(1); }
const t1 = performance.now();
try {
  execFileSync("go", ["build", "-o", join(here, ".out", "gateway"), "./cmd/gateway"], {cwd: join(here, "go"), stdio: ["ignore", "pipe", "pipe"]});
} catch (e) {
  const lines = String(e.stderr).split("\n").filter((l) => l.includes(".go:"));
  console.log(`go build failed, ${lines.length} errors; first:\n${lines.slice(0, 25).join("\n")}`);
  process.exit(1);
}
console.log(`go build ${Math.round(performance.now() - t1)} ms`);
try {
  console.log(execFileSync("prlimit", ["--as=4000000000", join(here, ".out", "gateway")], {timeout: 60000}).toString());
} catch (e) { console.log(String(e.stdout) + String(e.stderr).slice(0, 800)); }
