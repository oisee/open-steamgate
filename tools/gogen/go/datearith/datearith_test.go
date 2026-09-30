package datearith

import "testing"

func TestAddAcrossMonth(t *testing.T) {
	if got := Add("20240228", 2); got != "20240301" { t.Fatalf("got %s", got) }
}
