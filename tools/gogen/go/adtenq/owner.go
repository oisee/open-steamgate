// Package adtenq supplies the host side of ZCL_OSD_ENQ_KERNEL.
package adtenq

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

// Owner identifies one host. Its immutable prefix is shared by all of that
// host's ADT sessions, including holders reported by ENQUEUE_READ.
type Owner struct{ prefix string }

// NewOwner creates an independent host identity, like loading adt-enq-key.mjs
// in another process. Random-source failure is fatal; never reuse a prefix.
func NewOwner() Owner {
	var bytes [6]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		panic(err)
	}
	return Owner{prefix: "adt:" + hex.EncodeToString(bytes[:]) + ":"}
}

var processOwner = NewOwner()

// Prefix is adt:<12 lowercase hex digits>:.
func (o Owner) Prefix() string { return o.prefix }

// Key qualifies a bare id and leaves an already-owned key unchanged.
func (o Owner) Key(id string) string { return o.prefix + o.IDOf(id) }

// IDOf removes only this host's prefix; foreign keys remain opaque.
func (o Owner) IDOf(key string) string {
	if o.Owns(key) {
		return key[len(o.prefix):]
	}
	return key
}

// Owns tests the host prefix, not whether an id has a live session.
func (o Owner) Owns(key string) bool {
	return o.prefix != "" && strings.HasPrefix(key, o.prefix)
}
