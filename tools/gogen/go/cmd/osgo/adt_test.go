package main

import (
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
