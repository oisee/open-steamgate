package abap

// The decoder of ZCL_OSD_INFLATE on the Go host (ZCL_OSD_INFLATE=>HOST_*).
// It is the same state machine, step for step: a block header, the code
// tables of a dynamic block, one literal or one length/distance pair; a step
// that runs out of input is rolled back and taken again on the next feed; the
// output budget, the window kept between 32 and 64 KiB and the bytes left
// after the final block are the ABAP's, and so is the text of every error.
// What differs is speed: a Huffman code of up to 9 bits is looked up in a
// table instead of being walked bit by bit.
//
// compress/flate is not used because it can do none of that: its errors are
// offsets, not reasons, and it cannot stop after an output budget.

const (
	inflHeader = iota
	inflStoredLen
	inflStored
	inflTable
	inflSymbols
	inflDone
)

const (
	inflWindow   = 32768
	inflFastBits = 9
)

var (
	inflLenBase   = [29]int{3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258}
	inflLenExtra  = [29]uint{0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0}
	inflDistBase  = [30]int{1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577}
	inflDistExtra = [30]uint{0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13}
	inflOrder     = [19]int{16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15}

	inflFixedLen, inflFixedDist = func() (*inflHuff, *inflHuff) {
		l := make([]int, 288)
		for i := range l {
			switch {
			case i < 144:
				l[i] = 8
			case i < 256:
				l[i] = 9
			case i < 280:
				l[i] = 7
			default:
				l[i] = 8
			}
		}
		d := make([]int, 30)
		for i := range d {
			d[i] = 5
		}
		hl, _, _ := inflBuild(l)
		hd, _, _ := inflBuild(d)
		return hl, hd
	}()
)

// inflHuff is the canonical code of puff.c (count per length, symbols in
// code order) plus a table of the codes of up to inflFastBits bits, indexed
// by the next bits of the stream: symbol<<4 | length, 0 for none.
type inflHuff struct {
	count  [16]int
	symbol []int
	fast   [1 << inflFastBits]uint16
}

// inflError is a corrupt stream; its text is ZCX_OSD_INFLATE's reason.
type inflError string

// inflBuild is BUILD: the code, and the unused code space (0 when complete).
func inflBuild(lengths []int) (*inflHuff, int, inflError) {
	h := &inflHuff{symbol: make([]int, len(lengths))}
	for _, l := range lengths {
		if l > 0 {
			h.count[l]++
		}
	}
	left := 1
	for l := 1; l <= 15; l++ {
		left = left*2 - h.count[l]
		if left < 0 {
			return nil, 0, "over-subscribed Huffman code lengths"
		}
	}
	var offs [16]int
	for l := 1; l < 15; l++ {
		offs[l+1] = offs[l] + h.count[l]
	}
	for sym, l := range lengths {
		if l > 0 {
			h.symbol[offs[l]] = sym
			offs[l]++
		}
	}
	// the fast table: canonical codes in symbol order per length, reversed,
	// because the stream holds a code's first bit lowest
	code := 0
	idx := 0
	for l := 1; l <= inflFastBits; l++ {
		for i := 0; i < h.count[l]; i++ {
			rev := 0
			for b := 0; b < l; b++ {
				rev |= ((code >> b) & 1) << (l - 1 - b)
			}
			for j := rev; j < 1<<inflFastBits; j += 1 << l {
				h.fast[j] = uint16(h.symbol[idx]<<4 | l)
			}
			code++
			idx++
		}
		code <<= 1
	}
	return h, left, ""
}

// inflSingle is SINGLE: exactly one symbol, with a code of length 1.
func inflSingle(lengths []int) bool {
	used := 0
	for _, l := range lengths {
		if l > 0 {
			if l != 1 {
				return false
			}
			used++
		}
	}
	return used == 1
}

type inflater struct {
	in         []byte
	pos        int
	bitbuf     uint64
	bitcnt     uint
	state      int
	final      bool
	storedLeft int
	hist       []byte
	unused     []byte
	room       int
	lens, dist *inflHuff
}

func (z *inflater) need(n uint) bool {
	for z.bitcnt < n {
		if z.pos >= len(z.in) {
			return false
		}
		z.bitbuf |= uint64(z.in[z.pos]) << z.bitcnt
		z.bitcnt += 8
		z.pos++
	}
	return true
}

func (z *inflater) bits(n uint) int {
	v := int(z.bitbuf & (1<<n - 1))
	z.bitbuf >>= n
	z.bitcnt -= n
	return v
}

// decode is DECODE: a symbol, or -1 when the input runs out first.
func (z *inflater) decode(h *inflHuff) int {
	// as many whole bytes as there are, up to 15 bits ahead; the rest of a
	// step reads them from the buffer as NEED would have read them
	for z.bitcnt < 15 && z.pos < len(z.in) {
		z.bitbuf |= uint64(z.in[z.pos]) << z.bitcnt
		z.bitcnt += 8
		z.pos++
	}
	if e := h.fast[z.bitbuf&(1<<inflFastBits-1)]; e != 0 && uint(e&15) <= z.bitcnt {
		z.bitbuf >>= e & 15
		z.bitcnt -= uint(e & 15)
		return int(e >> 4)
	}
	code, first, index := 0, 0, 0
	for l := 1; l <= 15; l++ {
		if z.bitcnt < 1 && !z.need(1) {
			return -1
		}
		code |= int(z.bitbuf & 1)
		z.bitbuf >>= 1
		z.bitcnt--
		count := h.count[l]
		if code-count < first {
			return h.symbol[index+code-first]
		}
		index += count
		first = (first + count) << 1
		code <<= 1
	}
	panic(inflError("invalid Huffman code"))
}

func (z *inflater) stepHeader() bool {
	if !z.need(3) {
		return false
	}
	z.final = z.bits(1) == 1
	switch z.bits(2) {
	case 0:
		z.state = inflStoredLen
	case 1:
		z.lens, z.dist = inflFixedLen, inflFixedDist
		z.state = inflSymbols
	case 2:
		z.state = inflTable
	default:
		panic(inflError("invalid block type 3"))
	}
	return true
}

func (z *inflater) stepStoredLen() bool {
	z.bits(z.bitcnt % 8)
	if !z.need(16) {
		return false
	}
	n := z.bits(16)
	if !z.need(16) {
		return false
	}
	if z.bits(16) != 65535-n {
		panic(inflError("stored block length does not match its complement"))
	}
	z.storedLeft = n
	z.state = inflStored
	return true
}

func (z *inflater) stepStored() bool {
	if z.storedLeft == 0 {
		z.endBlock()
		return true
	}
	// whole bytes a fast decode read ahead come first
	take := len(z.in) - z.pos + int(z.bitcnt/8)
	if take > z.storedLeft {
		take = z.storedLeft
	}
	if z.room > 0 && take > z.room {
		take = z.room
	}
	if take == 0 {
		return false
	}
	for z.bitcnt >= 8 && take > 0 {
		z.hist = append(z.hist, byte(z.bits(8)))
		take--
		z.storedLeft--
	}
	z.hist = append(z.hist, z.in[z.pos:z.pos+take]...)
	z.pos += take
	z.storedLeft -= take
	return true
}

func (z *inflater) stepTable() bool {
	if !z.need(14) {
		return false
	}
	nlen := z.bits(5) + 257
	ndist := z.bits(5) + 1
	ncode := z.bits(4) + 4
	if nlen > 286 || ndist > 30 {
		panic(inflError("too many length or distance codes"))
	}
	codes := make([]int, 19)
	for i := 0; i < ncode; i++ {
		if !z.need(3) {
			return false
		}
		codes[inflOrder[i]] = z.bits(3)
	}
	hc, left, err := inflBuild(codes)
	if err != "" {
		panic(err)
	}
	if left != 0 {
		panic(inflError("incomplete code-length code"))
	}
	lengths := make([]int, 0, nlen+ndist)
	for len(lengths) < nlen+ndist {
		sym := z.decode(hc)
		if sym < 0 {
			return false
		}
		if sym < 16 {
			lengths = append(lengths, sym)
			continue
		}
		prev, repeat := 0, 0
		switch sym {
		case 16:
			if len(lengths) == 0 {
				panic(inflError("repeat code with no previous length"))
			}
			prev = lengths[len(lengths)-1]
			if !z.need(2) {
				return false
			}
			repeat = 3 + z.bits(2)
		case 17:
			if !z.need(3) {
				return false
			}
			repeat = 3 + z.bits(3)
		default:
			if !z.need(7) {
				return false
			}
			repeat = 11 + z.bits(7)
		}
		if len(lengths)+repeat > nlen+ndist {
			panic(inflError("code lengths repeat past the end of the table"))
		}
		for ; repeat > 0; repeat-- {
			lengths = append(lengths, prev)
		}
	}
	if lengths[256] == 0 {
		panic(inflError("no code for the end of the block"))
	}
	ll, dl := lengths[:nlen], lengths[nlen:]
	hl, left, err := inflBuild(ll)
	if err != "" {
		panic(err)
	}
	if left != 0 && !inflSingle(ll) {
		panic(inflError("incomplete literal/length code"))
	}
	hd, left, err := inflBuild(dl)
	if err != "" {
		panic(err)
	}
	if left != 0 && !inflSingle(dl) {
		for _, l := range dl {
			if l > 0 {
				panic(inflError("incomplete distance code"))
			}
		}
	}
	z.lens, z.dist = hl, hd
	z.state = inflSymbols
	return true
}

func (z *inflater) stepSymbol() bool {
	sym := z.decode(z.lens)
	if sym < 0 {
		return false
	}
	if sym < 256 {
		z.hist = append(z.hist, byte(sym))
		return true
	}
	if sym == 256 {
		z.endBlock()
		return true
	}
	sym -= 257
	if sym >= 29 {
		panic(inflError("invalid length symbol"))
	}
	if !z.need(inflLenExtra[sym]) {
		return false
	}
	length := inflLenBase[sym] + z.bits(inflLenExtra[sym])
	sym = z.decode(z.dist)
	if sym < 0 {
		return false
	}
	if sym >= 30 {
		panic(inflError("invalid distance symbol"))
	}
	if !z.need(inflDistExtra[sym]) {
		return false
	}
	distance := inflDistBase[sym] + z.bits(inflDistExtra[sym])
	if distance > len(z.hist) {
		panic(inflError("invalid distance too far back"))
	}
	start := len(z.hist) - distance
	for i := 0; i < length; i++ {
		z.hist = append(z.hist, z.hist[start+i])
	}
	return true
}

func (z *inflater) endBlock() {
	if !z.final {
		z.state = inflHeader
		return
	}
	z.state = inflDone
	// the whole bytes still in the bit buffer were read past the end
	z.bits(z.bitcnt % 8)
	for z.bitcnt >= 8 {
		z.unused = append(z.unused, byte(z.bits(8)))
	}
	z.unused = append(z.unused, z.in[z.pos:]...)
	z.pos = len(z.in)
}

// feed is FEED for a stream not yet done; paused when the budget stopped it.
func (z *inflater) feed(data []byte, maxOut int) (out []byte, paused bool) {
	if z.pos > 0 {
		z.in = append(z.in[:0], z.in[z.pos:]...)
		z.pos = 0
	}
	z.in = append(z.in, data...)
	from := len(z.hist)
	var emitted []byte
	for z.state != inflDone {
		z.room = 0
		if maxOut > 0 {
			z.room = maxOut - len(emitted) - len(z.hist) + from
			if z.room <= 0 {
				paused = true
				break
			}
		}
		pos, bitbuf, bitcnt := z.pos, z.bitbuf, z.bitcnt
		var ok bool
		switch z.state {
		case inflHeader:
			ok = z.stepHeader()
		case inflStoredLen:
			ok = z.stepStoredLen()
		case inflStored:
			ok = z.stepStored()
		case inflTable:
			ok = z.stepTable()
		default:
			ok = z.stepSymbol()
		}
		if !ok {
			z.pos, z.bitbuf, z.bitcnt = pos, bitbuf, bitcnt
			break
		}
		// the history stays between 32 and 64 KiB
		if n := len(z.hist); n > 2*inflWindow {
			cut := n - inflWindow
			if from < cut {
				emitted = append(emitted, z.hist[from:cut]...)
				from = cut
			}
			z.hist = append(z.hist[:0], z.hist[cut:]...)
			from -= cut
		}
	}
	return append(emitted, z.hist[from:]...), paused
}

func (s *Session) inflaters() map[int32]*inflater {
	if s.inflate == nil {
		s.inflate = map[int32]*inflater{}
	}
	return s.inflate
}

// InflateHostOpen is ZCL_OSD_INFLATE=>HOST_OPEN: a handle (never 0, which
// the ABAP answers when there is no host).
func InflateHostOpen(s *Session) int32 {
	m := s.inflaters()
	s.inflateSeq++
	m[s.inflateSeq] = &inflater{}
	return s.inflateSeq
}

// InflateHostFeed is ZCL_OSD_INFLATE=>HOST_FEED. State: 1 paused, 2 done,
// in which case unused holds the bytes after the end and the handle is
// gone; a corrupt stream answers its reason and drops the handle as well.
// A stream its reader abandons keeps its handle (at most 64 KiB of window)
// until the session ends: ABAP has no destructor to drop it with.
func InflateHostFeed(s *Session, handle int32, data string, maxOut int32, raw *string, state *int32, unused *string, reason *string) {
	m := s.inflaters()
	z := m[handle]
	*raw, *state, *unused, *reason = "", 0, "", ""
	if z == nil {
		*reason = "inflate handle is gone"
		return
	}
	defer func() {
		if r := recover(); r != nil {
			e, ok := r.(inflError)
			if !ok {
				panic(r)
			}
			delete(m, handle)
			*reason = string(e)
		}
	}()
	out, paused := z.feed([]byte(data), int(maxOut))
	*raw = string(out)
	if paused {
		*state = 1
	}
	if z.state == inflDone {
		*state = 2
		*unused = string(z.unused)
		delete(m, handle)
	}
}
