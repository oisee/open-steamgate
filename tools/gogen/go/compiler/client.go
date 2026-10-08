package compiler

import (
	"context"
	"encoding/json"
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
	Root, Version  string
	CheckTimeout   time.Duration
	RestartBackoff time.Duration
}
type Client struct {
	mu      sync.Mutex
	options Options
	status  Status
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	decoder *json.Decoder
	done    chan error
	nextID  uint64
	starts  int
	retryAt time.Time
	closed  bool
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
	return &Client{options: options, status: Status{Capabilities: []string{}}}
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
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, c.options.CheckTimeout)
	defer cancel()
	return c.ensure(ctx)
}

func (c *Client) Check(ctx context.Context, snapshot Snapshot) (CheckResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, c.options.CheckTimeout)
	defer cancel()
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
	if err := ctx.Err(); err != nil {
		return c.record(&Refusal{Code: "TIMEOUT", Text: err.Error()})
	}
	if c.cmd != nil {
		return nil
	}
	if delay := time.Until(c.retryAt); delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-timer.C:
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
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return c.record(err)
	}
	// Tool logs must never be confused with NDJSON responses.
	cmd.Stderr = os.Stderr
	if err = cmd.Start(); err != nil {
		stdin.Close()
		stdout.Close()
		return c.record(&Refusal{Code: "INTERNAL", Text: err.Error()})
	}
	c.cmd, c.stdin, c.decoder = cmd, stdin, json.NewDecoder(stdout)
	c.done = make(chan error, 1)
	go func() { c.done <- cmd.Wait() }()
	if c.starts > 0 {
		c.status.Restarts++
	}
	c.starts++
	var hello struct {
		Contract     int      `json:"contract"`
		OSD          string   `json:"osd"`
		Transpiler   string   `json:"transpiler"`
		Capabilities []string `json:"capabilities"`
		Limits       Limits   `json:"limits"`
	}
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
	return nil
}

func (c *Client) exchange(ctx context.Context, id uint64, request any, target any) error {
	// Both writes and reads are subject to the deadline, including a blocked pipe.
	type answer struct {
		raw json.RawMessage
		err error
	}
	answers := make(chan answer, 1)
	stdin, decoder := c.stdin, c.decoder
	go func() {
		err := json.NewEncoder(stdin).Encode(request)
		var raw json.RawMessage
		if err == nil {
			err = decoder.Decode(&raw)
		}
		answers <- answer{raw, err}
	}()
	select {
	case <-ctx.Done():
		c.stop()
		<-answers
		return c.record(&Refusal{Code: "TIMEOUT", Text: ctx.Err().Error()})
	case reply := <-answers:
		if reply.err != nil {
			c.stop()
			return c.record(&Refusal{Code: "INTERNAL", Text: reply.err.Error()})
		}
		var envelope struct {
			ID    *uint64  `json:"id"`
			Error *Refusal `json:"error"`
		}
		err := json.Unmarshal(reply.raw, &envelope)
		if err != nil || envelope.ID == nil || *envelope.ID != id {
			c.stop()
			return c.record(&Refusal{Code: "INTERNAL", Text: "invalid response id or envelope"})
		}
		if envelope.Error != nil {
			return c.record(envelope.Error)
		}
		if err = json.Unmarshal(reply.raw, target); err != nil {
			c.stop()
			return c.record(&Refusal{Code: "INTERNAL", Text: err.Error()})
		}
		return nil
	}
}
func (c *Client) stop() {
	if c.cmd == nil {
		return
	}
	killProcess(c.cmd)
	c.stdin.Close()
	<-c.done
	c.cmd = nil
	c.retryAt = time.Now().Add(c.options.RestartBackoff)
}
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.stop()
	c.closed = true
	return nil
}
