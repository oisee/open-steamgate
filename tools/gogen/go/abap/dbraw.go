package abap

import "encoding/hex"

// DBXStr is a raw column read into an xstring: the transpiler's database
// holds the bytes as hex text (upper case), so the Go host reads the same
// rows the same way. Text that is not hex is not guessed at.
func DBXStr(v DBString) string {
	b, err := hex.DecodeString(v.String)
	if err != nil {
		panic(NotCompiled("SELECT", "a raw column that does not hold hex: "+err.Error()))
	}
	return string(b)
}

// DerefAs is ASSIGN ref->* TO <fs> for a field symbol typed with a
// structure: the value the reference points at, when it has that type.
// A reference to anything else is refused (NOT_COMPILED): a system checks
// compatibility by the ABAP type, which the Go host does not reproduce.
func DerefAs[T any](d Data, text string) *T {
	p, ok := d.P.(*T)
	if !ok {
		panic(NotCompiled(text, "the reference points at a value of another type"))
	}
	return p
}
