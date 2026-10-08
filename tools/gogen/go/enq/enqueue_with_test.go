package enq

import (
	"testing"
	"time"
)

func TestEnqueueWithUsesInjectedSleep(t *testing.T) {
	server := New("test")
	defer server.Close()
	other := server.Open("OTHER")
	owner := server.Open("DEVELOPER")
	request := Request{Table: "T", Fields: []Field{{Value: "K"}}, Mode: "E"}
	if result := server.Enqueue(other, request, false); result.Subrc != 0 {
		t.Fatalf("other: %+v", result)
	}
	var intervals []time.Duration
	result := server.EnqueueWith(owner, request, true, func(duration time.Duration) {
		intervals = append(intervals, duration)
		if len(intervals) == 1 {
			server.Dequeue(other, request)
			return
		}
		t.Fatal("sleep after grant")
	})
	if result.Subrc != 0 || len(intervals) != 1 || intervals[0] != time.Second {
		t.Fatalf("result %+v intervals %v", result, intervals)
	}
}
