package abap

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// what the Node hosts see of a request: lower-case names, repeated ones
// joined as Node joins them, the host back among the headers, no body
// without a content type
func TestNewICFExchange(t *testing.T) {
	r := httptest.NewRequest("POST", "/sap/opu/odata/sap/X/Set?$top=1&a=%20b", strings.NewReader("hi"))
	r.Header.Add("Accept", "a")
	r.Header.Add("Accept", "b")
	r.Header.Add("Cookie", "c=1")
	r.Header.Add("Cookie", "d=2")
	r.Header.Add("User-Agent", "first")
	r.Header.Add("User-Agent", "second")
	r.Header.Set("Content-Type", "text/plain")
	x, err := NewICFExchange(r, "ZCL_H")
	if err != nil {
		t.Fatal(err)
	}
	if x.URL != "/sap/opu/odata/sap/X/Set?$top=1&a=%20b" || x.Path != "/sap/opu/odata/sap/X/Set" || x.Method != "POST" || string(x.Body) != "hi" {
		t.Fatalf("%+v", x)
	}
	got := map[string]string{}
	for _, h := range x.Headers {
		got[h[0]] = h[1]
	}
	for k, v := range map[string]string{"accept": "a, b", "cookie": "c=1; d=2", "user-agent": "first", "host": "example.com", "content-type": "text/plain"} {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
	r = httptest.NewRequest("POST", "/x", strings.NewReader("ignored"))
	if x, _ = NewICFExchange(r, "ZCL_H"); len(x.Body) != 0 {
		t.Errorf("a body without a content type was read: %q", x.Body)
	}
}

// what express adds to what the shim sent
func TestICFWrite(t *testing.T) {
	for _, c := range []struct {
		method, ct, want string
		code             int32
		body             string
	}{
		{"GET", "application/json", "application/json; charset=utf-8", 200, "{}"},
		{"GET", "text/html", "text/html; charset=utf-8", 200, "{}"},
		{"GET", "application/xml", "application/xml", 200, "{}"},
		{"GET", "application/json; charset=utf-8", "application/json; charset=utf-8", 200, "{}"},
		{"HEAD", "text/plain", "text/plain; charset=utf-8", 200, ""},
		{"GET", "", "", 204, ""},
	} {
		x := &ICFExchange{Status: c.code, RespBody: []byte("{}")}
		if c.ct != "" {
			x.RespHeaders = [][2]string{{"content-type", c.ct}}
		}
		w := httptest.NewRecorder()
		x.Write(w, c.method)
		if w.Code != int(c.code) || w.Header().Get("Content-Type") != c.want || w.Body.String() != c.body && !(c.method == "HEAD" || c.code == 204) {
			t.Errorf("%s %q %d: %d %q %q", c.method, c.ct, c.code, w.Code, w.Header().Get("Content-Type"), w.Body.String())
		}
		if (c.method == "HEAD" || c.code == 204) && w.Body.Len() != 0 {
			t.Errorf("%s %d sent a body", c.method, c.code)
		}
	}
	_ = http.StatusOK
}

func TestICFGetCData(t *testing.T) {
	if ICFGetCData(nil, "\xef\xbb\xbfä") != "\xef\xbb\xbfä" {
		t.Error("a byte order mark or UTF-8 text changed")
	}
	defer func() {
		if r, ok := recover().(ArithmeticError); !ok || r.Class != "CX_SY_CONVERSION_CODEPAGE" {
			t.Errorf("not UTF-8: %v", r)
		}
	}()
	ICFGetCData(nil, "\xff")
}
