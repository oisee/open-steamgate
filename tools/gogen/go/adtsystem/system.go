// Package adtsystem answers request-bound ADT SYSTEM facts without ABAP types.
package adtsystem

import (
	"errors"
	"osg/gogen/objstore"
	"strings"
	"sync"
)

// Sessions projects the bound ABAP session and its persistent handle rows.
type Sessions interface {
	View() (id string, stateful bool)
	Alive(id string) bool
	Adopt(id, typ, name string) string
	Forget(id, handle string) (typ, name string)
}

// Holders returns the ENQ holder key; foreign holders use an opaque key.
type Holders interface {
	Holder(typ, name string) (key string, found bool)
}
type Provider struct {
	Sessions Sessions
	Holders  Holders
	Identity objstore.Identity
}

func (p Provider) System(kind, name, input string) (any, error) {
	id, stateful := p.Sessions.View()
	typ, object, _ := strings.Cut(name, " ")
	switch kind {
	case "IDENTITY":
		return p.Identity, nil
	case "SESSION":
		if id != "" {
			return map[string]bool{"stateful": stateful}, nil
		}
	case "LOCK_HANDLE":
		if id != "" {
			if !p.Sessions.Alive(id) {
				return nil, errors.New("ADT session ended")
			}
			return map[string]string{"handle": p.Sessions.Adopt(id, typ, object)}, nil
		}
	case "LOCK_RELEASE":
		if id != "" {
			typ, object = p.Sessions.Forget(id, name)
			if typ == "" {
				return map[string]string{}, nil
			}
			return struct {
				Type string `json:"type"`
				Name string `json:"name"`
			}{typ, object}, nil
		}
	case "LOCK_HOLDER":
		key, found := p.Holders.Holder(typ, object)
		return map[string]bool{"alive": found && p.Sessions.Alive(key)}, nil
	}
	return nil, nil
}

// Bindings is owned by a host. A parked step keeps its own provider even if
// another step binds or finishes. Nothing tracks a process-wide current call.
type Bindings struct{ providers sync.Map }

func (b *Bindings) Bind(step any, p objstore.SystemProvider) func() {
	b.providers.Store(step, p)
	return func() { b.providers.Delete(step) }
}
func (b *Bindings) For(step any) objstore.SystemProvider {
	p, _ := b.providers.Load(step)
	if p == nil {
		return nil
	}
	return p.(objstore.SystemProvider)
}
