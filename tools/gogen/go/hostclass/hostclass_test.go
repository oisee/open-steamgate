package hostclass

import (
	"errors"
	"testing"
)

func TestRaiseIsAnError(t *testing.T) {
	err := &Raise{Class: "ZCX_TEST", Text: "host refused"}
	if err.Error() != "ZCX_TEST: host refused" || !errors.Is(err, err) {
		t.Fatalf("Raise Error() = %q", err.Error())
	}
}
