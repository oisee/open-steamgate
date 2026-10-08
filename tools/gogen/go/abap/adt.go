package abap

// ADTOneRuntime answers "" for now: no conformance case touches datapreview;
// it becomes "X" once the datapreview classes run on osgo.
func ADTOneRuntime(_ *Session, on *string) {
	*on = ""
}

// ADTUnavailable answers like Node's parent kernel / non-one-runtime case:
// neither seeded serving application tables nor generation is available.
func ADTUnavailable(_ *Session, available *string) {
	// Fixed CHAR values store trailing blanks implicitly in this runtime.
	*available = ""
}
