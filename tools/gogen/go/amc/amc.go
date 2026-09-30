// Package amc is ABAP Messaging Channels for the Go host: a broker in one
// process, the Go counterpart of tools/osd-amc.mjs (docs/abap-daemons.md).
//
// It depends on nothing generated and nothing in go/abap. A session is an
// opaque key (the generated code passes its *abap.Session), a receiver is
// whatever the generated code subscribed with, and a message is delivered
// back through the Deliver func the caller of Wait hands over, so the
// receiver runs in the ABAP session's own goroutine, never in the broker's.
//
// The semantics are ABAP's (docs/abap-daemons.md, the measured P-cases):
// SEND publishes at once, outside the database LUW, and never blocks or
// fails for a slow receiver; messages of one producer arrive in the order
// they were sent, and there is no order across producers; a producer with
// suppress-echo does not reach its own session; scope C delivers within the
// client, U within the client and user; a channel extension is part of the
// address. The SAMC definitions decide which program may send (activity S)
// and receive (R) on which channel.
//
// Each session has one inbox: a slice behind a mutex, with no bound, and a
// notify channel of capacity 1. Publish appends under the broker's lock and
// signals without blocking; WAIT drains the inbox and selects on the signal
// and its deadline. There is no overflow policy because ABAP has none: a
// SEND is never refused or delayed for its receivers, so the queue is bounded
// by memory only.
package amc

import (
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Channel is one AMC_CHANNEL of an SAMC object and the authorities of its
// application.
type Channel struct {
	App   string // APPLICATION_ID, upper case
	Path  string // CHANNEL_ID, lower case
	Type  string // TEXT, BINARY or PCP
	Scope string // S (system), C (client) or U (user)
	Auth  []Authority
}

// Authority is one AMC_CHNL_AUTH row: a program (the class pool's name,
// ZCL_X==...==CP) that may send (S) or receive (R) on a channel.
type Authority struct {
	Path, Program, Activity string
}

// Message is one publication.
type Message struct {
	Type     string // TEXT, BINARY or PCP
	Payload  any    // string, the bytes of an xstring, a PCP object
	Client   string // the producer's sy-mandt
	Username string // the producer's sy-uname
}

// Endpoint is who is sending or receiving: the ABAP session, the program the
// SAMC authorities name, and the client and user the scope compares.
type Endpoint struct {
	Session  any
	Program  string
	Client   string
	Username string
}

type key struct{ app, path string }

func keyOf(app, path string) key {
	return key{strings.ToUpper(strings.TrimSpace(app)), strings.ToLower(strings.TrimSpace(path))}
}

// ProgramOf is the name the SAMC authorities use for a class: its class pool.
func ProgramOf(class string) string {
	c := strings.ToUpper(strings.TrimSpace(class))
	if len(c) < 30 {
		c += strings.Repeat("=", 30-len(c))
	}
	return c + "CP"
}

// Broker holds the channels, the subscriptions and the sessions' inboxes.
type Broker struct {
	mu       sync.Mutex
	channels map[key]*Channel
	subs     map[*Subscription]struct{}
	inboxes  map[any]*inbox
	ids      map[any]string
	nextID   int
}

// New is an empty broker with these channels.
func New(channels ...Channel) *Broker {
	b := &Broker{subs: map[*Subscription]struct{}{}, inboxes: map[any]*inbox{}, ids: map[any]string{}}
	b.Define(channels...)
	return b
}

var current atomic.Pointer[Broker]

// Current is the broker of this process, made on first use. It is the one
// accessor: a later context per test class swaps it with Use.
func Current() *Broker {
	if b := current.Load(); b != nil {
		return b
	}
	current.CompareAndSwap(nil, New())
	return current.Load()
}

// Use installs b as the current broker and returns the one it replaced.
func Use(b *Broker) *Broker { return current.Swap(b) }

// Define adds channel definitions; a later definition of the same address
// replaces the earlier one.
func (b *Broker) Define(channels ...Channel) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.channels == nil {
		b.channels = map[key]*Channel{}
	}
	for i := range channels {
		c := channels[i]
		c.App, c.Path, c.Type = strings.ToUpper(c.App), strings.ToLower(c.Path), strings.ToUpper(c.Type)
		b.channels[keyOf(c.App, c.Path)] = &c
	}
}

// ErrNotDefined, ErrNotAuthorised and ErrType are the refusals; the text is
// what CX_AMC_ERROR says (tools/osd-amc.mjs gives the same).
var (
	ErrNotDefined    = errors.New("not defined")
	ErrNotAuthorised = errors.New("not authorised")
	ErrType          = errors.New("wrong message type")
)

func (b *Broker) channel(app, path, activity, program string) (*Channel, error) {
	c := b.channels[keyOf(app, path)]
	if c == nil {
		return nil, &Error{Reason: "AMC channel " + strings.TrimSpace(app) + " " + strings.TrimSpace(path) + " is not defined.", Kind: ErrNotDefined}
	}
	for _, a := range c.Auth {
		if strings.ToLower(a.Path) == c.Path && a.Activity == activity && strings.EqualFold(a.Program, program) {
			return c, nil
		}
	}
	verb := "receive"
	if activity == "S" {
		verb = "send"
	}
	who := program
	if who == "" {
		who = "unknown program"
	}
	return nil, &Error{Reason: "AMC " + verb + " is not authorised for " + who + ".", Kind: ErrNotAuthorised}
}

// Error is a refusal with the text CX_AMC_ERROR carries.
type Error struct {
	Reason string
	Kind   error
}

func (e *Error) Error() string { return e.Reason }
func (e *Error) Unwrap() error { return e.Kind }

// Subscription is one START_MESSAGE_DELIVERY: a receiver on a channel for a
// session. Stop ends it; messages already queued for it are dropped.
type Subscription struct {
	b         *Broker
	channel   *Channel
	extension string
	at        Endpoint
	Receiver  any
	active    atomic.Bool
}

// Subscribe checks that at.Program may receive on the channel and starts
// delivery to receiver in at.Session.
func (b *Broker) Subscribe(app, path, extension string, at Endpoint, receiver any) (*Subscription, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	c, err := b.channel(app, path, "R", at.Program)
	if err != nil {
		return nil, err
	}
	s := &Subscription{b: b, channel: c, extension: extension, at: at, Receiver: receiver}
	s.active.Store(true)
	b.subs[s] = struct{}{}
	b.inboxOf(at.Session)
	return s, nil
}

// Stop ends the subscription.
func (s *Subscription) Stop() {
	if s == nil {
		return
	}
	s.active.Store(false)
	s.b.mu.Lock()
	delete(s.b.subs, s)
	s.b.mu.Unlock()
}

// Check is what CREATE_MESSAGE_PRODUCER checks before a SEND: that the
// channel exists and at.Program may send on it.
func (b *Broker) Check(app, path, activity string, at Endpoint) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	_, err := b.channel(app, path, activity, at.Program)
	return err
}

// Publish is SEND: the message is queued for every matching subscription at
// once and the sender goes on; it never waits for a receiver.
func (b *Broker) Publish(app, path, extension string, from Endpoint, suppressEcho bool, m Message) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	c, err := b.channel(app, path, "S", from.Program)
	if err != nil {
		return err
	}
	if c.Type != strings.ToUpper(m.Type) {
		return &Error{Reason: "AMC channel " + c.Path + " expects " + c.Type + ", got " + strings.ToUpper(m.Type) + ".", Kind: ErrType}
	}
	m.Client, m.Username = from.Client, from.Username
	for s := range b.subs {
		if !s.active.Load() || s.channel != c || s.extension != extension {
			continue
		}
		if (c.Scope == "C" || c.Scope == "U") && s.at.Client != from.Client {
			continue
		}
		if c.Scope == "U" && s.at.Username != from.Username {
			continue
		}
		if suppressEcho && s.at.Session == from.Session {
			continue
		}
		b.inboxOf(s.at.Session).put(delivery{sub: s, msg: m})
	}
	return nil
}

// SessionID is GET_CONSUMER_SESSION_ID: stable for a session.
func (b *Broker) SessionID(session any) string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if id, ok := b.ids[session]; ok {
		return id
	}
	b.nextID++
	id := "osd-amc-go-" + itoa(b.nextID)
	b.ids[session] = id
	return id
}

// Forget drops what the broker holds for a session that has ended.
func (b *Broker) Forget(session any) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for s := range b.subs {
		if s.at.Session == session {
			s.active.Store(false)
			delete(b.subs, s)
		}
	}
	delete(b.inboxes, session)
	delete(b.ids, session)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var d []byte
	for ; n > 0; n /= 10 {
		d = append([]byte{byte('0' + n%10)}, d...)
	}
	return string(d)
}

// ---- the session's inbox ----

type delivery struct {
	sub *Subscription
	msg Message
}

type inbox struct {
	mu     sync.Mutex
	queue  []delivery
	notify chan struct{}
}

// called with the broker's lock held
func (b *Broker) inboxOf(session any) *inbox {
	in := b.inboxes[session]
	if in == nil {
		in = &inbox{notify: make(chan struct{}, 1)}
		b.inboxes[session] = in
	}
	return in
}

func (in *inbox) put(d delivery) {
	in.mu.Lock()
	in.queue = append(in.queue, d)
	in.mu.Unlock()
	select {
	case in.notify <- struct{}{}:
	default:
	}
}

func (in *inbox) take() []delivery {
	in.mu.Lock()
	defer in.mu.Unlock()
	q := in.queue
	in.queue = nil
	return q
}

// Deliver runs a receiver: the generated code's adapter, which calls the
// receiver's RECEIVE for the message's type in the session's goroutine.
type Deliver func(receiver any, m Message)

// Pump delivers what is queued for session now and reports whether anything
// was delivered. A subscription stopped after the message was queued is
// skipped.
func (b *Broker) Pump(session any, deliver Deliver) bool {
	b.mu.Lock()
	in := b.inboxOf(session)
	b.mu.Unlock()
	delivered := false
	for _, d := range in.take() {
		if !d.sub.active.Load() {
			continue
		}
		deliver(d.sub.Receiver, d.msg)
		delivered = true
	}
	return delivered
}

// Wait is WAIT FOR MESSAGING CHANNELS UNTIL cond UP TO timeout: it delivers
// in the caller's goroutine until cond holds (0) or the time is up (8). cond
// is checked after each round of deliveries, and once before waiting.
func (b *Broker) Wait(session any, cond func() bool, timeout time.Duration, deliver Deliver) int32 {
	b.mu.Lock()
	in := b.inboxOf(session)
	b.mu.Unlock()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		b.Pump(session, deliver)
		if cond() {
			return 0
		}
		select {
		case <-in.notify:
		case <-timer.C:
			b.Pump(session, deliver)
			if cond() {
				return 0
			}
			return 8
		}
	}
}
