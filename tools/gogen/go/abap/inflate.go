package abap

import "osg/gogen/inflate"

// InflateHostOpen opens a resumable DEFLATE stream for this session.
func InflateHostOpen(s *Session) int32 {
	if s.inflate == nil {
		s.inflate = &inflate.Registry{}
	}
	return s.inflate.Open()
}

// InflateHostFeed forwards the host call into this session's registry.
func InflateHostFeed(s *Session, handle int32, data string, maxOut int32, raw *string, state *int32, unused *string, reason *string) {
	if s.inflate == nil {
		s.inflate = &inflate.Registry{}
	}
	*raw, *state, *unused, *reason = s.inflate.Feed(handle, data, maxOut)
}
