// The ZO4D demo channel served by the compiled ABAP (tools/gogen), and every
// other request proxied to an OSG server, so the page, the audio and the
// images are that server's and only the frames come from here.
//
//	go run ./cmd/o4dserve -listen :3092 -upstream http://127.0.0.1:3091
//
// What the host does is what the APC framework does around
// ZCL_O4D_APC_HANDLER: a new handler per socket, ON_START, the text of each
// message to the handler, ON_CLOSE. The three lines of ON_MESSAGE are here
// because a RETURN inside its TRY is not compiled yet: a JSON message goes
// to HANDLE_JSON_CMD, a word to its CASE.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"osg/gogen/abap"
)

// One dialog step at a time: the demo's registry is class data, which a
// system keeps per session and this process keeps once (backlog: statics
// per session). The lock makes it one work process, like one Node thread.
var workProcess sync.Mutex

type message struct{ text string }

func (m *message) IF_APC_WSP_MESSAGE__GET_MESSAGE_TYPE(s *abap.Session) int32 { return 1 }
func (m *message) IF_APC_WSP_MESSAGE__GET_BINARY(s *abap.Session) string      { return m.text }
func (m *message) IF_APC_WSP_MESSAGE__SET_BINARY(s *abap.Session, v string)   { m.text = v }
func (m *message) IF_APC_WSP_MESSAGE__GET_TEXT(s *abap.Session) string        { return m.text }
func (m *message) IF_APC_WSP_MESSAGE__SET_TEXT(s *abap.Session, v string)     { m.text = v }

type manager struct{ out chan string }

func (mm *manager) IF_APC_WSP_MESSAGE_MANAGER__CREATE_MESSAGE(s *abap.Session) IF_APC_WSP_MESSAGE {
	return &message{}
}
func (mm *manager) IF_APC_WSP_MESSAGE_MANAGER__SEND(s *abap.Session, m IF_APC_WSP_MESSAGE) {
	mm.out <- m.IF_APC_WSP_MESSAGE__GET_TEXT(s)
}
func (mm *manager) IF_APC_WSP_MESSAGE_MANAGER__SET_SEND_MODE(s *abap.Session, mode int32) {}

type context_ struct{ id string }

func (c *context_) IF_APC_WSP_SERVER_CONTEXT__GET_INITIAL_REQUEST(s *abap.Session) IF_APC_WSP_INITIAL_REQUEST {
	return nil
}
func (c *context_) IF_APC_WSP_SERVER_CONTEXT__GET_BINDING_MANAGER(s *abap.Session) IF_APC_WSP_BINDING_MANAGER {
	return nil
}
func (c *context_) IF_APC_WSP_SERVER_CONTEXT__GET_CONNECTION_ID(s *abap.Session) string { return c.id }
func (c *context_) IF_APC_WSP_SERVER_CONTEXT__GET_CONNECTION_ATTACH_HANDLE(s *abap.Session, sec int32) string {
	return ""
}
func (c *context_) IF_APC_WSP_SERVER_CONTEXT_BASE__GET_INITIAL_REQUEST(s *abap.Session) IF_APC_WSP_INITIAL_REQUEST {
	return nil
}
func (c *context_) IF_APC_WSP_SERVER_CONTEXT_BASE__GET_BINDING_MANAGER(s *abap.Session) IF_APC_WSP_BINDING_MANAGER {
	return nil
}
func (c *context_) IF_APC_WSP_SERVER_CONTEXT_BASE__GET_CONNECTION_ID(s *abap.Session) string {
	return c.id
}

// step runs one dialog step and turns a dump into a log line, as a system
// ends the step with a short dump instead of taking the server down
func step(name string, f func()) {
	workProcess.Lock()
	defer workProcess.Unlock()
	defer func() {
		if r := recover(); r != nil {
			log.Printf("dump in %s: %v", name, r)
		}
	}()
	f()
}

var connections int

func channel(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	c.SetReadLimit(1 << 20)
	defer c.CloseNow()
	ctx := r.Context()
	mm := &manager{out: make(chan string, 1024)}
	done := make(chan struct{})
	go func() { // the sender: ABAP sends inside a step, the socket writes outside it
		defer close(done)
		for text := range mm.out {
			if c.Write(ctx, websocket.MessageText, []byte(text)) != nil {
				return
			}
		}
	}()
	s := &abap.Session{}
	h := New_ZCL_O4D_APC_HANDLER(s)
	connections++
	cx := &context_{id: fmt.Sprint(connections)}
	step("ON_START", func() { h.IF_APC_WSP_EXTENSION__ON_START(s, cx, mm) })
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			break
		}
		text := string(data)
		t0 := time.Now()
		step("ON_MESSAGE", func() { onMessage(h, s, mm, text) })
		if d := time.Since(t0); d > 200*time.Millisecond {
			log.Printf("slow step %v: %.80s", d, text)
		}
	}
	step("ON_CLOSE", func() { h.IF_APC_WSP_EXTENSION__ON_CLOSE(s, "", 1000, cx) })
	close(mm.out)
	<-done
}

// ON_MESSAGE of ZCL_O4D_APC_HANDLER, line for line
func onMessage(h *ZCL_O4D_APC_HANDLER, s *abap.Session, mm *manager, cmd string) {
	if strings.HasPrefix(cmd, "{") {
		h.HANDLE_JSON_CMD(s, mm, cmd)
		return
	}
	switch cmd {
	case "start":
		h.mv_running = "X"
	case "stop":
		h.mv_running = ""
	case "frame":
		if h.mv_running == "X" {
			gt := abap.DivF(float64(h.mv_frame_num), float64(h.mo_demo.GET_FPS(s)))
			h.SEND_FRAME(s, mm, gt)
			h.mv_frame_num = abap.AddI(h.mv_frame_num, 1)
		}
	case "reset":
		h.mv_frame_num, h.mv_last_effect, h.mv_effect_start_bar = 0, "", 0
	case "scenario":
		h.SEND_SCENARIO(s, mm)
	}
}

func main() {
	listen := flag.String("listen", ":3092", "address to serve")
	upstream := flag.String("upstream", "http://127.0.0.1:3091", "OSG server for everything but the demo channel")
	flag.Parse()
	u, err := url.Parse(*upstream)
	if err != nil {
		log.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(u)
	http.HandleFunc("/sap/bc/apc/sap/zo4d_demo", channel)
	http.HandleFunc("/sap/bc/apc/sap/zo4d_demo/", channel)
	http.Handle("/", proxy)
	log.Printf("ZO4D frames from Go on %s, the rest from %s", *listen, *upstream)
	_ = context.Background
	log.Fatal(http.ListenAndServe(*listen, nil))
}
