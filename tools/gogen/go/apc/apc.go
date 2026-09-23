// Package apc is APC, the ABAP Push Channel, for a Go host: the socket part
// of what the ICF does around an IF_APC_WSP_EXTENSION handler.
//
// The ABAP part stays ABAP. open-abap-apc's ZCL_APC_HOST holds one
// connection to one handler: its constructor creates the handler class by
// name, open( ) asks ON_ACCEPT and calls ON_START, message( ) hands a text
// to ON_MESSAGE, close( ) calls ON_CLOSE, drain( ) returns what the handler
// SENT through its message manager since the last call. The Node hosts
// drive the same class (web/preview-backend.mjs), so the handler meets the
// same framework on every host and on a system.
//
// A program compiled by tools/gogen provides a Host per connection,
// normally a few lines over its compiled ZCL_APC_HOST (the types are the
// program's own, so the adapter lives with the program), and mounts a
// Channel at /sap/bc/apc/sap/<app>. The channel does the rest:
//
//   - a request that is not a WebSocket handshake (RFC 6455 4.2.1), or whose
//     Origin is neither this host nor one of OriginPatterns, is answered
//     426 / 400 / 405 / 403 before any ABAP runs: on a system such a request
//     never reaches the extension;
//   - one Session per socket (a stateful handler keeps its attributes);
//   - every call into ABAP is one dialog step (Step), run one at a time in
//     the process (abap.WorkProcess), inside abap.DialogStep, so a step that
//     dumps rolls its database work back and the connection stays up, as a
//     short dump in one APC step on a system ends that step and not the
//     session;
//   - ON_ACCEPT and ON_START run before the upgrade is answered, and what
//     ON_START sent is written after it. That is "open before drain"
//     (CLAUDE.md): a message delivered before the page's socket is open is
//     refused by the page, and a handler that speaks from ON_START would
//     otherwise race its own handshake. A rejected connection is answered
//     403 and never upgraded;
//   - what a step sent is written in order after the step, outside the
//     work process, so a slow client never holds the lock;
//   - a text frame is ON_MESSAGE; a binary frame is refused (close 1003),
//     since ZCL_APC_HOST takes text only; the end of the socket is ON_CLOSE
//     with the peer's close code (1005 when it sent none, 1006 when the
//     connection broke without a close frame or a write to it failed,
//     RFC 6455 7.1.5).
package apc

import (
	"encoding/base64"
	"errors"
	"log"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"

	"github.com/coder/websocket"

	"osg/gogen/abap"
)

// Host is one connection's APC runtime.
type Host interface {
	// Open is ON_ACCEPT then ON_START; false when ON_ACCEPT rejected.
	Open(s *abap.Session) bool
	// Message is ON_MESSAGE with a text message.
	Message(s *abap.Session, text string)
	// Close is ON_CLOSE.
	Close(s *abap.Session, reason string, code int32)
	// Drain is what the handler sent since the last call, in order.
	Drain(s *abap.Session) []string
}

// Channel is an http.Handler for one APC application.
type Channel struct {
	// Name is the application, for the log (zo4d_demo).
	Name string
	// New makes the connection's host: runs in a step of its own, after the
	// handshake is checked and before the upgrade; a dump answers 500 and
	// the socket is not opened.
	New func(s *abap.Session, r *http.Request) Host
	// Step runs one dialog step; nil is abap.APCStep.
	Step func(name string, work func()) error
	// OriginPatterns are the cross-origin pages allowed to connect, as
	// github.com/coder/websocket's AcceptOptions.OriginPatterns (host
	// patterns of path.Match, or scheme://host). Empty is same origin only:
	// a request with an Origin header whose host is not the request's Host
	// is refused 403. A request without Origin (not a browser) is let in.
	OriginPatterns []string
	// ReadLimit is the largest message read; 0 is 1 MB.
	ReadLimit int64
	// Logf logs; nil is log.Printf.
	Logf func(format string, args ...any)

	mu      sync.Mutex
	counter int
}

func (ch *Channel) logf(format string, args ...any) {
	if ch.Logf != nil {
		ch.Logf(format, args...)
		return
	}
	log.Printf(format, args...)
}

func (ch *Channel) step(name, text string, work func()) error {
	run := ch.Step
	if run == nil {
		run = abap.APCStep
	}
	err := run(name, work)
	if err != nil {
		ch.logf("%s: %v (%.80s)", ch.Name, err, text)
	}
	return err
}

// Connections is how many sockets this channel has opened.
func (ch *Channel) Connections() int {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	return ch.counter
}

func headerHasToken(h http.Header, name, token string) bool {
	for _, v := range h.Values(name) {
		for _, t := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(t), token) {
				return true
			}
		}
	}
	return false
}

// handshake checks what websocket.Accept checks, before any ABAP runs: the
// status to answer and why, or 0.
func handshake(r *http.Request) (int, string) {
	if !r.ProtoAtLeast(1, 1) {
		return http.StatusUpgradeRequired, "a WebSocket handshake is HTTP/1.1"
	}
	if !headerHasToken(r.Header, "Connection", "Upgrade") || !headerHasToken(r.Header, "Upgrade", "websocket") {
		return http.StatusUpgradeRequired, "this is an APC channel: a WebSocket upgrade is required"
	}
	if r.Method != http.MethodGet {
		return http.StatusMethodNotAllowed, "a WebSocket handshake is a GET"
	}
	if r.Header.Get("Sec-WebSocket-Version") != "13" {
		return http.StatusBadRequest, "Sec-WebSocket-Version 13 is required"
	}
	keys := r.Header.Values("Sec-WebSocket-Key")
	if len(keys) != 1 {
		return http.StatusBadRequest, "one Sec-WebSocket-Key is required"
	}
	if v, err := base64.StdEncoding.DecodeString(strings.TrimSpace(keys[0])); err != nil || len(v) != 16 {
		return http.StatusBadRequest, "Sec-WebSocket-Key is not 16 bytes of base64"
	}
	return 0, ""
}

// originAllowed is websocket.Accept's origin rule, so a refusal happens
// before any ABAP runs rather than after ON_START.
func originAllowed(r *http.Request, patterns []string) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	if strings.EqualFold(r.Host, u.Host) {
		return true
	}
	for _, p := range patterns {
		target := u.Host
		if strings.Contains(p, "://") {
			target = u.Scheme + "://" + u.Host
		}
		if ok, err := path.Match(strings.ToLower(p), strings.ToLower(target)); err == nil && ok {
			return true
		}
	}
	return false
}

func (ch *Channel) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if status, why := handshake(r); status != 0 {
		if status == http.StatusUpgradeRequired {
			w.Header().Set("Connection", "Upgrade")
			w.Header().Set("Upgrade", "websocket")
		}
		if status == http.StatusBadRequest {
			w.Header().Set("Sec-WebSocket-Version", "13")
		}
		http.Error(w, why, status)
		return
	}
	if !originAllowed(r, ch.OriginPatterns) {
		http.Error(w, "origin not allowed for this APC channel", http.StatusForbidden)
		return
	}
	s := &abap.Session{}
	var host Host
	if err := ch.step("CONSTRUCTOR", "", func() { host = ch.New(s, r) }); err != nil || host == nil {
		http.Error(w, "APC handler could not be created", http.StatusInternalServerError)
		return
	}
	var accepted bool
	var out []string
	if err := ch.step("ON_START", "", func() { accepted = host.Open(s); out = host.Drain(s) }); err != nil {
		http.Error(w, "APC handler dumped in ON_START", http.StatusInternalServerError)
		return
	}
	if !accepted {
		http.Error(w, "APC connection rejected by the handler", http.StatusForbidden)
		return
	}
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: ch.OriginPatterns})
	if err != nil {
		// checked above, so this is the hijack failing: the handler was
		// started for a socket that never opened, and it ends
		ch.step("ON_CLOSE", "", func() { host.Close(s, "upgrade failed", 1006) })
		return
	}
	ch.mu.Lock()
	ch.counter++
	ch.mu.Unlock()
	limit := ch.ReadLimit
	if limit == 0 {
		limit = 1 << 20
	}
	c.SetReadLimit(limit)
	defer c.CloseNow()
	ctx := r.Context()
	// open before drain: the upgrade is answered, then what ON_START sent
	write := func(msgs []string) bool {
		for _, m := range msgs {
			if c.Write(ctx, websocket.MessageText, []byte(m)) != nil {
				return false
			}
		}
		return true
	}
	reason, code := "", int32(1005)
	alive := write(out)
	for alive {
		typ, data, err := c.Read(ctx)
		if err != nil {
			var ce websocket.CloseError
			if errors.As(err, &ce) {
				reason, code = ce.Reason, int32(ce.Code)
				if code == -1 {
					code = 1005
				}
			} else {
				reason, code = err.Error(), 1006
			}
			break
		}
		if typ != websocket.MessageText {
			c.Close(websocket.StatusUnsupportedData, "binary messages are not supported by this host")
			reason, code = "binary message", int32(websocket.StatusUnsupportedData)
			break
		}
		text := string(data)
		out = nil
		if ch.step("ON_MESSAGE", text, func() { host.Message(s, text); out = host.Drain(s) }) != nil {
			// what a step that dumped had sent goes nowhere (not measured on
			// a system): it is taken off the manager so that the next step
			// does not send it as its own
			ch.step("DRAIN", "", func() { host.Drain(s) })
		}
		alive = write(out)
	}
	if !alive {
		// the connection broke under a write: no close frame was seen
		reason, code = "write failed", 1006
	}
	ch.step("ON_CLOSE", "", func() { host.Close(s, reason, code) })
}
