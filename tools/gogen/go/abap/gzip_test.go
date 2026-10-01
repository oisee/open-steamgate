package abap

import (
	"strings"
	"testing"
)

func TestInflateRawHostError(t *testing.T) {
	var out string
	var n int32
	defer func() {
		if e, ok := recover().(HostError); !ok || !strings.Contains(e.Text, "zlib") {
			t.Errorf("not DEFLATE: got %v", e)
		}
	}()
	InflateRaw(&Session{}, "\xff\xff\xff\xff", &out, &n)
}
