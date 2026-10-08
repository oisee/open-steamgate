package abap

import (
	"strings"
	"testing"
)

func TestConvertUTC(t *testing.T) {
	s := &Session{}
	d, tm, ts := "before", "before", "before"
	date, clock, stamp := Data{P: &d, T: TD}, Data{P: &tm, T: TT}, Data{P: &ts, T: TString}
	ConvertTimestampInto(s, "20261007231500", "UTC", date, clock)
	if d != "20261007" || tm != "231500" || s.Sy.Subrc != 0 {
		t.Fatalf("%s/%s/%d", d, tm, s.Sy.Subrc)
	}
	ConvertDateTimeInto(s, d, tm, "", stamp)
	if ts != "20261007231500" || s.Sy.Subrc != 4 {
		t.Fatalf("%s/%d", ts, s.Sy.Subrc)
	}
	ConvertTimestampInto(s, "20260230231500", "UTC", date, clock)
	if d != "20261007" || tm != "231500" || s.Sy.Subrc != 12 {
		t.Fatal("invalid timestamp changed targets")
	}
	ConvertDateTimeInto(s, d, "250000", "UTC", stamp)
	if ts != "20261007231500" || s.Sy.Subrc != 12 {
		t.Fatal("invalid clock changed target")
	}
	ConvertTimestampInto(s, "0", "UTC", date, clock)
	if d != "00000000" || tm != "000000" {
		t.Fatal("initial timestamp")
	}
	ConvertTimestampInto(s, "20261007231500", "UTC", Data{}, Data{})
}

func TestConvertRefusesNamedZone(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil || !strings.Contains(r.(error).Error(), "CET") {
			t.Fatalf("zone refusal: %v", r)
		}
	}()
	ConvertTimestampInto(&Session{}, "20261007231500", "CET", Data{}, Data{})
}
