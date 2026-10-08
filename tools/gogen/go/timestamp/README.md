# Timestamp conversion

Converts ABAP short or fractional timestamps to date/time strings and back.
API: `ToDateTime` and `FromDateTime` return values, subrc, validity and an error.
UTC and blank zones use UTC (subrc 0 and 4); invalid dates return 12 without values.
Zero values stay initial; unsupported named zones return an error naming the zone.
The package uses only Go standard types and never imports the ABAP runtime.
