package abap

import "strings"

// MESSAGE ... RAISING sets the session fields before raising. Classic's
// deferred handler assigns sy-subrc using the caller's EXCEPTIONS mapping.
func MessageRaise(s *Session, id, ty, no string, values []string, name, method string) {
	s.Sy.Msgid = CFit(strings.ToUpper(id), 20)
	s.Sy.Msgty = CFit(strings.ToUpper(ty), 1)
	s.Sy.Msgno = CToN(no, 3)
	dst := []*string{&s.Sy.Msgv1, &s.Sy.Msgv2, &s.Sy.Msgv3, &s.Sy.Msgv4}
	for i, p := range dst {
		*p = ""
		if i < len(values) {
			*p = CFit(values[i], 50)
		}
	}
	panic(ClassicException{Name: name, Method: method})
}
