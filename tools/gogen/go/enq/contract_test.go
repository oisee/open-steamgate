package enq

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

// The gate of E1: every case of the measured contract (ENQ E0,
// test/fixtures/enq/contract.json) gives what the system gave.
//
// What the system does asynchronously is the harness's to model, not the
// lock server's: the update task that releases the update owner's locks
// after a COMMIT WORK, and the teardown of a closed RFC session. Both are
// queued and happen at the next WAIT UP TO, which is when the measurement
// saw them done. Time is a fake clock, so _WAIT runs in no real time.

type contract struct {
	LockObject struct {
		Name, Table string
		Args        []struct {
			Name   string
			Length int
		}
	} `json:"lockObject"`
	Cases []struct {
		ID    string `json:"id"`
		Title string `json:"title"`
		Steps []struct {
			Owner  string            `json:"owner"`
			Call   string            `json:"call"`
			Params map[string]string `json:"params"`
			Expect map[string]any    `json:"expect"`
		} `json:"steps"`
	} `json:"cases"`
}

const client = "001"

type event struct {
	at time.Duration
	do func()
}

type harness struct {
	t        *testing.T
	srv      *Server
	c        *contract
	owners   map[string]int64
	updated  map[string]bool
	pending  []func()
	timed    []event
	now      time.Duration
	previous map[string]string // the update owner before the last COMMIT
}

func (h *harness) session(name string) int64 {
	if id, ok := h.owners[name]; ok {
		return id
	}
	id := h.srv.Open("<USER>")
	h.owners[name] = id
	return id
}

func (h *harness) advance(d time.Duration) {
	h.now += d
	sort.SliceStable(h.timed, func(i, j int) bool { return h.timed[i].at < h.timed[j].at })
	for len(h.timed) > 0 && h.timed[0].at <= h.now {
		e := h.timed[0]
		h.timed = h.timed[1:]
		e.do()
	}
}

func (h *harness) request(p map[string]string) Request {
	r := Request{Client: client, Table: h.c.LockObject.Table, Object: h.c.LockObject.Name, Mode: p["MODE_ZOSD_PRB"]}
	if r.Mode == "" {
		r.Mode = "E"
	}
	for _, a := range h.c.LockObject.Args {
		if a.Name == "MANDT" {
			continue
		}
		v, ok := p[a.Name]
		if !ok && a.Name == "K2" {
			v = "K" // the fixture's notation for a K2 the case text leaves out
		}
		generic := strings.TrimSpace(v) == "" && p["X_"+a.Name] != "X"
		r.Fields = append(r.Fields, Field{Value: v, Generic: generic, Length: a.Length})
	}
	fmt.Sscan(p["_SCOPE"], &r.Scope)
	return r
}

func number(v any) int {
	f, _ := v.(float64)
	return int(f)
}

func (h *harness) step(owner, call string, p map[string]string, expect map[string]any) string {
	sid := h.session(owner)
	switch {
	case strings.HasPrefix(call, "ENQUEUE_") && call != "ENQUEUE_READ":
		if len(p) == 0 {
			p = map[string]string{"K1": "NEWOWNER"}
		}
		start := h.now
		res := h.srv.enqueueWith(sid, h.request(p), p["_WAIT"] == "X", h.advance)
		if want, ok := expect["newUpdateOwner"]; ok {
			got := h.srv.UpdateOwner(sid) != h.previous[owner]
			if got != want.(bool) {
				return fmt.Sprintf("newUpdateOwner %v", got)
			}
		}
		if v, ok := expect["subrc"]; ok && number(v) != res.Subrc {
			return fmt.Sprintf("subrc %d, msgno %s", res.Subrc, res.Msgno)
		}
		if v, ok := expect["sy-msgno"]; ok && v != res.Msgno {
			return "msgno " + res.Msgno
		}
		if v, ok := expect["sy-msgv1"]; ok && v != res.Holder {
			return "holder " + res.Holder
		}
		if e, ok := expect["elapsedMs"].(map[string]any); ok {
			approx, has := e["approx"]
			if !has {
				approx = e["measured"]
			}
			if d := h.now - start - time.Duration(number(approx))*time.Millisecond; d > 500*time.Millisecond || d < -500*time.Millisecond {
				return fmt.Sprintf("elapsed %v", h.now-start)
			}
		}
	case strings.HasPrefix(call, "DEQUEUE_ALL"):
		h.srv.DequeueAll(sid)
	case strings.HasPrefix(call, "DEQUEUE_"):
		h.srv.Dequeue(sid, h.request(p))
	case call == "ENQUEUE_READ":
		return h.read(p, expect)
	case strings.HasPrefix(call, "CALL FUNCTION") && strings.Contains(call, "IN UPDATE TASK"):
		h.updated[owner] = true
	case call == "COMMIT WORK" || call == "COMMIT WORK AND WAIT":
		h.previous[owner] = h.srv.UpdateOwner(sid)
		ended := h.srv.Commit(sid, h.updated[owner])
		h.updated[owner] = false
		if call == "COMMIT WORK AND WAIT" {
			h.srv.UpdateDone(sid, ended)
		} else {
			h.pending = append(h.pending, func() { h.srv.UpdateDone(sid, ended) })
		}
	case call == "ROLLBACK WORK":
		h.previous[owner] = h.srv.UpdateOwner(sid)
		h.updated[owner] = false
		h.srv.Rollback(sid)
	case strings.HasPrefix(call, "WAIT UP TO"):
		var n int
		fmt.Sscanf(strings.TrimPrefix(call, "WAIT UP TO "), "%d", &n)
		for _, f := range h.pending {
			f()
		}
		h.pending = nil
		h.advance(time.Duration(n) * time.Second)
	case strings.HasPrefix(call, "RFC_CONNECTION_CLOSE"):
		ended := h.session("O2")
		h.pending = append(h.pending, func() { h.srv.End(ended) })
	case call == "job ends":
		// the case reads about five seconds after the job's last statement
		h.srv.End(sid)
	case strings.HasPrefix(call, "holds "):
		var n int
		fmt.Sscanf(strings.TrimPrefix(call, "holds "), "%d", &n)
		h.timed = append(h.timed, event{at: h.now + time.Duration(n)*time.Second, do: func() { h.srv.End(sid) }})
	case strings.HasPrefix(call, "return from the RFC call"):
		// a stateful connection: the session goes on
	default:
		return "unknown call " + call
	}
	return ""
}

func (h *harness) read(p map[string]string, expect map[string]any) string {
	rows := h.srv.Read(Filter{Client: client, Table: p["GNAME"]})
	if n, ok := expect["NUMBER"]; ok && number(n) != len(rows) {
		return fmt.Sprintf("NUMBER %d: %s", len(rows), show(rows))
	}
	want, _ := expect["rows"].([]any)
	used := make([]bool, len(rows))
	for _, w := range want {
		m := w.(map[string]any)
		found := false
		for i, r := range rows {
			if !used[i] && h.matches(r, m) {
				used[i], found = true, true
				break
			}
		}
		if !found {
			return fmt.Sprintf("no row %v in %s", m, show(rows))
		}
	}
	return ""
}

func (h *harness) matches(r Row, m map[string]any) bool {
	arg := strings.TrimRight(strings.ReplaceAll(m["GARG"].(string), "{MANDT}", client), " ")
	if r.Arg != arg || r.Mode != m["GMODE"] || r.Dialogs != number(m["GUSE"]) || r.Updates != number(m["GUSEVB"]) {
		return false
	}
	owned := func(id string, who any) bool {
		if who == nil {
			return id == ""
		}
		return id != "" && h.owners[who.(string)] == r.Session
	}
	return owned(r.Dialog, m["GUSR"]) && owned(r.Update, m["GUSRVB"])
}

func show(rows []Row) string {
	var b strings.Builder
	for _, r := range rows {
		fmt.Fprintf(&b, "[%q %s use=%d/%d s=%d] ", r.Arg, r.Mode, r.Dialogs, r.Updates, r.Session)
	}
	return b.String()
}

func TestContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "test", "fixtures", "enq", "contract.json"))
	if err != nil {
		t.Fatal(err)
	}
	var c contract
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	if len(c.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, tc := range c.Cases {
		t.Run(tc.ID, func(t *testing.T) {
			srv := New("osdhost_OSD_00")
			defer srv.Close()
			h := &harness{t: t, srv: srv, c: &c, owners: map[string]int64{}, updated: map[string]bool{}, previous: map[string]string{}}
			for i, st := range tc.Steps {
				if msg := h.step(st.Owner, st.Call, st.Params, st.Expect); msg != "" {
					t.Fatalf("%s: step %d %s %s %v: %s", tc.Title, i+1, st.Owner, st.Call, st.Params, msg)
				}
			}
		})
	}
}
