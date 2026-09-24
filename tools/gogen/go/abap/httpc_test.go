package abap

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"crypto/x509"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// what a request through the kernel lines of CL_HTTP_CLIENT's SEND puts on
// the wire and gives back, against a server of the test's own (TLS, with its
// certificate trusted); tools/gogen/httpc.mjs compares the same with Node
func TestHTTPCSendTLS(t *testing.T) {
	var got *http.Request
	var body []byte
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		body, _ = io.ReadAll(r.Body)
		w.Header().Add("X-Multi", "a")
		w.Header().Add("X-Multi", "b")
		w.Header().Add("Set-Cookie", "s=1")
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(201)
		w.Write([]byte("made"))
	}))
	defer srv.Close()
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	httpcRoots = pool
	defer func() { httpcRoots = nil }()

	s := &Session{}
	me := new(int)
	HTTPCHeadersNew(s, me)
	HTTPCHeader(s, me, "content-type", "text/plain")
	HTTPCHeader(s, me, "user-agent", "open-abap-http")
	HTTPCAcceptGzip(s, me)
	HTTPCContentLength(s, me, "café")
	HTTPCSend(s, me, srv.URL+"/x?y=1", "post", "café")

	if got.Method != "POST" || got.RequestURI != "/x?y=1" {
		t.Fatalf("request line %s %s", got.Method, got.RequestURI)
	}
	if !bytes.Equal(body, []byte("caf\xe9")) || got.ContentLength != 4 {
		t.Fatalf("body %q, content-length %d: one latin1 byte per UTF-16 unit", body, got.ContentLength)
	}
	if got.Header.Get("Accept-Encoding") != "gzip" || got.Header.Get("Connection") != "" && got.Header.Get("Connection") != "keep-alive" {
		t.Fatalf("headers %v", got.Header)
	}
	var status int32
	var ctype, data string
	HTTPCResponseStatus(s, me, &status)
	HTTPCResponseContentType(s, me, &ctype)
	HTTPCResponseBody(s, me, &data)
	if status != 201 || ctype != "text/plain" || data != "made" {
		t.Fatalf("answer %d %q %q", status, ctype, data)
	}
	h := map[string]string{}
	for _, kv := range HTTPCResponseHeaders(s, me) {
		h[kv[0]] = kv[1]
	}
	if h["x-multi"] != "a, b" {
		t.Fatalf("x-multi %q", h["x-multi"])
	}
	if _, ok := h["set-cookie"]; ok {
		t.Fatal("set-cookie is an array on Node, which the ABAP's loop skips")
	}
	// the same client sends again on the same socket
	first := httpcOf(s, me).conn
	HTTPCHeadersNew(s, me)
	HTTPCSend(s, me, srv.URL+"/again", "GET", "")
	if httpcOf(s, me).conn != first {
		t.Fatal("a second send of the client did not reuse its connection")
	}
}

func TestHTTPCTLSUntrusted(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()
	s := &Session{}
	me := new(int)
	HTTPCHeadersNew(s, me)
	defer func() {
		if _, ok := recover().(HostError); !ok {
			t.Fatal("a certificate nobody trusts must end in a host error (Node rejects it)")
		}
	}()
	HTTPCSend(s, me, srv.URL+"/", "GET", "")
}

func TestHTTPCTarget(t *testing.T) {
	for _, c := range []struct{ url, host, target string }{
		{"http://h.example:80/a", "h.example", "/a"},
		{"https://h.example:443", "h.example", "/"},
		{"https://h.example:8443/a?b=c#frag", "h.example:8443", "/a?b=c"},
		{"HTTPS://H.Example/x", "h.example", "/x"},
	} {
		got := parseTarget(c.url)
		if got.hostHdr != c.host || got.target != c.target {
			t.Errorf("%s: host %q target %q", c.url, got.hostHdr, got.target)
		}
	}
	for _, c := range []struct{ url, kind string }{
		{"HTTP://h/x", "host"},       // the https module, protocol http:
		{"ftp://h/x", "host"},        // neither module
		{"h/x", "host"},              // no scheme: invalid URL
		{"http://h:99999/", "host"},  // invalid port
		{"http://u:p@h/", "refused"}, // credentials become an Authorization header on Node
		{"http://127.1/", "refused"}, // WHATWG reads it as 127.0.0.1
		{"http://h/a/./b", "refused"},
		{"http://h/a?x='", "refused"}, // WHATWG escapes ' in a special query
	} {
		func() {
			defer func() {
				r := recover()
				_, host := r.(HostError)
				ae, _ := r.(ArithmeticError)
				if (c.kind == "host") != host || (c.kind == "refused") != (ae.Class == "NOT_COMPILED") {
					t.Errorf("%s: %v, want %s", c.url, r, c.kind)
				}
			}()
			parseTarget(c.url)
		}()
	}
}

func TestJSObjectOrder(t *testing.T) {
	var o jsObject
	for _, k := range []string{"b", "10", "a", "2", "01", "b"} {
		o.set(k, k)
	}
	if got := strings.Join(o.ordered(), ","); got != "2,10,b,a,01" {
		t.Fatalf("order %s", got)
	}
}

func TestReadResponseFraming(t *testing.T) {
	raw := "HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nCookie: a\r\ncookie: b\r\nServer: x\r\nServer: y\r\n\r\n3\r\nabc\r\n0\r\nX-Trailer: t\r\n\r\n"
	br := bufio.NewReader(strings.NewReader(raw + "HTTP/1.0 200 OK\r\n\r\nrest"))
	r, keep, err := readResponse(br, false)
	if err != nil || !keep || string(r.body) != "abc" {
		t.Fatalf("%v %v %q", err, keep, r.body)
	}
	if v, _ := r.headers.get("cookie"); v != "a; b" {
		t.Fatalf("cookie %q", v)
	}
	if v, _ := r.headers.get("server"); v != "x" {
		t.Fatalf("server %q", v)
	}
	r, keep, err = readResponse(br, false)
	if err != nil || keep || string(r.body) != "rest" {
		t.Fatalf("close-delimited: %v %v %q", err, keep, r.body)
	}
}

func TestHTTPCRefusedDial(t *testing.T) {
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	addr := l.Addr().String()
	l.Close()
	s := &Session{}
	me := new(int)
	HTTPCHeadersNew(s, me)
	defer func() {
		if _, ok := recover().(HostError); !ok {
			t.Fatal("a refused connection is a host error (a JavaScript error on Node, a dump)")
		}
	}()
	HTTPCSend(s, me, "http://"+addr+"/", "GET", "")
}

func TestGunzipWithHeader(t *testing.T) {
	var b bytes.Buffer
	for _, part := range []string{"one ", "two"} {
		z := gzip.NewWriter(&b)
		z.Write([]byte(part))
		z.Close()
	}
	var out string
	GunzipWithHeader(&Session{}, b.String(), &out)
	if out != "one two" {
		t.Fatalf("members: %q", out)
	}
	for _, bad := range []string{"", "nope", b.String() + "garbage", b.String()[:b.Len()-3]} {
		func() {
			defer func() {
				if _, ok := recover().(HostError); !ok {
					t.Errorf("%q: zlib.gunzipSync throws, a dump", bad)
				}
			}()
			GunzipWithHeader(&Session{}, bad, &out)
		}()
	}
}
