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

// RAW(n) columns (ultra/zvdb, A4H 2026-09-24, $ZOSG_TMP_0300: probes
// ZCL_GOGEN_T_RAWRD, _RAWSEL, _RAWDYN over a table MANDT/ID/R RAW(4)).
//
// The store holds a RAW(n) value as upper-case hex text of exactly 2n
// digits, the transpiler's column (NCHAR(2n)) with the length HANA keeps: on
// A4H a RAW(4) written as x'12000000' reads back into an xstring as four
// bytes, trailing 00 kept, and an initial one as four 00 bytes, never as an
// empty value. The seed of test/seed.mjs writes abapGit's hex as it is
// (ZVDB_100_VEC-QBITS: 192 digits for RAW(192)), so prepareStore pads it.
//
// Read: into x(m) cut or padded 00 right, into an xstring the n bytes.
// Compared in a WHERE: an x of the same length (another length does not
// activate), an xstring of exactly n bytes (another length, empty too, is
// CX_SY_OPEN_SQL_DATA_ERROR), a literal of exactly 2n upper-case hex digits
// (anything else CX_SY_OPEN_SQL_DATA_ERROR, dynamic WHERE); = <> < > and
// ORDER BY are byte order, which is the order of the hex text when both
// sides have 2n upper-case digits. Written (SET, INSERT, UPDATE, MODIFY): an
// x or xstring of any length, cut or padded with 00 to n bytes.

// DBX is a RAW(n) column read: its n bytes.
func DBX(v DBString, n int) string { return XFit(DBXStr(v), n) }

// DBXHex is a byte value written into a RAW(n) column, or an x of n bytes
// compared with one: the n bytes (cut or 00-padded) as the column holds them.
func DBXHex(v string, n int) string { return XToHex(XFit(v, n)) }

// DBXSHex is an xstring compared with a RAW(n) column in a WHERE: exactly n
// bytes, else CX_SY_OPEN_SQL_DATA_ERROR as on A4H (SAPSQL_DATA_LOSS "'12' is
// not a valid value for X(4,0)" when not caught).
func DBXSHex(v string, n int) string {
	if len(v) != n {
		panic(ArithmeticError{"CX_SY_OPEN_SQL_DATA_ERROR", "'" + XToHex(v) + "' is not a valid value for X(" + itoa(n) + ",0)"})
	}
	return XToHex(v)
}

// DBXString is an xstring written into a RAWSTRING column: its hex, as the
// transpiler's TEXT column holds it.
func DBXString(v string) string { return XToHex(v) }

// rawHexLit is a literal compared with a RAW(n) column: exactly 2n
// upper-case hex digits, else CX_SY_OPEN_SQL_DATA_ERROR (A4H, dynamic WHERE:
// '12', '1200000000', lower case, 'XYZ', '', a number, a leading or
// trailing blank all raise)
func rawHexLit(v string, n int) bool {
	if len(v) != 2*n {
		return false
	}
	for i := 0; i < len(v); i++ {
		c := v[i]
		if !(c >= '0' && c <= '9' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}
