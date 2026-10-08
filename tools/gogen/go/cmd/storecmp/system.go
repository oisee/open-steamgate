package main

import (
	"encoding/json"
	"osg/gogen/adtsystem"
	"osg/gogen/objstore"
	"strings"
)

// Synthetic session for protocol parity; the conformance runner exercises
// the real generated session and ENQ server behind the HTTP front.
type systemSession struct {
	ID       string `json:"id"`
	Stateful bool   `json:"stateful"`
	Live     bool   `json:"live"`
	handles  map[string][2]string
}

func (s *systemSession) View() (string, bool) { return s.ID, s.Stateful }
func (s *systemSession) Alive(string) bool    { return s.Live }
func (s *systemSession) Adopt(id, typ, name string) string {
	for h, o := range s.handles {
		if o == [2]string{typ, name} {
			return h
		}
	}
	handle := strings.Repeat("a", 40)
	s.handles[handle] = [2]string{typ, name}
	return handle
}
func (s *systemSession) Forget(id, handle string) (string, string) {
	o := s.handles[handle]
	delete(s.handles, handle)
	return o[0], o[1]
}
func (s *systemSession) Holder(typ, name string) (string, bool) {
	for _, o := range s.handles {
		if o == [2]string{typ, name} {
			return s.ID, true
		}
	}
	return "", false
}
func systemProvider(input string) objstore.SystemProvider {
	if input == "" {
		return nil
	}
	s := new(systemSession)
	if err := json.Unmarshal([]byte(input), s); err != nil {
		panic(err)
	}
	s.handles = map[string][2]string{}
	return adtsystem.Provider{Sessions: s, Holders: s}
}
