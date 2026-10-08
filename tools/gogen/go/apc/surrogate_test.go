package apc

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"osg/gogen/abap"
)

type surrogateHost struct {
	fakeHost
	lone bool
}

func (f *surrogateHost) Open(s *abap.Session) bool {
	hi, lo := abap.SubS("😀", 0, 1), abap.SubS("😀", 1, 1)
	if f.lone {
		f.queue = append(f.queue, hi)
	} else {
		f.queue = append(f.queue, abap.ConcatLinesOf([]string{hi, lo}, ""))
	}
	return true
}

func TestRound3APCJoinedText(t *testing.T) {
	host := &surrogateHost{fakeHost: fakeHost{closed: make(chan string, 1)}}
	ch := &Channel{Name: "surrogate", New: func(*abap.Session, *http.Request) Host { return host }, Logf: func(string, ...any) {}}
	srv := httptest.NewServer(ch)
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	_, text, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if string(text) != "😀" {
		t.Fatalf("APC text bytes=%x", text)
	}
}

// Inspect the frame bytes without a UTF-8-validating receiver. OSGo submits
// lone WTF-8 halves unchanged; the kernel's policy is unmeasured.
func TestRound3APCLoneBytes(t *testing.T) {
	host := &surrogateHost{fakeHost: fakeHost{closed: make(chan string, 1)}, lone: true}
	ch := &Channel{Name: "lone", New: func(*abap.Session, *http.Request) Host { return host }, Logf: func(string, ...any) {}}
	srv := httptest.NewServer(ch)
	defer srv.Close()
	req, err := http.NewRequest("GET", srv.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 101 {
		t.Fatalf("upgrade: %d", resp.StatusCode)
	}
	frame := make([]byte, 5)
	if _, err := io.ReadFull(resp.Body, frame); err != nil {
		t.Fatal(err)
	}
	if string(frame) != "\x81\x03\xed\xa0\xbd" {
		t.Fatalf("lone frame=%x", frame)
	}
}
