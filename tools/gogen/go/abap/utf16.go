package abap

import (
	"strings"
	"sync"
	"sync/atomic"
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
	return JoinSurrogates(v)
}

// JoinSurrogates makes every value that leaves the ABAP world valid UTF-8:
// adjacent high/low halves become their supplementary character. The byte
// scan keeps every ASCII and ordinary UTF-8 path unchanged.
func JoinSurrogates(v string) string {
	if strings.IndexByte(v, 0xed) < 0 {
		return v
	}
	return UTF16String(UTF16Units(v))
}
func index16(v, sub string) int {
	if !strings.Contains(sub, "\xed") && !strings.Contains(v, "\xed") {
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
