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
//
// A request as the ICF sees it (--icf, implied by --method, --header and
// --body): the Go host does what cl_express_icf_shim=>run does -- a
// CL_HTTP_SERVER with two CL_HTTP_ENTITYs, the headers, ~path, the query as
// form fields -- and calls ZCL_STG_HTTP_HANDLER, so the CSRF token, the
// dialog step's COMMIT/ROLLBACK brackets and the response headers are the
// handler's own. The answer is printed with the status, every header the
// ABAP set, and the body (text, or its length and sha256 when it is bytes).
//
//   --method M          the method of every path (a path "M /x" names its own)
//   --header 'k: v'     a request header (repeatable)
//   --body @file|text   the request body
//   --steps             every request in ONE process, in order, each its own
//                       dialog step on one database: a write and the read
//                       that sees it (without it each request starts seeded)
//   --compare <origin>  each answer next to what a running OSG answers for the
//                       same request (status, the ABAP's headers, the body)
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";
import {home} from "./home.mjs";

const argv = process.argv.slice(2);
// --compare <origin>: each answer's body next to what a running OSG answers
// for the same path (one table line per path at the end)
const take = (flag, many = false) => {
  const out = [];
  for (let i = argv.indexOf(flag); i >= 0; i = argv.indexOf(flag)) out.push(argv.splice(i, 2)[1]);
  return many ? out : out.at(-1);
};
const flag = (name) => { const i = argv.indexOf(name); if (i >= 0) argv.splice(i, 1); return i >= 0; };
const compareWith = take("--compare");
const method = take("--method");
const headerArgs = take("--header", true);
const bodyArg = take("--body");
const steps = flag("--steps");
const icf = flag("--icf") || method !== undefined || headerArgs.length > 0 || bodyArg !== undefined || steps;
const paths = argv.length > 0 ? argv : ["/sap/opu/odata/sap/ZSTG_DEMO_SRV/"];
const body = bodyArg === undefined ? "" : bodyArg.startsWith("@") ? readFileSync(bodyArg.slice(1)) : Buffer.from(bodyArg, "utf8");
const requests = paths.map((p) => {
  const m = /^([A-Z]+) (\/.*)$/.exec(p);
  const rq = {method: m ? m[1] : (method ?? "GET"), path: m ? m[2] : p, headers: []};
  // the host header a client sends; the answers' absolute URLs are built from it
  rq.headers.push(["host", new URL(compareWith ?? process.env.GW_HOST ?? "http://localhost:3091").host]);
  for (const h of headerArgs) {
    const i = h.indexOf(":");
    rq.headers.push([h.slice(0, i).trim().toLowerCase(), h.slice(i + 1).trim()]);
  }
  rq.body = rq.method === "GET" || rq.method === "HEAD" ? "" : body.toString("base64");
  return rq;
});
const here = import.meta.dirname;
const walk = (d) => readdirSync(d, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const layers = [`${home}/src`, `${home}/gen`];
const libs = ["open-abap-core/src", "express-icf-shim/src", "open-abap-apc/src", "open-abap-gui/src", "open-abap-gui/scaffold", "open-abap-odata/src", "ajson/src/core"]
  .map((d) => `${home}/.local/lars/${d}`).filter(existsSync);
const objects = [...new Set([...layers, ...libs].flatMap(walk).filter((f) => /\.(clas|intf)\.abap$/.test(f) && !f.includes("testclasses")).map((f) => f.split("/").pop().split(".")[0]))];
const t0 = performance.now();
// GW_REUSE=1: the Go of the last compile and its database again, only the
// host (main.go) rewritten -- for work on the host, not on the compiler
const reuse = process.env.GW_REUSE === "1" && existsSync(join(here, "go", "cmd", "gateway", "zz_generated.go"));
const program = reuse ? null : compileProgram({folders: [...layers, ...libs], objects, tolerant: true});
const dir = join(here, "go", "cmd", "gateway");
mkdirSync(dir, {recursive: true});
if (!reuse) {
console.log(`front end: ${program.classes.length} classes, ${program.partial.length} statement stubs, ${program.skipped.length} methods not compiled, ${program.broken.length} objects with syntax errors (${Math.round(performance.now() - t0)} ms)`);
writeFileSync(join(dir, "zz_generated.go"), emitGo(program));
// the database: the transpiler's CREATE TABLEs for this registry and the rows
// test/seed.mjs gives the Node side, so both hosts start from the same data
const {DatabaseSetup} = await import(`${home}/node_modules/@abaplint/transpiler/build/src/db/index.js`);
const setup = new DatabaseSetup(program.reg).run();
process.env.OSD_ROOT ??= home;
const {seedStatements} = await import(`${home}/test/seed.mjs`);
const seed = seedStatements();
// rows of a table this program has no definition for (a pack's) are left
// out, and said so
const created = new Set(setup.schemas.sqlite.map((x) => /^CREATE\s+(?:TABLE|VIEW)\s+['"]?([\w\/]+)/i.exec(x)?.[1]?.toLowerCase()).filter(Boolean));
const inserts = [...setup.insert, ...(Array.isArray(seed) ? seed : [seed])].filter((x) => String(x).trim() !== "");
const skipped = new Map();
const kept = inserts.filter((x) => {
  const t = /^INSERT\s+INTO\s+['"]?([\w\/]+)/i.exec(x)?.[1]?.toLowerCase();
  if (t === undefined || created.has(t)) return true;
  skipped.set(t, (skipped.get(t) ?? 0) + 1);
  return false;
});
writeFileSync(join(dir, "zz_db.json"), JSON.stringify([...setup.schemas.sqlite, ...kept]));
console.log(`database: ${created.size} tables and views, ${kept.length} inserts${skipped.size ? `; left out, no table in this program: ${[...skipped].map(([t, n]) => `${t} (${n})`).join(", ")}` : ""}`);

}
writeFileSync(join(dir, "main.go"), `package main

import (
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"runtime/debug"
	"net/url"
	"strings"

	"osg/gogen/abap"
)

// one request as the ICF hands it over, and what the handler answered
type icfRequest struct {
	Method  string      \`json:"method"\`
	Path    string      \`json:"path"\`
	Headers [][2]string \`json:"headers"\`
	Body    string      \`json:"body"\` // base64
}
type icfResponse struct {
	Status  int32       \`json:"status"\`
	Reason  string      \`json:"reason"\`
	Headers [][2]string \`json:"headers"\`
	Body    string      \`json:"body"\` // base64
	Dump    string      \`json:"dump,omitempty"\`
	At      string      \`json:"at,omitempty"\`
}

// what cl_express_icf_shim=>run does with an express request, line for line:
// the request entity (body, method, headers, ~request_uri, ~query_string, the
// query as form fields, ~path, ~path_info below the base), the handler, and
// the response entity read back (status 200 and text/html when unset)
func icf(s *abap.Session, rq icfRequest, base string) icfResponse {
	server := New_CL_HTTP_SERVER(s)
	req := New_CL_HTTP_ENTITY(s)
	server.if_http_server__request = req
	body, err := base64.StdEncoding.DecodeString(rq.Body)
	if err != nil {
		panic(err)
	}
	req.IF_HTTP_ENTITY__SET_DATA(s, string(body))
	req.IF_HTTP_REQUEST__SET_METHOD(s, rq.Method)
	req.IF_HTTP_ENTITY__SET_HEADER_FIELD(s, "~request_method", rq.Method)
	for _, h := range rq.Headers {
		req.IF_HTTP_ENTITY__SET_HEADER_FIELD(s, h[0], h[1])
	}
	req.IF_HTTP_ENTITY__SET_HEADER_FIELD(s, "~request_uri", rq.Path)
	path, query, _ := strings.Cut(rq.Path, "?")
	req.IF_HTTP_ENTITY__SET_HEADER_FIELD(s, "~query_string", query)
	fields := CL_HTTP_UTILITY_IF_HTTP_UTILITY__STRING_TO_FIELDS(s, query, 0)
	req.IF_HTTP_ENTITY__SET_FORM_FIELDS(s, &fields, 0)
	req.IF_HTTP_ENTITY__SET_HEADER_FIELD(s, "~path", path)
	req.IF_HTTP_ENTITY__SET_HEADER_FIELD(s, "~path_translated_expanded", path)
	info := strings.Replace(path, base, "", 1)
	req.IF_HTTP_ENTITY__SET_HEADER_FIELD(s, "~path_info", info)
	req.IF_HTTP_ENTITY__SET_HEADER_FIELD(s, "~path_info_expanded", info)
	res := New_CL_HTTP_ENTITY(s)
	server.if_http_server__response = res
	New_ZCL_STG_HTTP_HANDLER(s).IF_HTTP_EXTENSION__HANDLE_REQUEST(s, server)
	var out icfResponse
	res.IF_HTTP_RESPONSE__GET_STATUS(s, &out.Status, &out.Reason)
	if out.Status == 0 {
		out.Status = 200
	}
	if res.IF_HTTP_ENTITY__GET_CONTENT_TYPE(s) == "" {
		res.IF_HTTP_ENTITY__SET_CONTENT_TYPE(s, "text/html")
	}
	var hs []IHTTPNVP
	res.IF_HTTP_ENTITY__GET_HEADER_FIELDS(s, &hs)
	for _, h := range hs {
		out.Headers = append(out.Headers, [2]string{h.name, h.value})
	}
	out.Body = base64.StdEncoding.EncodeToString([]byte(res.IF_HTTP_ENTITY__GET_DATA(s, "")))
	return out
}

// every request of the file in order, each one dialog step; a dump ends its
// step (rolled back) and is reported, and the next request still runs
func icfMain(s *abap.Session, file string) {
	raw, err := os.ReadFile(file)
	if err != nil {
		panic(err)
	}
	var rqs []icfRequest
	if err := json.Unmarshal(raw, &rqs); err != nil {
		panic(err)
	}
	for _, rq := range rqs {
		var out icfResponse
		func() {
			defer func() {
				if r := recover(); r != nil {
					out = icfResponse{Dump: fmt.Sprint(r), At: abapStack(r)}
				}
			}()
			abap.DialogStep(func() {
				out = icf(s, rq, "/sap/opu/odata/sap")
			})
		}()
		line, _ := json.Marshal(out)
		fmt.Printf("RESPONSE %s\\n", line)
	}
}

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
	if os.Args[1] == "--requests" {
		icfMain(s, os.Args[2])
		return
	}
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
if (icf) {
  await runIcf();
  process.exit(0);
}
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

/* ------------------------------------------------------------ the ICF mode */

function isText(ct) { return /^(application\/(json|xml|atom\+xml|atomsvc\+xml)|text\/|multipart\/|application\/http)/i.test(ct); }
function show(r) {
  if (r.dump) return `DUMP ${r.dump}\n  at ${r.at}`;
  const bytes = Buffer.from(r.body, "base64");
  const ct = r.headers.find(([k]) => k === "content-type")?.[1] ?? "";
  const text = isText(ct) ? bytes.toString("utf8") : `<${bytes.length} bytes, sha256 ${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}>`;
  return [`${r.status} ${r.reason}`, ...r.headers.map(([k, v]) => `${k}: ${v}`), "", text].join("\n");
}

async function osgAnswer(rq) {
  const headers = Object.fromEntries(rq.headers.filter(([k]) => k !== "host"));
  const res = await fetch(compareWith + rq.path, {method: rq.method, headers, body: rq.body === "" ? undefined : Buffer.from(rq.body, "base64")});
  return {status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer())};
}

// status, every header the ABAP set (OSG's HTTP layers add more: date, etag,
// content-length, x-powered-by), and the body byte for byte
function verdict(r, o) {
  if (r.dump) return `Go dumped: ${r.dump.slice(0, 200)}`;
  const diffs = [];
  if (r.status !== o.status) diffs.push(`status ${r.status}, OSG ${o.status}`);
  for (const [k, v] of r.headers) {
    const ov = o.headers.get(k);
    if (ov !== v) diffs.push(`header ${k}: Go ${JSON.stringify(v)} OSG ${JSON.stringify(ov)}`);
  }
  const g = Buffer.from(r.body, "base64");
  if (!g.equals(o.body)) {
    let i = 0;
    while (i < g.length && i < o.body.length && g[i] === o.body[i]) i += 1;
    diffs.push(`body differs at byte ${i} (Go ${g.length}, OSG ${o.body.length} bytes): Go ${JSON.stringify(g.subarray(i, i + 60).toString("latin1"))} OSG ${JSON.stringify(o.body.subarray(i, i + 60).toString("latin1"))}`);
  }
  return diffs.length ? diffs.join("; ") : `equal (status ${r.status}, ${r.headers.length} headers, ${g.length} bytes)`;
}

async function runIcf() {
  const groups = steps ? [requests] : requests.map((r) => [r]);
  let n = 0;
  for (const group of groups) {
    const file = join(here, ".out", `requests-${n}.json`);
    writeFileSync(file, JSON.stringify(group));
    n += 1;
    let out;
    try {
      out = execFileSync("prlimit", ["--as=4000000000", join(here, ".out", "gateway"), "--requests", file], {timeout: 120000, maxBuffer: 1 << 28}).toString();
    } catch (e) { out = String(e.stdout) + String(e.stderr).slice(0, 2000); }
    const answers = out.split("\n").filter((l) => l.startsWith("RESPONSE ")).map((l) => JSON.parse(l.slice(9)));
    if (answers.length !== group.length) console.log(out.slice(0, 4000));
    for (let i = 0; i < answers.length; i += 1) {
      const rq = group[i];
      console.log(`== ${rq.method} ${rq.path}\n${show(answers[i])}\n`);
      if (compareWith !== undefined) table.push(`${rq.method} ${rq.path}\t${verdict(answers[i], await osgAnswer(rq))}`);
    }
  }
  if (table.length) console.log(`compared with ${compareWith}:\n${table.join("\n")}`);
}
