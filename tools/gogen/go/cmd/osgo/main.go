// OSGo: open-steamgate's launchpad, apps and services answered by one Go
// binary compiled from OSG's own ABAP (tools/gogen/osgo.mjs builds it).
//
//	.out/osgo [-port 3095] [-addr 127.0.0.1] [-db file.sqlite] [-root <checkout>]
//
// What the Node hosts (test/start.mjs, tools/osd-serve.mjs) do, in Go:
// every ICF request goes through express-icf-shim's CL_EXPRESS_ICF_SHIM=>RUN,
// compiled, whose kernel lines are host functions here (go/abap/icf.go), to
// the handler class: ZCL_STG_HTTP_HANDLER below /sap/opu/odata/sap/, and the
// class of each SICF node of the tree that this program compiled. Each such
// request is one dialog step (abap.DialogStep: committed when it returns,
// rolled back when it dumps), and the steps run one at a time, because class
// statics are per process here as they are in one Node process. The static
// files are the tree's webapp/ and each pack's, at the URLs Node serves them.
//
// The generated half (zz_*.go, zz_db.json) says which program this is:
// boot, runShim, the SICF nodes, the tiles and the pack folders.
package main

import (
	_ "embed"
	"encoding/json"
	"flag"
	"fmt"
	"html"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"time"

	"osg/gogen/abap"
	"osg/gogen/apc"
)

//go:embed zz_db.json
var dbScript []byte

// what the build says about the tree the object store answers over
// (tools/gogen/store.mjs, go/abap/store.go): empty when it was built without one
//
//go:embed zz_store.json
var storeConfig []byte

// one work process: class statics are per process (see the package comment).
// It is abap.WorkProcess, the lock the APC channels' steps take as well
// (go/abap/apc.go), so an ICF request and a push-channel message never run
// ABAP at the same time (ultra/packs).
var workProcess = &abap.WorkProcess

// a push channel (*.sapc.xml) this program serves: its path and handler class
type apcChannel struct {
	Path    string
	Name    string
	Handler string
}

// isUpgrade: a WebSocket handshake asks for it in Upgrade (RFC 6455 4.2.1)
func isUpgrade(r *http.Request) bool {
	for _, v := range r.Header.Values("Upgrade") {
		for _, t := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(t), "websocket") {
				return true
			}
		}
	}
	return false
}

// channelRoutes is tools/osd-apc.mjs mountChannels: an upgrade request goes
// to the channel declared at its path (trailing slashes dropped, the path
// compared as it was sent, not percent-decoded), a declared channel whose class this program lacks is
// refused 501, and an upgrade to any other path is 404. A request that is not
// an upgrade is not the channel's: it is routed as any other (on Node the
// channel lives on the listener's upgrade event, and express answers the rest).
func channelRoutes() func(w http.ResponseWriter, r *http.Request) bool {
	byPath := map[string]http.Handler{}
	for _, c := range apcChannels {
		c := c
		// AnyOrigin: the Node host never looks at Origin, and behind a proxy
		// that rewrites Host a same-origin rule would refuse every page
		// (ultra/packs review); Handler names the class in a start dump's 503
		ch := &apc.Channel{Name: c.Name, Handler: c.Handler, AnyOrigin: true, New: func(s *abap.Session, r *http.Request) apc.Host { return newAPCHost(s, c.Handler, r) }}
		byPath[c.Path] = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// the receipt the Node host writes into its 101 (tools/osd-apc.mjs)
			w.Header().Set("X-OSD-Channel", c.Name)
			ch.ServeHTTP(w, r)
		})
	}
	for _, n := range apcLeftOut {
		byPath[n.Path] = refusal(n)
	}
	if len(byPath) == 0 {
		return func(http.ResponseWriter, *http.Request) bool { return false }
	}
	return func(w http.ResponseWriter, r *http.Request) bool {
		if !isUpgrade(r) {
			return false
		}
		// the raw request path, as the Node host's req.url (not decoded)
		p := apc.RequestPath(r)
		if h, ok := byPath[p]; ok {
			h.ServeHTTP(w, r)
		} else {
			w.WriteHeader(404)
		}
		return true
	}
}

type icfService struct {
	Path    string `json:"path"`
	Handler string `json:"handler"`
	Active  bool   `json:"active"`
}

// a SICF node this program does not serve (its class is not compiled, or its
// handler is not an ABAP class): answered with a refusal at its own path
type icfRefused struct {
	Path    string
	Handler string
	Why     string
}

// refusal answers every request below a node left out: 501, and why. Without
// it the request would fall to the nearest parent node, which would run it
// with the wrong class, or to the 404 of a node that does not exist.
func refusal(n icfRefused) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(501)
		if r.Method != "HEAD" {
			fmt.Fprintf(w, "%s: %s", n.Path, n.Why)
		}
	}
}

// the status service: its tables (ZOSD_SVC ...) are refreshed with this
// process's own snapshot at start and before each request to it, as the Node
// hosts do (test/start.mjs withFreshStatus); status.go (ultra/json)
const statusODataPath = odataBase + "/ZOSD_STATUS_SRV"

// odataBase is where test/start.mjs mounts the OData front.
const odataBase = "/sap/opu/odata/sap"

// the ABAP frames of a dump, innermost first (as gateway.mjs prints them)
func abapStack(r any) []string {
	stack := string(debug.Stack())
	if w, ok := r.(*abap.Rethrown); ok {
		stack = w.Stack
	}
	if i := strings.LastIndex(stack, "panic("); i > 0 {
		stack = stack[i:]
	}
	var out []string
	for _, l := range strings.Split(stack, "\n") {
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
	return out
}

func dumpText(r any) string {
	if e, ok := r.(error); ok {
		return e.Error()
	}
	return fmt.Sprint(r)
}

// step runs one ICF request through the shim as a dialog step. The dump, if
// there is one, comes back with its ABAP frames; the response is then not
// the shim's.
func step(x *abap.ICFExchange, base string) (dump any, frames []string) {
	workProcess.Lock()
	defer workProcess.Unlock()
	func() {
		defer func() {
			if r := recover(); r != nil {
				dump, frames = r, abapStack(r)
			}
		}()
		s := &abap.Session{}
		abap.DialogStep(func() { runShim(s, x, base) })
	}()
	return dump, frames
}

// icfHandler answers a request with the shim and a handler class, as
// mountServices (tools/osd-icf.mjs) and the OData front of the Node hosts do.
// onDump writes the 500 of that host.
func icfHandler(class, base string, onDump func(w http.ResponseWriter, r *http.Request, dump any, frames []string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		x, err := abap.NewICFExchange(r, class)
		if err != nil {
			e := err.(*abap.ICFRequestError)
			http.Error(w, e.Text, e.Status)
			return
		}
		if dump, frames := step(x, base); dump != nil {
			log.Printf("runtime error: %s %s: %s  at %s", r.Method, r.RequestURI, dumpText(dump), strings.Join(frames, " <- "))
			onDump(w, r, dump, frames)
			return
		}
		if !x.Sent {
			onDump(w, r, abap.NotCompiled("CL_EXPRESS_ICF_SHIM=>RUN", "the handler returned without a response"), nil)
			return
		}
		x.Write(w, r.Method)
	}
}

// the OData front's 500 (tools/osd-serve.mjs)
func odataDump(w http.ResponseWriter, r *http.Request, dump any, frames []string) {
	where := ""
	if len(frames) > 0 {
		where = frames[0]
	}
	// JSON.stringify's text: no HTML escaping
	var body strings.Builder
	enc := json.NewEncoder(&body)
	enc.SetEscapeHTML(false)
	enc.Encode(map[string]any{"error": map[string]any{
		"code":       "STG/RUNTIME",
		"message":    map[string]string{"lang": "en", "value": dumpText(dump)},
		"innererror": map[string]any{"where": where, "frames": frames},
	}})
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(500)
	w.Write([]byte(strings.TrimSuffix(body.String(), "\n")))
}

// a SICF node's 500 (tools/osd-icf.mjs mountServices)
func serviceDump(class string) func(w http.ResponseWriter, r *http.Request, dump any, frames []string) {
	return func(w http.ResponseWriter, r *http.Request, dump any, frames []string) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(500)
		fmt.Fprintf(w, "%s: %s", class, dumpText(dump))
	}
}

// notFound is express's finalhandler answer to a request no route took.
func notFound(w http.ResponseWriter, r *http.Request) {
	p := r.URL.EscapedPath()
	body := "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot " +
		html.EscapeString(r.Method) + " " + html.EscapeString(p) + "</pre>\n</body>\n</html>\n"
	h := w.Header()
	h.Set("Content-Security-Policy", "default-src 'none'")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(404)
	if r.Method != "HEAD" {
		w.Write([]byte(body))
	}
}

// the content types express.static (mime 1.x) gives the files the apps have;
// anything else is Go's table, then application/octet-stream
var staticTypes = map[string]string{
	".html": "text/html; charset=UTF-8", ".htm": "text/html; charset=UTF-8", ".js": "application/javascript; charset=UTF-8",
	".mjs": "application/javascript; charset=UTF-8", ".json": "application/json; charset=UTF-8", ".css": "text/css; charset=UTF-8",
	".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon",
	".txt": "text/plain; charset=UTF-8", ".xml": "application/xml", ".map": "application/json; charset=UTF-8", ".woff2": "font/woff2",
	".properties": "application/octet-stream",
}

// serveStatic is express.static(dir) mounted at prefix: GET and HEAD only,
// a folder without its slash redirected to it, index.html for a folder,
// dotfiles not served, ETag and Last-Modified with conditional answers.
func serveStatic(prefix, dir string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			next(w, r)
			return
		}
		rel, err := url.PathUnescape(r.URL.EscapedPath()[len(prefix):])
		if err != nil {
			http.Error(w, "Bad Request", 400)
			return
		}
		// the mount itself (/app) is its folder without the slash: redirected
		clean := path.Clean("/" + rel)
		for _, seg := range strings.Split(clean, "/") {
			if strings.HasPrefix(seg, ".") {
				next(w, r)
				return
			}
		}
		file := filepath.Join(dir, filepath.FromSlash(clean))
		st, err := os.Stat(file)
		if err != nil {
			next(w, r)
			return
		}
		if st.IsDir() {
			if !strings.HasSuffix(rel, "/") {
				to := r.URL.EscapedPath() + "/"
				if r.URL.RawQuery != "" {
					to += "?" + r.URL.RawQuery
				}
				w.Header().Set("Content-Type", "text/html; charset=UTF-8")
				w.Header().Set("Content-Security-Policy", "default-src 'none'")
				w.Header().Set("X-Content-Type-Options", "nosniff")
				w.Header().Set("Location", to)
				w.WriteHeader(301)
				fmt.Fprintf(w, "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Redirecting</title>\n</head>\n<body>\n<pre>Redirecting to %s</pre>\n</body>\n</html>\n", html.EscapeString(to))
				return
			}
			file = filepath.Join(file, "index.html")
			if st, err = os.Stat(file); err != nil || st.IsDir() {
				next(w, r)
				return
			}
		}
		f, err := os.Open(file)
		if err != nil {
			next(w, r)
			return
		}
		defer f.Close()
		ext := strings.ToLower(filepath.Ext(file))
		ct, ok := staticTypes[ext]
		if !ok {
			if ct = mime.TypeByExtension(ext); ct == "" {
				ct = "application/octet-stream"
			}
		}
		h := w.Header()
		h.Set("Content-Type", ct)
		h.Set("Cache-Control", "public, max-age=0")
		h.Set("ETag", fmt.Sprintf(`W/"%x-%x"`, st.Size(), st.ModTime().UnixMilli()))
		http.ServeContent(w, r, "", st.ModTime().Truncate(time.Second), f)
	}
}

// hasPrefixFold: express matches routes without regard to case
func hasPrefixFold(p, prefix string) bool {
	return len(p) >= len(prefix) && strings.EqualFold(p[:len(prefix)], prefix)
}

func main() {
	port := flag.Int("port", 3095, "port to listen on")
	addr := flag.String("addr", "127.0.0.1", "address to listen on")
	dbFile := flag.String("db", "", "an SQLite file (WAL) instead of the in-memory database; seeded once, when it has no tables, and refused when another build seeded it")
	root := flag.String("root", osgRoot, "the checkout whose webapp/ is served")
	media := flag.String("media", "", "the SMW0 media directory (w3mi.json and the data files); default media/ beside the binary when it is there")
	flag.Parse()
	started := time.Now()
	abap.HostFacts = append(abap.HostFacts, "host\tosgo: net/http in front of cl_express_icf_shim, one dialog step per request", buildFacts)

	if *media == "" {
		if exe, err := os.Executable(); err == nil {
			if d := filepath.Join(filepath.Dir(exe), "media"); fileExists(filepath.Join(d, "w3mi.json")) {
				*media = d
			}
		}
	}
	if *media != "" {
		if err := abap.SetMediaDir(*media); err != nil {
			log.Fatalf("media: %v", err)
		}
		log.Printf("media: %s", *media)
	} else {
		log.Printf("media: none (every WWWDATA_IMPORT is IMPORT_ERROR)")
	}

	// DESTINATION 'STORE' (ZOSD_STORE): the object store over the files of
	// -root, the tree this binary was built from unless told another
	if err := abap.SetStore(*root, storeConfig, ""); err != nil {
		log.Fatalf("store: %v", err)
	}

	if *dbFile == "" {
		if err := abap.OpenDB(dbScript); err != nil {
			log.Fatalf("database: %v", err)
		}
		log.Printf("database: in memory, seeded")
		abap.HostFacts = append(abap.HostFacts, "database\tSQLite (modernc.org/sqlite, pure Go), in memory, seeded at start")
	} else {
		seeded, err := abap.OpenDBFile(*dbFile, dbScript)
		if err != nil {
			log.Fatalf("database: %v", err)
		}
		log.Printf("database: %s (WAL)%s", *dbFile, map[bool]string{true: ", new: seeded", false: ", as it was"}[seeded])
		abap.HostFacts = append(abap.HostFacts, "database\tSQLite (modernc.org/sqlite, pure Go), file "+filepath.Base(*dbFile)+", WAL")
	}
	func() {
		defer func() {
			if r := recover(); r != nil {
				log.Fatalf("boot: %s  at %s", dumpText(r), strings.Join(abapStack(r), " <- "))
			}
		}()
		abap.DialogStep(func() { boot(&abap.Session{}) })
	}()

	webapp := filepath.Join(*root, "webapp")
	type route struct {
		prefix string
		exact  bool
		h      http.HandlerFunc
	}
	var routes []route
	// the port's front door is the launchpad when there is one (test/start.mjs root)
	routes = append(routes, route{"/", true, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			notFound(w, r)
			return
		}
		if _, err := os.Stat(filepath.Join(webapp, "flp.html")); err == nil {
			w.Header().Set("Location", "/app/flp.html")
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(302)
			if r.Method != "HEAD" {
				w.Write([]byte("Found. Redirecting to /app/flp.html"))
			}
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(`open-steamgate: OData v2 services live under /sap/opu/odata/sap/, the demo Fiori app under <a href="/app/index.html">/app/</a>`))
	}})
	// the sandbox's optional external config: an empty merge (tools/osd-sandbox-config.mjs)
	routes = append(routes, route{"/appconfig/fioriSandboxConfig.json", true, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write([]byte("{}\n"))
	}})
	// the tiles the packs declare (test/start.mjs pack-tiles), read when this binary was built
	routes = append(routes, route{"/app/packs.json", true, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write([]byte(packTiles))
	}})
	// each pack's own webapp/ under its name, then the tree's
	for p, dir := range packWebapps {
		// a pack folder of the build's checkout is looked for under -root,
		// so a copied tree (root/webapp, root/packs/<name>/webapp) serves it
		if rel, err := filepath.Rel(osgRoot, dir); err == nil && !strings.HasPrefix(rel, "..") {
			dir = filepath.Join(*root, rel)
		}
		routes = append(routes, route{p, false, serveStatic(p, dir, notFound)})
	}
	routes = append(routes, route{"/app", false, serveStatic("/app", webapp, notFound)})
	// the SICF nodes whose handler class this program has
	for _, svc := range icfServices {
		svc := svc
		h := icfHandler(svc.Handler, svc.Path, serviceDump(svc.Handler))
		if !svc.Active {
			h = func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(404) }
		}
		if strings.EqualFold(strings.TrimSuffix(svc.Path, "/"), statusPostPath) {
			h = limitStatusBody(h) // status.go statusBodyLimit (ultra/json fix round)
		}
		routes = append(routes, route{svc.Path, false, h})
	}
	// the nodes left out, each at its own path: longer than its parent's, so
	// it is matched first
	for _, n := range notServed {
		routes = append(routes, route{n.Path, false, refusal(n)})
	}
	odata := icfHandler("ZCL_STG_HTTP_HANDLER", odataBase, odataDump)
	status := statusHost{port: *port, root: *root, dbFile: *dbFile, started: started}
	routes = append(routes, route{statusODataPath, false, odata})
	routes = append(routes, route{odataBase + "/", false, odata})
	// every route under a path test/start.mjs refreshes the status tables
	// for (statusFreshPrefixes: ZOSD_STATUS_SRV and the webgui, which reads
	// the same tables) refreshes them first (ultra/json fix round)
	for i, rt := range routes {
		if freshPath(rt.prefix) {
			routes[i].h = withFreshStatus(status, rt.h)
		}
	}
	if !freshPath(statusODataPath) {
		log.Printf("status: test/start.mjs does not refresh before %s, neither does this process", statusODataPath)
	}
	// longest prefix first, so /sap/bc/a/b is not taken by /sap/bc/a
	sort.SliceStable(routes, func(i, j int) bool { return len(routes[i].prefix) > len(routes[j].prefix) })

	upgrade := channelRoutes()
	mux := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if upgrade(w, r) {
			return
		}
		p := r.URL.EscapedPath()
		for _, rt := range routes {
			switch {
			case rt.exact:
				if strings.EqualFold(p, rt.prefix) || strings.EqualFold(p, rt.prefix+"/") {
					rt.h(w, r)
					return
				}
			case strings.HasSuffix(rt.prefix, "/"):
				if hasPrefixFold(p, rt.prefix) {
					rt.h(w, r)
					return
				}
			default:
				// a mount: the path itself or anything below it
				if strings.EqualFold(p, rt.prefix) || hasPrefixFold(p, rt.prefix+"/") {
					rt.h(w, r)
					return
				}
			}
		}
		notFound(w, r)
	})

	for _, svc := range icfServices {
		log.Printf("ICF service  on http://localhost:%d%s  (%s)", *port, svc.Path, svc.Handler)
	}
	for _, n := range notServed {
		log.Printf("not served   %s: %s (answers 501)", n.Path, n.Why)
	}
	for _, c := range apcChannels {
		log.Printf("Push channel on ws://localhost:%d%s  (%s)", *port, c.Path, c.Handler)
	}
	for _, n := range apcLeftOut {
		log.Printf("not served   %s: %s (an upgrade answers 501)", n.Path, n.Why)
	}
	server := &http.Server{Addr: fmt.Sprintf("%s:%d", *addr, *port), Handler: mux, ReadHeaderTimeout: 30 * time.Second}
	ln, err := net.Listen("tcp", server.Addr)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Listening on http://localhost:%d/  (launchpad /app/flp.html, OData %s/)", *port, odataBase)
	// the status tables have this process in them before anybody asks, with
	// the listener already open (its state is read off /proc/net/tcp)
	if rows, err := refreshStatus(status); err != nil {
		log.Printf("status refresh: %v", err)
	} else {
		log.Printf("status       %d rows of this process in the status tables, refreshed before each %s request", rows, statusODataPath)
	}
	log.Fatal(server.Serve(ln))
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
