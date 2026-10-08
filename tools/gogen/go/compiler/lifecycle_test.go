package compiler

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func await(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(time.Second):
		t.Fatal("completion not observed")
	}
}

func TestCancelledAdmissionsRace(t *testing.T) {
	c := fake(t, "answer")
	// An active op owns both admission and mu. Canceled callers must not wait for mu.
	c.admission <- struct{}{}
	c.mu.Lock()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var wg sync.WaitGroup
	for range 64 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code(t, c.Hello(ctx), "TIMEOUT")
			_, err := c.Check(ctx, Snapshot{})
			code(t, err, "TIMEOUT")
		}()
	}
	finished := make(chan struct{})
	go func() { wg.Wait(); close(finished) }()
	// Exercise the status writer concurrently with canceled admissions.
	for range 1000 {
		c.record(&Refusal{Code: "INTERNAL", Text: "active"})
	}
	select {
	case <-finished:
	case <-time.After(time.Second):
		c.mu.Unlock()
		<-c.admission
		t.Fatal("cancellation waited on mu")
	}
	c.mu.Unlock()
	<-c.admission
}

func TestBrokenStreamAlive(t *testing.T) {
	for _, mode := range []string{"close-stdout", "malformed-alive"} {
		t.Run(mode, func(t *testing.T) {
			c := fake(t, mode)
			if err := c.Hello(context.Background()); err != nil {
				t.Fatal(err)
			}
			p := c.proc
			c.options.CheckTimeout = 100 * time.Millisecond
			start := time.Now()
			_, err := c.Check(context.Background(), Snapshot{})
			code(t, err, "INTERNAL")
			if time.Since(start) > 500*time.Millisecond || c.proc != nil {
				t.Fatal("cleanup not bounded")
			}
			await(t, p.dead)
			t.Setenv("COMPILER_FAKE", "answer")
			c.options.CheckTimeout = time.Second
			if err := c.Hello(context.Background()); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDescendantRetainsStdout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix process group fixture")
	}
	c := fake(t, "descendant-exit")
	marker := filepath.Join(t.TempDir(), "heartbeat")
	t.Setenv("COMPILER_MARKER", marker)
	if err := c.Hello(context.Background()); err != nil {
		t.Fatal(err)
	}
	p := c.proc
	t.Cleanup(func() { killProcess(p.cmd) })
	c.options.CheckTimeout = 100 * time.Millisecond
	start := time.Now()
	_, err := c.Check(context.Background(), Snapshot{})
	code(t, err, "TIMEOUT")
	if time.Since(start) > 500*time.Millisecond {
		t.Fatal("descendant blocked cleanup")
	}
	await(t, p.dead)
	await(t, p.done)
	before, err := os.ReadFile(marker)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(40 * time.Millisecond)
	after, err := os.ReadFile(marker)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("descendant survived process group kill")
	}
	t.Setenv("COMPILER_FAKE", "answer")
	c.options.CheckTimeout = time.Second
	if err := c.Hello(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestIdleDeathBackoff(t *testing.T) {
	c := fake(t, "answer")
	if err := c.Hello(context.Background()); err != nil {
		t.Fatal(err)
	}
	p := c.proc
	killProcess(p.cmd)
	await(t, p.dead)
	await(t, p.done)
	base := time.Unix(100, 0)
	c.now = func() time.Time { return base }
	c.options.RestartBackoff = 37 * time.Millisecond
	slept := false
	c.after = func(delay time.Duration) <-chan time.Time {
		if delay != 37*time.Millisecond {
			t.Errorf("delay %s", delay)
		}
		slept = true
		base = base.Add(delay)
		return time.After(0)
	}
	if err := c.Hello(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !slept || c.Status().Restarts != 1 {
		t.Fatal("idle death bypassed backoff")
	}
}

func TestFinalAnswerAtEOF(t *testing.T) {
	c := fake(t, "answer-exit")
	if err := c.Hello(context.Background()); err != nil {
		t.Fatal(err)
	}
	p := c.proc
	t.Cleanup(func() { killProcess(p.cmd) })
	if err := json.NewEncoder(p.stdin).Encode(map[string]any{"id": 1, "op": "check"}); err != nil {
		t.Fatal(err)
	}
	await(t, p.done) // force answer buffered AND EOF observed before the receive
	raw, err := p.answer(context.Background())
	if err != nil || !strings.Contains(string(raw), `"id":1`) {
		t.Fatalf("final answer lost: %s %v", raw, err)
	}
}

func TestResponseTransport(t *testing.T) {
	for _, mode := range []string{"fragmented", "large", "stderr-flood"} {
		t.Run(mode, func(t *testing.T) {
			c := fake(t, mode)
			result, err := c.Check(context.Background(), Snapshot{Root: strings.Repeat("r", 128*1024)})
			if err != nil {
				t.Fatal(err)
			}
			if mode != "stderr-flood" && (len(result.Diagnostics) != 1 || len(result.Diagnostics[0].Text) != 128*1024) {
				t.Fatal("response truncated")
			}
		})
	}
}

func TestBlockedWriteDeadline(t *testing.T) {
	c := fake(t, "blocked-write")
	if err := c.Hello(context.Background()); err != nil {
		t.Fatal(err)
	}
	p := c.proc
	c.options.CheckTimeout = 30 * time.Millisecond
	start := time.Now()
	_, err := c.Check(context.Background(), Snapshot{Root: strings.Repeat("x", 2*1024*1024)})
	code(t, err, "TIMEOUT")
	if time.Since(start) > 500*time.Millisecond || c.proc != nil {
		t.Fatal("blocked write not bounded")
	}
	await(t, p.dead)
}

func TestHelloInvalidLimits(t *testing.T) {
	for _, limits := range []string{
		`{"maxSnapshotBytes":1234}`, `{"maxConcurrentRequests":1}`,
		`{"maxSnapshotBytes":-1,"maxConcurrentRequests":1}`, `{"maxSnapshotBytes":1234,"maxConcurrentRequests":-1}`,
		`{"maxSnapshotBytes":0,"maxConcurrentRequests":1}`, `{"maxSnapshotBytes":1234,"maxConcurrentRequests":0}`,
		`{"maxSnapshotBytes":1.5,"maxConcurrentRequests":1}`, `{"maxSnapshotBytes":1234,"maxConcurrentRequests":1.5}`,
	} {
		t.Run(limits, func(t *testing.T) {
			c := fake(t, "limits:"+limits)
			err := c.Hello(context.Background())
			code(t, err, "HANDSHAKE")
			if c.proc != nil {
				t.Fatal("invalid hello retained")
			}
		})
	}
}

func TestIdleClosedStream(t *testing.T) {
	c := fake(t, "idle-close")
	if err := c.Hello(context.Background()); err != nil {
		t.Fatal(err)
	}
	p := c.proc
	await(t, p.done)
	t.Setenv("COMPILER_FAKE", "answer")
	start := time.Now()
	if err := c.Hello(context.Background()); err != nil {
		t.Fatal(err)
	}
	if time.Since(start) > 500*time.Millisecond {
		t.Fatal("idle cleanup hung")
	}
	await(t, p.dead)
	if c.Status().Restarts != 1 {
		t.Fatal("idle child not replaced")
	}
}

func TestIdleDescendantRecovery(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix process group fixture")
	}
	c := fake(t, "descendant-exit")
	marker := filepath.Join(t.TempDir(), "heartbeat")
	t.Setenv("COMPILER_MARKER", marker)
	if err := c.Hello(context.Background()); err != nil {
		t.Fatal(err)
	}
	p := c.proc
	t.Cleanup(func() { killProcess(p.cmd) })
	if err := json.NewEncoder(p.stdin).Encode(map[string]any{"id": 1, "op": "check"}); err != nil {
		t.Fatal(err)
	}
	await(t, p.dead)
	select {
	case <-p.done:
		t.Fatal("descendant did not retain stdout")
	default:
	}
	t.Setenv("COMPILER_FAKE", "answer")
	start := time.Now()
	if err := c.Hello(context.Background()); err != nil {
		t.Fatal(err)
	}
	if time.Since(start) > 500*time.Millisecond {
		t.Fatal("idle descendant cleanup hung")
	}
	await(t, p.done)
	before, _ := os.ReadFile(marker)
	time.Sleep(40 * time.Millisecond)
	after, _ := os.ReadFile(marker)
	if string(before) != string(after) {
		t.Fatal("idle descendant survived")
	}
}

func TestKillGraceBound(t *testing.T) {
	c := fake(t, "answer")
	if err := c.Hello(context.Background()); err != nil {
		t.Fatal(err)
	}
	real := c.proc
	// Model a Wait implementation that never signals completion; cleanup still returns.
	c.proc = &proc{cmd: real.cmd, stdin: real.stdin, stdout: real.stdout, dead: make(chan struct{})}
	c.options.KillGrace = 15 * time.Millisecond
	start := time.Now()
	c.mu.Lock()
	c.stop()
	c.mu.Unlock()
	elapsed := time.Since(start)
	if elapsed < 15*time.Millisecond || elapsed > 500*time.Millisecond {
		t.Fatalf("cleanup grace: %s", elapsed)
	}
	await(t, real.dead)
}

func TestResponseLineLimit(t *testing.T) {
	c := fake(t, "large")
	if err := c.Hello(context.Background()); err != nil {
		t.Fatal(err)
	}
	c.proc.maxLine.Store(32 * 1024)
	_, err := c.Check(context.Background(), Snapshot{})
	code(t, err, "INTERNAL")
	if c.proc != nil {
		t.Fatal("oversized response retained")
	}
}

func TestAdmissionMutexCancellation(t *testing.T) {
	c := fake(t, "answer")
	c.mu.Lock()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- c.Hello(ctx) }()
	select {
	case err := <-done:
		c.mu.Unlock()
		code(t, err, "TIMEOUT")
	case <-time.After(500 * time.Millisecond):
		c.mu.Unlock()
		<-done
		t.Fatal("admission waited on mutex past context")
	}
}
