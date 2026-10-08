package timestamp

import (
	"fmt"
	"strings"
	"time"
)

// UTC and the initial zone have no offset. No timezone table is installed
// in this host: name any other zone in the refusal instead of guessing.
func zoneCode(zone string) (int32, error) {
	zone = strings.TrimRight(zone, " ")
	switch zone {
	case "UTC":
		return 0, nil
	case "":
		return 4, nil
	default:
		return 0, fmt.Errorf("time zone %s is not supported", zone)
	}
}

// ToDateTime validates a timestamp and discards its fractional seconds.
func ToDateTime(stamp, zone string) (date, clock string, subrc int32, valid bool, err error) {
	rc, err := zoneCode(zone)
	if err != nil {
		return "", "", rc, false, err
	}
	stamp = strings.SplitN(stamp, ".", 2)[0]
	if len(stamp) != 14 {
		return "", "", 12, false, nil
	}
	if parsed, err := time.Parse("20060102150405", stamp); err != nil || parsed.Year() == 0 {
		return "", "", 12, false, nil
	}
	return stamp[:8], stamp[8:], rc, true, nil
}

// FromDateTime validates date/time before forming a short timestamp.
func FromDateTime(date, clock, zone string) (stamp string, subrc int32, valid bool, err error) {
	rc, err := zoneCode(zone)
	if err != nil {
		return "", rc, false, err
	}
	if len(date) != 8 || len(clock) != 6 {
		return "", 12, false, nil
	}
	if parsed, err := time.Parse("20060102150405", date+clock); err != nil || parsed.Year() == 0 {
		return "", 12, false, nil
	}
	return date + clock, rc, true, nil
}
