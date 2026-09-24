//go:build js && wasm

// OSGo in a service worker: the same program as the net/http server, with
// the worker's fetch handler in the role of the listener (the shape of
// web/preview-backend.mjs for the transpiler's runtime). The worker loads
// sql.js and this wasm, and Go leaves globalThis.osgo behind:
//
//	osgo.handle({method, url, headers, body}) -> Promise<{status, headers, body}>
//	osgo.exportDatabase() -> Uint8Array   (for cache storage; between steps only)
//
// and calls globalThis.osgoReady({ms, stored, error}) once the database is
// open and the boot classes ran. url is the path and query below the mount
// (/sap/opu/odata/sap/...), headers a plain object, body a Uint8Array or
// undefined; the answer's headers are [name, value] pairs, the body a
// Uint8Array. Each request is one dialog step (step in main.go), as on the
// server: committed when it returns, rolled back when it dumps.
//
// APC: a page's WebSocket to a push channel is a MessageChannel to the
// worker (web/preview-socket.mjs, the JS preview's shim, injected into the
// HTML answers as there), and the worker calls
//
//	osgo.apcOpen(path, query) -> Promise<{out, message(text), close(reason, code)}>
//
// out is what ON_START sent (the worker signals open first, then sends it:
// "open before drain"); message answers a Promise of what ON_MESSAGE sent,
// and rejects when the step dumped (the worker closes 1011 "handler failed",
// as go/apc and the Node host do). Every call is abap.APCStep: the work
// process held, a dialog step of its own. The handler is the compiled
// ZCL_APC_HOST through the same adapter as the server's (zz_boot.go).
//
// Files: Go's os under GOOS=js calls globalThis.fs, which the worker
// provides over fetch for media/ (the SMW0 objects, OSGO_MEDIA), so
// WWWDATA_IMPORT is the same code as on the server; the files are fetched
// when a page asks for them, not carried in the wasm.
//
// The database is sql.js through go/abap's sqljs driver (db_wasm.go):
// seeded from zz_db.json, or an image (OSGO_STORED=1 in the environment)
// the worker hands over as osgoOpenDatabase("preview"): the copy it kept in
// cache storage, or the one the build seeded by running this same wasm
// under Node (tools/gogen/wasm-preview.mjs, seed.sqlite), which is what
// spares a first visit the seeding.
package main

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"syscall/js"
	"time"

	"osg/gogen/abap"
	"osg/gogen/apc"
)

func init() { jsMain = wasmMain }

// recorder is the ResponseWriter a request is answered into
type recorder struct {
	h      http.Header
	status int
	body   bytes.Buffer
}

func (r *recorder) Header() http.Header { return r.h }
func (r *recorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = 200
	}
	return r.body.Write(b)
}
func (r *recorder) WriteHeader(code int) {
	if r.status == 0 {
		r.status = code
	}
}

func wasmMain() {
	started := time.Now()
	abap.HostFacts = append(abap.HostFacts, "host\tosgo in a service worker: GOOS=js GOARCH=wasm, the worker's fetch in front of cl_express_icf_shim, one dialog step per request", buildFacts)
	ready := js.Global().Get("osgoReady")
	fail := func(what string, err any) {
		msg := fmt.Sprintf("%s: %v", what, err)
		log.Print(msg)
		if ready.Type() == js.TypeFunction {
			ready.Invoke(map[string]any{"error": msg})
		}
		select {}
	}
	// SMW0: the worker's fs answers the files of media/ beside the wasm
	// (osgo-sw.js), which is where WWWDATA_IMPORT reads them through os, as
	// the server reads them from the disk; no media, every import is
	// IMPORT_ERROR, as on a server started without -media
	if dir := os.Getenv("OSGO_MEDIA"); dir != "" {
		if err := abap.SetMediaDir(dir); err != nil {
			log.Printf("media: %v (every WWWDATA_IMPORT is IMPORT_ERROR)", err)
		}
	}
	stored := os.Getenv("OSGO_STORED") == "1"
	if stored {
		if err := abap.OpenDBImage("preview"); err != nil {
			fail("database", err)
		}
		abap.HostFacts = append(abap.HostFacts, "database\tSQLite (sql.js through syscall/js), in memory, read back from cache storage")
	} else {
		if err := abap.OpenDB(dbScript); err != nil {
			fail("database", err)
		}
		abap.HostFacts = append(abap.HostFacts, "database\tSQLite (sql.js through syscall/js), in memory, seeded at start")
	}
	seeded := time.Since(started)
	func() {
		defer func() {
			if r := recover(); r != nil {
				fail("boot", fmt.Sprintf("%s  at %s", dumpText(r), strings.Join(abapStack(r), " <- ")))
			}
		}()
		// an image (the worker's copy, or the one the build seeded) holds the
		// demo rows already: ZCL_OSD_DEMO_DATA=>BOOT would write them again
		startABAP(!stored)
	}()
	mux := buildMux("", statusHost{started: started})

	handle := js.FuncOf(func(this js.Value, args []js.Value) any {
		req := args[0]
		return promise(func() (any, error) { return serveJS(mux, req) })
	})
	export := js.FuncOf(func(this js.Value, args []js.Value) any {
		b, err := abap.SqljsExport()
		if err != nil {
			panic(err)
		}
		return bytesToJS(b)
	})
	var paths []any
	for _, c := range apcChannels {
		paths = append(paths, c.Path)
	}
	apcOpen := js.FuncOf(func(this js.Value, args []js.Value) any {
		path, query := args[0].String(), args[1].String()
		return promise(func() (any, error) { return openChannelJS(path, query) })
	})
	js.Global().Set("osgo", map[string]any{"handle": handle, "exportDatabase": export, "channels": paths, "apcOpen": apcOpen})
	if ready.Type() == js.TypeFunction {
		ready.Invoke(map[string]any{"ms": time.Since(started).Milliseconds(), "seedMs": seeded.Milliseconds(), "stored": stored})
	}
	select {}
}

// promise runs work on a goroutine of its own, as syscall/js wants of
// anything that may block (a request that fetches, a file read through
// the host), and settles a JS Promise with its answer
func promise(work func() (any, error)) js.Value {
	executor := js.FuncOf(func(this js.Value, args []js.Value) any {
		resolve, reject := args[0], args[1]
		go func() {
			v, err := func() (v any, err error) {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("%v", r)
					}
				}()
				return work()
			}()
			if err != nil {
				reject.Invoke(js.Global().Get("Error").New(err.Error()))
				return
			}
			resolve.Invoke(v)
		}()
		return nil
	})
	defer executor.Release()
	return js.Global().Get("Promise").New(executor)
}

func bytesToJS(b []byte) js.Value {
	u := js.Global().Get("Uint8Array").New(len(b))
	js.CopyBytesToJS(u, b)
	return u
}

// serveJS answers one request of the worker through the program's routes
func serveJS(mux http.Handler, req js.Value) (any, error) {
	method := req.Get("method").String()
	target := req.Get("url").String()
	var body io.Reader = http.NoBody
	if b := req.Get("body"); b.Truthy() {
		buf := make([]byte, b.Get("length").Int())
		js.CopyBytesToGo(buf, b)
		body = bytes.NewReader(buf)
	}
	headers := req.Get("headers")
	host := "localhost"
	if h := headers.Get("host"); h.Truthy() {
		host = h.String()
	}
	r, err := http.NewRequest(method, "http://"+host+target, body)
	if err != nil {
		return nil, err
	}
	r.RequestURI = target
	r.Host = host
	r.RemoteAddr = "127.0.0.1:0"
	keys := js.Global().Get("Object").Call("keys", headers)
	for i := 0; i < keys.Length(); i++ {
		k := keys.Index(i).String()
		r.Header.Set(k, headers.Get(k).String())
	}
	if cl := r.Header.Get("Content-Length"); cl != "" {
		fmt.Sscan(cl, &r.ContentLength)
	}
	w := &recorder{h: http.Header{}}
	mux.ServeHTTP(w, r)
	if w.status == 0 {
		w.status = 200
	}
	var pairs []any
	for k, vs := range w.h {
		for _, v := range vs {
			pairs = append(pairs, []any{k, v})
		}
	}
	return map[string]any{"status": w.status, "headers": pairs, "body": bytesToJS(w.body.Bytes())}, nil
}

// openChannelJS starts a connection of the push channel at path, as
// go/apc's Channel does after a handshake: the constructor and ON_START each
// a step; a dump there, or ON_ACCEPT's refusal, is an error (the worker
// closes the page's socket with it)
func openChannelJS(path, query string) (any, error) {
	var ch *apcChannel
	for i := range apcChannels {
		if apcChannels[i].Path == strings.TrimRight(path, "/") {
			ch = &apcChannels[i]
		}
	}
	if ch == nil {
		return nil, fmt.Errorf("no channel on %s", path)
	}
	r, err := http.NewRequest("GET", "http://localhost"+path+"?"+query, http.NoBody)
	if err != nil {
		return nil, err
	}
	r.RequestURI = path + "?" + query
	s := &abap.Session{}
	var host apc.Host
	if err := abap.APCStep("CONSTRUCTOR", func() { host = newAPCHost(s, ch.Handler, r) }); err != nil {
		return nil, fmt.Errorf("%s: %v", ch.Handler, dumpOf(err))
	}
	if host == nil {
		return nil, fmt.Errorf("%s: ZCL_APC_HOST is not in this program", ch.Handler)
	}
	var accepted bool
	var out []string
	if err := abap.APCStep("ON_START", func() { accepted = host.Open(s); out = host.Drain(s) }); err != nil {
		return nil, fmt.Errorf("%s: %v", ch.Handler, dumpOf(err))
	}
	if !accepted {
		return nil, fmt.Errorf("the handler refused the connection")
	}
	closed := false
	message := js.FuncOf(func(this js.Value, args []js.Value) any {
		text := args[0].String()
		return promise(func() (any, error) {
			var sent []string
			if err := abap.APCStep("ON_MESSAGE", func() { host.Message(s, text); sent = host.Drain(s) }); err != nil {
				return nil, fmt.Errorf("handler failed: %v", dumpOf(err))
			}
			return strs(sent), nil
		})
	})
	var closeFn js.Func
	closeFn = js.FuncOf(func(this js.Value, args []js.Value) any {
		reason, code := "closed by the client", int32(1000)
		if len(args) > 0 && args[0].Type() == js.TypeString {
			reason = args[0].String()
		}
		if len(args) > 1 && args[1].Type() == js.TypeNumber {
			code = int32(args[1].Int())
		}
		return promise(func() (any, error) {
			if closed {
				return nil, nil
			}
			closed = true
			abap.APCStep("ON_CLOSE", func() { host.Close(s, reason, code) })
			message.Release()
			closeFn.Release()
			return nil, nil
		})
	})
	return map[string]any{"out": strs(out), "message": message, "close": closeFn}, nil
}

func dumpOf(err error) any {
	if d, ok := err.(*abap.ErrDump); ok {
		return d.Dump
	}
	return err
}

func strs(ss []string) []any {
	out := make([]any, len(ss))
	for i, v := range ss {
		out[i] = v
	}
	return out
}
