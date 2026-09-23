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
		// mime.charsets.lookup does not trim: a leading space is no text type
		{"GET", " text/plain", " text/plain", 200, "{}"},
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

// what express refuses of the response: a second Content-Type (res.set of an
// array) and a second send (headers already sent), each a host error
func TestICFResponseRefusals(t *testing.T) {
	x := &ICFExchange{}
	d := Data{P: x}
	refused := func(what string, f func()) {
		t.Helper()
		defer func() {
			if _, ok := recover().(HostError); !ok {
				t.Errorf("%s: not a host error", what)
			}
		}()
		f()
	}
	ICFResponseAppend(nil, d, "Content-Type", "text/plain")
	ICFResponseAppend(nil, d, "x-a", "1")
	ICFResponseAppend(nil, d, "x-a", "2")
	refused("second content-type", func() { ICFResponseAppend(nil, d, "content-type", "text/html") })
	ICFResponseSend(nil, d, 200, "a")
	refused("second send", func() { ICFResponseSend(nil, d, 200, "b") })
	if len(x.RespHeaders) != 3 || string(x.RespBody) != "a" {
		t.Errorf("%+v", x)
	}
}
