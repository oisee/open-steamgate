package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"osg/gogen/abap"
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
		response.Body.Close()
		if response.StatusCode != http.StatusNotImplemented {
			t.Fatalf("%s status %d, want 501", path, response.StatusCode)
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
