package adtenq

import (
	"fmt"
	"osg/gogen/enq"
	"regexp"
	"sync"
	"testing"
)

func fixture(t *testing.T) (*Kernel, *enq.Server) {
	t.Helper()
	srv := enq.New("test")
	t.Cleanup(srv.Close)
	return New(srv), srv
}
func bind(t *testing.T, k *Kernel, id, user string) int64 {
	t.Helper()
	if bound, err := k.Bind(id, user); !bound || err != nil {
		t.Fatalf("Bind: %v, %v", bound, err)
	}
	sid, ok := k.Handle(id)
	if !ok || sid == 0 {
		t.Fatal("bound context has no handle")
	}
	return sid
}
func lock(t *testing.T, srv *enq.Server, sid int64, scope int) {
	t.Helper()
	r := enq.Request{Client: "001", Table: "T", Mode: "E", Scope: scope, Fields: []enq.Field{{Value: fmt.Sprint(scope), Length: 10}}}
	if res := srv.Enqueue(sid, r, false); res.Subrc != 0 {
		t.Fatalf("Enqueue: %+v", res)
	}
}

// adt-enq-key.mjs / adt-abap-session.mjs: ownership is a host prefix,
// not a ledger of issued ids. Foreign holder keys remain opaque.
func TestOwnerKeys(t *testing.T) {
	a, b := NewOwner(), NewOwner()
	if !regexp.MustCompile(`^adt:[a-f0-9]{12}:$`).MatchString(a.Prefix()) || a.Prefix() == b.Prefix() {
		t.Fatal("invalid or reused prefix")
	}
	for _, id := range []string{"", "0123456789abcdef01234567", " leading ", b.Key("foreign")} {
		key := a.Key(id)
		if key != a.Prefix()+id || a.Key(key) != key || a.IDOf(key) != id || !a.Owns(key) {
			t.Fatalf("key round trip: %q", id)
		}
	}
	if a.Owns("bare") || a.Owns(b.Key("foreign")) || a.IDOf(b.Key("foreign")) != b.Key("foreign") {
		t.Fatal("foreign ownership")
	}
	if (Owner{}).Owns("anything") {
		t.Fatal("zero owner owns keys")
	}
}
func TestProcessOwner(t *testing.T) {
	a, srv := fixture(t)
	b := New(srv)
	if a.Owner().Prefix() != b.Owner().Prefix() || a.Owner().Prefix() != processOwner.Prefix() {
		t.Fatal("kernels disagree on process identity")
	}
}

// Node bind pins a context before its first lock; rebinding keeps its first
// user. COMMIT and ROLLBACK affect LUWs, not the ADT context.
func TestBindReusesContext(t *testing.T) {
	k, srv := fixture(t)
	if k.ContextAlive("id") {
		t.Fatal("unbound context alive")
	}
	sid := bind(t, k, "id", " FIRST \t")
	if !k.ContextAlive("id") || bind(t, k, k.Owner().Key("id"), "SECOND") != sid {
		t.Fatal("bind replaced context")
	}
	lock(t, srv, sid, 1)
	lock(t, srv, sid, 2)
	rows := srv.Read(enq.Filter{})
	if len(rows) != 2 || rows[0].User != " FIRST" || rows[1].User != " FIRST" {
		t.Fatalf("lost first user: %+v", rows)
	}
	srv.Commit(sid, false)
	if len(srv.Read(enq.Filter{})) != 2 {
		t.Fatal("empty commit released locks")
	}
	srv.Rollback(sid)
	if len(srv.Read(enq.Filter{})) != 1 || !k.ContextAlive("id") {
		t.Fatal("rollback ended dialog context")
	}
	k.End("id")
	if len(srv.Read(enq.Filter{})) != 0 {
		t.Fatal("logoff left dialog lock")
	}
}

// osd-enq-abap.mjs: logoff releases locks; queued/parked work cannot reopen
// its key or lock under an old handle. Only EnqSessionEnded maps to false.
func TestEndRefusesBind(t *testing.T) {
	k, srv := fixture(t)
	sid := bind(t, k, "id", "USER")
	lock(t, srv, sid, 3)
	k.End(k.Owner().Key("id") + "  ")
	k.End("id")
	if len(srv.Read(enq.Filter{})) != 0 || k.ContextAlive("id") {
		t.Fatal("end retained context or locks")
	}
	if _, ok := k.Handle("id"); ok {
		t.Fatal("ended handle remains")
	}
	if bound, err := k.Bind("id", "USER"); bound || err != nil {
		t.Fatalf("ended bind: %v, %v", bound, err)
	}
	if srv.Enqueue(sid, enq.Request{Table: "T", Mode: "E", Scope: 1}, false).Subrc != 2 {
		t.Fatal("parked request took a lock")
	}
	srv.DequeueAll(sid)
	srv.Commit(sid, true)
	srv.Rollback(sid)
	if len(srv.Read(enq.Filter{})) != 0 {
		t.Fatal("ended cleanup recreated locks")
	}
}
func TestEndBeforeBind(t *testing.T) {
	k, _ := fixture(t)
	k.End("never-bound")
	if bound, err := k.Bind("never-bound", "U"); bound || err != nil {
		t.Fatalf("unbound end forgotten: %v, %v", bound, err)
	}
	k.Revive("never-bound")
	bind(t, k, "never-bound", "U")
}

// adt-abap-session.mjs rolled-back logoff: revive permits rebind without
// restoring the session's former locks. ABAP keeps its own row and token.
func TestRevive(t *testing.T) {
	k, srv := fixture(t)
	sid := bind(t, k, "id", "OLD")
	lock(t, srv, sid, 1)
	k.Revive("id")
	if bind(t, k, "id", "IGNORED") != sid {
		t.Fatal("live revive replaced context")
	}
	k.End("id")
	k.Revive(k.Owner().Key("id") + " \n")
	k.Revive("id")
	if k.ContextAlive("id") {
		t.Fatal("revive opened context")
	}
	next := bind(t, k, "id", "NEW")
	if next == sid || len(srv.Read(enq.Filter{})) != 0 {
		t.Fatal("revive resurrected old context/locks")
	}
	lock(t, srv, next, 1)
	if rows := srv.Read(enq.Filter{}); len(rows) != 1 || rows[0].User != "NEW" {
		t.Fatal("new context retained old user")
	}
}

// osd-enq-abap.mjs dump case: cleanup is observable without calling ABAP,
// and next bind starts a fresh context without Revive.
func TestDropContext(t *testing.T) {
	k, srv := fixture(t)
	sid := bind(t, k, "id", "U")
	lock(t, srv, sid, 1)
	k.DropContext("id")
	k.DropContext("missing")
	if k.ContextAlive("id") || len(srv.Read(enq.Filter{})) != 0 {
		t.Fatal("dump left context/locks")
	}
	if bind(t, k, "id", "U") == sid {
		t.Fatal("dump reused old handle")
	}
}

// Node retires a dumped handle from its key immediately. A pinned step keeps
// that old ENQ context only until it exits; the key meanwhile gets a new one.
func TestDropContextWhilePinned(t *testing.T) {
	k, srv := fixture(t)
	sid := bind(t, k, "id", "OLD")
	pinned, bound, err := k.Pin("id", "OLD")
	if !bound || err != nil || pinned != sid {
		t.Fatalf("Pin: %d, %v, %v", pinned, bound, err)
	}
	lock(t, srv, sid, 1)
	k.DropContext("id")
	if k.ContextAlive("id") {
		t.Fatal("dumped key remained alive")
	}
	if len(srv.Read(enq.Filter{})) != 1 {
		t.Fatal("dump released a pinned context too early")
	}
	next := bind(t, k, "id", "NEW")
	if next == sid {
		t.Fatal("bind after dump reused retired context")
	}
	lock(t, srv, next, 2)
	k.Unpin(sid)
	rows := srv.Read(enq.Filter{})
	if len(rows) != 1 || rows[0].Session != next || rows[0].User != "NEW" {
		t.Fatalf("retirement released replacement: %+v", rows)
	}
	if len(k.pins) != 0 || len(k.retired) != 0 {
		t.Fatal("retired pin state leaked")
	}
}
func TestKernelTextAndOwnership(t *testing.T) {
	k, _ := fixture(t)
	id := " leading"
	key := k.Owner().Key(id)
	bind(t, k, id+"\t\n\u00a0\ufeff", "U")
	if !k.ContextAlive(key+" ") || !k.Owns(key+" ") || k.SessionID(key+" ") != id {
		t.Fatal("trailing whitespace not trimmed")
	}
	if k.ContextAlive("leading") || k.Owns(id) {
		t.Fatal("trimmed leading space or owns bare id")
	}
	foreign := NewOwner().Key("foreign")
	if k.Owns(foreign) || k.SessionID(foreign+" ") != foreign || k.ContextAlive(foreign) {
		t.Fatal("foreign key converted or alive")
	}
	bind(t, k, "NEL\u0085", "U")
	if k.ContextAlive("NEL") {
		t.Fatal("trimmed non-ECMAScript U+0085")
	}
	k.End(key)
	if k.ContextAlive(id) {
		t.Fatal("qualified end missed bare bind")
	}
}
func TestBindFailures(t *testing.T) {
	k, srv := fixture(t)
	srv.Close()
	if bound, err := k.Bind("id", "U"); bound || err == nil || k.ContextAlive("id") {
		t.Fatalf("server failure swallowed: %v, %v", bound, err)
	}
	k.End("ended")
	if bound, err := k.Bind("ended", "U"); bound || err != nil {
		t.Fatalf("ended lost precedence: %v, %v", bound, err)
	}
	if bound, err := New(nil).Bind("id", "U"); bound || err == nil {
		t.Fatalf("missing server: %v, %v", bound, err)
	}
}
func TestEndedRetention(t *testing.T) {
	k, _ := fixture(t)
	k.End("oldest")
	k.End("refreshed")
	for i := 0; i < endedKeep-2; i++ {
		k.End(fmt.Sprint(i))
	}
	k.End("oldest")
	k.End("newest") // refresh then evict refreshed
	bind(t, k, "refreshed", "U")
	if bound, err := k.Bind("oldest", "U"); bound || err != nil {
		t.Fatal("repeat End did not refresh retention")
	}
	if len(k.ended) != endedKeep || k.order.Len() != endedKeep {
		t.Fatal("unbounded ended ledger")
	}
}
func TestConcurrentBind(t *testing.T) {
	k, _ := fixture(t)
	var wg sync.WaitGroup
	ids := make(chan int64, 64)
	for i := 0; i < 64; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); ids <- bind(t, k, "shared", "U") }()
	}
	wg.Wait()
	close(ids)
	var first int64
	for sid := range ids {
		if first == 0 {
			first = sid
		}
		if sid != first {
			t.Fatal("concurrent binds opened multiple contexts")
		}
	}
	if len(k.sessions) != 1 {
		t.Fatal("multiple session entries")
	}
}
func TestConcurrentLifecycle(t *testing.T) {
	k, srv := fixture(t)
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				id := fmt.Sprint(i % 4)
				k.Revive(id)
				if _, err := k.Bind(id, "U"); err != nil {
					t.Error(err)
				}
				k.ContextAlive(id)
				k.Handle(id)
				k.DropContext(id)
				k.End(id)
			}
		}(i)
	}
	wg.Wait()
	for i := 0; i < 4; i++ {
		id := fmt.Sprint(i)
		k.End(id)
		if k.ContextAlive(id) {
			t.Fatal("racing lifecycle retained context")
		}
		if bound, err := k.Bind(id, "U"); bound || err != nil {
			t.Fatal("final end lost")
		}
	}
	if len(k.sessions) != 0 || len(srv.Read(enq.Filter{})) != 0 {
		t.Fatal("lifecycle leaked contexts")
	}
	if len(k.pins) != 0 || len(k.retired) != 0 {
		t.Fatal("lifecycle leaked pin/retirement state")
	}
}

func TestConcurrentPinRetirement(t *testing.T) {
	k, srv := fixture(t)
	var wg sync.WaitGroup
	var ready sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < 32; i++ {
		wg.Add(1)
		ready.Add(1)
		go func() {
			defer func() { <-start; wg.Done() }()
			sid, bound, err := k.Pin("shared", "U")
			if !bound || err != nil {
				t.Errorf("Pin: %v, %v", bound, err)
				return
			}
			ready.Done()
			<-start
			k.DropContext("shared")
			if replacement, bound, err := k.Pin("shared", "U"); !bound || err != nil || replacement == sid {
				t.Errorf("dump reused retired handle %d", sid)
			} else {
				k.Unpin(replacement)
			}
			k.Unpin(sid)
		}()
	}
	ready.Wait()
	close(start)
	wg.Wait()
	k.End("shared")
	if len(k.sessions) != 0 || len(k.pins) != 0 || len(k.retired) != 0 ||
		len(srv.Read(enq.Filter{})) != 0 {
		t.Fatal("concurrent pin retirement leaked state")
	}
}
