package main

import (
	"osg/gogen/abap"
	"sync"
	"testing"
)

func TestSessionStatics(t *testing.T) {
	const workers = 8
	var ready, done sync.WaitGroup
	ready.Add(workers)
	done.Add(workers)
	start := make(chan struct{})
	values, counts := make([]int32, workers), make([]int32, workers)
	for w := range workers {
		go func() {
			defer done.Done()
			s := &abap.Session{}
			ready.Done()
			<-start
			values[w] = ZCL_RACE_INIT_READ(s)
			for range 10000 {
				counts[w] = ZCL_RACE_COUNTER_INCREMENT(s)
			}
		}()
	}
	ready.Wait()
	close(start)
	done.Wait()
	for w := range workers {
		if values[w] != 42 {
			t.Errorf("session %d init: got %d, want 42", w, values[w])
		}
		if counts[w] != 10000 {
			t.Errorf("session %d counter: got %d, want 10000", w, counts[w])
		}
	}
	// A new zero session resets both attributes and constructor state.
	s := &abap.Session{}
	if got := ZCL_RACE_INIT_READ(s); got != 42 {
		t.Errorf("fresh init: %d", got)
	}
	if got := ZCL_RACE_COUNTER_INCREMENT(s); got != 1 {
		t.Errorf("fresh counter: %d", got)
	}
}

var benchmarkCount int32

func BenchmarkSessionStaticIncrement(b *testing.B) {
	s := &abap.Session{}
	ZCL_RACE_COUNTER_INCREMENT(s) // initialize outside the measured loop
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		benchmarkCount = ZCL_RACE_COUNTER_INCREMENT(s)
	}
}

func TestInheritedAndReferencedStatics(t *testing.T) {
	a, b := &abap.Session{}, &abap.Session{}
	if got := ZCL_RACE_READER_READ(a); got != 8 {
		t.Fatalf("cross-class init: %d", got)
	}
	if got := ZCL_RACE_CHILD_REFERENCES(a); got != 19 {
		t.Fatalf("static references: %d", got)
	}
	if got := ZCL_RACE_READER_READ(a); got != 19 {
		t.Fatalf("inherited storage: %d", got)
	}
	if got := ZCL_RACE_READER_READ(b); got != 8 {
		t.Fatalf("fresh inherited storage: %d", got)
	}
	if got := ZCL_RACE_READER_INITIAL(a); got != 1 {
		t.Fatalf("ABAP initial values: %d", got)
	}
	for _, s := range []*abap.Session{a, b, a} {
		if got := ZCL_RACE_READER_OWNED(s); got != 2 {
			t.Fatalf("owned buffer/CLEAR: %d", got)
		}
	}
}
