package abap

import (
	"strings"
	"testing"
)

func TestConvertUTC(t *testing.T) {
	for _, zone := range []string{"UTC", ""} {
		s := &Session{}
		d, tm, ok := ConvertTimestamp(s, "20261007231500", zone)
		if !ok || d != "20261007" || tm != "231500" {
			t.Fatalf("%s: %s/%s/%v", zone, d, tm, ok)
		}
		wantRC := int32(0)
		if zone == "" {
			wantRC = 4
		}
		if s.Sy.Subrc != wantRC {
			t.Fatalf("%s: subrc %d", zone, s.Sy.Subrc)
		}
		ts, ok := ConvertDateTime(s, d, tm, zone)
		if !ok || ts != "20261007231500" || s.Sy.Subrc != wantRC {
			t.Fatalf("reverse %s: %s/%v", zone, ts, ok)
		}
	}
	s := &Session{}
	if _, _, ok := ConvertTimestamp(s, "20260230231500", "UTC"); ok || s.Sy.Subrc != 12 {
		t.Fatal("invalid timestamp accepted")
	}
	if _, ok := ConvertDateTime(s, "20261007", "250000", "UTC"); ok || s.Sy.Subrc != 12 {
		t.Fatal("invalid clock accepted")
	}
	d, tm, ok := ConvertTimestamp(s, "0", "UTC")
	if !ok || d != "00000000" || tm != "000000" {
		t.Fatal("initial timestamp")
	}
}

func TestConvertRefusesNamedZone(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil || !strings.Contains(r.(error).Error(), "CET") {
			t.Fatalf("zone refusal: %v", r)
		}
	}()
	ConvertTimestamp(&Session{}, "20261007231500", "CET")
}
