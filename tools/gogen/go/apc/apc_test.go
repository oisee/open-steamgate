package apc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"osg/gogen/abap"
)

// fakeHost is an APCHost that records its calls: ON_START sends "hello",
// each message is echoed upper case, "dump" sends then panics
type fakeHost struct {
	mu     sync.Mutex
	reject bool
	queue  []string
	calls  []string
	closed chan string
	news   int
}

func (f *fakeHost) Open(s *abap.Session) bool {
	f.calls = append(f.calls, "open")
	if f.reject {
		return false
	}
	f.queue = append(f.queue, "hello")
	return true
}
func (f *fakeHost) Message(s *abap.Session, t string) {
	f.calls = append(f.calls, "msg:"+t)
	f.queue = append(f.queue, strings.ToUpper(t))
	if t == "dump" {
		panic(abap.ArithmeticError{Class: "CX_SY_ZERODIVIDE", Op: "/"})
	}
}
func (f *fakeHost) Close(s *abap.Session, reason string, code int32) {
	f.closed <- reason + "/" + strconv.Itoa(int(code))
}
func (f *fakeHost) Drain(s *abap.Session) []string {
	q := f.queue
	f.queue = nil
	return q
}

func serve(t *testing.T, f *fakeHost) (*httptest.Server, string) {
	ch := &Channel{Name: "t", New: func(s *abap.Session, r *http.Request) Host { f.news++; return f }, Logf: func(string, ...any) {}}
	srv := httptest.NewServer(ch)
	t.Cleanup(srv.Close)
	return srv, "ws" + strings.TrimPrefix(srv.URL, "http")
}

func read(t *testing.T, c *websocket.Conn) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, b, err := c.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	return string(b)
}

func TestAPCChannel(t *testing.T) {
	f := &fakeHost{closed: make(chan string, 1)}
	_, url := serve(t, f)
	ctx := context.Background()
	c, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	// what ON_START sent comes after the socket is open
	if got := read(t, c); got != "hello" {
		t.Fatalf("first message %q", got)
	}
	c.Write(ctx, websocket.MessageText, []byte("abc"))
	if got := read(t, c); got != "ABC" {
		t.Fatalf("echo %q", got)
	}
	// a dump ends the step, not the connection; what it sent is dropped
	c.Write(ctx, websocket.MessageText, []byte("dump"))
	c.Write(ctx, websocket.MessageText, []byte("x"))
	if got := read(t, c); got != "X" {
		t.Fatalf("after a dump %q", got)
	}
	c.Close(websocket.StatusNormalClosure, "bye")
	select {
	case got := <-f.closed:
		if got != "bye/1000" {
			t.Fatalf("ON_CLOSE %q", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no ON_CLOSE")
	}
}

func TestAPCRejectAndBinary(t *testing.T) {
	f := &fakeHost{reject: true, closed: make(chan string, 1)}
	srv, url := serve(t, f)
	if _, resp, err := websocket.Dial(context.Background(), url, nil); err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("a rejected connection: %v %v", err, resp)
	}
	srv.Close()

	g := &fakeHost{closed: make(chan string, 1)}
	_, url = serve(t, g)
	c, _, err := websocket.Dial(context.Background(), url, nil)
	if err != nil {
		t.Fatal(err)
	}
	read(t, c)
	c.Write(context.Background(), websocket.MessageBinary, []byte{1, 2})
	if got := <-g.closed; got != "binary message/1003" {
		t.Fatalf("ON_CLOSE after binary %q", got)
	}
	_, _, err = c.Read(context.Background())
	if websocket.CloseStatus(err) != websocket.StatusUnsupportedData {
		t.Fatalf("close status %v", err)
	}
}

// a request that is not a WebSocket handshake runs no ABAP: New is not
// called, and it is answered before anything else
func TestAPCNotAHandshake(t *testing.T) {
	f := &fakeHost{closed: make(chan string, 1)}
	srv, _ := serve(t, f)
	for _, c := range []struct {
		method string
		hdr    map[string]string
		want   int
	}{
		{"GET", nil, http.StatusUpgradeRequired},
		{"HEAD", nil, http.StatusUpgradeRequired},
		{"GET", map[string]string{"Connection": "Upgrade", "Upgrade": "websocket"}, http.StatusBadRequest},
		{"GET", map[string]string{"Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13"}, http.StatusBadRequest},
		{"POST", map[string]string{"Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="}, http.StatusMethodNotAllowed},
	} {
		req, _ := http.NewRequest(c.method, srv.URL, nil)
		for k, v := range c.hdr {
			req.Header.Set(k, v)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != c.want {
			t.Fatalf("%s %v: %d, want %d", c.method, c.hdr, resp.StatusCode, c.want)
		}
	}
	if f.news != 0 || len(f.calls) != 0 {
		t.Fatalf("ABAP ran for a request that is not a handshake: new %d, calls %v", f.news, f.calls)
	}
}

// a page of another origin is refused before any ABAP runs; a pattern lets it in
func TestAPCOrigin(t *testing.T) {
	f := &fakeHost{closed: make(chan string, 1)}
	_, url := serve(t, f)
	opts := &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"http://evil.example"}}}
	if _, resp, err := websocket.Dial(context.Background(), url, opts); err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("a cross-origin connection: %v %v", err, resp)
	}
	if f.news != 0 {
		t.Fatalf("ABAP ran for a refused origin")
	}

	g := &fakeHost{closed: make(chan string, 1)}
	ch := &Channel{Name: "t", OriginPatterns: []string{"*.example"}, New: func(s *abap.Session, r *http.Request) Host { return g }, Logf: func(string, ...any) {}}
	srv := httptest.NewServer(ch)
	defer srv.Close()
	c, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(srv.URL, "http"), opts)
	if err != nil {
		t.Fatalf("an allowed origin: %v", err)
	}
	if got := read(t, c); got != "hello" {
		t.Fatalf("first message %q", got)
	}
	c.Close(websocket.StatusNormalClosure, "")
	<-g.closed
}
