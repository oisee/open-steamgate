package adtlock

import (
	"errors"
	"testing"
	"time"

	"osg/gogen/adtenq"
	"osg/gogen/enq"
)

func request(value string) enq.Request {
	return enq.Request{Table: "ZOSD_TEST", Object: "EZOSD_TEST", Fields: []enq.Field{{Value: value}}, Mode: "E"}
}

func newHost(t *testing.T) (*Host, func()) {
	t.Helper()
	server := enq.New("test")
	kernel := adtenq.New(server)
	host := New(server, kernel)
	host.User = func() string { return "DEVELOPER" }
	return host, func() { server.Close() }
}

func TestStepKeyedHolderSessions(t *testing.T) {
	host, closeServer := newHost(t)
	defer closeServer()

	first, second := new(struct{ int }), new(struct{ int })
	host.Begin(first)
	host.Begin(second)
	defer host.Finish(first, false)
	defer host.Finish(second, false)

	if result, err := host.Enqueue(first, request("A"), nil); err != nil || result.Subrc != 0 {
		t.Fatalf("first enqueue: result %+v err %v", result, err)
	}
	result, err := host.Enqueue(second, request("A"), nil)
	if err != nil || result.Subrc != 1 || result.Msgno != "601" || result.Holder != "DEVELOPER" {
		t.Fatalf("second enqueue: result %+v err %v", result, err)
	}
}

func TestHolderSessionIsReleasedAtStepEnd(t *testing.T) {
	host, closeServer := newHost(t)
	defer closeServer()

	step := new(struct{ int })
	host.Begin(step)
	if _, err := host.Enqueue(step, request("HOLDER"), nil); err != nil {
		t.Fatal(err)
	}
	host.Finish(step, false)
	if rows := host.server.Read(enq.Filter{Table: "ZOSD_TEST"}); len(rows) != 0 {
		t.Fatalf("successful step left %d locks", len(rows))
	}
}

func TestBoundContextSurvivesStepAndDroppedOnDump(t *testing.T) {
	host, closeServer := newHost(t)
	defer closeServer()
	const id = "bound-context"
	defer host.kernel.End(id)

	normal := new(struct{ int })
	host.Begin(normal)
	if ok, err := host.bind(normal, id, "ALICE"); !ok || err != nil {
		t.Fatalf("bind: %v %v", ok, err)
	}
	if _, err := host.Enqueue(normal, request("BOUND"), nil); err != nil {
		t.Fatal(err)
	}
	host.Finish(normal, false)
	if rows := host.server.Read(enq.Filter{Table: "ZOSD_TEST"}); len(rows) != 1 {
		t.Fatalf("bound context lost its lock: %+v", rows)
	}

	dumped := new(struct{ int })
	host.Begin(dumped)
	if ok, err := host.bind(dumped, id, "ALICE"); !ok || err != nil {
		t.Fatalf("rebind: %v %v", ok, err)
	}
	host.Finish(dumped, true)
	if host.kernel.ContextAlive(id) || len(host.server.Read(enq.Filter{Table: "ZOSD_TEST"})) != 0 {
		t.Fatal("dump did not retire the bound context and its locks")
	}
}

func TestRetryUsesInjectedSleep(t *testing.T) {
	host, closeServer := newHost(t)
	defer closeServer()

	other := host.server.Open("OTHER")
	if result := host.server.Enqueue(other, request("RETRY"), false); result.Subrc != 0 {
		t.Fatalf("other enqueue: %+v", result)
	}
	step := new(struct{ int })
	host.Begin(step)
	defer host.Finish(step, false)
	var slept []time.Duration
	result, err := host.EnqueueWithSleep(step, request("RETRY"), true, func(duration time.Duration) {
		slept = append(slept, duration)
		host.server.Dequeue(other, request("RETRY"))
	})
	if err != nil || result.Subrc != 0 || len(slept) != 1 || slept[0] != time.Second {
		t.Fatalf("result %+v err %v slept %v", result, err, slept)
	}
}

func TestEndedContextDuringSleepReturnsError(t *testing.T) {
	host, closeServer := newHost(t)
	defer closeServer()
	const id = "ended-in-sleep"
	defer host.kernel.End(id)

	step := new(struct{ int })
	host.Begin(step)
	if ok, err := host.bind(step, id, "ALICE"); !ok || err != nil {
		t.Fatalf("bind: %v %v", ok, err)
	}
	other := host.server.Open("OTHER")
	host.server.Enqueue(other, request("ENDED"), false)
	_, err := host.EnqueueWithSleep(step, request("ENDED"), true, func(time.Duration) {
		host.end(id)
	})
	if !errors.Is(err, ErrSessionEnded) {
		t.Fatalf("err %v, want ErrSessionEnded", err)
	}
	host.Finish(step, true)
}

func TestPinnedContextSurvivesAnotherStepsDump(t *testing.T) {
	host, closeServer := newHost(t)
	defer closeServer()
	const id = "pinned-context"
	defer host.end(id)

	parked, dumping := new(struct{ int }), new(struct{ int })
	host.Begin(parked)
	host.Begin(dumping)
	defer host.Finish(parked, false)
	for _, step := range []any{parked, dumping} {
		if ok, err := host.bind(step, id, "ALICE"); !ok || err != nil {
			t.Fatalf("bind: %v %v", ok, err)
		}
	}
	host.Finish(dumping, true)
	if host.kernel.ContextAlive(id) {
		t.Fatal("dumping step did not retire the key's current context")
	}
	if result, err := host.Enqueue(parked, request("PARKED"), nil); err != nil || result.Subrc != 0 {
		t.Fatalf("parked enqueue: result %+v err %v", result, err)
	}
}

func TestDequeueAndDequeueAllFollowNode(t *testing.T) {
	host, closeServer := newHost(t)
	defer closeServer()

	step := new(struct{ int })
	host.Begin(step)
	first, second := request("ONE"), request("TWO")
	host.Enqueue(step, first, nil)
	host.Enqueue(step, second, nil)
	if err := host.Dequeue(step, first); err != nil {
		t.Fatal(err)
	}
	if rows := host.server.Read(enq.Filter{Table: "ZOSD_TEST"}); len(rows) != 1 || rows[0].Arg != "TWO" {
		t.Fatalf("after Dequeue: %+v", rows)
	}
	if err := host.DequeueAll(step); err != nil {
		t.Fatal(err)
	}
	if rows := host.server.Read(enq.Filter{Table: "ZOSD_TEST"}); len(rows) != 0 {
		t.Fatalf("after DequeueAll: %+v", rows)
	}
	host.Finish(step, false)
}
