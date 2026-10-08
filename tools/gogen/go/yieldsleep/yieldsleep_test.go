package yieldsleep

import (
	"testing"
	"time"

	"osg/gogen/abap"
)

func TestSleepYieldsOnlyWhenSessionHoldsWorkProcess(t *testing.T) {
	held := &abap.Session{HoldsWorkProcess: true}
	entered := make(chan struct{})
	abap.WorkProcess.Lock()
	go func() {
		close(entered)
		abap.WorkProcess.Lock()
		abap.WorkProcess.Unlock()
	}()
	Sleep(held, 2*time.Millisecond)
	<-entered
	abap.WorkProcess.Unlock()
	if !held.HoldsWorkProcess {
		t.Fatal("held flag was not restored")
	}

	ready := make(chan struct{})
	release := make(chan struct{})
	go func() {
		close(ready)
		abap.WorkProcess.Lock()
		<-release
		abap.WorkProcess.Unlock()
	}()
	<-ready
	plain := &abap.Session{}
	Sleep(plain, 2*time.Millisecond)
	close(release)
	if plain.HoldsWorkProcess {
		t.Fatal("unit run acquired the work process")
	}
}
