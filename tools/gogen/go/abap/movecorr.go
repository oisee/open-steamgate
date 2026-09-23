package abap

// MoveCorrespondingData is MOVE-CORRESPONDING src TO dst where one side (or
// both) is generic data: each component of dst that src has by name gets
// src's value converted as a move converts it. Flat components only; a
// structure or table component (whose MOVE-CORRESPONDING is recursive, or
// EXPANDING NESTED TABLES) is refused rather than moved as a whole.
func MoveCorrespondingData(dst, src Data) {
	if dst.P == nil {
		panic(notAssigned("MOVE-CORRESPONDING into a field symbol"))
	}
	if src.P == nil {
		panic(notAssigned("MOVE-CORRESPONDING from a field symbol"))
	}
	isStruct := func(t *Type) bool { return t != nil && (t.Kind == 'u' || t.Kind == 'v') }
	if !isStruct(dst.T) || !isStruct(src.T) {
		panic(NotCompiled("MOVE-CORRESPONDING", "generic data that is not a structure"))
	}
	deep := func(t *Type) bool { return t.Kind == 'u' || t.Kind == 'v' || t.Kind == 'h' }
	for _, dc := range dst.T.Comps {
		for _, sc := range src.T.Comps {
			if sc.Name != dc.Name {
				continue
			}
			if deep(dc.T) || deep(sc.T) {
				panic(NotCompiled("MOVE-CORRESPONDING", "a deep component "+dc.Name))
			}
			MoveData(Data{P: dc.Get(dst.P), T: dc.T}, Data{P: sc.Get(src.P), T: sc.T})
			break
		}
	}
}
