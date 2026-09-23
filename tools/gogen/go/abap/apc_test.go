package abap

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// fakeHost is an APCHost that records its calls: ON_START sends "hello",
// each message is echoed upper case, "dump" sends then panics
type fakeHost struct {
	mu     sync.Mutex
	reject bool
	queue  []string
	calls  []string
	closed chan string
}

func (f *fakeHost) Open(s *Session) bool {
	f.calls = append(f.calls, "open")
	if f.reject {
		return false
	}
	f.queue = append(f.queue, "hello")
	return true
}
func (f *fakeHost) Message(s *Session, t string) {
	f.calls = append(f.calls, "msg:"+t)
	f.queue = append(f.queue, strings.ToUpper(t))
	if t == "dump" {
		panic(ArithmeticError{"CX_SY_ZERODIVIDE", "/"})
	}
}
func (f *fakeHost) Close(s *Session, reason string, code int32) {
	f.closed <- reason + "/" + itoa(int(code))
}
func (f *fakeHost) Drain(s *Session) []string {
	q := f.queue
	f.queue = nil
	return q
}

func serve(t *testing.T, f *fakeHost) (*httptest.Server, string) {
	ch := &APCChannel{Name: "t", New: func(s *Session, r *http.Request) APCHost { return f }, Logf: func(string, ...any) {}}
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
