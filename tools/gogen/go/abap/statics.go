package abap

// Factories are registered only during package initialization, before sessions run.
var staticsFactories []func() any

// RegisterStatics reserves a class slot. Generated packages call it during init.
func RegisterStatics(newFn func() any) int {
	slot := len(staticsFactories)
	staticsFactories = append(staticsFactories, newFn)
	return slot
}

// Statics returns this session's stable class storage, creating it on first use.
// After initialization the lookup allocates nothing. The Session has one user
// at a time, so neither the slot store nor its contents need locks.
func (s *Session) Statics(slot int) any {
	var value any
	if slot < len(s.statics) {
		value = s.statics[slot]
	}
	if value == nil {
		value = s.newStatics(slot)
	}
	return value
}

func (s *Session) newStatics(slot int) any {
	if slot >= len(s.statics) {
		s.statics = append(s.statics, make([]any, len(staticsFactories)-len(s.statics))...)
	}
	value := staticsFactories[slot]()
	s.statics[slot] = value
	return value
}
