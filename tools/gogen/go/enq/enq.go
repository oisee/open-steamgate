// Package enq is the lock server (ENQ E1): the table that ENQUEUE_<object>,
// DEQUEUE_<object>, DEQUEUE_ALL and ENQUEUE_READ work on, as measured on a
// system and written down in docs/enq-contract.md (the fixtures are
// test/fixtures/enq/contract.json).
//
// One goroutine owns the table; every request is a function it runs, sent
// over a channel, so there is no mutex and no request sees another half
// done. Waiting (_WAIT) happens in the caller, between requests, so a
// waiting session never holds the server.
//
// The owner model is the measured one. A session has two owners: the dialog
// owner (GUSR), which holds _SCOPE 1 and lives as long as the session, and
// the update owner (GUSRVB), which holds _SCOPE 2 and belongs to the SAP
// LUW. _SCOPE 3 is one row carrying both. ROLLBACK WORK releases the update
// halves and starts a new update owner; COMMIT WORK starts a new one only
// when it ran an update, and the update halves go when that update has run
// (UpdateDone), not at the COMMIT. A COMMIT with nothing to update releases
// nothing. The end of a session releases everything.
package enq

import (
	"fmt"
	"strings"
	"time"
)

// Field is one key field of a lock argument. A generic field (an initial
// value without X_<field>) matches every value.
type Field struct {
	Value   string
	Generic bool
	Length  int
}

// Request is one ENQUEUE or DEQUEUE.
type Request struct {
	Client string
	Table  string // GNAME
	Object string // the lock object (GOBJ)
	Fields []Field
	Mode   string // E, S, X or O
	Scope  int    // 1, 2 (the default) or 3
}

// Result of an ENQUEUE: Subrc 0, or 1 = FOREIGN_LOCK with message MC Msgno
// (601: another owner holds it, 602: the caller's own lock refuses it) and
// Holder the user of the lock in the way (sy-msgv1).
type Result struct {
	Subrc  int
	Msgno  string
	Holder string
}

// Row is one row of ENQUEUE_READ.
type Row struct {
	Client, Table, Object, Arg, Mode, User string
	Dialog, Update                         string // GUSR, GUSRVB; "" = none
	Dialogs, Updates                       int    // GUSE, GUSEVB
	Taken                                  time.Time
	Session                                int64 // the session the row belongs to
}

// Filter of ENQUEUE_READ: an empty field matches every row.
type Filter struct {
	Client, Table, User string
}

type row struct {
	Row
	session int64
	fields  []Field
}

type session struct {
	user           string
	dialog, update string
}

type state struct {
	rows     []*row
	sessions map[int64]*session
	seq      int64
	instance string
	now      func() time.Time
}

// Server is a running lock server.
type Server struct {
	reqs chan func(*state)
}

// New starts a lock server. instance names the server in owner ids, as an
// application server's instance name does on a system.
func New(instance string) *Server {
	srv := &Server{reqs: make(chan func(*state))}
	st := &state{sessions: map[int64]*session{}, instance: instance, now: time.Now}
	go func() {
		for f := range srv.reqs {
			f(st)
		}
	}()
	return srv
}

// do runs f on the server's goroutine and waits for it
func (srv *Server) do(f func(*state)) {
	done := make(chan struct{})
	srv.reqs <- func(st *state) { f(st); close(done) }
	<-done
}

// Close stops the server.
func (srv *Server) Close() { close(srv.reqs) }

// ownerID is 58 characters like a system's: a timestamp, a sequence and the
// instance, padded with dots. It is compared, never parsed.
func (st *state) ownerID() string {
	st.seq++
	id := fmt.Sprintf("%s%06d%s", st.now().UTC().Format("20060102150405.000000"), st.seq%1000000, st.instance)
	id = strings.ReplaceAll(id, ".", "")
	if len(id) > 58 {
		id = id[:58]
	}
	return id + strings.Repeat(".", 58-len(id))
}

// Open starts a session of user and returns its handle.
func (srv *Server) Open(user string) (id int64) {
	srv.do(func(st *state) {
		st.seq++
		id = st.seq
		st.sessions[id] = &session{user: user, dialog: st.ownerID(), update: st.ownerID()}
	})
	return id
}

// garg is the argument as ENQUEUE_READ shows it: the client and each field
// at its length, U+FFFF in every position of a generic field
func garg(client string, fields []Field) string {
	var b strings.Builder
	b.WriteString(client)
	for _, f := range fields {
		if f.Generic {
			b.WriteString(strings.Repeat("￿", f.Length))
			continue
		}
		v := f.Value
		if n := len([]rune(v)); n < f.Length {
			v += strings.Repeat(" ", f.Length-n)
		}
		b.WriteString(v)
	}
	return strings.TrimRight(b.String(), " ")
}

// collide says whether two arguments of one table touch a common key
func collide(a, b []Field) bool {
	if len(a) != len(b) {
		return true
	}
	for i := range a {
		if a[i].Generic || b[i].Generic {
			continue
		}
		if strings.TrimRight(a[i].Value, " ") != strings.TrimRight(b[i].Value, " ") {
			return false
		}
	}
	return true
}

func shared(mode string) bool { return mode == "S" || mode == "O" }

func scopeOf(r Request) int {
	if r.Scope == 0 {
		return 2
	}
	return r.Scope
}

func (st *state) enqueue(sid int64, r Request) Result {
	s := st.sessions[sid]
	if s == nil {
		return Result{Subrc: 2}
	}
	// another owner first: E and X refuse everything, S and O share
	for _, w := range st.rows {
		if w.session == sid || w.Client != r.Client || w.Table != r.Table || !collide(w.fields, r.Fields) {
			continue
		}
		if !shared(w.Mode) || !shared(r.Mode) {
			return Result{Subrc: 1, Msgno: "601", Holder: w.User}
		}
	}
	// the caller's own locks: anything with X is refused, the rest stacks
	arg := garg(r.Client, r.Fields)
	var same *row
	for _, w := range st.rows {
		if w.session != sid || w.Client != r.Client || w.Table != r.Table || !collide(w.fields, r.Fields) {
			continue
		}
		if w.Mode == "X" || r.Mode == "X" {
			return Result{Subrc: 1, Msgno: "602", Holder: w.User}
		}
		if w.Arg == arg && w.Mode == r.Mode && w.Object == r.Object && (w.Updates == 0 || w.Update == s.update) {
			same = w
		}
	}
	if same == nil {
		same = &row{Row: Row{Client: r.Client, Table: r.Table, Object: r.Object, Arg: arg, Mode: r.Mode, User: s.user, Taken: st.now(), Session: sid},
			session: sid, fields: append([]Field(nil), r.Fields...)}
		st.rows = append(st.rows, same)
	}
	scope := scopeOf(r)
	if scope == 1 || scope == 3 {
		same.Dialogs++
		same.Dialog = s.dialog
	}
	if scope == 2 || scope == 3 {
		same.Updates++
		same.Update = s.update
	}
	return Result{}
}

// Enqueue takes a lock for the session. With wait, a refusal is retried
// once a second for five seconds before it is answered (measured: a lock
// that stays held fails after about 4.7 s, one released after about 1 s is
// granted after about 1.0 s; the interval itself was not measured).
func (srv *Server) Enqueue(sid int64, r Request, wait bool) Result {
	return srv.enqueueWith(sid, r, wait, time.Sleep)
}

const (
	waitInterval = time.Second
	waitTries    = 5
)

func (srv *Server) enqueueWith(sid int64, r Request, wait bool, sleep func(time.Duration)) (res Result) {
	for try := 0; ; try++ {
		srv.do(func(st *state) { res = st.enqueue(sid, r) })
		if res.Subrc != 1 || !wait || try >= waitTries {
			return res
		}
		sleep(waitInterval)
	}
}

// Dequeue releases one count of a lock the session holds with exactly this
// argument, mode and scope; anything else is a silent no-op, as on a system.
func (srv *Server) Dequeue(sid int64, r Request) {
	srv.do(func(st *state) {
		s := st.sessions[sid]
		if s == nil {
			return
		}
		arg := garg(r.Client, r.Fields)
		scope := scopeOf(r)
		for _, w := range st.rows {
			if w.session != sid || w.Client != r.Client || w.Table != r.Table || w.Arg != arg || w.Mode != r.Mode {
				continue
			}
			if (scope == 1 || scope == 3) && w.Dialogs > 0 {
				w.Dialogs--
			}
			if (scope == 2 || scope == 3) && w.Updates > 0 && w.Update == s.update {
				w.Updates--
			}
			break
		}
		st.sweep()
	})
}

// sweep drops the rows no half holds any more and blanks a released half
func (st *state) sweep() {
	kept := st.rows[:0]
	for _, w := range st.rows {
		if w.Dialogs == 0 {
			w.Dialog = ""
		}
		if w.Updates == 0 {
			w.Update = ""
		}
		if w.Dialogs > 0 || w.Updates > 0 {
			kept = append(kept, w)
		}
	}
	st.rows = kept
}

// DequeueAll releases every lock of the session, in every scope.
func (srv *Server) DequeueAll(sid int64) {
	srv.do(func(st *state) { st.release(sid) })
}

func (st *state) release(sid int64) {
	for _, w := range st.rows {
		if w.session == sid {
			w.Dialogs, w.Updates = 0, 0
		}
	}
	st.sweep()
}

// Rollback is ROLLBACK WORK: the update halves go and a new update owner
// starts.
func (srv *Server) Rollback(sid int64) {
	srv.do(func(st *state) {
		s := st.sessions[sid]
		if s == nil {
			return
		}
		st.releaseUpdate(sid, s.update)
		s.update = st.ownerID()
	})
}

func (st *state) releaseUpdate(sid int64, owner string) {
	for _, w := range st.rows {
		if w.session == sid && w.Update == owner {
			w.Updates = 0
		}
	}
	st.sweep()
}

// Commit is COMMIT WORK. With nothing in the update task it releases
// nothing and keeps the update owner (measured). With an update it starts a
// new update owner and returns the one that ended: its locks go when the
// update has run, which the host says with UpdateDone (COMMIT WORK AND WAIT
// says it before it returns).
func (srv *Server) Commit(sid int64, updated bool) (ended string) {
	srv.do(func(st *state) {
		s := st.sessions[sid]
		if s == nil || !updated {
			return
		}
		ended = s.update
		s.update = st.ownerID()
	})
	return ended
}

// UpdateDone releases the locks of an update owner Commit ended.
func (srv *Server) UpdateDone(sid int64, owner string) {
	if owner == "" {
		return
	}
	srv.do(func(st *state) { st.releaseUpdate(sid, owner) })
}

// End ends the session: all its locks go.
func (srv *Server) End(sid int64) {
	srv.do(func(st *state) {
		st.release(sid)
		delete(st.sessions, sid)
	})
}

// UpdateOwner is the session's current update owner id (GUSRVB of its next
// _SCOPE 2 lock).
func (srv *Server) UpdateOwner(sid int64) (id string) {
	srv.do(func(st *state) {
		if s := st.sessions[sid]; s != nil {
			id = s.update
		}
	})
	return id
}

// Read is ENQUEUE_READ.
func (srv *Server) Read(f Filter) (rows []Row) {
	srv.do(func(st *state) {
		for _, w := range st.rows {
			if (f.Client == "" || f.Client == w.Client) && (f.Table == "" || f.Table == w.Table) && (f.User == "" || f.User == w.User) {
				rows = append(rows, w.Row)
			}
		}
	})
	return rows
}
