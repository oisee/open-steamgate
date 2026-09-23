package abap

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/coder/websocket"
)

// APC, the ABAP Push Channel, for a Go host: the socket part of what the
// ICF does around an IF_APC_WSP_EXTENSION handler.
//
// The ABAP part stays ABAP. open-abap-apc's ZCL_APC_HOST holds one
// connection to one handler: its constructor creates the handler class by
// name, open( ) asks ON_ACCEPT and calls ON_START, message( ) hands a text
// to ON_MESSAGE, close( ) calls ON_CLOSE, drain( ) returns what the handler
// SENT through its message manager since the last call. The Node hosts
// drive the same class (web/preview-backend.mjs), so the handler meets the
// same framework on every host and on a system.
//
// A program compiled by tools/gogen provides an APCHost per connection,
// normally a few lines over its compiled ZCL_APC_HOST (the types are the
// program's own, so the adapter lives with the program), and mounts an
// APCChannel at /sap/bc/apc/sap/<app>. The channel does the rest:
//
//   - one Session per socket (a stateful handler keeps its attributes);
//   - every call into ABAP is one dialog step (Step), run one at a time in
//     the process (WorkProcess), inside DialogStep, so a step that dumps
//     rolls its database work back and the connection stays up, as a short
//     dump in one APC step on a system ends that step and not the session;
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
//     connection broke without a close frame, RFC 6455 7.1.5).

// APCHost is one connection's APC runtime.
type APCHost interface {
	// Open is ON_ACCEPT then ON_START; false when ON_ACCEPT rejected.
	Open(s *Session) bool
	// Message is ON_MESSAGE with a text message.
	Message(s *Session, text string)
	// Close is ON_CLOSE.
	Close(s *Session, reason string, code int32)
	// Drain is what the handler sent since the last call, in order.
	Drain(s *Session) []string
}

// WorkProcess is the process's one work process: class data and the
// database transaction of a step (luw.go) are per process, so every host
// that runs ABAP holds it for the length of a step. The default Step of a
// channel takes it; an HTTP host of the same process should take it too.
var WorkProcess sync.Mutex

// ErrDump is what a step that dumped returns, wrapping the dump.
type ErrDump struct {
	Step string
	Dump any
}

func (e *ErrDump) Error() string { return fmt.Sprintf("dump in %s: %v", e.Step, e.Dump) }

// APCStep is the default dialog step of a channel: the work process held,
// a database LUW of its own, a dump returned rather than raised.
func APCStep(name string, work func()) (err error) {
	WorkProcess.Lock()
	defer WorkProcess.Unlock()
	defer func() {
		if r := recover(); r != nil {
			err = &ErrDump{Step: name, Dump: r}
		}
	}()
	DialogStep(work)
	return nil
}

// APCChannel is an http.Handler for one APC application.
type APCChannel struct {
	// Name is the application, for the log (zo4d_demo).
	Name string
	// New makes the connection's host: runs in a step of its own, before
	// the upgrade; an error answers 500 (a dump) and the socket is not opened.
	New func(s *Session, r *http.Request) APCHost
	// Step runs one dialog step; nil is APCStep.
	Step func(name string, work func()) error
	// ReadLimit is the largest message read; 0 is 1 MB.
	ReadLimit int64
	// Logf logs; nil is log.Printf.
	Logf func(format string, args ...any)

	mu      sync.Mutex
	counter int
}

func (ch *APCChannel) logf(format string, args ...any) {
	if ch.Logf != nil {
		ch.Logf(format, args...)
		return
	}
	log.Printf(format, args...)
}

func (ch *APCChannel) step(name, text string, work func()) error {
	run := ch.Step
	if run == nil {
		run = APCStep
	}
	err := run(name, work)
	if err != nil {
		ch.logf("%s: %v (%.80s)", ch.Name, err, text)
	}
	return err
}

// Connections is how many sockets this channel has opened.
func (ch *APCChannel) Connections() int {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	return ch.counter
}

func (ch *APCChannel) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s := &Session{}
	var host APCHost
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
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		// the handler was started for a socket that never opened: it ends
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
	alive := write(out)
	reason, code := "", int32(1005)
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
	ch.step("ON_CLOSE", "", func() { host.Close(s, reason, code) })
}
