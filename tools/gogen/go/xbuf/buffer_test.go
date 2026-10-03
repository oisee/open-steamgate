package xbuf

import (
	"osg/gogen/bytesection"
	"strings"
	"testing"
)

var snapshot string

func TestSnapshotsAndCopyIn(t *testing.T) {
	var a, b Buffer
	a.Set("abcd")
	saved := a.Snapshot()
	b.Set(saved)
	a.Replace("XY", 1, 2)
	if saved != "abcd" || b.Snapshot() != "abcd" {
		t.Fatal("snapshot aliased a store")
	}
	a.Set(b.Snapshot())
	b.Replace("Z", 0, 1)
	if a.Snapshot() != "abcd" {
		t.Fatal("copy-in aliased its source")
	}
	part := a.Sub(1, 2)
	a.Replace("00", 1, 2)
	if part != "bc" {
		t.Fatal("substring aliased memory")
	}
	a.Clear()
	if a.Len() != 0 || a.Snapshot() != "" {
		t.Fatal("CLEAR")
	}
}

func TestAppendAndSplices(t *testing.T) {
	var b Buffer
	b.Set("abc")
	b.Append(b.Snapshot(), b.Sub(1, 1))
	if b.Snapshot() != "abcabcb" {
		t.Fatal(b.Snapshot())
	}
	changes, capacity := 0, cap(b.bytes)
	for i := 0; i < 65536; i++ {
		b.Append("x")
		if cap(b.bytes) != capacity {
			changes++
			capacity = cap(b.bytes)
		}
	}
	if changes > 40 {
		t.Fatalf("append reallocates too often: %d", changes)
	}
	for _, source := range []string{"", "a", "abcd"} {
		for off := 0; off <= len(source); off++ {
			for n := 0; n <= len(source)-off; n++ {
				for _, with := range []string{"", "X", "12345"} {
					b.Set(source)
					if b.Replace(with, int32(off), int32(n)) != 0 {
						t.Fatal("subrc")
					}
					want := bytesection.Replace(source, with, int32(off), int32(n))
					if b.Snapshot() != want {
						t.Fatalf("splice %q: %q != %q", source, b.Snapshot(), want)
					}
				}
			}
			b.Set(source)
			b.Replace("Z", int32(off), bytesection.NoLength)
			if b.Snapshot() != bytesection.Replace(source, "Z", int32(off), bytesection.NoLength) {
				t.Fatal("default length")
			}
		}
	}
}

func TestBoundsBeforeWrite(t *testing.T) {
	for _, span := range [][2]int32{{-1, 1}, {5, 0}, {0, -1}, {3, 2}, {1, 2147483647}} {
		var b Buffer
		b.Set("abcd")
		func() {
			defer func() {
				if recover() == nil {
					t.Error("missing bounds exception")
				}
			}()
			b.Replace("X", span[0], span[1])
		}()
		if b.Snapshot() != "abcd" {
			t.Fatal("changed before bounds validation")
		}
	}
}

func TestStoreAndSubstringAllocation(t *testing.T) {
	var b Buffer
	b.Set(strings.Repeat("\x00", 16*65536))
	if allocations := testing.AllocsPerRun(1000, func() { b.Replace("abcd", 1024, 4) }); allocations != 0 {
		t.Fatalf("equal-length store allocations: %g", allocations)
	}
	stores := testing.Benchmark(func(t *testing.B) {
		t.ReportAllocs()
		for i := 0; i < t.N; i++ {
			b.Replace("abcd", 1024, 4)
		}
	})
	if bytes := stores.AllocedBytesPerOp(); bytes != 0 {
		t.Fatalf("store allocated %d bytes/op", bytes)
	}
	loads := testing.Benchmark(func(t *testing.B) {
		t.ReportAllocs()
		for i := 0; i < t.N; i++ {
			snapshot = b.Sub(1024, 4)
		}
	})
	if bytes := loads.AllocedBytesPerOp(); bytes > 16 {
		t.Fatalf("four-byte load allocated %d bytes/op", bytes)
	}
}

func TestSetReleasesLargeCapacity(t *testing.T) {
	var b Buffer
	b.Set(strings.Repeat("x", 16*65536))
	capacity := cap(b.bytes)
	b.Set(strings.Repeat("y", capacity/2))
	if cap(b.bytes) != capacity {
		t.Fatal("ordinary overwrite lost reusable capacity")
	}
	b.Set("small")
	if b.Snapshot() != "small" || cap(b.bytes) >= capacity/4 {
		t.Fatal("small assignment retained large backing array")
	}
	b.Set("")
	if cap(b.bytes) != 0 {
		t.Fatal("empty assignment retained backing array")
	}
}

func TestInlineReadsAndStores(t *testing.T) {
	var mem Buffer
	mem.Set("\x01\xff\x03\x04")
	var dst [4]byte
	mem.ReadInto(dst[:], 1, 1)
	if dst != [4]byte{255, 0, 0, 0} {
		t.Fatal(dst)
	}
	saved := dst
	mem.StoreFrom(dst[:1], 0)
	if mem.Snapshot() != "\xff\xff\x03\x04" || dst != saved {
		t.Fatal("store value semantics")
	}
	for _, span := range [][2]int32{{-1, 1}, {4, 1}, {0, -1}, {1, 2147483647}} {
		func() {
			defer func() {
				if recover() == nil {
					t.Error("missing range error")
				}
			}()
			mem.ReadInto(dst[:], span[0], span[1])
		}()
		if dst != saved {
			t.Fatal("read changed target before validation")
		}
	}
	before := mem.Snapshot()
	func() {
		defer func() {
			if recover() == nil {
				t.Error("missing range error")
			}
		}()
		mem.StoreFrom(dst[:], 1)
	}()
	if mem.Snapshot() != before {
		t.Fatal("store changed memory before validation")
	}
	if n := testing.AllocsPerRun(1000, func() { mem.ReadInto(dst[:1], 1, 1); mem.StoreFrom(dst[:1], 0) }); n != 0 {
		t.Fatal(n)
	}
}

func TestSingleByteBoundsAndStore(t *testing.T) {
	var mem Buffer
	mem.Set("\x00\xff")
	if mem.Byte(1) != 255 {
		t.Fatal("byte read")
	}
	if mem.StoreByte(128, 0) != 0 || mem.Snapshot() != "\x80\xff" {
		t.Fatal("byte store")
	}
	for _, off := range []int32{-1, 2, 2147483647} {
		before := mem.Snapshot()
		for _, run := range []func(){func() { mem.Byte(off) }, func() { mem.StoreByte(1, off) }} {
			func() {
				defer func() {
					if recover() == nil {
						t.Error("missing range error")
					}
				}()
				run()
			}()
			if mem.Snapshot() != before {
				t.Fatal("changed before validation")
			}
		}
	}
	if n := testing.AllocsPerRun(1000, func() { mem.StoreByte(mem.Byte(1), 0) }); n != 0 {
		t.Fatal(n)
	}
}
