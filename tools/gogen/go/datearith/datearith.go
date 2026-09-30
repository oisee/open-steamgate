package datearith

import (
	"fmt"
	"time"

	"osg/gogen/abap"
)

// Add stays in the measured modern Gregorian range.
func Add(date string, days int32) string {
	var y, m, d int
	if len(date) != 8 || date < "15821015" || date > "99991231" {
		panic(abap.NotCompiled("date arithmetic", "a date outside the modern Gregorian range"))
	}
	if _, err := fmt.Sscanf(date, "%04d%02d%02d", &y, &m, &d); err != nil {
		panic(abap.NotCompiled("date arithmetic", "an invalid date"))
	}
	base := time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC)
	if base.Year() != y || int(base.Month()) != m || base.Day() != d {
		panic(abap.NotCompiled("date arithmetic", "an invalid date"))
	}
	result := base.AddDate(0, 0, int(days))
	if result.Year() < 1582 || result.Year() > 9999 || result.Format("20060102") < "15821015" {
		panic(abap.NotCompiled("date arithmetic", "a result outside the modern Gregorian range"))
	}
	return result.Format("20060102")
}
