package abap

import (
	"strings"
	"time"
)

// UTC and the initial zone have no offset. No timezone table is installed
// in this host: name any other zone in the refusal instead of guessing.
func timestampZone(s *Session, zone string) {
	zone = strings.TrimRight(zone, " ")
	switch zone {
	case "UTC":
		s.Sy.Subrc = 0
	case "":
		s.Sy.Subrc = 4
	default:
		panic(NotCompiled("CONVERT TIME STAMP", "time zone "+zone+" is not supported"))
	}
}

func ConvertTimestamp(s *Session, stamp, zone string) (string, string, bool) {
	timestampZone(s, zone)
	if stamp == "0" {
		return "00000000", "000000", true
	}
	stamp = strings.SplitN(stamp, ".", 2)[0]
	if len(stamp) != 14 {
		s.Sy.Subrc = 12
		return "", "", false
	}
	if _, err := time.Parse("20060102150405", stamp); err != nil {
		s.Sy.Subrc = 12
		return "", "", false
	}
	return stamp[:8], stamp[8:], true
}

func ConvertDateTime(s *Session, date, clock, zone string) (string, bool) {
	timestampZone(s, zone)
	if date == "00000000" && clock == "000000" {
		return "0", true
	}
	if len(date) != 8 || len(clock) != 6 {
		s.Sy.Subrc = 12
		return "", false
	}
	if _, err := time.Parse("20060102150405", date+clock); err != nil {
		s.Sy.Subrc = 12
		return "", false
	}
	return date + clock, true
}

// Host statement adapters use ordinary native IR so both emitters can
// compile the surrounding class, even when a host lacks this operation.
func ConvertTimestampInto(s *Session, stamp, zone string, date, clock Data) {
	d, tm, ok := ConvertTimestamp(s, stamp, zone)
	if !ok {
		return
	}
	if date.P != nil {
		MoveData(date, Data{P: &d, T: TString})
	}
	if clock.P != nil {
		MoveData(clock, Data{P: &tm, T: TString})
	}
}

func ConvertDateTimeInto(s *Session, date, clock, zone string, stamp Data) {
	ts, ok := ConvertDateTime(s, date, clock, zone)
	if ok {
		MoveData(stamp, Data{P: &ts, T: TString})
	}
}
