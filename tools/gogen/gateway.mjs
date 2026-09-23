// OSG's own gateway through the Go backend: every ABAP object of src/, gen/
// and the libraries of abap_transpile.json compiled (a statement outside the
// subset raises NOT_COMPILED at its ABAP line when it runs), then the start
// of OSG (the SEGW registry) and one request through ZCL_STG_DISPATCHER.
//
//   node tools/gogen/gateway.mjs [path ...]  default: the demo service document
//
// Several paths share one compile and one go build (a minute each); the
// binary then runs once per path, each run from the seeded database, and
// each answer is printed after a "== <path>" line when there is more than one.
import {execFileSync} from "node:child_process";
import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {emitGo} from "./emit-go.mjs";
import {compileOsg, osgDatabase} from "./osg-build.mjs";

const argv = process.argv.slice(2);
// --compare <origin>: each answer's body next to what a running OSG answers
// for the same path (one table line per path at the end)
const ci = argv.indexOf("--compare");
const compareWith = ci >= 0 ? argv.splice(ci, 2)[1] : undefined;
const paths = argv.length > 0 ? argv : ["/sap/opu/odata/sap/ZSTG_DEMO_SRV/"];
const here = import.meta.dirname;
const {program, summary} = compileOsg();
console.log(summary);
const dir = join(here, "go", "cmd", "gateway");
mkdirSync(dir, {recursive: true});
writeFileSync(join(dir, "zz_generated.go"), emitGo(program));
const db = await osgDatabase(program);
writeFileSync(join(dir, "zz_db.json"), JSON.stringify(db.statements));
console.log(db.summary);
writeFileSync(join(dir, "main.go"), `package main

import (
	_ "embed"
	"fmt"
	"os"
	"runtime/debug"
	"net/url"
	"strings"

	"osg/gogen/abap"
)

// the ABAP frames of the stack, innermost first
func abapStack(r any) string {
	stack := string(debug.Stack())
	if w, ok := r.(*abap.Rethrown); ok {
		stack = w.Stack
	}
	// the frames above the (last) panic are the handlers; the origin is below it
	if i := strings.LastIndex(stack, "panic("); i > 0 {
		stack = stack[i:]
	}
	var out []string
	for _, l := range strings.Split(stack, "\\n") {
		l = strings.TrimSpace(l)
		if i := strings.Index(l, ".abap:"); i > 0 {
			if j := strings.IndexAny(l[i:], " +"); j > 0 {
				l = l[:i+j]
			}
			out = append(out, l[strings.LastIndex(l, "/")+1:])
		}
	}
	if len(out) > 8 {
		out = out[:8]
	}
	return strings.Join(out, " <- ")
}

//go:embed zz_db.json
var dbScript []byte

func main() {
	s := &abap.Session{}
	defer func() {
		if r := recover(); r != nil {
			fmt.Println("DUMP", r)
			fmt.Println("  at", abapStack(r))
			os.Exit(1)
		}
	}()
	if err := abap.OpenDB(dbScript); err != nil {
		fmt.Println("DATABASE", err)
		os.Exit(1)
	}
	ZCL_STG_SEGW_REGISTRY_REGISTER(s)
	// the search helps of src/ as providers, as test/start.mjs does
	ZCL_STG_SHLP_REGISTRY_REGISTER(s)
	// what the ICF handler does before dispatch: ~path without the query,
	// the query as form fields, decoded; the host as the outside sees it
	path, query, _ := strings.Cut(os.Args[1], "?")
	opts := []IHTTPNVP{}
	for _, kv := range strings.Split(query, "&") {
		if kv == "" {
			continue
		}
		k, v, _ := strings.Cut(kv, "=")
		k, _ = url.QueryUnescape(k)
		v, _ = url.QueryUnescape(v)
		opts = append(opts, IHTTPNVP{name: k, value: v})
	}
	// one dialog step: its database LUW is committed when it ends and rolled
	// back when it dumps (abap.DialogStep, the kernel's rule)
	var res ZCL_STG_DISPATCHER__TY_RESPONSE
	abap.DialogStep(func() {
		res = ZCL_STG_DISPATCHER_DISPATCH(s, "GET", path, &opts, ${JSON.stringify(process.env.GW_HOST ?? "http://localhost:3091")}, "", "", "")
	})
	fmt.Printf("%d %s\\n%s\\n%s\\n", res.status, res.reason, res.content_type, res.body)
}
`);
try { execFileSync("gofmt", ["-w", dir], {stdio: ["ignore", "pipe", "pipe"]}); } catch (e) { console.log(`gofmt: ${String(e.stderr).split("\n").slice(0, 10).join("\n")}`); process.exit(1); }
const t1 = performance.now();
try {
  execFileSync("go", ["build", "-o", join(here, ".out", "gateway"), "./cmd/gateway"], {cwd: join(here, "go"), stdio: ["ignore", "pipe", "pipe"]});
} catch (e) {
  const lines = String(e.stderr).split("\n").filter((l) => /\.(go|abap):\d/.test(l));
  console.log(`go build failed, ${lines.length} errors; first:\n${lines.slice(0, 25).join("\n")}`);
  process.exit(1);
}
console.log(`go build ${Math.round(performance.now() - t1)} ms`);
const table = [];
for (const path of paths) {
  if (paths.length > 1) console.log(`== ${path}`);
  let out;
  try {
    out = execFileSync("prlimit", ["--as=4000000000", join(here, ".out", "gateway"), path], {timeout: 60000}).toString();
  } catch (e) { out = String(e.stdout) + String(e.stderr).slice(0, 800); }
  console.log(out);
  if (compareWith === undefined) continue;
  const res = await fetch(compareWith + path);
  const osg = await res.text();
  const m = /^(\d{3}) [^\n]*\n[^\n]*\n([\s\S]*)\n$/.exec(out);
  let verdict;
  if (m === null) verdict = out.split("\n")[0].slice(0, 160);
  else if (Number(m[1]) !== res.status) verdict = `status ${m[1]}, OSG ${res.status}`;
  else if (m[2] === osg) verdict = `equal (${osg.length} bytes)`;
  else {
    let i = 0;
    while (i < osg.length && m[2][i] === osg[i]) i += 1;
    verdict = `differs at byte ${i}: Go ${JSON.stringify(m[2].slice(i, i + 40))} OSG ${JSON.stringify(osg.slice(i, i + 40))}`;
  }
  table.push(`${path}\t${verdict}`);
}
if (table.length) console.log(`compared with ${compareWith}:\n${table.join("\n")}`);
