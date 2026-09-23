package abap

// A move into generic data: the target is a binding, so the value is
// converted to the type of the slot it is bound to and written there, never
// rebound (ABAP: <fs> = 5 writes into what <fs> points to). The pairs are
// the conversions the typed code already has; any other dumps NOT_COMPILED
// rather than guess.

func notAssigned(op string) ArithmeticError {
	return ArithmeticError{"GETWA_NOT_ASSIGNED", op}
}

// MoveData is dst = src for a generic dst.
func MoveData(dst, src Data) {
	if dst.P == nil {
		panic(notAssigned("move into a field symbol"))
	}
	if src.P == nil {
		panic(notAssigned("move from a field symbol"))
	}
	dk, sk := dst.T.Kind, src.T.Kind
	switch dk {
	case 'u', 'v', 'h':
		if dst.T == src.T && dst.T.Copy != nil {
			dst.T.Copy(dst.P, src.P)
			return
		}
	case 'I':
		p := dst.P.(*int32)
		switch sk {
		case 'I':
			*p = *src.P.(*int32)
			return
		case 'F':
			*p = F2I(*src.P.(*float64))
			return
		case 'C', 'g':
			*p = ParseI(*src.P.(*string))
			return
		}
	case 'F':
		p := dst.P.(*float64)
		switch sk {
		case 'I':
			*p = float64(*src.P.(*int32))
			return
		case 'F':
			*p = *src.P.(*float64)
			return
		case 'C', 'g':
			*p = ParseF(*src.P.(*string))
			return
		}
	case '8':
		if sk == '8' {
			*dst.P.(*int64) = *src.P.(*int64)
			return
		}
	case 'g':
		p := dst.P.(*string)
		switch sk {
		case 'g', 'C':
			*p = *src.P.(*string)
			return
		case 'I':
			*p = IToString(*src.P.(*int32))
			return
		}
	case 'C':
		if sk == 'g' || sk == 'C' {
			*dst.P.(*string) = CFit(*src.P.(*string), dst.T.Len)
			return
		}
	case 'X':
		if sk == 'X' {
			*dst.P.(*string) = XFit(*src.P.(*string), dst.T.Len)
			return
		}
	case 'y', 'D', 'T', 'P':
		if sk == dk && (dk != 'P' || dst.T == src.T) {
			*dst.P.(*string) = *src.P.(*string)
			return
		}
	case 'l':
		if sk == 'l' {
			*dst.P.(*Data) = *src.P.(*Data)
			return
		}
	}
	panic(NotCompiled("move", "a value of type kind "+string(sk)+" into generic data of type kind "+string(dk)))
}

// ClearData is CLEAR of a generic value: the slot it is bound to becomes initial.
func ClearData(d Data) {
	if d.P == nil {
		panic(notAssigned("CLEAR of a field symbol"))
	}
	switch d.T.Kind {
	case 'I':
		*d.P.(*int32) = 0
	case '8':
		*d.P.(*int64) = 0
	case 'F':
		*d.P.(*float64) = 0
	case 'g', 'y', 'C':
		*d.P.(*string) = ""
	case 'D':
		*d.P.(*string) = "00000000"
	case 'T':
		*d.P.(*string) = "000000"
	case 'P':
		*d.P.(*string) = "0"
	case 'X':
		b := make([]byte, d.T.Len)
		*d.P.(*string) = string(b)
	case 'l':
		*d.P.(*Data) = Data{}
	case 'u', 'v', 'h':
		if d.T.Zero != nil {
			d.T.Zero(d.P)
			return
		}
		panic(NotCompiled("CLEAR", "generic data of a type without a generated descriptor"))
	default:
		panic(NotCompiled("CLEAR", "generic data of type kind "+string(d.T.Kind)))
	}
}
