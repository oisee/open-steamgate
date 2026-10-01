package enq

import (
	"sync"
	"sync/atomic"
	"testing"
)

// Sessions racing for one key: exactly one E is granted, every other one is
// refused with 601, and after the winner's session ends the table is empty.
func TestConcurrentSessions(t *testing.T) {
	srv := New("osdhost_OSD_00")
	defer srv.Close()
	r := Request{Client: "001", Table: "T", Object: "ET", Mode: "E", Fields: []Field{{Value: "K", Length: 10}}}
	const n = 64
	var granted atomic.Int32
	var winner atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sid := srv.Open("U")
			res := srv.Enqueue(sid, r, false)
			switch {
			case res.Subrc == 0:
				granted.Add(1)
				winner.Store(sid)
			case res.Msgno != "601":
				t.Errorf("refused with %+v", res)
			}
		}()
	}
	wg.Wait()
	if granted.Load() != 1 {
		t.Fatalf("%d sessions got the lock", granted.Load())
	}
	srv.End(winner.Load())
	if rows := srv.Read(Filter{}); len(rows) != 0 {
		t.Fatalf("rows left: %+v", rows)
	}
}
