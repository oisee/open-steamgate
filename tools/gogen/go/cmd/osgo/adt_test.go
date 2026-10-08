package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"osg/gogen/abap"
	"osg/gogen/hostclass"
)

func TestADTEnabled(t *testing.T) {
	getenv := func(key string) string { return map[string]string{"OSD_OSGO_ADT": "1"}[key] }
	if adtEnabled(false, func(string) string { return "" }) {
		t.Fatal("ADT is on by default")
	}
	if !adtEnabled(true, func(string) string { return "" }) || !adtEnabled(false, getenv) {
		t.Fatal("ADT is not enabled by flag or environment")
	}
}

// Closest host-level equivalent to a stateful ABAP dump: bind the request's
// stateful key through the installed hostclass adapter, then dump its step.
func TestADTStatefulDumpRetiresContext(t *testing.T) {
	const id = "test-stateful-dump"
	defer adtKernel.End(id)
	var old int64
	func() {
		defer func() {
			if recover() != "request dump" {
				t.Fatal("dump changed")
			}
		}()
		s := &abap.Session{}
		withADTSession(s, func() {
			ok, err := hostclass.ZCL_OSD_ENQ_KERNEL.Bind(s, id, "USER")
			if !ok || err != nil {
				t.Fatalf("bind: %v %v", ok, err)
			}
			old, _ = adtKernel.Handle(id)
			panic("request dump")
		})
	}()
	if adtKernel.ContextAlive(id) {
		t.Fatal("dumped context is still alive")
	}
	s := &abap.Session{}
	withADTSession(s, func() {
		ok, err := hostclass.ZCL_OSD_ENQ_KERNEL.Bind(s, id, "USER")
		next, _ := adtKernel.Handle(id)
		if !ok || err != nil || next == old {
			t.Fatalf("replacement: %v %v %d -> %d", ok, err, old, next)
		}
	})
	if !adtKernel.ContextAlive(id) {
		t.Fatal("successful request lost its context")
	}
}

func TestADTNotCompiledTrapIs501(t *testing.T) {
	request := httptest.NewRequest("GET", "/sap/bc/adt", nil)
	response := httptest.NewRecorder()
	adtDump(response, request, abap.NotCompiled("ZCL_OSD_ADT_HANDLER=>ANSWER", "WHERE NP"), nil)
	if response.Code != http.StatusNotImplemented {
		t.Fatalf("status %d, want 501", response.Code)
	}
	if !strings.Contains(response.Body.String(), "NOT_COMPILED in ZCL_OSD_ADT_HANDLER=>ANSWER") {
		t.Fatalf("trap text missing: %q", response.Body.String())
	}
}

func TestADTHandlerTurnsACompiledFrontTrapInto501(t *testing.T) {
	if !hasADTSession {
		t.Skip("ADT classes absent in echo build")
	}
	request := httptest.NewRequest("GET", "/sap/bc/adt", nil)
	response := httptest.NewRecorder()
	icfHandler("ZCL_OSD_ADT_HANDLER", "/sap/bc/adt", adtDump).ServeHTTP(response, request)
	if response.Code != http.StatusNotImplemented {
		t.Fatalf("status %d, body %q: want 501", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "NOT_COMPILED") {
		t.Fatalf("trap text missing: %q", response.Body.String())
	}
}

func TestADTMountMatchesUnsuffixedPathThroughRouteMatcher(t *testing.T) {
	handler := routeMatcher([]route{{"/sap/bc/adt", false, icfHandler("ZCL_OSD_ADT_HANDLER", "/sap/bc/adt", adtDump)}},
		func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) }, nil)
	server := httptest.NewServer(handler)
	defer server.Close()
	for _, path := range []string{"/sap/bc/adt", "/sap/bc/adt/repository/info"} {
		response, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		// The mount reaches ZCL_OSD_ADT_HANDLER (its trap, refusal or answer),
		// never the router's 404, whatever the handler's first gap is today.
		if response.StatusCode == http.StatusNotFound && !strings.Contains(string(body), "ZCL_OSD_ADT") {
			t.Fatalf("%s: router 404, the ADT handler was not reached: %q", path, body)
		}
	}
}

func TestADTMountPreservesTransportHeadersAndHeadBodyRule(t *testing.T) {
	exchange := &abap.ICFExchange{Status: 200, RespBody: []byte("body\n"), Sent: true,
		RespHeaders: [][2]string{{"Set-Cookie", "one=1"}, {"Set-Cookie", "two=2"}, {"x-csrf-token", "secret"}}}
	handler := routeMatcher([]route{{"/sap/bc/adt", false, func(w http.ResponseWriter, r *http.Request) {
		exchange.Write(w, r.Method)
	}}}, http.HandlerFunc(http.NotFound), nil)
	server := httptest.NewServer(handler)
	defer server.Close()
	request, err := http.NewRequest(http.MethodHead, server.URL+"/sap/bc/adt", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if len(response.Header.Values("Set-Cookie")) != 2 || response.Header.Get("x-csrf-token") != "secret" {
		t.Fatalf("transport headers: %v", response.Header)
	}
	if response.ContentLength != int64(len(exchange.RespBody)) {
		t.Fatalf("HEAD Content-Length %d, want %d", response.ContentLength, len(exchange.RespBody))
	}
	if body, err := io.ReadAll(response.Body); err != nil || len(body) != 0 {
		t.Fatalf("HEAD body %q (%v)", body, err)
	}
}

func TestADTSessionBindingCleanup(t *testing.T) {
	previous := bindADTSession
	defer func() { bindADTSession = previous }()
	bound, count := false, 0
	bindADTSession = func(s *abap.Session) func() {
		if bound {
			t.Fatal("previous request still bound")
		}
		bound = true
		count++
		return func() { bound = false }
	}
	withADTSession(&abap.Session{}, func() {
		if !bound {
			t.Fatal("session absent")
		}
	})
	func() {
		defer func() {
			if recover() != "dump" {
				t.Fatal("dump changed")
			}
		}()
		withADTSession(&abap.Session{}, func() { panic("dump") })
	}()
	if bound || count != 2 {
		t.Fatalf("bound=%v requests=%d", bound, count)
	}
}

// Two ADT steps interleave (as a WAIT-like sleep will let them): each Bind
// pins into its own step, found by the session the seam passes, so the step
// that dumps retires only its own context.
func TestADTStepsAreKeyedBySession(t *testing.T) {
	const a, b = "test-step-a", "test-step-b"
	defer adtKernel.End(a)
	defer adtKernel.End(b)
	sa, sb := &abap.Session{}, &abap.Session{}
	func() {
		defer func() {
			if recover() != "a dumps" {
				t.Fatal("dump changed")
			}
		}()
		withADTSession(sa, func() {
			withADTSession(sb, func() {
				if ok, err := hostclass.ZCL_OSD_ENQ_KERNEL.Bind(sb, b, "USER"); !ok || err != nil {
					t.Fatalf("bind b: %v %v", ok, err)
				}
			})
			if ok, err := hostclass.ZCL_OSD_ENQ_KERNEL.Bind(sa, a, "USER"); !ok || err != nil {
				t.Fatalf("bind a: %v %v", ok, err)
			}
			panic("a dumps")
		})
	}()
	if adtKernel.ContextAlive(a) {
		t.Fatal("a's dumped context is still alive")
	}
	if !adtKernel.ContextAlive(b) {
		t.Fatal("b's context was retired by a's dump")
	}
}
