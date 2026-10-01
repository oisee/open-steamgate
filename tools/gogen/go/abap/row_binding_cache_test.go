package abap

import (
	"reflect"
	"runtime"
	"sync"
	"testing"
	"weak"
)

func TestBumpTableCacheHit(t *testing.T) {
	rows := []int{1}
	binding := BindRow(&rows, 0)
	ptr := (*byte)(reflect.ValueOf(&rows).UnsafePointer())
	if cell, ok := cachedVersion(ptr); !ok || cell != binding.version {
		t.Fatal("binding did not populate the cache")
	}
	BumpTable(&rows)
	if binding.version.Load() != binding.at+1 {
		t.Fatal("cached bump did not increment the version")
	}
	assertUnassigned(t, binding)
}

func TestBumpTableNegativeThenCreate(t *testing.T) {
	rows := []int{1}
	ptr := (*byte)(reflect.ValueOf(&rows).UnsafePointer())
	versionBloomAdd(ptr) // exercise the negative cache despite the pre-check
	BumpTable(&rows)
	if cell, ok := cachedVersion(ptr); !ok || cell != nil {
		t.Fatal("missing cell was not cached")
	}
	stale := versionSlot(ptr).Load()
	binding := BindRow(&rows, 0)
	// A concurrent slow lookup can publish its old negative result after creation.
	versionSlot(ptr).Store(stale)
	if _, ok := cachedVersion(ptr); ok {
		t.Fatal("negative entry survived cell creation")
	}
	BumpTable(&rows)
	assertUnassigned(t, binding)
}

func TestBumpTableNegativeDuringCreation(t *testing.T) {
	rows := []int{1}
	ptr := (*byte)(reflect.ValueOf(&rows).UnsafePointer())
	versionBloomAdd(ptr)
	BumpTable(&rows)
	versionGeneration.Add(1) // model a creator between invalidation and publication
	defer versionGeneration.Add(1)
	if _, ok := cachedVersion(ptr); ok {
		t.Fatal("negative entry was valid while a cell was being published")
	}
}

func TestBumpTableFreshAddress(t *testing.T) {
	for i := 0; i < 1024; i++ {
		rows := []int{i}
		ptr := (*byte)(reflect.ValueOf(&rows).UnsafePointer())
		if versionBloomSeen(ptr) {
			continue
		}
		slot := versionSlot(ptr)
		before := slot.Load()
		BumpTable(&rows)
		if slot.Load() != before {
			t.Fatal("fresh address populated the version cache")
		}
		binding := BindRow(&rows, 0)
		if !versionBloomSeen(ptr) {
			t.Fatal("cell creation did not publish the address")
		}
		BumpTable(&rows)
		assertUnassigned(t, binding)
		return
	}
	t.Fatal("could not allocate an address absent from the Bloom filter")
}

func TestBumpTableCacheAfterGC(t *testing.T) {
	dead := func() weak.Pointer[byte] {
		rows := []int{1}
		binding := BindRow(&rows, 0)
		ptr := (*byte)(reflect.ValueOf(&rows).UnsafePointer())
		BumpTable(&rows)
		runtime.KeepAlive(binding)
		return weak.Make(ptr)
	}()
	runtime.GC()
	if dead.Value() != nil {
		t.Fatal("old table header is still live")
	}
	for i := 0; i < 1024; i++ {
		rows := []int{i}
		BumpTable(&rows)
		binding := BindRow(&rows, 0)
		if got := *CheckedRowPtr(binding); got != i {
			t.Fatalf("new table row = %d, want %d", got, i)
		}
		BumpTable(&rows)
		assertUnassigned(t, binding)
	}
}

func TestBumpTableConcurrent(t *testing.T) {
	rows := []int{1}
	binding := BindRow(&rows, 0)
	const workers, bumps = 8, 1000
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range bumps {
				BumpTable(&rows)
			}
		}()
	}
	wg.Wait()
	if got := binding.version.Load(); got != workers*bumps {
		t.Fatalf("version = %d, want %d", got, workers*bumps)
	}
}

func assertUnassigned[T any](t *testing.T, binding *RowBinding[T]) {
	t.Helper()
	defer func() {
		if recover() == nil {
			t.Fatal("binding survived a structural mutation")
		}
	}()
	CheckedRowPtr(binding)
}
