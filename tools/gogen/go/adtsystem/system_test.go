package adtsystem

import (
	"osg/gogen/adtenq"
	"osg/gogen/enq"
	"osg/gogen/objstore"
	"strings"
	"testing"
)

type sessions struct {
	id              string
	stateful, alive bool
	handles         map[string][2]string
	looked          []string
}

func (s *sessions) View() (string, bool) { return s.id, s.stateful }
func (s *sessions) Alive(id string) bool { s.looked = append(s.looked, id); return s.alive }
func (s *sessions) Adopt(id, typ, name string) string {
	for h, o := range s.handles {
		if o == [2]string{typ, name} {
			return h
		}
	}
	s.handles[strings.Repeat("a", 40)] = [2]string{typ, name}
	return strings.Repeat("a", 40)
}
func (s *sessions) Forget(id, h string) (string, string) {
	o := s.handles[h]
	delete(s.handles, h)
	return o[0], o[1]
}

type holder struct {
	key   string
	found bool
}

func (h holder) Holder(string, string) (string, bool) { return h.key, h.found }
func call(p objstore.SystemProvider, k, n string) objstore.Answer {
	cmd := "SYSTEM"
	return objstore.CallWithSystem(map[string]*string{"IV_COMMAND": &cmd, "IV_TYPE": &k, "IV_NAME": &n}, p)
}
func TestKinds(t *testing.T) {
	s := &sessions{id: "id", stateful: true, alive: true, handles: map[string][2]string{}}
	p := Provider{Sessions: s, Holders: holder{"key", true}}
	check := func(k, n, want string) {
		t.Helper()
		a := call(p, k, n)
		if a.Scalars["EV_JSON"] != want || a.Scalars["EV_ERROR"] != "" || a.Scalars["EV_COUNT"] != "0" {
			t.Fatalf("%s: %+v", k, a)
		}
	}
	check("SESSION", "", `{"stateful":true}`)
	s.stateful = false
	check("SESSION", "", `{"stateful":false}`)
	check("LOCK_HANDLE", "CLAS Z WITH SPACE", `{"handle":"`+strings.Repeat("a", 40)+`"}`)
	check("LOCK_HANDLE", "CLAS Z WITH SPACE", `{"handle":"`+strings.Repeat("a", 40)+`"}`)
	if len(s.handles) != 1 {
		t.Fatal("duplicate handle")
	}
	check("LOCK_RELEASE", strings.Repeat("a", 40), `{"type":"CLAS","name":"Z WITH SPACE"}`)
	check("LOCK_RELEASE", strings.Repeat("a", 40), `{}`)
	check("LOCK_HOLDER", "CLAS Z", `{"alive":true}`)
	if s.looked[len(s.looked)-1] != "key" {
		t.Fatal("holder did not check ENQ key")
	}
	s.alive = false
	check("LOCK_HOLDER", "CLAS Z", `{"alive":false}`)
	a := call(p, "LOCK_HANDLE", "CLAS Z")
	if a.Scalars["EV_ERROR"] != "ADT session ended" {
		t.Fatal(a)
	}
	p.Holders = holder{}
	check("LOCK_HOLDER", "CLAS Z", `{"alive":false}`)
	s.id = ""
	for _, k := range []string{"SESSION", "LOCK_HANDLE", "LOCK_RELEASE", "BUILD"} {
		if a := call(p, k, ""); a.Scalars["EV_ERROR"] != "SYSTEM "+k+" has no answer here" {
			t.Fatal(a)
		}
	}
}
func TestBindingsKeepParkedStep(t *testing.T) {
	var b Bindings
	one, two := new(int), new(int)
	clear := b.Bind(one, Provider{Sessions: &sessions{id: "one", stateful: true}, Holders: holder{}})
	defer clear()
	done := make(chan struct{})
	go func() {
		defer close(done)
		clear := b.Bind(two, Provider{Sessions: &sessions{id: "two"}, Holders: holder{}})
		defer clear()
		if call(b.For(two), "SESSION", "").Scalars["EV_JSON"] != `{"stateful":false}` {
			t.Error("wrong second step")
		}
	}()
	<-done
	if b.For(two) != nil || call(b.For(one), "SESSION", "").Scalars["EV_JSON"] != `{"stateful":true}` {
		t.Fatal("parked binding swapped")
	}
	clear()
	if b.For(one) != nil {
		t.Fatal("binding retained")
	}
}
func TestHolderUsesServerAndKernel(t *testing.T) {
	srv := enq.New("test")
	defer srv.Close()
	k := adtenq.New(srv)
	h := ENQHolders{Server: srv, Kernel: k, Client: "123"}
	if _, found := h.Holder("CLAS", "Z"); found {
		t.Fatal("phantom holder")
	}
	k.Bind("id", "USER")
	sid, _ := k.Handle("id")
	req := enq.Request{Client: "123", Table: "ZOSD_ADT_LOCK", Mode: "X", Scope: 1, Fields: []enq.Field{{Value: "CLAS", Length: 4}, {Value: "Z", Length: 40}}}
	if srv.Enqueue(sid, req, false).Subrc != 0 {
		t.Fatal("enqueue")
	}
	if key, found := h.Holder("clas", "z"); !found || key != k.Owner().Key("id") {
		t.Fatal(key, found)
	}
	if _, found := h.Holder("CLAS", "OTHER"); found {
		t.Fatal("wrong object")
	}
	k.End("id")
	sid = srv.Open("FOREIGN")
	srv.Enqueue(sid, req, false)
	if key, found := h.Holder("CLAS", "Z"); !found || key != "foreign-holder" {
		t.Fatal(key, found)
	}
	srv.DequeueAll(sid)
	req.Fields[1].Generic = true
	srv.Enqueue(sid, req, false)
	if _, found := h.Holder("CLAS", "OTHER"); !found {
		t.Fatal("generic holder missed")
	}
}
