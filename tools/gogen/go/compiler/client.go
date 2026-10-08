package compiler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sync"
	"time"
)

type Options struct {
	Root, Version    string
	CheckTimeout     time.Duration
	RestartBackoff   time.Duration
	ExpectTranspiler string
}
type Client struct {
	mu        sync.Mutex
	admission chan struct{}
	options   Options
	status    Status
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	answers   chan json.RawMessage
	exited    chan struct{}
	dead      <-chan struct{}
	waited    <-chan error
	nextID    uint64
	starts    int
	retryAt   time.Time
	closed    bool
	now       func() time.Time
	after     func(time.Duration) <-chan time.Time
}

func New(options Options) *Client {
	if options.CheckTimeout <= 0 {
		options.CheckTimeout = 30 * time.Second
	}
	if options.RestartBackoff <= 0 {
		options.RestartBackoff = 100 * time.Millisecond
	}
	if options.Version == "" {
		options.Version = "development"
	}
	return &Client{
		options: options, status: Status{Capabilities: []string{}},
		admission: make(chan struct{}, 1),
		now:       time.Now, after: time.After,
	}
}

func discover(override, executable string) (string, error) {
	paths := []string{}
	if override != "" {
		paths = append(paths, override)
	}
	paths = append(paths, filepath.Join(filepath.Dir(executable), sidecarName()))
	for _, path := range paths {
		// Resolve before exec.Command so even an override without a slash cannot search PATH.
		absolute, err := filepath.Abs(path)
		if err != nil {
			continue
		}
		info, err := os.Stat(absolute)
		if err == nil && !info.IsDir() && executableFile(info) {
			return absolute, nil
		}
	}
	return "", &AbsentError{Paths: paths}
}

func (c *Client) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	status := c.status
	status.Capabilities = slices.Clone(status.Capabilities)
	return status
}

// Hello starts lazily and is also used by the status command.
func (c *Client) Hello(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, c.options.CheckTimeout)
	defer cancel()
	select {
	case c.admission <- struct{}{}:
		defer func() { <-c.admission }()
	case <-ctx.Done():
		return c.record(&Refusal{Code: "TIMEOUT", Text: ctx.Err().Error()})
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ensure(ctx)
}

func (c *Client) Check(ctx context.Context, snapshot Snapshot) (CheckResult, error) {
	ctx, cancel := context.WithTimeout(ctx, c.options.CheckTimeout)
	defer cancel()
	select {
	case c.admission <- struct{}{}:
		defer func() { <-c.admission }()
	case <-ctx.Done():
		return CheckResult{}, c.record(&Refusal{Code: "TIMEOUT", Text: ctx.Err().Error()})
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.ensure(ctx); err != nil {
		return CheckResult{}, err
	}
	if !slices.Contains(c.status.Capabilities, "check") {
		return CheckResult{}, c.record(&Refusal{Code: "UNSUPPORTED_OP", Text: "check not advertised"})
	}
	c.nextID++
	var result CheckResult
	err := c.exchange(ctx, c.nextID, map[string]any{"id": c.nextID, "op": "check", "snapshot": snapshot}, &result)
	return result, err
}

func (c *Client) record(err error) error { c.status.LastError = err.Error(); return err }
func (c *Client) ensure(ctx context.Context) error {
	if c.closed {
		return c.record(&Refusal{Code: "INTERNAL", Text: "client closed"})
	}
	if c.cmd != nil {
		select {
		case <-c.exited:
			_ = c.reap()
			c.record(&Refusal{Code: "INTERNAL", Text: "idle sidecar exited"})
		default:
			select {
			case <-c.dead:
				<-c.exited
				_ = c.reap()
				c.record(&Refusal{Code: "INTERNAL", Text: "idle sidecar exited"})
			default:
				return nil
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return c.record(&Refusal{Code: "TIMEOUT", Text: err.Error()})
	}
	if delay := c.retryAt.Sub(c.now()); delay > 0 {
		select {
		case <-c.after(delay):
		case <-ctx.Done():
			return c.record(&Refusal{Code: "TIMEOUT", Text: ctx.Err().Error()})
		}
	}
	executable, err := os.Executable()
	if err != nil {
		return c.record(err)
	}
	path, err := discover(os.Getenv("OSGO_SIDECAR"), executable)
	c.status.Found = err == nil
	c.status.Path = path
	if err != nil {
		return c.record(err)
	}
	cmd := exec.Command(path, "compiler", "--stdio")
	configureProcess(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return c.record(err)
	}
	stdoutRead, stdoutWrite, err := os.Pipe()
	if err != nil {
		stdin.Close()
		return c.record(err)
	}
	// Tool logs must never be confused with NDJSON responses.
	cmd.Stderr = os.Stderr
	cmd.Stdout = stdoutWrite
	if err = cmd.Start(); err != nil {
		stdin.Close()
		stdoutRead.Close()
		stdoutWrite.Close()
		return c.record(&Refusal{Code: "INTERNAL", Text: err.Error()})
	}
	stdoutWrite.Close()
	c.cmd, c.stdin = cmd, stdin
	c.answers, c.exited = make(chan json.RawMessage, 1), make(chan struct{})
	c.dead, c.waited = watchProcessExit(cmd)
	go readStdout(stdoutRead, c.answers, c.exited)
	if c.starts > 0 {
		c.status.Restarts++
	}
	c.starts++
	var hello helloReply
	err = c.exchange(ctx, 0, map[string]any{"id": 0, "op": "hello", "contract": Contract, "osgo": c.options.Version, "root": c.options.Root}, &hello)
	if err != nil {
		c.stop()
		return err
	}
	c.status.Contract, c.status.OSD, c.status.Transpiler = hello.Contract, hello.OSD, hello.Transpiler
	c.status.Capabilities, c.status.Limits = hello.Capabilities, hello.Limits
	if hello.Contract != Contract {
		c.stop()
		return c.record(&Refusal{Code: "CONTRACT_MISMATCH", Text: fmt.Sprintf("expected %d, got %d", Contract, hello.Contract)})
	}
	if c.options.ExpectTranspiler != "" && hello.Transpiler != c.options.ExpectTranspiler {
		c.stop()
		return c.record(&Refusal{Code: "VERSION_MISMATCH", Text: fmt.Sprintf("expected transpiler %s, got %s", c.options.ExpectTranspiler, hello.Transpiler)})
	}
	return nil
}

type helloReply struct {
	Contract     int      `json:"contract"`
	OSD          string   `json:"osd"`
	Transpiler   string   `json:"transpiler"`
	Capabilities []string `json:"capabilities"`
	Limits       Limits   `json:"limits"`
}

func (hello *helloReply) UnmarshalJSON(raw []byte) error {
	fields := map[string]json.RawMessage{}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	type wireHello helloReply
	var value wireHello
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	*hello = helloReply(value)
	missing := func(field string) bool {
		value, ok := fields[field]
		return !ok || string(value) == "null"
	}
	for _, field := range []string{"contract", "osd", "transpiler", "capabilities", "limits"} {
		if missing(field) || (field == "contract" && hello.Contract == 0) || (field == "limits" && hello.Limits == (Limits{})) {
			return &Refusal{Code: CodeHandshake, Text: "hello is missing " + field}
		}
	}
	if hello.OSD == "" || hello.Transpiler == "" || hello.Capabilities == nil {
		return &Refusal{Code: CodeHandshake, Text: "hello has an empty required field"}
	}
	return nil
}

func readStdout(stdout *os.File, answers chan<- json.RawMessage, exited chan<- struct{}) {
	defer stdout.Close()
	decoder := json.NewDecoder(stdout)
	for {
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			close(exited)
			_, _ = io.Copy(io.Discard, stdout)
			return
		}
		select {
		case answers <- raw:
		default:
		}
	}
}

func (c *Client) exchange(ctx context.Context, id uint64, request any, target any) error {
	// The write is separate so a blocked pipe remains subject to the deadline.
	written := make(chan error, 1)
	writeFinished := false
	go func() {
		written <- json.NewEncoder(c.stdin).Encode(request)
	}()
	select {
	case <-ctx.Done():
		c.stop()
		<-written
		return c.record(&Refusal{Code: "TIMEOUT", Text: ctx.Err().Error()})
	case writeErr := <-written:
		writeFinished = true
		if writeErr != nil {
			c.stop()
			return c.record(&Refusal{Code: "INTERNAL", Text: writeErr.Error()})
		}
	}
	var raw json.RawMessage
	select {
	case raw = <-c.answers:
		if !writeFinished {
			if err := <-written; err != nil {
				c.stop()
				return c.record(&Refusal{Code: "INTERNAL", Text: err.Error()})
			}
		}
		if raw == nil {
			c.stop()
			return c.record(&Refusal{Code: "INTERNAL", Text: "empty response"})
		}
	default:
		select {
		case raw = <-c.answers:
			if !writeFinished {
				if err := <-written; err != nil {
					c.stop()
					return c.record(&Refusal{Code: "INTERNAL", Text: err.Error()})
				}
			}
			if raw == nil {
				c.stop()
				return c.record(&Refusal{Code: "INTERNAL", Text: "empty response"})
			}
		case <-ctx.Done():
			c.stop()
			if !writeFinished {
				<-written
			}
			return c.record(&Refusal{Code: "TIMEOUT", Text: ctx.Err().Error()})
		case <-c.exited:
			c.stop()
			if !writeFinished {
				<-written
			}
			return c.record(&Refusal{Code: "INTERNAL", Text: "sidecar exited without a response"})
		}
	}
	if raw == nil {
		c.stop()
		return c.record(&Refusal{Code: "INTERNAL", Text: "sidecar closed its response stream"})
	}
	select {
	default:
	case <-ctx.Done():
		c.stop()
		return c.record(&Refusal{Code: "TIMEOUT", Text: ctx.Err().Error()})
	}
	var envelope struct {
		ID    *uint64  `json:"id"`
		Error *Refusal `json:"error"`
	}
	err := json.Unmarshal(raw, &envelope)
	if err != nil || envelope.ID == nil || *envelope.ID != id {
		c.stop()
		return c.record(&Refusal{Code: "INTERNAL", Text: "invalid response id or envelope"})
	}
	if envelope.Error != nil {
		return c.record(envelope.Error)
	}
	if err = json.Unmarshal(raw, target); err != nil {
		var refusal *Refusal
		if errors.As(err, &refusal) {
			c.stop()
			return c.record(refusal)
		}
		c.stop()
		return c.record(&Refusal{Code: "INTERNAL", Text: err.Error()})
	}
	return nil
}

func (c *Client) reap() error {
	if c.cmd == nil {
		return nil
	}
	<-c.exited
	err := <-c.waited
	c.cmd, c.stdin = nil, nil
	c.answers, c.exited, c.dead, c.waited = nil, nil, nil, nil
	return err
}

func (c *Client) stop() {
	if c.cmd == nil {
		return
	}
	killProcess(c.cmd)
	c.stdin.Close()
	<-c.exited
	err := <-c.waited
	if err != nil {
		c.record(&Refusal{Code: "INTERNAL", Text: "sidecar wait: " + err.Error()})
	}
	c.cmd = nil
	c.stdin = nil
	c.answers, c.exited, c.dead, c.waited = nil, nil, nil, nil
	c.retryAt = c.now().Add(c.options.RestartBackoff)
}
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.stop()
	c.closed = true
	return nil
}
