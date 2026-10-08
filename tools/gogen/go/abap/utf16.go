package abap

import (
	"strings"
	"sync"
	"sync/atomic"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"
	"unsafe"
)

// ABAP offsets count UTF-16 units. Ordinary values remain UTF-8; a lone
// surrogate is held as WTF-8 (ED A0..BF 80..BF), never as U+FFFD. Go's rune
// decoder cannot preserve these bytes, so character operations use decode16.
func decode16(v string) (rune, int) {
	if len(v) >= 3 && v[0] == 0xed && v[1] >= 0xa0 && v[1] <= 0xbf && v[2]&0xc0 == 0x80 {
		return rune(v[0]&15)<<12 | rune(v[1]&63)<<6 | rune(v[2]&63), 3
	}
	return utf8.DecodeRuneInString(v)
}

// Valid UTF-8: RuneCount + one for each four-byte lead byte. BMP strings
// (no byte >= F0) need no UTF-16 allocation. WTF-8 surrogates count once.
func count16(v string) int {
	n := utf8.RuneCountInString(v)
	for i := 0; i < len(v); i++ {
		if v[i] >= 0xf0 {
			n++
		}
		if v[i] == 0xed && i+2 < len(v) && v[i+1] >= 0xa0 && v[i+1] <= 0xbf && v[i+2]&0xc0 == 0x80 {
			n -= 2
			i += 2
		}
	}
	return n
}

// Four immutable values retain their backing memory; no address reuse can
// produce a stale answer. Short strings are bounded to 255 bytes of work.
// The non-ASCII offset index stores every 64th unit, built when first sliced, with at most 63 unit steps.
// A negative entry -(byte+1) marks the middle of a supplementary character.
type strMemo struct {
	p      *byte
	n      int
	ascii  bool
	units  int
	once   sync.Once
	idx    []int
	cursor atomic.Uint64
}

var strMemos [4]atomic.Pointer[strMemo]

func memoOf(v string) *strMemo {
	if len(v) < 256 {
		return nil
	}
	p := unsafe.StringData(v)
	for i := range strMemos {
		if m := strMemos[i].Load(); m != nil && m.p == p && m.n == len(v) {
			return m
		}
	}
	m := &strMemo{p: p, n: len(v), ascii: true, units: len(v)}
	for i := 0; i < len(v); i++ {
		if v[i] >= 0x80 {
			m.ascii = false
			break
		}
	}
	if !m.ascii {
		m.units = count16(v)
	}
	slot, shortest := 0, int(^uint(0)>>1)
	for i := range strMemos {
		old := strMemos[i].Load()
		if old == nil {
			slot = i
			break
		}
		if old.n < shortest {
			slot, shortest = i, old.n
		}
	}
	strMemos[slot].Store(m)
	return m
}
func isASCII(v string) bool {
	if m := memoOf(v); m != nil {
		return m.ascii
	}
	for i := 0; i < len(v); i++ {
		if v[i] >= 0x80 {
			return false
		}
	}
	return true
}
func (m *strMemo) byteAt(v string, k int) int {
	if m.ascii {
		return k
	}
	if k == m.units {
		return len(v)
	}
	m.once.Do(func() {
		m.idx = make([]int, 0, (m.units+63)/64)
		unit := 0
		for b := 0; b < len(v); {
			r, w := decode16(v[b:])
			if unit%64 == 0 {
				m.idx = append(m.idx, b)
			}
			unit++
			if r > 0xffff {
				if unit%64 == 0 {
					m.idx = append(m.idx, -b-1)
				}
				unit++
			}
			b += w
		}
	})
	from := k / 64 * 64
	b := m.idx[k/64]
	if len(v) < 1<<31 {
		c := m.cursor.Load()
		ck, cb := int(c>>32), int(int32(c))
		if ck <= k && ck > from {
			from, b = ck, cb
		}
	}
	for from < k {
		if b < 0 {
			b = -b - 1
			_, w := decode16(v[b:])
			b += w
			from++
			continue
		}
		r, w := decode16(v[b:])
		from++
		if r > 0xffff {
			if from == k {
				b = -b - 1
				break
			}
			from++
		}
		b += w
	}
	if len(v) < 1<<31 {
		m.cursor.Store(uint64(k)<<32 | uint64(uint32(b)))
	}
	return b
}
func boundary16(v string, k int) int {
	if m := memoOf(v); m != nil {
		return m.byteAt(v, k)
	}
	for b := 0; b < len(v); {
		if k == 0 {
			return b
		}
		r, w := decode16(v[b:])
		k--
		if r > 0xffff {
			if k == 0 {
				return -b - 1
			}
			k--
		}
		b += w
	}
	return len(v)
}
func surrogate16(u rune) string {
	return string([]byte{0xe0 | byte(u>>12), 0x80 | byte(u>>6)&63, 0x80 | byte(u)&63})
}
func slice16Memo(v string, from, to int, m *strMemo) string {
	if from == to {
		return ""
	}
	var a, b int
	if m != nil {
		a, b = m.byteAt(v, from), m.byteAt(v, to)
	} else {
		a, b = boundary16(v, from), boundary16(v, to)
	}
	prefix, suffix := "", ""
	if a < 0 {
		a = -a - 1
		r, w := decode16(v[a:])
		_, lo := utf16.EncodeRune(r)
		prefix = surrogate16(lo)
		a += w
	}
	if b < 0 {
		b = -b - 1
		r, _ := decode16(v[b:])
		hi, _ := utf16.EncodeRune(r)
		suffix = surrogate16(hi)
	}
	return prefix + v[a:b] + suffix
}

// UTF16Units and UTF16String preserve unpaired units for operations that
// rearrange text; adjacent high/low halves become normal UTF-8 again.
func UTF16Units(v string) []uint16 {
	out := make([]uint16, 0, int(Strlen(v)))
	for b := 0; b < len(v); {
		r, w := decode16(v[b:])
		b += w
		if r > 0xffff {
			hi, lo := utf16.EncodeRune(r)
			out = append(out, uint16(hi), uint16(lo))
		} else {
			out = append(out, uint16(r))
		}
	}
	return out
}
func UTF16String(u []uint16) string {
	var b strings.Builder
	for i := 0; i < len(u); i++ {
		r := rune(u[i])
		if r >= 0xd800 && r < 0xdc00 && i+1 < len(u) && u[i+1] >= 0xdc00 && u[i+1] < 0xe000 {
			b.WriteRune(utf16.DecodeRune(r, rune(u[i+1])))
			i++
		} else if utf16.IsSurrogate(r) {
			b.WriteString(surrogate16(r))
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}
func JoinUTF16(parts ...string) string {
	v := strings.Join(parts, "")
	return Canon(v)
}

// hasHalf distinguishes WTF-8 halves from valid UTF-8 beginning with ED
// (including Hangul). IndexByte skips ASCII runs without decoding them.
func hasHalf(v string) bool {
	for at := 0; at+2 < len(v); {
		i := strings.IndexByte(v[at:], 0xed)
		if i < 0 {
			return false
		}
		at += i
		if at+2 < len(v) && v[at+1] >= 0xa0 && v[at+1] <= 0xbf && v[at+2]&0xc0 == 0x80 {
			return true
		}
		at++
	}
	return false
}

// Canon enforces the runtime representation: only adjacent WTF-8 high/low
// halves are joined. Lone halves and all other bytes remain unchanged.
// It allocates only if a pair actually needs joining.
func Canon(v string) string {
	if !hasHalf(v) {
		return v
	}
	var b strings.Builder
	last := 0
	for i := 0; i+5 < len(v); i++ {
		if v[i] != 0xed || v[i+1] < 0xa0 || v[i+1] > 0xaf || v[i+2]&0xc0 != 0x80 ||
			v[i+3] != 0xed || v[i+4] < 0xb0 || v[i+4] > 0xbf || v[i+5]&0xc0 != 0x80 {
			continue
		}
		hi, _ := decode16(v[i:])
		lo, _ := decode16(v[i+3:])
		b.WriteString(v[last:i])
		b.WriteRune(utf16.DecodeRune(hi, lo))
		i += 5
		last = i + 1
	}
	if last == 0 {
		return v
	}
	b.WriteString(v[last:])
	return b.String()
}

// Concat joins canonical runtime strings. A new pair can exist only at
// their boundary; the byte check avoids scanning ASCII or BMP text.
func Concat(a, b string) string {
	if len(a) >= 3 && len(b) >= 3 && a[len(a)-3] == 0xed && b[0] == 0xed {
		return Canon(a + b)
	}
	return a + b
}

// JoinSurrogates is retained for callers of the original UTF-16 helper.
func JoinSurrogates(v string) string { return Canon(v) }

// wtf16View returns the UTF-16 units and the byte boundary of each unit in
// v. Supplementary characters contribute two units: the second boundary is
// inside their four-byte UTF-8 form, where a split half starts.
func wtf16View(v string) ([]uint16, []int) {
	units := make([]uint16, 0, len(v))
	bounds := make([]int, 0, len(v)+1)
	for b := 0; b < len(v); {
		r, width := decode16(v[b:])
		if r > 0xffff {
			hi, lo := utf16.EncodeRune(r)
			units = append(units, uint16(hi), uint16(lo))
			bounds = append(bounds, b, b+2)
		} else {
			units = append(units, uint16(r))
			bounds = append(bounds, b)
		}
		b += width
	}
	return units, append(bounds, len(v))
}

func splitSupplementary(v string) string {
	var b strings.Builder
	for i := 0; i < len(v); {
		r, width := decode16(v[i:])
		if r > 0xffff {
			hi, lo := utf16.EncodeRune(r)
			b.WriteString(surrogate16(hi))
			b.WriteString(surrogate16(lo))
		} else {
			b.WriteString(v[i : i+width])
		}
		i += width
	}
	return b.String()
}

func foldWTF8(v string, upper bool) string {
	if !hasHalf(v) {
		if upper {
			return strings.ToUpper(v)
		}
		return strings.ToLower(v)
	}
	var b strings.Builder
	for i := 0; i < len(v); {
		r, w := decode16(v[i:])
		if utf16.IsSurrogate(r) {
			b.WriteString(v[i : i+w])
		} else {
			if upper {
				r = unicode.ToUpper(r)
			} else {
				r = unicode.ToLower(r)
			}
			b.WriteRune(r)
		}
		i += w
	}
	return b.String()
}
func index16(v, sub string) int {
	if !hasHalf(sub) && !hasHalf(v) {
		if b := strings.Index(v, sub); b >= 0 {
			return int(Strlen(v[:b]))
		}
		return -1
	}
	a, b := UTF16Units(v), UTF16Units(sub)
	for i := 0; i+len(b) <= len(a); i++ {
		same := true
		for j := range b {
			if a[i+j] != b[j] {
				same = false
				break
			}
		}
		if same {
			return i
		}
	}
	return -1
}

// runesWTF8 preserves lone units while decoding supplementary scalars for
// case folding in pattern matching. Valid UTF-8 keeps Go's ordinary path.
func runesWTF8(v string) []rune {
	if !hasHalf(v) {
		return []rune(v)
	}
	out := make([]rune, 0, len(v))
	for i := 0; i < len(v); {
		r, w := decode16(v[i:])
		out = append(out, r)
		i += w
	}
	return out
}

// Text16 is go/abap's character runtime for packages that take a narrow
// interface instead of importing go/abap (charsection.Text): lengths and
// sections in UTF-16 units, fitting and padding, joining with the
// surrogate-half invariant.
var Text16 text16

type text16 struct{}

func (text16) Len(s string) int32                     { return Strlen(s) }
func (text16) Sub(s string, off, length int32) string { return SubS(s, off, length) }
func (text16) Fit(s string, n int) string             { return CFit(s, n) }
func (text16) Pad(s string, n int) string             { return PadC(s, n) }
func (text16) Join(parts ...string) string            { return JoinUTF16(parts...) }
