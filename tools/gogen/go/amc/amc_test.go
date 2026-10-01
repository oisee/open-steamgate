package amc

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

// the SAMC of test/unit ZCL_OSD_AMC_TEST (src/amc/zstg_amc_test.samc.xml),
// plus a user-scoped channel
func testBroker() *Broker {
	auth := func(path string, acts ...string) []Authority {
		var out []Authority
		for _, a := range acts {
			out = append(out, Authority{Path: path, Program: ProgramOf("ZCL_OSD_AMC_TEST"), Activity: a})
		}
		return out
	}
	text := auth("/text", "S", "R")
	text = append(text, Authority{Path: "/text", Program: ProgramOf("ZCL_OSD_AMC_SOCKET"), Activity: "C"})
	return New(
		Channel{App: "ZOSD_AMC_TEST", Path: "/text", Type: "TEXT", Scope: "C", Auth: text},
		Channel{App: "ZOSD_AMC_TEST", Path: "/denied", Type: "TEXT", Scope: "C", Auth: text},
		Channel{App: "ZOSD_AMC_TEST", Path: "/binary", Type: "BINARY", Scope: "C", Auth: auth("/binary", "S", "R")},
		Channel{App: "ZOSD_AMC_TEST", Path: "/user", Type: "TEXT", Scope: "U", Auth: auth("/user", "S", "R")},
	)
}

type session struct{ name string }

func at(s *session, client, user string) Endpoint {
	return Endpoint{Session: s, Program: ProgramOf("ZCL_OSD_AMC_TEST"), Client: client, Username: user}
}

type got struct {
	mu   sync.Mutex
	msgs []Message
}

func (g *got) deliver(_ any, m Message) { g.mu.Lock(); g.msgs = append(g.msgs, m); g.mu.Unlock() }
func (g *got) n() int                   { g.mu.Lock(); defer g.mu.Unlock(); return len(g.msgs) }

func TestProgramOf(t *testing.T) {
	if p := ProgramOf("ZCL_OSD_AMC_TEST"); p != "ZCL_OSD_AMC_TEST==============CP" || len(p) != 32 {
		t.Fatal(p)
	}
}

func TestDeliveryAndContext(t *testing.T) {
	b := testBroker()
	a := &session{"a"}
	if _, err := b.Subscribe("zosd_amc_test", "/TEXT", "", at(a, "001", "ALICE"), "rcv"); err != nil {
		t.Fatal(err)
	}
	if err := b.Publish("ZOSD_AMC_TEST", "/text", "", at(&session{"p"}, "001", "ALICE"), false, Message{Type: "TEXT", Payload: "one"}); err != nil {
		t.Fatal(err)
	}
	var g got
	rc := b.Wait(a, func() bool { return g.n() == 1 }, time.Second, g.deliver)
	if rc != 0 || g.msgs[0].Payload != "one" || g.msgs[0].Client != "001" || g.msgs[0].Username != "ALICE" {
		t.Fatalf("rc %d %+v", rc, g.msgs)
	}
}

func TestAuthority(t *testing.T) {
	b := testBroker()
	other := Endpoint{Session: &session{}, Program: ProgramOf("ZCL_SOMEONE_ELSE")}
	var e *Error
	if err := b.Publish("ZOSD_AMC_TEST", "/text", "", other, false, Message{Type: "TEXT"}); !errors.As(err, &e) || !errors.Is(err, ErrNotAuthorised) || e.Reason != "AMC send is not authorised for ZCL_SOMEONE_ELSE==============CP." {
		t.Fatalf("send by another program: %v", err)
	}
	if _, err := b.Subscribe("ZOSD_AMC_TEST", "/binary", "", other, nil); !errors.Is(err, ErrNotAuthorised) {
		t.Fatalf("receive by another program: %v", err)
	}
	// /denied exists but has no authority rows of its own
	if err := b.Publish("ZOSD_AMC_TEST", "/denied", "", at(&session{}, "001", "U"), false, Message{Type: "TEXT"}); !errors.Is(err, ErrNotAuthorised) {
		t.Fatalf("send on /denied: %v", err)
	}
	if err := b.Publish("ZOSD_AMC_TEST", "/nope", "", at(&session{}, "001", "U"), false, Message{Type: "TEXT"}); !errors.Is(err, ErrNotDefined) {
		t.Fatalf("undefined channel: %v", err)
	}
	if err := b.Publish("ZOSD_AMC_TEST", "/binary", "", at(&session{}, "001", "U"), false, Message{Type: "TEXT"}); !errors.Is(err, ErrType) {
		t.Fatalf("wrong type: %v", err)
	}
}

func TestEchoScopeAndExtension(t *testing.T) {
	b := testBroker()
	me := &session{"me"}
	other := &session{"other"}
	b.Subscribe("ZOSD_AMC_TEST", "/text", "", at(me, "001", "A"), "me")
	b.Subscribe("ZOSD_AMC_TEST", "/text", "", at(other, "002", "A"), "other-client")
	b.Subscribe("ZOSD_AMC_TEST", "/text", "ext", at(other, "001", "A"), "other-ext")
	b.Subscribe("ZOSD_AMC_TEST", "/user", "", at(other, "001", "B"), "other-user")
	// suppress-echo: not to the producer's own session
	b.Publish("ZOSD_AMC_TEST", "/text", "", at(me, "001", "A"), true, Message{Type: "TEXT", Payload: "quiet"})
	var mine got
	if b.Pump(me, mine.deliver) || mine.n() != 0 {
		t.Fatal("echo was delivered")
	}
	// scope C: another client does not get it; the extension is part of the address
	b.Publish("ZOSD_AMC_TEST", "/text", "", at(me, "001", "A"), false, Message{Type: "TEXT", Payload: "x"})
	b.Publish("ZOSD_AMC_TEST", "/user", "", at(me, "001", "A"), false, Message{Type: "TEXT", Payload: "u"})
	var theirs got
	b.Pump(other, theirs.deliver)
	if theirs.n() != 0 {
		t.Fatalf("delivered across client, extension or user: %+v", theirs.msgs)
	}
	b.Publish("ZOSD_AMC_TEST", "/text", "ext", at(me, "001", "A"), false, Message{Type: "TEXT", Payload: "e"})
	b.Pump(other, theirs.deliver)
	if theirs.n() != 1 || theirs.msgs[0].Payload != "e" {
		t.Fatalf("extension: %+v", theirs.msgs)
	}
}

func TestStopDropsQueued(t *testing.T) {
	b := testBroker()
	a := &session{}
	sub, _ := b.Subscribe("ZOSD_AMC_TEST", "/text", "", at(a, "001", "A"), "r")
	b.Publish("ZOSD_AMC_TEST", "/text", "", at(&session{}, "001", "A"), false, Message{Type: "TEXT", Payload: "late"})
	sub.Stop()
	var g got
	if b.Pump(a, g.deliver) || g.n() != 0 {
		t.Fatal("a stopped subscription was delivered to")
	}
}

func TestWaitTimesOut(t *testing.T) {
	b := testBroker()
	a := &session{}
	b.Subscribe("ZOSD_AMC_TEST", "/text", "", at(a, "001", "A"), "r")
	var g got
	start := time.Now()
	if rc := b.Wait(a, func() bool { return g.n() == 1 }, 50*time.Millisecond, g.deliver); rc != 8 {
		t.Fatalf("rc %d", rc)
	}
	if time.Since(start) < 50*time.Millisecond {
		t.Fatal("returned before the deadline")
	}
}

// a message sent while the session is inside WAIT wakes it
func TestWaitWakesOnPublish(t *testing.T) {
	b := testBroker()
	a := &session{}
	b.Subscribe("ZOSD_AMC_TEST", "/text", "", at(a, "001", "A"), "r")
	go func() {
		time.Sleep(20 * time.Millisecond)
		b.Publish("ZOSD_AMC_TEST", "/text", "", at(&session{}, "001", "A"), false, Message{Type: "TEXT", Payload: "late"})
	}()
	var g got
	if rc := b.Wait(a, func() bool { return g.n() == 1 }, 2*time.Second, g.deliver); rc != 0 {
		t.Fatalf("rc %d", rc)
	}
}

// dell's case: a receiver that SENDs, inside WAIT, to a channel its own
// session listens on (no suppress-echo) neither deadlocks nor loses it
func TestReceiverSendsToItsOwnSession(t *testing.T) {
	b := testBroker()
	a := &session{}
	b.Subscribe("ZOSD_AMC_TEST", "/text", "", at(a, "001", "A"), "r")
	b.Publish("ZOSD_AMC_TEST", "/text", "", at(&session{}, "001", "A"), false, Message{Type: "TEXT", Payload: "first"})
	var seen []string
	deliver := func(_ any, m Message) {
		seen = append(seen, m.Payload.(string))
		if m.Payload == "first" {
			if err := b.Publish("ZOSD_AMC_TEST", "/text", "", at(a, "001", "A"), false, Message{Type: "TEXT", Payload: "second"}); err != nil {
				t.Error(err)
			}
		}
	}
	done := make(chan int32)
	go func() { done <- b.Wait(a, func() bool { return len(seen) == 2 }, time.Second, deliver) }()
	select {
	case rc := <-done:
		if rc != 0 || fmt.Sprint(seen) != "[first second]" {
			t.Fatalf("rc %d %v", rc, seen)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("deadlock")
	}
}

// order per producer holds under concurrent producers; nothing is lost; the
// producers never block (run with -race)
func TestManyProducersOrderAndNoLoss(t *testing.T) {
	b := testBroker()
	a := &session{}
	b.Subscribe("ZOSD_AMC_TEST", "/text", "", at(a, "001", "A"), "r")
	const producers, each = 8, 12500
	var wg sync.WaitGroup
	for p := 0; p < producers; p++ {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			from := at(&session{}, "001", "A")
			for i := 0; i < each; i++ {
				b.Publish("ZOSD_AMC_TEST", "/text", "", from, false, Message{Type: "TEXT", Payload: fmt.Sprintf("%d:%d", p, i)})
			}
		}(p)
	}
	wg.Wait()
	last := map[int]int{}
	for p := 0; p < producers; p++ {
		last[p] = -1
	}
	n := 0
	b.Pump(a, func(_ any, m Message) {
		var p, i int
		fmt.Sscanf(m.Payload.(string), "%d:%d", &p, &i)
		if i != last[p]+1 {
			t.Fatalf("producer %d: %d after %d", p, i, last[p])
		}
		last[p] = i
		n++
	})
	if n != producers*each {
		t.Fatalf("%d of %d delivered", n, producers*each)
	}
}

func TestSessionIDAndForget(t *testing.T) {
	b := testBroker()
	a, c := &session{}, &session{}
	if b.SessionID(a) != b.SessionID(a) || b.SessionID(a) == b.SessionID(c) || b.SessionID(a) == "" {
		t.Fatal("session ids")
	}
	b.Subscribe("ZOSD_AMC_TEST", "/text", "", at(a, "001", "A"), "r")
	b.Forget(a)
	b.Publish("ZOSD_AMC_TEST", "/text", "", at(c, "001", "A"), false, Message{Type: "TEXT"})
	var g got
	if b.Pump(a, g.deliver) {
		t.Fatal("a forgotten session got a message")
	}
}

func TestCurrentAndUse(t *testing.T) {
	first := Current()
	if Current() != first {
		t.Fatal("Current is not stable")
	}
	mine := testBroker()
	old := Use(mine)
	if Current() != mine || old != first {
		t.Fatal("Use did not swap")
	}
	Use(old)
}

func TestBindingsAndCaller(t *testing.T) {
	b := testBroker()
	a := &session{}
	if b.Caller(a) != "" {
		t.Fatal("caller before Enter")
	}
	outer := b.Enter(a, "ZCL_OUTER=====================CP")
	inner := b.Enter(a, "ZCL_INNER=====================CP")
	if b.Caller(a) != "ZCL_INNER=====================CP" {
		t.Fatal(b.Caller(a))
	}
	inner()
	if b.Caller(a) != "ZCL_OUTER=====================CP" {
		t.Fatal(b.Caller(a))
	}
	outer()
	p := &struct{ x int }{}
	b.Bind(p, Producer{App: "A", Path: "/p"})
	if b.Bound(p).(Producer).Path != "/p" {
		t.Fatal("bind")
	}
	consumer, receiver := &struct{ y int }{}, "r"
	s1, _ := b.Subscribe("ZOSD_AMC_TEST", "/text", "", at(a, "001", "A"), receiver)
	s2, _ := b.Subscribe("ZOSD_AMC_TEST", "/text", "", at(a, "001", "A"), receiver)
	b.Track(consumer, receiver, s1)
	b.Track(consumer, receiver, s2)
	if s1.active.Load() || !s2.active.Load() {
		t.Fatal("a second START did not replace the first")
	}
	b.Untrack(consumer, receiver)
	if s2.active.Load() {
		t.Fatal("STOP left it active")
	}
	if Seconds(1.5) != 1500*time.Millisecond {
		t.Fatal("seconds")
	}
}

// the generated code defines the channels at every CREATE; a subscription
// made before a later Define still receives (found running ZCL_OSD_AMC_TEST)
func TestDefineAgainKeepsSubscriptions(t *testing.T) {
	b := testBroker()
	a := &session{}
	b.Subscribe("ZOSD_AMC_TEST", "/text", "", at(a, "001", "A"), "r")
	b.Define(Channel{App: "ZOSD_AMC_TEST", Path: "/text", Type: "TEXT", Scope: "C", Auth: []Authority{
		{Path: "/text", Program: ProgramOf("ZCL_OSD_AMC_TEST"), Activity: "S"}, {Path: "/text", Program: ProgramOf("ZCL_OSD_AMC_TEST"), Activity: "R"}}})
	b.Publish("ZOSD_AMC_TEST", "/text", "", at(&session{}, "001", "A"), false, Message{Type: "TEXT", Payload: "x"})
	var g got
	if !b.Pump(a, g.deliver) || g.n() != 1 {
		t.Fatal("a Define after Subscribe orphaned the subscription")
	}
}

// a receiver that raises (a CX in RECEIVE) leaves the rest of the batch
// queued, ahead of what was published since (the critic on #263)
func TestPanicKeepsTheRest(t *testing.T) {
	b := testBroker()
	a := &session{}
	b.Subscribe("ZOSD_AMC_TEST", "/text", "", at(a, "001", "A"), "r")
	from := at(&session{}, "001", "A")
	for _, p := range []string{"one", "boom", "three"} {
		b.Publish("ZOSD_AMC_TEST", "/text", "", from, false, Message{Type: "TEXT", Payload: p})
	}
	var seen []string
	deliver := func(_ any, m Message) {
		seen = append(seen, m.Payload.(string))
		if m.Payload == "boom" {
			panic("raised in RECEIVE")
		}
	}
	func() {
		defer func() { recover() }()
		b.Pump(a, deliver)
	}()
	b.Publish("ZOSD_AMC_TEST", "/text", "", from, false, Message{Type: "TEXT", Payload: "four"})
	b.Pump(a, deliver)
	if fmt.Sprint(seen) != "[one boom three four]" {
		t.Fatalf("%v", seen)
	}
}
