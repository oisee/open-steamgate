package timestamp

import (
	"strings"
	"testing"
)

func TestConversions(t *testing.T) {
	for _, zone := range []string{"UTC", "UTC ", "", " "} {
		rcWant := int32(0)
		if strings.TrimRight(zone, " ") == "" {
			rcWant = 4
		}
		for _, tc := range []struct{ stamp, date, clock string }{
			{"20261007231500", "20261007", "231500"},
			{"20261007231500.1234567", "20261007", "231500"},
			{"20240229000000", "20240229", "000000"},
			
		} {
			d, tm, rc, ok, err := ToDateTime(tc.stamp, zone)
			if err != nil || !ok || d != tc.date || tm != tc.clock || rc != rcWant {
				t.Fatalf("%q/%s: %s/%s/%d/%v/%v", zone, tc.stamp, d, tm, rc, ok, err)
			}
			ts, rc, ok, err := FromDateTime(d, tm, zone)
			if err != nil || !ok || ts != strings.SplitN(tc.stamp, ".", 2)[0] || rc != rcWant {
				t.Fatalf("reverse %q/%s: %s/%d/%v/%v", zone, tc.stamp, ts, rc, ok, err)
			}
		}
	}
}

func TestInvalidValues(t *testing.T) {
	for _, stamp := range []string{"0", "00000000000000", "", "20261007", "20260230231500", "20261007240000", "abcdefghijklmno"} {
		d, tm, rc, ok, err := ToDateTime(stamp, "UTC")
		if err != nil || ok || rc != 12 || d != "" || tm != "" {
			t.Fatalf("%s: %s/%s/%d/%v/%v", stamp, d, tm, rc, ok, err)
		}
	}
	for _, tc := range [][2]string{{"00000000", "000000"}, {"00000000", "231500"}, {"20261007", "250000"}, {"20260230", "231500"}, {"2026107", "231500"}, {"20261007", "23150"}} {
		ts, rc, ok, err := FromDateTime(tc[0], tc[1], "")
		if err != nil || ok || rc != 12 || ts != "" {
			t.Fatalf("%v: %s/%d/%v/%v", tc, ts, rc, ok, err)
		}
	}
}

func TestNamedZoneRefusal(t *testing.T) {
	_, _, _, ok, err := ToDateTime("20261007231500", "CET ")
	if ok || err == nil || !strings.Contains(err.Error(), "CET") {
		t.Fatalf("forward: %v/%v", ok, err)
	}
	_, _, ok, err = FromDateTime("20261007", "231500", "CET")
	if ok || err == nil || !strings.Contains(err.Error(), "CET") {
		t.Fatalf("reverse: %v/%v", ok, err)
	}
}
