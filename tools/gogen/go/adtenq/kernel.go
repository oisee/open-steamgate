package adtenq

import (
	"container/list"
	"errors"
	"strings"
	"sync"

	"osg/gogen/enq"
)

const endedKeep = 10000

// Kernel maps ADT keys to lock-server handles. Use one per host/server;
// callers keep request-local handles rather than a global current session.
type Kernel struct {
	mu       sync.Mutex
	server   *enq.Server
	owner    Owner
	sessions map[string]int64
	ended    map[string]*list.Element
	order    *list.List
}

// New uses the process's shared owner, like Node's adtEnqOwner singleton.
func New(server *enq.Server) *Kernel {
	return &Kernel{server: server, owner: processOwner, sessions: make(map[string]int64),
		ended: make(map[string]*list.Element), order: list.New()}
}

// Owner is the identity to use when translating lock holders to ADT ids.
func (k *Kernel) Owner() Owner { return k.owner }

// text mirrors osd-enq-session's String(...).trimEnd(), including ECMAScript
// whitespace (U+FEFF is whitespace, U+0085 is not). Leading spaces survive.
func text(s string) string {
	return strings.TrimRightFunc(s, func(r rune) bool {
		return r >= '\t' && r <= '\r' || r == ' ' || r == '\u00a0' || r == '\u1680' ||
			r >= '\u2000' && r <= '\u200a' || r == '\u2028' || r == '\u2029' ||
			r == '\u202f' || r == '\u205f' || r == '\u3000' || r == '\ufeff'
	})
}

// Bind opens or reuses id's context. Only a host-ended key answers false,
// nil (Node's EnqSessionEnded); other failures remain errors for the seam
// adapter to translate into a generated ZCX_OSD_ADT exception.
func (k *Kernel) Bind(id, user string) (bool, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	key := k.owner.Key(text(id))
	if k.ended[key] != nil {
		return false, nil
	}
	if k.sessions[key] != 0 {
		return true, nil
	}
	if k.server == nil {
		return false, errors.New("ADT ENQ: no lock server")
	}
	sid := k.server.Open(text(user))
	if sid == 0 {
		return false, errors.New("ADT ENQ: lock server is closed")
	}
	k.sessions[key] = sid
	return true, nil
}

// End releases the context and remembers the key even if it never bound.
// Repeated ends refresh its position in Node's bounded ended-key ledger.
func (k *Kernel) End(id string) {
	k.mu.Lock()
	defer k.mu.Unlock()
	key := k.owner.Key(text(id))
	if old := k.ended[key]; old != nil {
		k.order.Remove(old)
	}
	k.ended[key] = k.order.PushBack(key)
	if k.order.Len() > endedKeep {
		oldest := k.order.Front()
		delete(k.ended, oldest.Value.(string))
		k.order.Remove(oldest)
	}
	k.drop(key)
}

// Revive permits the next bind; it opens no context and restores no locks.
func (k *Kernel) Revive(id string) {
	k.mu.Lock()
	defer k.mu.Unlock()
	key := k.owner.Key(text(id))
	if old := k.ended[key]; old != nil {
		k.order.Remove(old)
		delete(k.ended, key)
	}
}

// ContextAlive mirrors Node's !isEnded(key) && sessions.has(key). A context
// with no locks is alive; Revive alone does not make it alive.
func (k *Kernel) ContextAlive(id string) bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	key := k.owner.Key(text(id))
	return k.ended[key] == nil && k.sessions[key] != 0
}

func (k *Kernel) Owns(id string) bool        { return k.owner.Owns(text(id)) }
func (k *Kernel) SessionID(id string) string { return k.owner.IDOf(text(id)) }

// Handle returns an existing context for request-local ENQUEUE/COMMIT/etc.
// It opens nothing; after End an old handle is rejected by the ENQ server.
func (k *Kernel) Handle(id string) (int64, bool) {
	k.mu.Lock()
	defer k.mu.Unlock()
	sid := k.sessions[k.owner.Key(text(id))]
	return sid, sid != 0
}

// DropContext is the host's dump cleanup, unlike logoff: the key may bind
// again without Revive. The host must call it after its last pinned step exits.
func (k *Kernel) DropContext(id string) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.drop(k.owner.Key(text(id)))
}

func (k *Kernel) drop(key string) {
	if sid := k.sessions[key]; sid != 0 {
		delete(k.sessions, key)
		k.server.End(sid)
	}
}
