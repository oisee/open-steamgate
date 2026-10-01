package abap

import (
	"encoding/hex"
	"testing"
)

func str(v string) Data { return Data{P: &v, T: TString} }

func stringTable(value *[]string) Data {
	t := &Type{Kind: 'h', Row: TString}
	t.Lines = func(p any) int { return len(*p.(*[]string)) }
	t.At = func(p any, i int) any { return &(*p.(*[]string))[i] }
	t.Append = func(p any) any {
		table := p.(*[]string)
		*table = append(*table, "")
		return &(*table)[len(*table)-1]
	}
	t.Zero = func(p any) { *p.(*[]string) = nil }
	return Data{P: value, T: t}
}

func unhex(t *testing.T, h string) string {
	b, err := hex.DecodeString(h)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
