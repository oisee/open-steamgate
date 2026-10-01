package abap

// DerefAs is ASSIGN ref->* TO <fs> for a field symbol typed with a
// structure: the value the reference points at, when it has that type.
// A reference to anything else is refused (NOT_COMPILED): a system checks
// compatibility by the ABAP type, which the Go host does not reproduce.
func DerefAs[T any](d Data, text string) *T {
	d.Check()
	p, ok := d.P.(*T)
	if !ok {
		panic(NotCompiled(text, "the reference points at a value of another type"))
	}
	return p
}
